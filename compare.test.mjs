// compare.js — Compare two drawings.   node compare.test.mjs
import assert from 'node:assert/strict';
import * as C from './web/compare.js';
import { newDoc, addEntities, writeDxf, line, circle, arc, rect, roundRect, text } from './web/dxf-write.js';
import { readDxf, flatten } from './web/drawing.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const outlines = (...ents) => { const d = newDoc(4); addEntities(d, ents); const fl = flatten(readDxf(writeDxf(d))); return C.polylines(fl, 1); };
/** The plate of the board: 300 × 180 with two holes and two small circles (revision b), and revision c with a wider plate, one hole bigger, one circle moved. */
const plateB = () => outlines(rect(0, 0, 300, 180), circle(80, 90, 30), circle(220, 90, 30), circle(120, 40, 8), circle(150, 150, 6));
const plateC = () => outlines(rect(0, 0, 301.1, 180), circle(80, 90, 30), circle(220, 90, 30.65), circle(120.42, 40, 8), circle(150, 150, 6));

test('polylines: lines, a rectangle, circles and arcs become outlines in mm; arcs are within 0.01 mm of true; text is left out', () => {
  const r = outlines(line(0, 0, 10, 0), circle(50, 50, 20), arc(0, 0, 100, 0, 90), text(0, 0, 5, 'x'));
  assert.equal(r.polys.length, 3);
  const circ = r.polys[1];
  for (let i = 0; i < circ.length; i += 2) near(Math.hypot(circ[i] - 50, circ[i + 1] - 50), 20, 0.011);
  for (let i = 1; i < circ.length / 2; i++) { const m = [(circ[i * 2] + circ[i * 2 - 2]) / 2, (circ[i * 2 + 1] + circ[i * 2 - 1]) / 2]; near(Math.hypot(m[0] - 50, m[1] - 50), 20, 0.011); }
  assert.ok(Math.abs(circ[0] - circ[circ.length - 2]) < 1e-6 && Math.abs(circ[1] - circ[circ.length - 1]) < 1e-6, 'a circle comes back to where it started');
  const a = r.polys[2];
  near(a[0], 100, 1e-6); near(a[1], 0, 1e-6); near(a[a.length - 2], 0, 1e-6); near(a[a.length - 1], 100, 1e-6);
  assert.deepEqual(r.box.map((v) => Math.round(v)), [0, 0, 100, 100]);
});

test('polylines: units become mm (a drawing in inches)', () => {
  const d = newDoc(1); addEntities(d, [line(0, 0, 10, 0)]);
  const fl = flatten(readDxf(writeDxf(d)));
  const r = C.polylines(fl, 25.4);
  near(r.box[2], 254, 1e-9);
});

test('lineUp: bottom-left puts the second drawing\'s corner on the first\'s; centres puts the middles together; manual is what was typed', () => {
  const a = [0, 0, 300, 180], b = [10, 5, 310, 185], c = [-50, -20, 50, 20];
  assert.deepEqual(C.lineUp(a, b, 'bl'), [-10, -5]);
  assert.deepEqual(C.lineUp(a, c, 'centre'), [150, 90]);
  assert.deepEqual(C.lineUp(a, b, 'manual', [3, -4]), [3, -4]);
  assert.deepEqual(C.lineUp(null, b, 'bl', [1, 2]), [1, 2]);
});

test('the same drawing twice: no differences', () => {
  const r = C.compare(plateB().polys, plateB().polys, 0.1);
  assert.deepEqual(r.diffs, []); assert.equal(r.truncated, false); assert.ok(r.samples > 1000);
});

test('the board\'s two plate revisions: the differences are numbered from the left, each with how far off it is at the worst point', () => {
  // a circle moved 0.42 mm is off by more than 0.1 only at its left and right (two places); a hole 0.65 bigger is off all the way round (one); the plate 1.1 wider along its right side (one)
  const r = C.compare(plateB().polys, plateC().polys, 0.1);
  assert.equal(r.diffs.length, 4, JSON.stringify(r.diffs.map((d) => [d.x.toFixed(1), d.y.toFixed(1), d.mm.toFixed(2)])));
  assert.deepEqual(r.diffs.map((d) => d.n), [1, 2, 3, 4]);
  const [d1, d2, d3, d4] = r.diffs;
  near(d1.mm, 0.42, 0.02); near(d1.x, 112, 0.6); near(d2.mm, 0.42, 0.02); near(d2.x, 128, 0.6);
  near(d3.mm, 0.65, 0.02); assert.ok(d3.box[2] - d3.box[0] > 55, 'the whole ring of the hole');
  near(d4.mm, 1.1, 0.02); near(d4.x, 300, 0.7); assert.ok(d4.box[3] - d4.box[1] > 150, 'the whole right side');
  assert.ok(r.diffs.every((d, i) => i === 0 || r.diffs[i - 1].x <= d.x), 'from the left');
  assert.ok(r.diffs.every((d) => d.side === 'AB'), 'the outlines are each other\'s neighbours, so both sides differ');
});

test('the tolerance: a circle moved 0.42 mm is off at its left and right (two places) at 0.1 and 0.4, nowhere at 0.5', () => {
  const a = outlines(circle(0, 0, 30)), b = outlines(circle(0.42, 0, 30));
  assert.equal(C.compare(a.polys, b.polys, 0.1).diffs.length, 2);
  assert.equal(C.compare(a.polys, b.polys, 0.4).diffs.length, 2);
  assert.equal(C.compare(a.polys, b.polys, 0.5).diffs.length, 0);
  const d = C.compare(a.polys, b.polys, 0.1).diffs[0];
  near(d.mm, 0.42, 0.01);
});

test('something only one has: one difference on that side, at the distance to the nearest outline', () => {
  const a = outlines(rect(0, 0, 100, 60)), b = outlines(rect(0, 0, 100, 60), circle(50, 30, 5));
  const r = C.compare(a.polys, b.polys, 0.1);
  assert.equal(r.diffs.length, 1);
  assert.equal(r.diffs[0].side, 'B'); near(r.diffs[0].mm, 30, 1); assert.ok(r.diffs[0].samples > 100);
  const r2 = C.compare(b.polys, a.polys, 0.1);
  assert.equal(r2.diffs[0].side, 'A');
});

test('a second drawing moved onto the first with Line up has no differences; left where it is, it has', () => {
  const a = outlines(roundRect(0, 0, 120, 80, 10), circle(60, 40, 15)), moved = outlines(roundRect(500, 300, 120, 80, 10), circle(560, 340, 15));
  assert.ok(C.compare(a.polys, moved.polys, 0.1).diffs.length > 0);
  const off = C.lineUp(a.box, moved.box, 'bl');
  assert.deepEqual(off.map((v) => Math.round(v)), [-500, -300]);
  assert.equal(C.compare(a.polys, moved.polys, 0.1, { offsetB: off }).diffs.length, 0);
  const offC = C.lineUp(a.box, moved.box, 'centre');
  assert.equal(C.compare(a.polys, moved.polys, 0.1, { offsetB: offC }).diffs.length, 0);
  const near1 = C.compare(a.polys, moved.polys, 0.1, { offsetB: [off[0] + 2, off[1]] });
  assert.ok(near1.diffs.length > 0, 'two millimetres out');
});

test('nothing to compare: an empty drawing gives no differences, and one against nothing is all different', () => {
  assert.deepEqual(C.compare([], [], 0.1).diffs, []);
  const a = outlines(rect(0, 0, 10, 10));
  const r = C.compare(a.polys, [], 0.1);
  assert.equal(r.diffs.length, 1); assert.equal(r.diffs[0].side, 'A');
});

test('boxOf and the colours', () => {
  assert.equal(C.boxOf([]), null);
  assert.deepEqual(C.boxOf([Float64Array.from([1, 2, 5, 9])]), [1, 2, 5, 9]);
  assert.deepEqual(C.COLOURS.map((c) => c.id), ['red', 'blue', 'green', 'orange', 'purple']);
  assert.equal(C.DEFAULT_TOL, 0.1);
});

test('a big drawing stays quick: 200 circles, a few of them moved', () => {
  const circles = (dx) => Array.from({ length: 200 }, (_, i) => circle((i % 20) * 40 + (i === 7 ? dx : 0), Math.floor(i / 20) * 40, 15));
  const a = outlines(...circles(0)), b = outlines(...circles(0.5));
  const t0 = Date.now();
  const r = C.compare(a.polys, b.polys, 0.1);
  assert.equal(r.diffs.length, 2, 'the moved circle is off at its left and right');
  assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + ' ms');
});

console.log(n + ' compare tests passed');
