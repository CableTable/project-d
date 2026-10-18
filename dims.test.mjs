// dims.js and the dimension types of edit.js — linear, radius, diameter, angle, read back through Save and reopen.   node dims.test.mjs
import assert from 'node:assert/strict';
import * as E from './web/edit.js';
import * as DM from './web/dims.js';
import { readDxf } from './web/drawing.js';
import { newDoc, writeDxf, circle, arc, line } from './web/dxf-write.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, m = '', e = 1e-6) => assert.ok(Math.abs(a - b) <= e * (1 + Math.abs(b)), `${m} ${a} !~ ${b}`);
const txt = (block) => { const t = block.entities.find((e) => e.type === 'TEXT'); return t.r.v[t.r.c.indexOf(1)].replace(/\\U\+([0-9A-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); };
/** The block, as written to a DXF (Ø and ° escaped, as Save does) and read back. */
const reopen = (dim) => {
  const d = newDoc(4); d.layers.Dimensions = { name: 'Dimensions' }; d.blocks[dim.name] = dim.block; d.entities.push(dim.insert);
  const back = readDxf(writeDxf(d, { escapeUnicode: true }));
  return back.blocks[dim.name];
};
const read = (dim) => E.readDim(dim.name, reopen(dim));

test('linear: the pointer decides horizontal or vertical (outside the points\' box; inside, the nearer axis)', () => {
  const a = [0, 0], b = [200, 110];
  assert.equal(E.linearAxis(a, b, [100, -30]), 'h', 'below');
  assert.equal(E.linearAxis(a, b, [100, 150]), 'h', 'above');
  assert.equal(E.linearAxis(a, b, [260, 50]), 'v', 'to the right');
  assert.equal(E.linearAxis(a, b, [-40, 50]), 'v', 'to the left');
  assert.equal(E.linearAxis(a, b, [100, 90]), 'h', 'inside, nearer the top and bottom');
  assert.equal(E.linearAxis(a, b, [190, 55]), 'v', 'inside, nearer a side');
});

test('linear: a horizontal dimension of two corners reads the X distance, the extension lines drop to the line from each point', () => {
  const g = E.dimGeometry({ a: [0, 0], b: [200, 110], offset: -20, axis: 'h', textH: 4 }, 1);
  assert.equal(g.label, '200.00'); near(g.mm, 200);
  near(g.line[1], -20); near(g.line[3], -20); near(g.line[0], 0); near(g.line[2], 200);
  assert.equal(g.ext.length, 2);
  near(g.ext[0][1], -1.6, 'a: from the gap below the point'); near(g.ext[0][3], -20 - 3.2, 'a: past the line');
  near(g.ext[1][1], 110 - 1.6, 'b: from the point'); near(g.ext[1][3], -20 - 3.2, 'b: to the same line');
  near(g.text.rot, 0);
  const v = E.dimGeometry({ a: [0, 0], b: [200, 110], offset: -30, axis: 'v' }, 1);
  assert.equal(v.label, '110.00'); near(v.line[2], v.line[0], 'a vertical line'); near(v.text.rot, 90);
});

test('linear reads back its points, axis and offset (through Save and reopen), and an aligned one has no axis', () => {
  for (const p of [{ a: [10, 5], b: [90, 65], offset: -12, axis: 'h' }, { a: [10, 5], b: [90, 65], offset: 9, axis: 'v' }, { a: [90, 65], b: [10, 5], offset: 4, axis: 'h' }]) {
    const dim = E.buildDim('linear', { ...p, textH: 3 }, 1, 'PD_DIM_1'), got = read(dim);
    assert.equal(got.kind, 'linear'); assert.equal(got.params.axis, p.axis);
    near(got.params.a[0], p.a[0]); near(got.params.b[1], p.b[1]); near(got.params.offset, p.offset, 'offset', 1e-5);
  }
  const al = read(E.buildDim('aligned', { a: [0, 0], b: [30, 40], offset: 7, textH: 3 }, 1, 'PD_DIM_1'));
  assert.equal(al.kind, 'aligned'); assert.equal(al.params.axis, undefined);
  near(E.dimOffsetAt([0, 0], [200, 110], [50, -20], 'h'), -20, 'below is negative (right of a→b)');
  near(E.dimOffsetAt([0, 0], [200, 110], [260, 50], 'v'), -260, 'a vertical line to the right of a: right of a→b going up');
});

test('radius: R and the value, a line from the centre through the pointer, an arrowhead on the circle, the text beyond a landing', () => {
  const g = E.radiusGeometry({ c: [100, 50], r: 25, p: [120, 90] }, 1);
  assert.equal(g.label, 'R25.00'); near(g.mm, 25);
  near(g.line[0], 100); near(g.line[1], 50); near(g.line[2], 120); near(g.line[3], 90);
  const tip = g.arrows[0][0], u = [20 / Math.hypot(20, 40), 40 / Math.hypot(20, 40)];
  near(tip[0], 100 + 25 * u[0]); near(tip[1], 50 + 25 * u[1]);
  assert.ok(g.text.x > g.more[0][2], 'the text is beyond the landing on the right');
  const left = E.radiusGeometry({ c: [100, 50], r: 25, p: [60, 90] }, 1);
  assert.ok(left.text.x < left.more[0][2], 'and on the left when the pointer is on the left');
  const inside = E.radiusGeometry({ c: [100, 50], r: 25, p: [105, 55] }, 1);
  near(Math.hypot(inside.line[2] - 100, inside.line[3] - 50), 25, 'a pointer inside the circle is put on it');
  assert.equal(E.radiusGeometry({ c: [0, 0], r: 25, p: [0, 0] }, 1), null);
  assert.equal(E.radiusGeometry({ c: [0, 0], r: 0, p: [3, 4] }, 1), null);
  assert.equal(E.radiusGeometry({ c: [0, 0], r: 25.4, p: [30, 30], units: 'inch' }, 25.4, 3).label, 'R25.400"', 'an inch drawing: radius 25.4 units is 645.16 mm');
});

test('radius reads back (centre, radius, pointer) through Save and reopen with the R intact', () => {
  const dim = E.buildDim('radius', { c: [100, 50], r: 25, p: [120, 90], textH: 3 }, 1, 'PD_DIM_R1', 1);
  assert.equal(txt(dim.block), 'R25.0');
  const got = read(dim);
  assert.equal(got.kind, 'radius'); near(got.params.r, 25, 'r', 1e-5); near(got.params.c[0], 100); near(got.params.p[1], 90); near(got.params.textH, 3);
  assert.equal(txt(E.relabelDims({ blocks: { PD_DIM_R1: reopen(dim) }, entities: [] }, 1, 3).blocks.PD_DIM_R1), 'R25.000', 'the decimals re-label it, keeping the R');
});

test('diameter: Ø, the line through the centre the pointer points along, arrowheads at both ends, the text above and along it', () => {
  const ends = E.diameterEnds([100, 50], 25, [100, 100]);
  near(ends.a[0], 100); near(ends.a[1], 25); near(ends.b[1], 75);
  const g = E.dimGeom('diameter', { ...ends, offset: 0 }, 1);
  assert.equal(g.label, 'Ø50.00'); assert.equal(g.ext.length, 0); assert.equal(g.arrows.length, 2);
  assert.equal(E.diameterEnds([0, 0], 5, [0, 0]), null);
  const dim = E.buildDim('diameter', { ...ends, textH: 3 }, 1, 'PD_DIM_D1'), got = read(dim);
  assert.equal(got.kind, 'diameter'); near(got.params.a[1], 25); near(got.params.b[1], 75);
  assert.equal(E.dimOfEntity({ entities: [dim.insert], blocks: { PD_DIM_D1: reopen(dim) } }, 0).kind, 'diameter');
});

test('angle: the sector the pointer is in, the arc with an arrowhead at each end, the value upright outside it', () => {
  const l1 = [0, 0, 100, 0], l2 = [0, 0, 80, 80];
  let a = E.angleBetween(l1, l2, [50, 20]);
  near(a.v[0], 0); near(a.v[1], 0); near(a.a0, 0); near(a.a1, 45); near(a.r, Math.hypot(50, 20));
  a = E.angleBetween(l1, l2, [-50, 20]);
  near(a.a0, 45, 'the sector beyond the second line'); near(a.a1, 180);
});
test('angle: pointer in each of the four sectors, the sweep is the angle or its supplement', () => {
  const l1 = [0, 0, 100, 0], l2 = [0, 0, 80, 80], sweep = (m) => (((m.a1 - m.a0) % 360) + 360) % 360;
  near(sweep(E.angleBetween(l1, l2, [50, 20])), 45);
  near(sweep(E.angleBetween(l1, l2, [-50, 20])), 135);
  near(sweep(E.angleBetween(l1, l2, [-50, -20])), 45);
  near(sweep(E.angleBetween(l1, l2, [50, -20])), 135);
  assert.equal(E.angleBetween([0, 0, 10, 0], [0, 5, 10, 5], [3, 3]), null, 'parallel lines have no angle');
  assert.equal(E.angleBetween([0, 0, 10, 0], [20, 0, 40, 0], [3, 3]), null, 'on one line');
  const m = E.angleBetween([10, 10, 60, 10], [30, 0, 30, 40], [45, 25]);
  near(m.v[0], 30); near(m.v[1], 10, 'the lines meet where they would, beyond a line\'s end');
});
test('angle: geometry, block (an ARC), read back through Save and reopen; scaling keeps the value', () => {
  const g = E.angleGeometry({ v: [0, 0], r: 40, a0: 0, a1: 45 }, 1);
  assert.equal(g.label, '45.00°'); assert.equal(g.lines.length, 0); assert.deepEqual(g.arcs, [[0, 0, 40, 0, 45]]);
  near(g.arrows[0][0][0], 40); near(g.arrows[0][0][1], 0); near(g.arrows[1][0][0], 40 * Math.cos(Math.PI / 4));
  assert.ok(g.arrows[0][1][1] > 0 && g.arrows[0][2][1] > 0, 'the start arrowhead points down, away from the arc: its base is above the tip');
  const dim = E.buildDim('angle', { v: [10, 20], r: 40, a0: 350, a1: 20, textH: 3 }, 1, 'PD_DIM_A1', 1);
  assert.deepEqual(dim.block.entities.map((e) => e.type), ['ARC', 'SOLID', 'SOLID', 'TEXT']);
  assert.equal(txt(dim.block), '30.0°');
  const got = read(dim);
  assert.equal(got.kind, 'angle'); near(got.params.v[0], 10); near(got.params.r, 40); near(got.params.a0, 350); near(got.params.a1, 20);
  const raw = { entities: [dim.insert], blocks: { PD_DIM_A1: reopen(dim) }, layers: {} };
  const sc = E.scaleAbout(raw, 2, 0, 0, 0);
  assert.equal(txt(sc.blocks.PD_DIM_A1), '30.0°', 'an angle does not change when the drawing is scaled');
  near(sc.blocks.PD_DIM_A1.entities[0].r.v[sc.blocks.PD_DIM_A1.entities[0].r.c.indexOf(40)], 80, 'the arc does');
  assert.equal(E.angleGeometry({ v: [0, 0], r: 40, a0: 10, a1: 10 }, 1), null);
});

test('scaling re-labels R and Ø and inch dimensions, and leaves their prefix and sign', () => {
  const r = E.buildDim('radius', { c: [0, 0], r: 10, p: [20, 20] }, 1, 'PD_DIM_R1');
  const doc = { entities: [r.insert], blocks: { PD_DIM_R1: reopen(r) }, layers: {} };
  assert.equal(txt(E.scaleAbout(doc, 3, 0, 0, 0).blocks.PD_DIM_R1), 'R30.00');
  const inch = E.buildDim('aligned', { a: [0, 0], b: [254, 0], offset: 10, units: 'inch', textH: 3 }, 1, 'PD_DIM_1');
  assert.equal(txt(inch.block), '10.00"'); assert.equal(read(inch).params.units, 'inch');
  assert.equal(txt(E.scaleAbout({ entities: [inch.insert], blocks: { PD_DIM_1: reopen(inch) }, layers: {} }, 2, 0, 0, 0).blocks.PD_DIM_1), '20.00"');
});

test('free names: aligned PD_DIM_n, then R, D, A with their own counts; circleOf and lineOf pick only what can be dimensioned', () => {
  const blocks = { PD_DIM_1: {}, PD_DIM_R1: {}, PD_DIM_R2: {} };
  assert.equal(E.freeName(blocks), 'PD_DIM_2'); assert.equal(E.freeName(blocks, 'radius'), 'PD_DIM_R3');
  assert.equal(E.freeName(blocks, 'diameter'), 'PD_DIM_D1'); assert.equal(E.freeName(blocks, 'angle'), 'PD_DIM_A1');
  assert.deepEqual(E.circleOf(circle(5, 6, 7)), { c: [5, 6], r: 7 }); assert.deepEqual(E.circleOf(arc(1, 2, 3, 0, 90)), { c: [1, 2], r: 3 });
  assert.equal(E.circleOf(line(0, 0, 1, 1)), null); assert.equal(E.circleOf(undefined), null);
  assert.deepEqual(E.lineOf(line(0, 0, 3, 4)), [0, 0, 3, 4]); assert.equal(E.lineOf(line(1, 1, 1, 1)), null); assert.equal(E.lineOf(circle(0, 0, 1)), null);
});

test('a centred text breaks the dimension line; the look (text height, arrow, gap, position, units) reads back', () => {
  const p = { a: [0, 0], b: [200, 0], offset: 15, textH: 3.5, arrow: 2.5, gap: 0.8, pos: 'centre' };
  const g = E.dimGeometry(p, 1);
  assert.equal(g.lines.length, 4, 'two halves and two extension lines'); assert.equal(g.text.va, 2);
  assert.ok(g.more[0][0] > g.line[2], 'a gap in the middle');
  const got = read(E.buildDim('aligned', p, 1, 'PD_DIM_1')).params;
  near(got.arrow, 2.5, 'arrow', 1e-6); assert.equal(got.pos, 'centre'); near(got.offset, 15); near(got.b[0], 200); near(got.a[0], 0);
  const up = read(E.buildDim('aligned', { ...p, pos: 'above', arrow: 2.5, gap: 0.8 }, 1, 'PD_DIM_1')).params;
  near(up.gap, 0.8, 'gap', 1e-6); assert.equal(up.pos, 'above'); assert.equal(up.units, 'mm');
  const nolines = read(E.buildDim('aligned', { a: [0, 0], b: [200, 0], offset: 0, pos: 'centre' }, 1, 'PD_DIM_1')).params;
  near(nolines.b[0], 200, 'a centred dimension without extension lines still reads its ends'); near(nolines.offset, 0);
  assert.equal(E.dimGeometry({ a: [0, 0], b: [3, 0], pos: 'centre', textH: 3 }, 1).lines.length, 1, 'too short to break');
});

test('withHeight keeps the arrow and the gap in proportion', () => {
  const p = DM.withHeight({ a: [0, 0], b: [100, 0], textH: 2, arrow: 2.2, gap: 0.8 }, 4);
  near(p.textH, 4); near(p.arrow, 4.4); near(p.gap, 1.6);
  const q = DM.withHeight({ a: [0, 0], b: [100, 0], textH: null }, 4);
  assert.equal(q.arrow, undefined);
});

test('the gap is how far the extension lines start from the points: any value, even 0, reads back, and the default is 0.4 text heights', () => {
  for (const gap of [0, 0.8, 2, undefined]) {
    const p = { a: [10, 5], b: [90, 65], offset: -12, axis: 'h', textH: 3.5, gap }, got = read(E.buildDim('linear', p, 1, 'PD_DIM_1')).params;
    near(got.gap, gap === undefined ? 1.4 : gap, 'gap ' + gap, 1e-9); near(got.a[0], 10, 'a is where it was picked'); near(got.a[1], 5); near(got.b[1], 65); near(got.offset, -12, 'offset', 1e-9);
  }
  const g0 = E.dimGeometry({ a: [0, 0], b: [100, 0], offset: 20, textH: 3.5, gap: 0.8 }, 1);
  near(g0.ext[0][1], 0.8, 'the extension line starts 0.8 from the point'); near(g0.ext[0][3], 20 + 0.8 + 1.4, 'and ends the gap and 0.4 text heights past the line');
  const old = E.dimGeometry({ a: [0, 0], b: [100, 0], offset: 20, textH: 2.5 }, 1);
  near(old.ext[0][1], 1, 'no gap given: 0.4 text heights, as before'); near(old.ext[0][3], 22, 'and 0.8 text heights past the line, as before');
});

test('styles: a typed field is checked (a number in its range, a comma is a point), the stored ones are cleaned, the Standard is always there', () => {
  assert.deepEqual(DM.checkStyle({ arrow: '2,5', textH: '3.5', gap: 0.8, dp: '2', units: 'inch', pos: 'centre' }).style, { arrow: 2.5, textH: 3.5, gap: 0.8, dp: 2, units: 'inch', pos: 'centre' });
  assert.match(DM.checkStyle({ ...DM.STANDARD, arrow: '' }).error, /^Arrow size/); assert.match(DM.checkStyle({ ...DM.STANDARD, textH: '0' }).error, /^Text height/);
  assert.match(DM.checkStyle({ ...DM.STANDARD, gap: '-1' }).error, /^Gap/); assert.match(DM.checkStyle({ ...DM.STANDARD, arrow: 'x' }).error, /^Arrow size/);
  assert.equal(DM.checkStyle({ ...DM.STANDARD, gap: '0' }).style.gap, 0, 'a gap of 0 is allowed'); assert.match(DM.checkStyle({ ...DM.STANDARD, dp: 5 }).error, /^Decimals/);
  assert.equal(DM.checkStyle({ ...DM.STANDARD, arrow: '2.123456' }).style.arrow, 2.123, 'rounded to 0.001');
  assert.deepEqual(DM.cleanStyle({ arrow: 4 }), { ...DM.STANDARD, arrow: 4 }, 'a missing field is the Standard value'); assert.deepEqual(DM.cleanStyle({ arrow: 4, textH: 'bad' }), DM.STANDARD, 'a bad one: the whole style is');
  assert.deepEqual(DM.cleanStyle({ arrow: 'bad' }), DM.STANDARD); assert.deepEqual(DM.cleanStyle(null), DM.STANDARD);
  const l = DM.lookOf({ ...DM.STANDARD, units: 'inch' }, 25.4);
  near(l.textH, 3.5 / 25.4); near(l.arrow, 2.5 / 25.4); near(l.gap, 0.8 / 25.4); assert.equal(l.units, 'inch'); assert.equal(l.pos, 'above');
  const p = DM.loadPresets({ cur: 'Inch jobs', presets: { 'Inch jobs': { ...DM.STANDARD, units: 'inch' }, '': DM.STANDARD, Bad: { arrow: -3 } } });
  assert.deepEqual(Object.keys(p.presets).sort(), ['Bad', 'Inch jobs', 'Standard']); assert.equal(p.cur, 'Inch jobs'); assert.deepEqual(p.presets.Bad, DM.STANDARD);
  assert.equal(DM.loadPresets({ cur: 'Gone', presets: {} }).cur, 'Standard'); assert.equal(DM.loadPresets('junk').cur, 'Standard'); assert.deepEqual(DM.loadPresets(null).presets, { Standard: DM.STANDARD });
  assert.equal(DM.loadPresets({ presets: { constructor: DM.STANDARD } }).cur, 'Standard', 'a name like constructor is only a name');
});

console.log(n + ' dims tests passed');
