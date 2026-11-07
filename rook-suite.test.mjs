import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

// Exercise the detached script's decisions without starting either suite.
const source = readFileSync(new URL('./tools/rook-suite.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?$/gm, '');

test('TODO 185b: rook-suite runs unit then browser, reports both codes, and fails if either is red; TODO 193a: a red unit run skips the browser run and says so', () => {
  for (const [unit, browser, code] of [[0, 0, 0], [1, 0, 1], [0, 2, 1], [1, 2, 1]]) {
    const { calls, lines, process } = suiteRun({ unit, browser });
    assert.deepEqual(calls, [
      ['npm.cmd test', { stdio: 'inherit', shell: true, env: { TEST_PORT: '15181' } }], // one string: no DEP0190 warning
      ...(unit ? [] : [['npm.cmd run test:browser', { stdio: 'inherit', shell: true, env: { TEST_PORT: '15181' } }]]),
    ]);
    assert.deepEqual(lines, [`SUITE unit=${unit} browser=${unit ? 'skipped' : browser}`]);
    assert.equal(process.exitCode, code);
  }
});

// Runs the script with fake npm / git: `heads` = what `git rev-parse HEAD` prints on its 1st and 2nd call.
function suiteRun({ unit = 0, browser = 0, heads = ['aaa', 'aaa'], env = {} }) {
  const calls = [], lines = [], process = { env };
  let n = 0;
  runInNewContext(source, {
    spawnSync(command, options) {
      if (command.startsWith('git ')) return { stdout: heads[n++] + '\n' };
      calls.push([command, { ...options, env: options.env && { TEST_PORT: options.env.TEST_PORT } }]);
      return { status: calls.length === 1 ? unit : browser };
    },
    console: { log(line) { lines.push(line); } },
    process,
  });
  return { calls, lines, process };
}

test('TODO 207a: a HEAD that moved during the runs prints SUITE INVALID before the SUITE line and exits 1', () => {
  const moved = suiteRun({ heads: ['aaa111', 'bbb222'] });
  assert.deepEqual(moved.lines, ['SUITE INVALID head aaa111 -> bbb222', 'SUITE unit=0 browser=0']);
  assert.equal(moved.process.exitCode, 1);
  assert.deepEqual(suiteRun({}).lines, ['SUITE unit=0 browser=0']);
});

test('TODO 207a: both npm runs get TEST_PORT 15181 unless the environment already has one', () => {
  assert.deepEqual(suiteRun({ env: { TEST_PORT: '6000' } }).calls.map((c) => c[1].env.TEST_PORT), ['6000', '6000']);
  assert.deepEqual(suiteRun({}).calls.map((c) => c[1].env.TEST_PORT), ['15181', '15181']);
});
