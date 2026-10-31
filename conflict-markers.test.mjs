import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('tracked files contain no merge-conflict marker lines', () => {
  const r = spawnSync('git', ['grep', '-nE', '^(<<<<<<<|>>>>>>>)( |$)'], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.error?.message || r.stdout || r.stderr || `git grep exited ${r.status}`);
});
