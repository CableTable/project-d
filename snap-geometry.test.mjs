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
  assert.equal(pick(snapTypes({ intersection: false })).kind, 'near');
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
