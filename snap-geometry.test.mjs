import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from './web/dxf-write.js';
import { flatten, piecesNear } from './web/drawing.js';
import { makeIndex, snapPick } from './web/edit.js';
import { pieceInter } from './web/modify.js';
import { snapTypes } from './web/snap.js';

const index = (...entities) => {
  const raw = W.newDoc(4); W.addEntities(raw, entities);
  return makeIndex(raw, flatten(raw));
};
const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-7;
const kinds = ['line', 'arc', 'circle', 'straight polyline', 'bulged polyline'];
function shape(kind, side, touch = false, dx = 0) {
  if (kind === 'line' || kind === 'straight polyline') {
    const a = side ? [dx, -3] : [dx - 3, 0], b = side ? [dx, touch ? 0 : 4] : [dx + 4, 0];
    return kind === 'line' ? W.line(...a, ...b) : W.lwpoly([a, b]);
  }
  const c = side ? (touch ? [dx, -2] : [dx + 2, 0]) : [dx, 2];
  const a0 = side ? (touch ? 0 : 90) : 180, a1 = a0 + 180;
  if (kind === 'circle') return W.circle(...c, 2);
  if (kind === 'arc') return W.arc(...c, 2, a0, a1);
  const at = (a) => [c[0] + 2 * Math.cos(a * Math.PI / 180), c[1] + 2 * Math.sin(a * Math.PI / 180)];
  return W.lwpoly([[...at(a0), 1], at(a1)]);
}

for (let i = 0; i < kinds.length; i++) for (let j = i; j < kinds.length; j++) {
  test(`TODO 68b: ${kinds[i]} / ${kinds[j]}: crossing, touch and no crossing`, () => {
    const intersect = (touch, dx = 0) => {
      const ed = index(shape(kinds[i], 0, touch), shape(kinds[j], 1, touch, dx));
      const [a, b] = ed.ix.pieces;
      const points = pieceInter(a, b), reversed = pieceInter(b, a);
      assert.equal(points.length, reversed.length);
      for (const p of points) assert.ok(reversed.some((q) => near(p, q)), 'pair order is immaterial');
      return points;
    };
    assert.ok(intersect(false).some((p) => near(p, [0, 0])), 'real crossing');
    const tangent = intersect(true);
    assert.equal(tangent.length, 1, 'touch appears once');
    assert.ok(near(tangent[0], [0, 0]));
    assert.deepEqual(intersect(false, 20), [], 'no crossing');
  });
}

test('TODO 68b: finite sweeps, finite lines, parallel / coincident supports and flattened curves', () => {
  for (const entities of [
    [W.line(-3, 0, 3, 0), W.arc(0, 0, 2, 20, 160)],
    [W.line(3, 0, 4, 0), W.circle(0, 0, 2)],
    [W.arc(0, 0, 2, 180, 270), W.circle(2, 0, 2)],
    [W.line(0, 0, 1, 0), W.line(0, 1, 1, 1)],
    [W.line(0, 0, 2, 0), W.line(1, 0, 3, 0)],
    [W.circle(0, 0, 2), W.circle(0, 0, 2)],
    [W.line(-3, 0, 3, 0), W.ellipse(0, 0, 2, 0, .5)],
  ]) {
    const ed = index(...entities);
    const a = ed.ix.pieces.filter((p) => p.it === 0), b = ed.ix.pieces.filter((p) => p.it === 1);
    for (const p of a) for (const q of b) assert.deepEqual(pieceInter(p, q), []);
  }
});

test('TODO 68b: cursor grid / aperture, visibility, skip and priority apply to intersections', () => {
  const ed = index(W.line(-30, 0, 40, 0), W.line(0, -30, 0, 40),
    ...Array.from({ length: 5000 }, (_, i) => W.line(100 + i * 10, 100, 101 + i * 10, 100)));
  const pick = (types, skip = -1) => snapPick(ed, .2, .1, .5, true, skip, types);
  assert.equal(piecesNear(ed.ix, .2, .1, .5).length, 2, 'only local pieces are paired');
  assert.deepEqual(pick(), { x: 0, y: 0, kind: 'intersection' });
  assert.equal(pick(snapTypes({ intersection: false, apparent: false })).kind, 'near');
  assert.equal(pick(undefined, 1).kind, 'near');
  ed.vis[1] = 0;
  assert.equal(pick().kind, 'near', 'hidden geometry cannot intersect');
  ed.vis[1] = 1;
  assert.equal(snapPick(ed, .2, .1, .5, true, -1, snapTypes(), [{ x: .2, y: .2, kind: 'end' }]).kind, 'end', 'a closer feature wins');
  assert.equal(snapPick(ed, 1, .1, .5).kind, 'near', 'out-of-aperture crossing is ignored');
  assert.equal(snapPick(ed, .2, .1, .5, false), null);
  const hidden = makeIndex(ed.raw, ed.fl, new Set(), new Set([1]));
  assert.equal(snapPick(hidden, .2, .1, .5).kind, 'near', 'Objects hide is honoured too');
});

test('TODO 68b: a shared segment corner is an intersection; its end name wins when enabled', () => {
  for (const entities of [[W.line(0, 0, 10, 0), W.line(10, 0, 10, 10)], [W.rect(0, 0, 10, 10)]]) {
    const ed = index(...entities);
    assert.deepEqual(snapPick(ed, 10.1, .1, .5), { x: 10, y: 0, kind: 'end' });
    assert.deepEqual(snapPick(ed, 10.1, .1, .5, true, -1, snapTypes({ end: false })), { x: 10, y: 0, kind: 'intersection' });
  }
});

test('TODO 68b: at a slot corner (line meets half circle) the end wins at every hover position', () => {
  const ed = index(W.lwpoly([[0, 0], [10, 0, 1], [10, 4], [0, 4, 1]], { closed: true }));
  for (const [cx, cy] of [[0, 0], [10, 0], [10, 4], [0, 4]]) for (let a = 0; a < 360; a += 3) for (const r of [.05, .2, .45]) {
    const got = snapPick(ed, cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180), .5);
    if (got.kind !== 'near') assert.equal(got.kind, 'end', `corner ${cx},${cy} angle ${a} r ${r}`);
  }
});

test('TODO 68b: 1000 lines through one point still snap (only the 200 nearest are crossed)', () => {
  const ed = index(...Array.from({ length: 1000 }, (_, i) => { const a = i * Math.PI / 1000; return W.line(-50 * Math.cos(a), -50 * Math.sin(a), 50 * Math.cos(a), 50 * Math.sin(a)); }));
  const got = snapPick(ed, .1, .1, .5);
  assert.equal(got.kind, 'intersection');
  assert.ok(near([got.x, got.y], [0, 0]));
});

test('fix68b2: fractional and seeded random slot corners keep the end at every hover', () => {
  let seed = 68;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const slots = [[.3, .7, 3.7, .61, 0], ...Array.from({ length: 200 }, () =>
    [random() * 100 - 50, random() * 100 - 50, .5 + random() * 100, .1 + random() * 10, random() * Math.PI * 2])];
  for (const [x, y, length, radius, angle] of slots) {
    const corners = [[0, 0], [length, 0], [length, 2 * radius], [0, 2 * radius]].map(([a, b]) =>
      [x + a * Math.cos(angle) - b * Math.sin(angle), y + a * Math.sin(angle) + b * Math.cos(angle)]);
    const ed = index(W.lwpoly(corners.map((p, i) => [...p, i % 2]), { closed: true }));
    const tol = Math.min(length, radius) / 4;
    const types = snapTypes({ quadrant: angle === 0 }); // Rotated quadrants can legitimately sit closer than the corner.
    for (const [cx, cy] of corners) for (let a = 0; a < 360; a += 3) for (const r of [.1, .4, .9]) {
      const got = snapPick(ed, cx + tol * r * Math.cos(a * Math.PI / 180), cy + tol * r * Math.sin(a * Math.PI / 180), tol, true, -1, types);
      assert.equal(got?.kind, 'end', `slot ${[x, y, length, radius, angle]} corner ${cx},${cy} hover ${a},${r}`);
    }
  }
});

test('fix68b2: relative tangent tolerance preserves two real near-tangent crossings across scales', () => {
  for (const r of [.001, 1, 1000]) {
    const ed = index(W.line(-2 * r, r * (1 - 1e-10), 2 * r, r * (1 - 1e-10)), W.circle(0, 0, r));
    const [line, circle] = ed.ix.pieces, hits = pieceInter(line, circle);
    assert.equal(hits.length, 2);
    assert.ok(hits[0][0] < 0 && hits[1][0] > 0);
  }
});

test('TODO 68c: perpendicular foot on a line / polyline segment from the last point, ticks, aperture and skip', () => {
  const ed = index(W.line(0, 0, 100, 0), W.lwpoly([[0, 50], [100, 50], [100, 100]]), W.line(5, 5, 5, 5));
  const from = [30, 20], on = (x, y, types = snapTypes(), skip = -1, f = from) => snapPick(ed, x, y, .5, true, skip, types, [], f);
  assert.deepEqual(on(30.2, .2), { x: 30, y: 0, kind: 'perpendicular' });
  assert.deepEqual(on(30.2, 50.2), { x: 30, y: 50, kind: 'perpendicular' }, 'a polyline segment');
  assert.equal(on(30.2, .2, snapTypes({ perpendicular: false })).kind, 'near', 'the tick turns it off');
  assert.equal(on(30.2, .2, snapTypes(), -1, null).kind, 'near', 'no last point: no perpendicular');
  assert.equal(on(60.2, .2).kind, 'near', 'cursor away from the foot');
  assert.equal(on(130, .2, snapTypes(), -1, [130, 20]), null, 'the foot would be past the end of the line');
  assert.equal(on(100.2, 80.2, snapTypes(), -1, [30, 80]).kind, 'perpendicular', 'a vertical segment');
  assert.deepEqual(on(100.2, .2, snapTypes(), -1, [100, 20]), { x: 100, y: 0, kind: 'end' }, 'a foot at an end keeps the end name');
  assert.equal(on(5.2, 5.2).kind, 'end', 'a zero-length line gives no perpendicular');
  ed.vis[0] = 0;
  assert.equal(on(30.2, .2), null, 'hidden geometry is skipped');
});

test('TODO 68b: quadrant points respect circle / arc / bulge sweeps and ticks', () => {
  const quads = (ed) => ed.ix.snaps.filter((s) => s.kind === 'quadrant').map((s) => [s.x, s.y]);
  const circle = index(W.circle(0, 0, 10));
  const want = [[10, 0], [0, 10], [-10, 0], [0, -10]];
  assert.equal(quads(circle).length, 4);
  for (const p of want) assert.ok(quads(circle).some((q) => near(p, q)));
  assert.equal(snapPick(circle, .1, 10.1, .5).kind, 'quadrant');
  assert.equal(snapPick(circle, .1, 10.1, .5, true, -1, snapTypes({ quadrant: false })).kind, 'near');
  for (const e of [W.arc(0, 0, 10, 300, 110), W.lwpoly([[0, -10, 1], [0, 10]])]) {
    const pts = quads(index(e));
    const expected = e.type === 'ARC' ? [[10, 0], [0, 10]] : [[0, -10], [10, 0], [0, 10]];
    assert.equal(pts.length, expected.length);
    for (const p of expected) assert.ok(pts.some((q) => near(p, q)));
  }
  assert.ok(!quads(index(W.lwpoly([[0, -10, -1], [0, 10]]))).some((q) => near(q, [10, 0])), 'negative bulge sweeps left');
});

test('TODO 68b: transformed / reflected circular geometry stays exact; stretched curves avoid false crossings', () => {
  const raw = W.newDoc(4);
  W.addBlock(raw, 'Arc', [W.arc(0, 0, 10, 300, 110)]);
  W.addEntities(raw, W.insert('Arc', 50, 60, { sx: -2, sy: 2, rot: 30 }));
  const ed = makeIndex(raw, flatten(raw)), arc = ed.ix.pieces[0];
  assert.equal(arc.t, 'a');
  for (const q of ed.ix.snaps.filter((s) => s.kind === 'quadrant')) {
    assert.ok(Math.abs(Math.hypot(q.x - 50, q.y - 60) - 20) < 1e-7);
    assert.ok(Math.abs(q.x - 50) < 1e-7 || Math.abs(q.y - 60) < 1e-7, 'world axes after rotation');
  }
  const crossings = pieceInter(arc, { t: 's', x1: 20, y1: 60, x2: 80, y2: 60 });
  assert.equal(crossings.length, 1); assert.ok(near(crossings[0], [30, 60]));
  raw.entities[0] = W.insert('Arc', 50, 60, { sx: 2, sy: 1 });
  const stretched = makeIndex(raw, flatten(raw));
  assert.ok(stretched.ix.pieces.every((p) => p.curve));
  assert.equal(stretched.ix.snaps.filter((s) => s.kind === 'quadrant').length, 2);
});
