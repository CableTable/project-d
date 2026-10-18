// arrange.js — Align and Distribute, groups as objects.   node arrange.test.mjs
import assert from 'node:assert/strict';
import * as A from './web/arrange.js';
import * as P from './web/place.js';
import { placedBox, placement1 } from './web/apply.js';

const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, a + ' != ' + b);
let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }

// three boxes at different heights, as on the mock-up
const B = [[90, 90, 390, 210], [480, 70, 590, 180], [740, 120, 900, 220]];

test('unionBox', () => {
  assert.deepEqual(A.unionBox(B), [90, 70, 900, 220]);
  assert.equal(A.unionBox([]), null);
});

test('align relative to the selection: left, centre, right', () => {
  assert.deepEqual(A.alignDeltas(B, 'left').map((d) => d.dx), [0, -390, -650]);
  assert.deepEqual(A.alignDeltas(B, 'right').map((d) => d.dx), [510, 310, 0]);
  assert.deepEqual(A.alignDeltas(B, 'centre').map((d) => d.dx), [495 - 240, 495 - 535, 495 - 820]);
  assert.ok(A.alignDeltas(B, 'left').every((d) => d.dy === 0), 'left moves along X only');
});

test('align top, middle, bottom (y up: top is the largest y)', () => {
  assert.deepEqual(A.alignDeltas(B, 'top').map((d) => d.dy), [10, 40, 0]);
  assert.deepEqual(A.alignDeltas(B, 'bottom').map((d) => d.dy), [-20, 0, -50]);
  assert.deepEqual(A.alignDeltas(B, 'middle').map((d) => d.dy), [145 - 150, 145 - 125, 145 - 170]);
});

test('align relative to the sheet and to the first selected', () => {
  const sheet = [0, 0, 1000, 700];
  assert.deepEqual(A.alignDeltas(B, 'left', 'sheet', sheet).map((d) => d.dx), [-90, -480, -740]);
  assert.deepEqual(A.alignDeltas(B, 'top', 'sheet', sheet).map((d) => d.dy), [490, 520, 480]);
  assert.deepEqual(A.alignDeltas(B, 'middle', 'sheet', sheet).map((d) => d.dy), [350 - 150, 350 - 125, 350 - 170]);
  const f = A.alignDeltas(B, 'left', 'first', null, 1);
  assert.deepEqual(f.map((d) => d.dx), [390, 0, -260], 'the first selected (index 1) stays');
  const f2 = A.alignDeltas(B, 'top', 'first', null, 2);
  assert.deepEqual(f2.map((d) => d.dy), [10, 40, 0]);
});

test('align gives no -0', () => {
  const d = A.alignDeltas(B, 'left');
  assert.ok(Object.is(d[0].dx, 0) && Object.is(d[0].dy, 0));
});

test('distribute horizontally: equal gaps, the outer two stay', () => {
  const r = A.distributeDeltas(B, 'x');
  // widths 300 + 110 + 160 = 570, span 810, gaps (810 - 570) / 2 = 120
  near(r.gap, 120);
  const moved = B.map((b, i) => [b[0] + r.deltas[i].dx, b[2] + r.deltas[i].dx]);
  assert.deepEqual(moved[0], [90, 390]); assert.deepEqual(moved[2], [740, 900]);
  near(moved[1][0] - moved[0][1], 120); near(moved[2][0] - moved[1][1], 120);
  assert.ok(r.deltas.every((d) => d.dy === 0));
});

test('distribute works in the boxes\' order, not the pick order', () => {
  const picked = [B[2], B[0], B[1]];
  const r = A.distributeDeltas(picked, 'x');
  const after = picked.map((b, i) => [b[0] + r.deltas[i].dx, b[2] + r.deltas[i].dx]).sort((a, b) => a[0] - b[0]);
  near(after[1][0] - after[0][1], after[2][0] - after[1][1]);
});

test('distribute vertically, and over the sheet', () => {
  const r = A.distributeDeltas(B, 'y');
  const moved = B.map((b, i) => [b[1] + r.deltas[i].dy, b[3] + r.deltas[i].dy]).sort((a, b) => a[0] - b[0]);
  near(moved[1][0] - moved[0][1], moved[2][0] - moved[1][1]);
  assert.equal(moved[0][0], 70); assert.equal(moved[2][1], 220);
  const s = A.distributeDeltas(B, 'x', 'sheet', [0, 0, 1000, 700]);
  const m = B.map((b, i) => [b[0] + s.deltas[i].dx, b[2] + s.deltas[i].dx]);
  assert.equal(m[0][0], 0); assert.equal(m[2][1], 1000);
  near(s.gap, (1000 - 570) / 2);
});

test('distribute needs 3 objects; "first selected" uses the selection span', () => {
  assert.equal(A.distributeDeltas(B.slice(0, 2), 'x'), null);
  const a = A.distributeDeltas(B, 'x', 'first'), b = A.distributeDeltas(B, 'x');
  assert.deepEqual(a, b);
});

test('overlapping boxes: the gap is negative, still equal', () => {
  const boxes = [[0, 0, 100, 10], [20, 0, 120, 10], [40, 0, 140, 10]];
  const r = A.distributeDeltas(boxes, 'x');
  near(r.gap, (140 - 300) / 2);
});

test('groups are one object: members move together', () => {
  const items = [{ g: 'a', box: [0, 0, 10, 10] }, { g: null, box: [50, 0, 60, 10] }, { g: 'a', box: [20, 0, 30, 10] }];
  const objs = A.objectsOf(items);
  assert.equal(objs.length, 2);
  assert.deepEqual(objs[0].members, [0, 2]); assert.deepEqual(objs[0].box, [0, 0, 30, 10]);
  const d = A.alignDeltas(objs.map((o) => o.box), 'right');
  const per = A.spreadToItems(objs, d, 3);
  assert.deepEqual(per.map((x) => x.dx), [30, 0, 30], 'both members of the group move 30');
});

test('isWholeGroup', () => {
  const count = (g) => ({ a: 3, b: 2 })[g];
  assert.equal(A.isWholeGroup([{ g: 'a' }, { g: 'a' }, { g: 'a' }], count), true);
  assert.equal(A.isWholeGroup([{ g: 'a' }, { g: 'a' }], count), false, 'a group has 3 members');
  assert.equal(A.isWholeGroup([{ g: 'a' }, { g: 'b' }], count), false);
  assert.equal(A.isWholeGroup([{ g: undefined }, { g: undefined }], count), false);
});

test('mirrorAboutPoint: a selection mirrors as a whole (X and Y)', () => {
  const part = { w: 100, h: 60 };
  const a = placement1('a', 0, 0), b = placement1('a', 300, 100);
  const cx = 200, cy = 80;                                    // the middle of the box round both: x 0..400, y 0..160
  const ma = P.mirrorAboutPoint(part, a, 'x', cx, cy), mb = P.mirrorAboutPoint(part, b, 'x', cx, cy);
  assert.deepEqual(placedBox(part, ma), [300, 0, 400, 60]);
  assert.deepEqual(placedBox(part, mb), [0, 100, 100, 160]);
  assert.equal(ma.mirrorX, true);
  const ya = P.mirrorAboutPoint(part, a, 'y', cx, cy);
  assert.deepEqual(placedBox(part, ya), [0, 100, 100, 160]);
  // with the part's own centre it is mirrorAbout
  const own = P.centreOf(part, a);
  assert.deepEqual(P.mirrorAboutPoint(part, a, 'x', own[0], own[1]), P.mirrorAbout(part, a, 'x'));
  // twice is the start
  const twice = P.mirrorAboutPoint(part, ma, 'x', cx, cy);
  assert.deepEqual(placedBox(part, twice), placedBox(part, a));
  // a turned part: the box still lands mirrored
  const t = P.rotateAbout(part, a, P.centreOf(part, a), 30);
  const mt = P.mirrorAboutPoint(part, t, 'x', cx, cy), bt = placedBox(part, t), bm = placedBox(part, mt);
  near(bm[0], 2 * cx - bt[2], 1e-5); near(bm[2], 2 * cx - bt[0], 1e-5); near(bm[1], bt[1], 1e-5);
});

test('rowOffsets: copies of a box in a row, edge to edge', () => {
  assert.deepEqual(P.rowOffsets([0, 0, 100, 60], 'x', 5, 3), [[105, 0], [210, 0], [315, 0]]);
  assert.deepEqual(P.rowOffsets([0, 0, 100, 60], '-y', 10, 2), [[0, -70], [0, -140]]);
  assert.deepEqual(P.rowOffsets([10, 10, 50, 40], '-x', 0, 1), [[-40, 0]]);
});

console.log(n + ' arrange tests passed');
