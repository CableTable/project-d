import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

test('base-check: the copied test file is run on the base (PASS), a test needing later files FAILs, and the worktree is always removed', () => {
  const repo = resolve('.'), before = execFileSync('git', ['worktree', 'list'], { cwd: repo, encoding: 'utf8' });
  const root = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim().split('\n')[0];
  const file = 'tmp-base-check.test.mjs';
  const head = "import { test } from 'node:test'; import { existsSync } from 'node:fs'; import assert from 'node:assert/strict';\n";
  const run = () => spawnSync(process.execPath, ['tools/base-check.mjs', root, file], { cwd: repo, encoding: 'utf8' });
  try {
    writeFileSync(file, head + "test('x', () => assert.ok(existsSync('tmp-base-check.test.mjs')));\n");
    const pass = run();
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    assert.match(pass.stdout, /PASS\s*$/);
    writeFileSync(file, head + "test('x', () => assert.ok(existsSync('tools/base-check.mjs')));\n"); // not in the root commit
    const fail = run();
    assert.equal(fail.status, 1);
    assert.match(fail.stdout, /FAIL\s*$/);
  } finally {
    rmSync(file, { force: true });
    assert.equal(execFileSync('git', ['worktree', 'list'], { cwd: repo, encoding: 'utf8' }), before);
  }
});

test('the pre-commit hook refuses a staged conflict marker and names the file; a marker mid-line passes', () => {
  const hooks = resolve('tools/hooks'), repo = mkdtempSync(join(tmpdir(), 'hook-'));
  const git = (...a) => spawnSync('git', ['-C', repo, '-c', `core.hooksPath=${hooks}`, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(join(repo, 'ok.txt'), 'fine\nnot a <<<<<<< marker\n');
  git('add', '.');
  assert.equal(git('commit', '-m', 'ok').status, 0);
  writeFileSync(join(repo, 'merged.js'), 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> branch\n');
  git('add', '.');
  const r = git('commit', '-m', 'bad');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /merged\.js/);
  rmSync(repo, { recursive: true, force: true });
});
