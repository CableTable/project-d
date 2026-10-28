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
});

test('tickets skip and locally log a malformed row while keeping valid rows and notes', () => {
  const logs = [];
  const result = parseTickets(`| T1 | open | S | bug | ui | First | 95 | today |
| T2 | open |
| T3 | open | S | bug | | Third | 98 | today |
### T3 Third
Still uploaded.`, (message) => logs.push(message));
  assert.deepEqual(result.rows.map((row) => row.id), ['T1', 'T3']);
  assert.equal(result.rows[1].note, 'Still uploaded.');
  assert.deepEqual(logs, ['Skipping malformed ticket T2: expected eight columns, got 2']);
});

test('tickets redact Windows paths in fields and notes before upload', () => {
  const result = parseTickets(String.raw`| T1 | open | S | bug | | Fix C:\Users\owner\secret.txt | 95 | today |
### T1 Note
See [E:\private\drawing.dxf] and (D:/private/log.txt), then continue.
Lowercase c:\secret\file, and F:/private/other.txt
Keep https://example.test/help and relative/file.txt.`);
  assert.equal(result.rows[0].title, 'Fix (local path)');
  assert.equal(result.rows[0].note, 'See [(local path)] and ((local path)), then continue.\nLowercase (local path), and (local path)\nKeep https://example.test/help and relative/file.txt.');
});

test('ticket paths keep spaces private and preserve the text after each delimiter', () => {
  for (const [text, expected] of [
    [String.raw`E:\Project B\Claude\ProjectD\x.dxf`, '(local path)'],
    [String.raw`[e:/Project B/Claude/ProjectD/x.dxf] next`, '[(local path)] next'],
    [String.raw`(E:\Project B\x.dxf) next`, '((local path)) next'],
    [String.raw`"E:\Project B\x.dxf" next`, '"(local path)" next'],
    [String.raw`'E:/Project B/x.dxf' next`, "'(local path)' next"],
    ['`E:/Project B/x.dxf` next', '`(local path)` next'],
    [String.raw`E:\Project B\x.dxf, then continue`, '(local path), then continue'],
    [String.raw`E:\Project B, Claude\x.dxf, then continue`, '(local path), then continue'],
    [String.raw`\\server\shared drawings\Project D\x.dxf, then continue`, '(local path), then continue'],
    [String.raw`[\server\share\Project D\x.dxf] next`, '[(local path)] next'],
    [String.raw`E:\Project B\x.dxf` + '\nKeep this line.', '(local path)\nKeep this line.'],
  ]) {
    const result = parseTickets(`| T1 | open | S | bug | | ${text.split('\n')[0]} | 95 | today |\n### T1 Note\n${text}`);
    assert.equal(result.rows[0].title, expected.split('\n')[0], text);
    assert.equal(result.rows[0].note, expected, text);
  }
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
    record('King', claudeEvent('2026-10-21T18:30:00Z', 'msg', usage)),
    record('King', claudeEvent('2026-10-21T18:30:00Z', 'msg', { ...usage, output_tokens: 6 })), // the later, larger count wins
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
  // Hourly rows from IST midnight on Oct 9 (2026-10-08T18:30Z) to the hour holding 'now' (01:30 IST on Oct 22).
  const start = Date.parse('2026-10-08T18:30:00Z');
  assert.equal(result.rows.length, 13 * 24 + 2);
  assert.deepEqual(result.rows.map((row) => row.t), result.rows.map((_, i) => start + i * 3600e3));
  assert.deepEqual(result.rows.at(-3), { t: Date.parse('2026-10-21T17:30:00Z'), Rook: 38, Bishop: 0, King: 0, Knight: 30 });
  assert.deepEqual(result.rows.at(-2), { t: Date.parse('2026-10-21T18:30:00Z'), Rook: 35, Bishop: 35, King: 36, Knight: 49 });
  assert.deepEqual(result.rows.at(-1), { t: Date.parse('2026-10-21T19:30:00Z'), Rook: 0, Bishop: 0, King: 0, Knight: 0 });
  assert.deepEqual(result.rows[0], { t: start, Rook: 0, Bishop: 0, King: 0, Knight: 0 });
});

test('collector uses all four transcript roots, skips stale files and tolerates partial JSONL/missing roots', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'projectd-tokens-'));
  try {
    assert.equal((await collectTokens(folder, now)).rows.length, 13 * 24 + 2);
    for (const [directory, agent] of [['.claude/projects/a', 'Rook'], ['.claude-account2/projects/b', 'Bishop'], ['.claude-account3/projects/c', 'King'], ['.codex/sessions/2026/10', 'Knight']]) {
      const root = join(folder, directory); mkdirSync(root, { recursive: true });
      const event = agent === 'Knight' ? codexEvent('2026-10-21T19:00:00Z', { input_tokens: 20, cached_input_tokens: 5, output_tokens: 2 })
        : claudeEvent('2026-10-21T19:00:00Z', agent, { input_tokens: 10, output_tokens: 2 });
      for (const name of ['recent.jsonl', 'stale.jsonl']) {
        const path = join(root, name); writeFileSync(path, JSON.stringify(event) + '\n{"partial":');
        const time = new Date(now - (name === 'stale.jsonl' ? 16 * 864e5 : 0)); utimesSync(path, time, time);
      }
    }
    assert.deepEqual((await collectTokens(folder, now)).rows.at(-2), { t: Date.parse('2026-10-21T18:30:00Z'), Rook: 12, Bishop: 12, King: 12, Knight: 17 });
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('resumed Claude transcripts count copied messages once across files in each account', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'projectd-resumed-'));
  try {
    for (const directory of ['.claude/projects/a', '.claude-account2/projects/b', '.claude-account3/projects/c']) {
      const root = join(folder, directory); mkdirSync(root, { recursive: true });
      const old = claudeEvent('2026-10-21T19:00:00Z', 'old', { input_tokens: 10, output_tokens: 2 });
      const fresh = claudeEvent('2026-10-21T19:10:00Z', 'fresh', { input_tokens: 20, output_tokens: 3 });
      for (const [name, events] of [['original', [old]], ['resumed', [old, fresh]]]) {
        const path = join(root, name + '.jsonl');
        writeFileSync(path, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
        utimesSync(path, new Date(now), new Date(now));
      }
    }
    assert.deepEqual((await collectTokens(folder, now)).rows.at(-2), { t: Date.parse('2026-10-21T18:30:00Z'), Rook: 35, Bishop: 35, King: 35, Knight: 0 });
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
  assert.throws(() => claudeUsage('C:\\bin\\claude3.cmd', () => { throw failure; }, () => {}), /King usage probe failed, exit 1/);
  const limited = Object.assign(new Error('exit 1'), { status: 1, stdout: "You've hit your limit · resets tomorrow" });
  assert.throws(() => claudeUsage('C:\\bin\\claude3.cmd', () => { throw limited; }, () => {}), /^Error: Third account: 100%, limit reached$/);
  assert.equal(refreshFailure({ stderr: 'USAGE_ERROR: Third account: 100%, limit reached\n' }), 'Third account: 100%, limit reached');
  assert.equal(refreshFailure({ stderr: 'USAGE_ERROR: King usage probe failed, exit 1\n' }), 'King usage probe failed, exit 1');
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

test('TODO finds indented sub-steps and their done ticks without changing items that only mention progress', () => {
  const { sections } = parseTodo(`## First
66. **Modify tools** (L): Parent detail.
    66a. ✅ Move objects.
        Keep layer locks.
    66b. Copy objects; ✅ here is not a done tick.
    66c. Rotate objects.
67. **Guides** (M): (a built, b next)
## Next
66. ✅ **Finished parent** (S)
    66a. ✅ Finished sub-step.
76. **Dimensions** (L)
    76a. First dimension.
    76b. ✅ Second dimension.
`);
  const [modify, guides] = sections[0].items;
  assert.equal(modify.text, '(L): Parent detail.');
  assert.deepEqual(modify.substeps, [
    { num: '66a', done: true, text: 'Move objects. Keep layer locks.' },
    { num: '66b', done: false, text: 'Copy objects; ✅ here is not a done tick.' },
    { num: '66c', done: false, text: 'Rotate objects.' },
  ]);
  assert.equal(modify.substeps.filter((step) => step.done).length, 1);
  assert.deepEqual(guides, { num: 67, title: 'Guides', size: 'M', done: false, text: '(M): (a built, b next)' });
  assert.deepEqual(sections[1].items[0].substeps, [{ num: '66a', done: true, text: 'Finished sub-step.' }]);
  assert.deepEqual(sections[1].items[1].substeps.map((step) => [step.num, step.done]), [['76a', false], ['76b', true]]);
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
