// Extend (EX): a line's, arc's or open polyline's picked end moved on to the nearest boundary ahead, the other end fixed; pure: extend.test.mjs.
// Drawing units, y up. Boundaries are any shapes modify.js pathOf takes (line, arc, circle, polyline with bulges).
import { shapeOf } from './grips.js';
import { pathOf, segInter, geo, rebuilt, canModify } from './modify.js';

const TAU = Math.PI * 2, DEG = 180 / Math.PI;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The nearest point where the ray from `end` (direction from → end) meets a boundary shape, beyond `end`; null when none. */
export function rayHit(from, end, shapes) {
  const len = dist(from, end);
  if (len < 1e-9) return null;
  const segs = shapes.flatMap((sh) => pathOf(sh).segs).filter((s) => dist(s.a, s.b) >= 1e-9);
  // a ray long enough to pass every boundary: the farthest a segment can reach from `end`
  const reach = 1 + Math.max(0, ...segs.map((s) => { const g = geo(s); return dist(end, s.a) + (g.line ? g.len : 2 * g.r); }));
  const ray = { a: end, b: [end[0] + (end[0] - from[0]) / len * reach, end[1] + (end[1] - from[1]) / len * reach], bulge: 0 };
  let best = null, bd = Infinity;
  for (const s of segs) for (const h of segInter(ray, s)) {
    const d = dist(end, h.p);
    if (d > 1e-9 * (1 + len) && d < bd) { bd = d; best = h.p; }
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
    for (const cs of circle) for (const h of segInter(cs, bs)) {
      let d = ((Math.atan2(h.p[1] - g.c[1], h.p[0] - g.c[0]) - from) * dir) % TAU;
      if (d < 0) d += TAU;
      if (d > 1e-9 && d < gap - 1e-9 && (best == null || d < best)) best = d;
    }
  }
  return best;
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

/** A line, arc or open polyline extended at the end nearest `pick` to the nearest boundary (entities) ahead: { ent } | { error }. */
export function extendEntity(ent, edges, pick) {
  const type = ent && ent.type;
  if (!ent || !['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE'].includes(type) || !canModify(ent)) return { error: 'Extend takes lines, arcs and open polylines' };
  const sh = shapeOf(ent, 1), none = { error: 'No boundary ahead of that end: nothing changed' };
  if (sh.closed || pathOf(sh).closed) return { error: "Can't extend a closed shape" };
  const shapes = edges.filter((e) => e !== ent && canModify(e)).map((e) => shapeOf(e, 1));
  if (type === 'LWPOLYLINE') { const e = sh.pts.length > 1 && extendPoly(ent, sh, pick, shapes); return e ? { ent: e } : none; }
  if (type === 'ARC') {
    const g = { c: sh.c, r: sh.r, a0: sh.a0 / DEG, sw: ((((sh.a1 - sh.a0) % 360) + 360) % 360) / DEG }, atEnd = dist(pick, onCircle(g, g.a0 + g.sw)) <= dist(pick, onCircle(g, g.a0));
    const d = arcGrowth(g, atEnd, shapes);
    const wrap = (a) => ((a % 360) + 360) % 360;
    return d == null ? none : { ent: rebuilt(atEnd ? { ...sh, a1: wrap(sh.a1 + d * DEG) } : { ...sh, a0: wrap(sh.a0 - d * DEG) }, ent) };
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
    if (!canModify(ent)) return;
    const at = hit(pathOf(shapeOf(ent, 1)).segs);
    if (!at) return;
    const r = extendEntity(ent, boundaries, at);
    if (r.ent) changed.push({ i, ents: [r.ent] }); else skipped++;
  });
  return { changed, skipped };
}
