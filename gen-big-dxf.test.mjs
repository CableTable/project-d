import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splineDoc } from './tools/gen-big-dxf.mjs';
import { readDxf, flatten } from './web/drawing.js';
import { writeDxf } from './web/dxf-write.js';

test('P6 spline fixture: real cubic records survive DXF round-trip at the requested size', () => {
  const doc = readDxf(writeDxf(splineDoc()));
  assert.equal(doc.entities.length, 910);
  assert.equal(doc.entities.filter((e) => e.type === 'LWPOLYLINE').length, 10);
  assert.equal(Object.keys(doc.blocks).filter((n) => !n.startsWith('*')).length, 3);
  assert.deepEqual(Object.keys(doc.layers).sort(), ['0', 'Profiles']);
  for (const e of doc.entities.filter((e) => e.type === 'SPLINE')) {
    const field = (c) => +e.r.v[e.r.c.indexOf(c)];
    assert.equal(field(70) & 1, 1);
    assert.equal(field(71), 3);
    assert.equal(field(72), 42);
    assert.equal(field(73), 38);
    assert.equal(e.r.c.filter((c) => c === 10).length, 38);
    assert.equal(e.r.c.filter((c) => c === 40).length, 42);
  }
  const fl = flatten(doc);
  assert.equal(fl.items.filter((it) => it.spl).length, 900);
  for (const it of fl.items.filter((it) => it.spl)) {
    assert.equal(it.ops.length, 458 * 3 + 1, '456 sampled chords plus a closing line, rather than the control polygon');
    assert.ok(Math.hypot(it.ops[1] - it.ops.at(-3), it.ops[2] - it.ops.at(-2)) < 1e-5, 'periodic ends meet');
  }
  assert.equal(splineDoc(2).entities.length, 12);
  for (const n of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => splineDoc(n), RangeError);
});
