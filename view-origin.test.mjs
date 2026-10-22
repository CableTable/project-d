import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewOrigin } from './web/view-origin.js';
import { mapply } from './web/drawing.js';

test('viewport origins keep translated, rotated, stretched and reflected paths local', () => {
  for (const m of [[1000, 0, 0, -1000, -10000123.456, 20000234.567], [0, 2000, 1000, 0, 12345678, -45678901], [2, 3, -4, 5, 100000, -200000]]) {
    const origin = viewOrigin(m), at = mapply(m, ...origin);
    at.forEach((n) => assert.ok(Math.abs(n) < 1e-7));
    const point = [origin[0] + .001, origin[1] - .002], expected = mapply(m, ...point);
    const local = mapply([...m.slice(0, 4), 0, 0], point[0] - origin[0], point[1] - origin[1]);
    local.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-7));
  }
  assert.deepEqual(viewOrigin([0, 0, 0, 0, 0, 0]), [0, 0]);
});
