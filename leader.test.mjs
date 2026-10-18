// leader.js — leaders: geometry, the block, read back through Save and reopen, grips.   node leader.test.mjs
import assert from 'node:assert/strict';
import * as LD from './web/leader.js';
import * as E from './web/edit.js';
import * as GR from './web/grips.js';
import { readDxf } from './web/drawing.js';
import { newDoc, writeDxf } from './web/dxf-write.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, m = '', e = 1e-6) => assert.ok(Math.abs(a - b) <= e * (1 + Math.abs(b)), `${m} ${a} !~ ${b}`);
const model = (o = {}) => ({ pts: [[364.6, 229.6], [320, 130], [240, 130]], lines: ['Ø25.00 THRU'], textH: 3.5, arrow: 2.5, ...o });
/** The block as Save writes it (Ø escaped), read back. */
const reopen = (b) => {
  const d = newDoc(4); d.layers.Dimensions = { name: 'Dimensions' }; d.blocks[b.name] = b.block; d.entities.push(b.insert);
  const back = readDxf(writeDxf(d, { escapeUnicode: true }));
  return { raw: back, block: back.blocks[b.name] };
};

test('the note lands the way the last segment goes: right, left, and right for straight up or down', () => {
  assert.equal(LD.sideOf([[0, 0], [10, 10]]), 1); assert.equal(LD.sideOf([[0, 0], [10, 10], [20, 10]]), 1);
  assert.equal(LD.sideOf([[0, 0], [10, 10], [4, 10]]), -1); assert.equal(LD.sideOf([[10, 10], [0, 0]]), -1); assert.equal(LD.sideOf([[0, 0], [0, 10]]), 1);
  const left = LD.geometry(model()), right = LD.geometry(model({ pts: [[660, 300], [740, 240]] }));
  assert.equal(left.side, -1); assert.equal(left.text.ha, 2); assert.ok(left.text.x < 240, 'left of the end');
  assert.equal(right.side, 1); assert.equal(right.text.ha, 0); assert.ok(right.text.x > 740);
  near(left.text.y, 130 - 0.35 * 3.5, 'the note is level with the end');
});

test('geometry: a line per segment, the arrowhead on the tip pointing at it, the base back along the first segment', () => {
  const g = LD.geometry(model());
  assert.equal(g.lines.length, 2); assert.deepEqual(g.lines[0].slice(0, 2), [364.6, 229.6]); assert.deepEqual(g.lines[1].slice(2), [240, 130]);
  const [tip, q, r] = g.arrows[0];
  assert.deepEqual(tip, [364.6, 229.6]);
  const mid = [(q[0] + r[0]) / 2, (q[1] + r[1]) / 2], u = [320 - 364.6, 130 - 229.6], d = Math.hypot(...u);
  near(Math.hypot(mid[0] - tip[0], mid[1] - tip[1]), 2.5, 'arrow length'); near((mid[0] - tip[0]) / 2.5, u[0] / d, 'along the first segment'); near((mid[1] - tip[1]) / 2.5, u[1] / d);
  assert.equal(LD.geometry(model({ pts: [[0, 0]] })), null, 'one point is not a leader'); assert.equal(LD.geometry(model({ pts: [[0, 0], [0, 0]] })), null);
  assert.equal(LD.geometry(model({ pts: [[0, 0], [5, 5], [5, 5]] })), null, 'two points on one another');
  assert.equal(LD.geometry(model({ textH: 0 })), null);
  const short = LD.geometry(model({ pts: [[0, 0], [1, 0]], arrow: 2.5 }));
  near(Math.hypot((short.arrows[0][1][0] + short.arrows[0][2][0]) / 2, 0), 0.5, 'a short segment: the arrowhead is at most half of it');
});

test('build: two LINEs, a SOLID and a TEXT in one block with one INSERT on Dimensions; no note, no leader', () => {
  const b = LD.build(model(), 'PD_LDR_1');
  assert.deepEqual(b.block.entities.map((e) => e.type), ['LINE', 'LINE', 'SOLID', 'TEXT']); assert.equal(b.insert.layer, 'Dimensions');
  assert.equal(LD.build(model({ lines: [] }), 'x'), null); assert.equal(LD.build(model({ lines: ['  '] }), 'x'), null);
  const two = LD.build(model({ pts: [[0, 0], [10, 10]] }), 'x'); assert.deepEqual(two.block.entities.map((e) => e.type), ['LINE', 'SOLID', 'TEXT']);
  const multi = LD.build(model({ lines: ['MATERIAL', 'ACRYLIC 3 MM'] }), 'x'); assert.equal(multi.block.entities.at(-1).type, 'MTEXT', 'two lines: an MTEXT');
});

test('read back through Save and reopen: the points, the note (Ø and all), the text height and the arrow', () => {
  for (const m of [model(), model({ pts: [[660, 300], [740, 240]], lines: ['DEBURR'] }), model({ lines: ['A', 'B'] }), model({ textH: 7, arrow: 4 })]) {
    const { block } = reopen(LD.build(m, 'PD_LDR_1')), got = LD.read('PD_LDR_1', block);
    assert.equal(got.pts.length, m.pts.length); m.pts.forEach((p, i) => { near(got.pts[i][0], p[0], 'x', 1e-5); near(got.pts[i][1], p[1], 'y', 1e-5); });
    assert.deepEqual(got.lines, m.lines); near(got.textH, m.textH, 'h', 1e-5); near(got.arrow, m.arrow, 'arrow', 1e-5);
  }
  assert.equal(LD.read('PD_LDR_1', null), null); assert.equal(LD.read('PD_DIM_1', LD.build(model(), 'x').block), null, 'only a PD_LDR block');
  const { raw } = reopen(LD.build(model(), 'PD_LDR_1'));
  assert.equal(LD.ofEntity(raw, raw.entities.length - 1).name, 'PD_LDR_1'); assert.equal(LD.ofEntity(raw, 99), null);
  assert.equal(E.dimOfEntity(raw, raw.entities.length - 1), null, 'a leader is not a dimension');
});

test('names, replace, and the drawing scaled (the block and its note scale; the note stays)', () => {
  assert.equal(LD.freeName({}), 'PD_LDR_1'); assert.equal(LD.freeName({ PD_LDR_1: {}, PD_LDR_2: {} }), 'PD_LDR_3');
  const b = LD.build(model(), 'PD_LDR_1'), { raw } = reopen(b);
  const r = LD.replace(raw, 'PD_LDR_1', { ...model(), lines: ['NEW'] });
  assert.equal(r.entities, raw.entities, 'the INSERT stays'); assert.deepEqual(LD.read('PD_LDR_1', r.blocks.PD_LDR_1).lines, ['NEW']);
  assert.equal(LD.replace(raw, 'PD_LDR_1', model({ lines: [] })), null);
  const s = E.scaleAbout(raw, 2, 0, 0, 0), got = LD.read('PD_LDR_1', s.blocks.PD_LDR_1);
  near(got.pts[0][0], 729.2, 'x', 1e-5); near(got.textH, 7, 'h', 1e-5); assert.deepEqual(got.lines, ['Ø25.00 THRU'].map((x) => x), 'the note is not a number to re-label');
  const num = E.scaleAbout(reopen(LD.build(model({ lines: ['25'] }), 'PD_LDR_1')).raw, 2, 0, 0, 0);
  assert.deepEqual(LD.read('PD_LDR_1', num.blocks.PD_LDR_1).lines, ['25'], 'even a note that is just a number');
});

test('grips: a point each (arrowhead, bend, end); dragging moves that point only, never onto another; the rubber band starts from the neighbour', () => {
  const ent = { type: 'LEADER', name: 'PD_LDR_1', model: model() };
  assert.equal(GR.hasGrips(ent), true);
  assert.deepEqual(GR.gripsOf(ent).map((g) => [g.id, g.kind, g.x, g.y]), [['v0', 'vertex', 364.6, 229.6], ['v1', 'vertex', 320, 130], ['v2', 'vertex', 240, 130]]);
  assert.deepEqual(GR.refPoint(ent, 'v0'), [320, 130]); assert.deepEqual(GR.refPoint(ent, 'v2'), [320, 130]); assert.deepEqual(GR.refPoint(ent, 'v1'), [364.6, 229.6]);
  const r = GR.dragGrip(ent, 'v1', [300, 150]);
  assert.equal(r.label, 'Stretch leader'); assert.deepEqual(r.ent.model.pts, [[364.6, 229.6], [300, 150], [240, 130]]); assert.equal(r.ent.model.lines[0], 'Ø25.00 THRU');
  assert.deepEqual(ent.model.pts[1], [320, 130], 'the original is untouched');
  assert.equal(GR.dragGrip(ent, 'v1', [240, 130]), null, 'onto another point'); assert.equal(GR.dragGrip(ent, 'v1', [320, 130]), null, 'the same place'); assert.equal(GR.dragGrip(ent, 'v1', [NaN, 1]), null);
  assert.deepEqual(GR.shapeOf(r.ent, 2), { t: 'poly', pts: [[729.2, 459.2], [600, 300], [480, 260]], closed: false });
  assert.equal(GR.readoutOf(ent, 'v1', r.ent, 1), 'X 300.00 · Y 150.00'); assert.equal(GR.commandOf(ent, 'v1'), 'STRETCH');
});

console.log(n + ' leader tests passed');
