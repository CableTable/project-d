import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { firstDone, peakContext } from './tools/rook-result.mjs';
import { watchCi, gitBash, mergeRefusal, merge } from './tools/rook.mjs';

const assistant = (usage) => ({ type: 'assistant', message: { usage } });

test('peak context takes the largest assistant input plus cache read and write, excluding output and totals', () => {
  assert.equal(peakContext([]), 0);
  assert.equal(peakContext([
    { type: 'system' }, { type: 'assistant' }, assistant({}),
    assistant({ input_tokens: 1000, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 40_000, output_tokens: 900_000 }),
    assistant({ input_tokens: 2000, cache_read_input_tokens: 50_000 }),
    { type: 'result', usage: { input_tokens: 999_999 } },
    { type: 'user', message: { usage: { input_tokens: 999_999 } } },
  ]), 161_000);
  assert.equal(peakContext([assistant({ input_tokens: 1234 })]), 1234);
  assert.equal(peakContext([assistant({ input_tokens: 10 }), { ...assistant({ input_tokens: 99_999 }), parent_tool_use_id: 'toolu_1' }]), 10, 'sub-agent turns are skipped');
});

test('wait: a .jsonl is done at its result line, a .txt when non-empty; unfinished, missing and half-written files are not; the first listed finished file wins', () => {
  const running = '{"type":"assistant"}\n{"type":"res', ended = '{"type":"assistant"}\n{"type":"result","result":"x"}\n';
  assert.equal(firstDone({ 'a.jsonl': running, 'b.txt': '', 'c.txt': null }), null);
  assert.equal(firstDone({ 'a.jsonl': running, 'b.txt': ' \n' }), null);
  assert.equal(firstDone({ 'a.jsonl': running, 'b.txt': 'Knight report\n', 'c.jsonl': ended }), 'b.txt');
  assert.equal(firstDone({ 'a.jsonl': ended + '\r\n' }), 'a.jsonl');
  assert.equal(firstDone({ 'a.jsonl': '{"type":"user","message":"the \\"type\\":\\"result\\" text"}\n' }), null);
  assert.equal(firstDone({}), null);
});

test('wait (CLI): exits 0 printing DONE <file> for a finished run; a bad --ci is a usage error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectd-wait-'));
  try {
    const report = join(dir, 'k.txt');
    writeFileSync(report, 'Knight report\n');
    assert.equal(execFileSync(process.execPath, ['tools/rook.mjs', 'wait', join(dir, 'missing.jsonl'), report], { encoding: 'utf8' }).trim(), `DONE ${report}`);
    assert.throws(() => execFileSync(process.execPath, ['tools/rook.mjs', 'wait', report, '--ci'], { encoding: 'utf8', stdio: 'pipe' }), (e) => e.status === 1 && /usage: node tools\/rook\.mjs wait/.test(e.stderr));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('wait --ci: spawns the watcher with piped stderr, forwards it, prints CI <RUN line> and exits 0; a failed watcher exits 1; bash is Git Bash when it exists', () => {
  const fake = () => { const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.kill = () => {}; return c; };
  const calls = [], codes = [], seen = [], out = [], err = [];
  const log = console.log, error = console.error, write = process.stderr.write;
  const child = fake();
  console.log = (s) => out.push(s); console.error = (s) => err.push(s); process.stderr.write = (d) => { seen.push(String(d)); return true; };
  try {
    watchCi('abc', (bin, args, opts) => { calls.push([bin, args, opts.stdio]); return child; }, (c) => codes.push(c), 'GIT-BASH');
    child.stderr.write('gh: boom\n');
    child.stdout.write('Build: failure\nRUN 77 fai');
    child.stdout.write('lure\n');
    child.emit('close', 0);
    const bad = fake();
    watchCi('def', () => bad, (c) => codes.push(c), 'bash');
    bad.emit('close', 3);
  } finally { console.log = log; console.error = error; process.stderr.write = write; }
  assert.deepEqual(calls[0].slice(0, 1), ['GIT-BASH']);
  assert.match(calls[0][1][0], /ci-watch\.sh$/);
  assert.deepEqual([calls[0][1][1], calls[0][2]], ['abc', ['ignore', 'pipe', 'pipe']]);
  assert.deepEqual(seen, ['gh: boom\n']);
  assert.deepEqual(out, ['CI RUN 77 failure']);
  assert.deepEqual(codes, [0, 1]);
  assert.deepEqual(err, ['ci-watch.sh ended with exit 3']);
  const gitExec = (path) => () => path;
  assert.equal(gitBash(gitExec('C:\\Git\\mingw64\\libexec\\git-core\n'), () => true), join('C:\\Git\\mingw64\\libexec\\git-core', '..', '..', '..', 'bin', 'bash.exe'));
  assert.equal(gitBash(gitExec('/x'), () => false), 'bash');
  assert.equal(gitBash(() => { throw new Error('no git'); }, () => true), 'bash');
});

test('merge: refuses without a non-empty retro file unless --no-retro, a non-head sha, or CI not success; otherwise merges', () => {
  const ok = { n: 33, pr: 5, sha: 'a'.repeat(40), head: 'a'.repeat(40), retro: 'retro text', noRetro: false, ci: 'success' };
  assert.equal(mergeRefusal(ok), '');
  assert.match(mergeRefusal({ ...ok, retro: null }), /^refused: runs33\/retro33\.out is missing or empty/);
  assert.match(mergeRefusal({ ...ok, retro: ' \r\n' }), /missing or empty/);
  assert.equal(mergeRefusal({ ...ok, retro: null, noRetro: true }), '');
  const other = mergeRefusal({ ...ok, head: 'b'.repeat(40) });
  assert.ok(other.includes(ok.sha) && other.includes('b'.repeat(40)) && other.includes('#5'), other);
  for (const ci of ['failure', 'in_progress', 'queued', undefined]) assert.match(mergeRefusal({ ...ok, ci }), /^refused: CI for a+ is (?:failure|in_progress|queued|not found), not success$/);

  const extras = mkdtempSync(join(tmpdir(), 'projectd-merge-'));
  try {
    const sha = 'c'.repeat(40), cmds = [];
    const gh = ({ head = sha, branch = 'claude/session33', ci = [{ status: 'completed', conclusion: 'success' }], state = 'MERGED' } = {}) => (cmd, a) => {
      cmds.push([cmd, ...a].join(' '));
      if (cmd === 'git') return sha;
      if (a[1] === 'view' && a[3] === '--json' && a[4] === 'headRefOid,headRefName') return JSON.stringify({ headRefOid: head, headRefName: branch });
      if (a[0] === 'run') return JSON.stringify(ci);
      if (a[1] === 'view') return JSON.stringify({ state });
      return '';
    };
    assert.throws(() => merge(['5', 'cc', '--no-retro', 'x'], gh(), extras), /usage/);
    assert.throws(() => merge(['5', 'cc'], gh(), extras), /retro33\.out is missing/);
    assert.ok(!cmds.some((c) => c.includes('pr merge')));
    mkdirSync(join(extras, 'runs33'));
    writeFileSync(join(extras, 'runs33', 'retro33.out'), '');
    assert.throws(() => merge(['5', 'cc'], gh(), extras), /missing or empty/);
    writeFileSync(join(extras, 'runs33', 'retro33.out'), 'Suggestions\n');
    assert.throws(() => merge(['5', 'cc'], gh({ head: 'd'.repeat(40) }), extras), /not the head/);
    assert.throws(() => merge(['5', 'cc'], gh({ ci: [{ status: 'completed', conclusion: 'failure' }] }), extras), /is failure/);
    assert.throws(() => merge(['5', 'cc'], gh({ ci: [] }), extras), /not found/);
    assert.throws(() => merge(['5', 'cc'], gh({ branch: 'king/167b' }), extras), /not claude\/session/);
    assert.ok(!cmds.some((c) => c.includes('pr merge')));
    assert.equal(merge(['5', 'cc'], gh(), extras), `MERGED #5 ${sha}`);
    assert.ok(cmds.includes(`gh pr merge 5 --merge --match-head-commit ${sha}`));
    assert.ok(!existsSync(join(extras, 'runs34')), 'no resume note when the retro exists');
    assert.throws(() => merge(['5', 'cc'], gh({ state: 'OPEN' }), extras), /not MERGED/);
    rmSync(join(extras, 'runs33'), { recursive: true });
    assert.equal(merge(['5', 'cc', '--no-retro'], gh(), extras), `MERGED #5 ${sha}`);
    merge(['5', 'cc', '--no-retro'], gh(), extras);
    assert.equal(readFileSync(join(extras, 'runs34', 'resume-rook.txt'), 'utf8'), 'retro33 due first (merged without it)\nretro33 due first (merged without it)\n');
  } finally { rmSync(extras, { recursive: true, force: true }); }
});

test('result skips a half-written last line: no result yet for an unfinished run, the result once it is there', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectd-result-'));
  try {
    const run = join(dir, 'run.jsonl'), line = (e) => JSON.stringify(e) + '\n';
    const result = { type: 'result', result: 'Done', usage: { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 }, permission_denials: [] };
    writeFileSync(run, line(assistant({ input_tokens: 5 })) + '{"type":"assis');
    assert.throws(() => execFileSync(process.execPath, ['tools/rook.mjs', 'result', run], { encoding: 'utf8', stdio: 'pipe' }), (e) => e.status === 1 && e.stdout.trim() === 'no result yet');
    writeFileSync(run, line(assistant({ input_tokens: 5 })) + line(result) + '{"type":"assis');
    assert.match(execFileSync(process.execPath, ['tools/rook.mjs', 'result', run], { encoding: 'utf8' }), /^Done/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('result prints peak context and warns strictly above 150k; Codex logs skip it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectd-result-'));
  try {
    const run = join(dir, 'run.jsonl');
    const result = { type: 'result', result: 'Done', usage: { input_tokens: 500_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 200_000, output_tokens: 3000 }, permission_denials: [] };
    const read = (file) => execFileSync(process.execPath, ['tools/rook.mjs', 'result', file], { encoding: 'utf8' });
    for (const peak of [149_999, 150_000, 150_001, 1_100_000]) {
      writeFileSync(run, [assistant({ input_tokens: peak - 50_000, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 10_000 }), result].map((e) => JSON.stringify(e)).join('\r\n') + '\r\n');
      const output = read(run);
      assert.match(output, /^Done\r?\ntokens 1\.70M \(703k new\) · denials 0/);
      assert.ok(output.includes(`peak context ${Math.round(peak / 1000)}k`));
      assert.equal(output.includes(' (over 150k: split the ticket)'), peak > 150_000);
    }
    const log = join(dir, 'run.log'), reply = join(dir, 'run.txt');
    writeFileSync(log, 'tokens used\n123,456\n');
    writeFileSync(reply, 'Codex done\n');
    assert.equal(read(reply).trim(), 'Codex done\ntokens 123,456');
    assert.ok(!read(log).includes('peak context'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
