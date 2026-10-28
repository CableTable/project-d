import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crosshairArm, pickBoxSide, CURSORSIZE } from './web/crosshair.js';
import { gripSide } from './web/grips.js';

test('crosshair is square: one arm, CURSORSIZE (5) % of the screen height (his AutoCAD: ~77 px on 1438 px)', () => {
  assert.equal(CURSORSIZE, 5);
  assert.equal(crosshairArm(1438), 72);
  assert.equal(crosshairArm(1080), 54);
  assert.equal(crosshairArm(0), 0);
  assert.equal(typeof crosshairArm(900), 'number');          // a single length for both axes
});

test('AutoCAD sizes are half sides: pick box 3 -> 7 px, grip 5 -> 11 px', () => {
  assert.equal(pickBoxSide(), 7);
  assert.equal(gripSide(), 11);
});
