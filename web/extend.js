// Extend (EX): a line's picked end moved on to the nearest boundary ahead, the other end fixed; pure: extend.test.mjs.
// Drawing units, y up. Boundaries are any shapes modify.js pathOf takes (line, arc, circle, polyline with bulges).
import { shapeOf } from './grips.js';
import { pathOf, segInter, geo, rebuilt, canModify } from './modify.js';

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

/** A line extended at the end nearest `pick` to the nearest boundary (entities) ahead: { ent } | { error }. */
export function extendEntity(ent, edges, pick) {
  if (!ent || ent.type !== 'LINE' || !canModify(ent)) return { error: 'Extend takes lines (arcs and polylines are not built yet)' };
  const sh = shapeOf(ent, 1), moveB = dist(pick, sh.b) <= dist(pick, sh.a);
  const [from, end] = moveB ? [sh.a, sh.b] : [sh.b, sh.a];
  const p = rayHit(from, end, edges.filter((e) => e !== ent && canModify(e)).map((e) => shapeOf(e, 1)));
  if (!p) return { error: 'No boundary ahead of that end: nothing changed' };
  return { ent: rebuilt(moveB ? { t: 'line', a: sh.a, b: p } : { t: 'line', a: p, b: sh.b }, ent) };
}
