import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gitBash } from './rook.mjs';

test('TODO 219c2: ci-watch.sh checks its arguments before it looks up the repo (a lone --run, no arguments, two shas: usage, exit 2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-watch-')); // a copy with no rook.mjs beside it: a repo lookup first would fail with another message
  try {
    copyFileSync(fileURLToPath(new URL('./ci-watch.sh', import.meta.url)), join(dir, 'ci-watch.sh'));
    for (const args of [[], ['--run'], ['a', 'b'], ['--run', '']]) {
      const r = spawnSync(gitBash(), [join(dir, 'ci-watch.sh'), ...args], { encoding: 'utf8' });
      assert.deepEqual([r.status, r.stdout.trim()], [2, 'usage: ci-watch.sh <sha> | --run <id> [--repo <owner/repo>]'], JSON.stringify(args));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
