import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as L from './web/compare-list.js';
import * as C from './web/compare.js';
import { flatten, readDxf } from './web/drawing.js';
import { newDoc, addEntities, writeDxf, rect, circle, line } from './web/dxf-write.js';

function source(name, entities, factor = 1) {
  const doc = newDoc(4); addEntities(doc, entities);
  const raw = readDxf(writeDxf(doc));
  return { name, raw, fl: flatten(raw), factor, off: new Set() };
}
const plate = (name, w = 30, x = 0) => source(name, [rect(x, 0, w, 20), circle(x + 10, 10, 2)]);

test('snapshots own their geometry and visibility; five distinct colours, limit and reuse after removal', () => {
  const original = plate('<b>part</b>');
  let items = L.addItem([], original);
  const before = structuredClone(items[0]);
  original.fl.items[0].ops[1] = 999; original.off.add(0); original.raw.entities.length = 0;
  assert.deepEqual(items[0], before);
  for (let i = 1; i < 5; i++) items = L.addItem(items, plate('part ' + i));
  assert.equal(new Set(items.map((x) => x.colour)).size, 5);
  assert.throws(() => L.addItem(items, plate('six')), /at most 5/);
  const removed = items[1]; items = L.removeItem(items, removed.id);
  items = L.addItem(items, plate('replacement'));
  assert.equal(items.at(-1).colour, removed.colour);
  assert.equal(new Set(items.map((x) => x.id)).size, 5);
  assert.throws(() => L.addItem([], source('empty', [])), /no outlines/);
});

test('first checked is reference; hiding still compares, unticking leaves it out, inputs are unchanged', () => {
  let items = L.addItem(L.addItem(L.addItem([], plate('a')), plate('b', 32, 100)), plate('c', 34, 200));
  items = L.lineUpItems(items, 'bl');
  assert.deepEqual(items.map((x) => x.offset), [[0, 0], [-100, 0], [-200, 0]]);
  const before = structuredClone(items), result = L.compareItems(items, .1);
  assert.deepEqual(items, before);
  assert.deepEqual(result.rows.map((x) => [x.area, x.perimeter, x.w, x.h].map((v) => +v.toFixed(6))), [[0, 0, 0, 0], [40, 4, 2, 0], [80, 8, 4, 0]]);
  assert.ok(result.diffs.some((x) => x.itemId === items[1].id));
  assert.ok(result.diffs.some((x) => x.itemId === items[2].id));
  items = L.setItem(items, items[1].id, { visible: false });
  assert.deepEqual(L.compareItems(items, .1), result);
  items = L.setItem(items, items[0].id, { checked: false });
  assert.equal(L.reference(items).name, 'b');
  items = L.lineUpItems(items, 'centre');
  assert.deepEqual(items[1].offset, [0, 0]);
  assert.deepEqual(items[2].offset, [-101, 0]);
  assert.deepEqual(L.compareItems(items, .1).rows.map((x) => [x.id, +x.area.toFixed(6)]), [[items[1].id, 0], [items[2].id, 40]]);
  items = L.setItem(items, items[1].id, { checked: false });
  assert.equal(L.compareItems(items, .1), null);
  items = L.setItem(items, items[2].id, { checked: false });
  assert.equal(L.reference(items), undefined);
  assert.equal(L.compareItems(items, .1), null);
});

test('two checked items use exactly the existing differences, including manual offsets and tolerance', () => {
  let items = L.addItem(L.addItem([], plate('a')), plate('b', 31, 50));
  for (const mode of ['bl', 'centre', 'manual']) {
    items = L.lineUpItems(items, mode);
    if (mode === 'manual') items = L.setItem(items, items[1].id, { offset: [-49, 2] });
    assert.equal(L.lineUpItems(items, 'manual'), items, 'manual retains every item offset');
    for (const tol of [.1, 1, 5]) {
      const old = C.compare(items[0].polys, items[1].polys, tol, { offsetB: items[1].offset });
      const result = L.compareItems(items, tol);
      assert.deepEqual(result.diffs.map(({ itemId, ...d }) => d), old.diffs);
      assert.equal(result.truncated, old.truncated);
    }
  }
  items = L.setItem(items, items[0].id, { offset: [10, -20] });
  const result = L.compareItems(items, .1), old = C.compare(items[0].polys, items[1].polys, .1, { offsetB: [-59, 22] });
  assert.deepEqual(result.diffs[0].box, old.diffs[0].box.map((v, i) => v + [10, -20][i % 2]));
});

test('measurements reuse closed loops with holes, joined lines, open lengths and drawing units', () => {
  const entities = [line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 10), line(0, 10, 0, 0), rect(2, 2, 2, 2), line(20, 0, 25, 0)];
  const item = L.addItem([], source('inch plate', entities, 25.4))[0];
  assert.ok(Math.abs(item.metrics.area - 96 * 25.4 ** 2) < 1e-6);
  assert.ok(Math.abs(item.metrics.perimeter - 53 * 25.4) < 1e-6);
  assert.equal(item.metrics.w, 635);
  assert.equal(item.metrics.h, 254);
});
