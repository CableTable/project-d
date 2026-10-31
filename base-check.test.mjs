import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseArgs, testCommand } from './tools/base-check.mjs';

test('base-check arguments: a commit id and an in-repo test file; a step only for browser.test.mjs', () => {
  assert.deepEqual(parseArgs(['abc1234', 'a.test.mjs']), { sha: 'abc1234', file: 'a.test.mjs', step: undefined });
  assert.deepEqual(parseArgs(['abc1234', 'browser.test.mjs', 'TODO 1']), { sha: 'abc1234', file: 'browser.test.mjs', step: 'TODO 1' });
  assert.throws(() => parseArgs(['abc1234']), /usage/);
  assert.throws(() => parseArgs(['HEAD', 'a.test.mjs']), /not a commit id/);
  assert.throws(() => parseArgs(['abc1234', '../a.test.mjs']), /inside the repo/);
  assert.throws(() => parseArgs(['abc1234', 'C:/a.test.mjs']), /inside the repo/);
  assert.throws(() => parseArgs(['abc1234', 'a.test.mjs', 'step']), /only applies to browser/);
});

test('base-check runs a unit file under node --test and the browser file with a port and the step', () => {
  assert.deepEqual(testCommand('a.test.mjs')[1], ['--test', 'a.test.mjs']);
  assert.deepEqual(testCommand('browser.test.mjs', 'TODO 1')[1], ['browser.test.mjs', '5391', 'TODO 1']);
  assert.deepEqual(testCommand('browser.test.mjs')[1], ['browser.test.mjs', '5391']);
});

test('base-check CLI registers a no-op SIGINT listener before checking arguments', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    process.argv = [process.execPath, 'tools/base-check.mjs'];
    await import('./tools/base-check.mjs');
    assert.equal(process.listenerCount('SIGINT'), 1);
    process.emit('SIGINT');
    process.exitCode = 0;
  `], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('base-check: the copied test file is run on the base (PASS), a test needing later files FAILs, and the worktree is always removed', () => {
  const repo = mkdtempSync(join(tmpdir(), 'base-check-test-'));
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', `core.hooksPath=${join(repo, '.git/hooks')}`, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  const file = 'tmp-base-check.test.mjs';
  const head = "import { test } from 'node:test'; import { existsSync } from 'node:fs'; import assert from 'node:assert/strict';\n";
  try {
    git('init', '-q');
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    const root = git('rev-parse', 'HEAD').trim();
    writeFileSync(join(repo, 'later.txt'), 'later\n');
    git('add', '.');
    git('commit', '-qm', 'later');
    mkdirSync(join(repo, 'tools'));
    mkdirSync(join(repo, 'node_modules'));
    copyFileSync('tools/base-check.mjs', join(repo, 'tools/base-check.mjs'));
    const before = git('worktree', 'list');
    const run = () => spawnSync(process.execPath, ['tools/base-check.mjs', root, file], { cwd: repo, encoding: 'utf8' });
    writeFileSync(join(repo, file), head + "test('x', () => assert.ok(existsSync('tmp-base-check.test.mjs')));\n");
    const pass = run();
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    assert.match(pass.stdout, /PASS\s*$/);
    assert.equal(git('worktree', 'list'), before);
    writeFileSync(join(repo, file), head + "test('x', () => assert.ok(existsSync('later.txt')));\n");
    const fail = run();
    assert.equal(fail.status, 1);
    assert.match(fail.stdout, /FAIL\s*$/);
    assert.equal(git('worktree', 'list'), before);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('the pre-commit hook refuses a staged conflict marker and names the file; a marker mid-line passes', () => {
  const repo = mkdtempSync(join(tmpdir(), 'hook-')), hooks = join(repo, '.git/hooks');
  const git = (...a) => spawnSync('git', ['-C', repo, '-c', `core.hooksPath=${hooks}`, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  try {
    git('init', '-q');
    mkdirSync(hooks, { recursive: true });
    copyFileSync('tools/hooks/pre-commit', join(hooks, 'pre-commit'));
    chmodSync(join(hooks, 'pre-commit'), 0o755);
    writeFileSync(join(repo, 'ok.txt'), 'fine\nnot a <<<<<<< marker\n');
    git('add', '.');
    assert.equal(git('commit', '-m', 'ok').status, 0);
    writeFileSync(join(repo, 'ok.txt'), 'staged update\n');
    git('add', 'ok.txt');
    writeFileSync(join(repo, 'ok.txt'), '<<<<<<< HEAD\n');
    assert.equal(git('commit', '-m', 'unstaged marker').status, 0);
    writeFileSync(join(repo, 'merged.js'), 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> branch\n');
    git('add', '.');
    const r = git('commit', '-m', 'bad');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /merged\.js/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
