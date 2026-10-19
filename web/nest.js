// nest.js — pure: Auto-nest (no DOM, no imports) — nest.test.mjs. Parts are packed by their real outline, not their box, turned in 90° steps,
// filled from the bottom-left corner, largest first, on the usable area of the sheet (the sheet less its grippers).
//
// How: a coarse grid of the sheet (cells of `cell` mm, 1 mm unless the sheet is huge) says where parts already are. Each part and turn
// has a mask: the cells within `gap` of its outline (and its inside). A place is tried at every cell, lowest row first and then leftmost
// (bottom-left); the mask must meet no taken cell. The grid only PROPOSES a place: every place is then checked on the real outline
// (the gap to every part placed before, and the part inside the area), so a place the grid got wrong is skipped, never used.
// Positions are on the grid (whole mm), the area's own corner is the origin. A part with a hole is packed as its outer outline (the hole
// is not used by other parts). The packer is deterministic: the same job always gives the same result.
//
// A job:   { area: { x, y, w, h } (mm, y up: where parts may go), gap (mm), rotations: 'none' | 'flip' | 'all',
//            items: [{ id, count, poly: [[x, y], …] }]  poly: the part's outline in mm, its own lower-left corner is 0,0, y up,
//            fixed: [poly in sheet mm, …]  (parts already on the sheet: kept clear of, never moved), cell (mm, optional) }
// A placement: { partId, i (the piece's number within its part), rot (0 | 90 | 180 | 270, anticlockwise about the part's 0,0), x, y }
//            — apply.js's placed part: (x, y) is where the part's own 0,0 lands on the sheet, so rotated outlines are shifted to stay in the area.

export const ROTATIONS = { none: [0], flip: [0, 180], all: [0, 90, 180, 270] };
export const MAX_PIECES = 1000;

// ---------------------------------------------------------------- outlines
const EPS = 1e-6;

/** A polygon's area (positive), mm². */
export function polyArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
/** [x0, y0, x1, y1] of a polygon. */
export function polyBox(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
/** The point turned by a multiple of 90° (exact, no rounding noise). */
function turn(x, y, deg) {
  switch (((deg % 360) + 360) % 360) { case 90: return [-y, x]; case 180: return [-x, -y]; case 270: return [y, -x]; default: return [x, y]; }
}
/** The outline turned by `deg` (a multiple of 90°) about its 0,0 and then moved by (dx, dy). */
export const polyAt = (poly, deg, dx = 0, dy = 0) => poly.map(([x, y]) => { const [u, v] = turn(x, y, deg); return [u + dx, v + dy]; });

function inside(p, x, y) {
  let o = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o;
  }
  return o;
}
function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  let t = l ? ((px - a[0]) * dx + (py - a[1]) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
/** Do two segments cross properly (their insides meet at one point)? Touching and lying along each other is not crossing. */
function crosses(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) && ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS));
}
const boxGap = (a, b) => Math.max(0, a[0] - b[2], b[0] - a[2], a[1] - b[3], b[1] - a[3]);

/** The least distance between two outlines' edges (0 when they cross); outlines that lie one inside the other are NOT told apart here. */
export function edgeDistance(A, B) {
  let best = Infinity;
  for (let i = 0; i < A.length; i++) {
    const a0 = A[i], a1 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const b0 = B[j], b1 = B[(j + 1) % B.length];
      if (crosses(a0, a1, b0, b1)) return 0;
      const d = Math.min(segDist(a0[0], a0[1], b0, b1), segDist(a1[0], a1[1], b0, b1), segDist(b0[0], b0[1], a0, a1), segDist(b1[0], b1[1], a0, a1));
      if (d < best) best = d;
    }
  }
  return best;
}
/** Do the two outlines share any area (cross, or one lies inside the other)? Touching along an edge is not overlap. */
export function overlaps(A, B) {
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (crosses(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
  // no crossing: one may lie inside the other. A vertex or an edge's middle strictly inside (not on the edge) says so; touching cannot fool it.
  const onEdge = (P, x, y) => { for (let k = 0; k < P.length; k++) if (segDist(x, y, P[k], P[(k + 1) % P.length]) < 1e-7) return true; return false; };
  const strictly = (P, Q) => {
    for (let k = 0; k < P.length; k++) {
      const a = P[k], b = P[(k + 1) % P.length];
      for (const [x, y] of [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]]) if (inside(Q, x, y) && !onEdge(Q, x, y)) return true;
    }
    return false;
  };
  return strictly(A, B) || strictly(B, A);
}
/** Are two outlines clear of each other: at least `gap` apart (gap 0: no shared area, touching is fine)? */
export function clear(A, B, gap) {
  const g = boxGap(polyBox(A), polyBox(B));
  if (g > 0 && g >= gap - EPS) return true;
  if (gap > 0) return edgeDistance(A, B) >= gap - EPS && !overlaps(A, B);
  return !overlaps(A, B);
}

// ---------------------------------------------------------------- the grid
/** Rows of bits: which cells of the area are taken. */
class Grid {
  constructor(gw, gh) { this.gw = gw; this.gh = gh; this.W = Math.ceil(gw / 32) || 1; this.bits = new Uint32Array(this.W * gh); }
  /** Is any cell c0..c1 of row r taken? (cells outside the grid are free) */
  any(r, c0, c1) {
    if (r < 0 || r >= this.gh) return false;
    if (c0 < 0) c0 = 0;
    if (c1 >= this.gw) c1 = this.gw - 1;
    if (c0 > c1) return false;
    const w0 = c0 >>> 5, w1 = c1 >>> 5, base = r * this.W, b = this.bits;
    for (let w = w0; w <= w1; w++) {
      let m = 0xffffffff;
      if (w === w0) m &= 0xffffffff << (c0 & 31);
      if (w === w1) m &= 0xffffffff >>> (31 - (c1 & 31));
      if (b[base + w] & m) return true;
    }
    return false;
  }
  set(r, c0, c1) {
    if (r < 0 || r >= this.gh) return;
    if (c0 < 0) c0 = 0;
    if (c1 >= this.gw) c1 = this.gw - 1;
    if (c0 > c1) return;
    const w0 = c0 >>> 5, w1 = c1 >>> 5, base = r * this.W;
    for (let w = w0; w <= w1; w++) {
      let m = 0xffffffff;
      if (w === w0) m &= 0xffffffff << (c0 & 31);
      if (w === w1) m &= 0xffffffff >>> (31 - (c1 & 31));
      this.bits[base + w] |= m;
    }
  }
}

/** The cell runs of each grid row whose centre lies inside `poly` (sheet mm), as [row, c0, c1, …]: the outline's own cells, nothing added. */
function insideRuns(poly, ax, ay, C, gh) {
  const [, y0, , y1] = polyBox(poly), out = [];
  const j0 = Math.max(0, Math.ceil((y0 - ay) / C - 0.5)), j1 = Math.min(gh - 1, Math.floor((y1 - ay) / C - 0.5));
  for (let j = j0; j <= j1; j++) {
    const y = ay + (j + 0.5) * C, xs = [];
    for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
      const [xi, yi] = poly[i], [xk, yk] = poly[k];
      if ((yi > y) !== (yk > y)) xs.push(((xk - xi) * (y - yi)) / (yk - yi) + xi);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.ceil((xs[k] - ax) / C - 0.5), c1 = Math.floor((xs[k + 1] - ax) / C - 0.5);
      if (c0 <= c1) out.push(j, c0, c1);
    }
  }
  return out;
}

/** The mask of an outline (its lower-left corner at 0,0 after turning): the cells whose centre is inside it or within `gap` (+ a little) of it. */
function buildMask(poly, gap, C) {
  const R = gap > 0 ? gap + 0.45 * C : 0, pad = Math.ceil(R / C), [, , bx1, by1] = polyBox(poly);
  const nx = Math.ceil(bx1 / C) + 2 * pad + 1, ny = Math.ceil(by1 / C) + 2 * pad + 1, runs = [];
  const segs = poly.map((a, i) => [a, poly[(i + 1) % poly.length]]);
  for (let mj = 0; mj < ny; mj++) {
    const row = mj - pad, y = (row + 0.5) * C;
    const near = R > 0 ? segs.filter(([a, b]) => Math.min(a[1], b[1]) - R <= y && Math.max(a[1], b[1]) + R >= y) : [];
    let c0 = -1;
    for (let mi = 0; mi <= nx; mi++) {
      const col = mi - pad, x = (col + 0.5) * C;
      let hit = false;
      if (mi < nx) {
        hit = inside(poly, x, y);
        if (!hit && R > 0) for (const [a, b] of near) if (segDist(x, y, a, b) <= R) { hit = true; break; }
      }
      if (hit && c0 < 0) c0 = col;
      else if (!hit && c0 >= 0) { runs.push(row, c0, col - 1); c0 = -1; }
    }
  }
  return Int32Array.from(runs);
}

/** The cell size for an area: 1 mm, coarser only when the grid would pass ~400 000 cells. */
export function cellFor(area) {
  let C = 1;
  while ((area.w / C) * (area.h / C) > 400000) C *= 2;
  return C;
}

// ---------------------------------------------------------------- the packer
/**
 * Packs a job piece by piece. A generator: each step places (or fails to place) one piece and yields
 * { done, total, placements } (the placements so far; the same array each time); it returns the result:
 * { placements, placed, total, left: { id: n }, usedArea, areaTotal, usedPct, cell } — usedPct: the area of everything on the usable area
 * (the nested parts and `fixed`) over the usable area, %.
 */
export function* packSteps(job) {
  const { area, items } = job, gap = Math.max(0, +job.gap || 0), rots = ROTATIONS[job.rotations] || ROTATIONS.all;
  const C = job.cell > 0 ? job.cell : cellFor(area);
  const gw = Math.max(0, Math.floor(area.w / C + 1e-9)), gh = Math.max(0, Math.floor(area.h / C + 1e-9)), grid = new Grid(gw, gh);
  const areaTotal = area.w * area.h;
  const placedPolys = [];                                   // { poly (sheet mm), box } of everything on the sheet: fixed parts, then the nested ones
  let usedArea = 0;
  for (const f of job.fixed || []) {
    if (!f || f.length < 3) continue;
    placedPolys.push({ poly: f, box: polyBox(f) });
    for (let k = 0, r = insideRuns(f, area.x, area.y, C, gh); k < r.length; k += 3) grid.set(r[k], r[k + 1], r[k + 2]);
    usedArea += polyArea(f);
  }
  // the pieces, largest first (a stable order: by area, then by the order the parts were given, then by piece number)
  const pieces = [];
  items.forEach((it, n) => {
    const a = it.poly && it.poly.length >= 3 ? polyArea(it.poly) : 0;
    for (let i = 0; i < Math.min(MAX_PIECES, Math.max(0, Math.floor(it.count) || 0)); i++) pieces.push({ it, n, i, a });
  });
  pieces.sort((p, q) => q.a - p.a || p.n - q.n || p.i - q.i);
  const placements = [], left = {}, cache = new Map(), noFit = new Set();
  const total = pieces.length;
  const variant = (it, deg) => {                          // the outline turned and moved to 0,0, with its mask and the shift that undid
    const key = it.id + '|' + deg;
    let v = cache.get(key);
    if (v) return v;
    const t = polyAt(it.poly, deg), [mx, my, Mx, My] = polyBox(t), pts = t.map(([x, y]) => [x - mx, y - my]);
    v = { deg, pts, mx, my, w: Mx - mx, h: My - my, mask: null };
    cache.set(key, v);
    return v;
  };
  let done = 0;
  for (const pc of pieces) {
    const it = pc.it;
    let best = null;
    if (pc.a > 0) {
      for (const deg of rots) {
        const nk = it.id + '|' + deg;
        if (noFit.has(nk)) continue;
        const v = variant(it, deg);
        if (v.w > area.w + EPS || v.h > area.h + EPS) { noFit.add(nk); continue; }
        if (!v.mask) v.mask = buildMask(v.pts, gap, C);
        const maxX = Math.floor((area.w - v.w) / C + 1e-9), maxY = Math.floor((area.h - v.h) / C + 1e-9), runs = v.mask;
        let found = null, cut = false;
        scan: for (let oy = 0; oy <= maxY; oy++) {
          if (best && oy > best.oy) { cut = true; break; }
          for (let ox = 0; ox <= maxX; ox++) {
            if (best && oy === best.oy && ox >= best.ox) { cut = true; break scan; }
            let ok = true;
            for (let k = 0; k < runs.length; k += 3) if (grid.any(oy + runs[k], ox + runs[k + 1], ox + runs[k + 2])) { ok = false; break; }
            if (!ok) continue;
            const X = area.x + ox * C, Y = area.y + oy * C, abs = v.pts.map(([x, y]) => [x + X, y + Y]), box = polyBox(abs);
            if (!placedPolys.every((q) => clear(abs, q.poly, gap))) continue;
            found = { ox, oy, abs, box };
            break scan;
          }
        }
        if (found) { if (!best || found.oy < best.oy || (found.oy === best.oy && found.ox < best.ox)) best = { ...found, v }; }
        else if (!cut) noFit.add(nk);
      }
    }
    if (best) {
      const X = area.x + best.ox * C, Y = area.y + best.oy * C;
      placements.push({ partId: it.id, i: pc.i, rot: best.v.deg, x: X - best.v.mx, y: Y - best.v.my });
      placedPolys.push({ poly: best.abs, box: best.box });
      for (let k = 0, r = insideRuns(best.abs, area.x, area.y, C, gh); k < r.length; k += 3) grid.set(r[k], r[k + 1], r[k + 2]);
      usedArea += pc.a;
    } else left[it.id] = (left[it.id] || 0) + 1;
    done++;
    yield { done, total, placements };
  }
  return { placements, placed: placements.length, total, left, usedArea, areaTotal, usedPct: areaTotal > 0 ? (usedArea / areaTotal) * 100 : 0, cell: C };
}

/** The whole job at once: packSteps run to the end. */
export function pack(job) {
  const g = packSteps(job);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/**
 * The result of a run that was stopped part-way: `placements` is what was placed so far, the rest of the pieces are left over.
 * Same shape as pack()'s result (plus stopped: true).
 */
export function summary(job, placements) {
  const area = job.area, left = {};
  let total = 0, usedArea = 0;
  for (const f of job.fixed || []) if (f && f.length >= 3) usedArea += polyArea(f);
  const placedOf = {};
  for (const p of placements) placedOf[p.partId] = (placedOf[p.partId] || 0) + 1;
  for (const it of job.items) {
    const want = Math.min(MAX_PIECES, Math.max(0, Math.floor(it.count) || 0)), got = placedOf[it.id] || 0;
    total += want;
    if (want > got) left[it.id] = want - got;
    usedArea += got * (it.poly && it.poly.length >= 3 ? polyArea(it.poly) : 0);
  }
  const areaTotal = area.w * area.h;
  return { placements, placed: placements.length, total, left, usedArea, areaTotal, usedPct: areaTotal > 0 ? (usedArea / areaTotal) * 100 : 0, cell: job.cell > 0 ? job.cell : cellFor(area), stopped: true };
}
