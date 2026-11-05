import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from './web/dxf-write.js';
import { alignTransform, alignMatrix, alignEntities } from './web/align.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const ends = (e) => { const f = (c) => +e.r.v[e.r.c.indexOf(c)]; return [f(10), f(20), f(11), f(21)]; };

test('one pair is a move', () => {
  const t = alignTransform([1, 2], [4, 6]);
  assert.deepEqual([t.dx, t.dy, t.angle, t.factor], [3, 4, 0, 1]);
  assert.deepEqual(apply(alignMatrix(t), [1, 2]), [4, 6]);
});

test('two pairs move and turn the source line onto the destination line', () => {
  const t = alignTransform([0, 0], [10, 0], [1, 0], [10, 5]);
  near(t.angle, 90); assert.equal(t.factor, 1);
  const [x, y] = apply(alignMatrix(t), [1, 0]);
  near(x, 10); near(y, 1);                                         // no scale: the second point lands on the destination line, 1 away
});

test('Scale Yes scales about the first destination point by |dst1-dst2| / |src1-src2|', () => {
  const t = alignTransform([0, 0], [10, 0], [2, 0], [10, 5], true);
  near(t.factor, 2.5); near(t.angle, 90);
  const m = alignMatrix(t), [x, y] = apply(m, [2, 0]);
  near(x, 10); near(y, 5);                                         // the second source point reaches its destination
  assert.deepEqual(apply(m, [0, 0]).map((v) => Math.round(v)), [10, 0]);
});

test('Scale No keeps the size; the angle is never past 180', () => {
  const t = alignTransform([0, 0], [0, 0], [1, 0], [-3, -0.0001], false);
  assert.equal(t.factor, 1); assert.ok(t.angle > -180 && t.angle <= 180);
});

test('coincident source or destination points are refused', () => {
  assert.match(alignTransform([1, 1], [5, 5], [1, 1], [9, 9]).error, /source/);
  assert.match(alignTransform([1, 1], [5, 5], [2, 2], [5, 5]).error, /destination/);
});

test('alignEntities moves, turns and scales a line with the real Move / Rotate / Scale code', () => {
  const raw = { ...W.newDoc(), entities: [W.line(0, 0, 2, 0), W.line(50, 50, 51, 51)] };
  const t = alignTransform([0, 0], [10, 0], [2, 0], [10, 5], true), r = alignEntities(raw, new Set([0]), t);
  const [x1, y1, x2, y2] = ends(r.entities[0]);
  [x1 - 10, y1, x2 - 10, y2 - 5].forEach((v) => near(v, 0));
  assert.equal(r.entities[1], raw.entities[1]);                     // an unselected object stays the very same one
});
