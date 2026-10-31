import test from 'node:test';
import assert from 'node:assert/strict';
import { offsetEntity, canOffset, canModify, pathOf, closest, trimEntity } from './web/modify.js';
import { ellipse, entity, newDoc, writeDxf } from './web/dxf-write.js';
import { readDxf, nurbsAt } from './web/drawing.js';
import { curveShape, isBoundary, rayHit } from './web/extend.js';
import { get } from './web/grips.js';
import { offsetStats } from './web/offsetcurve.js';

const shape = (ent) => pathOf(curveShape(ent));
const offset = (ent, d, at) => {
  const r = offsetEntity(ent, d, at);
  assert.ok(r.ent, r.error);
  assert.equal(r.ent.type, 'SPLINE'); assert.equal(get(r.ent.r, 71), 3);
  return r.ent;
};
const spline = (cp, knots, closed = false, weights = []) => entity('SPLINE', [[70, closed ? 1 : 0], [71, 3],
  ...knots.map((v) => [40, v]), ...weights.map((v) => [41, v]), ...cp.flatMap(([x, y]) => [[10, x], [20, y], [30, 0]])]);

test('TODO 155g2: 100 x 40 ellipse offsets stay within 0.01 at 100 true normal points, with compact fit records', () => {
  for (const [a, b] of [[100, 40], [50, 20], [10000, 4000]]) {
    for (const side of [-1, 1]) {
      const source = ellipse(0, 0, a, 0, b / a, 0, Math.PI * 2, { layer: 'Cut', aci: 3, lt: 'DASHED', lw: 25, ps: true });
      const result = offset(source, 5, side > 0 ? [a + 10, 0] : [0, 0]), P = shape(result);
      assert.equal(get(result.r, 70) & 1, 1);
      assert.equal(get(result.r, 74), P.segs.length);
      for (const key of ['layer', 'aci', 'lt', 'lw', 'ps']) assert.equal(result[key], source[key]);
      for (let i = 0; i < 100; i++) {
        const t = (i + 0.37) * Math.PI * 2 / 100, x = a * Math.cos(t), y = b * Math.sin(t);
        const nx = Math.cos(t) / a, ny = Math.sin(t) / b, len = Math.hypot(nx, ny);
        const miss = closest(P, [x + side * 5 * nx / len, y + side * 5 * ny / len]).d;
        assert.ok(miss <= 0.01, `a=${a}, side=${side}, point=${i}: ${miss}`);
      }
      if (a === 100) assert.ok(P.segs.length < 400, `redundant samples dropped: ${P.segs.length}`);
      const doc = newDoc(); doc.entities = [result];
      const reopened = readDxf(writeDxf(doc)).entities[0], R = shape(reopened);
      assert.equal(reopened.type, 'SPLINE'); assert.equal(get(reopened.r, 70) & 1, 1);
      assert.equal(R.segs.length, P.segs.length);
      P.segs.forEach((s) => assert.ok(closest(R, s.a).d < 0.000002, 'DXF fit points keep the same shape'));
    }
  }
});

test('TODO 155g2: rotated and reversed ellipses, elliptical arcs, folds and invalid distances', () => {
  for (const source of [ellipse(50, 60, 80, 60, 0.4), entity('ELLIPSE', [[10, 0], [20, 0], [11, 100], [21, 0], [40, 0.4], [230, -1]])]) {
    assert.equal(get(offset(source, 5, [300, 300]).r, 70) & 1, 1);
  }
  const source = ellipse(0, 0, 100, 0, 0.4);
  for (const d of [16, 17, 50]) assert.match(offsetEntity(source, d, [0, 0]).error, /nothing is left/);
  assert.ok(offsetEntity(source, 15.9, [0, 0]).ent, 'just below the tightest radius remains possible');
  assert.match(offsetEntity(source, 0, [0, 0]).error, /more than 0/);
  assert.match(offsetEntity(source, NaN, [0, 0]).error, /more than 0/);
  assert.match(offsetEntity(source, null, [100, 0]).error, /on the object/);
  const arc = offset(ellipse(0, 0, 100, 0, 0.4, 0, Math.PI / 2), 5, [120, 0]);
  assert.equal(get(arc.r, 70) & 1, 0);
  const pts = curveShape(arc).pts;
  assert.ok(Math.hypot(pts[0][0] - 105, pts[0][1]) < 1e-6);
  assert.ok(Math.hypot(pts.at(-1)[0], pts.at(-1)[1] - 45) < 1e-6);
  assert.equal(canOffset(source), true); assert.equal(canModify(source), false, 'Trim predicate stays unchanged');
  assert.match(trimEntity(source, [], [0, 0]).error, /Trim takes/);
});

test('TODO 155g2: open cubic spline Through measures nearest curve point; offsets and source edits are independent', () => {
  const cp = [[0, 0], [30, 80], [70, 80], [100, 0]], knots = [0, 0, 0, 0, 1, 1, 1, 1];
  const source = spline(cp, knots), before = JSON.stringify(source), target = [50, 67];
  const result = offset(source, null, target), P = shape(result);
  assert.equal(get(result.r, 70) & 1, 0);
  assert.ok(closest(P, target).d < 0.01, 'Through passes through a point 7 above the curve');
  assert.equal(JSON.stringify(source), before);
  for (let i = 0; i < 100; i++) {
    const u = (i + 0.2) / 100, p = nurbsAt(cp, knots, 3, null, u), q = nurbsAt(cp, knots, 3, null, u + 1e-6);
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    assert.ok(closest(P, [p[0] - 7 * dy / len, p[1] + 7 * dx / len]).d < 0.01);
  }
  const pastEnd = offset(source, null, [-5, -10]);
  assert.equal(get(pastEnd.r, 70) & 1, 0, 'Through past an end uses nearest finite-curve distance');
  const doc = newDoc(); doc.entities = [result];
  const reopened = readDxf(writeDxf(doc)).entities[0];
  assert.equal(get(reopened.r, 70) & 1, 0);
  assert.ok(closest(shape(reopened), target).d < 0.01);
  source.r.v[source.r.c.indexOf(10)] = '500';
  assert.ok(closest(shape(result), target).d < 0.01, 'editing the source leaves its copy alone');
  assert.equal(isBoundary(result), true);
  assert.ok(rayHit([50, 100], [50, 90], [curveShape(result)]), 'Extend reads the result');
});

test('TODO 155g2: closed spline, fit-only spline and Multiple results can be offset again', () => {
  const fit = entity('SPLINE', [[70, 0], [71, 3], [11, 0], [21, 0], [11, 100], [21, 0]]);
  const first = offset(fit, null, [50, 7]);
  assert.deepEqual(curveShape(first).pts, [[0, 7], [100, 7]]);
  assert.deepEqual(curveShape(offset(first, 7, [50, 20])).pts, [[0, 14], [100, 14]]);
  const ring = offset(ellipse(0, 0, 100, 0, 0.4), 5, [120, 0]);
  const again = offset(ring, 5, [120, 0]);
  assert.equal(get(again.r, 70) & 1, 1);
  assert.ok(Math.abs(Math.max(...curveShape(again).pts.map((p) => p[0])) - 110) < 0.01);
  const closed = entity('SPLINE', [[70, 1], [71, 3], ...[[0, 0], [100, 0], [100, 80], [0, 80]].flatMap(([x, y]) => [[11, x], [21, y]])]);
  assert.equal(get(offset(closed, 5, [-10, 40]).r, 70) & 1, 1);
  assert.match(offsetEntity(closed, 60, [50, 40]).error, /nothing is left/);
  const nonperiodic = spline([[0, 0], [100, 0], [100, 100], [0, 100]], [0, 0, 0, 0, 1, 1, 1, 1], true);
  const withClosingEdge = offset(nonperiodic, 5, [-10, 50]);
  assert.equal(get(withClosingEdge.r, 70) & 1, 1);
  assert.ok(closest(shape(withClosingEdge), [-5, 50]).d < 0.01, 'the closing edge is offset as well');
});

test('TODO 155g2: a closed rational NURBS offsets with its weights, stays closed and refuses an inward fold', () => {
  const cp = [[40, 0], [40, 40], [0, 40], [-40, 40], [-40, 0], [-40, -40], [0, -40], [40, -40], [40, 0]];
  const ring = entity('SPLINE', [[70, 5], [71, 2], ...[0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4].map((v) => [40, v]),
    ...cp.flatMap(([x, y], i) => [[41, i % 2 ? Math.SQRT1_2 : 1], [10, x], [20, y], [30, 0]])]);
  for (const side of [-1, 1]) {
    const result = offset(ring, 5, [side > 0 ? 60 : 0, 0]), P = shape(result);
    assert.equal(get(result.r, 70) & 1, 1);
    for (let i = 0; i < 100; i++) {
      const t = (i + 0.37) * Math.PI * 2 / 100, r = 40 + side * 5;
      assert.ok(closest(P, [r * Math.cos(t), r * Math.sin(t)]).d <= 0.01);
    }
  }
  assert.match(offsetEntity(ring, 41, [0, 0]).error, /nothing is left/);
});

// A cubic spline with a triple control point: straight along y = 0 to (100, 0), a sharp corner there, then straight up x = 100.
const corner = () => spline([[0, 0], [50, 0], [100, 0], [100, 0], [100, 0], [100, 50], [100, 100]], [0, 0, 0, 0, 1, 2, 3, 4, 4, 4, 4]);
const line = (a, b, n) => Array.from({ length: n }, (_, i) => [a[0] + (b[0] - a[0]) * (i + 0.5) / n, a[1] + (b[1] - a[1]) * (i + 0.5) / n]);

test('TODO 155g2: a spline corner is rounded outside (to 0.01) and clipped at the crossing inside', () => {
  const source = corner();
  const outside = shape(offset(source, 5, [50, -10]));
  const round = Array.from({ length: 20 }, (_, i) => { const t = -Math.PI / 2 + (i + 0.5) * Math.PI / 40; return [100 + 5 * Math.cos(t), 5 * Math.sin(t)]; });
  [...line([0, -5], [100, -5], 40), ...round, ...line([105, 0], [105, 100], 40)].forEach((p, i) => assert.ok(closest(outside, p).d <= 0.01, `outside point ${i}: ${closest(outside, p).d}`));
  const inside = shape(offset(source, 5, [50, 10]));
  [...line([0, 5], [90, 5], 50), ...line([95, 10], [95, 100], 49), [95, 5]].forEach((p, i) => assert.ok(closest(inside, p).d <= 0.01, `inside point ${i}: ${closest(inside, p).d}`));
  assert.ok(closest(inside, [100, 5]).d > 4, 'nothing runs on into the overlap');
  assert.match(offsetEntity(source, 200, [50, 10]).error, /nothing is left/);
});

test('TODO 155g2: a tiny ellipse (R 0.25) offsets within 0.001 of its size (the bounding-box diagonal)', () => {
  const source = ellipse(0, 0, 0.25, 0, 1), size = 0.5 * Math.SQRT2;
  for (const [side, r] of [[1, 0.3], [-1, 0.2]]) {
    const P = shape(offset(source, 0.05, side > 0 ? [1, 0] : [0, 0]));
    for (let i = 0; i < 100; i++) {
      const t = (i + 0.37) * Math.PI * 2 / 100, miss = closest(P, [r * Math.cos(t), r * Math.sin(t)]).d;
      assert.ok(miss < 0.001 * size, `side ${side}, point ${i}: ${miss}`);
    }
    P.segs.forEach((s) => assert.ok(Math.abs(Math.hypot(...s.a) - r) < 0.001 * size));
    assert.ok(P.segs.length > 30, 'still smooth: more than the 8-ish points 0.008 would keep');
  }
});

test('TODO 155g2: the same entity, distance and side is worked out once (the live preview)', () => {
  const source = ellipse(0, 0, 100, 0, 0.4), before = offsetStats.builds;
  offsetEntity(source, 5, [150, 0]); offsetEntity(source, 5, [200, 10]); offsetEntity(source, 5, [150, 0]);
  assert.equal(offsetStats.builds, before + 1, 'same side, same distance: one build');
  offsetEntity(source, 6, [150, 0]);
  assert.equal(offsetStats.builds, before + 2, 'another distance builds again');
  offsetEntity(source, 6, [0, 0]);
  assert.equal(offsetStats.builds, before + 3, 'the other side builds again');
  source.r.v[source.r.c.indexOf(40)] = '120';
  offsetEntity(source, 6, [0, 0]);
  assert.equal(offsetStats.builds, before + 4, 'an edited entity builds again');
});
