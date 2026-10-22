import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resizeAbout } from './web/edit.js';
import { newDoc, addEntities, lwpoly, circle, arc, line, writeDxf } from './web/dxf-write.js';
import { flatten, readDxf } from './web/drawing.js';
test('non-uniform selection resizing preserves its bottom-left, other objects, source, and DXF round trip', () => {
  const raw = newDoc(4);
  addEntities(raw, [lwpoly([[5, 7], [25, 7], [25, 27], [5, 27]], {closed: true}), line([100, 100], [110, 110])]);
  const before = JSON.stringify(raw), selection = new Set([0]);
  const next = resizeAbout(raw, 26.5 / 20, 10 / 20, 5, 7, 0, selection);
  assert.deepEqual(flatten({...raw, ...next, entities: [next.entities[0]]}).boxes.model, [5, 7, 31.5, 17]);
  assert.deepEqual(flatten(readDxf(writeDxf({...raw, ...next, entities: [next.entities[0]]}))).boxes.model, [5, 7, 31.5, 17]);
  assert.equal(next.entities[1], raw.entities[1]);
  assert.equal(JSON.stringify(raw), before);
  const uniform = resizeAbout(raw, 2, 2, 5, 7, 0, selection);
  assert.deepEqual(flatten({...raw, ...uniform, entities: [uniform.entities[0]]}).boxes.model, [5, 7, 45, 47]);
});
test('unsafe non-uniform edits are refused atomically, including circles, arcs and bulged polylines', () => {
  for (const curve of [circle([5, 5], 2), arc([5, 5], 2, 0, 90), lwpoly([[0, 0, 1], [10, 0]], false)]) {
    const raw = newDoc(4); addEntities(raw, [line([0, 0], [10, 10]), curve]);
    const before = JSON.stringify(raw);
    assert.throws(() => resizeAbout(raw, 2, 1, 0, 0), /proportions unlocked/);
    assert.equal(JSON.stringify(raw), before);
    assert.doesNotThrow(() => resizeAbout(raw, 2, 2, 0, 0));
  }
});
