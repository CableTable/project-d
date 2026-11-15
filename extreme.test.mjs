import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatten, pickIndex, mapply } from './web/drawing.js';
import { newDoc, addEntities, addBlock, entity, insert, ellipse, arc, circle, line, lwpoly } from './web/dxf-write.js';
import { DEFAULT_TYPES, snapTypes, orderCandidates } from './web/snap.js';
import { makePart } from './web/layoutdoc.js';
import { placedMat } from './web/apply.js';
import { layoutSnap, layoutCandidates, partIndex } from './web/layoutsnap.js';

const spline = () => entity('SPLINE', [[70, 0], [71, 2], ...[0, 0, 0, 1, 1, 1].map((t) => [40, t]), [10, 0], [20, 50], [10, 50], [20, -40], [10, 100], [20, 70]]);
const indexed = (ents, block = null) => {
  const raw = newDoc(4);
  if (block) { addBlock(raw, 'Curve', ents); addEntities(raw, insert('Curve', 0, 0, block)); }
  else addEntities(raw, ents);
  return pickIndex(flatten(raw), false).snaps;
};
const extremes = (snaps) => snaps.filter((p) => p.kind === 'extreme');
const near = (points, x, y) => assert.ok(points.some((p) => Math.hypot(p.x - x, p.y - y) < .01), JSON.stringify({ x, y, points }));

test('TODO 264: Extreme alone defaults off, accepts only saved true, and ranks after quadrant', () => {
  for (const saved of [undefined, {}, { extreme: false }, { extreme: 'true' }]) assert.equal(snapTypes(saved).extreme, false);
  assert.equal(DEFAULT_TYPES.extreme, false);
  assert.ok(Object.entries(DEFAULT_TYPES).every(([k, v]) => k === 'extreme' || v));
  const types = snapTypes({ extreme: true });
  assert.equal(types.extreme, true);
  assert.deepEqual(orderCandidates(['perpendicular', 'extreme', 'quadrant'].map((kind) => ({ x: 0, y: 0, kind })), types).map((p) => p.kind), ['quadrant', 'extreme', 'perpendicular']);
});

test('TODO 264: refined spline minimum, rotated ellipse and stretched arc use world turning points', () => {
  near(extremes(indexed([spline()])), 45, 9.5);
  const radius = Math.sqrt(6250), x = 3750 / radius;
  for (const curve of [ellipse(0, 0, 100, 0, .5), circle(0, 0, 50)]) {
    const points = extremes(indexed([curve], curve.type === 'ELLIPSE' ? { rot: 45 } : { rot: 45, sx: 2 }));
    assert.equal(points.length, 4);
    near(points, x, radius); near(points, -x, -radius);
    near(points, radius, x); near(points, -radius, -x);
  }
});

test('TODO 264: straight pieces have none; circular extremes dedupe quadrants and endpoints and respect sweeps', () => {
  for (const shape of [line(0, 0, 100, 100), lwpoly([[0, 0], [100, 50], [0, 100]]), circle(0, 0, 30), ellipse(0, 0, 100, 0, .5), arc(0, 0, 30, 0, 180), lwpoly([[0, 0, 1], [100, 0]])]) {
    assert.deepEqual(extremes(indexed([shape])), []);
  }
  const partial = extremes(indexed([arc(0, 0, 50, 10, 170)], { rot: 25, sx: 2 }));
  assert.ok(partial.length > 0);
  assert.ok(partial.every((p) => p.y > 0), 'sweep misses the bottom');
});

test('TODO 264: fallback vertices are not refined; a closed seam wraps once; coincident ends are removed', () => {
  const fallback = (pts, closed = false) => entity('SPLINE', [[70, closed ? 1 : 0], [71, 3], ...pts.flatMap(([x, y]) => [[11, x], [21, y]])]);
  const wavy = extremes(indexed([fallback([[0, 5], [4, 0], [10, 2], [14, -2], [20, 6]])]));
  assert.equal(wavy.length, 3); near(wavy, 4, 0); near(wavy, 10, 2); near(wavy, 14, -2);
  const seam = extremes(indexed([fallback([[0, -5], [4, 0], [0, 5], [-4, 0], [0, -5]], true)]));
  assert.equal(seam.length, 4); near(seam, 0, -5);
  const snaps = indexed([ellipse(0, 0, 100, 0, .5, 0, Math.PI)], { rot: 45 });
  for (const p of extremes(snaps)) assert.ok(!snaps.some((q) => ['end', 'quadrant'].includes(q.kind) && Math.hypot(p.x - q.x, p.y - q.y) < 1e-6));
});

test('TODO 264: placed ellipse snaps and Tab candidates use the sheet low point after rotation and mirrors', () => {
  const raw = newDoc(4); addEntities(raw, ellipse(0, 0, 100, 0, .5));
  const part = makePart('p', 'Ellipse', raw, 1), parts = { p: part }, types = snapTypes({ extreme: true });
  for (const mirrorX of [false, true]) {
    const pl = { partId: 'p', x: 200, y: 150, rot: 45, mirrorX }, M = placedMat(part, pl, 0);
    const t = Math.atan2(M[3] * 50, M[1] * 100), q = mapply(M, 100 * Math.cos(t), 50 * Math.sin(t));
    const x = q[0], y = -q[1];
    const sn = layoutSnap(parts, [pl], 600, 500, x + .02, y + .02, .2, types);
    assert.equal(sn?.kind, 'extreme'); near([sn], x, y);
    const candidates = layoutCandidates(parts, [pl], 600, 500, x, y, .2, types);
    near(extremes(candidates.candidates), x, y);
    assert.notEqual(layoutSnap(parts, [pl], 600, 500, x, y, .2)?.kind, 'extreme');
  }
});

const controlSpline = (pts, degree = 3) => entity('SPLINE', [[70, 0], [71, degree],
  ...Array.from({ length: pts.length + degree + 1 }, (_, i) => [40, Math.max(0, Math.min(pts.length - degree, i - degree))]),
  ...pts.flatMap(([x, y]) => [[10, x], [20, y]])]);

test('TODO 264: flat runs give one unrefined midpoint at block rotations 90 and 180', () => {
  const flat = controlSpline([[0, 20], ...Array.from({ length: 30 }, (_, i) => [10 * (i + 1), 0]), [310, 20]]);
  for (const rot of [0, 90, 180]) {
    const points = extremes(indexed([flat], { rot }));
    assert.equal(points.length, 1, `rotation ${rot}`);
    const t = rot * Math.PI / 180;
    near(points, 155 * Math.cos(t), 155 * Math.sin(t));
  }
});

test('TODO 264: down-level-down has no extreme; degree-1 V keeps its vertex; two points are guarded', () => {
  const stair = controlSpline([[0, 20], [10, 10], [20, 10], [30, 10], [40, 10], [50, 10], [60, 0]]);
  for (const rot of [0, 90, 180]) assert.deepEqual(extremes(indexed([stair], { rot })), []);
  const v = extremes(indexed([controlSpline([[0, 10], [10, 0], [20, 20]], 1)]));
  assert.equal(v.length, 1); near(v, 10, 0);
  assert.equal(v[0].y, 0);
  assert.deepEqual(extremes(indexed([controlSpline([[0, 0], [10, 10]], 1)])), []);
  assert.deepEqual(extremes(indexed([entity('SPLINE', [[71, 3], [11, 0], [21, 0], [11, 10], [21, 10]])])), []);
});

test('TODO 264: 100 same-frame copies build one index; axis swaps and mirrors reuse the plain index', () => {
  const raw = newDoc(4); addEntities(raw, spline());
  const source = makePart('p', 'Spline', raw, 1);
  let builds = 0;
  const part = { ...source, get raw() { builds++; return raw; } };
  const copies = Array.from({ length: 100 }, (_, i) => ({ partId: 'p', x: i * 100, y: i * 50, rot: 45 }));
  assert.equal(new Set(copies.map((pl) => partIndex(part, pl))).size, 1);
  assert.equal(builds, 1);
  const plain = partIndex(part);
  for (const rot of [0, 90, 180, 270]) for (const mirrorX of [false, true]) for (const mirrorY of [false, true]) {
    assert.equal(partIndex(part, { rot, mirrorX, mirrorY }), plain);
  }
  assert.equal(builds, 2);
  assert.notEqual(partIndex(part, { rot: 30 }), partIndex(part, copies[0]));
  const changed = newDoc(4); addEntities(changed, ellipse(0, 0, 20, 0, .5));
  assert.notEqual(partIndex(makePart('p', 'Edited', changed, 1), copies[0]), partIndex(part, copies[0]));
});
