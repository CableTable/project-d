// contour.js — pure: Contour (TODO 35): offset a closed outline of lines and arcs inward or outward, in steps, with sharp or rounded
// corners (no DOM) — contour.test.mjs.
//
// An outline is a loop of segments { p0: [x, y], p1: [x, y], b }: from p0 to p1, b = the bulge (tan of a quarter of the sweep; 0 for a
// line, > 0 turning anticlockwise, < 0 clockwise), as in an LWPOLYLINE. Everything is in one unit (drawing units); y is up.
//
//   segmentsFromItems(ed, ents)   the lines and arcs the entities draw, as segments
//   buildLoops(segs, tol)         joins them end to end into closed loops (and counts what stays open)
//   offsetLoop(loop, t, opts)     one loop moved by t (+ outward, − inward), or why not
//   contour(loops, opts)          all the loops, `steps` times: { steps: [[loop, …], …], made, stopped, dropped }
//   toEntities(loop, layer)       dxf-write entities (LINE, ARC, or one CIRCLE) for a loop
//
// How a corner is made: where the offset pieces would leave a gap (the outside of a turn) a sharp corner extends both to meet (a miter,
// flattened when it would be longer than 4 × the distance, i.e. under about 29°) and a rounded one adds an arc of radius d about the
// original corner; where they overlap they are cut at their crossing. A step that would close the outline up (a piece turned round or
// gone) is not made. KNOWN LIMIT: a concave outline whose offset runs into itself (a narrow notch or neck, a thin leg collapsing
// before the rest) is not split into several outlines: such a step is refused, or comes out crossing itself.
import { mapply } from './drawing.js';
import { line, arc, circle } from './dxf-write.js';

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
export function segmentsFromItems(ed, ents, skip = () => false) {
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
        else if (op === 1) { const q = P(ops[k + 1], ops[k + 2]); if (cur && dist(cur, q) > 1e-12) out.push(seg(cur, q)); cur = q; if (!start) start = q; k += 3; }
        else if (op === 2) {
          const [cx, cy, r, a0, a1] = [ops[k + 1], ops[k + 2], ops[k + 3], ops[k + 4], ops[k + 5]], sw = arcSweepOp(a0, a1, ops[k + 6] === 1);
          const n = Math.max(1, Math.ceil(Math.abs(sw) / (TAU / 3) - 1e-9)), at = (a) => P(cx + r * Math.cos(a), cy + r * Math.sin(a));
          let S = at(a0);
          if (cur && dist(cur, S) > 1e-9) out.push(seg(cur, S));
          if (!start) start = S;
          for (let j = 0; j < n; j++) {
            const E = at(a0 + sw * (j + 1) / n), M = at(a0 + sw * (j + 0.5) / n);
            if (dist(S, E) > 1e-12) out.push(seg(S, E, bulgeOf3(S, M, E)));   // an arc with no radius or no sweep adds nothing
            S = E;
          }
          cur = S; k += 7;
        } else { if (cur && start && dist(cur, start) > 1e-12) out.push(seg(cur, start)); cur = start; k++; }
      }
    }
  }
  return out;
}

/**
 * Joins segments end to end (ends within tol) into closed loops. → { loops: [[seg, …]], open: number of segments in pieces that did not close }.
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
  const loops = [];
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
    } else open += path.length;
  }
  return { loops, open };
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
  const rounded = opts.corners === 'rounded', limit = opts.miter || MITER_LIMIT, area0 = loopArea(loop), size = loop.reduce((m, s) => Math.max(m, dist(s.p0, s.p1)), Math.max(Math.abs(t), 1e-9));   // not Math.max(...): a dense loop overflows the stack
  const tolJ = 1e-9 * size + 1e-12;
  // 1. every segment moved; an arc that runs out of radius is gone (its place is kept as a corner about its centre)
  const pieces = [];
  loop.forEach((s) => {
    const o = offsetSeg(s, t);
    if (o) pieces.push({ ...o, src: s });
    else pieces.push({ gone: true, c: arcOf(s).c, src: s });
  });
  const live = pieces.filter((p) => !p.gone);
  if (live.length < 2 && !(live.length === 1 && live[0].b && Math.abs(sweepOf(live[0])) > 0)) return { ok: false, why: 'it would close up' };
  // the pieces in order, each with the original corner that follows it (the centre of a gone arc between two pieces stands in for it)
  const ring = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.gone) continue;
    let V = p.src.p1, j = (i + 1) % pieces.length;
    while (pieces[j].gone && j !== i) { V = pieces[j].c; j = (j + 1) % pieces.length; }
    ring.push({ ...p, V });
  }
  const n = ring.length, joins = new Array(n);
  // 2. the corner after each piece
  for (let i = 0; i < n; i++) {
    const A = ring[i], B = ring[(i + 1) % n], ua = endTan(A), ub = startTan(B), cr = crs(ua, ub), dt = dot(ua, ub);
    const P = A.p1, Q = B.p0;
    if (Math.abs(cr) <= 2e-5 && dt > 0 && dist(P, Q) <= 1e-6 * size + 3e-5 * Math.abs(t)) { joins[i] = { kind: 'cont', X: mul(add(P, Q), 0.5) }; continue; }     // smooth: a file keeps 6 decimals
    const gap = cr * t > 1e-12 || (Math.abs(cr) <= 1e-12 && dt < 0);
    const mid = mul(add(P, Q), 0.5);
    const cands = carriersCross(A, B).sort((p, q) => dist(p, mid) - dist(q, mid));
    if (!gap) {                                                                            // the offsets overlap: cut where they cross
      if (!cands.length) { joins[i] = { kind: 'bevel', P, Q }; continue; }
      joins[i] = { kind: 'cut', X: cands[0] };
      continue;
    }
    if (rounded || !cands.length) {
      const phi = Math.atan2(cr, dt);
      joins[i] = rounded && Math.abs(phi) > 1e-9 ? { kind: 'round', P, Q, b: Math.tan(phi / 4) } : { kind: 'bevel', P, Q };
      continue;
    }
    const X = cands[0], eA = grow(A, X, true), eB = grow(B, X, false);
    joins[i] = eA >= -tolJ && eB >= -tolJ && dist(X, A.V) <= limit * Math.abs(t) ? { kind: 'miter', X } : { kind: 'bevel', P, Q };
  }
  // 3. each piece with its ends moved to its corners; the pieces for round and bevel corners between
  const out = [];
  for (let i = 0; i < n; i++) {
    let s = { p0: ring[i].p0, p1: ring[i].p1, b: ring[i].b };
    const jin = joins[(i + n - 1) % n], jout = joins[i], orig = s;
    let ext = 0;
    if (jin.X) ext += grow(orig, jin.X, false);
    if (jout.X) ext += grow(orig, jout.X, true);
    if (extent(orig) + ext <= tolJ * 10) return { ok: false, why: 'it would close up' };            // a piece gone or turned round
    if (jin.X) s = { ...s, p0: jin.X };
    if (jout.X) s = { ...s, p1: jout.X };
    if (orig.b) s.b = Math.sign(orig.b) * Math.tan((extent(orig) + ext) / 4);
    out.push(s);
    if (jout.kind === 'round') out.push({ p0: jout.P, p1: jout.Q, b: jout.b });
    else if (jout.kind === 'bevel') out.push({ p0: jout.P, p1: jout.Q, b: 0 });
  }
  // the pieces meet: each starts where the one before ends
  for (let i = 0; i < out.length; i++) {
    const prev = out[(i + out.length - 1) % out.length];
    if (dist(prev.p1, out[i].p0) > 1e-6 * size) return { ok: false, why: 'it could not be joined' };
    out[i] = { ...out[i], p0: prev.p1 };
  }
  const area = loopArea(out);
  if (!(area > 0) || (t < 0 && area >= area0) || (t > 0 && area <= area0)) return { ok: false, why: 'it would close up' };
  return { ok: true, loop: out.filter((s) => dist(s.p0, s.p1) > 1e-12 || s.b) };
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
 * opts: { dist (> 0), steps (≥ 1), outward (bool), corners ('sharp' | 'rounded') }.
 * → { steps: [[loop, …], …] (the steps that could be made), made, stopped: null | { step, why }, dropped } — dropped: holes that closed up.
 */
export function contour(loops, opts) {
  const { dist: d, steps: n, outward, corners } = opts;
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
    if (!step.length) { res.stopped = { step: k, why: 'it would close up' }; return res; }
    res.steps.push(step); res.made += step.length;
  }
  return res;
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
