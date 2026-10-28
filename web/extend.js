// Extend (EX): a line's, arc's, elliptical arc's or open polyline's picked end moved on to the nearest boundary ahead, the other end fixed; pure: extend.test.mjs.
// Drawing units, y up. Boundaries are any shapes modify.js pathOf takes (line, arc, circle, polyline with bulges), plus ellipses and splines (flattened).
import { shapeOf, get, at, withValues } from './grips.js';
import { nurbs } from './drawing.js';
import { pathOf, segInter, geo, rebuilt, canModify, trimEntity } from './modify.js';

const TAU = Math.PI * 2, DEG = 180 / Math.PI;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const wrap = (x) => ((x % TAU) + TAU) % TAU;

// ---------------------------------------------------------------- ellipses and splines: boundaries as flattened polylines, elliptical arcs as targets

/** An ELLIPSE's frame: centre c, major axis m and minor axis n (as drawing.js draws it), start t0 and end t1 (rad, t1 > t0). */
function ellipseOf(ent) {
  const r = ent.r, g = (c, d) => get(r, c) ?? d, mx = g(11, 0), my = g(21, 0), s = g(230, 1) < 0 ? -g(40, 1) : g(40, 1), t0 = g(41, 0);
  let t1 = g(42, TAU); if (t1 <= t0) t1 += TAU;
  return { c: [g(10, 0), g(20, 0)], m: [mx, my], n: [-my * s, mx * s], t0, t1 };
}
const ellAt = (q, t) => [q.c[0] + q.m[0] * Math.cos(t) + q.n[0] * Math.sin(t), q.c[1] + q.m[1] * Math.cos(t) + q.n[1] * Math.sin(t)];

const curves = new WeakMap();
/**
 * An ellipse or spline entity as a flattened polyline shape (drawing units), its stand-in as a boundary; null for anything else.
 * An ellipse keeps its frame as `q` so a hit on it is snapped to the true curve (snapOnto).
 * shortcut: a spline is about max(n*12, 48) chords with no snap, so a hit can stop short of the true curve (a few 1e-5 of its size, more for
 * few control points on a big curve); snap it like an ellipse if a hit must be exact.
 */
export function curveShape(ent) {
  if (!ent || !ent.r || !['ELLIPSE', 'SPLINE'].includes(ent.type)) return null;
  if (curves.has(ent)) return curves.get(ent);
  let sh = null;
  if (ent.type === 'ELLIPSE') {
    const q = ellipseOf(ent), full = q.t1 - q.t0 > TAU - 1e-6, n = Math.max(16, Math.ceil(512 * (q.t1 - q.t0) / TAU));
    sh = { t: 'poly', pts: Array.from({ length: full ? n : n + 1 }, (_, i) => ellAt(q, q.t0 + (q.t1 - q.t0) * i / n)), closed: full, q };
  } else {
    const r = ent.r, cp = [], fit = [], knots = [], w = [];
    r.c.forEach((c, k) => {
      const v = Number(r.v[k]), y = r.c[k + 1] === c + 10 ? Number(r.v[k + 1]) : 0;
      if (c === 10) cp.push([v, y]); else if (c === 11) fit.push([v, y]); else if (c === 40) knots.push(v); else if (c === 41) w.push(v);
    });
    const pts = nurbs(cp, knots, get(r, 71) ?? 3, w, fit);
    if (pts.length > 1) sh = { t: 'poly', pts, closed: ((get(r, 70) ?? 0) & 1) === 1 };
  }
  curves.set(ent, sh);
  return sh;
}
/**
 * A chord hit `p` on shape `sh` moved onto the true curve when `sh` is an ellipse: Newton on the ellipse parameter t until
 * miss(point) = 0 (miss is zero on the line or circle being extended); `p` itself for anything else or when it does not settle nearby.
 */
function snapOnto(sh, p, miss, seg) {
  const q = sh.q, det = q ? q.m[0] * q.n[1] - q.m[1] * q.n[0] : 0;
  if (!det) return p;
  const paramOf = (P) => {
    const x = P[0] - q.c[0], y = P[1] - q.c[1];
    return Math.atan2((q.m[0] * y - q.m[1] * x) / det, (x * q.n[1] - y * q.n[0]) / det);
  };
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a)), h = 1e-6, ta = paramOf(seg.a), span = wrap(paramOf(seg.b) - ta);
  let t = paramOf(p);
  for (let i = 0; i < 8; i++) {
    const f = miss(ellAt(q, t)), df = (miss(ellAt(q, t + h)) - f) / h;
    if (!df) return p;
    t -= f / df;
  }
  const off = wrap(t - ta), e = 1e-9;      // the snap must stay on the hit chord's own stretch of the curve, else it found the far crossing
  return Number.isFinite(t) && (span >= 0 ? off >= -e && off <= span + e : off <= e && off >= span - e) ? ellAt(q, t) : p;
}
/** The shape Extend measures against: a modifiable shape, an ellipse or a spline. */
const boundaryOf = (e) => (canModify(e) ? shapeOf(e, 1) : curveShape(e));
/** Can Extend take this as a boundary (a picked edge, or among "all")? */
export const isBoundary = (e) => !!e && (canModify(e) || !!curveShape(e));
/** Can Extend lengthen this? (A full ellipse is refused inside extendEntity, like a circle.) */
export const extendable = (e) => !!e && (canModify(e) || (e.type === 'ELLIPSE' && !!e.r));

/** The nearest point where the ray from `end` (direction from → end) meets a boundary shape, beyond `end`; null when none. */
export function rayHit(from, end, shapes) {
  const len = dist(from, end);
  if (len < 1e-9) return null;
  const segs = shapes.flatMap((sh) => pathOf(sh).segs.map((s) => ({ ...s, sh }))).filter((s) => dist(s.a, s.b) >= 1e-9);
  // a ray long enough to pass every boundary: the farthest a segment can reach from `end`
  const reach = 1 + Math.max(0, ...segs.map((s) => { const g = geo(s); return dist(end, s.a) + (g.line ? g.len : 2 * g.r); }));
  const u = [(end[0] - from[0]) / len, (end[1] - from[1]) / len], ray = { a: end, b: [end[0] + u[0] * reach, end[1] + u[1] * reach], bulge: 0 };
  let best = null, bd = Infinity, bs = null;
  for (const s of segs) for (const h of segInter(ray, s)) {
    const d = dist(end, h.p);
    if (d > 1e-9 * (1 + len) && d < bd) { bd = d; best = h.p; bs = s; }
  }
  if (best && bs.sh.q) {
    const p = snapOnto(bs.sh, best, (P) => u[0] * (P[1] - end[1]) - u[1] * (P[0] - end[0]), bs);
    if ((p[0] - end[0]) * u[0] + (p[1] - end[1]) * u[1] > 1e-9 * (1 + len)) best = p;          // still ahead of the end
  }
  return best;
}

/**
 * How far (rad) an arc on circle g (centre c, radius r, start a0 rad, signed sweep sw) grows along its own circle at its end (atEnd) or
 * its start, before the first boundary ahead; null when none. Only the gap the arc leaves open counts (it never wraps over itself).
 */
function arcGrowth(g, atEnd, shapes) {
  const dir = Math.sign(g.sw) * (atEnd ? 1 : -1), from = g.a0 + (atEnd ? g.sw : 0), gap = TAU - Math.abs(g.sw);
  const circle = pathOf({ t: 'circle', c: g.c, r: g.r }).segs;
  let best = null;
  for (const sh of shapes) for (const bs of pathOf(sh).segs) {
    if (dist(bs.a, bs.b) < 1e-9) continue;
    const turn = (p) => { const d = ((Math.atan2(p[1] - g.c[1], p[0] - g.c[0]) - from) * dir) % TAU; return d < 0 ? d + TAU : d; };
    for (const cs of circle) for (const h of segInter(cs, bs)) {
      let d = turn(h.p);
      if (sh.q && d > 1e-9 && d < gap - 1e-9 && (best == null || d < best)) d = turn(snapOnto(sh, h.p, (P) => Math.hypot(P[0] - g.c[0], P[1] - g.c[1]) - g.r, bs));
      if (d > 1e-9 && d < gap - 1e-9 && (best == null || d < best)) best = d;
    }
  }
  return best;
}
/**
 * How far (rad of the ellipse's parameter) an elliptical arc grows from parameter `from` in direction dir (+1 / -1), before the first of
 * `segs` ahead, within the gap (rad) it leaves open; null when none. Coarse chords find the first crossing, then two finer passes
 * over just that chord's segments pin it down.
 */
function ellipseGrowth(q, from, dir, gap, segs) {
  let lo = 0, hi = gap, live = segs, best = null;
  for (const n of [256, 64, 64]) {
    const dt = (hi - lo) / n;
    let found = null;
    for (let i = 0; i < n && !found; i++) {
      const ch = { a: ellAt(q, from + dir * (lo + i * dt)), b: ellAt(q, from + dir * (lo + (i + 1) * dt)), bulge: 0 }, hits = [];
      for (const s of live) for (const h of segInter(ch, s)) { const d = lo + (i + h.fs) * dt; if (d > 1e-9 && d < gap - 1e-9) hits.push({ d, s }); }
      if (hits.length) found = { i, hits, d: Math.min(...hits.map((h) => h.d)) };
    }
    if (!found) break;
    best = found.d; lo += found.i * dt; hi = lo + dt; live = found.hits.map((h) => h.s);
  }
  return best;
}
/** An elliptical arc extended at the end nearest `pick`: { ent } | { error }. */
function extendEllipse(ent, shapes, pick) {
  const q = ellipseOf(ent), gap = TAU - (q.t1 - q.t0);
  if (gap < 1e-6) return { error: "Can't extend a closed shape" };
  const atEnd = dist(pick, ellAt(q, q.t1)) <= dist(pick, ellAt(q, q.t0)), k = at(ent.r, atEnd ? 42 : 41);
  const lx = Math.abs(q.m[0]) + Math.abs(q.n[0]) + 1e-6, ly = Math.abs(q.m[1]) + Math.abs(q.n[1]) + 1e-6;      // the ellipse lies inside c ± (|m| + |n|)
  const inBox = (s) => {
    const g = geo(s), [x0, x1, y0, y1] = g.line ? [Math.min(s.a[0], s.b[0]), Math.max(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[1], s.b[1])] : [g.c[0] - g.r, g.c[0] + g.r, g.c[1] - g.r, g.c[1] + g.r];
    return x1 >= q.c[0] - lx && x0 <= q.c[0] + lx && y1 >= q.c[1] - ly && y0 <= q.c[1] + ly;
  };
  const segs = shapes.flatMap((sh) => pathOf(sh).segs).filter((s) => dist(s.a, s.b) >= 1e-9 && inBox(s));
  const d = ellipseGrowth(q, atEnd ? q.t1 : q.t0, atEnd ? 1 : -1, gap, segs);
  if (d == null || k < 0) return { error: 'No boundary ahead of that end: nothing changed' };
  return { ent: withValues(ent, [[k, wrap(atEnd ? q.t1 + d : q.t0 - d)]]) };
}
const onCircle = (g, t) => [g.c[0] + g.r * Math.cos(t), g.c[1] + g.r * Math.sin(t)];

/** An open polyline's picked end segment extended (a straight one along its line, a bulged one along its arc); vertex widths stay. */
function extendPoly(ent, sh, pick, shapes) {
  const pts = sh.pts, n = pts.length, last = dist(pick, pts[n - 1]) <= dist(pick, pts[0]);
  const vi = last ? n - 1 : 0, si = last ? n - 2 : 0, seg = { a: pts[si], b: pts[si + 1], bulge: pts[si][2] || 0 }, g = geo(seg);
  let q, bulge = 0;
  if (g.line) q = rayHit(last ? seg.a : seg.b, last ? seg.b : seg.a, shapes);
  else {
    const d = arcGrowth(g, last, shapes);
    if (d != null) {
      const sw = g.sw + Math.sign(g.sw) * d;
      bulge = Math.tan(sw / 4); q = onCircle(g, last ? g.a0 + sw : g.a0 - Math.sign(g.sw) * d);
    }
  }
  if (!q) return null;
  const out = pts.map((p) => p.slice());
  out[vi] = [q[0], q[1], ...out[vi].slice(2)];
  if (!g.line) out[si] = [out[si][0], out[si][1], bulge, ...out[si].slice(3)];
  return rebuilt({ ...sh, pts: out }, ent);
}

/** A line, arc, elliptical arc or open polyline extended at the end nearest `pick` to the nearest boundary (entities) ahead: { ent } | { error }. */
export function extendEntity(ent, edges, pick) {
  const type = ent && ent.type;
  if (type === 'SPLINE') return { error: 'Splines are not extended yet' };
  if (!extendable(ent) || !['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE', 'ELLIPSE'].includes(type)) return { error: 'Extend takes lines, arcs, elliptical arcs and open polylines' };
  const shapes = edges.filter((e) => e !== ent).map(boundaryOf).filter(Boolean);
  if (type === 'ELLIPSE') return extendEllipse(ent, shapes, pick);
  const sh = shapeOf(ent, 1), none = { error: 'No boundary ahead of that end: nothing changed' };
  if (sh.closed || pathOf(sh).closed) return { error: "Can't extend a closed shape" };
  if (type === 'LWPOLYLINE') { const e = sh.pts.length > 1 && extendPoly(ent, sh, pick, shapes); return e ? { ent: e } : none; }
  if (type === 'ARC') {
    const g = { c: sh.c, r: sh.r, a0: sh.a0 / DEG, sw: ((((sh.a1 - sh.a0) % 360) + 360) % 360) / DEG }, atEnd = dist(pick, onCircle(g, g.a0 + g.sw)) <= dist(pick, onCircle(g, g.a0));
    const d = arcGrowth(g, atEnd, shapes);
    const w = (a) => wrap(a / DEG) * DEG;
    return d == null ? none : { ent: rebuilt(atEnd ? { ...sh, a1: w(sh.a1 + d * DEG) } : { ...sh, a0: w(sh.a0 - d * DEG) }, ent) };
  }
  const moveB = dist(pick, sh.b) <= dist(pick, sh.a);
  const [from, end] = moveB ? [sh.a, sh.b] : [sh.b, sh.a];
  const p = rayHit(from, end, shapes);
  if (!p) return none;
  return { ent: rebuilt(moveB ? { t: 'line', a: sh.a, b: p } : { t: 'line', a: p, b: sh.b }, ent) };
}

/**
 * Quick Extend of many at once: each of `ents` that `hit` (modify.js fenceHit / windowHit) touches is extended, at the end nearest where
 * it was touched, to the nearest of `boundaries`. Returns { changed: [{ i, ents: [the extended one] }], skipped } (skipped = touched
 * but nothing to reach, or a closed shape).
 */
export function extendRegion(ents, boundaries, hit) {
  const changed = [];
  let skipped = 0;
  ents.forEach((ent, i) => {
    if (!extendable(ent)) return;
    const segs = pathOf(boundaryOf(ent)).segs, touched = hit(segs);
    if (!touched) return;
    const ends = [segs[0].a, segs[segs.length - 1].b];
    let r = extendEntity(ent, boundaries, touched);
    if (r.error) r = extendEntity(ent, boundaries, ends[dist(touched, ends[0]) <= dist(touched, ends[1]) ? 1 : 0]);      // nothing ahead at the touched end: try the other
    if (r.ent) changed.push({ i, ents: [r.ent] }); else skipped++;
  });
  return { changed, skipped };
}

/** Just the stretch an extension adds, as an entity, from the entity before (`ent`) and after (`ext`): a line's new tail, an arc's new sweep, a polyline's end segment. */
function addedPiece(ent, ext) {
  if (ent.type === 'ELLIPSE') {
    const grewEnd = Math.abs(get(ent.r, 42) - get(ext.r, 42)) > 1e-12, [k, l] = [at(ent.r, 41), at(ent.r, 42)];
    return withValues(ent, grewEnd ? [[k, get(ent.r, 42)], [l, get(ext.r, 42)]] : [[k, get(ext.r, 41)], [l, get(ent.r, 41)]]);
  }
  const a = shapeOf(ent, 1), b = shapeOf(ext, 1);
  if (a.t === 'line') return rebuilt(dist(a.a, b.a) > 1e-9 ? { t: 'line', a: b.a, b: a.a } : { t: 'line', a: a.b, b: b.b }, ent);
  if (a.t === 'arc') return rebuilt(Math.abs(a.a1 - b.a1) > 1e-9 ? { ...a, a0: a.a1, a1: b.a1 } : { ...a, a0: b.a0, a1: a.a0 }, ent);
  const n = b.pts.length, last = dist(a.pts[n - 1], b.pts[n - 1]) > 1e-9, si = last ? n - 2 : 0, vi = last ? n - 1 : 0;
  if (!b.pts[si][2]) return rebuilt({ t: 'line', a: a.pts[vi], b: b.pts[vi] }, ent);          // a straight end segment: just the new stretch; a bulged one is shown whole
  return rebuilt({ ...b, pts: [b.pts[si], b.pts[si + 1]].map((p) => p.slice(0, 3)), closed: false }, ent);
}

/**
 * What a Quick click at `pick` would do to `ent`, for the hover preview (nothing is changed): { act: 'trim', cut } (the piece that goes),
 * { act: 'extend', add } (the stretch that grows on) or { error }. `extend` is the action wanted (the caller has already swapped it for Shift).
 */
export function previewEdit(ent, edges, pick, extend, quick = true) {
  if (extend) {
    const r = extendEntity(ent, edges, pick);
    return r.error ? r : { act: 'extend', add: addedPiece(ent, r.ent) };
  }
  const r = trimEntity(ent, edges, pick, quick);
  return r.error ? r : { act: 'trim', cut: r.removed };
}
