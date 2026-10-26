import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TYPES, SNAP_NAME, snapTypes, preferSnap } from './web/snap.js';

test('snap ticks default on; only stored booleans are accepted, missing types stay on', () => {
  for (const saved of [null, undefined, [], 'bad', 42, { end: 'false', near: 0 }]) assert.deepEqual(snapTypes(saved), DEFAULT_TYPES);
  assert.deepEqual(snapTypes({ end: false, near: true, unknown: false }), { ...DEFAULT_TYPES, end: false });
});

const choose = (candidates, ticks = DEFAULT_TYPES, tol = 5) => candidates.reduce((best, sn) => preferSnap(best, sn, 0, 0, tol, ticks), null);
test('every feature beats nearest in either order; among features the closest wins', () => {
  const near = { x: 0, y: .1, kind: 'near' };
  for (const kind of ['end', 'mid', 'centre', 'node', 'intersection', 'quadrant']) {
    const feature = { x: 4, y: 0, kind };
    assert.equal(choose([near, feature]), feature);
    assert.equal(choose([feature, near]), feature);
  }
  const end = { x: 4, y: 0, kind: 'end' }, mid = { x: 2, y: 0, kind: 'mid' };
  assert.equal(choose([end, near, mid]), mid);
  assert.equal(choose([mid, near, end]), mid);
  assert.equal(choose([{ ...end, x: 6 }, near]), near, 'outside tolerance cannot win');
  assert.equal(choose([{ ...end, x: 5 }]).kind, 'end', 'tolerance boundary is included');
  assert.equal(choose([{ ...mid, x: 4 }, end]), end, 'ends keep the existing exact-tie priority');
});

test('each unticked type is excluded; an unticked feature falls back to nearest, all off returns null', () => {
  for (const kind of Object.keys(SNAP_NAME)) {
    const candidate = { x: 1, y: 0, kind };
    assert.equal(choose([candidate], snapTypes({ [kind]: false })), null);
  }
  const end = { x: 1, y: 0, kind: 'end' }, near = { x: .1, y: 0, kind: 'near' };
  assert.equal(choose([end, near], snapTypes({ end: false })), near);
  assert.equal(choose([end, near], snapTypes({ near: false })), end);
  assert.equal(choose([end, near], Object.fromEntries(Object.keys(SNAP_NAME).map((k) => [k, false]))), null);
});
