import test from 'node:test';
import assert from 'node:assert/strict';
import { resetTimes, cumulativeTokens } from './usage-site/public/token-chart.js';

const at = (s) => Date.parse(s);
const now = at('2026-10-21T20:00:00Z'), from = at('2026-10-08T18:30:00Z');

test('reset times: resetsAt stepped back 7 days across the window, plus a sharp drop in the stored readings', () => {
  const limits = [{ agent: 'Rook', window: 'week', resets: '2026-10-24T05:00:00Z' }, { agent: 'Rowan', window: 'week', resets: '2026-10-27T12:00:00Z' }, { agent: 'Rowan', window: '5h', resets: '2026-10-22T00:00:00Z' }];
  assert.deepEqual(resetTimes('Rook', limits, [], from, now), [at('2026-10-10T05:00:00Z'), at('2026-10-17T05:00:00Z')]);
  const reading = (when, used_pct, agent = 'Rowan') => ({ when, agent, window: 'week', used_pct: String(used_pct) });
  const history = [reading('2026-10-20T08:00:00Z', 60), reading('2026-10-20T09:00:00Z', 2), reading('2026-10-19T09:00:00Z', 55), reading('2026-10-20T10:00:00Z', 5), reading('2026-10-20T11:00:00Z', 4, 'Rook')];
  // Knight (stored as Rowan): scheduled Oct 13 and Oct 20 12:00, plus the manual reset seen at the 09:00 reading; a 5-point wobble is not a reset.
  assert.deepEqual(resetTimes('Knight', limits, history, from, now), [at('2026-10-13T12:00:00Z'), at('2026-10-20T09:00:00Z')]);
  // A drop read within 6 h of a scheduled reset is the same reset.
  assert.deepEqual(resetTimes('Rook', limits, [reading('2026-10-17T05:40:00Z', 90, 'Rook'), reading('2026-10-17T06:40:00Z', 1, 'Rook')], from, now), [at('2026-10-10T05:00:00Z'), at('2026-10-17T05:00:00Z')]);
  assert.deepEqual(resetTimes('Bishop', [], [], from, now), []);
  assert.deepEqual(resetTimes('Rook', [{ agent: 'Rook', window: 'week', resets: 'garbage' }], [], from, now), []);
});

test('hourly running total restarts at 0 in the bucket holding each reset', () => {
  const t0 = at('2026-10-10T00:00:00Z'), H = 3600e3;
  const rows = [10, 5, 7, 0, 3, 4].map((Rook, i) => ({ t: t0 + i * H, Rook, Bishop: 1 }));
  assert.deepEqual(cumulativeTokens(rows, 'Rook'), [10, 15, 22, 22, 25, 29]);
  // A reset at 02:30 falls in the 02:00 bucket: that bucket's tokens count toward the new week.
  assert.deepEqual(cumulativeTokens(rows, 'Rook', [t0 + 2.5 * H]), [10, 15, 7, 7, 10, 14]);
  assert.deepEqual(cumulativeTokens(rows, 'Rook', [t0 - H, t0 + 4 * H, t0 + 10 * H]), [10, 15, 22, 22, 3, 7]);
  assert.deepEqual(cumulativeTokens(rows, 'Bishop', [t0 + 3 * H]), [1, 2, 3, 1, 2, 3]);
  assert.deepEqual(cumulativeTokens(rows, 'Knight'), [0, 0, 0, 0, 0, 0]);
});
