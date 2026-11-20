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

test('save drops unused PD_DIM_ styles after deleting a dimension, retaining used and unrelated styles', () => {
  const raw = W.newDoc(4);
  Object.assign(raw, E.addDimension(raw, E.buildDim('aligned', { ...kinds.aligned, textH: 2, override: 'Width <>' }, 1, 'PD_DIM_1')));
  const reopened = readDxf(W.writeDxf(nativeDimensionOverrides(raw)));
  const style = reopened.dimstyles.PD_DIM_1;
  assert.ok(style, 'native style was saved and reopened');
  reopened.dimstyles.Unrelated = style;
  reopened.dimstyles.PD_DIM_USED = style;
  reopened.dimstyles.PD_DIM_NESTED = style;
  W.addEntities(reopened, W.entity('DIMENSION', [[2, '*D1'], [3, 'pd_dim_used'], [70, 1]]));
  W.addBlock(reopened, 'Nested', [W.entity('DIMENSION', [[2, '*D2'], [3, 'PD_DIM_NESTED'], [70, 1]])]);
  W.addEntities(reopened, W.insert('Nested', 0, 0));
  const deleted = { ...reopened, ...E.removeEntities(reopened, new Set([0])) };
  const before = structuredClone(deleted), saved = nativeDimensionOverrides(deleted);
  assert.deepEqual(Object.keys(saved.dimstyles).sort(), ['PD_DIM_NESTED', 'PD_DIM_USED', 'Standard', 'Unrelated']);
  assert.equal(readDxf(W.writeDxf(saved)).dimstyles.PD_DIM_1, undefined, 'unused style is absent from the saved file');
  assert.deepEqual(structuredClone(deleted), before, 'saving leaves the working document intact');
});

test('save keeps a PD_DIM_ style that a LEADER names', () => {
  const raw = W.newDoc(4);
  Object.assign(raw, E.addDimension(raw, E.buildDim('aligned', { ...kinds.aligned, textH: 2, override: 'Width <>' }, 1, 'PD_DIM_1')));
  const reopened = readDxf(W.writeDxf(nativeDimensionOverrides(raw)));
  assert.ok(reopened.dimstyles.PD_DIM_1);
  const kept = { ...reopened, ...E.removeEntities(reopened, new Set([0])) };
  assert.equal(nativeDimensionOverrides(kept).dimstyles.PD_DIM_1, undefined, 'unused: dropped');
  W.addEntities(kept, W.entity('LEADER', [[3, 'pd_dim_1'], [71, 1], [76, 2], [10, 0], [20, 0], [30, 0], [10, 5], [20, 5], [30, 0]]));
  assert.ok(nativeDimensionOverrides(kept).dimstyles.PD_DIM_1, 'named by a LEADER: kept');
  assert.ok(readDxf(W.writeDxf(nativeDimensionOverrides(kept))).dimstyles.PD_DIM_1);
});

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

test('TODO 345a: a text dragged along the dimension line is group 11 with bit 128 of group 70, and reads back from it', () => {
  const field = (e, c) => +e.r.v[e.r.c.indexOf(c)];
  const make = (shift) => { const raw = W.newDoc(4); Object.assign(raw, E.addDimension(raw, E.buildDim('aligned', { ...kinds.aligned, textH: 2.5, override: 'W <>', shift }, 1, 'PD_DIM_1'))); return raw; };
  const plain = nativeDimensionOverrides(make(undefined)).entities[0], moved = nativeDimensionOverrides(make(80)).entities[0];
  assert.ok(field(moved, 70) & 128, 'user-positioned text flag'); assert.ok(field(plain, 70) & 128, 'already set today');
  assert.ok(Math.abs(field(moved, 11) - field(plain, 11) - 80) < 1e-6, 'group 11 is 80 further along the line (+x)'); assert.ok(Math.abs(field(moved, 21) - field(plain, 21)) < 1e-6);
  const text = W.writeDxf(nativeDimensionOverrides(make(80)));
  const back = readDxf(text), got = E.dimOfEntity(back, 0);
  assert.ok(Math.abs(got.params.shift - 80) < 1e-4, 'the block text reads back as a shift, ' + got.params.shift); assert.equal(got.params.override, 'W <>');
  assert.equal(E.dimOfEntity(readDxf(W.writeDxf(nativeDimensionOverrides(make(undefined)))), 0).params.shift, undefined, 'no moved text: no shift');
  // group 11 wins: a file whose group 11 sits elsewhere than the block's text puts the text there
  const at = text.indexOf('AcDbDimension'), edited = text.slice(0, at) + text.slice(at).replace(/\r?\n 11\r?\n([-\d.e+]+)\r?\n 21\r?\n/, (m, x) => m.replace(x, String(+x - 30)));
  assert.ok(edited !== text, 'group 11 of the DIMENSION edited');
  const again = E.dimOfEntity(readDxf(edited), 0);
  assert.ok(Math.abs(again.params.shift - 50) < 1e-4, 'text moved 30 back along the line: ' + again.params.shift);
});
