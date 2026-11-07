import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, kitCommand, kitDir, kitFile } from './tools/kit.mjs';

test('TODO 219c: the kit folder is hq.json "kit" when set, else <repo>/kit; kit.mjs hands the project its checkout', () => {
  assert.equal(kitDir({ kit: 'E:/rook-kit' }, '/r'), 'E:/rook-kit');
  assert.equal(kitDir({}, '/r'), join('/r', 'kit'));
  assert.equal(kitDir(null, '/r'), join('/r', 'kit'));
  assert.equal(process.env.ROOK_ROOT, ROOT);
  assert.deepEqual(kitCommand('base-check.mjs', ['a', 'b c']), [process.execPath, [kitFile('base-check.mjs'), 'a', 'b c']]);
  assert.deepEqual(kitCommand('ci-watch.sh', ['abc']), ['bash', [kitFile('ci-watch.sh'), 'abc']]);
  // the real module, with a registry that has no "kit" and one that has: the default and the set folder
  const w = fakeKit();
  try {
    writeFileSync(`${w.dir}/none.json`, JSON.stringify({ projects: {} }));
    const probe = (hq) => JSON.parse(spawnSync(process.execPath, ['--input-type=module', '--eval', `import { KIT, ROOT } from './tools/kit.mjs'; process.stdout.write(JSON.stringify([KIT, ROOT]));`], { encoding: 'utf8', env: { ...process.env, ROOK_HQ: hq } }).stdout);
    const [def, root] = probe(`${w.dir}/none.json`);
    assert.equal(def, join(root, 'kit'));
    assert.equal(probe(w.hq)[0].replaceAll('\\', '/'), `${w.dir}/the-kit`);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

// A kit folder elsewhere (hq.json "kit") whose files only print their argument list and exit with a chosen code.
function fakeKit() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-')).replaceAll('\\', '/'), kit = `${dir}/the-kit`;
  mkdirSync(kit);
  for (const [file, code] of [['rook.mjs', 3], ['base-check.mjs', 4]]) writeFileSync(`${kit}/${file}`, `process.stdout.write(JSON.stringify([process.env.ROOK_ROOT, ...process.argv.slice(2)])); process.exit(${code});`);
  writeFileSync(`${dir}/hq.json`, JSON.stringify({ projects: {}, kit }));
  return { dir, hq: `${dir}/hq.json` };
}

test('TODO 219c: a shim runs the kit file from hq.json "kit" with the same argument list and exit code (spaces, flags, --project kept)', () => {
  const w = fakeKit();
  try {
    const args = ['review', 'abc 123', '--as', 'king', '--project', 'R', '--ci', ''];
    for (const [shim, code] of [['tools/rook.mjs', 3], ['tools/base-check.mjs', 4]]) {
      const r = spawnSync(process.execPath, [shim, ...args], { encoding: 'utf8', env: { ...process.env, ROOK_HQ: w.hq } });
      assert.equal(r.status, code, shim);
      assert.deepEqual(JSON.parse(r.stdout), [ROOT, ...args], shim);
    }
    const direct = spawnSync(process.execPath, ['tools/kit.mjs', 'rook.mjs', ...args], { encoding: 'utf8', env: { ...process.env, ROOK_HQ: w.hq } });
    assert.deepEqual([direct.status, JSON.parse(direct.stdout)], [3, [ROOT, ...args]]);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test('TODO 219c: the shim and the kit file print the same usage line and give the same exit code', () => {
  const via = spawnSync(process.execPath, ['tools/rook.mjs', 'nonsense'], { encoding: 'utf8' });
  const own = spawnSync(process.execPath, [kitFile('rook.mjs'), 'nonsense'], { encoding: 'utf8' });
  assert.match(own.stdout, /^usage: node tools\/rook\.mjs usage/);
  assert.deepEqual([via.status, via.stdout], [own.status, own.stdout]);
});
