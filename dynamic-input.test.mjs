import test from 'node:test';
import assert from 'node:assert/strict';
import { dynamicInput } from './web/draw.js';
import { createInput, hasTyped, escapeInput, inputKey, pointInput } from './web/dynamic-input.js';

test('Dynamic input: translated points, signed deltas and all angle quadrants', () => {
  assert.deepEqual(dynamicInput([10, 20], [13, 24], 2), { length: '5.00 mm', angle: '53.13°', dx: '3.00 mm', dy: '4.00 mm' });
  for (const [point, angle] of [[[1, 0], 0], [[1, 1], 45], [[0, 1], 90], [[-1, 1], 135], [[-1, 0], 180], [[-1, -1], 225], [[0, -1], 270], [[1, -1], 315]]) {
    const fields = dynamicInput([0, 0], point, 2);
    assert.equal(fields.angle, angle.toFixed(2) + '°');
    assert.equal(fields.dx, point[0].toFixed(2) + ' mm');
    assert.equal(fields.dy, point[1].toFixed(2) + ' mm');
  }
});

test('Dynamic input: decimals 0–4, coincident points, rounding without negative zero or 360°', () => {
  for (let dp = 0; dp <= 4; dp++) {
    assert.deepEqual(dynamicInput([1, 1], [1, 1], dp), { length: (0).toFixed(dp) + ' mm', angle: (0).toFixed(dp) + '°', dx: (0).toFixed(dp) + ' mm', dy: (0).toFixed(dp) + ' mm' });
    const fields = dynamicInput([0, 0], [1.23456, -0.0000001], dp);
    assert.equal(fields.length, (1.23456).toFixed(dp) + ' mm');
    assert.equal(fields.dx, (1.23456).toFixed(dp) + ' mm');
    assert.equal(fields.dy, (0).toFixed(dp) + ' mm');
    assert.equal(fields.angle, (0).toFixed(dp) + '°');
  }
  assert.equal(dynamicInput([0, 0], [-0.0000001, 1], 4).dx, '0.0000 mm');
});

const keys = (text, first = false, s = createInput(first)) => [...text].reduce((s, k) => inputKey(s, k, first), s);
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, a + ' != ' + b));
test('Dynamic input: Tab locks, cycles, preserves typed values and Backspace edits the active field', () => {
  let s = inputKey(keys('50'), 'Tab', false);
  assert.deepEqual(s.locked, [true, false]); assert.equal(s.active, 1);
  s = keys('90', false, s); s = inputKey(s, 'Tab', false);
  assert.equal(s.active, 0); assert.deepEqual(s.locked, [true, true]);
  near(pointInput(s, [10, 20], [999, 999]).point, [10, 70]);
  s = inputKey(s, 'Backspace', false); assert.deepEqual(s.values, ['5', '90']);
  assert.deepEqual(s.locked, [false, true]);
  for (const key of ['c', 'U', 'Enter', 'ArrowLeft', '+']) assert.equal(inputKey(s, key, false), null);
});
test('Dynamic input: typing into a locked field replaces its value, then Tab locks it again', () => {
  for (const first of [true, false]) {
    let s = inputKey(keys('50', first), 'Tab', first);
    s = inputKey(s, 'Tab', first);
    s = keys('3', first, s);
    assert.deepEqual(s.values, ['3', '']); assert.deepEqual(s.locked, [false, false]);
    s = keys('2', first, s);
    assert.deepEqual(s.values, ['32', '']);
    s = inputKey(s, 'Tab', first);
    assert.equal(s.active, 1); assert.deepEqual(s.locked, [true, false]);
  }
});
test('Dynamic input: mouse fills untyped fields, signed lengths and typed angles override mouse angles', () => {
  near(pointInput(keys('30'), [10, 20], [13, 24]).point, [28, 44]);
  near(pointInput(keys('-30'), [10, 20], [13, 24]).point, [-8, -4]);
  near(pointInput(keys('50<90'), [10, 20], [99, 20]).point, [10, 70]);
  near(pointInput(keys('<90'), [10, 20], [40, 20]).point, [10, 50]);
  assert.equal(pointInput(keys('30'), [0, 0], [1, 1]).text, '@30<45');
  assert.deepEqual(pointInput(keys('-30'), [10, 20], [13, 24]).live, [5, Math.atan2(4, 3) * 180 / Math.PI]);
  for (const y of [1e-20, 1e25]) {
    const result = pointInput(keys('10,', true), null, [0, y]);
    assert.equal(result.why, ''); assert.equal(result.point[1], y);
  }
});
test('Dynamic input: comma defaults relative, # absolute, @ relative, and first point X / Y', () => {
  for (const text of ['10,0', '@10,0']) near(pointInput(keys(text), [20, 30], [99, 99]).point, [30, 30]);
  near(pointInput(keys('#0,0'), [20, 30], [99, 99]).point, [0, 0]);
  near(pointInput(keys('@-5<180'), [20, 30], [99, 99]).point, [25, 30]);
  let s = keys('10', true); s = inputKey(s, 'Tab', true); s = keys('20', true, s);
  assert.deepEqual(pointInput(s, null, [999, 999]).labels, ['X', 'Y']);
  near(pointInput(s, null, [999, 999]).point, [10, 20]);
  near(pointInput(keys('10,20', true), null, [999, 999]).point, [10, 20]);
  near(pointInput(keys('10', true), null, [99, 42]).point, [10, 42]);
  near(pointInput(keys('#10', false), [20, 30], [99, 42]).point, [10, 42]);
});
test('Dynamic input: bad and overflowing numbers fail validation; first Esc clears, second delegates cancellation', () => {
  const s = keys('1..2');
  assert.equal(pointInput(s, [0, 0], [10, 0]).point, null);
  assert.match(pointInput(s, [0, 0], [10, 0]).why, /Length must be a finite number/);
  assert.ok(pointInput(keys('9'.repeat(400)), null, [0, 0]).why);
  const cleared = escapeInput(s, false);
  assert.equal(hasTyped(cleared), false); assert.equal(escapeInput(cleared, false), null);
  assert.deepEqual(escapeInput(keys('@', true), true), createInput(true));
});
