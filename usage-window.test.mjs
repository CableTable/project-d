import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { activeBreaks, codexWindow, isTodayIst, resetLabel, stripChips, weeklyForecast, windowReading } from './usage-site/public/usage-window.js';

test('TODO 353b2: Done today is today\'s IST date; a blank or bad end time is not today', () => {
  const now = Date.parse('2026-11-21T20:00:00Z'); // 21 Nov 01:30 IST on the 22nd
  assert.equal(isTodayIst('2026-11-21T18:29:59Z', now), false); // 23:59 IST on the 21st
  assert.equal(isTodayIst('2026-11-21T18:30:00Z', now), true); // 00:00 IST on the 22nd
  assert.equal(isTodayIst('2026-11-22T18:29:59Z', now), true);
  assert.equal(isTodayIst('2026-11-22T18:30:00Z', now), false);
  for (const bad of ['', undefined, null, 'garbage']) assert.equal(isTodayIst(bad, now), false);
});

test('TODO 353c: strip items for breaks (plain line), for-him (purple chip) and CI; a missing doc or no CI shows nothing', () => {
  const now = Date.parse('2026-11-21T10:00:00Z'), min = (m) => new Date(now + m * 60000).toISOString();
  assert.deepEqual(stripChips({}, now), []);
  assert.deepEqual(stripChips(undefined, now), []);
  const breaks = { rows: [{ account: 'Bishop', from: min(-10), to: min(30) }, { account: 'King', from: min(5), to: min(90) }, { account: 'Rook', from: min(-90), to: min(-1) }, { account: 'Knight', from: 'x', to: 'y' }] };
  assert.deepEqual(stripChips({ breaks }, now), [{ cls: 'muted', text: 'Bishop on break', plain: true }]); // upcoming, ended and unreadable ones are left out
  assert.deepEqual(activeBreaks(breaks, now), [{ account: 'Bishop', to: Date.parse(min(30)) }]); // the account card reads the end time from here
  assert.deepEqual(stripChips({ breaks: { rows: [{ account: 'Bishop', from: min(0), to: min(0) }] } }, now).length, 1); // both ends count
  for (const rows of [5, [null], { a: 1 }]) assert.deepEqual(stripChips({ breaks: { rows } }, now), []); // a malformed breaks doc must not throw
  assert.deepEqual(stripChips({ forhim: { open: 3, ids: [15, 19, 28] } }, now), [{ cls: 'info', text: '3 for him' }]);
  assert.deepEqual(stripChips({ forhim: { open: 0, ids: [] } }, now), []);
  const ci = (patch) => stripChips({ ci: { sha: '1a2b3c4d5e6f', updated: min(-40), ...patch } }, now);
  assert.deepEqual(ci({ status: 'completed', conclusion: 'failure' }), [{ cls: 'bad', text: 'CI red 1a2b3c4' }]);
  assert.deepEqual(ci({ status: 'completed', conclusion: 'cancelled' }), [{ cls: 'muted', text: 'CI cancelled 1a2b3c4' }]);
  assert.deepEqual(ci({ status: 'in_progress', conclusion: '' }), [{ cls: 'warn', text: 'CI running · 40 min ago' }]);
  assert.deepEqual(ci({ status: 'queued', conclusion: '', updated: min(-150) }), [{ cls: 'warn', text: 'CI running · 2 h ago' }]);
  assert.deepEqual(ci({ status: 'in_progress', updated: undefined }), [{ cls: 'warn', text: 'CI running' }]);
  assert.deepEqual(ci({ status: 'completed', conclusion: 'success' }), [{ cls: 'ok', text: 'CI green' }]);
  assert.deepEqual(ci({ status: 'none' }), []);
  assert.deepEqual(ci({}), []);
  const all = stripChips({ breaks, forhim: { open: 1 }, ci: { status: 'completed', conclusion: 'failure', sha: 'abc' } }, now);
  assert.deepEqual(all.map((c) => c.cls), ['muted', 'info', 'bad']);
});
test('expired five-hour and weekly Codex readings show zero and Reset without guessing the next reset', () => {
  for (const reading of [[100, 10], [61, 15], [0, null], [100, 20]]) {
    const [used, resets] = codexWindow(reading, 20_000);
    assert.equal(used, 0);
    assert.equal(resetLabel(resets, () => assert.fail('unknown reset formatted')), 'Reset');
  }
  assert.deepEqual(codexWindow([61, 30], 20_000), [61, 30]);
  assert.equal(resetLabel(30, String), 'resets 30');
});

test('TODO 196a: a limited account\'s 5h row with a blank reset reads as no reset, not NaN (the card would throw)', () => {
  const row = { used_pct: '100', resets: '' };
  for (const agent of ['Rook', 'Pip', 'King', 'Rowan']) {
    const [used, resets] = windowReading(agent, row);
    assert.equal(resets, null);
    assert.equal(resetLabel(resets, () => assert.fail('formatted a blank reset')), 'Reset');
  }
  assert.deepEqual(windowReading('Pip', { used_pct: '61', resets: '1970-01-01T00:00:30Z' }), [61, 30]);
});

test('Knight forecasts once the new window has 3 h of data and some use', () => {
  const starts = '2026-10-23T00:00:00Z', resets = '2026-10-30T00:00:00Z', as_of = '2026-10-23T03:00:00Z';
  const now = Date.parse(as_of), row = { agent: 'Rowan', starts, resets, as_of, used_pct: '3' };
  assert.deepEqual(weeklyForecast(row, now), { agent: 'Rowan', at_reset_pct: 168, hit_at: '2026-10-27T04:00:00.000Z' });
  assert.equal(weeklyForecast({ ...row, used_pct: '0' }, now).at_reset_pct, null);
  assert.equal(weeklyForecast({ ...row, as_of: '2026-10-23T00:10:00Z', used_pct: '1' }, now).at_reset_pct, null);      // 1% ten minutes after the reset is not a pace
  assert.equal(weeklyForecast({ ...row, as_of: '2026-10-23T02:59:00Z' }, now).at_reset_pct, null);
  assert.equal(weeklyForecast({ ...row, agent: 'Knight' }, now).at_reset_pct, 168);
  assert.equal(weeklyForecast({ ...row, as_of: '2026-10-23T06:00:00Z' }, now).at_reset_pct, 84);
  for (const patch of [{ starts: '' }, { resets: '' }, { as_of: '' }, { as_of: starts }, { as_of: '2026-10-22T23:00:00Z' }, { used_pct: '' }, { used_pct: 'bad' }]) {
    assert.equal(weeklyForecast({ ...row, ...patch }, now).at_reset_pct, null);
  }
  assert.equal(weeklyForecast(row, Date.parse(resets)).at_reset_pct, null);
  assert.equal(weeklyForecast({ ...row, agent: 'Rook' }, now).at_reset_pct, null);
  assert.equal(weeklyForecast({ ...row, agent: 'Pip' }, now).at_reset_pct, null);
  assert.equal(weeklyForecast({ ...row, agent: 'King' }, now).at_reset_pct, null); // Claude accounts wait 12 h, like Rook and Bishop
  assert.equal(weeklyForecast({ ...row, agent: 'King', as_of: '2026-10-23T12:00:00Z' }, Date.parse('2026-10-23T12:00:00Z')).at_reset_pct, 42);
});

test('TODO 353c: Hosting sends no-cache for the page, its html, css and js, so a deploy is seen at once (a stale css next to a new js broke the page)', () => {
  const { headers } = JSON.parse(readFileSync(new URL('./usage-site/firebase.json', import.meta.url), 'utf8')).hosting;
  for (const source of ['/', '**/*.html', '**/*.css', '**/*.js']) assert.deepEqual(headers.find((h) => h.source === source)?.headers, [{ key: 'Cache-Control', value: 'no-cache' }], source);
});
