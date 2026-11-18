import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { flatten, flattenEdit, patchWidths, DrawingError, strokeWidth } from './web/drawing.js';
import * as W from './web/dxf-write.js';
import { readDxf } from './web/drawing.js';
import * as PR from './web/props.js';
import * as Ed from './web/edit.js';
import * as DOC from './web/doc.js';
import { follow as followGroups } from './web/groups.js';

// Run the actual commit, property and history paths without starting the UI.
const app = readFileSync(new URL('./web/app.js', import.meta.url), 'utf8');
const names = ['commit', 'settleMeasures', 'restore', 'restoreBg', 'propCommit', 'propEnts', 'propWidthSet', 'stepHist', 'undo', 'redo'];
const source = names.map((name) => {
  const fn = app.match(new RegExp(`^function ${name}\\([^\\r\\n]*\\) \\{[^\\r\\n]*\\r?\\n[\\s\\S]*?^\\}`, 'm'))?.[0];
  assert.ok(fn, name);
  return fn;
}).join('\n');
const snapshot = app.match(/^const snapshotOf = .*;$/m)[0] + '\n' + app.match(/^const drawnOf = .*;$/m)[0];
const noop = () => {};
const clean = (x) => JSON.parse(JSON.stringify(x));
function setup(raw, factor = 1, drawEdit = flattenEdit) {
  const d = { raw, factor, fl: flatten(raw), hist: Ed.createHistory(), sel: new Set(raw.entities.map((_, i) => i)), off: new Set(), hid: new Set() };
  d.ed = Ed.makeIndex(raw, d.fl);
  let calls = 0;
  const api = runInNewContext(`${snapshot}\n${source}\n({ ${names.join(', ')} })`, {
    Ed, PR, ...DOC, followGroups, DrawingError, patchWidths, structuredClone,
    flatten: (...args) => { calls++; return flatten(...args); },
    flattenEdit: (...args) => { calls++; return drawEdit(...args); },
    state: {}, view: {}, propDoc: () => d, propLocked: () => false, fmt: String,
    pushHistory: (doc, st, label) => doc.hist.push(st, label),
    cmpDoc: () => null, showDoc: noop, update: noop, warm: noop, renderEdit: noop, note: noop,
    setSel: (doc, sel) => { doc.sel = sel; doc.hl = Ed.itemsOfEntities(doc.fl, sel, doc.off); },
    dropLinePoint: () => false,
  });
  return { d, api, calls: () => calls };
}

test('TODO 273b: width-only commit skips flatten; old flattened items, Undo, Redo and saved widths stay correct', () => {
  for (const factor of [1, 25.4]) {
    const raw = W.newDoc(factor === 1 ? 4 : 1);
    raw.entities = [W.line(0, 0, 10, 0, { lw: 50 }), W.lwpoly([[0, 2], [10, 2]], { width: 2 }), W.circle(3, 5, 1)];
    const { d, api, calls } = setup(raw, factor), old = d.fl, before = clean(old), entities = d.raw.entities, index = d.ed;
    const widths = (fl) => fl.items.map((it) => strokeWidth(it, factor));
    const savedWidths = () => widths(flatten(readDxf(W.writeDxf(d.raw))));
    const original = widths(old);
    api.propWidthSet('Hairline');
    assert.equal(calls(), 0, 'width-only commit must not call flatten');
    assert.deepEqual(widths(d.fl), [.05, .05, .05]);
    assert.deepEqual(savedWidths(), [.05, .05, .05]);
    assert.deepEqual(clean(old), before, 'the old fl stays usable');
    assert.deepEqual(entities.map((e) => PR.widthKey(e, factor)), [.5, 2 * factor, 'ByLayer']);
    assert.notEqual(d.ed, index, 'a changed polyline bound invalidates the index');
    api.undo(d);
    assert.deepEqual(widths(d.fl), original);
    assert.deepEqual(savedWidths(), original);
    assert.equal(d.hist.canUndo, false, 'one Undo restores the whole selection');
    api.redo(d);
    assert.deepEqual(widths(d.fl), [.05, .05, .05]);
    assert.deepEqual(savedWidths(), [.05, .05, .05]);
    d.sel = new Set([0]);
    const currentIndex = d.ed = Ed.makeIndex(d.raw, d.fl);
    api.propWidthSet(.37);
    assert.equal(d.ed, currentIndex, 'a lineweight change reuses the geometry index');
    assert.equal(d.ed.items, d.fl.items);
    assert.equal(d.ed.fl, d.fl);
    assert.equal(d.fl.items[0].lw, 37);
    assert.equal(savedWidths()[0], .37);
    api.undo(d);
    assert.equal(d.fl.items[0].lw, 5);
  }
});

test('TODO 273b: DrawingError releases then restores all five caches and leaves history, selection and raw unchanged', () => {
  const raw = W.newDoc(); raw.entities = [W.line(0, 0, 10, 0)];
  let d;
  const harness = setup(raw, 1, () => {
    for (const name of ['fl', 'ed', 'outl', 'pb', 'hl']) assert.equal(d[name], null, `${name} released before flatten`);
    throw new DrawingError('too nested');
  });
  d = harness.d;
  d.outl = { loops: [] }; d.pb = { fl: d.fl }; d.hl = [d.fl.items[0]];
  d.hist.push({ marker: 'redo' }, 'Pending'); d.hist.undo({ marker: 'current' });
  const before = { ...d }, saved = W.writeDxf(raw), labels = clean(d.hist.labels());
  const next = { entities: [...raw.entities, W.line(0, 2, 10, 2)], blocks: raw.blocks };
  assert.equal(harness.api.commit(d, next, 'Add'), false);
  for (const name of Object.keys(before)) assert.equal(d[name], before[name], `${name} restored by identity`);
  assert.equal(W.writeDxf(raw), saved);
  assert.deepEqual(clean(d.hist.labels()), labels);
});

test('TODO 273b: block inheritance, constant and varying polyline widths match a fresh drawing', () => {
  const raw = W.newDoc();
  const varying = W.lwpoly([[0, 0], [10, 0], [10, 10]]);
  const at = varying.r.c.indexOf(20) + 1;
  varying.r.c.splice(at, 0, 40, 41); varying.r.v.splice(at, 0, '2', '3');
  W.addBlock(raw, 'inner', [W.line(0, 0, 4, 0, { lw: -2 }), W.line(0, 1, 4, 1, { lw: 75 })]);
  W.addBlock(raw, 'outer', [W.insert('inner', 1, 1, { lw: -2 }), W.lwpoly([[0, 2], [4, 2]], { width: 2 })]);
  const mesh = W.entity('POLYLINE', [[70, 64]]);
  mesh.kids = [
    W.entity('VERTEX', [[70, 192], [10, 0], [20, 0]]).r,
    W.entity('VERTEX', [[70, 192], [10, 10], [20, 0]]).r,
    W.entity('VERTEX', [[70, 192], [10, 0], [20, 10]]).r,
    W.entity('VERTEX', [[70, 128], [71, 1], [72, 2], [73, 3]]).r,
  ];
  raw.entities = [varying, W.insert('outer', 20, 20, { lw: 100 }), W.lwpoly([[0, 20], [10, 20]], { width: 1 }), mesh];
  for (const value of ['Hairline', 'ByLayer', .37]) {
    const { d, api, calls } = setup(structuredClone(raw));
    api.propWidthSet(value);
    assert.equal(calls(), 0);
    const expected = flatten(d.raw);
    assert.deepEqual(clean(d.fl.items), clean(expected.items));
    assert.deepEqual(clean(d.fl.boxes), clean(expected.boxes));
    assert.deepEqual(clean(d.fl.layers), clean(expected.layers));
    assert.deepEqual(clean(d.fl.insertions), clean(expected.insertions));
  }
});

test('TODO 273b: an ordinary geometry commit still restores with its disabled layers', () => {
  const raw = W.newDoc();
  W.addLayer(raw, 'off');
  raw.entities = [W.line(0, 0, 10, 0), W.line(0, 2, 10, 2, { layer: 'off' })];
  const { d, api, calls } = setup(raw);
  d.off = new Set([d.fl.layers.findIndex((l) => l.name === 'off')]);
  assert.equal(api.commit(d, Ed.moveEntities(raw, new Set([0]), 3, 4), 'Move'), true);
  assert.equal(calls(), 1);
  assert.equal(d.fl.layers[[...d.off][0]].name, 'off');
  assert.deepEqual(clean(d.fl.items), clean(flatten(d.raw).items));
  api.undo(d);
  assert.equal(d.fl.items[0].ops[1], 0);
});
