import test from 'node:test';
import assert from 'node:assert/strict';
import { fitBase, zoomAt, panBy, paintView, FIT, MAX_ZOOM } from './web/pdf-view.js';

const base = fitBase(800, 600, 400, 200);
const screenOf = (v, px, py) => ({ x: v.ox + px * v.s, y: v.oy + py * v.s });   // a page point (mm, y down) on screen
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('fit centres the page with the pad', () => {
  near(base.k, 1.93); near(base.ox, 14); near(base.oy, 107);
  const v = paintView(base, FIT);
  assert.deepEqual(v, { s: base.k, ox: base.ox, oy: base.oy });
});

test('zoom at the cursor keeps the page point under the cursor', () => {
  let view = FIT;
  const cx = 300, cy = 250, before = paintView(base, view);
  const mm = [(cx - before.ox) / before.s, (cy - before.oy) / before.s];
  for (const f of [1.5, 2, 0.7, 3]) {
    view = zoomAt(view, cx, cy, f);
    const p = screenOf(paintView(base, view), ...mm);
    near(p.x, cx); near(p.y, cy);
  }
});

test('zoom is clamped to 1x..32x of fit', () => {
  assert.equal(zoomAt(FIT, 100, 100, 0.5).z, 1);
  assert.deepEqual(zoomAt(FIT, 100, 100, 0.5), FIT, 'zooming out at fit changes nothing');
  assert.deepEqual(zoomAt(zoomAt(FIT, 300, 250, 2), 100, 100, 0.25), FIT, 'back at 1x the page is fitted and centred');
  let v = FIT;
  for (let i = 0; i < 20; i++) v = zoomAt(v, 400, 300, 2);
  assert.equal(v.z, MAX_ZOOM);
  near(paintView(base, v).s, base.k * 32);
});

test('pan moves the page by the drag; Fit is the start view again', () => {
  const v = panBy(zoomAt(FIT, 50, 60, 4), 30, -20);
  near(paintView(base, v).ox - paintView(base, zoomAt(FIT, 50, 60, 4)).ox, 30);
  near(paintView(base, v).oy - paintView(base, zoomAt(FIT, 50, 60, 4)).oy, -20);
  assert.deepEqual(paintView(base, FIT), { s: base.k, ox: base.ox, oy: base.oy });
});
