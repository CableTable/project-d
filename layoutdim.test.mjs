// layoutdim.js + the dimension parts of layoutdoc.js — a dimension on a layout (TODO 156b2c1).   node layoutdim.test.mjs
import assert from 'node:assert/strict';
import { line } from './web/dxf-write.js';
import { readDxf } from './web/drawing.js';
import { writeDxf } from './web/dxf-write.js';
import * as LD from './web/layoutdoc.js';
import * as Ed from './web/edit.js';
import { isDimPart, dimName, turnedTag, freeBlockName } from './web/layoutdim.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, a + ' != ' + b);
let ids = 0;
const newId = () => 'n' + (++ids);

function layoutWith() {
  const lay = LD.newLayout('L'), layers = LD.layersOf(lay);
  layers[Ed.DIM_LAYER] = { aci: 5, tc: 0x0f766e };
  return lay;
}
function addLine(lay, id, a, b) {
  const part = LD.objectPart(id, id, line(a[0], a[1], b[0], b[1]), LD.layersOf(lay));
  lay.parts[id] = part; lay.placed.push(LD.objectPlacement(part));
  return lay.placed.at(-1);
}
function addDim(lay, id, a, b, offset, name, kind = 'aligned', axis = null) {
  const dim = Ed.buildDim(kind, { a, b, offset, ...(axis ? { axis } : {}) }, 1, name, 2);
  const part = LD.objectPart(id, id, dim.insert, LD.layersOf(lay), {}, { [name]: dim.block });
  lay.parts[id] = part; lay.placed.push(LD.objectPlacement(part));
  return lay.placed.at(-1);
}
const dimOf = (lay, p) => { const part = lay.parts[p.partId], name = dimName(part); return { name, ...Ed.readDim(name, part.raw.blocks[name]), part }; };
const labelOf = (lay, p) => { const part = lay.parts[p.partId], b = part.raw.blocks[dimName(part)], t = b.entities.find((e) => e.type === 'TEXT'); return t.r.v[t.r.c.indexOf(1)]; };

test('a dimension object is a dimension part with its block, and its box covers the geometry', () => {
  const lay = layoutWith(), p = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  const part = lay.parts[p.partId];
  assert.ok(isDimPart(part));
  assert.ok(part.box[2] - part.box[0] >= 100);
  assert.ok(!isDimPart(lay.parts[addLine(lay, 'l1', [0, 0], [10, 0]).partId]));
});

test('saves into the layout file and reopens identical (block, label, placement)', () => {
  const lay = layoutWith();
  addDim(lay, 'd1', [10, 10], [110, 10], 8, 'PD_DIM_1');
  const raw = LD.layoutRaw(lay), text = writeDxf(raw), back = LD.layoutFromRaw(readDxf(text), 'L');
  assert.ok(raw.blocks.PD_DIM_1, 'the block is in the file');
  const objs = Object.values(back.parts).filter((q) => q.obj);
  assert.equal(objs.length, 1);
  assert.ok(isDimPart(objs[0]));
  const q = back.placed[0], part = back.parts[q.partId], bb = part.raw.blocks[dimName(part)];
  assert.equal(bb.entities.find((e) => e.type === 'TEXT').r.v[bb.entities.find((e) => e.type === 'TEXT').r.c.indexOf(1)], '100.00');
  const was = lay.parts[lay.placed[0].partId].box;
  near(part.box[0], was[0], 1e-4); near(part.box[3], was[3], 1e-4);
  assert.deepEqual(Ed.readDim(dimName(part), bb).kind, 'aligned');
});

test('Move: the placement is baked into the block (a translate), name and label stay', () => {
  const lay = layoutWith(), p = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1'), was = lay.parts['d1'].box.slice();
  p.x += 50; p.y += 20;
  assert.equal(LD.settleDims(lay, newId), true);
  const part = lay.parts[p.partId], d = dimOf(lay, p);
  assert.notEqual(p.partId, 'd1');
  assert.equal(lay.parts['d1'], undefined, 'the old part is dropped');
  near(part.box[0], was[0] + 50); near(part.box[1], was[1] + 20);
  near(p.x, part.box[0]); near(p.y, part.box[1]);
  assert.equal(d.name, 'PD_DIM_1');
  near(d.params.a[0], 50); near(d.params.a[1], 20); near(d.params.b[0], 150);
  assert.equal(labelOf(lay, p), '100.00');
  assert.equal(LD.settleDims(lay, newId), false, 'settled: nothing more to do');
});

test('Scale re-labels; Rotate 90 swaps a Linear dimension H / V and turns the text; Mirror keeps the label', () => {
  const lay = layoutWith(), p = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_H1', 'linear', 'h');
  p.sc = 2;
  LD.settleDims(lay, newId);
  assert.equal(labelOf(lay, p), '200.00');
  assert.equal(p.sc, undefined);
  p.rot = 90;
  LD.settleDims(lay, newId);
  assert.match(dimName(lay.parts[p.partId]), /^PD_DIM_V\d+$/);
  const tx = lay.parts[p.partId].raw.blocks[dimName(lay.parts[p.partId])].entities.find((e) => e.type === 'TEXT');
  near(+tx.r.v[tx.r.c.indexOf(50)], 90);
  p.mirrorX = true;
  LD.settleDims(lay, newId);
  assert.equal(labelOf(lay, p), '200.00');
  p.rot = 33;
  LD.settleDims(lay, newId);
  assert.match(dimName(lay.parts[p.partId]), /^PD_DIM_\d+$/, 'turned off the axes: Aligned');
});

test('a copy sharing a part gets a part and a block name of its own', () => {
  const lay = layoutWith(), p = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  const q = { ...p, x: p.x + 200 };
  lay.placed.push(q);
  LD.settleDims(lay, newId);
  assert.notEqual(q.partId, p.partId);
  assert.notEqual(dimName(lay.parts[q.partId]), dimName(lay.parts[p.partId]));
  assert.equal(new Set(lay.placed.map((x) => dimName(lay.parts[x.partId]))).size, 2);
});

test('a dimension on an object follows it when it moves, and when a grip edit changes it', () => {
  const lay = layoutWith(), l = addLine(lay, 'l1', [0, 0], [100, 0]), d = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  const prev = LD.linkView(lay);
  l.x += 30; l.y += 5;
  LD.settleDims(lay, newId);
  assert.equal(LD.followDims(lay, prev, LD.linkView(lay), newId), true);
  let m = dimOf(lay, d);
  near(m.params.a[0], 30); near(m.params.a[1], 5); near(m.params.b[0], 130);
  assert.equal(labelOf(lay, d), '100.00');
  // grip edit: the line's end moves to 180 (objectReplace: same slot, new part)
  const prev2 = LD.linkView(lay), view = LD.objectDoc(lay), ent = view.raw.entities[0];
  assert.ok(LD.objectReplace(lay, view, ent, line(30, 5, 180, 5), newId));
  assert.equal(LD.followDims(lay, prev2, LD.linkView(lay), newId), true);
  m = dimOf(lay, d);
  near(m.params.b[0], 180);
  assert.equal(labelOf(lay, d), '150.00');
});

test('moving only the dimension, or a shape it does not measure, leaves the links alone', () => {
  const lay = layoutWith(), l = addLine(lay, 'l1', [0, 0], [100, 0]), far = addLine(lay, 'l2', [0, 50], [100, 50]), d = addDim(lay, 'd1', [0, 0], [100, 0], 10, 'PD_DIM_1');
  const prev = LD.linkView(lay);
  far.x += 10;
  assert.equal(LD.followDims(lay, prev, LD.linkView(lay), newId), false);
  const prev2 = LD.linkView(lay);
  d.y += 7; LD.settleDims(lay, newId);
  assert.equal(LD.followDims(lay, prev2, LD.linkView(lay), newId), false);
  near(dimOf(lay, d).params.a[1], 7);
  assert.ok(l);
});

test('names: turnedTag and freeBlockName', () => {
  assert.equal(turnedTag('H', 90), 'V'); assert.equal(turnedTag('V', 270), 'H'); assert.equal(turnedTag('H', 180), 'H'); assert.equal(turnedTag('H', 45), '');
  assert.equal(turnedTag('', 90), ''); assert.equal(turnedTag('R', 45), 'R');
  assert.equal(freeBlockName(new Set(['PD_DIM_1', 'PD_DIM_2']), ''), 'PD_DIM_3');
});

console.log(n + ' tests');
