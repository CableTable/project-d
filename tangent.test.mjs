// tangent.js: the circle tangent to two objects and a radius, or to three objects (TODO 346b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tangentCircle } from './web/tangent.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const nearPt = (a, b, e = 1e-6) => { near(a[0], b[0], e); near(a[1], b[1], e); };
const line = (a, b) => ({ t: 'l', a, b });
const circ = (c, r) => ({ t: 'c', c, r });

test('Ttr: two lines at a right angle, four corners, the one nearest the picks', () => {
  const x = line([0, 0], [10, 0]), y = line([0, 0], [0, 10]);
  for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const c = tangentCircle([x, y], [[sx * 5, 0], [0, sy * 5]], 2);
    nearPt(c.c, [sx * 2, sy * 2]); near(c.r, 2);
  }
  nearPt(tangentCircle([x, y], [[50, 0], [0, 50]], 3).c, [3, 3], 1e-9);       // lines are infinite: the picks may lie beyond the drawn ends
});

test('Ttr: a line and a circle, outside and inside', () => {
  const base = line([-20, 0], [20, 0]);
  const c = tangentCircle([base, circ([0, 8], 5)], [[-3, 0], [-4, 5]], 2);    // sandwiched between the line and the circle, on the left
  near(c.r, 2); near(c.c[1], 2); near(Math.hypot(c.c[0], c.c[1] - 8), 7); assert.ok(c.c[0] < 0);
  const inside = tangentCircle([base, circ([0, 4], 5)], [[2.5, 0], [3.3, -3.75]], 1);      // the circle crosses the line: inside it, above the line, on the right
  near(inside.r, 1); near(inside.c[1], 1); near(Math.hypot(inside.c[0], inside.c[1] - 4), 4); assert.ok(inside.c[0] > 0);
  const below = tangentCircle([base, circ([0, 4], 5)], [[3.3, 0], [2.7, -0.2]], 1);        // picks by the other tangent points: outside the circle, under the line
  near(below.c[1], -1); near(Math.hypot(below.c[0], below.c[1] - 4), 6);
});

test('Ttr: two circles', () => {
  const a = circ([0, 0], 5), b = circ([12, 0], 3);
  const c = tangentCircle([a, b], [[4.5, 2.2], [9.6, 1.8]], 3);               // above both, outside both
  near(c.r, 3); near(Math.hypot(c.c[0], c.c[1]), 8); near(Math.hypot(c.c[0] - 12, c.c[1]), 6); assert.ok(c.c[1] > 0);
  const d = tangentCircle([a, b], [[4.5, -2.2], [9.6, -1.8]], 3);
  assert.ok(d.c[1] < 0, 'the picks below choose the solution below');
});

test('Ttr: no circle', () => {
  assert.equal(tangentCircle([circ([0, 0], 5), circ([30, 0], 5)], [[5, 0], [25, 0]], 1), null, 'too small to span the gap');
  assert.equal(tangentCircle([circ([0, 0], 5), circ([2, 0], 1)], [[5, 0], [3, 0]], 100), null, 'a circle inside another: radius 100 reaches neither');
  assert.equal(tangentCircle([line([0, 0], [10, 0]), line([0, 5], [10, 5])], [[2, 0], [2, 5]], 1), null, 'parallel lines 5 apart: radius 1 cannot touch both');
  assert.equal(tangentCircle([line([0, 0], [10, 0]), line([0, 2], [10, 2])], [[2, 0], [2, 2]], 1), null, 'parallel lines 2r apart: any centre along them (no unique circle)');
  assert.equal(tangentCircle([line([0, 0], [10, 0]), line([3, 0], [20, 0])], [[2, 0], [10, 0]], 1), null, 'the same line twice');
  assert.equal(tangentCircle([circ([0, 0], 5), circ([0, 0], 5)], [[5, 0], [-5, 0]], 1), null, 'the same circle twice');
  assert.equal(tangentCircle([circ([0, 0], 5), circ([0, 0], 8)], [[5, 0], [8, 0]], 1), null, 'concentric circles 3 apart: radius 1 cannot touch both');
});

test('Ttt: the incircle of a triangle of three lines', () => {
  const tri = [line([0, 0], [4, 0]), line([4, 0], [0, 3]), line([0, 3], [0, 0])];       // a 3-4-5 triangle: inradius 1
  const c = tangentCircle(tri, [[2, 0], [2, 1.5], [0, 1.5]]);
  nearPt(c.c, [1, 1]); near(c.r, 1);
  const outer = tangentCircle(tri, [[6, 0], [3, 3], [0, 8]]);                              // picks beyond the sides: an excircle, still tangent to all three lines
  assert.ok(outer.r > 1);
  for (const [a, b] of [[[0, 0], [4, 0]], [[4, 0], [0, 3]], [[0, 3], [0, 0]]]) {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    near(Math.abs((b[0] - a[0]) * (outer.c[1] - a[1]) - (b[1] - a[1]) * (outer.c[0] - a[0])) / l, outer.r);
  }
});

test('Ttt: the unit circle in a corner of a line and a circle, and three circles', () => {
  const c = tangentCircle([line([0, 0], [10, 0]), line([0, 0], [0, 10]), circ([10, 10], 4)], [[3, 0], [0, 3], [7, 8]]);
  near(c.c[0], c.r); near(c.c[1], c.r);                                                  // tangent to both axes: centre on the diagonal
  near(Math.hypot(c.c[0] - 10, c.c[1] - 10), 4 + c.r, 1e-6);                             // and outside the circle
  const objs = [circ([0, 0], 3), circ([10, 0], 3), circ([5, 9], 3)];                    // three equal circles: the inner Soddy circle
  const s = tangentCircle(objs, [[3, 0], [7, 0], [5, 6]]);
  for (const o of objs) near(Math.hypot(s.c[0] - o.c[0], s.c[1] - o.c[1]), o.r + s.r, 1e-6);
  assert.ok(s.r < 3 && s.c[1] > 0 && s.c[1] < 9, 'the small circle between them');
});

test('Ttt: parallel or concentric objects with no unique solution', () => {
  const a = line([0, 0], [10, 0]), b = line([0, 4], [10, 4]);
  assert.equal(tangentCircle([a, b, line([0, 8], [10, 8])], [[1, 0], [1, 4], [1, 8]]), null, 'three parallel lines');
  assert.equal(tangentCircle([a, b, a], [[1, 0], [1, 4], [8, 0]]), null, 'one line twice and a parallel');
  assert.equal(tangentCircle([circ([0, 0], 2), circ([0, 0], 5), circ([0, 0], 9)], [[2, 0], [5, 0], [9, 0]]), null, 'three concentric circles');
  const mid = tangentCircle([a, b, circ([5, 3], 1)], [[8, 0], [8, 4], [6, 2.7]]);           // two parallel lines and a circle between them: radius 2, beside the circle
  near(mid.r, 2); near(mid.c[1], 2); near(mid.c[0], 5 + Math.sqrt(8));
});
