import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_VIEWS, pushView, popView } from './web/viewhist.js';

const v = (n) => ({ ox: n, oy: n * 2, scale: n + 1, fitted: false });

test('TODO 74: Zoom Previous steps back through the views, newest first', () => {
  const list = [];
  pushView(list, v(1)); pushView(list, v(2)); pushView(list, v(3));
  assert.deepEqual(popView(list), v(3));
  assert.deepEqual(popView(list), v(2));
  assert.deepEqual(popView(list), v(1));
  assert.equal(popView(list), null, 'nothing before the first view');
});

test('TODO 74: the same view twice in a row is remembered once', () => {
  const list = [];
  pushView(list, v(1)); pushView(list, v(1));
  assert.equal(list.length, 1);
});

test('TODO 74: only the last 10 views are kept', () => {
  const list = [];
  for (let i = 0; i < 15; i++) pushView(list, v(i));
  assert.equal(MAX_VIEWS, 10);
  assert.equal(list.length, 10);
  assert.equal(list[0].ox, 5, 'the oldest five are gone');
  assert.equal(popView(list).ox, 14);
});

test('TODO 74: a remembered view is a copy', () => {
  const list = [], cur = { ox: 1, oy: 2, scale: 3, fitted: true };
  pushView(list, cur); cur.ox = 99;
  assert.deepEqual(popView(list), { ox: 1, oy: 2, scale: 3, fitted: true });
});
