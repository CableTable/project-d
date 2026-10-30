import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as L from './web/compare-list.js';
import * as C from './web/compare.js';
import { flatten, readDxf } from './web/drawing.js';
import { newDoc, addEntities, addLayer, writeDxf, rect, circle, line } from './web/dxf-write.js';

function source(name, entities, factor = 1) {
  const doc = newDoc(4); addEntities(doc, entities);
  const raw = readDxf(writeDxf(doc));
  return { name, raw, fl: flatten(raw), factor, off: new Set() };
}
const plate = (name, w = 30, x = 0) => source(name, [rect(x, 0, w, 20), circle(x + 10, 10, 2)]);

test('linked snapshots keep tab identity; coordinates undo offset and inch factor; refresh can empty the artwork', () => {
  const original = { ...plate('same.dxf'), tabId: 'tab-2' }, item = L.addItem([], original)[0];
  assert.equal(item.tabId, 'tab-2');
  assert.equal(L.addItem([], { ...original, tabId: 'tab-1' })[0].tabId, 'tab-1');
  assert.equal(L.addItem([], { ...plate('part'), part: true })[0].part, true);
  const placed = { ...item, factor: 25.4, offset: [-254, 50.8] };
  assert.deepEqual(L.drawingPoint(placed, [0, 101.6]), [10, 2]);
  assert.deepEqual(L.comparePoint(placed, [10, 2]), [0, 101.6]);
  const empty = { ...item, ...L.snapshotGeometry(source('same.dxf', [])) };
  assert.equal(empty.tabId, 'tab-2');
  assert.equal(empty.box, null);
  assert.deepEqual(empty.polys, []);
  assert.equal(empty.metrics.perimeter, 0);
  assert.doesNotThrow(() => L.lineUpItems([empty, item], 'bl'));
  assert.ok(L.compareItems([empty, { ...item, id: 2 }], .1).diffs.length);
});

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

test('hiding a layer in one snapshot recomputes its outlines and leaves the source and the other snapshots alone', () => {
  const doc = newDoc(4); addLayer(doc, 'Holes'); addEntities(doc, [rect(0, 0, 30, 20, { layer: '0' }), circle(10, 10, 2, { layer: 'Holes' })]);
  const raw = readDxf(writeDxf(doc)), src = { name: 'p', raw, fl: flatten(raw), factor: 1, off: new Set() };
  const [a, b] = L.addItem(L.addItem([], src), src).slice(0, 2);
  const holes = a.fl.layers.findIndex((l) => l.name === 'Holes');
  const hidden = L.setItemOff(a, new Set([holes]));
  assert.ok(hidden.off.has(holes) && hidden.polys.length < a.polys.length, 'the circle is gone from the outlines');
  assert.ok(hidden.metrics.perimeter < a.metrics.perimeter);
  assert.equal(hidden.id, a.id);
  assert.equal(src.off.size, 0, 'the source keeps its own list');
  assert.equal(b.off.size, 0, 'the other snapshot keeps its own list');
  assert.deepEqual(L.setItemOff(hidden, new Set()).polys, a.polys, 'showing it again brings the outline back');
});

test('a refreshed snapshot keeps its hidden layers by name when the layer numbers shift', () => {
  const make = (...pairs) => {
    const doc = newDoc(4); pairs.forEach(([name]) => addLayer(doc, name));
    addEntities(doc, pairs.flatMap(([name, x]) => rect(x, 0, 10, 10, { layer: name })));
    const raw = readDxf(writeDxf(doc));
    return { name: 'p', raw, fl: flatten(raw), factor: 1, off: new Set() };
  };
  const [item] = L.addItem([], make(['A', 0], ['B', 20]));
  const hidden = L.setItemOff(item, new Set([item.fl.layers.findIndex((l) => l.name === 'B')]));
  const refreshed = { ...hidden, ...L.refreshGeometry(hidden, make(['B', 20], ['C', 40])) };      // A emptied: B is now number 0, the new C number 1
  assert.deepEqual([...refreshed.off].map((i) => refreshed.fl.layers[i].name), ['B'], 'B stays hidden, C is shown');
  assert.equal(refreshed.polys.length, 1, 'only C is drawn');
  for (const [why, pairs] of [['renamed', [['A', 0], ['Renamed B', 20]]], ['removed', [['A', 0], ['C', 40]]]]) {
    const source = make(...pairs), before = structuredClone(source);
    const next = { ...hidden, ...L.refreshGeometry(hidden, source) };
    assert.equal(next.off.size, 0, `a ${why} hidden layer does not hide the layer reusing its number`);
    assert.equal(next.polys.length, 2, why + ': both current layers are visible');
    assert.deepEqual(source, before, 'refresh leaves the source unchanged');
    assert.deepEqual([...hidden.off], [...item.fl.layers.keys()].filter((i) => item.fl.layers[i].name === 'B'), 'the old snapshot keeps its own hidden list');
  }
});
