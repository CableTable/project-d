// objects.js — the Objects tab's model.   node objects.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { entityCount, layerCounts } from './web/doc.js';
import * as O from './web/objects.js';
import { newDoc, addEntities, addBlock, addLayer, writeDxf, line, circle, arc, lwpoly, rect, text, insert } from './web/dxf-write.js';
import { decodeDxf, readDxf, flatten } from './web/drawing.js';
import { removeEntities } from './web/edit.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }

test('sample: Objects, Layers and status count the same supported entities', () => {
  const raw = readDxf(decodeDxf(readFileSync('fixtures/sample.dxf'))), fl = flatten(raw);
  const tree = O.buildTree(raw, fl, { open: new Set(fl.layers.map((l) => l.name)) });
  assert.equal(tree.objects, 19);
  assert.equal(tree.objects, entityCount(fl));
  const counts = layerCounts(fl);
  for (const l of tree.layers) assert.equal(l.count, counts[l.index], l.name);
  assert.equal(tree.layers.find((l) => l.name === 'NOTES').count, 6);
  const image = raw.entities.findIndex((e) => e.type === 'IMAGE');
  assert.ok(image >= 0);
  assert.ok(!tree.layers.some((l) => l.rows.some((r) => r.e === image)), 'unsupported IMAGE has no drawn item');
  assert.ok(!tree.layers.some((l) => l.rows.some((r) => raw.entities[r.e].ps)), 'paper space excluded');
});

function sample() {
  const d = newDoc(4);
  addLayer(d, 'Cut', { aci: 7 }); addLayer(d, 'Engrave', { aci: 5 }); addLayer(d, 'Empty', { aci: 1 });
  addBlock(d, 'LOGO', [line(0, 0, 5, 0, { layer: '0' }), circle(0, 0, 2, { layer: '0' }), text(0, 0, 2, 'CT', { layer: '0' })]);
  addEntities(d, rect(0, 0, 200, 140, { layer: 'Cut' }), circle(50, 50, 20, { layer: 'Cut' }), line(0, 0, 120, 0, { layer: 'Cut' }),
    lwpoly([[0, 0], [10, 0], [10, 5], [0, 9], [3, 3]], { layer: 'Cut' }), arc(0, 0, 10, 0, 90, { layer: 'Cut' }),
    text(10, 10, 3, 'REV A', { layer: 'Engrave' }), insert('LOGO', 5, 5, { layer: 'Engrave' }));
  const raw = readDxf(writeDxf(d));
  return { raw, fl: flatten(raw) };
}

test('labels: circle, line, rectangle, polyline, arc, text, block', () => {
  const { raw } = sample(), L = (i) => O.labelOf(raw.entities[i], 1, raw.blocks);
  assert.equal(L(0), 'Rectangle 200.0 × 140.0');
  assert.equal(L(1), 'Circle Ø40');
  assert.equal(L(2), 'Line 120.0');
  assert.equal(L(3), 'Polyline, 5 pts');
  assert.equal(L(4), 'Arc R10 · 90°');
  assert.equal(L(5), "Text 'REV A'");
  assert.equal(L(6), 'Block LOGO · 3');
  assert.equal(O.labelOf(raw.entities[1], 0.5, raw.blocks), 'Circle Ø20', 'the factor turns units into mm');
});

test('icons follow the type; a rectangle has its own', () => {
  const { raw } = sample();
  assert.deepEqual(raw.entities.map(O.iconOf), ['rect', 'circle', 'line', 'poly', 'arc', 'text', 'block']);
});

test('a long text is cut; a block names its members', () => {
  const d = newDoc(4); addEntities(d, text(0, 0, 3, 'A very long note that does not fit a row', { layer: 'Cut' }));
  const raw = readDxf(writeDxf(d));
  assert.ok(O.labelOf(raw.entities[0]).length <= 32);
  const s = sample(), m = O.membersOf(s.raw, s.raw.entities[6], 1);
  assert.deepEqual(m.rows.map((r) => r.label), ['Line 5.0', 'Circle Ø4', "Text 'CT'"]);
  assert.equal(m.more, 0);
});

test('tree: layers with counts, only the open ones list objects', () => {
  const { raw, fl } = sample();
  const t = O.buildTree(raw, fl, { open: new Set(['Cut']), extra: ['Empty'], curLayer: 'Cut' });
  assert.equal(t.objects, 7);
  const cut = t.layers.find((l) => l.name === 'Cut'), eng = t.layers.find((l) => l.name === 'Engrave');
  assert.equal(cut.count, 5); assert.equal(cut.rows.length, 5); assert.ok(cut.cur);
  assert.equal(eng.count, 2); assert.equal(eng.rows.length, 0, 'a closed layer lists nothing');
  assert.ok(t.layers.some((l) => l.name === 'Empty' && l.count === 0), 'a layer added by hand is listed');
  assert.ok(!O.buildTree(raw, fl, {}).layers.some((l) => l.name === 'Empty'), 'an empty layer of the file is not');
});

test('tree: hidden layers and hidden objects count; the filters', () => {
  const { raw, fl } = sample();
  const off = new Set([fl.layers.findIndex((l) => l.name === 'Engrave')]);
  const t = O.buildTree(raw, fl, { off, hid: new Set([0]), open: new Set(['Cut', 'Engrave']) });
  assert.equal(t.hiddenN, 3, 'two on the hidden layer and one hidden object');
  const eng = t.layers.find((l) => l.name === 'Engrave');
  assert.ok(eng.hidden && eng.rows.every((r) => r.hidden));
  assert.equal(t.layers.find((l) => l.name === 'Cut').rows.find((r) => r.e === 0).hidden, true);
  const hiddenOnly = O.buildTree(raw, fl, { off, hid: new Set([0]), filter: 'hidden', open: new Set(['Cut', 'Engrave']) });
  assert.deepEqual(hiddenOnly.layers.map((l) => l.name).sort(), ['Cut', 'Engrave']);
  assert.deepEqual(hiddenOnly.layers.find((l) => l.name === 'Cut').rows.map((r) => r.e), [0]);
  const lk = O.buildTree(raw, fl, { locked: new Set(['Cut']), filter: 'locked', open: new Set(['Cut']) });
  assert.deepEqual(lk.layers.map((l) => l.name), ['Cut']); assert.equal(lk.lockedN, 5);
  assert.ok(lk.layers[0].rows.every((r) => r.locked));
});

test('search: by label, case-insensitive; layers without a match go; matches are listed without opening', () => {
  const { raw, fl } = sample();
  const t = O.buildTree(raw, fl, { query: 'circle' });
  assert.deepEqual(t.layers.map((l) => l.name), ['Cut']);
  assert.deepEqual(t.layers[0].rows.map((r) => r.label), ['Circle Ø40']);
  assert.equal(O.buildTree(raw, fl, { query: 'REV' }).layers[0].rows[0].label, "Text 'REV A'");
  assert.equal(O.buildTree(raw, fl, { query: 'zzz' }).layers.length, 0);
});

test('a layer lists the first CAP objects and says how many more', () => {
  const d = newDoc(4);
  addEntities(d, ...Array.from({ length: O.CAP + 30 }, (_, i) => line(0, i, 10, i, { layer: 'Cut' })));
  const raw = readDxf(writeDxf(d)), fl = flatten(raw);
  const t = O.buildTree(raw, fl, { open: new Set(['Cut']) }), cut = t.layers.find((l) => l.name === 'Cut');
  assert.equal(cut.rows.length, O.CAP); assert.equal(cut.more, 30);
  const all = O.buildTree(raw, fl, { open: new Set(['Cut']), show: new Map([['Cut', O.CAP + 30]]) }).layers.find((l) => l.name === 'Cut');
  assert.equal(all.rows.length, O.CAP + 30); assert.equal(all.more, 0);
});

test('boxOf: the box of some entities', () => {
  const { raw, fl } = sample();
  assert.deepEqual(O.boxOf(fl, [0]), [0, 0, 200, 140]);
  assert.deepEqual(O.boxOf(fl, new Set([1])), [30, 30, 70, 70]);
  assert.equal(O.boxOf(fl, []), null);
  assert.ok(raw);
});

test('hiddenIndexes: a hidden object stays hidden when an edit shifts the numbers (kept by entity object, not index)', () => {
  const { raw } = sample(), hid = new Set([raw.entities[3], raw.entities[5]]);
  assert.deepEqual([...O.hiddenIndexes(raw.entities, hid)], [3, 5]);
  const after = removeEntities(raw, new Set([0, 1]));                       // two deleted before them: they are now 1 and 3
  assert.deepEqual([...O.hiddenIndexes(after.entities, hid)], [1, 3]);
  assert.equal(after.entities[1], raw.entities[3]);
  const gone = removeEntities(raw, new Set([3]));                           // a hidden one deleted: the other stays hidden, nothing else gets hidden
  assert.deepEqual([...O.hiddenIndexes(gone.entities, hid)], [4]);
  assert.equal(O.hiddenIndexes(raw.entities, new Set()).size, 0);
});

test('renameLayer: the table, the entities and the block contents', () => {
  const { raw } = sample();
  const r = O.renameLayer(raw, 'Cut', 'Outline');
  assert.ok(r.layers.Outline && !r.layers.Cut);
  assert.equal(r.entities.filter((e) => e.layer === 'Outline').length, 5);
  assert.equal(raw.entities.filter((e) => e.layer === 'Cut').length, 5, 'the original is not touched');
  const blk = O.renameLayer(raw, '0', 'Zero');
  assert.ok(blk.blocks.LOGO.entities.every((e) => e.layer === 'Zero'));
});

test('partsTree: parts with their places; a search narrows; hidden parts are marked', () => {
  const lay = { parts: { a: { name: 'Plate', w: 10, h: 5 }, b: { name: 'Bracket', w: 4, h: 4 }, c: { name: 'Unused', w: 1, h: 1 } } };
  const placed = [{ partId: 'a', x: 0, y: 0, rot: 0, src: 'grid', i: 0 }, { partId: 'a', x: 20, y: 0, rot: 90, src: 'grid', i: 1 }, { partId: 'b', x: 5, y: 5, rot: 0, src: 'loose', i: 0, lock: true }];
  const t = O.partsTree(lay, placed, new Set(['b']));
  assert.deepEqual(t.map((p) => [p.name, p.count, p.hidden]), [['Plate', 2, false], ['Bracket', 1, true]]);
  assert.equal(t[0].places[1].label, 'X 20 · Y 0 · 90°'); assert.equal(t[1].places[0].locked, true);
  assert.deepEqual(O.partsTree(lay, placed, new Set(), 'brack').map((p) => p.name), ['Bracket']);
});

test('renameLayer: also the layer of a POLYLINE\'s VERTEX records (an old-style polyline keeps the new layer on Save)', () => {
  const P = [[0, 'SECTION'], [2, 'ENTITIES'], [0, 'POLYLINE'], [8, 'Cut'], [66, 1], [70, 0], [0, 'VERTEX'], [8, 'Cut'], [10, 0], [20, 0], [0, 'VERTEX'], [8, 'Cut'], [10, 5], [20, 0],
    [0, 'SEQEND'], [8, 'Cut'], [0, 'ENDSEC']];
  const raw = readDxf(P.map(([c, v]) => String(c).padStart(3) + '\n' + v).join('\n') + '\n  0\nEOF\n');
  raw.layers.Cut = { aci: 7, tc: null, off: false, frozen: false, lt: 'CONTINUOUS', lw: -3, handle: '' };
  const r = O.renameLayer(raw, 'Cut', 'Out');
  const back = readDxf(writeDxf({ ...raw, ...r }));
  assert.equal(back.entities[0].layer, 'Out');
  assert.deepEqual(back.entities[0].kids.map((k) => k.v[k.c.indexOf(8)]), ['Out', 'Out']);
  assert.deepEqual(raw.entities[0].kids.map((k) => k.v[k.c.indexOf(8)]), ['Cut', 'Cut'], 'the original is not touched');
});

console.log(n + ' tests passed');
