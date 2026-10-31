import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { launchFailed, launchRun, runningNote, parseReview, parseBuild, parseKnight, reviewerArgs, buildArgs, knightArgs, commandLine, review, build, knight } from './tools/rook-launch.mjs';

const X = 'E:/Project B/Claude/Project D extras';
const REVIEWER = 'claude2.cmd -p --agent reviewer --model claude-opus-5-5 --effort medium --permission-mode dontAsk --max-budget-usd 6 '
  + `--add-dir "${X}" --disallowedTools Agent "Bash(git commit:*)" "Bash(git push:*)" "Bash(git add:*)" "Bash(git checkout:*)" `
  + '"Bash(git switch:*)" "Bash(git stash:*)" "Bash(git restore:*)" "Bash(git pull:*)" --output-format stream-json --verbose';
const BUILDER = 'claude2.cmd -p --agent builder --strict-mcp-config --model claude-sonnet-5-5 --effort high --permission-mode acceptEdits --max-budget-usd 8 '
  + `--add-dir "E:/Project B/Claude/Project D/.git" --add-dir "${X}" `
  + '--disallowedTools "Bash(gh pr merge:*)" "PowerShell(gh pr merge:*)" Agent "Bash(git push:*)" "Bash(taskkill:*)" "PowerShell(Stop-Process:*)" '
  + '--allowedTools "Bash(echo:*)" "Bash(tee:*)" "Bash(npx.cmd:*)" "Bash(npm.cmd:*)" "PowerShell(Select-String:*)" "PowerShell(Select-Object:*)" '
  + '"PowerShell(Write-Output:*)" "Bash(git add:*)" "Bash(git commit:*)" "Bash(git fetch:*)" "Bash(git checkout:*)" "Bash(git switch:*)" '
  + '"Bash(git cherry-pick:*)" "Bash(git rebase:*)" "Bash(git apply:*)" "Bash(git check-ignore:*)" --output-format stream-json --verbose';

// A recorder in place of git / npm / files / the launch: `calls` is the plan in order; `fail` names a call that throws.
function recorder(fail = '') {
  const calls = [];
  const rec = (name, ret) => (...a) => { calls.push([name, ...a]); if (fail === name) throw new Error(`${name} failed`); return ret; };
  const open = (path, mode) => { calls.push(['open', path, mode]); if (fail === 'open') throw new Error('open failed'); return `fd:${path}`; };
  return { calls, x: { git: rec('git', ''), has: rec('has', true), need: rec('need'), locked: rec('locked', false), open, npmCi: rec('npmCi'), launch: (...a) => calls.push(['launch', ...a]), gate: { check: rec('gateCheck'), record: rec('gateRecord') } } };
}
const launched = (calls) => calls.find((c) => c[0] === 'launch');
const isSwitch = (c) => c[0] === 'git' && c[2] === 'switch';

test('review arguments: three positionals, optional --as and --from clone branch, a real commit id, paths absolute', () => {
  assert.deepEqual(parseReview(['abc1234', 'b.txt', 'r.jsonl']), { sha: 'abc1234', brief: resolve('b.txt'), out: resolve('r.jsonl'), as: 'bishop', from: undefined });
  const r = parseReview(['abc1234', 'b.txt', 'r.jsonl', '--from', 'clone', 'king/x', '--as', 'king']);
  assert.deepEqual([r.as, r.from], ['king', { clone: resolve('clone'), branch: 'king/x' }]);
  assert.throws(() => parseReview(['abc1234', 'b.txt']), /usage: review/);
  assert.throws(() => parseReview(['abc1234', 'b.txt', 'r.jsonl', '--from', 'C:/clone']), /usage: review/);
  assert.throws(() => parseReview(['abc1234', 'b.txt', 'r.jsonl', '--as']), /usage: review/);
  assert.throws(() => parseReview(['abc1234', 'b.txt', 'r.jsonl', '--as', 'pawn']), /unknown account: pawn/);
  assert.throws(() => parseReview(['abc1234', 'b.txt', 'r.jsonl', '--as', 'king', '--as', 'king']), /usage: review/);
  assert.throws(() => parseReview(['--from', 'C:/clone', 'x', 'abc1234', 'b.txt', 'r.jsonl']), /usage: review/);
  assert.throws(() => parseReview(['HEAD', 'b.txt', 'r.jsonl']), /not a commit id/);
});

test('build arguments: four positionals, optional --as (default king), a real commit id, paths absolute', () => {
  assert.deepEqual(parseBuild(['b.txt', 'o.jsonl', 'king/x', 'abc1234']), { brief: resolve('b.txt'), out: resolve('o.jsonl'), branch: 'king/x', sha: 'abc1234', as: 'king', dir: undefined, fix: false, over: false });
  const flagged = parseBuild(['b.txt', 'o.jsonl', 'king/x', 'abc1234', '--fix', '--over', '--as', 'king']);
  assert.deepEqual([flagged.fix, flagged.over, flagged.as], [true, true, 'king']);
  assert.equal(parseBuild(['b.txt', 'o.jsonl', 'king/x', 'abc1234', '--as', 'bishop']).as, 'bishop');
  assert.throws(() => parseBuild(['b.txt', 'o.jsonl', 'king/x']), /usage: build/);
  assert.throws(() => parseBuild(['b.txt', 'o.jsonl', 'king/x', 'main']), /not a commit id/);
});

test('knight arguments: four positionals, report ends in .txt, log sits next to it, paths absolute', () => {
  assert.deepEqual(parseKnight(['b.txt', 'runs/k.txt', 'knight/x', 'abc1234']),
    { brief: resolve('b.txt'), report: resolve('runs/k.txt'), branch: 'knight/x', sha: 'abc1234', log: resolve('runs/k.log'), fix: false, over: false });
  assert.deepEqual(['--fix', '--over'].map((f) => parseKnight(['b.txt', 'runs/k.txt', 'knight/x', 'abc1234', f])).map((p) => [p.fix, p.over]), [[true, false], [false, true]]);
  assert.throws(() => parseKnight(['b.txt', 'k.txt', 'knight/x']), /usage: knight/);
  assert.throws(() => parseKnight(['b.txt', 'k.md', 'knight/x', 'abc1234']), /must end in \.txt/);
  assert.throws(() => parseKnight(['b.txt', 'k.txt', 'knight/x', 'main']), /not a commit id/);
});

test('the four account x role command lines: flags, cwd, launcher', () => {
  for (const [as, bin, role, run, dir] of [
    ['bishop', 'claude2.cmd', 'review', REVIEWER, 'ProjectD-s15fix'], ['king', 'claude3.cmd', 'review', REVIEWER, 'ProjectD-king2'],
    ['bishop', 'claude2.cmd', 'build', BUILDER, 'ProjectD-s15fix'], ['king', 'claude3.cmd', 'build', BUILDER, 'ProjectD-king'],
  ]) {
    const { calls, x } = recorder();
    if (role === 'review') review(['abc1234', 'b.txt', 'o.jsonl', '--as', as], x);
    else build(['b.txt', 'o.jsonl', 'br', 'abc1234', '--as', as], x);
    const [, launcher, args, cwd, inFd, outFd, env] = launched(calls);
    assert.equal(basename(launcher), bin, `${as} ${role}`);
    assert.equal(commandLine(bin, args), run.replace('claude2.cmd', bin), `${as} ${role}`);
    assert.equal(cwd, `${X}/${dir}`);
    assert.deepEqual([inFd, outFd], [`fd:${resolve('b.txt')}`, `fd:${resolve('o.jsonl')}`]);
    if (role === 'build') assert.equal('FORCE_COLOR' in env, false);
  }
  assert.equal(commandLine('claude2.cmd', reviewerArgs(X)), REVIEWER);
  assert.equal(commandLine('claude2.cmd', buildArgs(X)), BUILDER);
});

test('review plan: checks, files opened, detach, npm ci in the review folder, then launch; a failing npm ci launches nothing', () => {
  const { calls, x } = recorder();
  review(['abc1234', 'b.txt', 'o.jsonl'], x);
  const names = calls.map((c) => c[0] + (c[0] === 'git' ? ` ${c[2]}` : ''));
  assert.deepEqual(names.slice(-5), ['open', 'git switch', 'npmCi', 'open', 'launch']);
  assert.equal(calls.find((c) => c[0] === 'npmCi')[1], `${X}/ProjectD-s15fix`);
  assert.ok(calls.some((c) => c[0] === 'need' && c[1] === `${X}/ProjectD-s15fix/.claude/agents/reviewer.md`));
  const bad = recorder('npmCi');
  assert.throws(() => review(['abc1234', 'b.txt', 'o.jsonl'], bad.x), /npmCi failed/);
  assert.equal(launched(bad.calls), undefined);
});

test('build and knight open the brief before the branch is made (a failed run can be re-run), the out file only after it', () => {
  for (const [run, args] of [[build, ['b.txt', 'o.jsonl', 'br', 'abc1234']], [knight, ['b.txt', 'k.txt', 'br', 'abc1234']]]) {
    const { calls, x } = recorder();
    run(args, x);
    const at = (f) => calls.findIndex(f);
    assert.ok(at((c) => c[0] === 'open' && c[2] === 'r') < at(isSwitch), run.name);
    assert.ok(at(isSwitch) < at((c) => c[0] === 'open' && c[2] === 'w'), run.name);
    assert.ok(at((c) => c[0] === 'open' && c[2] === 'w') < at((c) => c[0] === 'launch'), run.name);
    assert.deepEqual(calls.find(isSwitch).slice(3), ['-c', 'br', 'abc1234']);
    const failing = recorder('open');
    assert.throws(() => run(args, failing.x), /open failed/);
    assert.equal(failing.calls.some(isSwitch), false, run.name);
  }
});

test('a folder with tracked changes, or a commit it lacks, stops the run before anything changes', () => {
  const dirty = recorder();
  dirty.x.git = (...a) => { dirty.calls.push(['git', ...a]); return a[1] === 'status' ? ' M web/app.js\n?? tmp.js' : ''; };
  assert.throws(() => build(['b.txt', 'o.jsonl', 'br', 'abc1234'], dirty.x), /tracked changes.*web\/app\.js/);
  assert.equal(dirty.calls.some((c) => c[0] === 'open'), false);
  const missing = recorder();
  missing.x.has = () => false;
  assert.throws(() => build(['b.txt', 'o.jsonl', 'br', 'abc1234'], missing.x), /not in/);
});

test('a failed switch never opens the out file; a locked folder is refused before anything changes', () => {
  for (const [run, args] of [[build, ['b.txt', 'o.jsonl', 'br', 'abc1234']], [knight, ['b.txt', 'k.txt', 'br', 'abc1234']], [review, ['abc1234', 'b.txt', 'o.jsonl']]]) {
    const failing = recorder('git');
    assert.throws(() => run(args, failing.x), /git failed/);
    assert.equal(failing.calls.some((c) => c[0] === 'open' && c[2] === 'w'), false, run.name);
    const locked = recorder();
    locked.x.locked = () => true;
    assert.throws(() => run(args, locked.x), /in use.*\.run-lock/);
    assert.equal(locked.calls.some((c) => c[0] === 'open' || isSwitch(c) || c[0] === 'launch'), false, run.name);
  }
});

test('the Knight command line has the builder profile, its clone, the git folder and Playwright', () => {
  const line = commandLine('codex.cmd', knightArgs('E:/runs/k.txt', 'E:/x y/ProjectD-rowan', 'C:/Users/me'));
  assert.equal(line, 'codex.cmd exec -p builder -C "E:/x y/ProjectD-rowan" --add-dir "E:/x y/ProjectD-rowan-git" '
    + '--add-dir C:/Users/me/AppData/Local/ms-playwright -o E:/runs/k.txt -');
});

test('commandLine refuses a double quote', () => {
  assert.throws(() => commandLine('x', ['a"b']), /double quote/);
});

test('a launch that fails to start deletes the folder\'s lock and exits 1; no lock is no error', (t) => {
  t.mock.method(console, 'error', () => {});
  const dir = mkdtempSync(join(tmpdir(), 'rook-lock-')), codes = [];
  writeFileSync(`${dir}/.run-lock`, 'x');
  launchFailed(dir, new Error('spawn ENOENT'), (c) => codes.push(c));
  assert.equal(existsSync(`${dir}/.run-lock`), false);
  launchFailed(dir, new Error('again'), (c) => codes.push(c));
  assert.deepEqual(codes, [1, 1]);
  rmSync(dir, { recursive: true });
});

// A fake spawn: records its call and returns a child that can emit 'error'.
const fakeSpawn = (throwOnSpawn) => {
  const child = Object.assign(new EventEmitter(), { unref() {} });
  return { child, spawn: () => { if (throwOnSpawn) throw new Error('spawn blew up'); return child; } };
};

test('launchRun writes the lock last: a bad argument leaves none, a spawn that throws removes it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rook-lock-'));
  assert.throws(() => launchRun('x.cmd', ['a"b'], dir, 0, 1, {}, 'o.jsonl', fakeSpawn().spawn), /double quote/);
  assert.equal(existsSync(`${dir}/.run-lock`), false);
  assert.throws(() => launchRun('x.cmd', ['ok'], dir, 0, 1, {}, 'o.jsonl', fakeSpawn(true).spawn), /spawn blew up/);
  assert.equal(existsSync(`${dir}/.run-lock`), false);
  rmSync(dir, { recursive: true });
});

test('launchRun: the child\'s error event removes the lock; a live run keeps it, and result reports RUNNING for its out file only', (t) => {
  t.mock.method(console, 'error', () => {});
  const dir = mkdtempSync(join(tmpdir(), 'rook-lock-')), out = join(dir, 'run.jsonl');
  const { child, spawn } = fakeSpawn();
  launchRun('x.cmd', ['ok'], dir, 0, 1, {}, out, spawn, (cwd, e) => launchFailed(cwd, e, () => {}));
  assert.equal(existsSync(`${dir}/.run-lock`), true);
  assert.match(runningNote(out, [dir]), /^RUNNING \(lock since \d{4}-\d\d-\d\dT[\d:.]+Z\)$/);
  assert.equal(runningNote(join(dir, 'other.jsonl'), [dir]), '');
  child.emit('error', new Error('spawn ENOENT'));
  assert.equal(existsSync(`${dir}/.run-lock`), false);
  assert.equal(runningNote(out, [dir]), '');
  rmSync(dir, { recursive: true });
});

test('build --dir king2 runs King in his review folder; a lock there refuses it; only for King', () => {
  assert.equal(parseBuild(['b.txt', 'o.jsonl', 'br', 'abc1234', '--dir', 'king2']).dir, 'king2');
  assert.equal(parseBuild(['b.txt', 'o.jsonl', 'br', 'abc1234']).dir, undefined);
  assert.throws(() => parseBuild(['b.txt', 'o.jsonl', 'br', 'abc1234', '--dir', 'king3']), /--dir king2/);
  assert.throws(() => parseBuild(['b.txt', 'o.jsonl', 'br', 'abc1234', '--as', 'bishop', '--dir', 'king2']), /--dir king2/);
  const { calls, x } = recorder();
  build(['b.txt', 'o.jsonl', 'br', 'abc1234', '--dir', 'king2'], x);
  assert.equal(calls.find(isSwitch)[1], `${X}/ProjectD-king2`);
  assert.equal(launched(calls)[3], `${X}/ProjectD-king2`);
  const locked = recorder();
  locked.x.locked = (dir) => dir.endsWith('ProjectD-king2');
  assert.throws(() => build(['b.txt', 'o.jsonl', 'br', 'abc1234', '--dir', 'king2'], locked.x), /in use.*\.run-lock/);
});

test('handover gate: build and knight check it first, record after the launch; a refusal launches nothing; --fix / --over pass through', () => {
  for (const [run, args] of [[build, ['b.txt', 'o.jsonl', 'br', 'abc1234']], [knight, ['b.txt', 'k.txt', 'br', 'abc1234']]]) {
    const { calls, x } = recorder();
    run([...args, '--fix'], x);
    const at = (name) => calls.findIndex((c) => c[0] === name);
    assert.equal(at('gateCheck'), 0, run.name);
    assert.deepEqual(calls[0].slice(1), [true, false]);
    assert.ok(at('launch') < at('gateRecord'), run.name);
    assert.deepEqual(calls[at('gateRecord')][1], { fix: true, over: false, brief: resolve(args[0]), branch: 'br' });
    const refused = recorder('gateCheck');
    assert.throws(() => run(args, refused.x), /gateCheck failed/);
    assert.deepEqual(refused.calls.map((c) => c[0]), ['gateCheck'], run.name);
    const over = recorder();
    run([...args, '--over'], over.x);
    assert.deepEqual(over.calls[0].slice(1), [false, true]);
  }
});
