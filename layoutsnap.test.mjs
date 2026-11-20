import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSnap, layoutTangentObject } from './web/layoutsnap.js';
import { makePart } from './web/layoutdoc.js';
import { newDoc, addEntities, rect, circle } from './web/dxf-write.js';
import { snapTypes } from './web/snap.js';

const raw = newDoc(4);
addEntities(raw, [rect(10, 20, 40, 20), circle(30, 30, 4)]);
const part = makePart('p', 'Part', raw, 2), parts = { p: part };
const snap = (placed, x, y, tol = 0.5) => layoutSnap(parts, placed, 400, 300, x, y, tol);
const at = (sn, x, y, kind) => {
  assert.ok(sn);
  assert.ok(Math.abs(sn.x - x) < 1e-8 && Math.abs(sn.y - y) < 1e-8, JSON.stringify(sn));
  assert.equal(sn.kind, kind);
};

test('layout snaps apply placement, rotation, mirrors, unit factor and the part origin', () => {
  const p = { partId: 'p', x: 150, y: 100, rot: 90 };
  at(snap([p], 110.1, 179.9), 110, 180, 'end');
  at(snap([{ ...p, mirrorX: true }], 110.1, 20.1), 110, 20, 'end');
  at(snap([{ ...p, mirrorY: true }], 189.9, 179.9), 190, 180, 'end');
  at(snap([{ ...p, mirrorX: true, mirrorY: true }], 189.9, 20.1), 190, 20, 'end');
  at(snap([p], 150.1, 139.9), 150, 140, 'mid');
  at(snap([p], 130.1, 139.9), 130, 140, 'centre');
  at(snap([p], 149.9, 123), 150, 123, 'near');
  assert.equal(snap([p], 250, 250), null);
});

test('sheet corners and midpoints beat nearest edges; part features beat nearer edges', () => {
  at(snap([], 0.2, 0.1), 0, 0, 'end');
  at(snap([], 399.8, 300.1), 400, 300, 'end');
  at(snap([], 200.1, 0.1), 200, 0, 'mid');
  at(snap([], 399.9, 123), 400, 123, 'near');
  at(snap([{ partId: 'p', x: 100, y: 0.3 }], 100.1, 0.1), 100, 0.3, 'end');
  assert.equal(snap([{ partId: 'missing', x: 100, y: 100 }], 100, 100), null);
});

test('layout snap ticks filter part and sheet candidates before choosing their shared priority', () => {
  const placed = [{ partId: 'p', x: 150, y: 100, rot: 90 }];
  const pick = (ps, x, y, saved) => layoutSnap(parts, ps, 400, 300, x, y, 0.5, snapTypes({ intersection: false, apparent: false, quadrant: false, ...saved }));
  at(pick(placed, 110.1, 179.9, { end: false }), 110, 179.9, 'near');
  assert.equal(pick(placed, 110.1, 179.9, { end: false, near: false }), null);
  assert.equal(pick(placed, 130.1, 139.9, { centre: false, geometric: false }), null);
  at(pick(placed, 150.1, 139.9, { mid: false }), 150, 139.9, 'near');
  assert.equal(pick(placed, 149.9, 123, { near: false }), null);
  at(pick([], 0.2, 0.1, { end: false }), 0.2, 0, 'near');
  at(pick([], 200.1, 0.1, { mid: false }), 200.1, 0, 'near');
  assert.equal(pick([], 0.2, 0.1, { end: false, near: false }), null);
  assert.equal(pick([], 399.9, 123, { near: false }), null);
  at(pick([{ partId: 'p', x: 100, y: 0.3 }], 100.1, 0.1, {}), 100, 0.3, 'end');
  at(pick([{ partId: 'p', x: 100, y: 0.3 }], 100.1, 0.1, { end: false }), 100.1, 0, 'near');
});

test('TODO 346b: the line or circle under a sheet point, in sheet mm, with the placement applied', () => {
  const p = { partId: 'p', x: 150, y: 100, rot: 90 };
  assert.deepEqual(layoutTangentObject(parts, [p], 149.9, 123, 0.5).o, { t: 'l', a: [150, 100], b: [150, 180] }, 'a rectangle side');
  assert.deepEqual(layoutTangentObject(parts, [{ ...p, mirrorX: true }], 110.1, 20.1, 0.5).o, { t: 'l', a: [150, 20], b: [110, 20] }, 'mirrored');
  const c = layoutTangentObject(parts, [p], 138, 140, 0.5).o;           // the part's circle (r 4 in a part of factor 2)
  assert.equal(c.t, 'c'); assert.ok(Math.abs(c.c[0] - 130) < 1e-8 && Math.abs(c.c[1] - 140) < 1e-8 && Math.abs(c.r - 8) < 1e-8, JSON.stringify(c));
  assert.equal(layoutTangentObject(parts, [p], 130, 140, 0.5), null, 'the circle\'s centre is no object');
  assert.equal(layoutTangentObject(parts, [{ partId: 'missing', x: 1, y: 1 }], 1, 1, 5), null);
});
