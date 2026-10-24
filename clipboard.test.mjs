import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copySnapshot, pasteSnapshot, partFromSnapshot } from './web/clipboard.js';
import { newDoc, addEntities, addLayer, addBlock, line, circle, insert, entity, writeDxf } from './web/dxf-write.js';
import { readDxf, flatten } from './web/drawing.js';
import { addDimension, buildDim, readDim, createHistory, moveEntities } from './web/edit.js';
import * as LR from './web/leader.js';

const field = (e, c) => e.r.v[e.r.c.indexOf(c)];
const target = (raw = newDoc(4), factor = 1, space = 0) => ({ raw, factor, space, dp: 2, names: Object.keys(raw.layers), hidden: [], locked: [], cur: '0' });
const copyAll = (raw, factor = 1) => copySnapshot(raw, new Set(raw.entities.map((_, i) => i)), factor, 'source.dxf');

test('a layout paste keeps the copied source name, gets an unused library name, and owns its extracted drawing', () => {
  const raw = newDoc(1); addEntities(raw, circle(2.25, 3.5, 0.5));
  const snapshot = copySnapshot(raw, new Set([0]), 25.4, 'Source <b>.dxf'), before = structuredClone(snapshot);
  const first = partFromSnapshot(snapshot, 'one', []);
  assert.equal(first.name, 'Source <b>.dxf paste'); assert.equal(first.src, 'Source <b>.dxf');
  assert.equal(first.factor, 25.4); assert.deepEqual(first.box, [1.75, 3, 2.75, 4]);
  assert.equal(first.w, 25.4); assert.equal(first.h, 25.4);
  const second = partFromSnapshot(snapshot, 'two', ['SOURCE <B>.DXF PASTE']);
  assert.equal(second.name, 'Source <b>.dxf paste 2');
  assert.equal(partFromSnapshot(snapshot, 'three', [first.name, second.name]).name, 'Source <b>.dxf paste 3');
  first.raw.entities[0].r.v[0] = 'changed';
  assert.deepEqual(snapshot, before); assert.deepEqual(second.raw.entities, snapshot.raw.entities);
});

test('layout paste follows extraction: kept dimensions are excluded; a dimension-only clipboard has no part', () => {
  let raw = newDoc(4);
  raw = { ...raw, ...addDimension(raw, buildDim('radius', { c: [20, 30], r: 5, p: [40, 30] }, 1, 'PD_DIM_R1', 2)) };
  const dims = copySnapshot(raw, new Set([0]), 1, 'dimensions.dxf');
  assert.equal(partFromSnapshot(dims, 'none', []), null);
  addEntities(raw, circle(20, 30, 5));
  const mixed = partFromSnapshot(copyAll(raw), 'outline', []);
  assert.equal(mixed.raw.entities.length, 1); assert.equal(mixed.raw.entities[0].type, 'CIRCLE');
  assert.deepEqual(mixed.raw.blocks, {});
});

test('snapshot keeps only the selected objects and their nested blocks; paste is independent, same coordinates, one Undo', () => {
  const raw = newDoc(4);
  addBlock(raw, 'CHILD', [circle(5, 6, 2)]);
  addBlock(raw, 'PARENT', [insert('CHILD', 1, 2)]);
  addBlock(raw, 'UNUSED', [line(0, 0, 1, 1)]);
  addEntities(raw, insert('PARENT', 20, 30), line(40, 50, 60, 70));
  const snapshot = copySnapshot(raw, new Set([0]), 1, 'source.dxf'), original = structuredClone(snapshot);
  raw.blocks.CHILD.entities[0].r.v[raw.blocks.CHILD.entities[0].r.c.indexOf(40)] = '99';
  raw.entities.length = 0;
  const t = target(), before = structuredClone(t.raw), r = pasteSnapshot(snapshot, t);
  assert.deepEqual(Object.keys(r.blocks).sort(), ['CHILD', 'PARENT']);
  assert.equal(r.count, 1); assert.equal(r.from, 0);
  assert.equal(+field(r.entities[0], 10), 20); assert.equal(+field(r.entities[0], 20), 30);
  assert.equal(+field(r.blocks.CHILD.entities[0], 40), 2);
  const hist = createHistory(); hist.push(t.raw, 'Paste 1');
  assert.deepEqual(hist.undo(r), before);
  r.blocks.CHILD.entities[0].r.v[0] = 'changed';
  assert.deepEqual(snapshot, original); assert.deepEqual(t.raw, before);
  assert.deepEqual(pasteSnapshot(snapshot, t).entities, original.raw.entities.map((e) => ({ ...e, ps: false })));
});

test('case-insensitive block clashes, including nested references and multiple renamed blocks, never clobber anything', () => {
  const raw = newDoc(4);
  for (const name of ['A', 'a_2', 'B']) addBlock(raw, name, [line(0, 0, 1, 1)]);
  raw.blocks.B.entities = [insert('A', 0, 0), insert('a_2', 0, 0)];
  addEntities(raw, insert('B', 10, 20));
  const t = target();
  for (const name of ['a', 'A_2', 'b']) addBlock(t.raw, name, [circle(0, 0, 1)]);
  const before = structuredClone(t.raw), r = pasteSnapshot(copyAll(raw), t);
  assert.equal(new Set(Object.keys(r.blocks).map((n) => n.toLowerCase())).size, Object.keys(r.blocks).length);
  for (const [name, block] of Object.entries(before.blocks)) assert.deepEqual(r.blocks[name], block);
  const parent = r.blocks[field(r.entities[0], 2)];
  assert.equal(parent.entities.length, 2);
  for (const e of parent.entities) assert.equal(r.blocks[field(e, 2)].entities[0].type, 'LINE');
  assert.notEqual(field(parent.entities[0], 2), field(parent.entities[1], 2));
});

for (const nested of [false, true]) test(`pasted ${nested ? 'nested ' : ''}tables bring their own block when the target has *T1`, () => {
  const raw = newDoc(4), t = target();
  addBlock(raw, '*T1', [line(0, 0, 10, 20)]);
  const table = entity('ACAD_TABLE', [[2, '*T1'], [10, 0], [20, 0]]);
  if (nested) addBlock(raw, 'PARENT', [table]);
  addEntities(raw, nested ? insert('PARENT', 0, 0) : table);
  addBlock(t.raw, '*T1', [circle(0, 0, 5)]);
  addEntities(t.raw, table);
  const before = structuredClone(t.raw), r = pasteSnapshot(copyAll(raw), t);
  const pasted = nested ? r.blocks[field(r.entities[r.from], 2)].entities[0] : r.entities[r.from];
  const name = field(pasted, 2);
  assert.notEqual(name, '*T1');
  assert.deepEqual(r.blocks[name], raw.blocks['*T1']);
  assert.deepEqual(r.blocks['*T1'], before.blocks['*T1']);
  assert.deepEqual(r.entities[0], before.entities[0]);
  assert.deepEqual(t.raw, before);
});

for (const [kind, params, name] of [
  ['aligned', { a: [10, 20], b: [50, 20], offset: 8 }, 'PD_DIM_1'],
  ['linear', { a: [10, 20], b: [50, 40], offset: 8, axis: 'h' }, 'PD_DIM_H1'],
  ['radius', { c: [20, 30], r: 5, p: [40, 30] }, 'PD_DIM_R1'],
  ['diameter', { a: [15, 30], b: [25, 30], offset: 8 }, 'PD_DIM_D1'],
  ['angle', { v: [20, 30], r: 10, a0: 0, a1: 45 }, 'PD_DIM_A1'],
]) test(`${kind} dimensions keep their kind and private blocks on repeated paste and unit conversion`, () => {
  let raw = newDoc(4);
  raw = { ...raw, ...addDimension(raw, buildDim(kind, params, 1, name, 2)) };
  const snapshot = copyAll(raw), t = target(structuredClone(raw));
  const first = pasteSnapshot(snapshot, t), second = pasteSnapshot(snapshot, target({ ...t.raw, ...first }));
  const names = second.entities.map((e) => field(e, 2));
  assert.equal(new Set(names).size, 3);
  for (const nm of names) assert.equal(readDim(nm, second.blocks[nm]).kind, kind);
  assert.deepEqual(second.blocks[name], raw.blocks[name]);
  assert.notEqual(second.blocks[names[2]], first.blocks[names[1]], 'each paste owns its blocks');
  const inches = pasteSnapshot(snapshot, target(newDoc(1), 25.4));
  const model = readDim(field(inches.entities[0], 2), inches.blocks[field(inches.entities[0], 2)]);
  const key = kind === 'angle' ? 'v' : kind === 'radius' ? 'c' : 'a';
  assert.ok(Math.abs(model.params[key][0] * 25.4 - params[key][0]) < 1e-5);
  const label = (blocks) => Object.values(blocks)[0].entities.find((e) => e.type === 'TEXT').r;
  assert.equal(label(inches.blocks).v[label(inches.blocks).c.indexOf(1)], label(raw.blocks).v[label(raw.blocks).c.indexOf(1)], 'physical measurement stays the same');
});

test('leaders keep a private block and remain editable after a clash', () => {
  const raw = newDoc(4), built = LR.build({ pts: [[10, 20], [30, 40]], textH: 3, arrow: 2, lines: ['note'] }, 'PD_LDR_1');
  Object.assign(raw, addDimension(raw, built));
  const r = pasteSnapshot(copyAll(raw), target(raw));
  const name = field(r.entities[1], 2);
  assert.notEqual(name, 'PD_LDR_1'); assert.deepEqual(LR.read(name, r.blocks[name]), LR.read('PD_LDR_1', raw.blocks.PD_LDR_1));
  assert.notEqual(r.blocks[name], raw.blocks.PD_LDR_1);
});

test('unit conversion also scales the insert offsets of previously moved dimensions and leaders', () => {
  let raw = newDoc(4);
  raw = { ...raw, ...addDimension(raw, buildDim('radius', { c: [20, 30], r: 5, p: [40, 30] }, 1, 'PD_DIM_R1', 2)) };
  raw = { ...raw, ...addDimension(raw, LR.build({ pts: [[10, 20], [30, 40]], textH: 3, arrow: 2, lines: ['note'] }, 'PD_LDR_1')) };
  raw = { ...raw, ...moveEntities(raw, new Set([0, 1]), 12, 18) };
  const r = pasteSnapshot(copyAll(raw), target(newDoc(1), 25.4));
  for (const e of r.entities) {
    assert.ok(Math.abs(+field(e, 10) * 25.4 - 12) < 1e-9);
    assert.ok(Math.abs(+field(e, 20) * 25.4 - 18) < 1e-9);
  }
});

test('missing layers and linetypes used inside blocks transfer with their colour and pattern; target layers stay', () => {
  const raw = newDoc(4);
  addLayer(raw, 'CUT', { aci: 1, tc: 0x123456, lt: 'DASHED' });
  raw.ltypes.DASHED = { pattern: [2, -1] };
  addBlock(raw, 'B', [line(0, 0, 10, 10, { layer: 'CUT' })]); addEntities(raw, insert('B', 20, 30));
  const t = target(), r = pasteSnapshot(copyAll(raw), t);
  assert.deepEqual(r.layers.CUT, raw.layers.CUT); assert.deepEqual(r.ltypes.DASHED, raw.ltypes.DASHED);
  assert.deepEqual(r.made, ['CUT']); assert.deepEqual(t.raw.layers, newDoc(4).layers);
  const reopened = readDxf(writeDxf({ ...t.raw, ...r }));
  assert.equal(reopened.layers.CUT.tc, 0x123456); assert.deepEqual(reopened.ltypes.DASHED.pattern, [2, -1]);
  addLayer(t.raw, 'cut', { aci: 5 });
  const own = pasteSnapshot(copyAll(raw), target(t.raw));
  assert.equal(own.layers.cut.aci, 5); assert.equal(own.blocks.B.entities[0].layer, 'cut');
});

test('coordinates and size convert between mm and inches; the shown target space receives the objects', () => {
  const raw = newDoc(1); addEntities(raw, circle(2, 3, 1, { ps: true }));
  for (const space of [0, 1]) {
    const t = target(newDoc(4), 1, space), r = pasteSnapshot(copyAll(raw, 25.4), t), e = r.entities[0];
    assert.equal(+field(e, 10), 50.8); assert.equal(+field(e, 20), 76.2); assert.equal(+field(e, 40), 25.4);
    assert.equal(e.ps, !!space);
    assert.ok(flatten({ ...t.raw, ...r }).items.length);
  }
});

test('paste reuses library-drop handling of existing hidden or locked layers, keeping the new objects visible and editable', () => {
  const raw = newDoc(4); addLayer(raw, 'CUT', { aci: 1 }); addEntities(raw, line(10, 20, 30, 40, { layer: 'CUT' }));
  for (const flag of ['hidden', 'locked']) {
    const t = target(); addLayer(t.raw, 'CUT', { aci: 5 }); t.names.push('CUT'); t[flag] = ['CUT'];
    const r = pasteSnapshot(copyAll(raw), t);
    assert.equal(r.entities[0].layer, '0'); assert.deepEqual(r.moved, { CUT: 1 }); assert.equal(r.layers.CUT.aci, 5);
  }
});

test('untranslated native dimensions and hatches can paste; unsupported scaling refuses without changing the target', () => {
  const raw = newDoc(4);
  addBlock(raw, '*D1', [line(10, 20, 30, 40)]);
  addEntities(raw, entity('DIMENSION', [[2, '*D1'], [10, 10], [20, 20]]), entity('HATCH', [[10, 0], [20, 0]]));
  const r = pasteSnapshot(copyAll(raw), target());
  assert.deepEqual(r.entities, raw.entities);
  addEntities(raw, entity('UNKNOWN', [[10, 1], [20, 2]]));
  const t = target(), before = structuredClone(t.raw);
  assert.throws(() => pasteSnapshot(copyAll(raw, 25.4), t), /Cannot scale UNKNOWN/);
  assert.deepEqual(t.raw, before);
});
