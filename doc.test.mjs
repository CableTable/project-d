// doc.js: units, placement on the sheet, layer visibility, counts. Run: node doc.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeDxf, readDxf, flatten } from './web/drawing.js';
import { mapply } from './web/drawing.js';
import { buildTree } from './web/objects.js';
import { makeDimension, addDimension } from './web/edit.js';
import { unitFactor, convertedNote, spaceOf, shownItems, itemVisible, startHidden, entityCount, layerCounts, drawingBoxMm, placement, boxOnSheet, fitRect, cursorMm, fitsSheet, addRecent, closePrompt } from './web/doc.js';

const load = (f) => flatten(readDxf(decodeDxf(readFileSync(f))));
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };

test('unit factors', () => {
  assert.equal(unitFactor('mm'), 1); assert.equal(unitFactor('in'), 25.4); assert.equal(unitFactor('cm'), 10);
  assert.equal(unitFactor('m'), 1000); assert.equal(unitFactor('ft'), 304.8); assert.equal(unitFactor(''), 1); assert.equal(unitFactor('nonsense'), 1);
});
test('converted note', () => {
  assert.equal(convertedNote('in'), 'converted from inch'); assert.equal(convertedNote('cm'), 'converted from cm');
  assert.equal(convertedNote('mm'), ''); assert.equal(convertedNote(''), '');
});
test('placement: 0,0 at the sheet bottom-left, y up', () => {
  const P = placement(25.4, 700);
  assert.deepEqual(mapply(P, 0, 0), [0, 700]);
  assert.deepEqual(mapply(P, 1, 1), [25.4, 700 - 25.4]);
  assert.deepEqual(boxOnSheet([0, 0, 100, 50], 700), [0, 650, 100, 700]);
  assert.deepEqual(cursorMm(10, 690, 700), [10, 10]);
});
test('fit rect: sheet alone, or grown by a drawing that sticks out', () => {
  assert.deepEqual(fitRect(1000, 700, null), [0, 0, 1000, 700]);
  assert.deepEqual(fitRect(1000, 700, [0, 0, 100, 50]), [0, 0, 1000, 700]);
  assert.deepEqual(fitRect(1000, 700, [-10, -20, 1200, 50]), [-10, 0, 1200, 720]);
  assert.ok(fitsSheet([0, 0, 100, 50], 1000, 700)); assert.ok(!fitsSheet([0, 0, 1100, 50], 1000, 700));
});
test('sample.dxf: mm, layers, counts, box', () => {
  const raw = readDxf(decodeDxf(readFileSync('fixtures/sample.dxf'))), fl = flatten(raw);
  assert.equal(spaceOf(fl), 0);
  assert.equal(shownItems(fl).length, 27, 'drawn items');
  assert.equal(entityCount(raw, fl), 20, 'a block reference is one entity, not one per item it draws; an IMAGE that draws nothing still counts');
  const counts = layerCounts(raw, fl);
  assert.equal(counts.reduce((a, b) => a + b, 0), 20);
  assert.equal(counts[fl.layers.findIndex((l) => l.name === 'HOLES')], 6);
  assert.equal(counts[fl.layers.findIndex((l) => l.name === 'NOTES')], 7);
  const tree = buildTree(raw, fl);       // the Objects tab counts the same
  assert.equal(tree.objects, 20);
  assert.deepEqual(tree.layers.map((l) => l.count), tree.layers.map((l) => counts[fl.layers.findIndex((x) => x.name === l.name)]));
  assert.deepEqual(drawingBoxMm(fl, 1), fl.boxes.model);
});
test('a kept dimension is one entity (its lines, arrowheads and text are items of one INSERT)', () => {
  const raw = readDxf(decodeDxf(readFileSync('fixtures/outline.dxf')));
  const before = entityCount(raw, flatten(raw));
  const dim = makeDimension([0, 0], [50, 0], 1, raw.blocks, 2), next = addDimension(raw, dim);
  const raw2 = { ...raw, entities: next.entities, blocks: next.blocks }, fl = flatten(raw2);
  assert.ok(fl.items.length - 0 > before + 3, 'it draws several items');
  assert.equal(entityCount(raw2, fl), before + 1);
  assert.equal(layerCounts(raw2, fl)[fl.layers.findIndex((l) => l.name === 'Dimensions')], 1);
});
test('a file past the draw limit still lists every layer, so the counts agree with the Objects tree', () => {
  const line = (layer) => ({ type: 'LINE', layer, lt: null, aci: 256, tc: null, lw: -1, lts: 1, hidden: false, ps: false, flip: false, kids: [], r: { type: 'LINE', c: [10, 20, 11, 21], v: ['0', '0', '1', '1'] } });
  const raw = { header: {}, layers: {}, ltypes: {}, blocks: {}, entities: [...Array(400001)].map(() => line('A')).concat([line('B'), line('B')]) };
  const fl = flatten(raw);
  assert.ok(fl.truncated, 'the draw limit was hit');
  const b = fl.layers.findIndex((l) => l.name === 'B');
  assert.ok(b >= 0, 'layer B is listed');
  assert.equal(layerCounts(raw, fl)[b], 2);
  assert.equal(layerCounts(raw, fl).reduce((x, y) => x + y, 0), entityCount(raw, fl));
  assert.equal(buildTree(raw, fl).layers.find((l) => l.name === 'B').index, b);
});
test('layer visibility hides that layer\'s items only', () => {
  const fl = load('fixtures/sample.dxf');
  const holes = fl.layers.findIndex((l) => l.name === 'HOLES');
  const off = new Set([holes]);
  const seen = shownItems(fl).filter((it) => itemVisible(it, off));
  assert.equal(seen.length, 27 - 10);
  assert.equal(shownItems(fl).filter((it) => itemVisible(it, new Set())).length, 27);
  assert.equal(startHidden(fl).size, fl.layers.filter((l) => !l.on).length);
});
test('inch.dxf converts to mm', () => {
  const raw = readDxf(decodeDxf(readFileSync('fixtures/inch.dxf'))), fl = flatten(raw);
  assert.equal(fl.units, 'in');
  const f = unitFactor(fl.units);
  assert.equal(f, 25.4);
  const box = drawingBoxMm(fl, f);
  assert.deepEqual(box.map((v) => Math.round(v * 100) / 100), [0, 0, 101.6, 50.8]);
  assert.equal(entityCount(raw, fl), 3);
  assert.equal(convertedNote(fl.units), 'converted from inch');
});
test('recent files: newest first, no repeats (any case or slash), at most 8', () => {
  let r = addRecent(null, 'C:\\a\\one.dxf');
  r = addRecent(r, 'C:\\a\\two.dxf');
  r = addRecent(r, 'c:/A/ONE.dxf');
  assert.deepEqual(r, ['c:/A/ONE.dxf', 'C:\\a\\two.dxf']);
  for (let i = 0; i < 10; i++) r = addRecent(r, 'C:\\f' + i + '.dxf');
  assert.equal(r.length, 8);
  assert.equal(r[0], 'C:\\f9.dxf');
  assert.deepEqual(addRecent(['x', 5, null], 'y'), ['y', 'x']);
});
test('closePrompt: one name in quotes, or a count with the names listed', () => {
  assert.deepEqual(closePrompt(['a.dxf']), { title: 'Save changes to "a.dxf"?', names: [] });
  assert.deepEqual(closePrompt(['a.dxf', 'b layout']), { title: 'Save changes to 2 drawings?', names: ['a.dxf', 'b layout'] });
  const r = closePrompt(['1', '2', '3', '4', '5', '6', '7']);
  assert.equal(r.title, 'Save changes to 7 drawings?');
  assert.deepEqual(r.names, ['1', '2', '3', '4', '5', 'and 2 more']);
});
console.log(n + ' passed');
