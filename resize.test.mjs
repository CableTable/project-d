import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resizeAbout } from './web/edit.js';
import { newDoc, addEntities, lwpoly, circle, arc, line, entity, insert, writeDxf } from './web/dxf-write.js';
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

test('SPLINE control / fit points and tangent vectors resize independently about the anchor', () => {
  const raw = newDoc(4);
  raw.entities = [entity('SPLINE', [[70, 0], [71, 2], [72, 6], [73, 3],
    ...[0, 0, 0, 1, 1, 1].map((v) => [40, v]),
    [10, 5], [20, 7], [10, 15], [20, 27], [10, 25], [20, 7],
    [11, 5], [21, 7], [11, 25], [21, 7], [12, 2], [22, 4], [13, 6], [23, -8]])];
  const before = structuredClone(raw);
  const next = resizeAbout(raw, 2, .5, 5, 7);
  const values = (code) => next.entities[0].r.v.filter((_, i) => next.entities[0].r.c[i] === code).map(Number);
  assert.deepEqual(values(10), [5, 25, 45]); assert.deepEqual(values(20), [7, 17, 7]);
  assert.deepEqual(values(11), [5, 45]); assert.deepEqual(values(21), [7, 7]);
  for (const [code, expected] of [[12, 4], [22, 2], [13, 12], [23, -4]]) assert.deepEqual(values(code), [expected]);
  assert.deepEqual(flatten(readDxf(writeDxf({ ...raw, ...next }))).boxes.model, [5, 7, 45, 12]);
  assert.deepEqual(raw, before);
});

test('flipped OCS LWPOLYLINE and POLYLINE resize in drawing coordinates and round trip', () => {
  const poly = entity('POLYLINE', [[66, 1], [70, 1], [210, 0], [220, 0], [230, -1]]);
  poly.kids = [[-5, 7], [-25, 7], [-25, 27], [-5, 27]].map(([x, y]) => entity('VERTEX', [[10, x], [20, y]]).r);
  const lw = lwpoly([[-5, 7], [-25, 7], [-25, 27], [-5, 27]], { closed: true });
  lw.r.c.push(210, 220, 230); lw.r.v.push('0', '0', '-1');
  for (const e of [lw, poly]) {
    const doc = newDoc(4); doc.entities = [e];
    const raw = readDxf(writeDxf(doc)), before = structuredClone(raw);
    assert.equal(raw.entities[0].flip, true);
    const next = resizeAbout(raw, 2, .5, 5, 7);
    assert.deepEqual(flatten({ ...raw, ...next }).boxes.model, [5, 7, 45, 17]);
    assert.deepEqual(flatten(readDxf(writeDxf({ ...raw, ...next }))).boxes.model, [5, 7, 45, 17]);
    assert.deepEqual(raw, before);
  }
});

test('INSERT refuses independent axes atomically; locked proportions resize its placement and block', () => {
  const raw = newDoc(4);
  raw.blocks.Part = { name: 'Part', base: [0, 0, 0], entities: [lwpoly([[0, 0], [20, 0], [20, 20], [0, 20]], { closed: true })] };
  raw.entities = [insert('Part', 5, 7)];
  const before = structuredClone(raw);
  assert.throws(() => resizeAbout(raw, 2, .5, 5, 7), /Cannot resize INSERT.*proportions unlocked/);
  assert.deepEqual(raw, before);
  const next = resizeAbout(raw, 2, 2, 5, 7);
  assert.deepEqual(flatten({ ...raw, ...next }).boxes.model, [5, 7, 45, 47]);
  assert.deepEqual(raw, before);
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
