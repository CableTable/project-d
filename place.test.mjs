// place.js — moving, turning, mirroring and copying a placed part.   node place.test.mjs
import assert from 'node:assert/strict';
import * as P from './web/place.js';
import { placedBox, placedMat, placement1 } from './web/apply.js';
import * as AR from './web/array.js';

const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, a + ' != ' + b);
const nearPt = (a, b, t = 1e-5) => { near(a[0], b[0], t); near(a[1], b[1], t); };
let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const part = { w: 100, h: 60 };
const pl = (x, y, rot = 0, mx = false, my = false) => placement1('a', x, y, rot, mx, my);
const sortPts = (pts) => pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const samePts = (a, b, msg) => { const x = sortPts(a), y = sortPts(b); assert.equal(x.length, y.length, msg); x.forEach((p, i) => nearPt(p, y[i], 1e-4)); };

test('angles: normalised to 0 ≤ a < 360, typed text parsed', () => {
  assert.equal(P.normAngle(360), 0); assert.equal(P.normAngle(-90), 270); assert.equal(P.normAngle(725), 5); assert.equal(P.normAngle(359.9999999), 0);
  assert.equal(P.parseMm('12,5'), 12.5); assert.equal(P.parseMm(' -3 '), -3); assert.equal(P.parseMm('12 mm'), 12);
  assert.equal(P.parseMm(''), null); assert.equal(P.parseMm('abc'), null); assert.equal(P.parseMm('1e3'), null); assert.equal(P.parseMm('--2'), null);
  assert.equal(P.parseAngle('30°'), 30); assert.equal(P.parseAngle('-15.5'), -15.5); assert.equal(P.parseAngle('x°'), null);
  assert.equal(P.snapAngle(22), 15); assert.equal(P.snapAngle(23), 30); assert.equal(P.snapAngle(-7), 0); assert.equal(P.snapAngle(-8), 345);
  near(P.turnBetween(350, 10), 20); near(P.turnBetween(10, 350), -20); near(P.turnBetween(0, 180), 180);
  near(P.angleOf([0, 0], [0, 5]), 90); near(P.angleOf([10, 10], [0, 10]), 180);
});

test('snapGrid: new parts land on whole mm (TODO 45, his pick)', () => {
  assert.equal(P.NEW_GRID, 1);
  assert.equal(P.snapGrid(441.2), 441); assert.equal(P.snapGrid(442.6), 443); assert.equal(P.snapGrid(-0.2), 0); assert.ok(Object.is(P.snapGrid(-0.2), 0));
  assert.equal(P.snapGrid(441.2, 5), 440);
  assert.equal(P.snapGrid(7, 1), 7); assert.equal(P.snapGrid(7.4, 1), 7);
});

test('corners, centre and the box of a turned part', () => {
  const p = pl(200, 150, 90);                                   // turned a quarter about its lower-left corner: it now stands to the left of it
  const c = P.corners(part, p);
  nearPt(c[0], [200, 150]); nearPt(c[1], [200, 250]); nearPt(c[2], [140, 250]); nearPt(c[3], [140, 150]);
  nearPt(P.centreOf(part, p), [170, 200]);
  const b = placedBox(part, p);
  near(b[0], 140); near(b[1], 150); near(b[2], 200); near(b[3], 250);
  assert.equal(P.handlePoints(part, p).length, 8);
  nearPt(P.handlePoints(part, p)[4], [200, 200]);              // bottom mid-side (the side the corner starts), turned
});

test('rotate about a pivot: the pivot stays put, the angle adds, a full turn comes back', () => {
  for (const kind of ['centre', 'bl']) {
    const p0 = pl(200, 150, 10, true, false), pv = P.pivotOf(part, p0, kind);
    const p1 = P.rotateAbout(part, p0, pv, 37);
    nearPt(P.pivotOf(part, p1, kind), pv);
    near(p1.rot, 47);
    const p2 = P.rotateAbout(part, p1, pv, 323);
    near(p2.rot, 10); near(p2.x, 200); near(p2.y, 150);
  }
  // about a point off the part
  const p = P.rotateAbout(part, pl(100, 0), [0, 0], 90);
  near(p.x, 0); near(p.y, 100); near(p.rot, 90);
  // to an angle
  const q = P.setAngleAbout(part, pl(200, 150, 30), P.centreOf(part, pl(200, 150, 30)), 75);
  near(q.rot, 75); nearPt(P.centreOf(part, q), P.centreOf(part, pl(200, 150, 30)));
  assert.equal(P.setAngleAbout(part, pl(5, 5, 45), [5, 5], -45).rot, 315);
  assert.deepEqual(P.pivotOf(part, pl(1, 2), 'custom', [7, 8]), [7, 8]);
});

test('mirror about the part\'s centre: the same corners reflected, twice is the start, the centre stays', () => {
  for (const rot of [0, 30, 90, 200]) for (const [mx, my] of [[false, false], [true, false], [false, true], [true, true]]) {
    const p = pl(210, 120, rot, mx, my), c = P.centreOf(part, p), before = P.corners(part, p);
    const fx = P.mirrorAbout(part, p, 'x');
    nearPt(P.centreOf(part, fx), c);
    samePts(P.corners(part, fx), before.map(([x, y]) => [2 * c[0] - x, y]), `x at ${rot}`);
    const fy = P.mirrorAbout(part, p, 'y');
    samePts(P.corners(part, fy), before.map(([x, y]) => [x, 2 * c[1] - y]), `y at ${rot}`);
    const back = P.mirrorAbout(part, fx, 'x');
    assert.ok(P.samePlacement(back, p), 'twice is the start');
    assert.equal(fx.mirrorX, !p.mirrorX); assert.equal(fy.mirrorY, !p.mirrorY);
  }
  const f = P.mirrorAbout(part, pl(0, 0), 'x');
  near(f.x, 100); assert.equal(f.mirrorX, true);                // an upright part mirrored left to right: its corner is now on the right
});

test('move: the box\'s lower-left goes where typed, turned or not; a nudge', () => {
  const p = P.moveBoxTo(part, pl(200, 150, 30), 10, 20);
  const b = placedBox(part, p);
  near(b[0], 10); near(b[1], 20); near(p.rot, 30);
  const q = P.moveBoxTo(part, pl(200, 150), 0, 0);
  near(q.x, 0); near(q.y, 0);
  assert.deepEqual(P.nudgeVector('left', 1, false), [-1, 0]); assert.deepEqual(P.nudgeVector('up', 0.5, true), [0, 5]);
  assert.deepEqual(P.nudgeVector('down', 2, false), [0, -2]); assert.deepEqual(P.nudgeVector('right', 1, true), [10, 0]);
  const t = P.translate(pl(0.1, 0.2), 0.2, 0.1);
  assert.equal(t.x, 0.3); assert.equal(t.y, 0.3);               // no 0.30000000000000004
});

test('duplicate in a row: copies a gap apart, edge to edge, along X or Y; a turned part uses its box', () => {
  const row = P.duplicateRow(part, pl(10, 20), 'x', 5, 3);
  assert.deepEqual(row.map((p) => [p.x, p.y]), [[115, 20], [220, 20], [325, 20]]);
  const col = P.duplicateRow(part, pl(10, 20), 'y', 0, 2);
  assert.deepEqual(col.map((p) => [p.x, p.y]), [[10, 80], [10, 140]]);
  assert.deepEqual(P.duplicateRow(part, pl(400, 300), '-x', 5, 2).map((p) => [p.x, p.y]), [[295, 300], [190, 300]], 'to the left');
  assert.deepEqual(P.duplicateRow(part, pl(400, 300), '-y', 0, 1).map((p) => [p.x, p.y]), [[400, 240]], 'downwards');
  const turned = P.duplicateRow(part, pl(200, 100, 90), 'x', 10, 1);       // a turned part is 60 wide on the sheet
  near(turned[0].x, 270); near(turned[0].y, 100); near(turned[0].rot, 90);
  const m = P.duplicateRow(part, pl(0, 0, 0, true, true), 'x', 5, 1);
  assert.equal(m[0].mirrorX, true); assert.equal(m[0].mirrorY, true);
  assert.deepEqual(P.duplicateRow(part, pl(0, 0), 'x', 5, 0), []);
  // the copies are new placements; the original is untouched
  const o = pl(1, 1); P.duplicateRow(part, o, 'x', 1, 2); assert.equal(o.x, 1);
});

test('off the sheet: any part of the box outside 0..W × 0..H', () => {
  assert.equal(P.offSheet(part, pl(0, 0), 1000, 700), false);
  assert.equal(P.offSheet(part, pl(900, 640), 1000, 700), false, 'exactly touching is on the sheet');
  assert.equal(P.offSheet(part, pl(901, 640), 1000, 700), true);
  assert.equal(P.offSheet(part, pl(-0.5, 0), 1000, 700), true);
  assert.equal(P.offSheet(part, pl(60, 0, 90), 1000, 700), false, 'turned 90° about its corner it reaches 60 to the left');
  assert.equal(P.offSheet(part, pl(59, 0, 90), 1000, 700), true);
});

test('the preview matrix and the maths agree: a corner of the part lands in the same place', () => {
  const sheetH = 700, bp = { factor: 1, box: [0, 0, 100, 60], w: 100, h: 60 };
  for (const rot of [0, 17, 90, 123.5, 270]) for (const [mx, my] of [[false, false], [true, false], [false, true], [true, true]]) {
    const p = pl(210, 120, rot, mx, my), M = placedMat(bp, p, sheetH);
    [[0, 0], [100, 0], [100, 60], [30, 45]].forEach(([u, v]) => {
      const q = [M[0] * u + M[2] * v + M[4], M[1] * u + M[3] * v + M[5]], want = P.toSheet(p, u, v);
      nearPt([q[0], sheetH - q[1]], want);
    });
  }
});

test('TODO 71b: rotated outline box selection rejects bbox-only overlap and includes containment and touches', () => {
  const square = { w: 80, h: 80 }, p = pl(140, 80, 45), miss = [85, 85, 105, 100];
  const bbox = placedBox(square, p);
  assert.ok(bbox[0] < miss[2] && bbox[2] > miss[0] && bbox[1] < miss[3] && bbox[3] > miss[1]);
  assert.equal(P.boxHit(square, p, miss, true), false, '45 degree bbox corner is empty');
  assert.equal(P.boxHit(square, p, [75, 70, 205, 205]), true, 'window contains all rotated corners');
  assert.equal(P.boxHit(square, p, [130, 70, 210, 110]), false, 'window misses most of the part');
  assert.equal(P.boxHit(square, p, [130, 70, 210, 110], true), true, 'crossing meets a rotated edge');
  for (const rot of [0, 45, 90, 173, 270]) for (const mx of [false, true]) for (const my of [false, true]) {
    const q = pl(200, 200, rot, mx, my), [x, y] = P.centreOf(square, q), inner = [x - 1, y - 1, x + 1, y + 1];
    assert.equal(P.boxHit(square, q, inner, true), true, 'box inside a larger part crosses');
    assert.equal(P.boxHit(square, q, inner), false, 'box inside a larger part is no window hit');
    assert.equal(P.boxHit(square, q, placedBox(square, q)), true, 'window exactly on bbox includes boundary');
    assert.equal(P.boxHit(square, q, [500, 500, 510, 510], true), false, 'bbox prefilter rejects distant parts');
    assert.equal(P.boxHit(square, q, [200, 200, 201, 201], true), true, 'touching an outline corner counts');
  }
  assert.equal(P.boxHit(square, pl(0, 0), [80, 10, 90, 20], true), true, 'shared edge counts');
  assert.equal(P.boxHit(square, pl(0, 0), [80.01, 10, 90, 20], true), false, 'a gap is not a touch');
  const thin = { w: 100, h: 4 };
  assert.equal(P.boxHit(thin, pl(0, 0, 45), [30, 0, 40, 60], true), true, 'edges cross without any corner inside');
});

test('TODO 156b1: a placement scale grows the box about the INSERT point, and the matrix agrees', () => {
  const s = { ...pl(10, 20), sc: 2 };
  assert.deepEqual(placedBox(part, s), [10, 20, 210, 140]);
  assert.deepEqual(placedBox(part, pl(10, 20)), [10, 20, 110, 80], 'no sc = 1');
  nearPt(P.toSheet(s, 100, 60), [210, 140]);
  const m = placedMat(part, s, 500);
  near(m[0], 2); near(m[3], -2);
});

test('TODO 156b1: scaleAbout a point: position and size scale about it, a scale back to 1 leaves no sc, a mirror and a turn are kept', () => {
  const a = P.scaleAbout(part, pl(10, 20, 30, true), [0, 0], 2);
  assert.equal(a.sc, 2); near(a.x, 20); near(a.y, 40); assert.equal(a.rot, 30); assert.equal(a.mirrorX, true);
  const b = P.scaleAbout(part, a, [0, 0], 0.5);
  assert.equal('sc' in b, false); near(b.x, 10); near(b.y, 20);
  const c = P.scaleAbout(part, { ...pl(50, 50), sc: 2 }, [50, 50], 1.5);
  assert.equal(c.sc, 3); near(c.x, 50); near(c.y, 50);
  const bx = placedBox(part, P.scaleAbout(part, pl(10, 20), [10, 20], 3));
  assert.deepEqual(bx, [10, 20, 310, 200], 'about its own lower-left corner');
  assert.equal(P.samePlacement(pl(1, 2), { ...pl(1, 2), sc: 2 }), false);
  assert.equal(P.samePlacement(pl(1, 2), pl(1, 2)), true);
});

test('TODO 156b1: mirror about a slanted line: every corner lands on its mirror image, twice is the identity', () => {
  const a = [10, 5], b = [60, 55];                         // 45° line
  const refl = ([x, y]) => { const dx = x - a[0], dy = y - a[1]; return [a[0] + dy, a[1] + dx]; };
  for (const start of [pl(100, 40), pl(100, 40, 25), pl(100, 40, 70, true, false), { ...pl(100, 40, 10, false, true), sc: 1.5 }]) {
    const m = P.mirrorAboutLine(part, start, a, b);
    samePts(P.corners(part, m), P.corners(part, start).map(refl), 'corners');
    const back = P.mirrorAboutLine(part, m, a, b);
    samePts(P.corners(part, back), P.corners(part, start), 'twice');
  }
  // a horizontal line through y = 30: the box is flipped top to bottom
  const h = P.mirrorAboutLine(part, pl(0, 40), [0, 30], [10, 30]);
  assert.deepEqual(placedBox(part, h), [0, -40, 100, 20]);
});

test('TODO 156b1: move and copy offsets, array counts', () => {
  const m = P.translate(pl(10, 10), 5, -3);
  assert.deepEqual([m.x, m.y], [15, 7]);
  assert.equal(AR.rectOffsets({ cols: 2, rows: 2, dx: 120, dy: 80 }).length, 3, '2 x 2 adds 3 copies');
  assert.deepEqual(AR.rectOffsets({ cols: 2, rows: 2, dx: 120, dy: 80 }), [[120, 0], [0, 80], [120, 80]]);
  const ring = AR.polarPlacements([0, 0], [50, 0], { items: 4, fill: 360, rotate: true }).map(({ deg }) => P.rotateAbout(part, pl(50, 0), [0, 0], deg));
  assert.equal(ring.length, 3); nearPt([ring[0].x, ring[0].y], [0, 50]); assert.equal(ring[0].rot, 90);
});

console.log(n + ' tests passed');
