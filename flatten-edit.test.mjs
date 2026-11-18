import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flatten, flattenEdit, readDxf } from './web/drawing.js';
import { addBlock, addEntities, addLayer, circle, insert, line, newDoc, writeDxf } from './web/dxf-write.js';
import { moveEntities, removeEntities } from './web/edit.js';

function drawing() {
  const raw = newDoc(4);
  addLayer(raw, 'Marks', { aci: 3 });
  addBlock(raw, 'Mark', [circle(0, 0, 2, { layer: 'Marks' }), line(0, 0, 0, 2)]);
  addEntities(raw, line(1, 1, 4, 3), line(7, 4, 10, 8), insert('Mark', 14, 14), line(20, 1, 22, 3, { layer: 'Marks' }));
  return readDxf(writeDxf(raw));
}

test('319a Delete patches order, shifted entity indexes and INSERT ranges', () => {
  const raw = drawing(), fl = flatten(raw), hidden = new Set();
  const next = { ...raw, ...removeEntities(raw, new Set([1])) };
  const patched = flattenEdit(raw, next, fl, hidden);
  assert.deepEqual(patched, flatten(next, hidden));
  assert.equal(patched.items[0], fl.items[0], 'keep the unchanged first item');
  assert.equal(patched.items[1].ops, fl.items[2].ops, 'reuse the shifted block geometry');
});

test('319a Move patches only the changed geometry, including the drawing bounds', () => {
  const raw = drawing(), fl = flatten(raw), hidden = new Set();
  const next = { ...raw, ...moveEntities(raw, new Set([1]), -12, 20) };
  const patched = flattenEdit(raw, next, fl, hidden);
  assert.deepEqual(patched, flatten(next, hidden));
  assert.equal(patched.items[2], fl.items[2], 'keep the unchanged block item');
  assert.notDeepEqual(patched.items[1].b, fl.items[1].b);
});

test('319a a changed layer table falls back to the full flatten', () => {
  const raw = drawing(), fl = flatten(raw), hidden = new Set();
  const next = { ...raw, ...moveEntities(raw, new Set([1]), -12, 20), layers: { ...raw.layers, Marks: { ...raw.layers.Marks, aci: 1 } } };
  const drawn = flattenEdit(raw, next, fl, hidden);
  assert.deepEqual(drawn, flatten(next, hidden));
  assert.notEqual(drawn.items[0], fl.items[0], 'rebuild even the unchanged first item');
});

// 319c: the fallbacks of patchEntities (rv-319a gap): each one gives a drawing equal to a fresh flatten, built again (no item kept)
function fallsBack(raw, next) {
  const fl = flatten(raw), drawn = flattenEdit(raw, next, fl, new Set());
  assert.deepEqual(drawn, flatten(next, new Set()));
  assert.ok(drawn.items.every((it) => !fl.items.includes(it)), 'every item is drawn again');
}

test('319c hole-fill: deleting a closed outline while another entity is filled draws everything again', () => {
  const raw = readDxf(writeDxf(Object.assign(newDoc(4), { entities: [circle(0, 0, 9), circle(0, 0, 3), line(20, 0, 30, 0)] })));
  raw.entities[0] = { ...raw.entities[0], fill: 'aci:1' };
  fallsBack(raw, { ...raw, ...removeEntities(raw, new Set([1])) });
});

test('319c block definition changed: draws everything again', () => {
  const raw = drawing(), mark = raw.blocks.Mark;
  fallsBack(raw, { ...raw, blocks: { ...raw.blocks, Mark: { ...mark, entities: mark.entities.slice(1) } } });
});

test('319c the last plain entity on a layer: the layer list could change, so draw everything again', () => {
  const raw = drawing();
  fallsBack(raw, { ...raw, ...removeEntities(raw, new Set([3])) });
});

test('319c a changed linetype table draws everything again', () => {
  const raw = drawing();
  fallsBack(raw, { ...raw, ...moveEntities(raw, new Set([1]), 5, 5), ltypes: { ...raw.ltypes } });
});

test('319c a stale hidden set (d.hid) is no patch: hidden entities draw everything again', () => {
  const raw = drawing(), fl = flatten(raw), hidden = new Set([raw.entities[0]]), next = { ...raw, ...removeEntities(raw, new Set([1])) };
  const drawn = flattenEdit(raw, next, fl, hidden);
  assert.deepEqual(drawn, flatten(next, hidden));
  assert.ok(drawn.items.every((it) => !fl.items.includes(it)));
});
