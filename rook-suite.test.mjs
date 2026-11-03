import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

// Exercise the detached script's decisions without starting either suite.
const source = readFileSync(new URL('./tools/rook-suite.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?$/gm, '');

test('TODO 185b: rook-suite runs unit then browser, reports both codes, and fails if either is red; TODO 193a: a red unit run skips the browser run and says so', () => {
  for (const [unit, browser, code] of [[0, 0, 0], [1, 0, 1], [0, 2, 1], [1, 2, 1]]) {
    const calls = [], lines = [], process = {};
    runInNewContext(source, {
      spawnSync(command, options) {
        calls.push([command, { ...options }]);
        return { status: calls.length === 1 ? unit : browser };
      },
      console: { log(line) { lines.push(line); } },
      process,
    });
    assert.deepEqual(calls, [
      ['npm.cmd test', { stdio: 'inherit', shell: true }], // one string: no DEP0190 warning
      ...(unit ? [] : [['npm.cmd run test:browser', { stdio: 'inherit', shell: true }]]),
    ]);
    assert.deepEqual(lines, [`SUITE unit=${unit} browser=${unit ? 'skipped' : browser}`]);
    assert.equal(process.exitCode, code);
  }
});
