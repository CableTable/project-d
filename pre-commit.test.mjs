import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('TODO 169: pre-commit refuses mixed staged endings, allows uniform endings and binaries, keeps conflict check', () => {
  const repo = mkdtempSync(join(tmpdir(), 'hook-169-'));
  const git = (...args) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  const file = 'staged file.txt';
  try {
    assert.equal(git('init', '-q').status, 0);
    git('config', 'core.autocrlf', 'false');
    git('config', 'core.safecrlf', 'false');
    git('config', 'core.hooksPath', resolve(repo, '.git/hooks'));
    const hook = join(repo, '.git/hooks/pre-commit');
    copyFileSync('tools/hooks/pre-commit', hook);
    chmodSync(hook, 0o755);
    for (const [label, content, refused] of [
      ['mixed CRLF first', 'one\r\ntwo\nthree\r\n', 'mixed line endings in staged file.txt (first LF-only line 2)'],
      ['mixed LF first', 'one\ntwo\r\n', 'mixed line endings in staged file.txt (first LF-only line 1)'],
      ['LF only', 'one\ntwo\n'],
      ['CRLF only', 'one\r\ntwo\r\n'],
      ['mixed modified file', 'one\r\ntwo\n', 'mixed line endings in staged file.txt (first LF-only line 2)'],
      ['CRLF with unterminated tail', 'one\r\ntwo'],
      ['LF with unterminated tail', 'one\ntwo'],
      ['conflict marker', '<<<<<<< HEAD\n', 'conflict marker'],
      ['binary', 'one\0\r\ntwo\n'],
    ]) {
      writeFileSync(join(repo, file), content);
      assert.equal(git('add', '--', file).status, 0);
      writeFileSync(join(repo, file), 'unstaged clean content\n');
      const result = git('commit', '-m', label);
      assert.equal(result.status, refused ? 1 : 0, `${label}: ${result.stdout}${result.stderr}`);
      if (refused) assert.ok(result.stderr.includes(`commit refused: ${refused}`), result.stderr);
    }
    // A pure rename of a mixed file (committed with --no-verify) is checked under its new path.
    writeFileSync(join(repo, 'old name.txt'), 'one\r\ntwo\n');
    assert.equal(git('add', '--', 'old name.txt').status, 0);
    assert.equal(git('commit', '--no-verify', '-m', 'mixed baseline').status, 0);
    assert.equal(git('mv', 'old name.txt', 'new name.txt').status, 0);
    let result = git('commit', '-m', 'rename');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.stderr.includes('mixed line endings in new name.txt (first LF-only line 2)'), result.stderr);
    // Two mixed files: one refusal that lists both.
    writeFileSync(join(repo, 'other file.txt'), 'a\r\nb\n');
    assert.equal(git('add', '--', 'other file.txt').status, 0);
    result = git('commit', '-m', 'two');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.stderr.includes('in new name.txt') && result.stderr.includes('in other file.txt'), result.stderr);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
