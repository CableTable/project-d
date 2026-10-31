import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rayHit, extendEntity, extendRegion, previewEdit, curveShape } from './web/extend.js';
import { fenceHit } from './web/modify.js';
import { shapeOf } from './web/grips.js';
import { get } from './web/grips.js';
import { line, circle, arc, ellipse, lwpoly, text, entity } from './web/dxf-write.js';

const close = (p, q) => assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-7, `${p} != ${q}`);
const S = (e) => shapeOf(e, 1);

test('rayHit: the nearest boundary ahead wins; boundaries behind or beside are ignored', () => {
  const edges = [line(20, -5, 20, 5), line(30, -5, 30, 5), line(-5, -5, -5, 5), line(15, 1, 25, 1)].map(S);
  close(rayHit([0, 0], [10, 0], edges), [20, 0]);
  close(rayHit([10, 0], [0, 0], edges), [-5, 0]);
  assert.equal(rayHit([0, 0], [0, 10], edges), null);
});

test('rayHit: circles, arcs and bulged polylines', () => {
  close(rayHit([0, 0], [10, 0], [S(circle(30, 0, 5))]), [25, 0]);
  close(rayHit([30, 0], [31, 0], [S(circle(30, 0, 5))]), [35, 0]);                         // from inside: the far side
  close(rayHit([0, 0], [10, 0], [S(arc(30, 0, 5, 90, 270))]), [25, 0]);
  close(rayHit([0, 0], [10, 0], [S(arc(30, 0, 5, -90, 90))]), [35, 0]);                     // only the far half is there
  close(rayHit([0, 0], [1, 0], [S(lwpoly([[50, -10, 0], [50, 10, 0]]))]), [50, 0]);
  close(rayHit([0, 5], [1, 5], [S(lwpoly([[100, 0, 1], [100, 10, 0]]))]), [105, 5]);         // a half circle bulging out to x = 105
});

test('rayHit: an end already on a boundary goes on to the next one; parallel boundaries never meet', () => {
  const edges = [line(10, -5, 10, 5), line(40, -5, 40, 5)].map(S);
  close(rayHit([0, 0], [10, 0], edges), [40, 0]);
  assert.equal(rayHit([0, 0], [10, 0], [S(line(0, 3, 50, 3))]), null);
});

test('extendEntity: the end nearest the pick moves, the other stays; layer kept', () => {
  const ent = line(0, 0, 10, 0, { layer: 'Cut' }), edges = [line(20, -5, 20, 5), line(-8, -5, -8, 5)];
  let r = extendEntity(ent, edges, [8, 0]);
  close(S(r.ent).a, [0, 0]); close(S(r.ent).b, [20, 0]); assert.equal(r.ent.layer, 'Cut');
  r = extendEntity(ent, edges, [2, 0]);
  close(S(r.ent).a, [-8, 0]); close(S(r.ent).b, [10, 0]);
});

test('extendEntity: no boundary ahead, not a line, or the line itself as its only boundary → an error', () => {
  const ent = line(0, 0, 10, 0);
  assert.match(extendEntity(ent, [line(0, 5, 10, 5)], [9, 0]).error, /No boundary/);
  assert.match(extendEntity(ent, [ent], [9, 0]).error, /No boundary/);
  assert.match(extendEntity(text(0, 0, 5, 'x'), [line(20, -5, 20, 5)], [5, 0]).error, /Extend takes/);
  assert.match(extendEntity(ent, [text(30, 0, 5, 'x')], [9, 0]).error, /No boundary/);
});

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const BQ = Math.tan(Math.PI / 8);   // a quarter circle's bulge

test('extendEntity arc: the picked end grows along its own circle to a line or a circle, the other end stays', () => {
  const a = arc(0, 0, 10, 0, 90);
  let s = S(extendEntity(a, [line(-20, 0, 0, 0)], [0, 10]).ent);
  near(s.a0, 0); near(s.a1, 180); near(s.r, 10); close(s.c, [0, 0]);
  s = S(extendEntity(a, [line(5, -20, 5, 20)], [10, 0]).ent);                       // the hit inside its own span does not count
  near(s.a0, 300); near(s.a1, 90);
  s = S(extendEntity(a, [circle(-10, 0, 10)], [0, 10]).ent);
  near(s.a0, 0); near(s.a1, 120);
  assert.equal(extendEntity(arc(0, 0, 10, 0, 90, { layer: 'Cut' }), [line(-20, 0, 0, 0)], [0, 10]).ent.layer, 'Cut');
});

test('extendEntity arc: no boundary ahead is the existing error; a circle is a closed shape', () => {
  assert.match(extendEntity(arc(0, 0, 10, 0, 90), [line(-5, 20, -5, 30)], [0, 10]).error, /No boundary/);
  assert.match(extendEntity(arc(0, 0, 10, 0, 90), [arc(0, 0, 10, 90, 180)], [0, 10]).error, /No boundary/);   // same circle never meets
  assert.match(extendEntity(circle(0, 0, 5), [line(20, -5, 20, 5)], [5, 0]).error, /Can't extend a closed shape/);
});

test('extendEntity polyline: a straight end segment runs along its line, widths and layer kept', () => {
  const p = lwpoly([[0, 0], [10, 0], [10, 5]], { width: 2, layer: 'Cut' }), r = extendEntity(p, [line(0, 20, 20, 20), line(-6, -5, -6, 5)], [10, 5]);
  assert.deepEqual(S(r.ent).pts, [[0, 0], [10, 0], [10, 20]]); assert.equal(r.ent.layer, 'Cut');
  assert.equal(get(r.ent.r, 43), 2, 'constant width kept');
  assert.deepEqual(S(extendEntity(p, [line(-6, -5, -6, 5)], [0, 0]).ent).pts, [[-6, 0], [10, 0], [10, 5]]);
  const tapered = entity('LWPOLYLINE', [[90, 2], [70, 0], [10, 0], [20, 0], [40, 1], [41, 3], [10, 10], [20, 0], [40, 3], [41, 3]]);
  assert.deepEqual(S(extendEntity(tapered, [line(30, -5, 30, 5)], [10, 0]).ent).pts, [[0, 0, 0, 1, 3], [30, 0, 0, 3, 3]]);
  assert.match(extendEntity(p, [line(0, 3, 20, 3)], [10, 5]).error, /No boundary/);
});

test('extendEntity polyline: a bulged end segment runs along its arc', () => {
  let s = S(extendEntity(lwpoly([[20, 0], [10, 0, BQ], [0, 10]]), [line(-20, 0, 0, 0)], [0, 10]).ent);   // the quarter circle grows to a half
  close(s.pts[2], [-10, 0]); near(s.pts[1][2], 1); close(s.pts[0], [20, 0]);
  s = S(extendEntity(lwpoly([[20, 0], [10, 0, -BQ], [0, -10]]), [line(-20, 0, 0, 0)], [0, -10]).ent);
  close(s.pts[2], [-10, 0]); near(s.pts[1][2], -1); close(s.pts[1], [10, 0]); close(s.pts[0], [20, 0]);
  s = S(extendEntity(lwpoly([[10, 0, BQ], [0, 10]]), [line(5, -20, 5, -1)], [10, 0]).ent);                // the start end, clockwise
  close(s.pts[0], [5, -Math.sqrt(75)]); near(s.pts[0][2], Math.tan(Math.PI * 150 / 180 / 4)); close(s.pts[1], [0, 10]);
});

test('extendEntity polyline: a closed polyline is a closed shape', () => {
  assert.match(extendEntity(lwpoly([[0, 0], [10, 0], [10, 5]], { closed: true }), [line(30, -5, 30, 5)], [10, 0]).error, /Can't extend a closed shape/);
});

// ---------------------------------------------------------------- elliptical arcs (TODO 155m)

const nearE = (a, b) => assert.ok(Math.abs(a - b) < 1e-4, `${a} != ${b}`);           // an ellipse's hit is found on chords, a few millionths of a radian
const PI = Math.PI, E =(ent, i) => get(ent.r, i);
/** The point of an ellipse (centre 0,0, major axis end m, ratio k) at parameter t. */
const onEll = (m, k, t) => [m[0] * Math.cos(t) - m[1] * k * Math.sin(t), m[1] * Math.cos(t) + m[0] * k * Math.sin(t)];
const spline1 = (x0, y0, x1, y1) => entity('SPLINE', [[70, 8], [71, 1], [72, 4], [73, 2], [40, 0], [40, 0], [40, 1], [40, 1], [10, x0], [20, y0], [30, 0], [10, x1], [20, y1], [30, 0]]);   // degree 1: a straight line

test('extendEntity ellipse: the end nearest the pick grows along its ellipse to a line, the other end stays', () => {
  const half = ellipse(0, 0, 10, 0, 0.5, 0, PI), floor = line(-20, -3, 20, -3);
  let r = extendEntity(half, [floor], [-10, 0]);                                    // the end at t = π
  nearE(E(r.ent, 41), 0); nearE(E(r.ent, 42), PI + Math.asin(0.6));
  r = extendEntity(half, [floor], [10, 0]);                                         // the start at t = 0 grows backwards
  nearE(E(r.ent, 42), PI); nearE(E(r.ent, 41), 2 * PI - Math.asin(0.6));
  assert.equal(extendEntity(ellipse(0, 0, 10, 0, 0.5, 0, PI, { layer: 'Cut' }), [floor], [-10, 0]).ent.layer, 'Cut');
});

test('extendEntity ellipse: to a circle, to the first of two boundaries; a boundary that only meets the arc itself is ignored', () => {
  const half = ellipse(0, 0, 10, 0, 0.5, 0, PI);
  let r = extendEntity(half, [circle(0, 0, 7)], [-10, 0]);
  const p = onEll([10, 0], 0.5, E(r.ent, 42));
  assert.ok(Math.abs(Math.hypot(...p) - 7) < 1e-4 && p[1] < 0, `${p}`);
  r = extendEntity(half, [line(-20, -4, 20, -4), line(-20, -2, 20, -2)], [-10, 0]);
  nearE(E(r.ent, 42), PI + Math.asin(0.4));
  assert.match(extendEntity(half, [line(-20, 2, 20, 2)], [-10, 0]).error, /No boundary/);
});

test('extendEntity ellipse: a rotated ellipse, and one flipped by its extrusion (230 = -1)', () => {
  const c45 = Math.SQRT1_2, m = [10 * c45, 10 * c45];
  const r = extendEntity(ellipse(0, 0, m[0], m[1], 0.5, 0, PI), [line(0, -30, 0, 30)], [-m[0], -m[1]]), p = onEll(m, 0.5, E(r.ent, 42));
  assert.ok(Math.abs(p[0]) < 1e-4 && p[1] < 0, `${p}`);
  const flip = entity('ELLIPSE', [[10, 0], [20, 0], [30, 0], [11, 10], [21, 0], [31, 0], [40, 0.5], [41, 0], [42, PI], [230, -1]]);
  nearE(E(extendEntity(flip, [line(-20, 3, 20, 3)], [-10, 0]).ent, 42), PI + Math.asin(0.6));      // flipped: 0 to π is the lower half, so it grows up
});

test('extendEntity ellipse: no crossing, a full ellipse and a spline are each refused with a message', () => {
  const half = ellipse(0, 0, 10, 0, 0.5, 0, PI);
  assert.match(extendEntity(half, [line(-20, -9, 20, -9)], [-10, 0]).error, /No boundary/);
  assert.match(extendEntity(half, [], [-10, 0]).error, /No boundary/);
  assert.match(extendEntity(ellipse(0, 0, 10, 0, 0.5), [line(-20, -3, 20, -3)], [10, 0]).error, /closed/);
  assert.match(extendEntity(spline1(0, 0, 5, 0), [line(20, -5, 20, 5)], [5, 0]).error, /Splines are not extended yet/);
});

test('extendEntity: ellipses and splines are boundaries for a line, an arc and an elliptical arc', () => {
  const wall = spline1(6, -20, 6, 20);
  let r = extendEntity(line(-3, 0, 2, 0), [ellipse(0, 0, 10, 0, 0.5)], [2, 0]);
  assert.ok(Math.abs(S(r.ent).b[0] - 10) < 1e-3 && S(r.ent).b[1] === 0, `${S(r.ent).b}`);
  r = extendEntity(line(-3, 0, 2, 0), [wall], [2, 0]); close(S(r.ent).b, [6, 0]);
  assert.match(extendEntity(arc(0, 0, 3, 0, 90), [wall], [3, 0]).error, /No boundary/);          // a circle of radius 3 never reaches x = 6
  r = extendEntity(arc(0, 0, 8, 0, 90), [wall], [8, 0]); nearE(S(r.ent).a0, 360 - Math.acos(0.75) * 180 / PI);
  r = extendEntity(ellipse(0, 0, 10, 0, 0.5, 0, PI), [wall], [10, 0]);                           // from t = 0 backwards, x = 6 is met at cos t = 0.6
  nearE(E(r.ent, 41), 2 * PI - Math.acos(0.6));
  assert.match(extendEntity(line(-3, 0, 2, 0), [ellipse(0, 40, 5, 0, 0.5)], [2, 0]).error, /No boundary/);
});

test('previewEdit and extendRegion take elliptical arcs: the preview is just the new stretch; a fence extends it', () => {
  const half = ellipse(0, 0, 10, 0, 0.5, 0, PI), floor = line(-20, -3, 20, -3);
  let pv = previewEdit(half, [floor], [-10, 0], true);
  assert.equal(pv.act, 'extend'); nearE(E(pv.add, 41), PI); nearE(E(pv.add, 42), PI + Math.asin(0.6));
  pv = previewEdit(half, [floor], [10, 0], true);
  nearE(E(pv.add, 41), 2 * PI - Math.asin(0.6)); nearE(E(pv.add, 42), 0);
  const r = extendRegion([half, line(0, 5, 3, 5)], [floor], fenceHit([[-12, 1], [-9, 1]]));
  assert.equal(r.changed.length, 1); nearE(E(r.changed[0].ents[0], 42), PI + Math.asin(0.6));
});

test('extendEntity ellipse: a line reaches a huge ellipse exactly (snapped off the chord)', () => {
  const r = extendEntity(line(0, 3000, 100, 3000), [ellipse(0, 0, 10000, 0, 0.5)], [100, 3000]), b = S(r.ent).b;
  assert.ok(Math.hypot(b[0] - 8000, b[1] - 3000) < 1e-6, `${b}`);
  const a = extendEntity(arc(0, 0, 7000, 0, 30), [ellipse(0, 0, 10000, 0, 0.5)], [7000 * Math.cos(PI / 6), 3500]);      // an arc too, on the true curve
  const p = [7000 * Math.cos(S(a.ent).a1 / 180 * PI), 7000 * Math.sin(S(a.ent).a1 / 180 * PI)];
  assert.ok(Math.abs((p[0] / 10000) ** 2 + (p[1] / 5000) ** 2 - 1) < 1e-8, `${p}`);      // the arc's angle is stored to ~1e-7 degree; an unsnapped chord hit leaves ~7e-7
});

test('extendEntity ellipse: an elliptical arc whose sweep crosses 0 (t0 = 5, t1 = 1) grows at both ends', () => {
  const arcE = ellipse(0, 0, 10, 0, 0.5, 5, 1);
  let r = extendEntity(arcE, [line(-20, 4, 20, 4)], onEll([10, 0], 0.5, 1));                     // the end at t = 1 grows on to y = 4 (sin t = 0.8)
  nearE(E(r.ent, 42), PI - Math.asin(0.8)); nearE(E(r.ent, 41), 5);
  r = extendEntity(arcE, [line(-20, -4, 20, -4)], onEll([10, 0], 0.5, 5));                       // the start at t = 5 grows backwards to y = -4
  nearE(E(r.ent, 41), PI + Math.asin(0.8)); nearE(E(r.ent, 42), 1);
});

test('extendEntity ellipse: an elliptical arc against 50 boundary ellipses and 2000 lines stays fast', () => {
  const edges = [line(-20, -3, 20, -3)];
  for (let i = 0; i < 50; i++) edges.push(ellipse(40 + i * 15, 30, 10, 0, 0.5));
  for (let i = 0; i < 2000; i++) edges.push(line(-500 + (i % 100) * 10, -500 + Math.floor(i / 100) * 50, -495 + (i % 100) * 10, -480 + Math.floor(i / 100) * 50));
  const half = ellipse(0, 0, 10, 0, 0.5, 0, PI);
  extendEntity(half, edges, [-10, 0]);      // warm-up, so the limit measures the work and not the first-call compile
  const t = performance.now();
  const r = extendEntity(half, edges, [-10, 0]);
  assert.ok(performance.now() - t < 200, `${performance.now() - t} ms`);
  nearE(E(r.ent, 42), PI + Math.asin(0.6));
});

test('rayHit ellipse: solved exactly: near-tangent crossing, a part ellipse, a miss', () => {
  const big = curveShape(ellipse(0, 0, 10000, 0, 0.5)), T = 0.8094, off = 0.02;
  const on = [10000 * Math.cos(T), 5000 * Math.sin(T)], d = [-10000 * Math.sin(T), 5000 * Math.cos(T)], L = Math.hypot(d[0], d[1]), u = [d[0] / L, d[1] / L];
  const nrm = [u[1], -u[0]], inward = nrm[0] * on[0] / 1e8 + nrm[1] * on[1] / 2.5e7 > 0 ? -1 : 1;      // the tangent line's normal, turned towards the centre
  const p = [on[0] + inward * off * nrm[0], on[1] + inward * off * nrm[1]];
  const res = (h) => Math.abs((h[0] / 10000) ** 2 + (h[1] / 5000) ** 2 - 1);
  const h1 = rayHit([p[0] - 101 * u[0], p[1] - 101 * u[1]], [p[0] - 100 * u[0], p[1] - 100 * u[1]], [big]);
  const h2 = rayHit([p[0] + 101 * u[0], p[1] + 101 * u[1]], [p[0] + 100 * u[0], p[1] + 100 * u[1]], [big]);
  assert.ok(res(h1) < 1e-9 && res(h2) < 1e-9, `${h1} ${h2}`);
  const qa = (u[0] / 1e4) ** 2 + (u[1] / 5e3) ** 2, qb = p[0] * u[0] / 1e8 + p[1] * u[1] / 2.5e7, qc = (p[0] / 1e4) ** 2 + (p[1] / 5e3) ** 2 - 1;      // the line p + s·u met directly
  const sq = Math.sqrt(qb * qb - qa * qc), s1 = (-qb - sq) / qa, s2 = (-qb + sq) / qa;
  close(h1, [p[0] + s1 * u[0], p[1] + s1 * u[1]]); close(h2, [p[0] + s2 * u[0], p[1] + s2 * u[1]]);      // from behind: the near crossing (s1); from ahead: the one at s2
  assert.ok((h1[0] - h2[0]) * u[0] + (h1[1] - h2[1]) * u[1] < -1, `${h1} ${h2}`);          // forward from behind hits the near crossing, forward from ahead the other: they are apart
  const quarter = curveShape(ellipse(0, 0, 10, 0, 0.5, 0, PI / 2));                         // first quadrant only
  close(rayHit([-20, 3], [-15, 3], [quarter]), [8, 3]);                                      // the nearer root (x = -8) is off the arc, so the far one counts
  assert.equal(rayHit([-20, -3], [-15, -3], [quarter]), null);                               // both roots are off the arc
  const x0 = 9.800665778412416;                                                              // 10·cos 0.2: straight down through the start point of an arc from t = 0.2
  close(rayHit([x0, 10], [x0, 5], [curveShape(ellipse(0, 0, 10, 0, 0.5, 0.2, 1.7))]), [x0, 5 * Math.sin(0.2)]);
  const sp = curveShape(ellipse(0, 0, 10, 0, 0.5, 0.2, 1.7)), u0 = [-0.3971478906347807, 0.9177546256839811];      // a slanted ray aimed at the start point (the old filter dropped it by rounding)
  const st = [11.786405231586318, -3.5954264744445994];
  const sh = rayHit(st, [st[0] + u0[0], st[1] + u0[1]], [sp]);
  assert.ok(sh && Math.hypot(sh[0] - 10 * Math.cos(0.2), sh[1] - 5 * Math.sin(0.2)) < 1e-9, `${sh}`);
  const flipQ = curveShape(entity('ELLIPSE', [[10, 0], [20, 0], [30, 0], [11, 10], [21, 0], [31, 0], [40, 0.5], [41, 0], [42, PI / 2], [230, -1]]));      // flipped: t 0..π/2 is the fourth quadrant
  close(rayHit([-20, -3], [-15, -3], [flipQ]), [8, -3]); assert.equal(rayHit([-20, 3], [-15, 3], [flipQ]), null);
  const wrapQ = curveShape(ellipse(0, 0, 10, 0, 0.5, 5, 1));                                 // t0 = 5, t1 = 1: the right-hand side, through t = 0
  close(rayHit([-20, 4], [-15, 4], [wrapQ]), [6, 4]); close(rayHit([-20, -4], [-15, -4], [wrapQ]), [6, -4]);
  assert.equal(rayHit([-20, 6], [-15, 6], [curveShape(ellipse(0, 0, 10, 0, 0.5))]), null);  // y = 6 misses the minor radius 5
  close(rayHit([-20, 5], [-15, 5], [curveShape(ellipse(0, 0, 10, 0, 0.5))]), [0, 5]);        // y = 5 just touches
});

test('extendEntity ellipse: a line 0.1 mm off tangent to a 10 m ellipse stops at the near crossing, on the curve', () => {
  const big = ellipse(0, 0, 10000, 0, 0.5), a = [6253.243065651865, 3901.7893770914366], e = [6234.652933903769, 3909.165487285057];      // t = 0.9, pushed 0.1 mm inside the tangent
  const b = S(extendEntity(line(a[0], a[1], e[0], e[1]), [big], e).ent).b;
  assert.ok(Math.abs((b[0] / 10000) ** 2 + (b[1] / 5000) ** 2 - 1) < 1e-9, `${b}`);
  const back = rayHit([e[0] + 1e4 * (e[0] - a[0]), e[1] + 1e4 * (e[1] - a[1])], [e[0] + 9999 * (e[0] - a[0]), e[1] + 9999 * (e[1] - a[1])], [curveShape(big)]);      // from far ahead, back: the other crossing
  assert.ok((back[0] - b[0]) * (e[0] - a[0]) + (back[1] - b[1]) * (e[1] - a[1]) > 0, `${b} ${back}`);
});
