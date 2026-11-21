import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyTokens } from './usage-site/public/token-chart.js';

const at = (s) => Date.parse(s);

test('daily totals: IST days ending on the newest row, empty days are 0, rows outside the window are left out', () => {
  const H = 3600e3, midnight = at('2026-10-20T18:30:00Z'); // Oct 21 00:00 IST
  const rows = [{ t: midnight - H, Rook: 5, Bishop: 1 }, { t: midnight, Rook: 10, Bishop: 2 }, { t: midnight + 23 * H, Rook: 1 }, { t: midnight + 24 * H, Rook: 4, Bishop: 'x' }];
  const days = dailyTokens(rows, ['Rook', 'Bishop', 'King'], 3);
  assert.deepEqual(days.map((d) => d.t), [midnight - 24 * H, midnight, midnight + 24 * H]);
  assert.deepEqual(days.map((d) => [d.Rook, d.Bishop, d.King]), [[5, 1, 0], [11, 2, 0], [4, 0, 0]]);
  assert.equal(dailyTokens(rows, ['Rook'], 1).length, 1);
  assert.deepEqual(dailyTokens(rows, ['Rook'], 1)[0], { t: midnight + 24 * H, Rook: 4 });
  assert.deepEqual(dailyTokens([], ['Rook']), []);
});
