import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { project, winCmd } from './tools/project.mjs';

// Run the CLI with fake stdin, git and npm; no live hook or test subprocesses.
const source = readFileSync(new URL('./tools/stop-hook.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?$/gm, '');
const STATUS = 'git status --porcelain -- web tools package.json';
const LOG = 'git log HEAD --not --remotes --name-only --format= -- web tools package.json';

function run({ input = '{}', dir = 'C:/Users/raksh/.claude-account3', status = '', log = '', red, rook = () => '' } = {}) {
  const calls = [], stopped = {}, result = { code: 0, stderr: '', calls };
  try {
    runInNewContext(source, {
      project, winCmd, // the script's own import lines are stripped above
      rookStop(i, deps) { assert.equal(typeof deps.read, 'function'); assert.equal(typeof deps.exists, 'function'); assert.equal(typeof deps.git, 'function'); return rook(i); },
      execFileSync() { throw new Error('unused'); },
      existsSync() { return false; },
      readFileSync(fd, encoding) { assert.equal(fd, 0); assert.equal(encoding, 'utf8'); return input; },
      execSync(command, options) {
        calls.push([command, { ...options, ...(Array.isArray(options.stdio) ? { stdio: [...options.stdio] } : {}) }]);
        if (command === 'npm.cmd test') { if (red) throw red; return ''; }
        assert.ok([STATUS, LOG].includes(command), command);
        const value = command === STATUS ? status : log;
        if (value instanceof Error) throw value;
        return value;
      },
      process: {
        env: { CLAUDE_CONFIG_DIR: dir },
        exit(code) { result.code = code; throw stopped; },
        stderr: { write(text) { result.stderr += text; } },
      },
    });
  } catch (e) { if (e !== stopped) throw e; }
  return result;
}

test('TODO 185b: stop-hook lets a repeated stop, Rook and unchanged reviewers finish without npm', () => {
  for (const options of [
    { input: '{"stop_hook_active":true}' },
    { dir: 'C:/Users/raksh/.claude' },
    { dir: '' },
  ]) assert.deepEqual(run(options), { code: 0, stderr: '', calls: [] });
  const r = run();
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.deepEqual(r.calls.map(([command]) => command), [STATUS, LOG]);
});

test('TODO 185b: stop-hook checks uncommitted or unpushed changes on both builder accounts, including failed git and invalid stdin', () => {
  for (const [dir, options, commands] of [
    ['account2', { status: ' M web/app.js\n' }, [STATUS, 'npm.cmd test']],
    ['account3', { log: 'tools/rook.mjs\n' }, [STATUS, LOG, 'npm.cmd test']],
    ['account3', { status: new Error('git failed') }, [STATUS, 'npm.cmd test']],
    ['account2', { log: new Error('git failed'), input: 'not json' }, [STATUS, LOG, 'npm.cmd test']],
    ['account2', { status: 'M package.json', input: '' }, [STATUS, 'npm.cmd test']],
  ]) {
    const r = run({ ...options, dir });
    assert.equal(r.code, 0);
    assert.equal(r.stderr, '');
    assert.deepEqual(r.calls.map(([command]) => command), commands);
    assert.deepEqual(r.calls.at(-1)[1], { stdio: 'pipe', encoding: 'utf8' });
  }
});

test('TODO 190a: stop-hook runs the Rook checks on the main account only: their text blocks with exit 2, never reaching npm or git', () => {
  for (const dir of ['C:/Users/raksh/.claude', '']) {
    const r = run({ dir, rook: (i) => `Handover written for ${i.session_id}`, input: '{"session_id":"s1"}' });
    assert.deepEqual([r.code, r.stderr, r.calls], [2, 'Handover written for s1\n', []]);
  }
  for (const dir of ['account2', 'account3']) assert.equal(run({ dir, rook: () => 'must not run' }).code, 0);
  assert.equal(run({ dir: '', input: '{"stop_hook_active":true}', rook: () => 'must not run' }).code, 0);
});

test('TODO 185b: stop-hook blocks red npm with exit 2 and only the last 40 output lines', () => {
  const stdout = Array.from({ length: 45 }, (_, i) => `line ${i}`).join('\n');
  const r = run({ status: 'M tools/rook.mjs', red: { stdout, stderr: '\nFAIL sentinel' } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^npm test is red/);
  assert.doesNotMatch(r.stderr, /\nline 5\n/);
  assert.ok(r.stderr.endsWith(`${Array.from({ length: 39 }, (_, i) => `line ${i + 6}`).join('\n')}\nFAIL sentinel\n`));
  assert.equal(run({ status: 'M web/app.js', red: new Error('npm failed') }).code, 2);
});
