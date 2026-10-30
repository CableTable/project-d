import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from './web/edit.js';
import * as W from './web/dxf-write.js';
import { readDxf, flatten } from './web/drawing.js';
import { dimensionText, overrideText, readOverride, measuredText, textRecord, dimensionEditor, changeDimensionEditor, dimensionEditorOverride } from './web/dimension-text.js';
import { followDimensions } from './web/linked-dimensions.js';
import { dragGrip } from './web/grips.js';
import { scaleEntities } from './web/scale.js';
import { rotateEntities } from './web/rotate.js';
import { mirrorEntity } from './web/modify.js';
import * as LD from './web/layoutdoc.js';
import { isDimPart } from './web/layoutdim.js';

const params = { a: [10, 20], b: [110, 20], offset: 15, textH: 2, arrow: 1, gap: .5 };
const drawing = (override) => {
  const raw = W.newDoc(4);
  W.addEntities(raw, W.line(...params.a, ...params.b));
  Object.assign(raw, E.addDimension(raw, E.buildDim('aligned', { ...params, override }, 1, 'PD_DIM_1', 3)));
  return raw;
};
const label = (raw) => flatten(raw).items.find((i) => i.k === 't').lines.join(' ');
const reopen = (raw) => readDxf(W.writeDxf(raw, { escapeUnicode: true }));

test('dimension override: empty and <> reset; every embedded <> substitutes the measured label', () => {
  for (const s of ['', '  ', '<>']) { assert.equal(overrideText(s), ''); assert.equal(dimensionText('100.00', s), '100.00'); }
  assert.equal(dimensionText('100.00', 'L=<> (<> mm)'), 'L=100.00 (100.00 mm)');
  assert.equal(dimensionText('100.00', '7.125'), '7.125');
  assert.equal(dimensionText('R3.0', ' <>& '), ' R3.0& ');
});

test('the dimension editor shows and selects measured ranges, retaining only untouched tokens', () => {
  let edit = dimensionEditor('150.00');
  assert.equal(edit.value, '150.00'); assert.deepEqual(edit.ranges, [[0, 6]]);
  assert.equal(dimensionEditorOverride(edit), '');
  edit = changeDimensionEditor(edit, 'Width 150.00', [0, 0]);
  edit = changeDimensionEditor(edit, 'Width 150.00 mm', [12, 12]);
  assert.equal(dimensionEditorOverride(edit), 'Width <> mm');
  assert.equal(dimensionEditorOverride(changeDimensionEditor(edit, 'Width 7.125 mm', [6, 12])), 'Width 7.125 mm');
  assert.equal(dimensionEditorOverride(changeDimensionEditor(edit, 'Width 150.00 mm', [6, 12])), 'Width 150.00 mm', 'typing the same number over the selection makes it literal');
  assert.equal(dimensionEditorOverride(changeDimensionEditor(edit, 'Width 150.0 mm', [11, 12])), 'Width 150.0 mm');
  edit = dimensionEditor('150.00', '150.00 + <> / <>');
  assert.deepEqual(edit.ranges, [[9, 15], [18, 24]]);
  edit = changeDimensionEditor(edit, '150.00 + 7 / 150.00', [9, 15]);
  assert.equal(dimensionEditorOverride(edit), '150.00 + 7 / <>');
  assert.equal(dimensionEditorOverride(changeDimensionEditor(dimensionEditor('150.00'), 'Ø <>')), 'Ø <>');
});

test('dimension editor restores live ranges through grouped native Undo, Redo and a new edit', () => {
  const initial = dimensionEditor('150.00', 'Width <> / <>');
  let edit = changeDimensionEditor(initial, 'Width 7 / 150.00', [6, 12]);
  edit = changeDimensionEditor(edit, 'Width 7.125 / 150.00', [7, 7]);
  const typed = edit.value;
  edit = changeDimensionEditor(edit, initial.value, [0, 0], 'historyUndo');
  assert.deepEqual(edit.ranges, initial.ranges);
  assert.equal(dimensionEditorOverride(edit), 'Width <> / <>');
  edit = changeDimensionEditor(edit, typed, [0, 0], 'historyRedo');
  assert.equal(dimensionEditorOverride(edit), 'Width 7.125 / <>');
  edit = changeDimensionEditor(edit, initial.value, [0, 0], 'historyUndo');
  edit = changeDimensionEditor(edit, 'New ' + edit.value, [0, 0]);
  assert.equal(dimensionEditorOverride(edit), 'New Width <> / <>');
  assert.equal(edit.index, edit.history.length - 1, 'a new input discards the redo branch');
  const literal = changeDimensionEditor(dimensionEditor('150.00'), '150.00', [0, 6]);
  assert.deepEqual(literal.ranges, []);
  assert.deepEqual(changeDimensionEditor(literal, '150.00', [0, 0], 'historyUndo').ranges, [[0, 6]], 'identical text can have different live ranges');
});

test('all five dimension kinds retain group 1 templates, units and decimals on DXF reopen', () => {
  const kinds = { aligned: params, linear: { ...params, axis: 'h' }, diameter: params,
    radius: { c: [0, 0], r: 20, p: [30, 10], textH: 2 }, angle: { v: [0, 0], r: 20, a0: 0, a1: 45, textH: 2 } };
  for (const [kind, p] of Object.entries(kinds)) for (const override of ['7.125', '長さ <> / <>']) {
    const raw = W.newDoc(4), name = E.freeName({}, kind, p.axis);
    Object.assign(raw, E.addDimension(raw, E.buildDim(kind, { ...p, units: 'inch', override }, 1, name, 3)));
    const doc = reopen(raw), dim = E.dimOfEntity(doc, 0), record = textRecord(doc.blocks[name].entities);
    assert.equal(record.r.v[record.r.c.indexOf(1)].includes('<>'), override.includes('<>'));
    assert.equal(dim.params.override, override); assert.equal(dim.dp, 3);
    assert.equal(dim.params.units, kind === 'angle' ? 'mm' : 'inch');
    assert.equal(label(doc), dimensionText(measuredText(doc.blocks[name].entities), override));
    const built = E.buildDim(kind, dim.params, 1, name, dim.dp);
    assert.equal(built.label, label(doc));
  }
});

test('follow after Move, Scale and a source grip keeps static overrides and updates only <>', () => {
  for (const override of ['7.125', 'Width <> mm']) {
    let raw = reopen(drawing(override));
    const move = followDimensions(raw, E.moveEntities(raw, new Set([0]), 5, 7));
    raw = { ...raw, ...move };
    assert.equal(E.dimOfEntity(raw, 1).params.override, override);
    const next = followDimensions(raw, scaleEntities(raw, new Set([0]), [15, 27], 2));
    raw = { ...raw, ...next };
    assert.equal(label(raw), dimensionText('200.000', override));
    const grip = dragGrip(raw.entities[0], 'b', [315, 27]).ent;
    raw = { ...raw, ...followDimensions(raw, { entities: [grip, raw.entities[1]], blocks: raw.blocks }) };
    assert.equal(label(raw), dimensionText('300.000', override));
    assert.equal(readOverride(raw.blocks.PD_DIM_1.entities), override);
  }
});

test('transforming a dimension itself preserves numeric overrides and remeasures placeholders', () => {
  for (const override of ['7.125', 'Width <> mm']) {
    let raw = drawing(override);
    raw = { ...raw, ...scaleEntities(raw, new Set([1]), [0, 0], 2) };
    assert.equal(label(raw), dimensionText('200.000', override));
    assert.equal(E.dimOfEntity(raw, 1).params.override, override);
    raw = { ...raw, ...rotateEntities(raw, new Set([1]), [0, 0], 30) };
    assert.equal(label(raw), dimensionText('200.000', override));
    assert.equal(E.dimOfEntity(raw, 1).params.override, override);
    const mirrored = mirrorEntity(raw.entities[1], [0, 0], [0, 1], raw.blocks);
    assert.ok(mirrored.ent);
    raw = reopen({ ...raw, entities: [raw.entities[0], mirrored.ent], blocks: mirrored.blocks });
    assert.equal(label(raw), dimensionText('200.000', override));
    assert.equal(E.dimOfEntity(raw, 1).params.override, override);
    raw = { ...raw, ...scaleEntities(raw, new Set([1]), [0, 0], 1.5) };
    assert.equal(label(raw), dimensionText('300.000', override), '<> is still live after rotate and mirror');
    assert.equal(E.dimOfEntity(raw, 1).params.override, override);
  }
});

test('decimal changes keep overrides and preserve the new precision for the next rebuild', () => {
  for (const override of ['7.125', 'Width <> mm']) {
    const raw = drawing(override), next = { ...raw, ...E.relabelDims(raw, 1, 1) }, dim = E.dimOfEntity(next, 1);
    assert.equal(dim.dp, 1); assert.equal(dim.params.override, override);
    assert.equal(label(next), dimensionText('100.0', override));
    const built = E.buildDim(dim.kind, { ...dim.params, b: [210, 20] }, 1, dim.name, dim.dp);
    assert.equal(built.label, dimensionText('200.0', override));
  }
});

test('layout dimensions save overrides, settle scaled placements, and follow a later source grip', () => {
  for (const override of ['7.125', 'Width <> mm', 'Ø <>']) {
    let id = 0;
    const newId = () => 'o' + ++id, raw = drawing(override), lay = LD.newLayout();
    for (const ent of raw.entities) {
      const part = LD.objectPart(newId(), ent.type, ent, raw.layers, raw.header, ent.type === 'INSERT' ? raw.blocks : {});
      lay.parts[part.id] = part; lay.placed.push(LD.objectPlacement(part));
    }
    const prev = LD.linkView(lay), view = LD.objectDoc(lay), ent = view.raw.entities[0];
    assert.ok(LD.objectReplace(lay, view, ent, dragGrip(ent, 'b', [160, 20]).ent, newId));
    assert.ok(LD.followDims(lay, prev, LD.linkView(lay), newId));
    assert.equal(label(LD.layoutRaw(lay)), dimensionText('150.000', override));
    lay.placed[1].sc = 2; LD.settleDims(lay, newId);
    const doc = LD.layoutRaw(lay);
    assert.equal(label(doc), dimensionText('300.000', override));
    const reopened = LD.layoutFromRaw(reopen(doc));
    assert.equal(Object.values(reopened.parts).filter(isDimPart).length, 1);
    assert.equal(label(LD.layoutRaw(reopened)), dimensionText('300.000', override));
    for (const transform of [{ rot: 30 }, { mirrorX: true }, { sc: 2 }]) {
      Object.assign(reopened.placed.find((p) => isDimPart(reopened.parts[p.partId])), transform); LD.settleDims(reopened, newId);
      const transformed = LD.layoutRaw(reopened), dim = transformed.entities.map((_, i) => E.dimOfEntity(transformed, i)).find(Boolean);
      assert.equal(dim.params.override, override);
      assert.equal(label(transformed), dimensionText(transform.sc ? '600.000' : '300.000', override));
    }
  }
});
