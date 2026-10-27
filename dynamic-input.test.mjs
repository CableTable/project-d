import test from 'node:test';
import assert from 'node:assert/strict';
import { dynamicInput } from './web/draw.js';

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
