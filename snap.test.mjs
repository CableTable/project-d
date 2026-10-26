import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TYPES, SNAP_NAME, snapTypes, preferSnap, perpFoot } from './web/snap.js';

test('TODO 68c: the perpendicular foot lies on the segment only; zero-length segments have none', () => {
  assert.deepEqual(perpFoot([3, 5], [0, 0], [10, 0]), [3, 0]);
  assert.deepEqual(perpFoot([0, 4], [0, 0], [10, 10]), [2, 2]);
  assert.deepEqual(perpFoot([0, 5], [0, 0], [10, 0]), [0, 0], 'the foot at an end is allowed');
  assert.equal(perpFoot([-1, 5], [0, 0], [10, 0]), null, 'beyond the start: the extension is not a snap');
  assert.equal(perpFoot([11, 5], [0, 0], [10, 0]), null, 'beyond the end');
  assert.equal(perpFoot([3, 5], [2, 2], [2, 2]), null, 'zero-length');
});

test('TODO 68c: perpendicular is ticked on by default and has its name', () => {
  assert.equal(DEFAULT_TYPES.perpendicular, true);
  assert.equal(SNAP_NAME.perpendicular, 'perpendicular');
});

test('snap ticks default on; only stored booleans are accepted, missing types stay on', () => {
  for (const saved of [null, undefined, [], 'bad', 42, { end: 'false', near: 0 }]) assert.deepEqual(snapTypes(saved), DEFAULT_TYPES);
  assert.deepEqual(snapTypes({ end: false, near: true, unknown: false }), { ...DEFAULT_TYPES, end: false });
});

const choose = (candidates, ticks = DEFAULT_TYPES, tol = 5) => candidates.reduce((best, sn) => preferSnap(best, sn, 0, 0, tol, ticks), null);
test('every feature beats nearest in either order; among features the closest wins', () => {
  const near = { x: 0, y: .1, kind: 'near' };
  for (const kind of ['end', 'mid', 'centre', 'node', 'intersection', 'quadrant', 'perpendicular']) {
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

test('end wins a coincident intersection tie in either candidate order', () => {
  const end = { x: 1, y: 2, kind: 'end' }, intersection = { ...end, kind: 'intersection' };
  assert.equal(choose([intersection, end]), end);
  assert.equal(choose([end, intersection]), end);
  assert.equal(choose([end, intersection], snapTypes({ end: false })), intersection);
});

test('TODO 68c: perpendicular beats nearest, loses to a closer type, and the end wins an exact tie', () => {
  const near = { x: 0, y: .1, kind: 'near' }, perp = { x: 3, y: 0, kind: 'perpendicular' }, mid = { x: 2, y: 0, kind: 'mid' };
  assert.equal(choose([near, perp]), perp);
  assert.equal(choose([perp, near]), perp);
  assert.equal(choose([perp, mid]), mid, 'closest wins');
  const end = { x: 3, y: 0, kind: 'end' };
  assert.equal(choose([perp, end]), end);
  assert.equal(choose([end, perp]), end);
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
