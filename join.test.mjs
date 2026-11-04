import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinEntities, NO_TOUCH } from './web/join.js';
import { line, arc, circle, lwpoly, ellipse, entity } from './web/dxf-write.js';
import { shapeOf, get } from './web/grips.js';
import { offsetEntity } from './web/modify.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 2e-6, `${a} != ${b}`);
const own = { layer: 'Cut', aci: 3, tc: 0x257abd, lt: 'DASHED', lw: 35 };

test('collinear lines: gaps bridged, overlaps merged, result takes the first line properties', () => {
  const { result, skipped } = joinEntities([line(0, 0, 10, 0, own), line(30, 0, 20, 0, { layer: 'Other' }), line(5, 0, 12, 0), line(0, 5, 10, 5)]);
  assert.deepEqual(shapeOf(result), { t: 'line', a: [0, 0], b: [30, 0] });
  assert.deepEqual([result.layer, result.aci, result.tc, result.lt, result.lw], ['Cut', 3, 0x257abd, 'DASHED', 35]);
  assert.deepEqual(skipped.map((s) => s.reason), [NO_TOUCH]);
  assert.equal(joinEntities([line(0, 0, 10, 0), line(0, 0, 10, 0.001)]).result.type, 'LWPOLYLINE', 'a slightly bent pair is not collinear: it touches at one end');
});

test('arcs of one circle: gaps bridged counterclockwise, overlaps merged, cLose makes a circle', () => {
  let s = shapeOf(joinEntities([arc(0, 0, 10, 0, 40), arc(0, 0, 10, 100, 150)]).result);
  near(s.a0, 0); near(s.a1, 150);
  s = shapeOf(joinEntities([arc(0, 0, 10, 0, 40), arc(0, 0, 10, 330, 10)]).result);
  near(s.a0, 330); near(s.a1, 40);
  s = shapeOf(joinEntities([arc(0, 0, 10, 0, 40), arc(0, 0, 10, 300, 0)]).result);
  near(s.a0, 300); near(s.a1, 40);
  const { result, skipped } = joinEntities([arc(0, 0, 10, 0, 90, own), arc(0, 0, 10, 90, 180), arc(0, 0, 11, 180, 270)], { close: true });
  assert.deepEqual(shapeOf(result), { t: 'circle', c: [0, 0], r: 10 }); assert.equal(result.layer, 'Cut'); assert.equal(skipped.length, 1);
  assert.equal(joinEntities([arc(0, 0, 10, 0, 90)], { close: true }).result.type, 'CIRCLE');
  assert.equal(shapeOf(joinEntities([arc(0, 0, 10, 0, 200), arc(0, 0, 10, 180, 20)]).result).t, 'circle', 'arcs covering the whole circle');
});

test('lines and arcs touching end to end become one polyline, turned round as needed, bulges right', () => {
  const a = line(0, 0, 10, 0, own), b = arc(10, 10, 10, 270, 0), c = line(20, 10, 20, 20);          // b: (10,0) → (20,10) bulging right/down
  const out = joinEntities([a, c, b]);
  assert.equal(out.result.type, 'LWPOLYLINE'); assert.equal(out.skipped.length, 0);
  const s = shapeOf(out.result);
  assert.equal(s.closed, false); assert.equal(s.pts.length, 4);
  assert.deepEqual(s.pts.map((p) => p.slice(0, 2).map((v) => Math.round(v * 1e6) / 1e6)), [[0, 0], [10, 0], [20, 10], [20, 20]]);
  near(s.pts[1][2], Math.tan(Math.PI / 8)); assert.equal(s.pts[3][2] ?? 0, 0);
  assert.equal(out.result.layer, 'Cut');
  // the same chain handed in backwards, with a piece drawn the other way, is the same shape the other way round
  const back = shapeOf(joinEntities([line(20, 20, 20, 10), arc(10, 10, 10, 270, 0), line(10, 0, 0, 0)]).result);
  assert.deepEqual(back.pts.map((p) => p.slice(0, 2).map((v) => Math.round(v))), [[20, 20], [20, 10], [10, 0], [0, 0]]);
  near(back.pts[1][2], -Math.tan(Math.PI / 8));
});

test('polylines join with their widths and a chain that closes becomes closed', () => {
  const p = lwpoly([[0, 0], [10, 0, 0.5], [10, 10]], { aci: 5 }), q = line(10, 10, 0, 0), r = line(0, 0, 10, 10);
  const s = shapeOf(joinEntities([p, q]).result);
  assert.equal(s.closed, true); assert.equal(s.pts.length, 3);
  near(s.pts[1][2], 0.5);
  const flipped = shapeOf(joinEntities([lwpoly([[0, 0], [10, 0, 0.5]]), lwpoly([[10, 5], [10, 0]])]).result);
  assert.equal(flipped.closed, false);
  assert.equal(flipped.pts.length, 3);
  assert.equal(joinEntities([r, line(10, 10, 20, 10)]).result.type, 'LWPOLYLINE');
  const wide = entity('LWPOLYLINE', [[90, 2], [70, 0], [10, 10], [20, 5], [40, 1], [41, 4], [10, 0], [20, 5]]);      // (10,5) → (0,5), width 1 → 4
  const reversedWidths = shapeOf(joinEntities([line(0, 0, 0, 5), wide]).result);
  assert.deepEqual(reversedWidths.pts.map((v) => v.slice(0, 2)), [[0, 0], [0, 5], [10, 5]]);
  assert.deepEqual(reversedWidths.pts[1].slice(3), [4, 1], 'a reversed piece swaps its start and end widths');
});

test('what is not joined is named: far pieces, ellipses, splines, closed and other objects', () => {
  const far = line(100, 100, 110, 100), e = ellipse(0, 0, 5, 0, 0.5), sp = entity('SPLINE', [[10, 0], [20, 0]]), c = circle(0, 0, 3), box = lwpoly([[0, 0], [1, 0], [1, 1]], { closed: true }), t = entity('TEXT', [[10, 0], [20, 0]]);
  const { result, skipped } = joinEntities([line(0, 0, 10, 0), arc(10, 5, 5, 270, 0), far, e, sp, c, box, t]);
  assert.equal(result.type, 'LWPOLYLINE');
  assert.deepEqual(skipped.map((s) => s.entity), [e, sp, c, box, t, far]);
  assert.deepEqual(skipped.map((s) => s.reason), ['ellipses and splines are not joined', 'ellipses and splines are not joined', 'closed objects are not joined', 'closed objects are not joined', 'only lines, arcs and polylines are joined', NO_TOUCH]);
  const none = joinEntities([line(0, 0, 10, 0), line(0, 1, 10, 1.001)]);
  assert.equal(none.result, null); assert.equal(none.skipped.length, 2);
  assert.equal(joinEntities([]).result, null);
  assert.equal(joinEntities([e, line(0, 0, 1, 0)]).result, null, 'the source is the first joinable entity, and a lone one has nothing to join');
});

test('ends within 2e-6 touch and 3e-6 do not; a mirrored arc is refused', () => {
  assert.equal(joinEntities([line(0, 0, 10, 0), line(10, 1.5e-6, 10, 10)]).result.type, 'LWPOLYLINE');
  assert.equal(joinEntities([line(0, 0, 10, 0), line(10, 3e-6, 10, 10)]).result, null);
  const mirrored = entity('ARC', [[10, 0], [20, 0], [40, 5], [50, 0], [51, 90], [230, -1]]);
  const { skipped } = joinEntities([line(0, 0, 5, 0), mirrored]);
  assert.match(skipped[0].reason, /mirrored/);
  assert.equal(get(mirrored.r, 230), -1);
});

test('TODO 97d fix: a hat profile joins all 5 lines (the chain beats the 2-line merge); a tie goes to the merge', () => {
  const { result, skipped } = joinEntities([line(0, 0, 10, 0), line(10, 0, 10, 5), line(10, 5, 20, 5), line(20, 5, 20, 0), line(20, 0, 30, 0)]);
  assert.deepEqual(shapeOf(result), { t: 'poly', pts: [[0, 0], [10, 0], [10, 5], [20, 5], [20, 0], [30, 0]], closed: false });
  assert.equal(skipped.length, 0);
  assert.deepEqual(shapeOf(joinEntities([line(0, 0, 10, 0), line(20, 0, 30, 0)]).result), { t: 'line', a: [0, 0], b: [30, 0] });
});

test('TODO 97d fix: a line + arc D-shape is an open 3-vertex polyline (a closed 2-vertex one is not drawn by Offset), and Offset keeps both parts', () => {
  const d = joinEntities([line(0, 0, 10, 0), arc(5, 0, 5, 0, 180)]).result, s = shapeOf(d);
  assert.deepEqual([s.closed, s.pts.length], [false, 3]);
  const o = shapeOf(offsetEntity(d, 1, [5, -3]).ent);
  assert.equal(o.pts.length, 3); assert.ok(o.pts[1][2], 'the arc side is still a bulge');
});
