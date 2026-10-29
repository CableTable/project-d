import test from 'node:test';
import assert from 'node:assert/strict';
import DxfParser from 'dxf-parser';
import * as E from './web/edit.js';
import * as W from './web/dxf-write.js';
import { readDxf, flatten } from './web/drawing.js';
import { nativeDimensionOverrides } from './web/dimension-dxf.js';
import { scaleEntities } from './web/scale.js';
import { rotateEntities } from './web/rotate.js';
import { mirrorEntity } from './web/modify.js';

const kinds = {
  aligned: { a: [10, 20], b: [110, 20], offset: 15 },
  linear: { a: [10, 20], b: [110, 20], offset: 15, axis: 'h' },
  diameter: { a: [10, 20], b: [110, 20] },
  radius: { c: [10, 20], r: 20, p: [40, 40] },
  angle: { v: [10, 20], r: 20, a0: 350, a1: 395 },
};
const labels = (raw) => flatten(raw).items.filter((i) => i.k === 't').map((i) => i.lines);

test('drawing overrides export as native DIMENSION group 1, including Unicode, and reopen editable', () => {
  for (const [kind, params] of Object.entries(kinds)) for (const override of ['7.125', 'Ø <> / <>']) for (const units of ['mm', 'inch']) {
    let raw = W.newDoc(4);
    Object.assign(raw, E.addDimension(raw, E.buildDim(kind, { ...params, textH: 2, override, units }, 1, E.freeName({}, kind, params.axis), 3)));
    raw = { ...raw, ...scaleEntities(raw, new Set([0]), [0, 0], 2) };
    raw = { ...raw, ...rotateEntities(raw, new Set([0]), [0, 0], 30) };
    const mirror = mirrorEntity(raw.entities[0], [0, 0], [0, 1], raw.blocks);
    raw = { ...raw, entities: [mirror.ent], blocks: mirror.blocks };
    const before = W.writeDxf(raw), native = nativeDimensionOverrides(raw), text = W.writeDxf(native, { escapeUnicode: true });
    assert.equal(native.entities[0].type, 'DIMENSION');
    const style = Object.values(native.dimstyles)[0];
    assert.equal(style.v[style.c.indexOf(kind === 'angle' ? 179 : 271)], '3', 'native measurement precision');
    assert.equal(style.v[style.c.indexOf(3)], kind !== 'angle' && units === 'inch' ? '<>"' : '', 'native unit suffix');
    const acad = new DxfParser().parseSync(text).entities[0];
    assert.equal(acad.type, 'DIMENSION'); assert.equal(acad.text, override.replace('Ø', '\\U+00D8'));
    if (override.includes('Ø')) assert.ok(text.includes('\\U+00D8'));
    const back = readDxf(text), dim = E.dimOfEntity(back, 0);
    assert.equal(dim.params.override, override); assert.equal(dim.dp, 3);
    assert.deepEqual(labels(back), labels(raw));
    assert.equal(W.writeDxf(raw), before, 'save never changes the source document');
    assert.equal(nativeDimensionOverrides(back).entities[0].type, 'DIMENSION');
    const built = E.buildDim(dim.kind, { ...dim.params, override: 'Changed <>' }, 1, dim.name, dim.dp);
    assert.ok(built.label.startsWith('Changed '), 'the reopened dimension can be edited and rebuilt');
  }
});

test('measured dimensions keep their existing INSERT save representation', () => {
  const raw = W.newDoc(4);
  Object.assign(raw, E.addDimension(raw, E.buildDim('aligned', { ...kinds.aligned, textH: 2 }, 1, 'PD_DIM_1')));
  assert.equal(nativeDimensionOverrides(raw).entities[0], raw.entities[0]);
});

test('native group 1 is authoritative on reopen; unrelated DIMENSION entities remain native', () => {
  const raw = W.newDoc(4);
  Object.assign(raw, E.addDimension(raw, E.buildDim('aligned', { ...kinds.aligned, textH: 2, override: 'Old <>' }, 1, 'PD_DIM_1')));
  const native = nativeDimensionOverrides(raw), e = native.entities[0];
  e.r.v[e.r.c.indexOf(1)] = 'Ø <>';
  native.entities.push(W.entity('DIMENSION', [[2, '*D1'], [70, 1], [1, 'External <>']]));
  const back = readDxf(W.writeDxf(native, { escapeUnicode: true }));
  assert.equal(E.dimOfEntity(back, 0).params.override, 'Ø <>');
  assert.deepEqual(labels(back), [['Ø 100.00']]);
  assert.equal(back.entities[1].type, 'DIMENSION');
});

test('shared dimension inserts get separate world-coordinate blocks; non-uniform imports stay intact', () => {
  const raw = W.newDoc(4);
  Object.assign(raw, E.addDimension(raw, E.buildDim('aligned', { ...kinds.aligned, textH: 2, override: 'Ø <>' }, 1, 'PD_DIM_1')));
  raw.entities.push(W.insert('PD_DIM_1', 100, 50));
  raw.entities.push(W.insert('PD_DIM_1', 0, 0, { sx: 2, sy: 1 }));
  const native = nativeDimensionOverrides(raw), names = native.entities.map((e) => e.r.v[e.r.c.indexOf(2)]);
  assert.equal(new Set(names).size, 3);
  assert.equal(native.entities[2], raw.entities[2]);
  assert.equal(native.blocks.PD_DIM_1, raw.blocks.PD_DIM_1);
  const back = readDxf(W.writeDxf(native));
  assert.deepEqual(E.dimOfEntity(back, 1).params.a, [110, 70]);
  assert.deepEqual(E.dimOfEntity(back, 0).params.a, [10, 20]);
});
