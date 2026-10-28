import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movePoint, movePrompt } from './web/move.js';

test('Move / Copy prompts expose only their supported options and remembered mode', () => {
  assert.equal(movePrompt('copy', 'p1', 'Multiple'), 'Specify base point or [Displacement/mOde] <Displacement>:');
  assert.equal(movePrompt('move', 'p1'), 'Specify base point or [Displacement] <Displacement>:');
  for (const mode of ['Single', 'Multiple']) {
    assert.equal(movePrompt('copy', 'mode', mode), `Enter a copy mode option [Single/Multiple] <${mode}>:`);
  }
  for (const kind of ['move', 'copy']) {
    assert.equal(movePrompt(kind, 'displacement'), 'Specify displacement <0,0>:');
    assert.equal(movePrompt(kind, 'p2'), 'Specify second point or <use first point as displacement>:');
    assert.match(movePrompt(kind, 'pick'), /^Select objects/);
  }
});

test('Move: absolute base, relative target, signed decimals and direct distance toward cursor', () => {
  assert.deepEqual(movePoint(' -2.5, +3 '), [-2.5, 3]);
  assert.deepEqual(movePoint('10,-5', [20, 30]), [30, 25]);
  assert.deepEqual(movePoint('25', [10, 20], [13, 24]), [25, 40]);
  assert.deepEqual(movePoint('5', [10, 20], [0, 20]), [5, 20]);
  assert.deepEqual(movePoint('5', [10, 20], [10, 0]), [10, 15]);
  for (const text of ['', '1,', ',2', '1,2,3', 'NaN,2', 'Infinity', '12mm', '1foo']) {
    assert.equal(movePoint(text), null, text);
    assert.equal(movePoint(text, [0, 0], [3, 4]), null, text);
  }
  for (const text of ['0', '-5', '5']) assert.equal(movePoint(text), null);
  for (const text of ['0', '-5']) assert.equal(movePoint(text, [0, 0], [3, 4]), null);
  assert.equal(movePoint('5', [0, 0], [0, 0]), null, 'no direction yet');
  assert.equal(movePoint('5', [0, 0]), null);
  assert.equal(movePoint('9'.repeat(310) + ',0'), null, 'overflow');
});

test('Move / Copy reuse typed points: relative Cartesian and polar, absolute polar, last target', () => {
  assert.deepEqual(movePoint('@1,2'), [1, 2]);
  assert.deepEqual(movePoint('@1,2', [20, 30]), [21, 32]);
  assert.deepEqual(movePoint('@1,2', [20, 30], null, [40, 50]), [41, 52]);
  assert.deepEqual(movePoint('1,2', [20, 30], null, [40, 50]), [21, 32], 'bare pair retains base displacement');
  const near = (actual, expected) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9));
  near(movePoint('10<90', [20, 30]), [0, 10]);
  near(movePoint('@10<90', [20, 30]), [20, 40]);
  near(movePoint('@10<90', [20, 30], null, [40, 50]), [40, 60]);
  near(movePoint('@10<-90'), [0, -10]);
});
