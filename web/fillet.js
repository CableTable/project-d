// Fillet two lines with a tangent arc (TODO 66e), pure: fillet.test.mjs. Drawing units, y up; arc angles in degrees, counter-clockwise.
// Each line keeps the side of the corner its pick point is on; radius 0 trims or extends both to a sharp corner.
import { shapeOf } from './grips.js';
import { rebuilt } from './modify.js';

const EPS = 1e-9, DEG = 180 / Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const along = (p, u, t) => [p[0] + u[0] * t, p[1] + u[1] * t];
const angle = (c, p) => { const a = Math.atan2(p[1] - c[1], p[0] - c[0]) * DEG; return a < 0 ? a + 360 : a; };

/** Lines l1, l2 ([a, b]) picked at p1, p2 → { l1, l2, arc: { c, r, a0, a1 } | null } | { error }. */
export function filletLines(l1, p1, l2, p2, r) {
  if (!(r >= 0) || !Number.isFinite(r)) return { error: 'The radius must be 0 or more' };
  const d1 = sub(l1[1], l1[0]), d2 = sub(l2[1], l2[0]), n1 = Math.hypot(...d1), n2 = Math.hypot(...d2);
  if (n1 < EPS || n2 < EPS) return { error: 'A line has no length' };
  const den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) < EPS * n1 * n2) return { error: 'The lines are parallel: Fillet needs lines that meet' };
  const s = ((l2[0][0] - l1[0][0]) * d2[1] - (l2[0][1] - l1[0][1]) * d2[0]) / den, X = along(l1[0], d1, s);
  // kept side: towards the pick point; the far end on that side stays, the other end moves to the tangent point
  const side = (l, d, n, p) => {
    const u0 = [d[0] / n, d[1] / n], k = dot(sub(p, X), u0) >= 0 ? 1 : -1, u = [u0[0] * k, u0[1] * k];
    const far = dot(sub(l[0], X), u) > dot(sub(l[1], X), u) ? 0 : 1;
    return { u, far, reach: dot(sub(l[far], X), u) };
  };
  const a = side(l1, d1, n1, p1), b = side(l2, d2, n2, p2);
  const half = Math.acos(Math.max(-1, Math.min(1, dot(a.u, b.u)))) / 2, t = r / Math.tan(half);
  if (t >= a.reach - EPS || t >= b.reach - EPS) return { error: r ? 'The radius is too big for these lines' : 'Pick each line on the side to keep' };
  const T1 = along(X, a.u, t), T2 = along(X, b.u, t);
  const keep = (l, s, T) => (s.far === 0 ? [l[0], T] : [T, l[1]]);
  if (!r) return { l1: keep(l1, a, X), l2: keep(l2, b, X), arc: null };
  const bis = [a.u[0] + b.u[0], a.u[1] + b.u[1]], bn = Math.hypot(...bis), c = along(X, [bis[0] / bn, bis[1] / bn], r / Math.sin(half));
  const ccw = (T1[0] - c[0]) * (T2[1] - c[1]) - (T1[1] - c[1]) * (T2[0] - c[0]) > 0;
  return { l1: keep(l1, a, T1), l2: keep(l2, b, T2), arc: { c, r, a0: angle(c, ccw ? T1 : T2), a1: angle(c, ccw ? T2 : T1) } };
}

/** Two LINE entities → { ents: [line1, line2, arc?] } (the arc takes the first line's layer and colour) | { error }. */
export function filletEntities(e1, p1, e2, p2, r) {
  if (e1 === e2) return { error: 'Pick a second, different line' };
  if (e1?.type !== 'LINE' || e2?.type !== 'LINE') return { error: 'Fillet takes two lines' };
  const s1 = shapeOf(e1, 1), s2 = shapeOf(e2, 1), f = filletLines([s1.a, s1.b], p1, [s2.a, s2.b], p2, r);
  if (f.error) return f;
  const ents = [rebuilt({ t: 'line', a: f.l1[0], b: f.l1[1] }, e1), rebuilt({ t: 'line', a: f.l2[0], b: f.l2[1] }, e2)];
  if (f.arc) ents.push(rebuilt({ t: 'arc', ...f.arc }, e1));
  return { ents };
}
