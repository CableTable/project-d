// Fillet lines and finite arcs, pure: fillet.test.mjs. Drawing units, y up; angles in degrees, counter-clockwise.
import { shapeOf, get } from './grips.js';
import { rebuilt } from './modify.js';

const EPS = 1e-9, DEG = 180 / Math.PI;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const along = (p, u, t) => [p[0] + u[0] * t, p[1] + u[1] * t];
const angle = (c, p) => { const a = Math.atan2(p[1] - c[1], p[0] - c[0]) * DEG; return a < 0 ? a + 360 : a; };
const norm = (a) => (a % 360 + 360) % 360;
const dist = (a, b) => Math.hypot(...sub(a, b));
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const turn = (v) => [-v[1], v[0]];

// Intersections of supports / offset loci; at least one is a circle.
function intersections(a, b) {
  if (b.t === 'line') return intersections(b, a);
  if (a.t === 'line') {
    const d = sub(a.b, a.a), n = Math.hypot(...d), u = d.map((v) => v / n);
    const t = dot(sub(b.c, a.a), u), foot = along(a.a, u, t), h2 = b.r ** 2 - dist(foot, b.c) ** 2;
    if (h2 < -EPS) return [];
    const h = Math.sqrt(Math.max(0, h2));
    return [along(foot, u, h), along(foot, u, -h)];
  }
  const d = dist(a.c, b.c);
  if (d < EPS || d > a.r + b.r + EPS || d < Math.abs(a.r - b.r) - EPS) return [];
  const u = sub(b.c, a.c).map((v) => v / d), x = (a.r ** 2 - b.r ** 2 + d ** 2) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r ** 2 - x ** 2)), foot = along(a.c, u, x);
  return [along(foot, turn(u), h), along(foot, turn(u), -h)];
}

function offsets(s, r) {
  if (s.t === 'arc') return [s.r + r, Math.abs(s.r - r)].filter((v) => v > EPS).map((v) => ({ ...s, r: v }));
  const u = sub(s.b, s.a), n = Math.hypot(...u), v = turn(u).map((x) => x / n);
  return [r, -r].map((d) => ({ t: 'line', a: along(s.a, v, d), b: along(s.b, v, d) }));
}

function contacts(s, c, r) {
  if (s.t === 'line') {
    const d = sub(s.b, s.a);
    return [along(s.a, d, dot(sub(c, s.a), d) / dot(d, d))];
  }
  const d = dist(s.c, c), u = sub(c, s.c).map((v) => v / d);
  return [along(s.c, u, s.r), along(s.c, u, -s.r)].filter((p) => Math.abs(dist(p, c) - r) < EPS * Math.max(1, r, s.r));
}

// Unwrap near the finite sweep, including a corner just beyond an endpoint.
function arcPosition(s, p) {
  const t = norm(angle(s.c, p) - s.a0), sw = norm(s.a1 - s.a0);
  return t > sw && t - sw > 360 - t ? t - 360 : t;
}

/** Keep the picked side of corner X; without a crossing, the tangent point divides the entity. */
function kept(s, p, T, X) {
  if (s.t === 'line') {
    const d = sub(s.b, s.a), n = Math.hypot(...d), u = d.map((v) => v / n), x = X || T;
    const sign = dot(sub(p, x), u) >= 0 ? 1 : -1, v = u.map((k) => k * sign);
    const far = dot(sub(s.a, x), v) > dot(sub(s.b, x), v) ? s.a : s.b;
    if (dot(sub(far, T), v) <= EPS || (X && dot(sub(T, X), v) < -EPS)) return null;
    return { shape: { ...s, a: far === s.a ? far : T, b: far === s.b ? far : T }, away: v };
  }
  const sw = norm(s.a1 - s.a0), t = arcPosition(s, T), x = arcPosition(s, X || T), pick = arcPosition(s, p);
  const end = pick >= x;
  if (t < -EPS || t > sw + EPS || (end ? sw - t : t) <= EPS || (X && (end ? t < x - EPS : t > x + EPS))) return null;
  const a = angle(s.c, T), v = turn(sub(T, s.c)).map((k) => k / s.r * (end ? 1 : -1));
  return { shape: { ...s, a0: end ? a : s.a0, a1: end ? s.a1 : a }, away: v };
}

function filletCurves(a, p1, b, p2, r) {
  const corners = intersections(a, b).sort((x, y) => dist(x, p1) + dist(x, p2) - dist(y, p1) - dist(y, p2)), X = corners[0];
  if (!r) {
    if (!X) return { error: 'Radius 0 needs a line and arc, or arcs, that intersect' };
    const k1 = kept(a, p1, X, X), k2 = kept(b, p2, X, X);
    return k1 && k2 ? { shapes: [k1.shape, k2.shape] } : { error: 'The sharp corner would swallow an arc or line; pick the sides to keep' };
  }
  let best = null;
  for (const o1 of offsets(a, r)) for (const o2 of offsets(b, r)) {
    let centres = intersections(o1, o2);
    if (o1.t === 'arc' && o2.t === 'arc' && dist(o1.c, o2.c) < EPS && Math.abs(o1.r - o2.r) < EPS) {
      // Coincident offset circles give a family of semicircles; the picks and sweep boundaries choose a member.
      const angles = [angle(o1.c, p1), angle(o1.c, p2), a.a0, a.a1, b.a0, b.a1].flatMap((v) => [norm(v), norm(v + 180)]).sort((x, y) => x - y);
      const samples = angles.flatMap((v, i) => [v, v + norm(angles[(i + 1) % angles.length] - v) / 2]);
      centres = samples.map((v) => along(o1.c, [Math.cos(v / DEG), Math.sin(v / DEG)], o1.r));
    }
    for (const c of centres) {
      for (const t1 of contacts(a, c, r)) for (const t2 of contacts(b, c, r)) {
        const k1 = kept(a, p1, t1, X), k2 = kept(b, p2, t2, X);
        if (!k1 || !k2 || dist(t1, t2) < EPS) continue;
        const area = cross(sub(t1, c), sub(t2, c));
        for (const sign of Math.abs(area) < EPS * r * r ? [1, -1] : [area > 0 ? 1 : -1]) {
          const v1 = turn(sub(t1, c)), v2 = turn(sub(t2, c));
          if (dot(k1.away, v1) * sign >= -EPS || dot(k2.away, v2) * sign <= EPS) continue;
          const score = dist(t1, p1) + dist(t2, p2);
          if (!best || score < best.score) best = { score, shapes: [k1.shape, k2.shape, { t: 'arc', c, r, a0: angle(c, sign > 0 ? t1 : t2), a1: angle(c, sign > 0 ? t2 : t1) }] };
        }
      }
    }
  }
  return best || { error: 'No tangent fillet fits this radius and the picked sides; it would miss or swallow an arc or line' };
}

function drawingShape(e) {
  const s = shapeOf(e, 1);
  if (s.t === 'arc' && (get(e.r, 230) ?? 1) < 0) return { ...s, c: [-s.c[0], s.c[1]], a0: norm(180 - s.a1), a1: norm(180 - s.a0) };
  return s;
}

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

/** LINE / ARC pair → { ents: [first, second, arc?] }; the fillet takes the first entity's properties. */
export function filletEntities(e1, p1, e2, p2, r) {
  if (e1 === e2) return { error: 'Pick a second, different line or arc' };
  if (![e1, e2].every((e) => ['LINE', 'ARC'].includes(e?.type))) return { error: 'Fillet takes lines and arcs; circles and polylines are not supported' };
  if (!(r >= 0) || !Number.isFinite(r)) return { error: 'The radius must be 0 or more' };
  if ([e1, e2].some((e) => e.type === 'ARC' && (Math.abs(get(e.r, 210) ?? 0) > EPS || Math.abs(get(e.r, 220) ?? 0) > EPS))) return { error: 'Fillet needs arcs in the drawing plane' };
  const s1 = drawingShape(e1), s2 = drawingShape(e2);
  if ([s1, s2].some((s) => s.t === 'arc' ? !(s.r > EPS) || norm(s.a1 - s.a0) < EPS : dist(s.a, s.b) < EPS)) return { error: 'A line or arc has no length' };
  if (s1.t === 'arc' || s2.t === 'arc') {
    const f = filletCurves(s1, p1, s2, p2, r);
    if (f.error) return f;
    const ents = f.shapes.map((s, i) => rebuilt(s, i === 1 ? e2 : e1));
    if (ents.some((e) => { const s = shapeOf(e, 1); return s.t === 'arc' ? !s.r || !norm(s.a1 - s.a0) : dist(s.a, s.b) < EPS; })) return { error: 'The fillet would leave an arc or line too small for drawing precision' };
    return { ents };
  }
  const f = filletLines([s1.a, s1.b], p1, [s2.a, s2.b], p2, r);
  if (f.error) return f;
  const ents = [rebuilt({ t: 'line', a: f.l1[0], b: f.l1[1] }, e1), rebuilt({ t: 'line', a: f.l2[0], b: f.l2[1] }, e2)];
  if (f.arc) ents.push(rebuilt({ t: 'arc', ...f.arc }, e1));
  return { ents };
}
