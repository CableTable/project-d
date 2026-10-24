import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movePoint } from './web/move.js';

test('Move: absolute base, relative target, signed decimals and direct distance toward cursor', () => {
  assert.deepEqual(movePoint(' -2.5, +3 '), [-2.5, 3]);
  assert.deepEqual(movePoint('10,-5', [20, 30]), [30, 25]);
  assert.deepEqual(movePoint('25', [10, 20], [13, 24]), [25, 40]);
  assert.deepEqual(movePoint('5', [10, 20], [0, 20]), [5, 20]);
  assert.deepEqual(movePoint('5', [10, 20], [10, 0]), [10, 15]);
  for (const text of ['', '1,', ',2', '1,2,3', 'NaN,2', 'Infinity', '12mm', '1foo', '@1,2', '5<30']) {
    assert.equal(movePoint(text), null, text);
    assert.equal(movePoint(text, [0, 0], [3, 4]), null, text);
  }
  for (const text of ['0', '-5', '5']) assert.equal(movePoint(text), null);
  for (const text of ['0', '-5']) assert.equal(movePoint(text, [0, 0], [3, 4]), null);
  assert.equal(movePoint('5', [0, 0], [0, 0]), null, 'no direction yet');
  assert.equal(movePoint('5', [0, 0]), null);
  assert.equal(movePoint('9'.repeat(310) + ',0'), null, 'overflow');
});
