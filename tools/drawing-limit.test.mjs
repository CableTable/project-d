import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatten, readDxf } from '../web/drawing.js';
import { newDoc, addLayer, addEntities, insert, line, writeDxf } from '../web/dxf-write.js';
import { entityCount, layerCounts, startHidden } from '../web/doc.js';
import { buildTree } from '../web/objects.js';

test('a cut-off file keeps later layers, counts and Objects tree layer indexes', () => {
  const doc = newDoc(4);
  addLayer(doc, 'First', { aci: 7 });
  addLayer(doc, 'Later', { aci: 5, off: true });
  addLayer(doc, 'Empty', { aci: 3 });
  doc.blocks.Many = { base: [0, 0], entities: Array.from({ length: 41 }, (_, i) => line(i, 0, i, 1)) };
  addEntities(doc, insert('Many', 0, 0, { layer: 'First', rows: 100, cols: 100 }),
    line(0, 0, 1, 1, { layer: 'Later' }), line(1, 1, 2, 2, { layer: 'Later' }),
    line(2, 2, 3, 3, { layer: 'Undeclared' }));
  const raw = readDxf(writeDxf(doc, { extents: [0, 0, 40, 1] })), fl = flatten(raw);
  assert.equal(fl.truncated, true);
  assert.equal(fl.items.length, 400000);
  assert.ok(fl.items.every((it) => it.e === 0), 'the cut occurs inside the first INSERT');
  const counts = layerCounts(raw, fl), tree = buildTree(raw, fl);
  assert.equal(counts.reduce((a, b) => a + b, 0), entityCount(raw, fl));
  assert.equal(tree.objects, 4);
  assert.deepEqual(Object.fromEntries(fl.layers.map((l, i) => [l.name, counts[i]])), { First: 1, Later: 2, Undeclared: 1 });
  for (const l of tree.layers) {
    assert.ok(l.index >= 0, l.name + ' has a layer index');
    assert.equal(l.count, counts[l.index]);
  }
  const later = fl.layers.findIndex((l) => l.name === 'Later');
  assert.equal(fl.layers[later].css, '#0000ff');
  assert.ok(startHidden(fl).has(later), 'later layers retain their initial visibility');
  const switched = buildTree(raw, fl, { off: new Set([later]), locked: new Set(['Later']) });
  assert.equal(switched.hiddenN, 2);
  assert.equal(switched.lockedN, 2);
});
