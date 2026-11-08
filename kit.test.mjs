import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { KIT, ROOT, kitCommand, kitDir, kitFile } from './tools/kit.mjs';

test('TODO 219c: the kit folder is hq.json "kit" when set, else <repo>/kit; kit.mjs hands the project its checkout', () => {
  assert.equal(kitDir({ kit: 'E:/rook-kit' }, '/r', () => true), 'E:/rook-kit');
  assert.equal(kitDir({}, '/r'), join('/r', 'kit'));
  assert.equal(kitDir(null, '/r'), join('/r', 'kit'));
  assert.equal(kitDir({ kit: 'E:/rook-kit' }, '/r', () => false), join('/r', 'kit')); // TODO 219e1: "kit" naming a folder that is not there falls back to <repo>/kit
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
    writeFileSync(`${w.dir}/gone.json`, JSON.stringify({ projects: {}, kit: `${w.dir}/no-such-kit` }));
    assert.equal(probe(`${w.dir}/gone.json`)[0], join(root, 'kit')); // TODO 219e1
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

// A kit folder elsewhere (hq.json "kit") whose files only print their argument list and exit with a chosen code.
function fakeKit() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-')).replaceAll('\\', '/'), kit = `${dir}/the-kit`;
  mkdirSync(kit);
  for (const [file, code] of [['rook.mjs', 3], ['base-check.mjs', 4]]) writeFileSync(`${kit}/${file}`, `process.stdout.write(JSON.stringify([process.env.ROOK_ROOT, ...process.argv.slice(2)])); process.exit(${code});`);
  for (const file of ['fg-hook.mjs', 'stop-hook.mjs']) writeFileSync(`${kit}/${file}`, `import { readFileSync } from 'node:fs'; process.stdout.write(readFileSync(0, 'utf8')); process.exit(2);`); // a hook that blocks, echoing its stdin
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

test('TODO 219c2: the hook shims pass stdin and the exit code on; a missing kit folder is one stderr line, exit 0 for a hook, exit 1 for the rest', () => {
  const w = fakeKit();
  try {
    for (const shim of ['tools/fg-hook.mjs', 'tools/stop-hook.mjs']) {
      const r = spawnSync(process.execPath, [shim], { input: '{"tool_name":"Bash"}', encoding: 'utf8', env: { ...process.env, ROOK_HQ: w.hq } });
      assert.deepEqual([r.status, r.stdout], [2, '{"tool_name":"Bash"}'], shim);
    }
    writeFileSync(`${w.dir}/gone.json`, JSON.stringify({ projects: {}, kit: `${w.dir}/no-such-kit` }));
    mkdirSync(`${w.dir}/tools`); // TODO 219e1: a "kit" that is not there falls back to <repo>/kit, so the missing kit is shown in a repo copy that has none
    for (const f of ['kit', 'fg-hook', 'stop-hook', 'rook', 'base-check']) copyFileSync(`tools/${f}.mjs`, `${w.dir}/tools/${f}.mjs`);
    for (const [shim, code] of [['tools/fg-hook.mjs', 0], ['tools/stop-hook.mjs', 0], ['tools/rook.mjs', 1], ['tools/base-check.mjs', 1]]) {
      const r = spawnSync(process.execPath, [shim, 'x'], { input: '{}', encoding: 'utf8', cwd: w.dir, env: { ...process.env, ROOK_HQ: `${w.dir}/gone.json` } });
      assert.equal(r.status, code, shim);
      assert.equal(r.stdout, '', shim);
      assert.equal(r.stderr.trim().split('\n').length, 1, `${shim}: ${r.stderr}`);
    }
    assert.deepEqual(kitCommand('ci-watch.sh', ['abc'], 'C:/Git/bin/bash.exe'), ['C:/Git/bin/bash.exe', [kitFile('ci-watch.sh'), 'abc']]);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

// A nested node --test run: no NODE_TEST_CONTEXT (inside a node --test run the inner one would report success whatever it found), no FORCE_COLOR (it colours the count line), NO_COLOR set.
// The count line is "ℹ pass N" (spec reporter, a TTY or Node 23+) or "# pass N" (TAP, CI without a TTY): both are read.
const nested = (args, opts) => {
  const { NODE_TEST_CONTEXT, FORCE_COLOR, ...env } = process.env;
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts, env: { ...env, NO_COLOR: '1', ...opts.env } });
  assert.equal(r.status, 0, (r.stdout + r.stderr).split('\n').filter((l) => /✖|^not ok|^(ℹ|#) (tests|pass|fail)|Error/.test(l)).join('\n'));
  assert.match(r.stdout, /^(ℹ|#) pass [1-9]/m);
  assert.match(r.stdout, /^(ℹ|#) fail 0$/m);
};

// The D tests need no kit folder: the unit set (but this file, which would run itself) passes with hq.json "kit" naming a folder outside the repo (TODO 219e1: one that exists; a missing one falls back to kit/).
test('TODO 219c2: the unit set passes when hq.json "kit" is a folder outside the repo', { timeout: 900_000 }, () => {
  const w = fakeKit();
  try {
    nested(['tools/unit.mjs', '--skip', 'kit.test.mjs'], { env: { ROOK_HQ: w.hq } });
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

// kit/ hidden for real: a copy of the tracked files without kit/ (and hq.json "kit" naming a missing folder), node_modules linked.
test('TODO 219c fix: the unit set passes in a copy of the repo that has no kit/ and hq.json "kit" set to a missing folder', { timeout: 900_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'nokit-'));
  try {
    const files = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout.split('\0').filter((f) => f && !f.startsWith('kit/') && existsSync(f));
    for (const f of files) { mkdirSync(dirname(join(dir, f)), { recursive: true }); copyFileSync(f, join(dir, f)); }
    writeFileSync(join(dir, 'hq.json'), JSON.stringify({ ...JSON.parse(readFileSync('hq.json', 'utf8')), kit: join(dir, 'no-rook-kit') }));
    for (const args of [['init', '-q'], ['add', '-A']]) assert.equal(spawnSync('git', args, { cwd: dir }).status, 0, args[0]); // a few unit tests read the tracked files
    symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'junction');
    assert.equal(existsSync(join(dir, 'kit')), false);
    nested(['tools/unit.mjs', '--skip', 'kit.test.mjs'], { cwd: dir });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The kit is a folder of its own: a copy outside the repo runs all its tests (it finds its files from its own folder, the project from ROOK_ROOT).
test('TODO 219c fix: the kit folder copied to a folder outside the repo passes its own test.mjs with ROOK_ROOT set to the repo', { timeout: 900_000, skip: !existsSync(KIT) && 'no kit folder here' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'kitcopy-'));
  try {
    cpSync(KIT, join(dir, 'kit'), { recursive: true });
    nested(['test.mjs'], { cwd: join(dir, 'kit'), env: { ROOK_ROOT: ROOT } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
