import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyTokens, niceStep } from './usage-site/public/token-chart.js';

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

test('TODO 353c: axis step is the smallest 1 / 2 / 3 / 5 x 10^k that holds the max in 3 steps; empty data gives 1', () => {
  assert.deepEqual([0, 1, 3, 4, 6, 9, 9e6, 8.2e6, 24480, 1e7 + 1].map(niceStep), [1, 1, 1, 2, 2, 3, 3e6, 3e6, 10000, 5e6]);
  for (const max of [0, 7, 123, 5e5, 3.3e7]) assert.ok(niceStep(max) * 3 >= max, 'the axis holds the biggest bar');
});
