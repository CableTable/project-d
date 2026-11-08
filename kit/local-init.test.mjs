// TODO 219e1: local-init in temp folders only (never the real hq.json or project folders).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Dynamic import: on a base without kit/local-init.mjs each test fails (red), not the whole file.
const mod = await import('./local-init.mjs').catch(() => null);
const localInit = (...a) => (mod ? mod.localInit(...a) : assert.fail('kit/local-init.mjs is missing'));

const ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...ID } }).stdout.trim();

// A temp D (kit/ with a file and a node_modules, rook.config.json, one commit), a temp WF with source files, and an hq.json.
function world(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'linit-')).replaceAll('\\', '/'), root = `${dir}/D`, wf = `${dir}/wf`;
  mkdirSync(`${root}/kit/node_modules`, { recursive: true });
  mkdirSync(`${wf}/build`, { recursive: true });
  mkdirSync(`${wf}/node_modules`);
  writeFileSync(`${root}/kit/a.txt`, 'kit file');
  writeFileSync(`${root}/kit/node_modules/x.js`, 'no');
  writeFileSync(`${root}/rook.config.json`, JSON.stringify({ support: `${dir}/support` }));
  writeFileSync(`${wf}/build-wfs.mjs`, 'process.exit(0);\n');
  writeFileSync(`${wf}/build/out.html`, 'built');
  writeFileSync(`${wf}/node_modules/y.js`, 'no');
  git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'D');
  const hqFile = `${dir}/hq.json`;
  writeFileSync(hqFile, JSON.stringify({ projects: { D: root, WF: wf }, runs: `${dir}/runs`, hq: `${dir}/hq`, kit: `${dir}/rook-kit`, ...extra }, null, 2).replace(/\n/g, '\r\n'));
  return { dir, root, wf, hqFile, kit: `${dir}/rook-kit`, run: (name, dry) => localInit({ name, hqFile, root, dry, log: () => {} }) };
}
const done = (w) => rmSync(w.dir, { recursive: true, force: true });

test('TODO 219e1: --dry prints the actions and changes nothing', () => {
  const w = world();
  try {
    const before = readFileSync(w.hqFile, 'utf8'), lines = [];
    const out = localInit({ name: 'KIT', hqFile: w.hqFile, root: w.root, dry: true, log: (m) => lines.push(m) });
    assert.deepEqual(out.map((m) => m.split(' ')[0]), ['git', 'copy', 'write', 'write', 'write', 'git', 'write']);
    assert.ok(lines.every((m) => m.startsWith('would ')), lines.join('|'));
    assert.equal(existsSync(w.kit), false);
    localInit({ name: 'WF', hqFile: w.hqFile, root: w.root, dry: true, log: () => {} });
    assert.equal(existsSync(`${w.wf}/.git`), false);
    assert.equal(existsSync(`${w.wf}/rook.config.json`), false);
    assert.equal(readFileSync(w.hqFile, 'utf8'), before);
  } finally { done(w); }
});

test('TODO 219e1: KIT copies kit/ (no node_modules), writes its config, one commit names D\'s HEAD, hq.json gets "kit" and projects.KIT; a second run changes nothing', () => {
  const w = world();
  try {
    w.run('KIT');
    assert.equal(readFileSync(`${w.kit}/a.txt`, 'utf8'), 'kit file');
    assert.equal(existsSync(`${w.kit}/node_modules`), false);
    const cfg = JSON.parse(readFileSync(`${w.kit}/rook.config.json`, 'utf8'));
    for (const key of ['name', 'slug', 'extras', 'main', 'support', 'github', 'folders']) assert.ok(cfg[key], key);
    assert.deepEqual([cfg.main, cfg.support, cfg.test], [w.kit, `${w.dir}/support`, 'npm test']);
    assert.equal(JSON.parse(readFileSync(`${w.kit}/package.json`, 'utf8')).scripts.test, 'node test.mjs');
    assert.match(readFileSync(`${w.kit}/.gitignore`, 'utf8'), /node_modules/);
    assert.deepEqual(git(w.kit, 'log', '--format=%s').split('\n'), [`local-init KIT: copy of Project D kit/ at ${git(w.root, 'rev-parse', 'HEAD')}`]);
    assert.equal(git(w.kit, 'status', '--porcelain'), '');
    const hqText = readFileSync(w.hqFile, 'utf8'), hq = JSON.parse(hqText);
    assert.deepEqual([hq.kit, hq.projects.KIT, hq.projects.WF], [w.kit, w.kit, w.wf]);
    assert.ok(hqText.includes('\r\n') && !/[^\r]\n/.test(hqText), 'hq.json keeps CRLF');
    const again = w.run('KIT');
    assert.deepEqual(again, [`same ${w.kit}: already local-init'ed`]);
    assert.equal(git(w.kit, 'rev-list', '--count', 'HEAD'), '1');
    assert.equal(readFileSync(w.hqFile, 'utf8'), hqText);
  } finally { done(w); }
});

test('TODO 219e1: WF gets git init, .gitignore, rook.config.json (test node build-wfs.mjs) and one commit; no source file changes; a second run changes nothing', () => {
  const w = world();
  try {
    const src = readFileSync(`${w.wf}/build-wfs.mjs`, 'utf8'), hqText = readFileSync(w.hqFile, 'utf8');
    w.run('WF');
    assert.equal(readFileSync(`${w.wf}/build-wfs.mjs`, 'utf8'), src);
    assert.equal(JSON.parse(readFileSync(`${w.wf}/rook.config.json`, 'utf8')).test, 'node build-wfs.mjs');
    assert.equal(readFileSync(`${w.wf}/.gitignore`, 'utf8'), 'node_modules\nbuild\npreviews\n');
    assert.deepEqual(git(w.wf, 'ls-files').split('\n').sort(), ['.gitignore', 'build-wfs.mjs', 'rook.config.json']);
    assert.equal(git(w.wf, 'rev-list', '--count', 'HEAD'), '1');
    assert.equal(readFileSync(w.hqFile, 'utf8'), hqText); // WF is in hq.json already
    assert.deepEqual(w.run('WF').length, 1);
    assert.equal(git(w.wf, 'rev-list', '--count', 'HEAD'), '1');
  } finally { done(w); }
});

test('TODO 219e1: a target whose .git has other commits is refused untouched, as is a non-empty KIT folder without .git and an unknown name; an existing file is kept', () => {
  const w = world();
  try {
    git(w.wf, 'init', '-q'); git(w.wf, 'add', 'build-wfs.mjs'); git(w.wf, 'commit', '-q', '-m', 'mine');
    assert.throws(() => w.run('WF'), /already has git commits that local-init did not make/);
    assert.equal(existsSync(`${w.wf}/rook.config.json`), false);
    assert.equal(git(w.wf, 'rev-list', '--count', 'HEAD'), '1');
    assert.throws(() => w.run('WF', true), /refused/); // also in --dry
    mkdirSync(w.kit); writeFileSync(`${w.kit}/mine.txt`, 'x');
    assert.throws(() => w.run('KIT'), /not empty and has no \.git/);
    assert.equal(existsSync(`${w.kit}/.git`), false);
    assert.throws(() => w.run('R'), /takes KIT or WF/);
    rmSync(`${w.wf}/.git`, { recursive: true, force: true });
    writeFileSync(`${w.wf}/.gitignore`, 'mine\n');
    w.run('WF');
    assert.equal(readFileSync(`${w.wf}/.gitignore`, 'utf8'), 'mine\n');
  } finally { done(w); }
});

test('TODO 219e1: `rook.mjs local-init KIT --dry` is wired up (real child process, temp hq.json); a bad name is one line, exit 1', () => {
  const w = world();
  try {
    const rook = fileURLToPath(new URL('./rook.mjs', import.meta.url)), env = { ...process.env, ROOK_HQ: w.hqFile };
    const r = spawnSync(process.execPath, [rook, 'local-init', 'KIT', '--dry'], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^would git init /);
    assert.equal(existsSync(w.kit), false);
    const bad = spawnSync(process.execPath, [rook, 'local-init', 'R'], { encoding: 'utf8', env });
    assert.deepEqual([bad.status, bad.stderr.trim()], [1, 'local-init takes KIT or WF']);
  } finally { done(w); }
});
