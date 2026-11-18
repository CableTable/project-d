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
