import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { flatten, flattenEdit, readDxf, DrawingError, patchWidths } from './web/drawing.js';
import * as W from './web/dxf-write.js';
import * as Ed from './web/edit.js';
import * as DOC from './web/doc.js';
import { follow as followGroups } from './web/groups.js';
import { bigDoc, splineDoc } from './tools/gen-big-dxf.mjs';

// TODO 319b + 319c: Undo / Redo reuse the stored fl; restore patches the pick index and the counts. The real commit / restore / undo / redo run on a fake tab.
const app = readFileSync(new URL('./web/app.js', import.meta.url), 'utf8');
const names = ['commit', 'settleMeasures', 'restore', 'restoreBg', 'stepHist', 'undo', 'redo'];
const source = names.map((name) => {
  const fn = app.match(new RegExp(`^function ${name}\\([^\\r\\n]*\\) \\{[^\\r\\n]*\\r?\\n[\\s\\S]*?^\\}`, 'm'))?.[0];
  assert.ok(fn, name);
  return fn;
}).join('\n');
const consts = ['snapshotOf', 'drawnOf'].map((n) => app.match(new RegExp(`^const ${n} = .*;$`, 'm'))[0]).join('\n');
const clean = (x) => JSON.parse(JSON.stringify(x));
function setup(raw, hid = new Set()) {
  const d = { raw, factor: 1, fl: flatten(raw, hid), hist: Ed.createHistory(), sel: new Set(), off: new Set(), hid };
  const n = { flatten: 0, from: [] };       // from: for each restore, whether the counts were patched from a state before (true) or counted in full
  const api = runInNewContext(`${consts}\n${source}\n({ ${names.join(', ')} })`, {
    Ed, ...DOC, followGroups, DrawingError, patchWidths, structuredClone,
    patchedCounts: (prev, ...a) => { n.from.push(!!prev); return DOC.patchedCounts(prev, ...a); },
    flatten: (...a) => { n.flatten++; return flatten(...a); },
    flattenEdit: (...a) => { n.flatten++; return flattenEdit(...a); },
    state: {}, view: {}, pushHistory: (doc, st, label) => doc.hist.push(st, label),
    cmpDoc: () => null, showDoc() {}, update() {}, warm() {}, renderEdit() {}, note() {},
    setSel: (doc, sel) => { doc.sel = sel; }, dropLinePoint: () => false,
  });
  return { d, api, n };
}
const sheet = () => {
  const raw = W.newDoc(4);
  W.addLayer(raw, 'Marks', { aci: 3 });
  W.addBlock(raw, 'Mark', [W.circle(0, 0, 2, { layer: 'Marks' }), W.line(0, 0, 0, 2)]);
  W.addEntities(raw, W.line(1, 1, 4, 3), W.line(7, 4, 10, 8), W.insert('Mark', 14, 14), W.line(20, 1, 22, 3, { layer: 'Marks' }), W.circle(30, 5, 2));
  return readDxf(W.writeDxf(raw));
};
const sameState = (d) => {
  const fresh = flatten(d.raw, d.hid);
  assert.deepEqual(clean(d.fl), clean(fresh), 'the drawn items match a fresh flatten');
  assert.deepEqual(d.counts, DOC.layerCounts(d.raw, d.fl), 'layer counts');
  assert.equal(d.entities, DOC.entityCount(d.raw, d.fl), 'entity count');
};

test('319b Undo and Redo of a Delete reuse the stored fl: no flatten, same drawing', () => {
  const { d, api, n } = setup(sheet());
  const first = d.fl;
  d.sel = new Set([1]);
  assert.equal(api.commit(d, Ed.removeEntities(d.raw, d.sel), 'Delete 1'), true);
  assert.equal(n.flatten, 1, 'the commit patched once');
  const deleted = d.fl;
  api.undo(d);
  assert.equal(d.fl, first, 'Undo brings back the very same fl');
  sameState(d);
  api.redo(d);
  assert.equal(d.fl, deleted, 'Redo brings back the fl of the deleted state');
  sameState(d);
  assert.equal(n.flatten, 1, 'Undo and Redo drew nothing again');
});

test('319b a stale d.hid draws again: the stored fl was made with other hidden entities', () => {
  const { d, api, n } = setup(sheet());
  d.sel = new Set([1]);
  assert.equal(api.commit(d, Ed.removeEntities(d.raw, d.sel), 'Delete 1'), true);
  const hidden = d.raw.entities[0];
  d.hid = new Set([hidden]);       // the Objects tab hid an object after the edit
  const flatBefore = n.flatten;
  api.undo(d);
  assert.equal(n.flatten, flatBefore + 1, 'Undo flattened again');
  assert.deepEqual(clean(d.fl), clean(flatten(d.raw, d.hid)));
  d.hid = new Set();
  api.redo(d);
  assert.equal(n.flatten, flatBefore + 2, 'the Redo-side fl was made with the hidden object: drawn again');
  assert.deepEqual(clean(d.fl), clean(flatten(d.raw, d.hid)));
});

test('319b the stored fl is kept on the newest 10 steps only', () => {
  const raw = W.newDoc(); raw.entities = Array.from({ length: 14 }, (_, i) => W.line(0, i, 10, i));
  const { d, api } = setup(raw);
  for (let i = 0; i < 12; i++) { d.sel = new Set([0]); assert.equal(api.commit(d, Ed.removeEntities(d.raw, d.sel), 'Delete'), true); }
  const kept = [];
  for (let k = 0; k < 12; k++) { kept.push(!!d.hist.currentStep.fl); d.hist.undo({}); }
  assert.deepEqual(kept, [...Array(Ed.KEEP_FL).fill(true), ...Array(12 - Ed.KEEP_FL).fill(false)], 'the newest steps keep fl, the older ones lost it');
  // Redo side: 12 Undos on a history whose current states carry fl keep fl on the newest 11 redo entries only
  const h = Ed.createHistory();
  for (let i = 0; i < 12; i++) h.push({ fl: { i }, hid: null }, 'x');
  for (let i = 0; i < 12; i++) h.undo({ fl: { now: i } });
  assert.equal(Array.from({ length: 12 }, () => h.redo({})).filter((s) => s.fl).length, Ed.KEEP_FL, 'only the newest steps of the Redo list kept fl');
});

test('319b Undo after a layer toggle gives the drawing as it was (d.off by name, fl reused)', () => {
  const { d, api, n } = setup(sheet());
  d.sel = new Set([3]);
  assert.equal(api.commit(d, Ed.removeEntities(d.raw, d.sel), 'Delete 1'), true);
  d.off = new Set([d.fl.layers.findIndex((l) => l.name === 'Marks')]);       // a layer switched off after the edit (321)
  const flatBefore = n.flatten;
  api.undo(d);
  assert.equal(n.flatten, flatBefore, 'the toggle does not change fl, so Undo reuses it');
  assert.deepEqual([...d.off].map((i) => d.fl.layers[i].name), ['Marks'], 'the layer is still off');
  sameState(d);
});

test('319c restore patches the counts: only the changed entities are counted again', () => {
  const { d, api, n } = setup(sheet());
  d.sel = new Set([1]); api.commit(d, Ed.removeEntities(d.raw, d.sel), 'Delete');
  sameState(d);
  d.sel = new Set([0]); api.commit(d, Ed.moveEntities(d.raw, d.sel, 3, 3), 'Move');
  sameState(d);
  api.undo(d); sameState(d);
  api.undo(d); sameState(d);
  api.redo(d); sameState(d);
  assert.deepEqual(n.from, [false, true, true, true, true], 'counted in full once (no counts before the first restore), patched after');
});

test('319c a layer that loses its last entity: the layer list changes, counted in full', () => {
  const { d, api, n } = setup(sheet());
  api.commit(d, Ed.removeEntities(d.raw, new Set([3])), 'Delete');       // the last entity on Marks that is not in a block: Marks stays through the block
  sameState(d);
  api.commit(d, Ed.removeEntities(d.raw, new Set([2])), 'Delete the INSERT');       // now no entity uses Marks: the layer leaves fl.layers
  sameState(d);
  assert.ok(!d.fl.layers.some((l) => l.name === 'Marks'));
  api.undo(d); sameState(d);
  assert.ok(d.fl.layers.some((l) => l.name === 'Marks'));
  api.redo(d); sameState(d);
  assert.equal(n.from.length, 4);
});

test('319c patchedCounts equals the full count for a delete, an insert and a move; falls back on other layer names or space', () => {
  const raw = sheet(), fl = flatten(raw);
  const prev = { entities: raw.entities, names: fl.layers.map((l) => l.name), space: DOC.spaceOf(fl), counts: DOC.layerCounts(raw, fl), n: DOC.entityCount(raw, fl) };
  const less = { ...raw, entities: raw.entities.filter((_, i) => i !== 1 && i !== 4) }, more = { ...raw, entities: [...raw.entities, W.line(0, 0, 1, 1, { layer: 'Marks' })] };
  const moved = { ...raw, entities: raw.entities.map((e, i) => (i === 3 ? { ...e, layer: '0' } : e)) };
  for (const next of [less, more, moved]) {
    const f = flatten(next), c = DOC.patchedCounts(prev, next, f);
    assert.deepEqual(c, { counts: DOC.layerCounts(next, f), n: DOC.entityCount(next, f) });
  }
  const other = { ...prev, names: [...prev.names].reverse() }, f = flatten(less);
  assert.deepEqual(DOC.patchedCounts(other, less, f), { counts: DOC.layerCounts(less, f), n: DOC.entityCount(less, f) });
  assert.deepEqual(DOC.patchedCounts(null, less, f), { counts: DOC.layerCounts(less, f), n: DOC.entityCount(less, f) });
});

// the pick index of one state, as plain data (the grid depends on the same order and the same numbers; the cells by key: a patched grid keeps its own Map order, TODO 322d)
const byKey = (cells) => [...cells].sort((a, b) => a[0] - b[0]);
const shape = (ed) => clean({ pieces: [...ed.ix.pieces], snaps: ed.ix.snaps, G: ed.ix.G, cell: ed.ix.cell, x0: ed.ix.x0, y0: ed.ix.y0, pc: byKey(ed.ix.pc), sc: byKey(ed.ix.sc), wide: ed.ix.wide,
  vis: [...ed.vis], byEnt: ed.byEnt, shown: ed.shown, box: [...ed.box], ends: [...ed.ends] });

for (const [label, make] of [['mixed with INSERTs', () => readDxf(W.writeDxf(bigDoc(700)))], ['splines', () => readDxf(W.writeDxf(splineDoc(60)))]]) {
  test(`319c the patched pick index equals a fresh one after Delete, Move, Undo and Redo (${label})`, () => {
    const raw = make(), fl0 = flatten(raw), ed0 = Ed.makeIndex(raw, fl0);
    const reused = (a, b) => a.ix.snaps.filter((s) => b.has(s)).length;
    const old = new Set(ed0.ix.snaps);
    // Delete two entities
    const del = { ...raw, ...Ed.removeEntities(raw, new Set([6, 41])) }, fl1 = flattenEdit(raw, del, fl0, new Set());
    const ed1 = Ed.makeIndex(del, fl1, new Set(), null, undefined, { ix: ed0.ix, fl: fl0 });
    assert.deepEqual(shape(ed1), shape(Ed.makeIndex(del, fl1)));
    assert.ok(reused(ed1, old) > ed1.ix.snaps.length * 0.9, 'most snaps are the old objects');
    // Undo: the stored fl0 and the old entities
    const ed2 = Ed.makeIndex(raw, fl0, new Set(), null, undefined, { ix: ed1.ix, fl: fl1 });
    assert.deepEqual(shape(ed2), shape(Ed.makeIndex(raw, fl0)));
    // Move three, from the undone state
    const mv = { ...raw, ...Ed.moveEntities(raw, new Set([7, 8, 100]), 25, -10) }, fl3 = flattenEdit(raw, mv, fl0, new Set());
    const ed3 = Ed.makeIndex(mv, fl3, new Set(), null, undefined, { ix: ed2.ix, fl: fl0 });
    assert.deepEqual(shape(ed3), shape(Ed.makeIndex(mv, fl3)));
    // Redo of the Delete: back to fl1 from fl3's index
    const ed4 = Ed.makeIndex(del, fl1, new Set(), null, undefined, { ix: ed3.ix, fl: fl3 });
    assert.deepEqual(shape(ed4), shape(Ed.makeIndex(del, fl1)));
  });
}

test('319c the pick index is built in full when prev is another kind of index or the geometry was rebuilt', () => {
  const raw = readDxf(W.writeDxf(bigDoc(120))), fl0 = flatten(raw), ed0 = Ed.makeIndex(raw, fl0);
  const again = flatten(raw), fresh = Ed.makeIndex(raw, again);
  const rebuilt = Ed.makeIndex(raw, again, new Set(), null, undefined, { ix: ed0.ix, fl: fl0 });       // a new flatten: new mats and ops, nothing to match
  assert.deepEqual(clean(rebuilt.ix.snaps), clean(fresh.ix.snaps));
  assert.equal(rebuilt.ix.snaps.filter((s) => ed0.ix.snaps.includes(s)).length, 0, 'no old snap object is reused');
  const frame = Ed.makeIndex(raw, fl0, new Set(), null, [0, 1, -1, 0, 0, 0], { ix: ed0.ix, fl: fl0 });       // another extreme frame: the extremes differ
  assert.deepEqual(clean(frame.ix.snaps), clean(Ed.makeIndex(raw, fl0, new Set(), null, [0, 1, -1, 0, 0, 0]).ix.snaps));
});
