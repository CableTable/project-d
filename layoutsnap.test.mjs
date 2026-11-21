import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutSnap, layoutTangentObject, layoutCandidates, gripperLines, partEdgeSnap } from './web/layoutsnap.js';
import { makePart } from './web/layoutdoc.js';
import { newDoc, addEntities, rect, circle, arc } from './web/dxf-write.js';
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

test('TODO 348: the gripper lines are end / mid / nearest targets (y up, top line at H - gripTop); a side with gripper 0 has none', () => {
  const grip = { gripTop: 20, gripRight: 0, gripBottom: 0, gripLeft: 10 };
  const g = (x, y, s = grip) => layoutSnap(parts, [], 400, 300, x, y, 0.5, undefined, null, s);
  at(g(10.2, 279.9), 10, 280, 'end');
  at(g(205.1, 280.2), 205, 280, 'mid');
  at(g(300, 280.3), 300, 280, 'near');
  at(g(10.2, 140.1), 10, 140, 'mid');
  at(g(9.8, 60), 10, 60, 'near');
  assert.equal(g(200, 15), null, 'bottom gripper 0: no line');
  assert.equal(g(390.2, 150), null, 'right gripper 0: no line');
  assert.equal(g(300, 280.3, null), null, 'no grippers given: no lines');
  assert.equal(g(300, 280.3, { ...grip, gripTop: 0 }), null, 'top gripper 0: no line');
  assert.deepEqual(gripperLines(400, 300, grip), [[[10, 280], [400, 280], 'top'], [[10, 0], [10, 280], 'left']]);
  const c = layoutCandidates(parts, [], 400, 300, 300, 280.2, 0.5, undefined, null, true, grip);
  assert.equal(c.object, 'gripper'); assert.equal(c.e, 0);
  assert.deepEqual(c.candidates.map((q) => q.kind).sort(), ['end', 'end', 'mid', 'near']);
});

test('TODO 150: intersection where placed parts cross, a part crosses the sheet edge or a gripper line (kind intersection, exact point)', () => {
  const A = { partId: 'p', x: 100, y: 100 }, B = { partId: 'p', x: 150, y: 110 };       // 80 × 40 bars: x 100…180 / 150…230, y 100…140 / 110…150
  at(snap([A, B], 180.1, 110.1), 180, 110, 'intersection');
  at(snap([A, B], 149.9, 140.1), 150, 140, 'intersection');
  at(snap([{ partId: 'p', x: 150, y: 100, rot: 90 }, { partId: 'p', x: 100, y: 130 }], 150.1, 130.1), 150, 130, 'intersection');   // A turned: x 110…150, y 100…180
  const C = { partId: 'p', x: 144, y: 110 };                                           // its left side x = 144 cuts A's circle (centre (140, 120), r 8) at y = 120 ± √48
  at(snap([A, C], 144.05, 120 + Math.sqrt(48) + 0.05), 144, 120 + Math.sqrt(48), 'intersection');
  const qraw = newDoc(4), rraw = newDoc(4);
  addEntities(qraw, [arc(0, 0, 10, 0, 90)]); addEntities(rraw, [rect(0, 0, 5, 10)]);   // a quarter arc (r 20 mm, centre at its box corner) and a 10 × 20 mm bar
  const qp = { q: makePart('q', 'Q', qraw, 2), r: makePart('r', 'R', rraw, 2) }, y17 = 100 + Math.sqrt(300);
  for (const [q, bx] of [[{ partId: 'q', x: 100, y: 100 }, 110], [{ partId: 'q', x: 100, y: 100, mirrorX: true }, 90]])   // a mirror turns the arc's sweep round (it lands left of x 100)
    at(layoutSnap(qp, [q, { partId: 'r', x: bx, y: 100 }], 400, 300, bx + 0.05, y17 + 0.05, 0.5), bx, y17, 'intersection');
  at(snap([{ partId: 'p', x: -20, y: 100 }], 0.1, 100.1), 0, 100, 'intersection');       // over the left sheet edge
  const grip = { gripTop: 20, gripRight: 0, gripBottom: 0, gripLeft: 0 };
  at(layoutSnap(parts, [{ partId: 'p', x: 100, y: 250 }], 400, 300, 100.1, 280.1, 0.5, undefined, null, grip), 100, 280, 'intersection');
  assert.equal(snap([A, { ...B, y: 200 }], 180.1, 110.1, 0.5)?.kind, 'near', 'apart: A\'s own side only');
  const c = layoutCandidates(parts, [A, B], 400, 300, 180.1, 110.1, 0.5, undefined, null, true).candidates;
  assert.ok(c.some((q) => q.kind === 'intersection' && Math.abs(q.x - 180) < 1e-8 && Math.abs(q.y - 110) < 1e-8), 'Tab lists the crossing');
  const e = layoutCandidates(parts, [{ partId: 'p', x: -20, y: 100 }], 400, 300, 0.1, 100.3, 0.5, undefined, null, true);
  assert.ok(e.object.partId && e.candidates.some((q) => q.kind === 'intersection' && Math.abs(q.x) < 1e-8 && Math.abs(q.y - 100) < 1e-8), 'the part\'s Tab list has its crossing with the sheet edge');
  assert.equal(layoutSnap(parts, [A, B], 400, 300, 180.1, 110.1, 0.5, snapTypes({ intersection: false })).kind, 'near', 'tick off: no crossing');
});

test('TODO 348: a part\'s nearest outer edge on an axis, from its real (turned) outline', () => {
  const p = { partId: 'p', x: 150, y: 100, rot: 90 };                   // the 80 × 40 part turned: x 110 … 150, y 100 … 180
  assert.equal(partEdgeSnap(parts, [p], 'x', 150.3, 0.5), 150);
  assert.equal(partEdgeSnap(parts, [p], 'x', 109.6, 0.5), 110);
  assert.equal(partEdgeSnap(parts, [p], 'y', 180.4, 0.5), 180);
  assert.equal(partEdgeSnap(parts, [p], 'y', 99.9, 0.5), 100);
  assert.equal(partEdgeSnap(parts, [p], 'x', 130, 0.5), null, 'inside the part: no outer edge near');
  assert.equal(partEdgeSnap(parts, [{ partId: 'missing', x: 0, y: 0 }], 'x', 0, 5), null);
  const ring = newDoc(4); addEntities(ring, [circle(0, 0, 4)]);
  const rp = { r: makePart('r', 'Ring', ring, 2) }, turned = [{ partId: 'r', x: 100, y: 100, rot: 45 }];
  const lo = partEdgeSnap(rp, turned, 'x', -1e6, 1e9), hi = partEdgeSnap(rp, turned, 'x', 1e6, 1e9);
  assert.ok(Math.abs(hi - lo - 16) < 1e-6, `a turned circle is 16 mm across, not its turned box's ${16 * Math.SQRT2}: ${hi - lo}`);
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
