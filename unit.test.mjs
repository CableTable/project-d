import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { kitTests, unitFiles } from './tools/unit.mjs';

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
