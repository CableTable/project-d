// The circle tangent to two or three objects (Circle's Tan, Tan, Radius and Tan, Tan, Tan; TODO 346b). Pure: no DOM.
// An object is { t: 'l', a: [x, y], b: [x, y] } (a line, infinite for tangency) or { t: 'c', c: [x, y], r } (a circle; an arc counts as its full circle).
import { piecesNear } from './drawing.js';

const EPS = 1e-9;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The tangent point of the circle (c, r) on one object: a line's foot, or the circle's point on the line through both centres. null when they are concentric. */
function touch(o, c, r) {
  if (o.t === 'l') {
    const dx = o.b[0] - o.a[0], dy = o.b[1] - o.a[1], t = ((c[0] - o.a[0]) * dx + (c[1] - o.a[1]) * dy) / (dx * dx + dy * dy);
    return [o.a[0] + t * dx, o.a[1] + t * dy];
  }
  const d = dist(c, o.c);
  if (d < EPS * (1 + o.r)) return null;
  const u = [(c[0] - o.c[0]) / d, (c[1] - o.c[1]) / d], p = [o.c[0] + o.r * u[0], o.c[1] + o.r * u[1]], q = [o.c[0] - o.r * u[0], o.c[1] - o.r * u[1]];
  return Math.abs(dist(p, c) - r) <= Math.abs(dist(q, c) - r) ? p : q;
}

/**
 * The linear equation  row · (x, y, r) = rhs  of "the circle (x, y, r) touches o on side s" (s = ±1: which side of a line, or outside / inside a circle)
 * and, for a circle, the constant of its quadratic part: x² + y² − r² + row · (x, y, r) = rhs.
 */
function equation(o, s) {
  if (o.t === 'l') {
    const dx = o.b[0] - o.a[0], dy = o.b[1] - o.a[1], l = Math.hypot(dx, dy), nx = -dy / l, ny = dx / l;
    return { row: [nx, ny, -s], rhs: nx * o.a[0] + ny * o.a[1] };           // n · c − s r = n · a
  }
  return { row: [-2 * o.c[0], -2 * o.c[1], -2 * s * o.r], rhs: -(o.c[0] ** 2 + o.c[1] ** 2 - o.r ** 2) };
}

const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const mink = (u, v) => u[0] * v[0] + u[1] * v[1] - u[2] * v[2];              // x² + y² − r² as a bilinear form

/** The (x, y, r) points with r > 0 on all the equations, for one choice of sides; none when they do not fix the circle (parallel or concentric objects). */
function solveSides(objs, sides, radius) {
  const lin = [], quad = [];
  objs.forEach((o, i) => { const e = equation(o, sides[i]); (o.t === 'l' ? lin : quad).push(e); });
  if (radius != null) lin.push({ row: [0, 0, 1], rhs: radius });
  for (let i = 1; i < quad.length; i++) lin.push({ row: quad[i].row.map((v, k) => v - quad[0].row[k]), rhs: quad[i].rhs - quad[0].rhs });
  if (!quad.length) {                                                         // three linear equations
    const [A, B, C] = lin.map((e) => e.row), det = dot(A, cross(B, C));
    if (Math.abs(det) < EPS) return [];
    const [a, b, c] = lin.map((e) => e.rhs), x = [0, 1, 2].map((k) => (a * cross(B, C)[k] + b * cross(C, A)[k] + c * cross(A, B)[k]) / det);
    return x[2] > EPS ? [x] : [];
  }
  const [e1, e2] = lin, D = cross(e1.row, e2.row);                            // the line of points on both: P0 + t D
  const g11 = dot(e1.row, e1.row), g12 = dot(e1.row, e2.row), g22 = dot(e2.row, e2.row), gd = g11 * g22 - g12 * g12;
  if (Math.abs(gd) < EPS * g11 * g22) return [];
  const al = (e1.rhs * g22 - e2.rhs * g12) / gd, be = (e2.rhs * g11 - e1.rhs * g12) / gd;
  const P = e1.row.map((v, k) => al * v + be * e2.row[k]);
  const q = quad[0], a = mink(D, D), b = 2 * mink(P, D) + dot(q.row, D), c = mink(P, P) + dot(q.row, P) - q.rhs;
  const ts = Math.abs(a) < EPS * (Math.abs(b) + Math.abs(c) + 1) ? (Math.abs(b) < EPS ? [] : [-c / b]) : (() => {
    const disc = b * b - 4 * a * c;
    if (disc < -EPS * (b * b + Math.abs(4 * a * c))) return [];
    const sq = Math.sqrt(Math.max(0, disc));
    return [(-b + sq) / (2 * a), (-b - sq) / (2 * a)];
  })();
  return ts.map((t) => [P[0] + t * D[0], P[1] + t * D[1], P[2] + t * D[2]]).filter((x) => x[2] > EPS);
}

/**
 * The circle { c, r } tangent to every object in `objs` (two with a fixed `radius`, or three with none). Of the solutions, the one whose tangent points
 * are nearest the picks (picks[i] is where object i was picked). null: no such circle, or none that is unique (parallel or concentric objects, one object twice).
 */
export function tangentCircle(objs, picks, radius = null) {
  let best = null;
  const combos = 1 << objs.length;
  for (let m = 0; m < combos; m++) {
    const sides = objs.map((_, i) => (m >> i & 1 ? -1 : 1));
    for (const [x, y, r] of solveSides(objs, sides, radius)) {
      if (radius != null && Math.abs(r - radius) > 1e-7 * (1 + radius)) continue;
      const pts = objs.map((o) => touch(o, [x, y], r));
      if (pts.some((p) => !p)) continue;
      const score = pts.reduce((sum, p, i) => sum + dist(p, picks[i]), 0);
      if (!best || score < best.score - 1e-12) best = { c: [x, y], r, score };
    }
  }
  return best && { c: best.c, r: best.r };
}

/**
 * The line, circle or arc under (x, y) in a pick index, as a solver object: { o, d } (d: how far, in the index's units), or null when none is within tol
 * or the nearest is a spline or ellipse (no line, circle or arc). vis(item) says what shows; to([x, y]) turns an index point into mm and scale an index length.
 */
export function nearestObject(ix, vis, x, y, tol, to, scale) {
  const hit = piecesNear(ix, x, y, tol, vis).sort((a, b) => a.d - b.d)[0];
  if (!hit || hit.ent.curve) return null;
  const e = hit.ent;
  return { d: hit.d, o: e.t === 'a' ? { t: 'c', c: to([e.cx, e.cy]), r: e.r * scale } : { t: 'l', a: to([e.x1, e.y1]), b: to([e.x2, e.y2]) } };
}
