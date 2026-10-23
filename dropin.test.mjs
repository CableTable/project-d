// dropin.js — a library part dropped into a drawing.   node dropin.test.mjs
import assert from 'node:assert/strict';
import { dropPart } from './web/dropin.js';
import { newDoc, line, circle, insert, addLayer, addBlock, addEntities, writeDxf } from './web/dxf-write.js';
import { readDxf } from './web/drawing.js';
import { readTitleBlock, withTitleBlock } from './web/pdf-export.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const f6 = (r, c) => +r.v[r.c.indexOf(c)];

function partDoc() {
  const raw = newDoc(4);
  addLayer(raw, 'CUT', { aci: 1 }); addLayer(raw, 'MARK', { aci: 3 });
  addEntities(raw, line(10, 20, 60, 20, { layer: 'CUT' }), circle(30, 40, 5, { layer: 'MARK' }));
  return { raw, box: [10, 20, 60, 45], factor: 1, space: 0 };
}
const targetOf = (over = {}) => {
  const raw = newDoc(4);
  addEntities(raw, line(0, 0, 1, 1));
  return { raw, factor: 1, names: ['0'], hidden: [], locked: [], cur: '0', ...over };
};

test('the part lands with its lower-left box corner on the drop point, 1:1', () => {
  const r = dropPart(partDoc(), targetOf(), [100, 200]);
  assert.equal(r.from, 1); assert.equal(r.count, 2); assert.equal(r.entities.length, 3);
  assert.equal(f6(r.entities[1].r, 10), 100); assert.equal(f6(r.entities[1].r, 20), 200); assert.equal(f6(r.entities[1].r, 11), 150);
  assert.equal(f6(r.entities[2].r, 10), 120); assert.equal(f6(r.entities[2].r, 20), 220); assert.equal(f6(r.entities[2].r, 40), 5);
});

test('a layer the drawing lacks is made from the part\'s', () => {
  const r = dropPart(partDoc(), targetOf(), [0, 0]);
  assert.deepEqual(r.made, ['CUT', 'MARK']); assert.equal(r.layers.CUT.aci, 1); assert.equal(r.layers.MARK.aci, 3);
  assert.deepEqual(r.entities.slice(1).map((e) => e.layer), ['CUT', 'MARK']); assert.deepEqual(r.moved, {});
});

test('a layer the drawing has stays its own (any case), nothing new is made', () => {
  const r = dropPart(partDoc(), targetOf({ names: ['0', 'cut', 'Mark'] }), [0, 0]);
  assert.deepEqual(r.made, []); assert.deepEqual(r.entities.slice(1).map((e) => e.layer), ['cut', 'Mark']);
});

test('a locked or hidden layer sends its entities to the current layer, and says how many', () => {
  const r = dropPart(partDoc(), targetOf({ names: ['0', 'CUT', 'MARK', 'Work'], locked: ['cut'], hidden: ['MARK'], cur: 'Work' }), [0, 0]);
  assert.deepEqual(r.entities.slice(1).map((e) => e.layer), ['Work', 'Work']); assert.deepEqual(r.moved, { CUT: 1, MARK: 1 }); assert.deepEqual(r.made, []);
});

test('the target is not changed, so Undo can hand it back', () => {
  const t = targetOf(), before = t.raw.entities, layers = t.raw.layers;
  dropPart(partDoc(), t, [5, 5]);
  assert.equal(t.raw.entities, before); assert.equal(t.raw.layers, layers); assert.deepEqual(Object.keys(layers), ['0']);
});

test('a part in inches into a mm drawing is scaled to the same size', () => {
  const p = partDoc(); p.factor = 25.4;
  const r = dropPart(p, targetOf(), [0, 0]);
  assert.ok(Math.abs(f6(r.entities[1].r, 11) - 50 * 25.4) < 1e-6); assert.ok(Math.abs(f6(r.entities[2].r, 40) - 5 * 25.4) < 1e-6);
});

test('a block the drawing already has is renamed, its inserts follow', () => {
  const p = partDoc();
  addBlock(p.raw, 'B1', [line(0, 0, 3, 3)]); addEntities(p.raw, insert('B1', 12, 22));
  const t = targetOf(); addBlock(t.raw, 'b1', [circle(0, 0, 1)]);
  const r = dropPart(p, t, [0, 0]);
  assert.deepEqual(Object.keys(r.blocks).sort(), ['B1_2', 'b1']);
  assert.equal(r.entities.at(-1).r.v[r.entities.at(-1).r.c.indexOf(2)], 'B1_2'); assert.equal(r.blocks.b1.entities[0].type, 'CIRCLE');
});
for (const ownTitle of [false, true]) test(`a dropped part leaves the target's PDF title block ${ownTitle ? 'unchanged' : 'absent'}`, () => {
  const p = partDoc();
  p.raw = withTitleBlock(p.raw, { enabled: true, file: 'OTHER JOB' });
  const before = structuredClone(p.raw);
  const t = targetOf();
  if (ownTitle) t.raw = withTitleBlock(t.raw, { enabled: false, file: 'THIS JOB', footnote: '' });
  const title = readTitleBlock(t.raw), blocks = structuredClone(t.raw.blocks);
  for (const factor of [1, 25.4]) {
    const r = dropPart({ ...p, factor }, t, [100, 200]);
    assert.deepEqual(r.blocks, blocks);
    const reopened = readDxf(writeDxf({ ...t.raw, ...r }));
    assert.deepEqual(readTitleBlock(reopened), title);
    assert.equal(reopened.blocks.PD_PDF_TITLE_2, undefined);
  }
  assert.deepEqual(t.raw.blocks, blocks, 'the target is untouched');
  assert.deepEqual(p.raw, before, 'the library part is untouched');
});
console.log(n + ' tests');
