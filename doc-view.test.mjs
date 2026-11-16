import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreView } from './web/doc-view.js';

test('TODO 304: a never-viewed tab requests Fit', () => {
  assert.deepEqual(restoreView(undefined, { w: 800, h: 600 }), { fitted: true });
});

test('TODO 304: restoring at the same canvas size is exact and leaves the snapshot alone', () => {
  const saved = { scale: 3.7, ox: -21.5, oy: 40.3, fitted: false, w: 1024, h: 768 };
  assert.deepEqual(restoreView(Object.freeze(saved), saved), { scale: 3.7, ox: -21.5, oy: 40.3, fitted: false });
});

test('TODO 304: hidden resize keeps scale and drawing centre for larger and smaller canvases', () => {
  const saved = { scale: 2, ox: -10, oy: 25, fitted: false, w: 1000, h: 700 };
  for (const size of [{ w: 800, h: 500 }, { w: 1400, h: 900 }]) {
    const v = restoreView(saved, size);
    assert.equal(v.scale, saved.scale);
    assert.equal(v.fitted, false);
    assert.equal(v.ox + size.w / (2 * v.scale), saved.ox + saved.w / (2 * saved.scale));
    assert.equal(v.oy + size.h / (2 * v.scale), saved.oy + saved.h / (2 * saved.scale));
  }
  assert.equal(restoreView({ ...saved, fitted: true }, { w: 800, h: 500 }).fitted, true, 'a fitted tab still requests a refit');
});
