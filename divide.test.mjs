import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divideAt, measureAt, CANNOT_DIVIDE, BAD_COUNT, BAD_LENGTH, TOO_MANY } from './web/divide.js';
import { line, arc, circle, lwpoly, ellipse, entity, point } from './web/dxf-write.js';

const PI = Math.PI;
const near = (got, want, tol = 1e-6) => {
  assert.ok(Array.isArray(got), String(got));
  assert.equal(got.length, want.length, JSON.stringify(got));
  got.forEach((p, i) => assert.ok(Math.hypot(p[0] - want[i][0], p[1] - want[i][1]) < tol, `${i}: ${p} vs ${want[i]}`));
};
const polar = (cx, cy, r, deg) => [cx + r * Math.cos(deg * PI / 180), cy + r * Math.sin(deg * PI / 180)];
const flipped = (e) => { e.r.c.push(210, 220, 230); e.r.v.push('0', '0', '-1'); return e; };
const poly2d = (pts, flags = 0) => { const e = entity('POLYLINE', [[70, flags]]); e.kids = pts.map(([x, y, b = 0]) => ({ type: 'VERTEX', c: [10, 20, 42], v: [String(x), String(y), String(b)] })); return e; };
const spline1 = (cps) => {       // degree 1 through the points: a polyline
  const knots = [0, ...cps.map((_, i) => i), cps.length - 1];
  return entity('SPLINE', [[70, 8], [71, 1], [72, knots.length], [73, cps.length], [74, 0], ...knots.map((k) => [40, k]), ...cps.flatMap(([x, y]) => [[10, x], [20, y], [30, 0]])]);
};

test('LINE: Divide from the end nearest the pick, Measure points without the far end', () => {
  const l = line(0, 0, 100, 0);
  near(divideAt(l, [10, 3], 4), [[25, 0], [50, 0], [75, 0]]);
  near(divideAt(l, [90, 3], 4), [[75, 0], [50, 0], [25, 0]]);
  near(measureAt(l, [1, 0], 30), [[30, 0], [60, 0], [90, 0]]);
  near(measureAt(l, [99, 0], 30), [[70, 0], [40, 0], [10, 0]]);
  near(measureAt(l, [1, 0], 25), [[25, 0], [50, 0], [75, 0], [100, 0]]);       // lands on the far end: a point there
  near(measureAt(l, [1, 0], 100 + 5e-7), [[100, 0]]);       // within 1e-6 of it counts
  near(measureAt(l, [1, 0], 100 + 2e-6), []);                                       // 2e-6 short of it does not
  assert.equal(divideAt(l, [0, 0], 32767).length, 32766);
});

test('ARC: anticlockwise sweep, from the picked end', () => {
  const a = arc(0, 0, 10, 0, 90);
  near(divideAt(a, [10, 0], 3), [polar(0, 0, 10, 30), polar(0, 0, 10, 60)]);
  near(divideAt(a, [0, 10], 3), [polar(0, 0, 10, 60), polar(0, 0, 10, 30)]);
  near(measureAt(a, [10, 0], 10 * PI / 6), [polar(0, 0, 10, 30), polar(0, 0, 10, 60), polar(0, 0, 10, 90)]);
  near(divideAt(arc(0, 0, 10, 300, 60), [10, 0], 2), [[10, 0]]);       // across 0°
});

test('mirrored (extrusion -1) ARC and CIRCLE are walked in drawing coordinates', () => {
  const a = flipped(arc(20, 0, 10, 0, 90));       // drawing: centre (-20, 0), from 180° round to 90° (clockwise)
  near(divideAt(a, [-30, 0], 3), [polar(-20, 0, 10, 150), polar(-20, 0, 10, 120)]);       // nearest the 180° end
  near(divideAt(a, [-20, 10], 3), [polar(-20, 0, 10, 120), polar(-20, 0, 10, 150)]);
  near(divideAt(flipped(circle(5, 5, 10)), [0, 0], 4), [[-5, 15], [5, 5], [-5, -5]]);       // drawing angle 180° first, then clockwise
});

test('CIRCLE: from angle 0 anticlockwise, whatever the pick', () => {
  const c = circle(5, 5, 10);
  near(divideAt(c, [-5, 5], 4), [[5, 15], [-5, 5], [5, -5]]);
  near(divideAt(c, [15, 5], 4), [[5, 15], [-5, 5], [5, -5]]);
  const eighths = measureAt(c, [0, 0], 2 * PI * 10 / 8);
  near(eighths.slice(0, 2), [polar(5, 5, 10, 45), [5, 15]]);
  assert.equal(eighths.length, 8);       // the 8th lands on the start again
});

test('LWPOLYLINE: open from the nearest end, closed from its first vertex, bulges', () => {
  const l = lwpoly([[0, 0], [10, 0], [10, 10]]);
  near(divideAt(l, [1, 1], 4), [[5, 0], [10, 0], [10, 5]]);
  near(divideAt(l, [11, 11], 4), [[10, 5], [10, 0], [5, 0]]);
  near(measureAt(l, [11, 11], 12), [[8, 0]]);
  const sq = lwpoly([[0, 0], [10, 0], [10, 10], [0, 10]], { closed: true });
  near(divideAt(sq, [0, 10], 4), [[10, 0], [10, 10], [0, 10]]);       // first vertex, whatever the pick
  near(measureAt(sq, [0, 10], 15), [[10, 5], [0, 10]]);
});

test('LWPOLYLINE with a bulge: the arc counts by its length', () => {
  const half = lwpoly([[0, 0, 1], [10, 0]]);       // a semicircle below the chord (bulge 1 = anticlockwise)
  near(divideAt(half, [0, 0], 2), [[5, -5]]);
  near(divideAt(half, [10, 0], 2), [[5, -5]]);
  near(divideAt(half, [0, 0], 4), [polar(5, 0, 5, 225), [5, -5], polar(5, 0, 5, 315)]);
  near(measureAt(lwpoly([[0, 0, 1], [10, 0], [10, 10]]), [0, 0], 5 * PI), [[10, 0]]);       // 5π round the arc, then 10 up
  near(measureAt(lwpoly([[0, 0, 1], [10, 0], [10, 10]]), [10, 10], 20), [[5 + 5 * Math.cos(2), -5 * Math.sin(2)]]);       // down 10, then 10 (2 rad) back along the arc
});

test('2D POLYLINE: open, closed and bulged', () => {
  near(divideAt(poly2d([[0, 0], [10, 0], [10, 10]]), [0, 0], 2), [[10, 0]]);
  near(divideAt(poly2d([[0, 0], [10, 0], [10, 10]]), [10, 10], 4), [[10, 5], [10, 0], [5, 0]]);
  const sq = poly2d([[0, 0], [10, 0], [10, 10], [0, 10]], 1);
  near(measureAt(sq, [0, 10], 15), [[10, 5], [0, 10]]);
  near(divideAt(poly2d([[0, 0, 1], [10, 0]]), [0, 0], 2), [[5, -5]]);
  assert.equal(divideAt(poly2d([[0, 0], [10, 0]], 8), [0, 0], 2), CANNOT_DIVIDE);       // 3-D polyline
});

test('ELLIPSE: a full one starts at its major axis end, a partial one at the nearest end', () => {
  const e = ellipse(0, 0, 10, 0, 0.5);
  near(divideAt(e, [0, 5], 4), [[0, 5], [-10, 0], [0, -5]], 1e-4);
  near(divideAt(ellipse(0, 0, 10, 0, 0.5, 1, 1 + 2 * PI), [0, -5], 4), [[0, 5], [-10, 0], [0, -5]], 1e-4);       // start parameter 1 is still a full ellipse
  near(divideAt(ellipse(0, 0, 0, 10, 0.5), [0, 0], 2), [[0, -10]], 1e-4);       // major axis up: 0.5 turn is the bottom
  const half = ellipse(0, 0, 10, 0, 0.5, 0, PI);
  near(divideAt(half, [-10, 0], 2), [[0, 5]], 1e-4);
  const r1 = ellipse(0, 0, 10, 0, 1, 0, PI);
  near(measureAt(r1, [-10, 0], 10 * PI / 2.5), [polar(0, 0, 10, 108), polar(0, 0, 10, 36)], 1e-4);       // 36° steps from the (-10, 0) end
  near(divideAt(flipped(ellipse(0, 0, 10, 0, 0.5)), [0, 0], 4), [[0, -5], [-10, 0], [0, 5]], 1e-4);       // extrusion -1 turns the sweep clockwise
});

test('SPLINE: along its flattened shape', () => {
  const s = spline1([[0, 0], [10, 0], [10, 10]]);
  near(divideAt(s, [0, 0], 4), [[5, 0], [10, 0], [10, 5]], 1e-6);
  near(measureAt(s, [10, 10], 15), [[5, 0]], 1e-6);       // from the picked end: down 10, then 5 along
  near(measureAt(spline1([[0, 0], [100, 0]]), [0, 0], 40), [[40, 0], [80, 0]], 1e-6);
});

test('refusals', () => {
  const l = line(0, 0, 100, 0);
  assert.equal(divideAt(point(1, 1), [1, 1], 3), CANNOT_DIVIDE);
  assert.equal(divideAt(entity('TEXT', [[10, 0], [20, 0], [1, 'x']]), [0, 0], 3), CANNOT_DIVIDE);
  assert.equal(measureAt(entity('INSERT', [[2, 'B'], [10, 0], [20, 0]]), [0, 0], 3), CANNOT_DIVIDE);
  assert.equal(divideAt(null, [0, 0], 3), CANNOT_DIVIDE);
  assert.equal(divideAt(l, null, 3), CANNOT_DIVIDE);
  assert.equal(divideAt(l, [NaN, 0], 3), CANNOT_DIVIDE);
  for (const n of [0, 1, -3, 32768, 2.5, NaN, '4']) assert.equal(divideAt(l, [0, 0], n), BAD_COUNT, String(n));
  for (const n of [0, -5, NaN, Infinity, undefined]) assert.equal(measureAt(l, [0, 0], n), BAD_LENGTH, String(n));
  assert.equal(measureAt(l, [0, 0], 0.001), TOO_MANY);
  assert.equal(divideAt(line(5, 5, 5, 5), [5, 5], 3), CANNOT_DIVIDE);       // zero length
  const tilted = arc(0, 0, 10, 0, 90); tilted.r.c.push(210, 220, 230); tilted.r.v.push('0.5', '0', '0.5');
  assert.equal(divideAt(tilted, [10, 0], 3), CANNOT_DIVIDE);
});
