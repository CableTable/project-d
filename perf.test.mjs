import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outsideView, subPixel, snapPlace, snapUsable, heavy } from './web/perf.js';
import { bigDoc } from './tools/gen-big-dxf.mjs';
import { writeDxf } from './web/dxf-write.js';
import { readDxf, flatten } from './web/drawing.js';

test('outsideView is conservative: a box touching or overlapping the view, or reaching it through its pad, is kept', () => {
  const vr = [0, 0, 100, 100];
  assert.equal(outsideView([10, 10, 20, 20], 0, vr), false);
  assert.equal(outsideView([100, 100, 110, 110], 0, vr), false);      // touching a corner
  assert.equal(outsideView([-50, -50, 150, 150], 0, vr), false);      // bigger than the view
  assert.equal(outsideView([101, 10, 110, 20], 0, vr), true);
  assert.equal(outsideView([101, 10, 110, 20], 1.5, vr), false);      // a fat stroke reaches in
  assert.equal(outsideView([10, -20, 20, -1], 0, vr), true);
});

test('subPixel only for boxes under half a pixel in both directions', () => {
  assert.equal(subPixel([0, 0, 1, 1], 0, 0.3), true);
  assert.equal(subPixel([0, 0, 10, 0.1], 0, 0.3), false);             // a long thin line stays
  assert.equal(subPixel([0, 0, 1, 1], 0.1, 0.3), true);
  assert.equal(subPixel([0, 0, 1, 1], 5, 0.3), false);
});

test('snapPlace: the same view is the identity; a pan shifts; a zoom about a point keeps that point', () => {
  const a = { ox: 10, oy: 20, scale: 2 };
  assert.deepEqual(snapPlace(a, a), { dx: 0, dy: 0, r: 1 });
  assert.deepEqual(snapPlace(a, { ox: 15, oy: 20, scale: 2 }), { dx: -10, dy: 0, r: 1 });
  // zoom x2 about canvas point (100, 50): the sheet point under it must not move on screen
  const mx = a.ox + 100 / a.scale, my = a.oy + 50 / a.scale, b = { scale: 4 };
  b.ox = mx - 100 / b.scale; b.oy = my - 50 / b.scale;
  const p = snapPlace(a, b);
  assert.equal(100 * p.r + p.dx, 100); assert.equal(50 * p.r + p.dy, 50);
});

test('snapUsable needs the same canvas size and a modest zoom change', () => {
  const s = { view: { ox: 0, oy: 0, scale: 1 }, w: 100, h: 80 };
  assert.equal(snapUsable(s, { view: { ox: 5, oy: 0, scale: 2 }, w: 100, h: 80 }), true);
  assert.equal(snapUsable(s, { view: { ox: 0, oy: 0, scale: 1 }, w: 101, h: 80 }), false);
  assert.equal(snapUsable(s, { view: { ox: 0, oy: 0, scale: 30 }, w: 100, h: 80 }), false);
  assert.equal(snapUsable(null, s), false);
});

test('heavy: slow script or many items; a small quick drawing always repaints in full', () => {
  assert.equal(heavy(3, 200), false);
  assert.equal(heavy(40, 200), true);
  assert.equal(heavy(3, 20000), true);
});

test('the generator makes the asked number of mixed entities and the file reads back', () => {
  const doc = bigDoc(600);
  assert.equal(doc.entities.length, 600);
  assert.deepEqual([...new Set(doc.entities.map((e) => e.type))].sort(), ['ARC', 'CIRCLE', 'INSERT', 'LINE', 'LWPOLYLINE', 'TEXT']);
  const fl = flatten(readDxf(writeDxf(doc)));
  assert.ok(fl.items.length >= 600);
});
