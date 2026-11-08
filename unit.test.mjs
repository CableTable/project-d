import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { kitTests, unitFiles } from './tools/unit.mjs';
import * as unit from './tools/unit.mjs';

test('TODO 196a: unit.mjs --skip leaves the named files out; an unknown name or a bad flag is an error', () => {
  const all = ['a.test.mjs', 'b.test.mjs', 'c.test.mjs'];
  assert.deepEqual(unitFiles(all, []), all);
  assert.deepEqual(unitFiles(all, ['--skip', 'b.test.mjs']), ['a.test.mjs', 'c.test.mjs']);
  assert.deepEqual(unitFiles(all, ['--skip', 'a.test.mjs', '--skip', 'c.test.mjs']), ['b.test.mjs']);
  assert.throws(() => unitFiles(all, ['--skip', 'nope.test.mjs']), /--skip: no unit file named nope\.test\.mjs/);
  assert.throws(() => unitFiles(all, ['--skip']), /usage/);
  assert.throws(() => unitFiles(all, ['--bogus', 'a.test.mjs']), /usage/);
  const r = spawnSync(process.execPath, ['tools/unit.mjs', '--skip', 'nope.test.mjs'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no unit file named nope\.test\.mjs/);
});

test('TODO 219p: no args runs the plugin after node tests, preserves failures, and skips only a missing claude', (t) => {
  assert.equal(typeof unit.runUnitTests, 'function');
  const calls = [];
  const log = t.mock.method(console, 'log', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const check = (argv, node, plugin, expected) => {
    calls.length = 0;
    const run = (...args) => { calls.push(args); return calls.length === 1 ? node : plugin; };
    assert.equal(unit.runUnitTests(['a.test.mjs'], argv, run), expected);
    assert.deepEqual(calls, [
      [process.execPath, ['--test', '--test-timeout=120000', 'a.test.mjs'], { stdio: 'inherit' }],
      ...(!argv.length ? [['claude', ['plugin', 'test', 'tools/pd-runs'], { stdio: 'inherit' }]] : []),
    ]);
  };
  check([], { status: 0 }, { status: 0 }, 0);
  check([], { status: 0 }, { status: 7 }, 7);
  check([], { status: 3 }, { status: 0 }, 3);
  check([], { status: 3 }, { status: 7 }, 3);
  check([], { status: null }, { status: 0 }, 1);
  check([], { status: 0 }, { status: null }, 1);
  const missing = { status: null, error: { code: 'ENOENT' } };
  check([], { status: 0 }, missing, 0);
  assert.deepEqual(log.mock.calls.map(c => c.arguments), [['skipped: pd-runs plugin test (no claude)']]);
  check([], { status: 3 }, missing, 3);
  check([], { status: 0 }, { status: null, error: { code: 'EACCES', message: 'denied' } }, 1);
  assert.deepEqual(error.mock.calls.map(c => c.arguments), [['denied']]);
  check(['--skip', 'base-check.test.mjs'], { status: 0 }, null, 0);
  check(['--skip', 'base-check.test.mjs'], { status: 5 }, null, 5);
});

test('TODO 219c: the kit\'s tests run while kit/ is inside the repo and are left out once hq.json "kit" points outside it; --skip names a kit file by its plain name', () => {
  const list = () => ['a.test.mjs', 'a.mjs', 'b.test.mjs'];
  assert.deepEqual(kitTests('/repo', '/repo/kit', list), ['kit/a.test.mjs', 'kit/b.test.mjs']);
  assert.deepEqual(kitTests('/repo', '/other/rook-kit', list), []);
  assert.deepEqual(kitTests('/repo', '/repo', list), []);
  assert.deepEqual(kitTests('/no-such-repo', '/no-such-repo/kit'), []); // kit/ removed and "kit" unset: no tests, no crash
  const all = ['x.test.mjs', 'kit/a.test.mjs', 'kit/b.test.mjs'];
  assert.deepEqual(unitFiles(all, ['--skip', 'a.test.mjs']), ['x.test.mjs', 'kit/b.test.mjs']);
  assert.deepEqual(unitFiles(all, ['--skip', 'kit/b.test.mjs']), ['x.test.mjs', 'kit/a.test.mjs']);
  assert.throws(() => unitFiles(all, ['--skip', 'c.test.mjs']), /no unit file named c\.test\.mjs/);
});
