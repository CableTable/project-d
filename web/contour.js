// contour.js — pure: Contour (TODO 35, 289): offset closed outlines or outline open chains, in steps, with sharp or rounded
// corners (no DOM) — contour.test.mjs.
//
// An outline is a loop of segments { p0: [x, y], p1: [x, y], b }: from p0 to p1, b = the bulge (tan of a quarter of the sweep; 0 for a
// line, > 0 turning anticlockwise, < 0 clockwise), as in an LWPOLYLINE. Everything is in one unit (drawing units); y is up.
//
//   segmentsFromItems(ed, ents, skip, tol)   the lines and arcs the entities draw, omitting pieces shorter than the joining tolerance
//   buildLoops(segs, tol)         joins them into closed loops and open chains (also counts the open pieces)
//   offsetLoop(loop, t, opts)     one loop moved by t (+ outward, − inward), or why not
//   contour(loops, opts)          all the loops, `steps` times: { steps: [[loop, …], …], made, stopped, dropped }
//   toEntities(loop, layer)       dxf-write entities (LINE, ARC, or one CIRCLE) for a loop
//
// How a corner is made: where the offset pieces would leave a gap (the outside of a turn) a sharp corner extends both to meet (a miter,
// flattened when it would be longer than 4 × the distance, i.e. under about 29°) and a rounded one adds an arc of radius d about the
// original corner; where they overlap they are cut at their crossing. A step that would close the outline up (a piece turned round or
// gone) is not made. A piece the offset eats (a short piece on a concave stretch tighter than the distance) is dropped, the most eaten first.
// KNOWN LIMIT: a concave outline whose offset runs into itself (a narrow notch or neck, a thin leg collapsing before the rest) is not split
// into several outlines: such a step is refused (a closed loop whose result crosses itself is refused too).
// An open line's outline whose two sides overlap (a C or tight U) is united (polygon-clipping) into an outer ring plus its holes, as straight pieces
// (arcs sampled, chord gap at most 1% of the distance); one that does not cross keeps its lines and arcs.
import { mapply } from './drawing.js';
import { line, arc, circle } from './dxf-write.js';
import { chainAt, DIM_LAYER } from './edit.js';
import pc from './vendor/polygon-clipping/polygon-clipping.js';

const TAU = Math.PI * 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const crs = (a, b) => a[0] * b[1] - a[1] * b[0];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = len(a); return l ? [a[0] / l, a[1] / l] : [1, 0]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const wrapPi = (a) => { let r = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; if (r === -Math.PI) r = Math.PI; return r; };
const mod2pi = (a) => ((a % TAU) + TAU) % TAU;

export const MITER_LIMIT = 4;

/** Whether a selected piece belongs to a larger closed chain. */
export function partialOutline(ed, sel, tol) {
  const seen = new Set();
  for (const e of sel) {
    if (seen.has(e)) continue;
    const chain = chainAt(ed, e, tol);
    for (const c of chain) seen.add(c);
    if (chain.every((c) => sel.has(c))) continue;
    const an = buildLoops(segmentsFromItems(ed, chain, (e) => e.layer === DIM_LAYER || e.type === 'DIMENSION', tol), tol);
    if (an.loops.length && !an.open) return true;
  }
  return false;
}

// ---------------------------------------------------------------- segments

export const seg = (p0, p1, b = 0) => ({ p0, p1, b });

/** A segment's arc: { c (centre), r, a0 (start angle), sweep (signed, radians) }, or null for a line. */
export function arcOf(s) {
  if (!s.b) return null;
  const sweep = 4 * Math.atan(s.b), chord = dist(s.p0, s.p1);
  const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
  const u = unit(sub(s.p1, s.p0)), nl = [-u[1], u[0]], mid = mul(add(s.p0, s.p1), 0.5);
  const c = add(mid, mul(nl, Math.sign(sweep) * r * Math.cos(Math.abs(sweep) / 2)));
  return { c, r, a0: Math.atan2(s.p0[1] - c[1], s.p0[0] - c[0]), sweep };
}

/** The bulge of the arc through three points in order (start, a point on it, end); 0 when they are in a line. */
export function bulgeOf3(S, M, E) {
  const cr = crs(sub(M, S), sub(E, M)), scale = Math.max(dist(S, M), dist(M, E), 1e-12);
  if (Math.abs(cr) < 1e-10 * scale * scale) return 0;
  const ax = S[0], ay = S[1], bx = M[0], by = M[1], cx = E[0], cy = E[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const aS = Math.atan2(ay - uy, ax - ux), aE = Math.atan2(cy - uy, cx - ux);
  const sweep = cr > 0 ? mod2pi(aE - aS) : -mod2pi(aS - aE);
  return Math.tan(sweep / 4);
}

const sweepOf = (s) => (s.b ? 4 * Math.atan(s.b) : 0);
const reverseSeg = (s) => ({ p0: s.p1, p1: s.p0, b: -s.b });

/** The signed area of a loop (anticlockwise positive), arcs included. */
export function loopArea(loop) {
  let a = 0;
  for (const s of loop) {
    a += (s.p0[0] * s.p1[1] - s.p1[0] * s.p0[1]) / 2;
    if (s.b) { const A = arcOf(s), th = A.sweep; a += A.r * A.r * (th - Math.sin(th)) / 2; }         // the bulge over the chord
  }
  return a;
}

/** The loop turned round (same shape, the other way about). */
export const reverseLoop = (loop) => loop.slice().reverse().map(reverseSeg);

function arcSweepOp(a0, a1, acw) {
  let d = a1 - a0;
  if (!acw) { if (d >= TAU) return TAU; d %= TAU; if (d < 0) d += TAU; } else { if (-d >= TAU) return -TAU; d %= TAU; if (d > 0) d -= TAU; }
  return d;
}

/**
 * The lines and arcs the entities `ents` draw (ed: edit.js makeIndex's result; drawing units, y up), as segments. A closed path gets its closing
 * segment; an arc is cut into pieces of at most 120° so three points always describe it. Kept dimensions and text are left out.
 */
export function segmentsFromItems(ed, ents, skip = () => false, tol = 1e-4) {
  const { fl, items, raw } = ed, out = [];
  for (const e of ents) {
    if (!ed.byEnt[e] || skip(raw.entities[e])) continue;
    for (const i of ed.byEnt[e]) {
      const it = items[i];
      if (it.k !== 'p' || it.fill) continue;
      const m = fl.mats[it.m], ops = it.ops, P = (x, y) => mapply(m, x, y);
      let cur = null, start = null;
      for (let k = 0; k < ops.length;) {
        const op = ops[k];
        if (op === 0) { cur = P(ops[k + 1], ops[k + 2]); start = cur; k += 3; }
        else if (op === 1) {
          const q = P(ops[k + 1], ops[k + 2]);
          if (!cur || dist(cur, q) >= tol) { if (cur) out.push(seg(cur, q)); cur = q; }
          if (!start) start = q;
          k += 3;
        }
        else if (op === 2) {
          const [cx, cy, r, a0, a1] = [ops[k + 1], ops[k + 2], ops[k + 3], ops[k + 4], ops[k + 5]], sw = arcSweepOp(a0, a1, ops[k + 6] === 1);
          const n = Math.max(1, Math.ceil(Math.abs(sw) / (TAU / 3) - 1e-9)), at = (a) => P(cx + r * Math.cos(a), cy + r * Math.sin(a));
          const S = at(a0);
          if (!cur || dist(cur, S) >= tol) { if (cur) out.push(seg(cur, S)); cur = S; }
          if (!start) start = cur;
          for (let j = 0; j < n; j++) {
            const E = at(a0 + sw * (j + 1) / n), M = at(a0 + sw * (j + 0.5) / n);
            if (dist(cur, E) >= tol) { out.push(seg(cur, E, bulgeOf3(cur, M, E))); cur = E; }
          }
          k += 7;
        } else {
          if (cur && start && dist(cur, start) >= tol) out.push(seg(cur, start));
          else if (out.length && out[out.length - 1].p1 === cur) out[out.length - 1].p1 = start;
          cur = start; k++;
        }
      }
    }
  }
  return out;
}

/**
 * Joins segments end to end (ends within tol). → { loops, chains: open paths, open: number of open segments }.
 * Every loop is turned anticlockwise (loopArea > 0).
 */
export function buildLoops(segs, tol = 1e-6) {
  const cell = Math.max(tol, 1e-12), key = (cx, cy) => cx + ',' + cy;
  const grid = new Map();
  const put = (p, id) => { const k = key(Math.round(p[0] / cell), Math.round(p[1] / cell)); const l = grid.get(k); if (l) l.push(id); else grid.set(k, [id]); };
  segs.forEach((s, i) => { put(s.p0, i * 2); put(s.p1, i * 2 + 1); });
  const used = new Array(segs.length).fill(false);
  const near = (p) => {                                                     // ids of the unused ends within tol of p (id >> 1 the segment, id & 1 which end)
    const out = [], cx = Math.round(p[0] / cell), cy = Math.round(p[1] / cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const id of grid.get(key(cx + i, cy + j)) || []) {
      const q = id & 1 ? segs[id >> 1].p1 : segs[id >> 1].p0;
      if (!used[id >> 1] && dist(p, q) <= tol) out.push(id);
    }
    return out;
  };
  const loops = [], chains = [];
  let open = 0;
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const path = [segs[i]];
    for (let guard = 0; guard < segs.length + 2; guard++) {
      if (path.length >= 2 && dist(path[path.length - 1].p1, path[0].p0) <= tol) break;
      const tail = near(path[path.length - 1].p1);
      if (tail.length) { const id = tail[0], q = segs[id >> 1]; used[id >> 1] = true; path.push(id & 1 ? reverseSeg(q) : q); continue; }
      const head = near(path[0].p0);                                       // stuck at the end: grow it from the other end
      if (head.length) { const id = head[0], q = segs[id >> 1]; used[id >> 1] = true; path.unshift(id & 1 ? q : reverseSeg(q)); continue; }
      break;
    }
    if (path.length >= 2 && dist(path[path.length - 1].p1, path[0].p0) <= tol) {
      const fixed = path.map((q) => ({ p0: q.p0, p1: q.p1, b: q.b }));              // the joints exactly: each starts where the one before ends
      for (let k = 0; k < fixed.length; k++) fixed[k].p0 = fixed[(k + fixed.length - 1) % fixed.length].p1;
      const area = loopArea(fixed);
      if (Math.abs(area) > 1e-12) loops.push(area < 0 ? reverseLoop(fixed) : fixed);
    } else {
      open += path.length;
      chains.push(path.map((s, k) => ({ ...s, p0: k ? path[k - 1].p1 : s.p0 })));
    }
  }
  return { loops, open, chains };
}

// ---------------------------------------------------------------- offset

/** One segment moved by t to the right of its direction (outward for an anticlockwise loop); null when an arc's radius runs out. */
function offsetSeg(s, t) {
  if (!s.b) {
    const u = unit(sub(s.p1, s.p0)), n = [u[1], -u[0]];
    return { p0: add(s.p0, mul(n, t)), p1: add(s.p1, mul(n, t)), b: 0 };
  }
  const A = arcOf(s), r2 = A.sweep > 0 ? A.r + t : A.r - t;
  if (r2 <= 1e-9 * Math.max(1, A.r)) return null;
  const k = r2 / A.r;
  return { p0: add(A.c, mul(sub(s.p0, A.c), k)), p1: add(A.c, mul(sub(s.p1, A.c), k)), b: s.b };
}

const startTan = (s) => { if (!s.b) return unit(sub(s.p1, s.p0)); const A = arcOf(s), v = unit(sub(s.p0, A.c)); return A.sweep > 0 ? [-v[1], v[0]] : [v[1], -v[0]]; };
const endTan = (s) => { if (!s.b) return unit(sub(s.p1, s.p0)); const A = arcOf(s), v = unit(sub(s.p1, A.c)); return A.sweep > 0 ? [-v[1], v[0]] : [v[1], -v[0]]; };

/** Where two segments' carriers (their lines, or the circles of their arcs) cross: [[x, y], …]. */
function carriersCross(a, b) {
  const A = arcOf(a), B = arcOf(b);
  if (!A && !B) {
    const u = sub(a.p1, a.p0), v = sub(b.p1, b.p0), d = crs(u, v);
    if (Math.abs(d) < 1e-12 * len(u) * len(v)) return [];
    const k = crs(sub(b.p0, a.p0), v) / d;
    return [add(a.p0, mul(u, k))];
  }
  if (A && B) {
    const d = dist(A.c, B.c);
    if (d < 1e-12 || d > A.r + B.r + 1e-9 || d < Math.abs(A.r - B.r) - 1e-9) return [];
    const x = (d * d + A.r * A.r - B.r * B.r) / (2 * d), h = Math.sqrt(Math.max(0, A.r * A.r - x * x)), e = unit(sub(B.c, A.c)), n = [-e[1], e[0]];
    const base = add(A.c, mul(e, x));
    return h < 1e-12 ? [base] : [add(base, mul(n, h)), add(base, mul(n, -h))];
  }
  const L = A ? b : a, C = A || B, u = unit(sub(L.p1, L.p0)), f = sub(L.p0, C.c);
  const bq = dot(f, u), cq = dot(f, f) - C.r * C.r, disc = bq * bq - cq;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc), ts = sq < 1e-12 ? [-bq] : [-bq - sq, -bq + sq];
  return ts.map((k) => add(L.p0, mul(u, k)));
}

/** How far a segment grows (+) or shrinks (−) at its end (end = true) or start when that end moves to point X (X on its carrier). */
function grow(s, X, end) {
  if (!s.b) { const u = unit(sub(s.p1, s.p0)); return end ? dot(sub(X, s.p1), u) : dot(sub(s.p0, X), u); }
  const A = arcOf(s), sg = Math.sign(A.sweep), ang = (p) => Math.atan2(p[1] - A.c[1], p[0] - A.c[0]);
  return end ? sg * wrapPi(ang(X) - ang(s.p1)) : sg * wrapPi(ang(s.p0) - ang(X));
}
const extent = (s) => (s.b ? Math.abs(sweepOf(s)) : dist(s.p0, s.p1));

/**
 * One loop (anticlockwise: loopArea > 0) moved by t (t > 0 outward, t < 0 inward).
 * opts: { corners: 'sharp' | 'rounded' }. → { ok: true, loop } or { ok: false, why }.
 */
export function offsetLoop(loop, t, opts = {}) {
  const open = opts.open;
  const rounded = opts.corners === 'rounded', limit = opts.miter || MITER_LIMIT, area0 = loopArea(loop), size = loop.reduce((m, s) => Math.max(m, dist(s.p0, s.p1)), Math.max(Math.abs(t), 1e-9));   // not Math.max(...): a dense loop overflows the stack
  const tolJ = 1e-9 * size + 1e-12;
  const inLine = (a, b) => {
    if (!a || a.b || b.b) return false;
    const ua = endTan(a), ub = startTan(b);
    const tol = 1e-6 * size + 3e-5 * Math.abs(t), w = sub(b.p1, a.p0), off = Math.abs(crs(w, sub(a.p1, a.p0))) / (Math.hypot(w[0], w[1]) || 1);   // the dropped point must lie on the merged line
    return Math.abs(crs(ua, ub)) <= 2e-5 && dot(ua, ub) > 0 && dist(a.p1, b.p0) <= tol && off <= tol;
  };
  const joined = [];
  for (const s of loop) {
    const prev = joined[joined.length - 1];
    if (inLine(prev, s)) joined[joined.length - 1] = seg(prev.p0, s.p1);
    else joined.push(s);
  }
  if (!open && joined.length > 1 && inLine(joined[joined.length - 1], joined[0])) {
    joined[0] = seg(joined.pop().p0, joined[0].p1);
  }
  // 1. every segment moved; an arc that runs out of radius is gone (its place is kept as a corner about its centre)
  const pieces = [];
  joined.forEach((s) => {
    const o = offsetSeg(s, t);
    if (o) pieces.push({ ...o, src: s });
    else pieces.push({ gone: true, c: arcOf(s).c, src: s });
  });
  const live = pieces.filter((p) => !p.gone);
  if ((open && live.length !== pieces.length) || (!open && live.length < 2 && !(live.length === 1 && live[0].b && Math.abs(sweepOf(live[0])) > 0))) return { ok: false, why: 'it would close up' };
  // the pieces in order, each with the original corner that follows it (the centre of a gone arc between two pieces stands in for it)
  let ring = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.gone) continue;
    let V = p.src.p1, j = (i + 1) % pieces.length;
    while (pieces[j].gone && j !== i) { V = pieces[j].c; j = (j + 1) % pieces.length; }
    ring.push({ ...p, V });
  }
  let n = ring.length;
  const last = n - 1, alive = ring.map(() => true), nx = ring.map((_, i) => (i + 1) % n);   // while pieces are dropped a piece keeps its index; nx / pv link the live ones
  let pv = ring.map((_, i) => (i + n - 1) % n);
  // 2. the corner after each piece
  const corner = (i, round) => {
    if (open && i === last) return { kind: 'end' };
    const A = ring[i], B = ring[nx[i]], ua = endTan(A), ub = startTan(B), cr = crs(ua, ub), dt = dot(ua, ub);
    const P = A.p1, Q = B.p0;
    if (Math.abs(cr) <= 2e-5 && dt > 0 && dist(P, Q) <= 1e-6 * size + 3e-5 * Math.abs(t)) return { kind: 'cont', X: mul(add(P, Q), 0.5) };     // smooth: a file keeps 6 decimals
    const gap = cr * t > 1e-12 || (Math.abs(cr) <= 1e-12 && dt < 0);
    const mid = mul(add(P, Q), 0.5);
    const cands = carriersCross(A, B).sort((p, q) => dist(p, mid) - dist(q, mid));
    if (!gap) {                                                                            // the offsets overlap: cut where they cross
      return cands.length ? { kind: 'cut', X: cands[0] } : { kind: 'bevel', P, Q };
    }
    if (round || !cands.length) {
      const phi = Math.atan2(cr, dt);
      return round && Math.abs(phi) > 1e-9 ? { kind: 'round', P, Q, b: Math.tan(phi / 4) } : { kind: 'bevel', P, Q };
    }
    const X = cands[0], eA = grow(A, X, true), eB = grow(B, X, false);
    return eA >= -tolJ && eB >= -tolJ && dist(X, A.V) <= limit * Math.abs(t) ? { kind: 'miter', X } : { kind: 'bevel', P, Q };
  };
  let joins = ring.map((_, i) => corner(i, rounded));
  const growth = (i) => {
    const s = ring[i], jin = open && i === 0 ? {} : joins[pv[i]], jout = joins[i];
    return (jin.X ? grow(s, jin.X, false) : 0) + (jout.X ? grow(s, jout.X, true) : 0);
  };
  // Retry only the two corners beside a piece lost to rounding, before emitting any neighbours. A piece still eaten (the offset of a short piece
  // on a concave stretch tighter than the distance) is dropped, the most eaten first (the last of equals), and its neighbours meet at their own corner; repeat until none is left.
  // A drop changes only the corners beside it, so a min-heap of [eaten, index, version] is refreshed for the neighbours; outdated entries are skipped.
  const thr = tolJ * 10, ver = ring.map(() => 0), heap = [];
  const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] > b[1]);
  const refresh = (id) => {
    ver[id]++;
    const v = extent(ring[id]) + growth(id);
    if (!(v <= thr)) return;
    let k = heap.push([v, id, ver[id]]) - 1;
    while (k > 0 && before(heap[k], heap[(k - 1) >> 1])) { const q = (k - 1) >> 1; [heap[k], heap[q]] = [heap[q], heap[k]]; k = q; }
  };
  const pop = () => {
    const top = heap[0], end = heap.pop();
    if (heap.length) {
      heap[0] = end;
      for (let k = 0; ;) {
        let m = k; const l = 2 * k + 1, r = l + 1;
        if (l < heap.length && before(heap[l], heap[m])) m = l;
        if (r < heap.length && before(heap[r], heap[m])) m = r;
        if (m === k) break;
        [heap[k], heap[m]] = [heap[m], heap[k]]; k = m;
      }
    }
    return top;
  };
  for (let k = 0; k < n; k++) refresh(k);
  for (;;) {
    while (heap.length && (!alive[heap[0][1]] || heap[0][2] !== ver[heap[0][1]])) pop();
    if (!heap.length) break;
    const i = pop()[1], prev = pv[i], next = nx[i];
    if (joins[prev].kind === 'round' || joins[i].kind === 'round') {
      joins[prev] = corner(prev, false); joins[i] = corner(i, false);
    }
    if (extent(ring[i]) + growth(i) > thr) { refresh(prev); refresh(i); refresh(next); continue; }
    if (n <= 3 || (open && (i === 0 || i === last))) return { ok: false, why: 'it would close up' };                // a triangle losing a side is a sliver: closed up
    ring[prev].V = ring[i].V;
    alive[i] = false; nx[prev] = next; pv[next] = prev; n--;
    joins[prev] = corner(prev, rounded);
    refresh(prev); refresh(next);
  }
  if (n < alive.length) {
    ring = ring.filter((_, k) => alive[k]); joins = joins.filter((_, k) => alive[k]);
    pv = ring.map((_, i) => (i + n - 1) % n);
  }
  // 3. each piece with its ends moved to its corners; the pieces for round and bevel corners between
  const out = [];
  for (let i = 0; i < n; i++) {
    let s = { p0: ring[i].p0, p1: ring[i].p1, b: ring[i].b };
    const jin = open && i === 0 ? {} : joins[(i + n - 1) % n], jout = joins[i], orig = s;
    const ext = growth(i);
    if (jin.X) s = { ...s, p0: jin.X };
    if (jout.X) s = { ...s, p1: jout.X };
    if (orig.b) s.b = Math.sign(orig.b) * Math.tan((extent(orig) + ext) / 4);
    out.push(s);
    if (jout.kind === 'round') out.push({ p0: jout.P, p1: jout.Q, b: jout.b });
    else if (jout.kind === 'bevel') out.push({ p0: jout.P, p1: jout.Q, b: 0 });
  }
  // the pieces meet: each starts where the one before ends
  for (let i = open ? 1 : 0; i < out.length; i++) {
    const prev = out[(i + out.length - 1) % out.length];
    if (dist(prev.p1, out[i].p0) > 1e-6 * size) return { ok: false, why: 'it could not be joined' };
    out[i] = { ...out[i], p0: prev.p1 };
  }
  if (open) return { ok: true, loop: out.filter((s) => dist(s.p0, s.p1) > 1e-12 || s.b) };
  const area = loopArea(out);
  if (!(area > 0) || (t < 0 && area >= area0) || (t > 0 && area <= area0)) return { ok: false, why: 'it would close up' };
  const res = out.filter((s) => dist(s.p0, s.p1) > 1e-12 || s.b);
  if (selfCrosses(res, 1e-6 * size)) return { ok: false, why: 'it would close up' };
  if (tooClose(res, loop, 0.9 * Math.abs(t))) return { ok: false, why: 'it would close up' };   // a slot or keyway narrower than 2 × t: the walls are eaten
  return { ok: true, loop: res };
}

/** Does any point of `a` lie closer than `r` to the (arc-sampled) edges of `b`? Edges go in a grid of cells r wide (sampled along their length). */
function tooClose(a, b, r) {
  const Q = loopPoints(b, 3), m = Q.length, grid = new Map(), key = (x, y) => (x + 1048576) * 2097152 + (y + 1048576);   // a clash only adds candidates
  for (let i = 0; i < m; i++) {
    const u = Q[i], v = Q[(i + 1) % m], n = Math.ceil(dist(u, v) / r);
    for (let k = 0; k <= n; k++) {
      const q = n ? add(mul(u, 1 - k / n), mul(v, k / n)) : u, id = key(Math.floor(q[0] / r), Math.floor(q[1] / r));
      const cell = grid.get(id);
      if (!cell) grid.set(id, [i]); else if (cell[cell.length - 1] !== i) cell.push(i);
    }
  }
  for (const p of loopPoints(a, 3)) {
    const cx = Math.floor(p[0] / r), cy = Math.floor(p[1] / r), seen = new Set();
    for (let x = cx - 2; x <= cx + 2; x++) for (let y = cy - 2; y <= cy + 2; y++) for (const i of grid.get(key(x, y)) || []) {
      if (seen.has(i)) continue;
      seen.add(i);
      const u = Q[i], v = sub(Q[(i + 1) % m], u), w = sub(p, u), l2 = dot(v, v), k = l2 ? Math.max(0, Math.min(1, dot(w, v) / l2)) : 0;
      if (len(sub(w, mul(v, k))) < r) return true;
    }
  }
  return false;
}

/** Does the loop (arcs sampled) cross itself? Edges are tested by a sweep along x; edges that share a point or only touch (within eps) do not count. */
export function selfCrosses(loop, eps) {
  const pts = loopPoints(loop, 3), m = pts.length;
  const E = pts.map((a, i) => { const b = pts[(i + 1) % m]; return { a, b, lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]), i }; }).sort((p, q) => p.lo - q.lo);
  const side = (p, q, r) => crs(sub(q, p), sub(r, p)) / (dist(p, q) || 1);          // signed distance of r from the line p→q
  const apart = (u, v, r, s) => { const d1 = side(u, v, r), d2 = side(u, v, s); return (d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps); };
  for (let x = 0; x < m; x++) for (let y = x + 1; y < m && E[y].lo <= E[x].hi; y++) {
    const A = E[x], B = E[y], gap = Math.abs(A.i - B.i);
    if (gap === 1 || gap === m - 1) continue;
    if (apart(A.a, A.b, B.a, B.b) && apart(B.a, B.b, A.a, A.b)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- several loops, several steps

/** Is the point inside the loop? (the loop sampled into a polygon) */
function inside(pt, loop) {
  const poly = loopPoints(loop, 5);
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** The loop as points (arcs sampled every `deg` degrees at most), first point not repeated. */
export function loopPoints(loop, deg = 3) {
  const pts = [];
  for (const s of loop) {
    pts.push(s.p0);
    if (s.b) {
      const A = arcOf(s), n = Math.max(1, Math.ceil(Math.abs(A.sweep) / (deg * Math.PI / 180)));
      for (let k = 1; k < n; k++) { const a = A.a0 + A.sweep * k / n; pts.push([A.c[0] + A.r * Math.cos(a), A.c[1] + A.r * Math.sin(a)]); }
    }
  }
  return pts;
}

/**
 * The contour of some closed loops: `steps` outlines, step k moved k × dist from the original (outward or inward), each from the original
 * loops (so rounded corners grow with the step). A loop inside another (a hole) moves the other way, so the shape as a whole grows or shrinks.
 * opts: { dist (> 0), steps (≥ 1), outward (bool), corners ('sharp' | 'rounded'), chains, ends ('butt' | 'round' | 'square') }.
 * → { steps: [[loop, …], …] (the steps that could be made), made, stopped: null | { step, why }, dropped } — dropped: holes that closed up.
 */
export function contour(loops, opts) {
  const { dist: d, steps: n, outward, corners, chains = [], ends = 'round' } = opts;
  const oriented = loops.map((l) => (loopArea(l) < 0 ? reverseLoop(l) : l));
  const depth = oriented.map((l, i) => oriented.reduce((c, m, j) => c + (j !== i && Math.abs(loopArea(m)) > Math.abs(loopArea(l)) && inside(l[0].p0, m) ? 1 : 0), 0));
  const res = { steps: [], made: 0, stopped: null, dropped: 0 };
  const gone = new Set();
  for (let k = 1; k <= n; k++) {
    const step = [];
    for (let i = 0; i < oriented.length; i++) {
      if (gone.has(i)) continue;
      const hole = depth[i] % 2 === 1, t = (outward ? 1 : -1) * (hole ? -1 : 1) * d * k;
      const r = offsetLoop(oriented[i], t, { corners });
      if (r.ok) { step.push(r.loop); continue; }
      if (hole) { gone.add(i); res.dropped++; continue; }
      res.stopped = { step: k, why: r.why };
      return res;
    }
    for (const chain of chains) {
      const r = openOutline(chain, d * k, { corners, ends });
      if (!r.ok) { res.stopped = { step: k, why: r.why }; return res; }
      step.push(...r.loops);
    }
    if (!step.length) { res.stopped = { step: k, why: 'it would close up' }; return res; }
    res.steps.push(step); res.made += step.length;
  }
  return res;
}

/** Both offset sides, joined at the original ends: { ok, loops } (several when the sides overlap and are united: an outer ring and its holes). */
function openOutline(chain, d, opts) {
  const right = offsetLoop(chain, d, { corners: opts.corners, open: true });
  const left = offsetLoop(reverseLoop(chain), d, { corners: opts.corners, open: true });
  if (!right.ok) return right;
  if (!left.ok) return left;
  const cap = (a, b, tangent) => {
    if (opts.ends === 'round') return [seg(a, b, 1)];
    if (opts.ends !== 'square') return [seg(a, b)];
    const u = mul(tangent, d), p = add(a, u), q = add(b, u);
    return [seg(a, p), seg(p, q), seg(q, b)];
  };
  const R = right.loop, L = left.loop;
  const loop = [...R, ...cap(R[R.length - 1].p1, L[0].p0, endTan(chain[chain.length - 1])),
    ...L, ...cap(L[L.length - 1].p1, R[0].p0, mul(startTan(chain[0]), -1))];
  const refused = { ok: false, why: 'it would close up' }, plain = () => (loopArea(loop) > 0 ? { ok: true, loops: [loop] } : refused);
  // The outline as straight pieces (arcs sampled so the chord gap is at most 1% of d), united by polygon-clipping. The ring's own area equals the
  // united area only when the sides do not overlap (a crossing at a sampled point, as in a symmetric C, escapes selfCrosses): then the outline stays as it is.
  // The ring is moved to the origin first (o = its first point): far away, rounding in the clipper and the area sums made a free outline look crossed.
  const o = loop[0].p0, ring = [];
  for (const s of loop) {
    ring.push(sub(s.p0, o));
    if (!s.b) continue;
    const A = arcOf(s), phi = Math.min(Math.PI / 60, 2 * Math.acos(1 - Math.min(1, 0.01 * d / A.r))), n = Math.ceil(Math.abs(A.sweep) / phi);
    for (let k = 1; k < n; k++) { const a = A.a0 + A.sweep * k / n; ring.push(sub([A.c[0] + A.r * Math.cos(a), A.c[1] + A.r * Math.sin(a)], o)); }
  }
  const straight = (pts) => pts.map((p, i) => seg(p, pts[(i + 1) % pts.length]));
  let polys;
  try { polys = pc.union([[[...ring, ring[0]]]]); } catch { return selfCrosses(loop, 1e-6 * d) ? refused : plain(); }   // polygon-clipping can throw on degenerate input
  const rings = polys.map((poly) => poly.map((r) => straight(r.slice(0, -1))));
  const own = Math.abs(loopArea(straight(ring))), united = rings.reduce((a, ls) => a + ls.reduce((b, l) => b + loopArea(l), 0), 0);
  if (Math.abs(united - own) <= 1e-9 * own) return plain();
  const loops = [];
  const back = (l) => l.map((s) => seg(add(s.p0, o), add(s.p1, o)));
  for (const ls of rings) if (loopArea(ls[0]) > 0) loops.push(back(ls[0]), ...ls.slice(1).filter((l) => loopArea(l) < 0).map(back));   // an outer ring runs anticlockwise, a hole clockwise: a ring that does not is dropped
  return loops.length ? { ok: true, loops } : refused;
}

// ---------------------------------------------------------------- into the drawing

const deg = (r) => { const v = r * 180 / Math.PI; return ((v % 360) + 360) % 360; };

/** A loop as dxf-write entities on `layer`: LINEs and ARCs, or one CIRCLE when the loop is a whole circle. */
export function toEntities(loop, layer) {
  const arcs = loop.filter((s) => s.b).map(arcOf);
  if (arcs.length === loop.length && arcs.length) {
    const c0 = arcs[0];
    if (arcs.every((a) => dist(a.c, c0.c) < 1e-6 * Math.max(1, c0.r) && Math.abs(a.r - c0.r) < 1e-6 * Math.max(1, c0.r)) && Math.abs(arcs.reduce((s, a) => s + Math.abs(a.sweep), 0) - TAU) < 1e-6) return [circle(c0.c[0], c0.c[1], c0.r, { layer })];
  }
  return loop.map((s) => {
    if (!s.b) return line(s.p0[0], s.p0[1], s.p1[0], s.p1[1], { layer });
    const A = arcOf(s), a1 = A.a0 + A.sweep;
    return A.sweep > 0 ? arc(A.c[0], A.c[1], A.r, deg(A.a0), deg(a1), { layer }) : arc(A.c[0], A.c[1], A.r, deg(a1), deg(A.a0), { layer });
  });
}
