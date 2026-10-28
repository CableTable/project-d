import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from './web/dxf-write.js';
import { flatten } from './web/drawing.js';
import { makeIndex, snapPick, snapObject, snapCandidates, snapReference } from './web/edit.js';
import { tangentPoints, lineSnaps, polygonCentre, pathCentre, orderCandidates, snapTypes, SNAP_NAME } from './web/snap.js';
import { layoutCandidates, layoutSnap, layoutReference } from './web/layoutsnap.js';
import { makePart } from './web/layoutdoc.js';
import { resolve } from './web/cmdbar.js';

const index = (...entities) => { const raw = W.newDoc(4); W.addEntities(raw, entities); return makeIndex(raw, flatten(raw)); };
const only = (kind) => Object.fromEntries(Object.keys(SNAP_NAME).map((k) => [k, k === kind]));
const close = (p, q) => assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-8, `${p} != ${q}`);

test('TODO 155k: circle tangents are on the circle and perpendicular to the radius; interior/on-circle/zero-radius have none', () => {
  const arc = { t: 'a', cx: 10, cy: 20, r: 5, s: 0, sw: 2 * Math.PI, full: true };
  const from = [20, 20], points = tangentPoints(from, arc);
  assert.equal(points.length, 2);
  for (const p of points) {
    assert.ok(Math.abs(Math.hypot(p.x - 10, p.y - 20) - 5) < 1e-10);
    assert.ok(Math.abs((p.x - from[0]) * (p.x - 10) + (p.y - from[1]) * (p.y - 20)) < 1e-10);
  }
  for (const p of [null, [10, 20], [12, 20], [15, 20]]) assert.deepEqual(tangentPoints(p, arc), []);
  assert.deepEqual(tangentPoints(from, { ...arc, r: 0 }), []);
});

test('TODO 155k: Tangent clips arcs/bulges to their sweep, works in transformed blocks and respects ticks, aperture, visibility and skip', () => {
  const ed = index(W.circle(0, 0, 5)), p = [2.5, 5 * Math.sqrt(3) / 2];
  const pick = (types = only('tangent'), skip = -1, tol = .1) => snapPick(ed, ...p, tol, true, skip, types, [], [10, 0]);
  close([pick().x, pick().y], p);
  assert.equal(pick().kind, 'tangent');
  assert.equal(pick(only('end')), null);
  assert.equal(pick(undefined, 0), null);
  assert.equal(snapPick(ed, p[0] + .2, p[1], .1, true, -1, only('tangent'), [], [10, 0]), null);
  ed.vis[0] = 0; assert.equal(pick(), null);
  for (const ent of [W.arc(0, 0, 5, 0, 90), W.lwpoly([[5, 0, Math.tan(Math.PI / 8)], [0, 5]])]) {
    const arcIndex = index(ent), candidates = snapCandidates(arcIndex, 0, ...p, .1, only('tangent'), [10, 0]);
    assert.equal(candidates.length, 1); close([candidates[0].x, candidates[0].y], p);
    assert.equal(snapPick(arcIndex, p[0], -p[1], .1, true, -1, only('tangent'), [], [10, 0]), null);
  }
  const raw = W.newDoc(4); W.addBlock(raw, 'C', [W.circle(0, 0, 5)]);
  W.addEntities(raw, W.insert('C', 30, 20, { sx: -2, sy: 2, rot: 90 }));
  const transformed = makeIndex(raw, flatten(raw));
  const tangents = snapCandidates(transformed, 0, 30, 30, 1, only('tangent'), [30, 40]);
  assert.equal(tangents.length, 2);
  for (const q of tangents) assert.ok(Math.abs(Math.hypot(q.x - 30, q.y - 20) - 10) < 1e-8);
  W.addEntities(raw, W.insert('C', 70, 20, { sx: 2, sy: 1 }));
  assert.equal(snapCandidates(makeIndex(raw, flatten(raw)), 1, 80, 20, 1, only('tangent'), [90, 20]).length, 0, 'stretched circles are not circular tangents');
});

test('TODO 155k: exact polygon area centroid, winding and degeneracy; curved/open/self-crossing paths are refused', () => {
  const triangle = [[0, 0], [6, 0], [0, 3]];
  close(polygonCentre(triangle), [2, 1]); close(polygonCentre([...triangle].reverse()), [2, 1]);
  close(polygonCentre(triangle.map(([x, y]) => [x + 1e8, y - 1e8])), [1e8 + 2, -1e8 + 1]);
  assert.equal(polygonCentre([[0, 0], [1, 0], [2, 0]]), null);
  assert.equal(polygonCentre([[0, 0], [3, 3], [0, 3], [3, 0]]), null);
  assert.equal(pathCentre([0, 0, 0, 1, 6, 0, 1, 0, 3]), null);
  assert.equal(pathCentre([0, 5, 0, 2, 0, 0, 5, 0, 6.28, 0, 9]), null);
  const polygon = (n) => Array.from({ length: n }, (_, i) => [Math.cos(i * 2 * Math.PI / n), Math.sin(i * 2 * Math.PI / n)]);
  assert.ok(index(W.lwpoly(polygon(200), { closed: true })).ix.snaps.some((p) => p.kind === 'geometric'));
  assert.equal(index(W.lwpoly(polygon(201), { closed: true })).ix.snaps.some((p) => p.kind === 'geometric'), false, 'large outlines skip the quadratic simplicity check');
  const ed = index(W.lwpoly(triangle, { closed: true }));
  assert.deepEqual(snapPick(ed, 2.01, 1, .1, true, -1, only('geometric')), { x: 2, y: 1, kind: 'geometric' });
  assert.equal(snapPick(ed, 2.01, 1, .1, true, 0, only('geometric')), null);
});

test('TODO 155k: text, nested block and array insertion points include base/rotation/scale; hidden members cannot snap', () => {
  const raw = W.newDoc(4);
  W.addBlock(raw, 'inner', [W.line(4, 6, 14, 6)], [4, 6]);
  W.addBlock(raw, 'outer', [W.insert('inner', 2, 3)]);
  W.addEntities(raw, W.insert('outer', 20, 30, { sx: 2, sy: 2, rot: 90 }), W.text(50, 60, 3, 'Text'), W.insert('inner', 80, 90, { cols: 2, dx: 15 }));
  const attributed = W.insert('inner', 110, 120, { sx: 2, sy: 2 });
  attributed.kids = [W.entity('ATTRIB', [[10, 130], [20, 140], [40, 3], [1, 'Attribute']]).r];
  W.addEntities(raw, attributed, W.entity('TEXT', [[10, 150], [20, 60], [11, 160], [21, 60], [72, 1], [40, 3], [1, 'Centred']]), W.mtext(55, 65, 3, 'Mtext'));
  const ed = makeIndex(raw, flatten(raw));
  for (const p of [[20, 30], [14, 34], [50, 60], [80, 90], [95, 90], [130, 140], [150, 60], [55, 65]]) {
    const sn = snapPick(ed, ...p, .01, true, -1, only('insertion'));
    assert.ok(sn, 'insertion ' + p); close([sn.x, sn.y], p);
  }
  assert.equal(snapPick(ed, 50, 60, .01, true, 1, only('insertion')), null);
  const hidden = makeIndex(raw, flatten(raw), new Set(), new Set([0]));
  assert.equal(snapPick(hidden, 20, 30, .01, true, -1, only('insertion')), null);
});

test('TODO 155k: acquired straight Extension and Parallel are exact, finite ends excluded, curves/zero lengths refused', () => {
  const p = { t: 's', x1: 0, y1: 0, x2: 10, y2: 10 };
  const snaps = lineSnaps(p, [20.1, 20], [0, 4]);
  close([snaps[0].x, snaps[0].y], [20.05, 20.05]); assert.equal(snaps[0].kind, 'extension');
  close([snaps[1].x, snaps[1].y], [18.05, 22.05]); assert.equal(snaps[1].kind, 'parallel');
  assert.deepEqual(lineSnaps(p, [5, 5], null), []);
  assert.deepEqual(lineSnaps({ ...p, curve: true }, [20, 20], [0, 4]), []);
  assert.deepEqual(lineSnaps({ ...p, x2: 0, y2: 0 }, [20, 20], [0, 4]), []);
  const ed = index(W.line(0, 0, 10, 10));
  assert.ok(snapReference(ed, 5, 5, .1)); assert.equal(snapReference(ed, 5, 5, .1, 0), null);
});

test('TODO 155k: Apparent intersection is a real finite 2D crossing and obeys its own tick', () => {
  const ed = index(W.line(-10, 0, 10, 0), W.line(0, -10, 0, 10));
  assert.deepEqual(snapPick(ed, .01, .01, .1, true, -1, only('apparent')), { x: 0, y: 0, kind: 'apparent' });
  assert.equal(snapPick(ed, .01, .01, .1, true, 1, only('apparent')), null);
  assert.equal(snapPick(index(W.line(-10, 0, -5, 0), W.line(0, -10, 0, 10)), 0, 0, .1, true, -1, only('apparent')), null);
});

test('TODO 155k: deterministic whole-object Tab order, distant ends, duplicates, ticks, visibility and object isolation', () => {
  const ed = index(W.line(0, 0, 100, 0), W.line(0, 30, 100, 30));
  assert.equal(snapObject(ed, 31, .1, .5), 0);
  assert.deepEqual(snapCandidates(ed, 0, 31, .1, .5).map((p) => [p.kind, p.x, p.y]), [['end', 0, 0], ['end', 100, 0], ['mid', 50, 0], ['near', 31, 0]]);
  const candidates = snapCandidates(ed, 0, 31, .1, .5, snapTypes({ end: false }));
  assert.deepEqual(candidates.map((p) => p.kind), ['mid', 'near']);
  assert.deepEqual(orderCandidates([...candidates].reverse().concat(candidates)), candidates);
  ed.vis[0] = 0; assert.equal(snapObject(ed, 31, .1, .5), -1); assert.deepEqual(snapCandidates(ed, 0, 31, .1, .5), []);
  assert.equal(resolve('os').name, 'osnap'); assert.equal(resolve('ortho').name, 'ortho'); assert.equal(resolve('polar'), null);
});

test('TODO 155k: layout Tab order and Tangent use transformed sheet coordinates', () => {
  const raw = W.newDoc(4); W.addEntities(raw, W.line(0, 0, 100, 0), W.circle(50, 30, 5));
  const part = makePart('p', 'Part', raw, 2), parts = { p: part }, placed = [{ partId: 'p', x: 150, y: 100, rot: 90 }];
  const hit = layoutCandidates(parts, placed, 500, 400, 150, 162, .1);
  assert.ok(hit); assert.equal(hit.e, 0); assert.ok(hit.candidates.filter((p) => p.kind === 'end').length === 2);
  const edge = layoutCandidates({}, [], 500, 400, 123, 0, .1);
  assert.deepEqual(edge.candidates.map((p) => p.kind), ['end', 'end', 'mid', 'near']);
  const tangent = layoutSnap(parts, placed, 500, 400, 85, 200 + 5 * Math.sqrt(3), .01, only('tangent'), [70, 200]);
  assert.ok(tangent); assert.equal(tangent.kind, 'tangent');
  const ref = layoutReference(parts, placed, 150, 162, .1);
  assert.ok(ref); assert.equal(layoutReference(parts, [], 150, 162, .1), null);
  const extended = lineSnaps(ref.piece, [150, 330], [100, 150]);
  close([extended[0].x, extended[0].y], [150, 330]);
  close([extended[1].x, extended[1].y], [100, 330]);
});
