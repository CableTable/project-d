import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTodo, parseCsv, parseTickets, tallyTokens, collectTokens, refreshFailure, firestoreValue, assertKeyOutsideRepo } from './tools/usage-agent.mjs';
import { claudeUsage } from './tools/rook.mjs';

test('tickets keep the eight columns, comma tags, escaped pipes and full note text as plain data', () => {
  const text = `# Tickets
| # | Status | Size | Type | Tags | Title | TODO | Updated |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | merged (PR #9) | S | bug | bug, ui, bug | <img src=x> \\| title | 98 | 2026-10-21 |
| T2 | open | M | ask | | Another | | |
## Notes
### T1 First title
First line.

<script>plain text</script>
#### Detail
More detail.
### T2 Another
Second note.
## Not a note
Unrelated.`;
  assert.deepEqual(parseTickets('\uFEFF' + text.replace(/\n/g, '\r\n')), { rows: [
    { id: 'T1', status: 'merged (PR #9)', size: 'S', type: 'bug', tags: ['bug', 'ui'], title: '<img src=x> | title', todo: '98', updated: '2026-10-21', note: 'First line.\n\n<script>plain text</script>\n#### Detail\nMore detail.' },
    { id: 'T2', status: 'open', size: 'M', type: 'ask', tags: [], title: 'Another', todo: '', updated: '', note: 'Second note.' },
  ] });
  assert.deepEqual(parseTickets(''), { rows: [] });
  assert.throws(() => parseTickets('| T1 | open |'), /eight columns/);
});

const now = Date.parse('2026-10-21T20:00:00Z'); // Oct 22 in IST.
const claudeEvent = (timestamp, id, usage, requestId = 'req') => ({ type: 'assistant', timestamp, requestId, message: { id, usage } });
const codexEvent = (timestamp, total, last) => ({ timestamp, payload: { type: 'token_count', info: { ...(total ? { total_token_usage: total } : {}), ...(last ? { last_token_usage: last } : {}) } } });

test('14-day IST tally dedupes Claude blocks and Codex totals, excludes cache reads and reasoning double counts', async () => {
  const record = (agent, event, session = 'one') => ({ agent, session, event });
  const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 20, cache_read_input_tokens: 900 };
  const first = { input_tokens: 100, cached_input_tokens: 70, output_tokens: 10, reasoning_output_tokens: 5, cache_write_input_tokens: 2 };
  const next = { input_tokens: 150, cached_input_tokens: 100, output_tokens: 20, cache_write_input_tokens: 2 };
  const result = await tallyTokens([
    record('Rook', claudeEvent('2026-10-21T18:29:59Z', 'msg', usage)),
    record('Rook', claudeEvent('2026-10-21T18:29:59Z', 'msg', { ...usage, output_tokens: 8 })),
    record('Rook', claudeEvent('2026-10-21T18:29:59Z', 'msg', usage)),
    record('Bishop', claudeEvent('2026-10-21T18:30:00Z', 'msg', usage)),
    record('Rook', claudeEvent('2026-10-21T18:30:00Z', 'msg', usage, 'other-request')),
    record('Rook', claudeEvent('2026-10-08T18:29:59Z', 'too-old', usage)),
    record('Rook', claudeEvent('2026-10-23T00:00:00Z', 'future', usage)),
    record('Knight', codexEvent('2026-10-08T18:29:59Z', first, first)), // Outside range, still establishes the baseline.
    record('Knight', codexEvent('2026-10-21T18:29:59Z', next, first)),
    record('Knight', codexEvent('2026-10-21T18:30:00Z', next, first)), // Rate-limit-only repeat, same totals.
    record('Knight', codexEvent('2026-10-21T18:30:00Z', first, first), 'two'),
    record('Knight', codexEvent('2026-10-21T18:31:00Z', first, first), 'two'),
    record('Knight', codexEvent('2026-10-21T18:32:00Z', { input_tokens: 5, output_tokens: 2 }), 'two'), // Counter reset.
  ], now);
  assert.equal(result.rows.length, 14);
  assert.equal(result.rows[0].day, '2026-10-09');
  assert.deepEqual(result.rows.at(-2), { day: '2026-10-21', Rook: 38, Bishop: 0, Knight: 30 });
  assert.deepEqual(result.rows.at(-1), { day: '2026-10-22', Rook: 35, Bishop: 35, Knight: 49 });
  assert.deepEqual(result.rows[0], { day: '2026-10-09', Rook: 0, Bishop: 0, Knight: 0 });
});

test('collector uses all three transcript roots, skips stale files and tolerates partial JSONL/missing roots', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'projectd-tokens-'));
  try {
    assert.equal((await collectTokens(folder, now)).rows.length, 14);
    for (const [directory, agent] of [['.claude/projects/a', 'Rook'], ['.claude-account2/projects/b', 'Bishop'], ['.codex/sessions/2026/10', 'Knight']]) {
      const root = join(folder, directory); mkdirSync(root, { recursive: true });
      const event = agent === 'Knight' ? codexEvent('2026-10-21T19:00:00Z', { input_tokens: 20, cached_input_tokens: 5, output_tokens: 2 })
        : claudeEvent('2026-10-21T19:00:00Z', agent, { input_tokens: 10, output_tokens: 2 });
      for (const name of ['recent.jsonl', 'stale.jsonl']) {
        const path = join(root, name); writeFileSync(path, JSON.stringify(event) + '\n{"partial":');
        const time = new Date(now - (name === 'stale.jsonl' ? 16 * 864e5 : 0)); utimesSync(path, time, time);
      }
    }
    assert.deepEqual((await collectTokens(folder, now)).rows.at(-1), { day: '2026-10-22', Rook: 12, Bishop: 12, Knight: 17 });
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('Rook retries once, keeps full diagnostics local, and exports only fixed summaries', () => {
  const logs = [], failure = Object.assign(new Error('private hook JSON and stack'), { status: 1, stdout: 'hook_started secret' });
  const success = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: .25, resetsAt: 123 }, seven_day: { utilization: .5, resetsAt: 456 } } } });
  let calls = 0;
  assert.deepEqual(claudeUsage('claude', () => { if (++calls === 1) throw failure; return success; }, (s) => logs.push(s)), { h5: [25, 123], wk: [50, 456] });
  assert.equal(calls, 2); assert.match(logs[0], /hook_started secret/);
  calls = 0;
  assert.throws(() => claudeUsage('claude', () => { calls++; throw failure; }, () => {}), /^Error: Rook usage probe failed, exit 1$/);
  assert.equal(calls, 2);
  assert.throws(() => claudeUsage('claude2', () => { throw failure; }, () => {}), /Bishop usage probe failed, exit 1/);
  const limited = Object.assign(new Error('exit 1'), { status: 1, stdout: "You've hit your limit · resets tomorrow" });
  assert.throws(() => claudeUsage('claude', () => { throw limited; }, () => {}), /^Error: Main account: 100%, limit reached$/);
  assert.equal(refreshFailure({ stderr: 'stack\nUSAGE_ERROR: Rook usage probe failed, exit 1\nhook JSON' }), 'Rook usage probe failed, exit 1');
  assert.equal(refreshFailure({ stderr: 'USAGE_ERROR: Main account: 100%, limit reached\n' }), 'Main account: 100%, limit reached');
  assert.equal(refreshFailure({ message: 'secret stack', stderr: 'USAGE_ERROR: private hook JSON' }), 'Usage refresh failed; see the local agent log');
});

test('TODO keeps every section, continuation text and section-local numbers, with done winning duplicates', () => {
  const sample = `# Made-up TODO
Intro.
## First
1. **Open <thing>** (S–M): More detail.
   Continued detail.
2. **Old task** (M): Still open here.

More ideas:
3. Plain task. Extra detail.
2. ✅ (built today) **Finished task** (bug, S): Shipped.
2. **Stale copy** (L)
4. **Large task** (his ask, L): Later.
5. Small task (S): A plain title.
## Next
1. **Another task** (M): Different number scope.
2. ✅ Plain finished. Kept too.
## Empty
## Last
1. No tag.
`;
  assert.deepEqual(parseTodo('\uFEFF' + sample.replace(/\n/g, '\r\n')), { sections: [
    { title: 'First', items: [
      { num: 1, title: 'Open <thing>', size: 'S–M', done: false, text: '(S–M): More detail. Continued detail.' },
      { num: 3, title: 'Plain task.', size: '', done: false, text: 'Extra detail.' },
      { num: 2, title: 'Finished task', size: 'S', done: true, text: '(built today) (bug, S): Shipped.' },
      { num: 4, title: 'Large task', size: 'L', done: false, text: '(his ask, L): Later.' },
      { num: 5, title: 'Small task', size: 'S', done: false, text: '(S): A plain title.' },
    ] },
    { title: 'Next', items: [
      { num: 1, title: 'Another task', size: 'M', done: false, text: '(M): Different number scope.' },
      { num: 2, title: 'Plain finished.', size: '', done: true, text: 'Kept too.' },
    ] },
    { title: 'Empty', items: [] },
    { title: 'Last', items: [{ num: 1, title: 'No tag.', size: '', done: false, text: '' }] },
  ] });
  assert.deepEqual(parseTodo(''), { sections: [] });
});

test('CSV preserves empty cells, CRLF, BOM, quoted commas, escaped quotes and newlines', () => {
  assert.deepEqual(parseCsv('\uFEFFid,task,new_tokens\r\n1,"Fix, then ""test""\nagain",\r\n\r\n2,Done,0'), [
    { id: '1', task: 'Fix, then "test"\nagain', new_tokens: '' },
    { id: '2', task: 'Done', new_tokens: '0' },
  ]);
  assert.deepEqual(parseCsv('a,b\nx,'), [{ a: 'x', b: '' }]);
  assert.deepEqual(parseCsv('a\n""'), [{ a: '' }]);
  assert.deepEqual(parseCsv('a,b\n'), []);
  assert.deepEqual(parseCsv(''), []);
  for (const csv of ['a,b\n1', 'a,b\n1,2,3', 'a\n"unfinished', 'a\n"x"no', 'a\nno"', 'a,a\n1,2', ',b\n1,2']) {
    assert.throws(() => parseCsv(csv), /CSV|quote/);
  }
});

test('Firestore REST Value encoding keeps typed data and empty arrays/maps', () => {
  assert.deepEqual(firestoreValue({ rows: [{ n: 0, fraction: 1.25, empty: '', yes: true, no: false, nil: null }] }), {
    mapValue: { fields: { rows: { arrayValue: { values: [{ mapValue: { fields: {
      n: { integerValue: '0' }, fraction: { doubleValue: 1.25 }, empty: { stringValue: '' },
      yes: { booleanValue: true }, no: { booleanValue: false }, nil: { nullValue: null },
    } } }] } } } },
  });
  assert.deepEqual(firestoreValue([]), { arrayValue: { values: [] } });
  assert.deepEqual(firestoreValue({}), { mapValue: { fields: {} } });
  assert.deepEqual(firestoreValue(new Date('2026-10-20T12:00:00Z')), { timestampValue: '2026-10-20T12:00:00.000Z' });
  assert.deepEqual(firestoreValue(-123), { integerValue: '-123' });
  for (const value of [undefined, NaN, Infinity, new Date('invalid'), () => {}, [[1]]]) assert.throws(() => firestoreValue(value));
});

test('key guard refuses repo keys and permits a sibling outside the repo', () => {
  const folder = mkdtempSync(join(tmpdir(), 'projectd-agent-'));
  try {
    const repo = join(folder, 'repo'), sibling = join(folder, 'repo-other');
    mkdirSync(repo); mkdirSync(sibling);
    const inside = join(repo, 'firebase-key.json'), outside = join(sibling, 'firebase-key.json');
    writeFileSync(inside, '{}'); writeFileSync(outside, '{}');
    assert.throws(() => assertKeyOutsideRepo(inside, repo), /Refusing to start.*inside the repo/);
    assert.throws(() => assertKeyOutsideRepo(join(repo, 'missing-key.json'), repo), /Refusing to start.*inside the repo/);
    assert.doesNotThrow(() => assertKeyOutsideRepo(outside, repo));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
