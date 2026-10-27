import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserArgs, shardSelector } from './tools/browser-shards.mjs';

test('four contiguous shards balance time, cover every step once, and include new steps', () => {
  const timings = { a: 8, b: 1, c: 1, d: 10, e: 5, f: 5, g: 10, 'no console errors': 0 };
  const names = ['new first', 'a', 'b', 'new middle', 'c', 'd', 'e', 'f', 'g', 'new last'];
  const groups = [1, 2, 3, 4].map((index) => {
    const select = shardSelector(timings, index, 4);
    const group = names.filter(select);
    assert.equal(select('no console errors'), true);
    return group;
  });
  assert.deepEqual(groups, [['new first', 'a', 'b', 'new middle', 'c'], ['d'], ['e', 'f'], ['g', 'new last']]);
  assert.deepEqual(groups.flat(), names);
  assert.deepEqual(groups.map((group) => group.reduce((n, name) => n + (timings[name] || 0), 0)), [10, 10, 10, 10]);
  // Removing a timed boundary does not swallow a later shard.
  const select = shardSelector(timings, 3, 4);
  assert.deepEqual(['a', 'b', 'c', 'd', 'f', 'g'].filter(select), ['f']);
});

test('arguments preserve ONLY and full runs; reject invalid shards and partial timing updates', () => {
  assert.deepEqual(browserArgs(['5291']), { port: 5291, only: undefined, shard: undefined, updateTimings: false });
  assert.deepEqual(browserArgs(['5291', 'SHARD=2/4']).shard, { index: 2, count: 4 });
  assert.deepEqual(browserArgs(['--shard=3/4'], { TEST_PORT: '5292' }).shard, { index: 3, count: 4 });
  assert.deepEqual(browserArgs([], { SHARD: '1/4' }).shard, { index: 1, count: 4 });
  assert.equal(browserArgs(['5291', 'some regex'], { SHARD: 'bad' }).shard, undefined);
  assert.equal(browserArgs([], { ONLY: 'some regex', SHARD: '4/4' }).only, 'some regex');
  for (const SHARD of ['0/4', '5/4', '1/0', '-1/4', 'abc', '1/4/2']) assert.throws(() => browserArgs([], { SHARD }), /SHARD/);
  assert.equal(browserArgs(['5291', '--update-timings']).updateTimings, true);
  assert.throws(() => browserArgs(['--update-timings'], { SHARD: '1/4' }), /full/);
  assert.throws(() => browserArgs(['--update-timings'], { ONLY: 'some regex' }), /full/);
  assert.throws(() => browserArgs(['65536']), /port/);
  assert.throws(() => shardSelector({ a: -1, b: 1 }, 1, 2), /timing/);
  assert.throws(() => shardSelector({ a: 1 }, 1, 4), /enough/);
});

test('local runner launches four children together, prefixes failures and counts crashed children', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pd-browser-shards-'));
  try {
    writeFileSync(join(dir, 'browser.test.mjs'), `
      import assert from 'node:assert/strict';
      import { writeFileSync, readdirSync } from 'node:fs';
      const focused = process.env.ONLY || process.argv[3];
      assert.equal(!process.env.SHARD, Boolean(focused), 'a focused run is unsharded');
      const index = focused ? 1 : Number(process.env.SHARD.split('/')[0]);
      const count = focused ? 1 : 4;
      assert.equal(process.argv[2], String(5290 + index));
      assert.equal(process.env.TEST_PORT, process.argv[2]);
      writeFileSync('ready-' + index, '');
      const end = Date.now() + 5000;
      while (readdirSync('.').filter((name) => name.startsWith('ready-')).length < count) {
        assert.ok(Date.now() < end, 'all four shards must start concurrently');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (process.env.RUNNER_FAILURE && index === 4) process.exit(1);
      if (process.env.RUNNER_FAILURE && index === 2) {
        console.error('FAIL example'); console.log('2 failed'); process.exit(1);
      }
      console.log('all browser steps passed');
    `);
    // The last case is the pre-151 form: the regex as the 2nd argument.
    for (const [fail, only, arg] of [['', ''], ['1', ''], ['', 'focused step'], ['', '', 'focused step']]) {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./tools/browser-parallel.mjs', import.meta.url)), '5291', ...(arg ? [arg] : [])], {
        cwd: dir, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, TEST_PORT: '', RUNNER_FAILURE: fail, ONLY: only },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, fail ? 1 : 0, result.stdout + result.stderr);
      assert.equal(result.stdout.trim().split('\n').at(-1), fail ? '3 failed' : 'all browser steps passed');
      if (fail) assert.match(result.stdout, /\[shard 2\/4\] FAIL example/);
      for (const i of only || arg ? [1] : [1, 2, 3, 4]) rmSync(join(dir, `ready-${i}`));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
