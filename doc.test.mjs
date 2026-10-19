// doc.js: units, placement on the sheet, layer visibility, counts. Run: node doc.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeDxf, readDxf, flatten } from './web/drawing.js';
import { mapply } from './web/drawing.js';
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
  const fl = load('fixtures/sample.dxf');
  assert.equal(spaceOf(fl), 0);
  assert.equal(shownItems(fl).length, 27, 'drawn items');
  assert.equal(entityCount(fl), 19, 'a block reference is one entity, not one per item it draws');
  const counts = layerCounts(fl);
  assert.equal(counts.reduce((a, b) => a + b, 0), 19);
  assert.equal(counts[fl.layers.findIndex((l) => l.name === 'HOLES')], 6);
  assert.deepEqual(drawingBoxMm(fl, 1), fl.boxes.model);
});
test('a kept dimension is one entity (its lines, arrowheads and text are items of one INSERT)', () => {
  const raw = readDxf(decodeDxf(readFileSync('fixtures/outline.dxf')));
  const before = entityCount(flatten(raw));
  const dim = makeDimension([0, 0], [50, 0], 1, raw.blocks, 2), next = addDimension(raw, dim);
  const fl = flatten({ ...raw, entities: next.entities, blocks: next.blocks });
  assert.ok(fl.items.length - 0 > before + 3, 'it draws several items');
  assert.equal(entityCount(fl), before + 1);
  assert.equal(layerCounts(fl)[fl.layers.findIndex((l) => l.name === 'Dimensions')], 1);
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
  const fl = load('fixtures/inch.dxf');
  assert.equal(fl.units, 'in');
  const f = unitFactor(fl.units);
  assert.equal(f, 25.4);
  const box = drawingBoxMm(fl, f);
  assert.deepEqual(box.map((v) => Math.round(v * 100) / 100), [0, 0, 101.6, 50.8]);
  assert.equal(entityCount(fl), 3);
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
