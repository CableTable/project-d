import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crosshairArms, pickBoxSide, CURSORSIZE } from './web/crosshair.js';
import { gripSide } from './web/grips.js';

test('crosshair arms are CURSORSIZE (5) % of the canvas along each axis', () => {
  assert.equal(CURSORSIZE, 5);
  assert.deepEqual(crosshairArms(1000, 600), [50, 30]);
  assert.deepEqual(crosshairArms(1920, 1080), [96, 54]);
  assert.deepEqual(crosshairArms(0, 0), [0, 0]);
});

test('AutoCAD sizes are half sides: pick box 3 -> 7 px, grip 5 -> 11 px', () => {
  assert.equal(pickBoxSide(), 7);
  assert.equal(gripSide(), 11);
});
