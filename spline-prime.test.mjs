import { test } from 'node:test';
import assert from 'node:assert/strict';
import { primeSplines, flatten, clearSplineCache } from './web/drawing.js';
import { addBlock, insert } from './web/dxf-write.js';
import { splineDoc } from './tools/gen-big-dxf.mjs';

test('idle priming caches top-level and block SPLINE records; an edit builds a new cache entry', () => {
  const doc = splineDoc(2), blockSpline = structuredClone(doc.entities[1]);
  addBlock(doc, 'Curve', [blockSpline]);
  doc.entities.push(insert('Curve', 50, 50));
  const geometry = () => flatten(doc).items.map(it => it.ops);
  const before = geometry();
  clearSplineCache();
  const priming = primeSplines(doc);
  assert.equal(priming.next().done, false, 'priming yields after one record');
  assert.equal([...priming].length + 1, doc.entities.length + Object.values(doc.blocks).reduce((n, b) => n + b.entities.length, 0));
  for (const e of [doc.entities[0], blockSpline]) e.r.v[e.r.c.indexOf(10)] = '999';
  assert.deepEqual(geometry(), before, 'priming retained the original points for both record identities');
  for (const e of [doc.entities[0], blockSpline]) e.r = structuredClone(e.r);
  const edited = geometry();
  assert.notDeepEqual(edited, before, 'new record identities recompute after an edit');
  clearSplineCache();
  assert.deepEqual(geometry(), edited, 'warm and cold edited geometry agree');
});
