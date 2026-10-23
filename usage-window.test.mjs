import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codexWindow, resetLabel, weeklyForecast } from './usage-site/public/usage-window.js';
test('expired five-hour and weekly Codex readings show zero and Reset without guessing the next reset', () => {
  for (const reading of [[100, 10], [61, 15], [0, null], [100, 20]]) {
    const [used, resets] = codexWindow(reading, 20_000);
    assert.equal(used, 0);
    assert.equal(resetLabel(resets, () => assert.fail('unknown reset formatted')), 'Reset');
  }
  assert.deepEqual(codexWindow([61, 30], 20_000), [61, 30]);
  assert.equal(resetLabel(30, String), 'Resets 30');
});

test('Knight forecasts as soon as the new window has data, including a zero reading', () => {
  const starts = '2026-10-23T00:00:00Z', resets = '2026-10-30T00:00:00Z', as_of = '2026-10-23T01:00:00Z';
  const now = Date.parse(as_of), row = { agent: 'Rowan', starts, resets, as_of, used_pct: '1' };
  assert.deepEqual(weeklyForecast(row, now), { agent: 'Rowan', at_reset_pct: 168, hit_at: '2026-10-27T04:00:00.000Z' });
  assert.equal(weeklyForecast({ ...row, used_pct: '0' }, now).at_reset_pct, 0);
  assert.equal(weeklyForecast({ ...row, agent: 'Knight' }, now).at_reset_pct, 168);
  assert.equal(weeklyForecast({ ...row, as_of: '2026-10-23T02:00:00Z' }, now).at_reset_pct, 84);
  for (const patch of [{ starts: '' }, { resets: '' }, { as_of: '' }, { as_of: starts }, { as_of: '2026-10-22T23:00:00Z' }, { used_pct: '' }, { used_pct: 'bad' }]) {
    assert.equal(weeklyForecast({ ...row, ...patch }, now).at_reset_pct, null);
  }
  assert.equal(weeklyForecast(row, Date.parse(resets)).at_reset_pct, null);
  assert.equal(weeklyForecast({ ...row, agent: 'Rook' }, now).at_reset_pct, null);
  assert.equal(weeklyForecast({ ...row, agent: 'Pip' }, now).at_reset_pct, null);
});
