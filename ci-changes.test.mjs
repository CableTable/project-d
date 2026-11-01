import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { codeChanged } from './tools/ci-changes.mjs';

const run = (name, conclusion) => ({ name, conclusion });
const GREEN = [run('changes', 'success'), run('build', 'skipped'), run('test (1)', 'skipped'), run('test (2)', 'success'), run('merge', 'skipped')];
const DOCS = ['TODO.md', 'docs/a.md'];
const CONCLUSIONS = ['success', 'skipped', 'failure', 'cancelled', 'neutral', 'timed_out', 'action_required', null];

test('ci-changes: .md-only after an all-green run skips (false)', () => {
  assert.equal(codeChanged(DOCS, GREEN), false);
});

test('ci-changes: every conclusion x job name; only success counts for changes, success or skipped for build and test*', () => {
  for (const name of ['changes', 'build', 'test', 'test (1)', 'merge', 'other']) {
    for (const c of CONCLUSIONS) {
      const others = GREEN.filter((r) => r.name !== name && !(name.startsWith('test') && r.name.startsWith('test')));
      // the run under test replaces its own kind; the rest stay green (changes + a build or test run must exist)
      const runs = [...others, run(name, c)];
      if (name === 'changes') runs.push(run('build', 'success'));
      else if (name === 'build' || name.startsWith('test')) runs.push(run('changes', 'success'));
      const ok = name === 'changes' ? c === 'success' : name === 'build' || name.startsWith('test') ? c === 'success' || c === 'skipped' : true;
      const hasKind = runs.some((r) => r.name === 'build' || r.name.startsWith('test'));
      assert.equal(codeChanged(DOCS, runs), !(ok && hasKind), `${name} ${c}`);
    }
  }
});

test('ci-changes: a missing changes run, or no build / test run, keeps code=true', () => {
  assert.equal(codeChanged(DOCS, [run('build', 'success'), run('test', 'success')]), true);
  assert.equal(codeChanged(DOCS, [run('changes', 'success'), run('merge', 'success')]), true);
  assert.equal(codeChanged(DOCS, []), true);
});

test('ci-changes: one red run among green ones keeps code=true', () => {
  assert.equal(codeChanged(DOCS, [...GREEN, run('test (3)', 'failure')]), true);
  assert.equal(codeChanged(DOCS, [...GREEN, run('changes', 'failure')]), true);
});

test('ci-changes: files — empty list, failed diff (?), null, mixed, renames as two names', () => {
  assert.equal(codeChanged([], GREEN), true);
  assert.equal(codeChanged(['?'], GREEN), true);
  assert.equal(codeChanged(null, GREEN), true);
  assert.equal(codeChanged(['a.md', 'web/app.js'], GREEN), true);
  assert.equal(codeChanged(['a.md', 'b.md'], GREEN), false); // rename a.md -> b.md under --no-renames
  assert.equal(codeChanged(['a.md', 'a.js'], GREEN), true); // rename a.md -> a.js
  assert.equal(codeChanged(['a.mdx', 'README.MD'], GREEN), true);
});

test('ci-changes: an API error (null check runs) keeps code=true', () => {
  assert.equal(codeChanged(DOCS, null), true);
});

test('ci-changes CLI prints true / false and true on any error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cich-'));
  try {
    const cli = (files, runs) => spawnSync(process.execPath, ['tools/ci-changes.mjs', join(dir, files), join(dir, runs)], { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '1' } }).stdout; // colour on must not leak ANSI codes into code=
    writeFileSync(join(dir, 'docs.txt'), 'TODO.md\r\nHISTORY.md\r\n');
    writeFileSync(join(dir, 'code.txt'), 'TODO.md\nweb/app.js\n');
    writeFileSync(join(dir, 'runs.json'), JSON.stringify({ check_runs: GREEN }));
    writeFileSync(join(dir, 'bad.json'), 'not json');
    assert.equal(cli('docs.txt', 'runs.json'), 'false\n');
    assert.equal(cli('code.txt', 'runs.json'), 'true\n');
    assert.equal(cli('docs.txt', 'bad.json'), 'true\n');
    assert.equal(cli('docs.txt', 'missing.json'), 'true\n');
    assert.equal(cli('missing.txt', 'runs.json'), 'true\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
