import assert from 'node:assert/strict';
import test from 'node:test';
import { breakApart } from './web/breakapart.js';
import { newDoc, addLayer, addBlock, addEntities, roundRect, circle, line, text, insert, writeDxf } from './web/dxf-write.js';
import { get } from './web/grips.js';
import { resolve } from './web/cmdbar.js';

function fixture() {
  const raw = newDoc();
  addLayer(raw, 'Cut', { aci: 3 }); addLayer(raw, 'Holes', { aci: 2 });
  addBlock(raw, 'Plate', [roundRect(0, 0, 40, 20, 3), circle(10, 10, 2, { layer: 'Holes' })]);
  addEntities(raw, line(0, 0, 5, 0), insert('Plate', 100, 80, { layer: 'Cut', rot: 90, sx: 2, sy: 2 }), line(0, 5, 5, 5));
  return raw;
}

test('Break Apart retains whole outlines, placement, layers, draw order and selects every result without mutating the source', () => {
  const raw = fixture(), before = writeDxf(raw), r = breakApart(raw, new Set([1]));
  assert.deepEqual(r.entities.map((e) => e.type), ['LINE', 'LWPOLYLINE', 'CIRCLE', 'LINE']);
  assert.deepEqual([...r.selected], [1, 2]);
  assert.equal(r.entities[0], raw.entities[0]); assert.equal(r.entities[3], raw.entities[2]);
  assert.equal(r.entities[1].layer, 'Cut'); assert.equal(r.entities[2].layer, 'Holes');
  assert.equal(get(r.entities[1].r, 70) & 1, 1, 'rounded rectangle remains closed');
  assert.ok(Math.abs(get(r.entities[2].r, 10) - 80) < 1e-9);
  assert.ok(Math.abs(get(r.entities[2].r, 20) - 100) < 1e-9);
  assert.equal(get(r.entities[2].r, 40), 4);
  assert.equal(writeDxf(raw), before);
  assert.equal(resolve('BREAKAPART').key, 'Ctrl+K');
  assert.equal(resolve('BREAKAPART', 'layout').name, 'breakapart');
});

test('unsupported selections and locked layers explain why and do not change anything', () => {
  const raw = fixture(), before = writeDxf(raw);
  for (const selection of [new Set(), new Set([0, 1]), new Set([0])]) assert.ok(breakApart(raw, selection).error);
  for (const layer of ['Cut', 'Holes']) assert.match(breakApart(raw, new Set([1]), new Set([layer])).error, /locked layer/);
  assert.equal(writeDxf(raw), before);
  for (const member of [text('Keep me', 0, 0, 2), insert('Plate', 0, 0)]) {
    const mixed = fixture(); mixed.blocks.Plate.entities.push(member);
    const original = writeDxf(mixed);
    assert.match(breakApart(mixed, new Set([1])).error, /only outlines/);
    assert.equal(writeDxf(mixed), original);
  }
  raw.blocks.Plate.xref = true;
  assert.match(breakApart(raw, new Set([1])).error, /external reference/);
  delete raw.blocks.Plate;
  assert.match(breakApart(raw, new Set([1])).error, /missing block/);
});

test('empty blocks, attributes and unsafe transforms stay intact', () => {
  const raw = fixture();
  raw.blocks.Plate.entities = [];
  assert.match(breakApart(raw, new Set([1])).error, /only outlines/);
  const attr = fixture(); attr.entities[1].kids = [text('Attribute', 0, 0, 2).r];
  assert.match(breakApart(attr, new Set([1])).error, /only outlines/);
  const invalid = fixture(); invalid.entities[1] = insert('Plate', 100, 80, { sx: 0 });
  assert.match(breakApart(invalid, new Set([1])).error, /invalid block scale/);
});
