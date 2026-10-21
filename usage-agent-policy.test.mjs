import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLockStale, shouldRefresh } from './tools/usage-agent-policy.mjs';

test('locks before boot are stale even when their PID is reused', () => {
  assert.equal(isLockStale(99, 100), true);
  assert.equal(isLockStale(100, 100), false);
  assert.equal(isLockStale(101, 100), false);
  for (const code of ['ESRCH', 'EPERM']) assert.equal(isLockStale(101, 100, { code }), true);
  const error = Object.assign(new Error('unexpected probe failure'), { code: 'EIO' });
  assert.throws(() => isLockStale(101, 100, error), (e) => e === error);
});

test('a handled failed request waits for a newer request or the hourly refresh', () => {
  const state = { busy: false, now: 10_000, nextRefresh: 3600_000, requestedAt: 5000, lastHandled: 0 };
  assert.equal(shouldRefresh(state), true);
  // A failed refresh consumes requestedAt in finally, just like a successful one.
  state.lastHandled = state.requestedAt;
  for (const now of [20_000, 30_000, 3599_999]) assert.equal(shouldRefresh({ ...state, now }), false);
  assert.equal(shouldRefresh({ ...state, requestedAt: 5001 }), true);
  assert.equal(shouldRefresh({ ...state, requestedAt: 4999 }), false);
  assert.equal(shouldRefresh({ ...state, now: 3600_000 }), true);
  assert.equal(shouldRefresh({ ...state, now: 3600_000, busy: true }), false);
});
