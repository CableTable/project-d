// arrange.js — Align and Distribute, groups as objects.   node arrange.test.mjs
import assert from 'node:assert/strict';
import * as A from './web/arrange.js';
import * as P from './web/place.js';
import { placedBox, placement1 } from './web/apply.js';
import { newDoc, addEntities, addBlock, entity, line } from './web/dxf-write.js';

const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, a + ' != ' + b);
let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }

test('drawing deltas move each object once, leave unselected objects and the source alone, and skip zero moves', () => {
  const raw = newDoc(4);
  addEntities(raw, line(10, 20, 30, 40), line(50, 60, 70, 80), line(90, 100, 110, 120));
  const before = structuredClone(raw), zero = { dx: 0, dy: 0 };
  assert.equal(A.moveByDeltas(raw, [0, 1], [zero, zero]), raw);
  const next = A.moveByDeltas(raw, [1, 0], [{ dx: -40, dy: 5 }, { dx: 3, dy: -2 }]);
  const point = (e) => [10, 20].map((c) => Number(e.r.v[e.r.c.indexOf(c)]));
  assert.deepEqual(next.entities.map(point), [[13, 18], [10, 65], [90, 100]]);
  assert.equal(next.entities[2], raw.entities[2]);
  assert.deepEqual(raw, before);
  assert.throws(() => A.moveByDeltas(raw, [0], [{ dx: NaN, dy: 0 }]), /finite/);
});

test('drawing deltas preserve successive edits to shared native dimension blocks', () => {
  const raw = newDoc(4);
  addBlock(raw, '*D1', [line(0, 0, 10, 0)]);
  addEntities(raw, ...[0, 1].map(() => entity('DIMENSION', [[2, '*D1'], [10, 0], [20, 0], [11, 5], [21, 5], [13, 0], [23, 0], [14, 10], [24, 0]])));
  const next = A.moveByDeltas(raw, [0, 1], [{ dx: 20, dy: 0 }, { dx: 40, dy: 0 }]);
  const names = next.entities.map((e) => e.r.v[e.r.c.indexOf(2)]);
  assert.notEqual(names[0], names[1]);
  assert.deepEqual(names.map((name) => Number(next.blocks[name].entities[0].r.v[next.blocks[name].entities[0].r.c.indexOf(10)])), [20, 40]);
  const original = raw.blocks['*D1'].entities[0].r;
  assert.equal(Number(original.v[original.c.indexOf(10)]), 0);
});

// three boxes at different heights, as on the mock-up
const B = [[90, 90, 390, 210], [480, 70, 590, 180], [740, 120, 900, 220]];

test('TODO 265: centre both axes on the first object, including a group, without changing the input', () => {
  const items = [{ box: [100, 100, 180, 100] }, { g: 'pair', box: [220, 180, 260, 220] }, { g: 'pair', box: [320, 300, 380, 340] }];
  const before = structuredClone(items), objects = A.objectsOf(items);
  const deltas = A.centreOnFirstDeltas(objects.map((o) => o.box));
  assert.deepEqual(deltas, [{ dx: 0, dy: 0 }, { dx: -160, dy: -160 }]);
  assert.deepEqual(A.spreadToItems(objects, deltas, items.length), [deltas[0], deltas[1], deltas[1]]);
  assert.deepEqual(items, before);
  assert.deepEqual(A.centreOnFirstDeltas([[0, 0, 20, 20], [5, 5, 15, 15]]), [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
  assert.deepEqual(A.centreOnFirstDeltas([]), []);
});

test('unionBox', () => {
  assert.deepEqual(A.unionBox(B), [90, 70, 900, 220]);
  assert.equal(A.unionBox([]), null);
});

test('TODO 281: centre the selection as one block on the whole sheet', () => {
  const sheet = [0, 0, 1000, 700];
  for (const boxes of [[], [[10, 20, 110, 60]], B, [[-100, -80, 1200, 900]], [[450, 300, 550, 400]], [[100, 200, 100, 200]]]) {
    const before = structuredClone(boxes), deltas = A.alignDeltas(boxes, 'page', 'sheet', sheet);
    assert.equal(deltas.length, boxes.length);
    assert.deepEqual(boxes, before, 'inputs unchanged');
    if (!boxes.length) continue;
    const moved = boxes.map((b, i) => b.map((v, axis) => v + (axis % 2 ? deltas[i].dy : deltas[i].dx)));
    const union = A.unionBox(moved);
    near((union[0] + union[2]) / 2, 500); near((union[1] + union[3]) / 2, 350);
    assert.ok(deltas.every((d) => d.dx === deltas[0].dx && d.dy === deltas[0].dy), 'spacing kept');
    assert.ok(deltas.every((d) => !Object.is(d.dx, -0) && !Object.is(d.dy, -0)));
    assert.deepEqual(A.alignDeltas(moved, 'page', 'sheet', sheet), boxes.map(() => ({ dx: 0, dy: 0 })));
  }
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

test('TODO 291: last selected stays put for all six alignments', () => {
  const before = structuredClone(B);
  const expected = [[650, 260, 0], [580, 285, 0], [510, 310, 0], [10, 40, 0], [20, 45, 0], [30, 50, 0]];
  A.ALIGN_HOW.forEach((how, i) => {
    const deltas = A.alignDeltas(B, how, 'last');
    assert.deepEqual(deltas.map((d) => i < 3 ? d.dx : d.dy), expected[i], how);
    assert.deepEqual(deltas.at(-1), { dx: 0, dy: 0 }, 'last stays put');
  });
  assert.deepEqual(B, before);
});

test('TODO 291 fix: a group sits at its last-picked member, so it is the last object when a line is picked between', () => {
  const items = [{ g: 'G', box: [0, 0, 10, 10] }, { box: [50, 0, 60, 10] }, { g: 'G', box: [20, 0, 30, 10] }];
  const objs = A.objectsOf(items);
  const deltas = A.alignDeltas(objs.map((o) => o.box), 'left', 'last', null, 0, null, A.lastObjectOf(objs));
  assert.deepEqual(deltas, [{ dx: 0, dy: 0 }, { dx: -50, dy: 0 }], 'the group stays, the line moves');
});

test('TODO 291: a point is a zero-size frame for all six alignments, including one object', () => {
  const before = structuredClone(B), point = [0, -25];
  const expected = [[-90, -480, -740], [-240, -535, -820], [-390, -590, -900], [-235, -205, -245], [-175, -150, -195], [-115, -95, -145]];
  A.ALIGN_HOW.forEach((how, i) => {
    const deltas = A.alignDeltas(B, how, 'point', null, 0, point);
    assert.deepEqual(deltas, expected[i].map((v) => ({ dx: i < 3 ? v : 0, dy: i < 3 ? 0 : v })), how);
    assert.deepEqual(A.alignDeltas([B[0]], how, 'point', null, 0, point), [deltas[0]], 'one object');
  });
  assert.deepEqual(A.alignDeltas([], 'left', 'point', null, 0, point), []);
  assert.deepEqual(B, before); assert.deepEqual(point, [0, -25]);
});

test('TODO 291: Last selected and Point distribute over the selection span on both axes', () => {
  for (const axis of ['x', 'y']) for (const rel of ['last', 'point']) {
    assert.deepEqual(A.distributeDeltas(B, axis, rel, [0, 0, 1000, 700]), A.distributeDeltas(B, axis));
  }
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

test('TODO 292: all six chosen edges are evenly spaced; Selection anchors, Rectangle and Sheet flush whole boxes', () => {
  const boxes = [[-25.1, -20.2, 120, 150], [5.1, 10.2, 15, 20], [160, 200, 210.1, 260.2], [40, 50, 60, 80]];
  const before = structuredClone(boxes), frame = [-20, -40, 300, 400];
  for (const how of A.ALIGN_HOW) {
    const a = ['left', 'centre', 'right'].includes(how) ? 0 : 1, b = a + 2;
    const edge = (box) => ['centre', 'middle'].includes(how) ? (box[a] + box[b]) / 2 : box[['right', 'top'].includes(how) ? b : a];
    const order = boxes.map((_, i) => i).sort((p, q) => edge(boxes[p]) - edge(boxes[q]) || boxes[p][a] - boxes[q][a] || boxes[p][b] - boxes[q][b] || p - q);
    for (const rel of ['selection', 'rectangle', 'sheet']) {
      const r = A.distributeDeltas(boxes, a ? 'y' : 'x', rel, frame, how);
      const moved = boxes.map((box, i) => box.map((v, k) => v + (k % 2 ? r.deltas[i].dy : r.deltas[i].dx)));
      const edges = order.map((i) => edge(moved[i]));
      for (let i = 1; i < edges.length; i++) near(edges[i] - edges[i - 1], (edges.at(-1) - edges[0]) / 3);
      if (rel === 'selection') {
        assert.deepEqual(moved[order[0]], boxes[order[0]]); assert.deepEqual(moved[order.at(-1)], boxes[order.at(-1)]);
      } else { near(moved[order[0]][a], frame[a]); near(moved[order.at(-1)][b], frame[b]); }
      assert.ok(r.deltas.every((d) => (a ? d.dx : d.dy) === 0));
    }
  }
  assert.deepEqual(boxes, before); assert.deepEqual(frame, [-20, -40, 300, 400]);
});

test('TODO 292: chosen-edge ties use the old axis/extent/index order, including identical boxes', () => {
  const boxes = [[5, 0, 15, 10], [0, 0, 20, 10], [0, 0, 20, 10], [30, 0, 50, 10]];
  const r = A.distributeDeltas(boxes, 'x', 'selection', null, 'centre');
  assert.deepEqual(r.deltas.map((d) => d.dx), [20, 0, 10, 0]);
  const right = A.distributeDeltas([[5, 0, 20, 10], [0, 0, 20, 10], [30, 0, 50, 10]], 'x', 'selection', null, 'right');
  assert.deepEqual(right.deltas.map((d) => d.dx), [15, 0, 0]);
});

test('TODO 292: Rectangle and Sheet accept two objects and negative gaps, Selection still needs three', () => {
  assert.ok(A.REL.includes('rectangle'));
  for (const rel of ['rectangle', 'sheet']) for (const how of ['gap', ...A.ALIGN_HOW]) {
    const axis = ['top', 'middle', 'bottom'].includes(how) ? 'y' : 'x';
    const r = A.distributeDeltas([[10, 10, 110, 110], [200, 200, 250, 250]], axis, rel, [0, 0, 20, 20], how);
    assert.ok(r); if (how === 'gap') near(r.gap, -130);
    assert.equal(A.distributeDeltas([[10, 10, 110, 110]], axis, rel, [0, 0, 20, 20], how), null);
  }
  assert.equal(A.distributeDeltas(B.slice(0, 2), 'x', 'selection', null, 'left'), null);
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
