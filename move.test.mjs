import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movePoint, movePrompt, parseArrayCount, arrayOffsets } from './web/move.js';

test('Stretch shares Move point prompts and remembers its displacement with four decimals', () => {
  assert.equal(movePrompt('stretch', 'pick'), 'Select objects:');
  assert.equal(movePrompt('stretch', 'p1'), 'Specify base point or [Displacement] <Displacement>:');
  assert.equal(movePrompt('stretch', 'p2'), 'Specify second point or <use first point as displacement>:');
  assert.equal(movePrompt('stretch', 'displacement'), 'Specify displacement <0.0000, 0.0000>:');
  assert.equal(movePrompt('stretch', 'displacement', null, [10, -5]), 'Specify displacement <10.0000, -5.0000>:');
});

test('Move / Copy prompts expose only their supported options and remembered mode', () => {
  assert.equal(movePrompt('copy', 'p1', 'Multiple'), 'Specify base point or [Displacement/mOde] <Displacement>:');
  assert.equal(movePrompt('move', 'p1'), 'Specify base point or [Displacement] <Displacement>:');
  for (const mode of ['Single', 'Multiple']) {
    assert.equal(movePrompt('copy', 'mode', mode), `Enter a copy mode option [Single/Multiple] <${mode}>:`);
  }
  for (const kind of ['move', 'copy']) {
    assert.equal(movePrompt(kind, 'displacement'), 'Specify displacement <0,0>:');
    assert.equal(movePrompt(kind, 'p2'), kind === 'copy' ? 'Specify second point or [Array] <use first point as displacement>:' : 'Specify second point or <use first point as displacement>:');
    assert.match(movePrompt(kind, 'pick'), /^Select objects/);
  }
});

test('Copy Array prompts: count, Fit, and Array / Exit / Undo after a placement (155n)', () => {
  assert.equal(movePrompt('copy', 'count', 'Multiple', [0, 0], { count: 4 }), 'Enter number of items to array <4>:');
  assert.equal(movePrompt('copy', 'p2', 'Multiple', [0, 0], { arr: { n: 3, fit: false } }), 'Specify second point or [Fit]:');
  assert.equal(movePrompt('copy', 'p2', 'Multiple', [0, 0], { arr: { n: 3, fit: true } }), 'Specify second point or [Array]:');
  assert.equal(movePrompt('copy', 'p2', 'Multiple', [0, 0], { placed: true }), 'Specify second point or [Array/Exit/Undo] <Exit>:');
  assert.equal(movePrompt('move', 'p2', 'Multiple', [0, 0], { placed: true }), 'Specify second point or <use first point as displacement>:', 'Move has no Array');
});

test('Copy Array count: a whole number from 2 to 1000, the original included', () => {
  for (const [text, n] of [['2', 2], [' 4 ', 4], ['1000', 1000], ['007', 7]]) assert.deepEqual(parseArrayCount(text), { n }, text);
  for (const text of ['', '1', '0', '-2', '3.5', '1001', 'abc', '2e1', '1,5']) assert.ok(parseArrayCount(text).error, text);
});

test('Copy Array offsets: the point is the spacing, or with Fit the last copy with the rest spaced evenly', () => {
  assert.deepEqual(arrayOffsets(10, 5, 3), [{ dx: 10, dy: 5 }, { dx: 20, dy: 10 }]);
  assert.deepEqual(arrayOffsets(30, -6, 4, true), [{ dx: 10, dy: -2 }, { dx: 20, dy: -4 }, { dx: 30, dy: -6 }]);
  assert.deepEqual(arrayOffsets(8, 0, 2, true), [{ dx: 8, dy: 0 }], 'two items: Fit = the point itself');
  assert.equal(arrayOffsets(1, 1, 1000).length, 999);
});

test('Move: absolute base, relative target, signed decimals and direct distance toward cursor', () => {
  assert.deepEqual(movePoint(' -2.5, +3 '), [-2.5, 3]);
  assert.deepEqual(movePoint('10,-5', [20, 30]), [30, 25]);
  assert.deepEqual(movePoint('25', [10, 20], [13, 24]), [25, 40]);
  assert.deepEqual(movePoint('5', [10, 20], [0, 20]), [5, 20]);
  assert.deepEqual(movePoint('5', [10, 20], [10, 0]), [10, 15]);
  assert.deepEqual(movePoint('12mm', [0, 0], [12, 0]), [12, 0]);
  for (const text of ['', '1,', ',2', '1,2,3', 'NaN,2', 'Infinity', '1foo']) {
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
