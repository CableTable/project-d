import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { firstDone, peakContext } from './tools/rook-result.mjs';
import { printRookContext, EXTRAS } from './tools/rook-launch.mjs';
import { watchCi, nextRook, startArgs, startWatched, gitBash, mergeRefusal, merge, mergeDue, failLines, handover, handoverArgsError } from './tools/rook.mjs';

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
  assert.equal(firstDone({ 'a.jsonl': running, 'r.jsonl': 'NO REVIEW: no commit on the branch\n' }), 'r.jsonl'); // TODO 167d
  assert.equal(firstDone({ 's.log': 'npm output\nok 5 - SUITE unit=0 is text, not the end\n' }), null); // TODO 167e: a suite log is done at its SUITE last line
  assert.equal(firstDone({ 's.log': 'SUITE unit=0 browser=\n' + 'more output\n' }), null);
  assert.equal(firstDone({ 'a.jsonl': running, 's.log': 'tests\r\nSUITE unit=0 browser=1\r\n' }), 's.log');
  assert.equal(firstDone({ 's.log': 'SUITE unit=0 browser=0\n(node:1) [DEP0190] DeprecationWarning: x\n(Use `node --trace-deprecation ...`)\n' }), 's.log'); // warning lines after the SUITE line
  assert.equal(firstDone({ 's.log': 'tests\n(node:1) warning\n' }), null);
  assert.equal(firstDone({ 's.log': 'SUITE unit=1 browser=skipped\n' }), 's.log'); // TODO 193a: a red unit run skips the browser run
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
  assert.deepEqual(out, ['CI RUN 77 failure', 'CI RUN none ci-watch.sh exit 3']);
  assert.deepEqual(codes, [0, 1]);
  assert.deepEqual(err, ['ci-watch.sh ended with exit 3']);
  const gitExec = (path) => () => path;
  assert.equal(gitBash(gitExec('C:\\Git\\mingw64\\libexec\\git-core\n'), () => true), join('C:\\Git\\mingw64\\libexec\\git-core', '..', '..', '..', 'bin', 'bash.exe'));
  assert.equal(gitBash(gitExec('/x'), () => false), 'bash');
  assert.equal(gitBash(() => { throw new Error('no git'); }, () => true), 'bash');
});

test('TODO 190a: wait --ci prints exactly one CI RUN line on every path (run, no run found, unknown sha, exit code, clean end, spawn error)', () => {
  const paths = [
    ['RUN line', (c) => { c.stdout.write('RUN 5 success\n'); c.emit('close', 0); }, 'CI RUN 5 success', 0],
    ['RUN line without newline at close', (c) => { c.stdout.write('RUN 6 failure'); c.emit('close', 0); }, 'CI RUN 6 failure', 0],
    ['no run after 15 min', (c) => { c.stdout.write('no CI run found for abc after 15 min\n'); c.emit('close', 0); }, 'CI RUN none no CI run found for abc after 15 min', 1],
    ['unknown sha', (c) => { c.stdout.write('unknown sha abc\n'); c.emit('close', 2); }, 'CI RUN none unknown sha abc', 1],
    ['usage exit', (c) => c.emit('close', 2), 'CI RUN none ci-watch.sh exit 2', 1],
    ['clean end, no RUN', (c) => c.emit('close', 0), 'CI RUN none ci-watch.sh ended without a RUN line', 1],
    ['spawn error', (c) => { c.emit('error', new Error('ENOENT bash')); c.emit('close', null); }, 'CI RUN none watcher not started: ENOENT bash', 1],
  ];
  const log = console.log, error = console.error;
  try {
    for (const [name, drive, line, code] of paths) {
      const c = new EventEmitter(), out = [], codes = [];
      c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.kill = () => {};
      console.log = (s) => out.push(s); console.error = () => {};
      watchCi('abc', () => c, (x) => codes.push(x), 'bash');
      drive(c);
      assert.deepEqual([out, codes], [[line], [code]], name);
    }
  } finally { console.log = log; console.error = error; }
});

test('TODO 190a fix: wait with run files prints CI RUN none and keeps waiting (no exit); --ci alone exits 1; a RUN line still exits 0', () => {
  const log = console.log, error = console.error;
  try {
    for (const [keep, line, expectCodes] of [[true, 'no CI run found for abc after 15 min', []], [false, 'no CI run found for abc after 15 min', [1]], [true, 'RUN 5 success', [0]]]) {
      const c = new EventEmitter(), out = [], codes = [];
      c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.kill = () => {};
      console.log = (s) => out.push(s); console.error = () => {};
      watchCi('abc', () => c, (x) => codes.push(x), 'bash', keep);
      c.stdout.write(`${line}\n`);
      c.emit('close', 0);
      assert.deepEqual(codes, expectCodes, `${keep} ${line}`);
      assert.deepEqual(out, [line.startsWith('RUN') ? `CI ${line}` : `CI RUN none ${line}`]);
    }
  } finally { console.log = log; console.error = error; }
});

test('TODO 190a fix: next refuses when rook-next.txt names this session, before starting anything', async () => {
  const U = '81b99077-20db-45ec-9515-c01615c70fa8', started = [];
  let t = 0; // sleep advances the clock so a missing refusal ends in "not started", not a hang
  const deps = { read: () => `${U}\r\n`, exists: () => false, start: () => started.push(1), sleep: async (ms) => { t += ms; }, now: () => t, projects: 'P' };
  await assert.rejects(nextRook({ ...deps, own: U }), /rook-next\.txt names this session: write the handover first/);
  assert.deepEqual(started, []);
  assert.equal((await nextRook({ ...deps, exists: () => true, own: 'other' })).code, 0);
});

test('TODO 193b fix: next refuses, before starting anything, when the resume file on rook-next.txt line 3 lacks the merge-due.log line', async () => {
  const U = '81b99077-20db-45ec-9515-c01615c70fa8', started = [];
  let t = 0;
  const deps = { read: () => `${U}\r\nRook S36\r\nR.txt\r\n`, exists: () => false, start: () => started.push(1), sleep: async (ms) => { t += ms; }, now: () => t, projects: 'P' };
  for (const text of ['branch x\n', null]) {
    await assert.rejects(nextRook({ ...deps, readFile: () => { if (text === null) throw new Error('ENOENT'); return text; } }), /refused: R\.txt is missing or has no line .*merge-due\.log first/);
  }
  assert.deepEqual(started, []);
  const full = 'read the last line of ../Project D extras/merge-due.log first\nload select:Monitor,TaskStop\none ci-watch per push\n';
  const ok = await nextRook({ ...deps, exists: () => true, readFile: () => full });
  assert.equal(ok.code, 0);
  assert.deepEqual(started, []);
  for (const need of ['select:Monitor,TaskStop', 'one ci-watch per push']) { // TODO 198c: each missing line is named in the refusal
    await assert.rejects(nextRook({ ...deps, readFile: () => full.replace(need, 'x') }), (e) => e.message === `refused: R.txt has no line containing "${need}"`);
  }
  assert.deepEqual(started, []);
  let up = false; // the transcript appears only after start(): start runs exactly once
  const once = await nextRook({ ...deps, exists: () => up, start: () => { started.push(2); up = true; }, readFile: () => full });
  assert.deepEqual([once.code, started], [0, [2]]);
  const read = []; // a relative line 3 resolves against EXTRAS, an absolute one stays
  for (const r of ['R.txt', resolve('C:\\abs\\R.txt')]) await nextRook({ ...deps, exists: () => true, read: () => `${U}\r\nx\r\n${r}\r\n`, readFile: (p) => { read.push(p); return full; } });
  assert.deepEqual(read, [resolve(EXTRAS, 'R.txt'), resolve('C:\\abs\\R.txt')]);
});

test('TODO 193d2: startWatched reports a real child exiting 3 and a missing exe; exit 0 reports nothing', async () => {
  const run = (bin, args) => new Promise((done) => {
    const got = [];
    startWatched([bin, args, { stdio: 'ignore' }], (f) => got.push(f));
    setTimeout(() => done(got), 1500);
  });
  assert.deepEqual(await run(process.execPath, ['-e', 'process.exit(3)']), [`${process.execPath} exit 3`]);
  assert.deepEqual(await run(process.execPath, ['-e', '0']), []);
  const [missing] = await run('no-such-exe-193d2', []);
  assert.match(missing, /^spawn error: spawn no-such-exe-193d2 ENOENT$/);
});

test('TODO 190a: next starts Rook.lnk once and waits for the new transcript; already there starts nothing; 60 s without it is exit 1', async () => {
  const U = '81b99077-20db-45ec-9515-c01615c70fa8';
  let t = 0;
  const run = (appears, text = `${U}\r\nRook S35\r\n`) => {
    const started = [], slept = [];
    const deps = { read: () => text, exists: () => appears !== null && t >= appears, start: () => started.push(t), sleep: async (ms) => { slept.push(ms); t += ms; }, now: () => t, projects: 'P' };
    return nextRook(deps).then((r) => ({ ...r, started, slept }));
  };
  t = 100; // the transcript is already there
  assert.deepEqual(await run(0), { code: 0, line: `NEXT ROOK ${U} already running`, started: [], slept: [] });
  t = 0; // appears 5 s after the start
  assert.deepEqual(await run(5000), { code: 0, line: `NEXT ROOK ${U} started`, started: [0], slept: [2000, 2000, 2000] });
  t = 0; // never
  const never = await run(null);
  assert.deepEqual([never.code, never.line, never.started.length, never.slept.length], [1, `NEXT ROOK ${U} not started after 60 s`, 1, 30]);
  await assert.rejects(run(0, 'Rook S35\n'), /not a uuid/);
});

test('TODO 192: next spawns powershell Start-Process on the .lnk (spaces and a quote ok) without detached; a failed start names its reason', async () => {
  const lnk = "C:\\Users\\a b\\Start Menu\\Programs\\Startup\\Rook's.lnk";
  assert.deepEqual(startArgs(lnk), ['powershell.exe', ['-NoProfile', '-Command', "Start-Process 'C:\\Users\\a b\\Start Menu\\Programs\\Startup\\Rook''s.lnk'"], { stdio: 'ignore' }]);
  assert.equal(startArgs('C:\\Rook\u2019s\u2018\u201A\u201B.lnk')[1][2], "Start-Process 'C:\\Rook\u2019\u2019s\u2018\u2018\u201A\u201A\u201B\u201B.lnk'");
  const U = '81b99077-20db-45ec-9515-c01615c70fa8';
  let t = 0;
  const r = await nextRook({ read: () => U, exists: () => false, start: () => {}, sleep: async (ms) => { t += ms; }, now: () => t, projects: 'P', why: () => 'powershell.exe exit 1' });
  assert.equal(r.line, `NEXT ROOK ${U} not started after 60 s (powershell.exe exit 1)`);
});

test('merge: refuses without a non-empty retro file unless --no-retro, a non-head sha, or CI not success; otherwise merges', () => {
  const ok = { n: 33, pr: 5, sha: 'a'.repeat(40), head: 'a'.repeat(40), retro: 'retro text', applied: true, noRetro: false, ci: 'success' };
  assert.equal(mergeRefusal(ok), '');
  assert.match(mergeRefusal({ ...ok, applied: false }), /^refused: runs33\/retro33\.applied is missing/); // TODO 193b
  assert.equal(mergeRefusal({ ...ok, applied: false, noRetro: true }), '');
  assert.match(mergeRefusal({ ...ok, retro: null }), /^refused: runs33\/retro33\.out is missing or empty/);
  assert.match(mergeRefusal({ ...ok, retro: ' \r\n' }), /missing or empty/);
  assert.equal(mergeRefusal({ ...ok, retro: null, noRetro: true }), '');
  for (const limit of ["You've hit your limit · resets 5pm", "You've hit your weekly limit"]) { // TODO 196a: a limit message is no retro
    assert.match(mergeRefusal({ ...ok, retro: limit }), /^refused: runs33\/retro33\.out is only a usage-limit message/, limit);
    assert.equal(mergeRefusal({ ...ok, retro: limit, noRetro: true }), '');
  }
  assert.equal(mergeRefusal({ ...ok, retro: 'We never hit the limit of our patience' }), ''); // not the limit message: no "hit your"
  const longRetro = "The builder said \"You've hit your limit\" twice; ".repeat(20); // ~1 kB real retro quoting the phrase
  assert.ok(longRetro.length > 900 && longRetro.length < 1200);
  assert.equal(mergeRefusal({ ...ok, retro: longRetro }), ''); // only a SHORT file is a limit message
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
    assert.throws(() => merge(['5', 'cc'], gh(), extras), /retro33\.applied is missing/);
    writeFileSync(join(extras, 'runs33', 'retro33.applied'), '2026-11-03 applied R1-R3\n');
    assert.throws(() => merge(['5', 'cc'], gh({ head: 'd'.repeat(40) }), extras), /not the head/);
    assert.throws(() => merge(['5', 'cc'], gh({ ci: [{ status: 'completed', conclusion: 'failure' }] }), extras), /is failure/);
    assert.throws(() => merge(['5', 'cc'], gh({ ci: [] }), extras), /not found/);
    assert.throws(() => merge(['5', 'cc'], gh({ branch: 'king/167b' }), extras), /not claude\/session/);
    assert.ok(!cmds.some((c) => c.includes('pr merge')));
    assert.equal(merge(['5', 'cc'], gh(), extras), `MERGED #5 ${sha}`);
    assert.ok(cmds.includes(`gh pr merge 5 --merge --match-head-commit ${sha}`));
    assert.ok(!existsSync(join(extras, 'runs34')), 'no resume note when the retro exists');
    assert.throws(() => merge(['5', 'cc'], gh({ state: 'OPEN' }), extras), /not MERGED/);
    merge(['5', 'cc', '--no-retro'], gh(), extras);
    assert.ok(!existsSync(join(extras, 'runs34')), 'TODO 167c: --no-retro with a non-empty retro writes no "due first" line');
    rmSync(join(extras, 'runs33'), { recursive: true });
    assert.equal(merge(['5', 'cc', '--no-retro'], gh(), extras), `MERGED #5 ${sha}`);
    merge(['5', 'cc', '--no-retro'], gh(), extras);
    assert.equal(readFileSync(join(extras, 'runs34', 'resume-rook.txt'), 'utf8'), 'retro33 due first (merged without it)\nretro33 due first (merged without it)\n');
    mkdirSync(join(extras, 'runs33'));
    writeFileSync(join(extras, 'runs33', 'retro33.out'), ' \n');
    merge(['5', 'cc', '--no-retro'], gh(), extras);
    assert.equal(readFileSync(join(extras, 'runs34', 'resume-rook.txt'), 'utf8').split('\n').length, 4, 'an empty retro file still gets the line');
    rmSync(join(extras, 'runs34'), { recursive: true });
    writeFileSync(join(extras, 'runs33', 'retro33.out'), 'Suggestions\n'); // TODO 193b fix: retro.out present, no .applied
    merge(['5', 'cc', '--no-retro'], gh(), extras);
    assert.equal(readFileSync(join(extras, 'runs34', 'resume-rook.txt'), 'utf8'), 'retro33 edits not applied (merged without retro33.applied)\n');
  } finally { rmSync(extras, { recursive: true, force: true }); }
});

test('TODO 191: merge --due merges the one open session PR inside the OK window, logs every run, refuses otherwise', () => {
  const extras = mkdtempSync(join(tmpdir(), 'projectd-due-'));
  try {
    const sha = 'e'.repeat(40), cmds = [];
    const pr = (number, headRefName) => ({ number, headRefName, headRefOid: sha });
    const gh = (prs) => (cmd, a) => {
      cmds.push([cmd, ...a].join(' '));
      if (cmd === 'git') return sha;
      if (a[0] === 'pr' && a[1] === 'list') return JSON.stringify(prs);
      if (a[0] === 'pr' && a[1] === 'view' && a[4] === 'headRefOid,headRefName') return JSON.stringify({ headRefOid: sha, headRefName: 'claude/session35' });
      if (a[0] === 'run') return JSON.stringify([{ status: 'completed', conclusion: 'success' }]);
      if (a[1] === 'view') return JSON.stringify({ state: 'MERGED' });
      return '';
    };
    const at = (iso) => Date.parse(iso + '+05:30'), log = () => readFileSync(join(extras, 'merge-due.log'), 'utf8').trim().split('\n');
    const T = at('2026-11-08T05:00:00');
    assert.throws(() => mergeDue(gh([]), extras, T), /merge-ok-until\.txt is missing/);
    writeFileSync(join(extras, 'merge-ok-until.txt'), 'soon\n');
    assert.throws(() => mergeDue(gh([]), extras, T), /missing or unreadable/);
    writeFileSync(join(extras, 'merge-ok-until.txt'), '2026-11-08\n');
    assert.equal(mergeDue(gh([]), extras, T), 'NOTHING DUE');
    assert.equal(mergeDue(gh([pr(7, 'king/191')]), extras, T), 'NOTHING DUE', 'a non-session branch is not due');
    assert.throws(() => mergeDue(gh([pr(5, 'claude/session35'), pr(6, 'claude/session36')]), extras, T), /refused: 2 open/);
    assert.throws(() => mergeDue(gh([pr(5, 'claude/session35')]), extras, T), /retro35\.out is missing/);
    assert.ok(!cmds.some((c) => c.includes('pr merge')));
    mkdirSync(join(extras, 'runs35'));
    writeFileSync(join(extras, 'runs35', 'retro35.out'), 'Suggestions\n');
    assert.throws(() => mergeDue(gh([pr(5, 'claude/session35')]), extras, T), /retro35\.applied is missing/);
    writeFileSync(join(extras, 'runs35', 'retro35.applied'), '2026-11-03 applied all\n');
    assert.equal(mergeDue(gh([pr(5, 'claude/session35'), pr(7, 'king/191')]), extras, T), `MERGED #5 ${sha}`);
    assert.ok(cmds.includes(`gh pr merge 5 --merge --match-head-commit ${sha}`));
    assert.throws(() => mergeDue(gh([pr(5, 'claude/session35')]), extras, at('2026-11-09T05:00:00')), /merge OK expired 2026-11-08: ask him/);
    assert.throws(() => mergeDue(gh([pr(5, 'claude/session35')]), extras, at('2026-11-09T00:00:00')), /expired/);
    assert.equal(mergeDue(gh([]), extras, at('2026-11-08T23:59:00')), 'NOTHING DUE');
    const l = log();
    assert.equal(l.length, 11);
    assert.equal(l[0], '2026-11-08 05:00 refused: merge-ok-until.txt is missing or unreadable: ask him');
    assert.equal(l[2], '2026-11-08 05:00 NOTHING DUE');
    assert.equal(l[7], `2026-11-08 05:00 MERGED #5 ${sha}`);
    assert.equal(l[8], '2026-11-09 05:00 refused: merge OK expired 2026-11-08: ask him');
  } finally { rmSync(extras, { recursive: true, force: true }); }
});

test('TODO 191 fix: merge --due refuses red / missing CI, logs a throwing run on one IST line, and rejects impossible or BOM-prefixed dates', () => {
  const extras = mkdtempSync(join(tmpdir(), 'projectd-due-'));
  try {
    const sha = 'e'.repeat(40), T = Date.parse('2026-11-08T05:00:00+05:30');
    const gh = (ci, boom) => (cmd, a) => {
      if (boom && a[0] === 'pr' && a[1] === 'list') throw new Error('Command failed: gh pr list\nHTTP 502\n  bad gateway\n');
      if (cmd === 'git') return sha;
      if (a[0] === 'pr' && a[1] === 'list') return JSON.stringify([{ number: 5, headRefName: 'claude/session35', headRefOid: sha }]);
      if (a[0] === 'pr' && a[1] === 'view') return JSON.stringify({ headRefOid: sha, headRefName: 'claude/session35', state: 'MERGED' });
      if (a[0] === 'run') return JSON.stringify(ci);
      return '';
    };
    const log = () => readFileSync(join(extras, 'merge-due.log'), 'utf8').trim().split('\n');
    mkdirSync(join(extras, 'runs35'));
    writeFileSync(join(extras, 'runs35', 'retro35.out'), 'Suggestions\n');
    writeFileSync(join(extras, 'runs35', 'retro35.applied'), 'done\n');
    writeFileSync(join(extras, 'merge-ok-until.txt'), '2026-11-08\n');
    assert.throws(() => mergeDue(gh([{ status: 'completed', conclusion: 'failure' }]), extras, T), /CI for .* is failure, not success/);
    assert.throws(() => mergeDue(gh([]), extras, T), /CI for .* is not found, not success/);
    assert.throws(() => mergeDue(gh([], true), extras, T), /HTTP 502/);
    assert.equal(log().length, 3);
    assert.match(log()[0], /^2026-11-08 05:00 refused: CI for e+ is failure, not success$/);
    assert.match(log()[1], /^2026-11-08 05:00 refused: CI for e+ is not found, not success$/);
    assert.equal(log()[2], '2026-11-08 05:00 Command failed: gh pr list HTTP 502 bad gateway');
    for (const bad of ['2026-99-99', '2026-02-30', '2026-13-01']) {
      writeFileSync(join(extras, 'merge-ok-until.txt'), bad + '\n');
      assert.throws(() => mergeDue(gh([]), extras, T), /missing or unreadable/, bad);
    }
    writeFileSync(join(extras, 'merge-ok-until.txt'), '﻿2026-11-08\r\n');
    assert.equal(mergeDue(gh([{ status: 'completed', conclusion: 'success' }]), extras, T), `MERGED #5 ${sha}`, 'a BOM and CRLF in the date file are fine');
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

test('retro38i fix: result of a LAUNCH DIED line (no usage) prints it and exits 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectd-result-'));
  try {
    const run = join(dir, 'run.jsonl');
    writeFileSync(run, '{"type":"result","is_error":true,"result":"LAUNCH DIED"}\n');
    assert.throws(() => execFileSync(process.execPath, ['tools/rook.mjs', 'result', run], { encoding: 'utf8', stdio: 'pipe' }), (e) => e.status === 1 && e.stdout.trim() === 'LAUNCH DIED' && !/TypeError/.test(e.stderr));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('TODO 193a: result ends its token line with the report line count (blank lines not counted)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'projectd-result-'));
  try {
    const run = join(dir, 'run.jsonl');
    const result = { type: 'result', result: 'one\n\ntwo\r\n  \nthree\n', usage: { input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 }, permission_denials: [] };
    writeFileSync(run, JSON.stringify(assistant({ input_tokens: 5 })) + '\n' + JSON.stringify(result) + '\n');
    const lines = execFileSync(process.execPath, ['tools/rook.mjs', 'result', run], { encoding: 'utf8' }).split(/\r?\n/);
    assert.match(lines.find((l) => l.startsWith('tokens ')), /· denials 0 · report 3 lines$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('TODO 193a: result prints the Rook context line when the gate has one, and nothing when it has none', () => {
  const seen = [];
  printRookContext({ gate: { contextLine: () => 'Rook context 106k (handover at 150k)' } }, (l) => seen.push(l));
  printRookContext({ gate: { contextLine: () => '' } }, (l) => seen.push(l));
  assert.deepEqual(seen, ['Rook context 106k (handover at 150k)']);
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

test('TODO 196g fix: fails reads the real suite-log lines (browser [shard n/m] FAIL, node:test spec ✖ + summary), with the first 3 +/- lines, max 40', () => {
  const E = '\x1b';
  // Copied from runs35/suite-da8a469.log (lines 1173, 1622-1628) and runs36/suite-b6de1a7.log (1821, 2295, 2444).
  const slow = 'cached usage shares live summaries, avoids processes and writes, and falls back when missing or stale';
  const spec = [`${E}[32m✔ some passing test ${E}[90m(2.0039ms)${E}[39m${E}[39m`, `${E}[31m✖ ${slow} ${E}[90m(256.7319ms)${E}[39m${E}[39m`, `${E}[32m✔ later test ${E}[90m(0.3ms)${E}[39m${E}[39m`,
    `${E}[31m✖ failing tests:${E}[39m`, '', 'test at rook-cache.test.mjs:21:1', `${E}[31m✖ ${slow} ${E}[90m(256.7319ms)${E}[39m${E}[39m`,
    '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:', '  + actual - expected', '', "  + 'x'", "  - 'y'", '  + 1', '  - 2'].join('\n');
  assert.deepEqual(failLines(spec, 'u.log'), [slow, "+ 'x'", "- 'y'", '+ 1']); // the inline line and its summary repeat count once
  const browser = ['[shard 1/4] FAIL part PDF: tiled on A4, and scaled to fit A0 / A3 / A4 with its scale stated; the layout dialog is unchanged ', '[shard 2/4] FAIL TODO 146: an up-left Line and its readout leave a clear, stationary command box ', 'SUITE unit=0 browser=1'].join('\r\n');
  assert.deepEqual(failLines(browser, 'b.log'), ['part PDF: tiled on A4, and scaled to fit A0 / A3 / A4 with its scale stated; the layout dialog is unchanged', 'TODO 146: an up-left Line and its readout leave a clear, stationary command box']);
  assert.deepEqual(failLines('[shard 2/4] FAIL a step\n[shard 2/4] - The input did not match the regular expression /\\(80\\.00\\) Tj/\n[shard 2/4] + 1', 's.log'), ['a step', '- The input did not match the regular expression /\\(80\\.00\\) Tj/', '+ 1']); // TODO 196g Low 1
  assert.deepEqual(failLines(`FAIL bare step\n${E}[31m- 1${E}[39m\n${E}[32m+ 2${E}[39m`, 'a.log'), ['bare step', '- 1', '+ 2']);
  assert.deepEqual(failLines('ok 1\nok step\nSUITE unit=0 browser=0\n', 'x.log'), ['no failures in x.log']);
  assert.deepEqual(failLines('lots of output\nSUITE unit=1 browser=0\n', 'r.log'), ['red (unit=1 browser=0) but no failing step lines found in r.log']);
  assert.deepEqual(failLines('SUITE unit=0 browser=2', 'r.log'), ['red (unit=0 browser=2) but no failing step lines found in r.log']);
  const many = Array.from({ length: 30 }, (_, i) => `FAIL step ${i}\n+ a\n- b`).join('\n');
  assert.equal(failLines(many, 'm.log').length, 40);
});

test('TODO 196g: handover refuses a missing resume file or a line 2 without both skills; otherwise writes uuid, name, absolute resume path and does not start anything', () => {
  const dir = mkdtempSync(join(tmpdir(), 'handover-'));
  try {
    const skills = 'First action: the Skill tool for mattpocock-skills:grilling AND mattpocock-skills:domain-modeling';
    const good = join(dir, 'runs37', 'resume-rook.txt');
    mkdirSync(join(dir, 'runs37'));
    const needs = 'read merge-due.log\r\nload select:Monitor,TaskStop\r\none ci-watch per push\r\n'; // the lines `next` requires too
    writeFileSync(good, `Rook S37\r\n${skills}\r\n${needs}`);
    assert.throws(() => handover(join(dir, 'none.txt'), 'Rook S37d', dir), /missing/);
    for (const line2 of ['mattpocock-skills:grilling only', 'mattpocock-skills:domain-modeling only', '']) {
      const bad = join(dir, 'bad.txt');
      writeFileSync(bad, `${skills}\n${line2}\n`);
      assert.throws(() => handover(bad, 'Rook S37d', dir), /line 2 .* lacks/);
    }
    assert.throws(() => handover(good, '', dir), /usage/);
    const noRuns = join(dir, 'resume.txt'), noLog = join(dir, 'runs37', 'resume-nolog.txt');
    writeFileSync(noRuns, `Rook S37\n${skills}\n${needs}`);
    for (const need of ['select:Monitor,TaskStop', 'one ci-watch per push']) { // refused before rook-next.txt is written, with the message `next` gives
      const part = join(dir, 'runs37', 'resume-part.txt');
      writeFileSync(part, `Rook S37\n${skills}\n${needs.replace(need, 'x')}`);
      assert.throws(() => handover(part, 'Rook S37d', dir), (e) => e.message === `refused: ${part} has no line containing "${need}"`);
    }
    writeFileSync(noLog, `Rook S37\n${skills}\nnothing else\n`);
    assert.throws(() => handover(noRuns, 'Rook S37d', dir), /no runs<N> folder/);
    assert.throws(() => handover(noLog, 'Rook S37d', dir), /no merge-due\.log line/);
    const argv = ['node', 'rook.mjs', 'handover', good, 'Rook S37d']; // the CLI guard, pure: no process, no live rook-next.txt
    assert.equal(handoverArgsError(argv), '');
    assert.match(handoverArgsError([...argv.slice(0, 4), 'Rook', 'S37d']), /2 arguments/); // an unquoted name
    assert.ok(!existsSync(join(dir, 'rook-next.txt')));
    const printed = handover(good, 'Rook S37d', dir, '11111111-2222-3333-4444-555555555555');
    const lines = readFileSync(join(dir, 'rook-next.txt'), 'utf8').split('\n');
    assert.deepEqual(lines, ['11111111-2222-3333-4444-555555555555', 'Rook S37d', resolve(good).replaceAll('\\', '/'), '']);
    assert.equal(printed, lines.slice(0, 3).join('\n'));
    // TODO 206: rook-next.txt now names "Rook S37d"; its handover retro (runs37/retro37d.out) must exist, or --no-retro
    assert.throws(() => handover(good, 'x', dir), /must end in S<N>/); // TODO 206 fix: a name without S<N> is refused
    assert.throws(() => handover(good, 'Rook S37f', dir), /refused: runs37\/retro37d\.out is missing/);
    assert.equal(readFileSync(good, 'utf8').includes('Handover retro:'), false);
    assert.match(handover(good, 'Rook S37f', dir, undefined, true).split('\n')[0], /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/); // a new random uuid by default
    assert.equal(readFileSync(good, 'utf8').includes('Handover retro:'), false); // --no-retro and no .out: no line
    assert.equal(handoverArgsError([...argv, '--no-retro']), '');
    writeFileSync(join(dir, 'rook-next.txt'), 'u\nRook S37d\nr\n');
    writeFileSync(join(dir, 'runs37', 'retro37d.out'), 'x');
    handover(good, 'Rook S37e', dir);
    assert.ok(readFileSync(good, 'utf8').endsWith('Handover retro: read runs37/retro37d.out first and apply what it recommends.\n'));
    writeFileSync(join(dir, 'rook-next.txt'), 'u\nRook S37\nr\n'); // no letter: retro37-0, not retro37h
    writeFileSync(join(dir, 'runs37', 'retro37h.out'), 'x');
    assert.throws(() => handover(good, 'Rook S37f', dir), /runs37\/retro37-0\.out is missing/);
    writeFileSync(join(dir, 'rook-next.txt'), 'u\nRook S37h\nr\n');
    rmSync(join(dir, 'runs37', 'retro37h.out'));
    assert.throws(() => handover(good, 'Rook S37f', dir), /runs37\/retro37h\.out is missing/);
    const cwd = process.cwd(); // TODO 196g Low 3: a bare file name run from inside runs37 passes the runs<N> check
    process.chdir(join(dir, 'runs37'));
    try { assert.equal(handover('resume-rook.txt', 'Rook S37f', dir, undefined, true).split('\n')[2], resolve(good).replaceAll('\\', '/')); } finally { process.chdir(cwd); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
