import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const compiler = spawnSync('rustc', ['--version'], { encoding: 'utf8' });
test('native launch arguments: skip executable and flags, keep multiple paths and resolve their launch directory', {
  skip: compiler.error?.code === 'ENOENT' ? 'rustc is unavailable' : false,
}, () => {
  assert.equal(compiler.status, 0, compiler.error?.message || compiler.stderr);
  const folder = mkdtempSync(join(tmpdir(), 'project-d-launch-'));
  const binary = join(folder, process.platform === 'win32' ? 'launch-tests.exe' : 'launch-tests');
  try {
    const built = spawnSync('rustc', ['--edition=2021', '--test', 'src-tauri/src/launch.rs', '-o', binary], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.error?.message || built.stderr);
    const ran = spawnSync(binary, [], { encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.error?.message || ran.stdout + ran.stderr);
  } finally {
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    rmSync(folder, { recursive: true, force: true });
  }
});
