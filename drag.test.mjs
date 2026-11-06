import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragTarget } from './web/drag.js';
import { placedSnap, layoutSnap } from './web/layoutsnap.js';
import { makePart } from './web/layoutdoc.js';
import { newDoc, addEntities, rect } from './web/dxf-write.js';
import { translate } from './web/place.js';

test('body drag keeps placed-part corner landing exact using the snapped grab', () => {
  const raw = addEntities(newDoc(4), rect(0, 0, 40, 20));
  const parts = { p: makePart('p', 'Plate', raw) };
  const moving = { partId: 'p', x: 20.1234, y: 20.4321, rot: 0 };
  const target = { partId: 'p', x: 100.9876, y: 60.8765, rot: 0 };
  const grab = placedSnap(parts, [moving], moving.x + .1, moving.y + .1, .5);
  const snap = layoutSnap(parts, [target], 1000, 700, target.x + .1, target.y + .1, .5);
  assert.equal(grab.kind, 'end'); assert.equal(snap.kind, 'end');
  const delta = dragTarget([grab.x, grab.y], [snap.x, snap.y, snap.kind], 1, false);
  const landed = translate(moving, delta.dx, delta.dy);
  assert.equal(landed.x, target.x); assert.equal(landed.y, target.y);
  assert.equal(placedSnap(parts, [], .1, .1, .5), null, 'pickup has no sheet snaps');
});

test('body drag free deltas round in mm; Shift/ORTHO locks after the snap', () => {
  assert.deepEqual(dragTarget([0, 0], [.12345, .23456], 25.4, false), { to: [.12345, .23456], dx: 3.14 / 25.4, dy: 5.96 / 25.4 });
  assert.deepEqual(dragTarget([1, 2], [100.12345, 20.98765, 'end'], 1, true), { to: [100.12345, 2, 'end'], dx: 99.12345, dy: 0 });
  assert.deepEqual(dragTarget([1, 2], [1, 20.98765, 'end'], 1, true).to, [1, 20.98765, 'end']);
});
