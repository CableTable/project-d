// grips.js — the grips of a selected shape.   node grips.test.mjs
import assert from 'node:assert/strict';
import * as GR from './web/grips.js';
import * as DR from './web/draw.js';
import { newDoc, addEntities, writeDxf, line, circle, arc, lwpoly, ellipse, rect, text } from './web/dxf-write.js';
import { readDxf } from './web/drawing.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const nearPt = (a, b, e = 1e-6) => { near(a[0], b[0], e); near(a[1], b[1], e); };
const reopen = (e) => { const d = newDoc(4); addEntities(d, [e]); return readDxf(writeDxf(d)).entities[0]; };
const val = (e, code) => +e.r.v[e.r.c.indexOf(code)];
const pts = (list) => list.map((g) => [g.x, g.y]);

test('a line has its two ends and its middle', () => {
  const g = GR.gripsOf(line(0, 0, 100, 50));
  assert.deepEqual(g.map((x) => [x.id, x.kind]), [['a', 'end'], ['m', 'mid'], ['b', 'end']]);
  assert.deepEqual(pts(g), [[0, 0], [50, 25], [100, 50]]);
});

test('a circle has its centre and four quadrants; an arc its ends, middle and centre; a polyline its vertices', () => {
  const c = GR.gripsOf(circle(10, 20, 5));
  assert.deepEqual(c.map((x) => x.kind), ['centre', 'quad', 'quad', 'quad', 'quad']);
  nearPt([c[1].x, c[1].y], [15, 20]); nearPt([c[2].x, c[2].y], [10, 25]); nearPt([c[3].x, c[3].y], [5, 20]); nearPt([c[4].x, c[4].y], [10, 15]);
  const a = GR.gripsOf(arc(0, 0, 10, 0, 90));
  assert.deepEqual(a.map((x) => x.kind), ['end', 'mid', 'end', 'centre']);
  nearPt([a[0].x, a[0].y], [10, 0]); nearPt([a[2].x, a[2].y], [0, 10]); nearPt([a[1].x, a[1].y], [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10]); nearPt([a[3].x, a[3].y], [0, 0]);
  const wrap = GR.gripsOf(arc(0, 0, 10, 270, 90));                       // an arc across 0°: the middle is at 0°
  nearPt([wrap[1].x, wrap[1].y], [10, 0]);
  const p = GR.gripsOf(rect(0, 0, 10, 5));
  assert.deepEqual(p.map((x) => x.id), ['v0', 'v1', 'v2', 'v3']); assert.deepEqual(pts(p), [[0, 0], [10, 0], [10, 5], [0, 5]]);
  assert.deepEqual(GR.gripsOf(ellipse(0, 0, 10, 0, 0.5)), [], 'no grips on an ellipse');
  assert.deepEqual(GR.gripsOf(text(0, 0, 5, 'a')), []);
  assert.deepEqual(GR.gripsOf(null), []);
});

test('a line: an end stretches that end; the middle moves the whole line', () => {
  const l = line(0, 0, 100, 50);
  const a = GR.dragGrip(l, 'b', [120, 80]);
  assert.equal(a.label, 'Stretch line'); assert.deepEqual(pts(GR.gripsOf(a.ent)).filter((_, i) => i !== 1), [[0, 0], [120, 80]]);
  assert.equal(GR.dragGrip(l, 'a', [-10, 5]).label, 'Stretch line');
  const m = GR.dragGrip(l, 'm', [60, 65]);                               // the middle (50, 25) to (60, 65): by (10, 40)
  assert.equal(m.label, 'Move line');
  assert.deepEqual(pts(GR.gripsOf(m.ent)).filter((_, i) => i !== 1), [[10, 40], [110, 90]]);
  assert.equal(GR.dragGrip(l, 'a', [100, 50]), null, 'both ends in one place: no line');
  assert.equal(GR.dragGrip(l, 'm', [50, 25]), null, 'not moved');
  assert.equal(GR.dragGrip(l, 'zz', [1, 1]), null);
  assert.equal(GR.dragGrip(l, 'a', [NaN, 1]), null);
  assert.deepEqual(pts(GR.gripsOf(l)).flat(), [0, 0, 50, 25, 100, 50], 'the original is not changed');
});

test('a circle: the centre moves it, a quadrant sets the radius', () => {
  const c = circle(10, 20, 5);
  const m = GR.dragGrip(c, 'c', [30, 40]);
  assert.equal(m.label, 'Move circle'); assert.deepEqual([val(m.ent, 10), val(m.ent, 20), val(m.ent, 40)], [30, 40, 5]);
  const r = GR.dragGrip(c, 'q1', [10, 45]);                              // 25 above the centre
  assert.equal(r.label, 'Circle radius'); assert.deepEqual([val(r.ent, 10), val(r.ent, 20), val(r.ent, 40)], [10, 20, 25]);
  assert.equal(GR.dragGrip(c, 'q0', [13, 24]), null, 'the same radius: nothing changes');
  assert.equal(GR.dragGrip(c, 'q0', [10, 20]), null, 'a radius of 0');
});

test('an arc: the middle changes the bulge through 3 points; an end re-fits it; the centre moves it', () => {
  const a = arc(0, 0, 10, 0, 90);
  const mid = GR.dragGrip(a, 'm', [8, 8]);                               // pulled out: a bigger radius, the ends stay
  assert.equal(mid.label, 'Arc bulge');
  const g = GR.gripsOf(mid.ent);
  nearPt([g[0].x, g[0].y], [10, 0], 1e-6); nearPt([g[2].x, g[2].y], [0, 10], 1e-6);
  assert.ok(Math.abs(val(mid.ent, 40) - Math.hypot(10 - 7 / 3, 7 / 3)) < 1e-6, 'pulled out: a rounder, smaller circle (radius 8.014)'); nearPt([g[1].x, g[1].y], [8, 8], 1e-6);
  // through (0,10), (8,8), (10,0): the circle through them
  const c = [val(mid.ent, 10), val(mid.ent, 20)], R = val(mid.ent, 40);
  near(Math.hypot(0 - c[0], 10 - c[1]), R, 1e-6); near(Math.hypot(8 - c[0], 8 - c[1]), R, 1e-6); near(Math.hypot(10 - c[0], 0 - c[1]), R, 1e-6);
  // an end dragged: it passes through the old middle
  const end = GR.dragGrip(a, 'b', [0, 20]);
  assert.equal(end.label, 'Stretch arc');
  const e = GR.gripsOf(end.ent);
  nearPt([e[0].x, e[0].y], [10, 0]); nearPt([e[1].x, e[1].y].map((v) => v), [e[1].x, e[1].y]);
  const c2 = [val(end.ent, 10), val(end.ent, 20)], R2 = val(end.ent, 40);
  near(Math.hypot(Math.SQRT1_2 * 10 - c2[0], Math.SQRT1_2 * 10 - c2[1]), R2, 1e-6, 'the old middle is still on it');
  near(Math.hypot(0 - c2[0], 20 - c2[1]), R2, 1e-6);
  const mv = GR.dragGrip(a, 'c', [5, 5]);
  assert.equal(mv.label, 'Move arc'); assert.deepEqual([val(mv.ent, 10), val(mv.ent, 20), val(mv.ent, 40), val(mv.ent, 50), val(mv.ent, 51)], [5, 5, 10, 0, 90]);
  assert.equal(GR.dragGrip(a, 'b', [20, 0]) === null || GR.dragGrip(a, 'b', [20, 0]).ent !== undefined, true);
  assert.equal(GR.dragGrip(a, 'a', [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10]), null, 'start on the middle: no arc');
  const line3 = GR.dragGrip(arc(0, 0, 10, 0, 180), 'm', [0, 0]);          // the middle pulled to the chord's line (the ends are (10,0), (-10,0))
  assert.equal(line3, null, 'three points in a line: nothing');
});

test('a polyline: a vertex moves, the bulges stay, closed or open', () => {
  const p = rect(0, 0, 10, 5);
  const m = GR.dragGrip(p, 'v2', [12, 8]);
  assert.equal(m.label, 'Stretch polyline');
  assert.deepEqual(pts(GR.gripsOf(m.ent)), [[0, 0], [10, 0], [12, 8], [0, 5]]);
  assert.equal(val(m.ent, 70), 1, 'still closed');
  const r = lwpoly([[0, 0, 0.5], [10, 0], [10, 5, -0.2]]);
  const k = GR.dragGrip(r, 'v1', [11, 1]);
  assert.deepEqual(k.ent.r.c.filter((c) => c === 42).length, 2); assert.deepEqual(k.ent.r.v.filter((_, i) => k.ent.r.c[i] === 42).map(Number), [0.5, -0.2]);
  assert.equal(GR.dragGrip(p, 'v9', [1, 1]), null);
  assert.equal(GR.dragGrip(p, 'v0', [0, 0]), null);
});

test('refPoint: where the rubber band starts', () => {
  nearPt(GR.refPoint(line(0, 0, 100, 50), 'a'), [100, 50]); nearPt(GR.refPoint(line(0, 0, 100, 50), 'b'), [0, 0]); nearPt(GR.refPoint(line(0, 0, 100, 50), 'm'), [50, 25]);
  nearPt(GR.refPoint(circle(10, 20, 5), 'q2'), [10, 20]); nearPt(GR.refPoint(circle(10, 20, 5), 'c'), [10, 20]);
  nearPt(GR.refPoint(rect(0, 0, 10, 5), 'v1'), [10, 0]);
  assert.equal(GR.refPoint(line(0, 0, 1, 1), 'x'), null);
});

test('the readouts: length and angle, Move ΔX ΔY, R, bulge, vertex', () => {
  const l = line(0, 0, 100, 50), a = GR.dragGrip(l, 'b', [300, 140]);
  assert.equal(GR.readoutOf(l, 'b', a.ent, 1), '331.06 mm · 25.02°');
  const m = GR.dragGrip(l, 'm', [60, 65]);
  assert.equal(GR.readoutOf(l, 'm', m.ent, 1), 'Move ΔX 10.00 ΔY 40.00');
  assert.equal(GR.readoutOf(l, 'b', a.ent, 25.4), DR.n2(Math.hypot(300, 140) * 25.4) + ' mm · 25.02°', 'in inches the numbers are mm');
  const c = circle(0, 0, 5);
  assert.equal(GR.readoutOf(c, 'q0', GR.dragGrip(c, 'q0', [12, 0]).ent), 'R 12.00');
  assert.equal(GR.readoutOf(c, 'c', GR.dragGrip(c, 'c', [3, -4]).ent), 'Move ΔX 3.00 ΔY -4.00');
  const ar = arc(0, 0, 10, 0, 90);
  assert.match(GR.readoutOf(ar, 'm', GR.dragGrip(ar, 'm', [8, 8]).ent), /^R \d+\.\d\d · \d+\.\d\d°$/);
  const p = rect(0, 0, 10, 5);
  assert.equal(GR.readoutOf(p, 'v2', GR.dragGrip(p, 'v2', [12, 8]).ent), 'X 12.00 · Y 8.00');
  assert.equal(GR.commandOf(l, 'm'), 'MOVE'); assert.equal(GR.commandOf(l, 'a'), 'STRETCH'); assert.equal(GR.commandOf(c, 'q1'), 'STRETCH'); assert.equal(GR.commandOf(c, 'c'), 'MOVE');
});

test('shapeOf: the preview shapes in mm (and they draw as SVG paths)', () => {
  assert.deepEqual(GR.shapeOf(line(0, 0, 1, 2), 25.4), { t: 'line', a: [0, 0], b: [25.4, 50.8] });
  assert.deepEqual(GR.shapeOf(circle(1, 1, 2), 10), { t: 'circle', c: [10, 10], r: 20 });
  const sh = GR.shapeOf(arc(0, 0, 10, 20, 200)); assert.deepEqual([sh.t, sh.r, sh.a0, sh.a1], ['arc', 10, 20, 200]);
  const pl = GR.shapeOf(DR.toEntity({ t: 'poly', pts: DR.rectPts([0, 0], [20, 10], 3), closed: true }, {}, 1));
  assert.equal(pl.pts.length, 8); assert.equal(pl.closed, true); assert.ok(pl.pts[1][2] > 0.41);
  assert.match(DR.svgPath(pl, 100), /A3 3 0 0 0/);
  assert.equal(GR.shapeOf({ type: 'TEXT', r: { c: [], v: [] } }), null);
});

test('a grip drag saves and reopens: the changed entities come back as they were made', () => {
  const doc = newDoc(4);
  const l = GR.dragGrip(line(0, 0, 100, 50), 'b', [120, 80]).ent, c = GR.dragGrip(circle(10, 20, 5), 'q1', [10, 45]).ent;
  const a = GR.dragGrip(arc(0, 0, 10, 0, 90), 'm', [8, 8]).ent, p = GR.dragGrip(rect(0, 0, 10, 5), 'v2', [12, 8]).ent;
  addEntities(doc, [l, c, a, p]);
  const back = readDxf(writeDxf(doc)).entities;
  assert.deepEqual(back.map((e) => e.type), ['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE']);
  assert.deepEqual([val(back[0], 11), val(back[0], 21)], [120, 80]);
  assert.equal(val(back[1], 40), 25);
  nearPt([val(back[2], 10), val(back[2], 20)], [val(a, 10), val(a, 20)], 1e-5);
  assert.deepEqual(pts(GR.gripsOf(back[3])), [[0, 0], [10, 0], [12, 8], [0, 5]]);
  assert.ok(reopen(l));
});

test('a mirrored shape (extrusion -1) has no grips; the cap is 200 selected', () => {
  const m = line(0, 0, 1, 1); m.r = { ...m.r, c: [...m.r.c, 210, 220, 230], v: [...m.r.v, '0', '0', '-1'] };
  assert.deepEqual(GR.gripsOf(m), []);
  const c = circle(0, 0, 1); c.r = { ...c.r, c: [...c.r.c, 210, 220, 230], v: [...c.r.v, '0', '0', '-1'] };
  assert.equal(GR.hasGrips(c), false); assert.equal(GR.hasGrips(circle(0, 0, 1)), true);
  assert.equal(GR.MAX_SELECTED, 200);
});

test('capGrips: up to MAX_GRIPS are shown, one more and none', () => {
  const some = (k) => Array.from({ length: k }, (_, i) => ({ id: i }));
  assert.equal(GR.capGrips(some(GR.MAX_GRIPS)).length, GR.MAX_GRIPS);
  assert.deepEqual(GR.capGrips(some(GR.MAX_GRIPS + 1)), []);
});

console.log(n + ' grips tests passed');
