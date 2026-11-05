// Divide / Measure points (TODO 97j): where the POINTs go along one curve; pure, drawing units, y up: divide.test.mjs.
//   divideAt(ent, pick, n)    → n - 1 points [x, y] splitting the curve in n equal parts (n for a closed curve: its start too), or a refusal reason (string)
//   measureAt(ent, pick, len) → a point every len along the curve, none at the far end unless it lands there within 1e-6, or a refusal reason
// Start: the end nearest `pick`; a closed polyline / spline from its first vertex; a circle from angle 0 anticlockwise; a full ellipse from its major axis end.
import { shapeOf, get } from './grips.js';
import { pathOf, geo, pointAt } from './modify.js';
import { curveShape, splineShape } from './extend.js';

const TAU = 2 * Math.PI, EPS = 1e-6, MAX_POINTS = 32767;
export const CANNOT_DIVIDE = 'Cannot divide or measure this object.';
export const BAD_COUNT = 'Number of segments must be 2 to 32767.';
export const BAD_LENGTH = 'Segment length must be greater than zero.';
export const TOO_MANY = 'That makes more than 32767 points.';
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A 2-D POLYLINE (its VERTEX kids) as a poly shape; null for a 3-D polyline, mesh or polyface. */
function polylineShape(ent) {
  const flags = get(ent.r, 70) ?? 0;
  if (flags & (8 | 16 | 64)) return null;
  const pts = (ent.kids || []).filter((k) => k.type === 'VERTEX' && !((get(k, 70) ?? 0) & 16)).map((k) => [get(k, 10) ?? 0, get(k, 20) ?? 0, get(k, 42) ?? 0]);
  return { t: 'poly', pts, closed: (flags & 1) === 1 };
}

/** An ELLIPSE as a finely flattened polyline (curveShape's 512 chords are 6e-6 short of the true length); a full one starts at parameter 0. */
function ellipseShape(sh) {
  const { c, m, n, t0: a, t1: b } = sh.q, full = b - a > TAU - 1e-6, t0 = full ? 0 : a, t1 = full ? TAU : b;
  const k = Math.max(16, Math.ceil(32768 * (t1 - t0) / TAU));
  return { t: 'poly', closed: full, pts: Array.from({ length: full ? k : k + 1 }, (_, i) => { const t = t0 + (t1 - t0) * i / k; return [c[0] + m[0] * Math.cos(t) + n[0] * Math.sin(t), c[1] + m[1] * Math.cos(t) + n[1] * Math.sin(t)]; }) };
}

/** { segs (in walking order), lens, total, out (path point back to drawing units) } or a refusal reason. */
function route(ent, pick) {
  if (!ent?.r || !Array.isArray(pick) || pick.length < 2 || !pick.slice(0, 2).every(Number.isFinite)) return CANNOT_DIVIDE;
  const T = ent.type, ocs = ['CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE'].includes(T);
  if (ocs && (Math.abs(get(ent.r, 210) ?? 0) > 1e-9 || Math.abs(get(ent.r, 220) ?? 0) > 1e-9)) return CANNOT_DIVIDE;       // a tilted plane
  let flip = ocs && (get(ent.r, 230) ?? 1) < 0;       // drawn from below: OCS x runs the other way
  const local = (p) => (flip ? [-p[0], p[1]] : p);
  let sh = T === 'POLYLINE' ? polylineShape(ent) : T === 'ELLIPSE' ? curveShape(ent) : T === 'SPLINE' ? splineShape(ent, 32768) : ['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE'].includes(T) ? shapeOf(ent) : null;
  if (sh?.q) sh = ellipseShape(sh);
  if (!sh) return CANNOT_DIVIDE;
  let path = pathOf(sh);
  if (flip && path.type === 'circle') { path = pathOf({ t: 'circle', c: [-sh.c[0], sh.c[1]], r: sh.r }); flip = false; }       // includes zero-sweep ARCs: world angle 0, anticlockwise as seen
  let segs = path.segs, closed = path.closed;
  if (sh.t === 'poly' && sh.closed && sh.pts.length === 2) { const [p, q] = sh.pts; segs.push({ a: q, b: p, bulge: q[2] || 0 }); closed = true; }       // pathOf wants 3 vertices; a DONUT is 2
  segs = segs.filter((s) => dist(s.a, s.b) > 1e-9);       // a zero chord with a bulge has no arc
  if (!segs.length) return CANNOT_DIVIDE;
  pick = local(pick);
  if (!closed && dist(pick, segs[0].a) > dist(pick, segs.at(-1).b)) segs = segs.map((s) => ({ a: s.b, b: s.a, bulge: -s.bulge })).reverse();
  const lens = segs.map((s) => { const g = geo(s); return g.line ? g.len : Math.abs(g.sw) * g.r; });
  const total = lens.reduce((a, b) => a + b, 0);
  return Number.isFinite(total) && total > 1e-9 ? { segs, lens, total, closed, out: local } : CANNOT_DIVIDE;
}

/** The points at the ascending distances `ds` along the route. */
function along(rt, ds) {
  let i = 0, acc = 0;
  return ds.map((d) => {
    while (i < rt.segs.length - 1 && acc + rt.lens[i] < d) acc += rt.lens[i++];
    return rt.out(pointAt(geo(rt.segs[i]), rt.lens[i] ? Math.min(1, Math.max(0, (d - acc) / rt.lens[i])) : 0));
  });
}

export function divideAt(ent, pick, n) {
  if (!Number.isInteger(n) || n < 2 || n > MAX_POINTS) return BAD_COUNT;
  const rt = route(ent, pick);
  if (typeof rt === 'string') return rt;
  const first = rt.closed ? 0 : 1;       // a closed curve's start is a division mark too: n points, not n - 1
  return along(rt, Array.from({ length: n - first }, (_, k) => rt.total * (k + first) / n));
}

export function measureAt(ent, pick, len) {
  if (!(len > 0) || !Number.isFinite(len)) return BAD_LENGTH;
  const rt = route(ent, pick);
  if (typeof rt === 'string') return rt;
  const count = Math.floor((rt.total + EPS) / len);
  return count > MAX_POINTS ? TOO_MANY : along(rt, Array.from({ length: count }, (_, k) => len * (k + 1)));
}
