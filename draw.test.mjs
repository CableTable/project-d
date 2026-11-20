// draw.js — the drawing tools' geometry and typed input.   node draw.test.mjs
import assert from 'node:assert/strict';
import * as DR from './web/draw.js';
import { overlapArea } from './web/cmdbar.js';
import { movePoint } from './web/move.js';
import { readDxf, flatten } from './web/drawing.js';
import { newDoc, addEntities, writeDxf } from './web/dxf-write.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const nearPt = (a, b, e = 1e-6) => { near(a[0], b[0], e); near(a[1], b[1], e); };

test('dynamicInputPlacement: both sides, edge flip, radius and box clamps, short segments', () => {
  const canvas = { w: 800, h: 600 }, boxes = { length: [120, 30], angle: [110, 30] };
  const place = (a, b) => DR.dynamicInputPlacement(a, b, canvas, boxes);
  let p = place([200, 300], [400, 300]);
  nearPt(p.length, [300, 276]); nearPt(p.angle, [280, 310]); near(p.arc.radius, 80);       // 300 would cover the Length box: moved 4 px clear
  assert.deepEqual(p.line, [[200, 276], [400, 276]]);
  assert.deepEqual(p.extensions, [[[200, 300], [200, 270]], [[400, 300], [400, 270]]]);
  p = place([400, 300], [200, 300]);
  nearPt(p.length, [300, 324]); nearPt(p.angle, [400, 220]); near(p.arc.angle, Math.PI);
  for (const sign of [-1, 1]) {
    p = place([250, 300], [350, 300 + sign * 100]);
    nearPt(p.length, [300 + sign * 24 / Math.SQRT2, 300 + sign * 50 - 24 / Math.SQRT2]);
    near(DR.dist(p.arc.c, p.angle), p.arc.radius);
    near(p.arc.angle, (sign < 0 ? 45 : 315) / 180 * Math.PI);
  }
  p = place([200, 20], [400, 20]); nearPt(p.length, [300, 44]);
  assert.deepEqual(p.line, [[200, 44], [400, 44]], 'off-canvas left normal flips');
  near(place([200, 300], [240, 300]).arc.radius, 30);
  near(place([200, 300], [700, 300]).arc.radius, 120);
  p = place([0, 0], [100, 0]); nearPt(p.length, [64, 24]); nearPt(p.angle, [59, 58]);
  assert.equal(place([200, 300], [220, 300]), null);
  assert.equal(place([200, 300], [239.99, 300]), null);
  assert.equal(place([200, 300], [200, 300]), null);
});

test('dynamicInputPlacement: Length and Angle boxes never overlap, segments 40-800 px at 10 angles', () => {
  const canvas = { w: 2000, h: 1600 }, boxes = { length: [140, 39], angle: [140, 39] }, c = [1000, 800];
  const rect = (p, size) => [p[0] - size[0] / 2, p[1] - size[1] / 2, p[0] + size[0] / 2, p[1] + size[1] / 2];
  let n = 0;
  for (let len = 41; len <= 800; len += 10) for (const deg of [0, 10, 30, 45, 90, 135, 180, 225, 270, 330]) {
    const b = [c[0] + len * Math.cos(deg / 180 * Math.PI), c[1] - len * Math.sin(deg / 180 * Math.PI)], p = DR.dynamicInputPlacement(c, b, canvas, boxes);
    assert.equal(overlapArea(rect(p.length, boxes.length), rect(p.angle, boxes.angle)), 0, `${len} px at ${deg}°`); n++;
  }
  assert.equal(n, 760);
});

test('dynamicInputPlacement: Rectangle and Rounded rectangle Width / Height in all four quadrants', () => {
  const canvas = { w: 800, h: 600 }, boxes = { length: [120, 30], angle: [110, 30] };
  for (const kind of ['rect', 'rrect']) {
    const place = (a, b) => DR.dynamicInputPlacement(a, b, canvas, boxes, kind);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const a = [400, 300], b = [400 + sx * 200, 300 + sy * 100], top = Math.min(a[1], b[1]);
      const p = place(a, b);
      nearPt(p.length, [400 + sx * 100, top - 24]);
      nearPt(p.angle, [b[0] + sx * 24, 300 + sy * 50]);
      assert.deepEqual(p.line, [[a[0], top - 24], [b[0], top - 24]]);
      assert.deepEqual(p.heightLine, [[b[0] + sx * 24, a[1]], [b[0] + sx * 24, b[1]]]);
      assert.equal(p.extensions.length, 4); assert.equal(p.arc, undefined);
    }
    nearPt(place([400, 300], [0, 0]).length, [200, 19]);
    nearPt(place([400, 300], [0, 0]).angle, [59, 150]);
    nearPt(place([400, 300], [800, 600]).angle, [741, 450]);
    assert.equal(place([400, 300], [420, 320]), null);
    assert.equal(place([400, 300], [439.99, 339.99]), null);
    assert.equal(place([400, 300], [400, 300]), null);
    assert.equal(place([400, 300], [420, 400]).length, null);
    assert.equal(place([400, 300], [500, 320]).angle, null);
    assert.ok(place([400, 300], [440, 340]).length);
    assert.ok(place([400, 300], [440, 340]).angle);
  }
});

test('dynamicInputPlacement: Circle Radius / Diameter midpoint, clamps and short radii', () => {
  const place = (a, b) => DR.dynamicInputPlacement(a, b, { w: 800, h: 600 }, { length: [120, 30] }, 'circle');
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const a = [400, 300], b = [400 + sx * 200, 300 + sy * 100], p = place(a, b);
    nearPt(p.length, [400 + sx * 100, 300 + sy * 50]);
    assert.deepEqual(p.line, [a, b]); assert.deepEqual(p.extensions, []);
    assert.equal(p.angle, undefined); assert.equal(p.arc, undefined);
  }
  nearPt(place([0, 0], [40, 0]).length, [64, 19]);
  nearPt(place([800, 600], [760, 600]).length, [736, 581]);
  assert.equal(place([400, 300], [439.99, 300]), null);
  assert.equal(place([400, 300], [400, 300]), null);
});

test('dynamicInputPlacement: Measure tag sits 24 px off the line (near edge), flips at the canvas edge, null under 40 px', () => {
  const place = (a, b) => DR.dynamicInputPlacement(a, b, { w: 800, h: 600 }, { length: [120, 30], angle: [120, 30] }, 'tag');
  nearPt(place([300, 300], [500, 300]).length, [400, 261]);          // above the line: 24 + half the 30 px height
  nearPt(place([500, 300], [300, 300]).length, [400, 339]);          // the normal follows the direction
  nearPt(place([400, 100], [400, 300]).length, [484, 200]);          // a vertical line: 24 + half the 120 px width, so the tag clears the line
  nearPt(place([300, 30], [500, 30]).length, [400, 69]);             // no room above: flips below
  nearPt(place([760, 100], [760, 300]).length, [676, 200]);          // no room to the right: flips left
  assert.equal(place([400, 300], [439.99, 300]), null);
});

test('parseInput: x,y, @dx,dy, polar, a length, words, Enter', () => {
  assert.deepEqual(DR.parseInput('10,20'), { kind: 'xy', rel: false, abs: false, x: 10, y: 20 });
  assert.deepEqual(DR.parseInput(' 10 , -20.5 '), { kind: 'xy', rel: false, abs: false, x: 10, y: -20.5 });
  assert.deepEqual(DR.parseInput('@5,-3'), { kind: 'xy', rel: true, abs: false, x: 5, y: -3 });
  assert.deepEqual(DR.parseInput('#5,-3'), { kind: 'xy', rel: false, abs: true, x: 5, y: -3 });
  assert.deepEqual(DR.parseInput('@ .5,1'), { kind: 'xy', rel: true, abs: false, x: 0.5, y: 1 });
  assert.deepEqual(DR.parseInput('@100<45'), { kind: 'polar', rel: true, abs: false, len: 100, ang: 45 });
  assert.deepEqual(DR.parseInput('#100<45'), { kind: 'polar', rel: false, abs: true, len: 100, ang: 45 });
  assert.deepEqual(DR.parseInput('100<-30'), { kind: 'polar', rel: false, abs: false, len: 100, ang: -30 });
  assert.deepEqual(DR.parseInput('75'), { kind: 'len', v: 75 });
  assert.deepEqual(DR.parseInput('-2.5'), { kind: 'len', v: -2.5 });
  assert.deepEqual(DR.parseInput('C'), { kind: 'word', w: 'c' });
  assert.deepEqual(DR.parseInput('d 40'), { kind: 'word', w: 'd 40' });
  assert.deepEqual(DR.parseInput(''), { kind: 'enter' });
  assert.deepEqual(DR.parseInput('   '), { kind: 'enter' });
  assert.equal(DR.parseInput('1,2,3').kind, 'bad');
  assert.equal(DR.parseInput('12abc').kind, 'bad');
});

test('typedPoint and directDistance', () => {
  assert.deepEqual(DR.typedPoint(DR.parseInput('3,4'), [10, 10]), [3, 4]);
  assert.deepEqual(DR.typedPoint(DR.parseInput('@3,4'), [10, 10]), [13, 14]);
  nearPt(DR.typedPoint(DR.parseInput('@10<90'), [1, 1]), [1, 11]);
  nearPt(DR.typedPoint(DR.parseInput('10<180'), [1, 1]), [-10, 0]);
  nearPt(DR.directDistance([0, 0], [3, 4], 10), [6, 8]);
  nearPt(DR.directDistance([5, 5], [5, -50], 2), [5, 3]);
  assert.equal(DR.directDistance([5, 5], [5, 5], 2), null, 'the pointer is on the last point: no direction');
  assert.equal(DR.directDistance([5, 5], null, 2), null);
  for (const text of ['9'.repeat(310) + ',0', '@' + '9'.repeat(310) + '<90', '1<' + '9'.repeat(310)]) {
    assert.equal(DR.typedPoint(DR.parseInput(text), [1, 2]), null, 'non-finite point rejected');
  }
});

test('Rectangle: # is an absolute corner; plain and @ pairs stay sizes', () => {
  for (const kind of ['rect', 'rrect']) {
    for (const [text, end] of [['#130,120', [130, 120]], ['130,120', [230, 220]], ['@130,120', [230, 220]]]) {
      const T = DR.createTool(kind);
      if (kind === 'rrect') DR.toolType(T, '0');
      DR.toolType(T, '100,100');
      const r = DR.toolType(T, text);
      assert.deepEqual(r.made[0].pts, [[100, 100], [end[0], 100], end, [100, end[1]]], `${kind}: ${text}`);
    }
  }
});

test('Move / Copy: # is an absolute target; plain pairs use base and @ uses last', () => {
  assert.deepEqual(movePoint('#50,60', [10, 10]), [50, 60]);
  assert.deepEqual(movePoint('50,60', [10, 10]), [60, 70]);
  assert.deepEqual(movePoint('@50,60', [10, 10]), [60, 70]);
  assert.deepEqual(movePoint('#50,60', [10, 10], null, [20, 30]), [50, 60]);
  assert.deepEqual(movePoint('50,60', [10, 10], null, [20, 30]), [60, 70]);
  assert.deepEqual(movePoint('@50,60', [10, 10], null, [20, 30]), [70, 90]);
});

test('rectangle sizes reject non-finite points and keep the first corner for a retry', () => {
  for (const kind of ['rect', 'rrect']) {
    const T = DR.createTool(kind);
    DR.toolClick(T, [20, 30]);
    for (const prefix of ['', '@']) {
      assert.equal(DR.toolType(T, prefix + '9'.repeat(310) + ',10').made, null);
      nearPt(T.last, [20, 30]);
    }
    assert.ok(DR.toolType(T, '@40,20').made);
  }
});

test('relative points retain the last accepted pick across shapes and Undo, never a refused point', () => {
  const T = DR.createTool('circle');
  DR.toolType(T, '@20,30'); DR.toolType(T, '@10<0');
  DR.toolType(T, '@5,5');
  nearPt(T.pts[0], [35, 35]);
  DR.toolType(T, '@0,0');
  nearPt(T.last, [35, 35]);
  DR.toolType(T, 'u');
  assert.equal(T.last, null);
  const L = DR.createTool('line');
  DR.toolType(L, '20,30'); DR.toolType(L, '@10,0');
  DR.toolUndoSeg(L); DR.toolType(L, '@0,10');
  nearPt(L.pts[0], [20, 40]);
});

test('arcThrough3: centre, radius and the ends of the anticlockwise arc', () => {
  // quarter circle of radius 10 about the origin, from (10,0) through (7.07,7.07) to (0,10)
  let a = DR.arcThrough3([10, 0], [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10], [0, 10]);
  nearPt(a.c, [0, 0]); near(a.r, 10); near(a.a0, 0); near(a.a1, 90);
  // the same three points the other way round: start and end swap so the arc still goes anticlockwise and passes the middle one
  a = DR.arcThrough3([0, 10], [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10], [10, 0]);
  nearPt(a.c, [0, 0]); near(a.r, 10); near(a.a0, 0); near(a.a1, 90);
  // a big arc over the top: (-10,0) → (0,10) → (10,0) goes clockwise, so it is stored from 0° to 180°
  a = DR.arcThrough3([-10, 0], [0, 10], [10, 0]);
  near(a.a0, 0); near(a.a1, 180); near(DR.sweepOf(a.a0, a.a1), 180);
  // under the bottom: (-10,0) → (0,-10) → (10,0) goes anticlockwise: 180° to 360°→0
  a = DR.arcThrough3([-10, 0], [0, -10], [10, 0]);
  near(a.a0, 180); near(a.a1, 0); near(DR.sweepOf(a.a0, a.a1), 180);
  // not about the origin, more than a half circle
  a = DR.arcThrough3([105, 50], [100, 55], [95, 50.5]);
  near(a.r, Math.hypot(105 - a.c[0], 50 - a.c[1])); near(Math.hypot(100 - a.c[0], 55 - a.c[1]), a.r); near(Math.hypot(95 - a.c[0], 50.5 - a.c[1]), a.r);
  assert.equal(DR.arcThrough3([0, 0], [1, 1], [2, 2]), null, 'in a line');
  assert.equal(DR.arcThrough3([0, 0], [0, 0], [2, 2]), null, 'two the same');
});

test('TODO 347a: the nine Arc modes give the arcs AutoCAD gave (acad-347.txt), negative A / L / R the other arc, refusals say why', () => {
  const is = (a, c, r, a0, a1) => { nearPt(a.c, c); near(a.r, r); near(a.a0, a0); near(a.a1, a1); };
  is(DR.arcSCE([10, 0], [0, 0], [0, 10]), [0, 0], 10, 0, 90);                                  // S-C-E
  is(DR.arcSCE([10, 0], [0, 0], [0, -10]), [0, 0], 10, 0, 270);                                // the arc runs anticlockwise: the end point is a direction
  is(DR.arcSCE([10, 0], [0, 0], [0, 20]), [0, 0], 10, 0, 90);                                  // a pick beyond the circle only sets the direction
  is(DR.arcSCA([10, 0], [0, 0], 90), [0, 0], 10, 0, 90);                                       // S-C-A
  is(DR.arcSCA([10, 0], [0, 0], -90), [0, 0], 10, 270, 0);                                     // negative = clockwise from the start
  is(DR.arcSCL([10, 0], [0, 0], 10), [0, 0], 10, 0, 60);                                       // S-C-L: a chord of 10 on R10 is 60°
  is(DR.arcSCL([10, 0], [0, 0], -10), [0, 0], 10, 0, 300);                                     // negative = the major arc
  is(DR.arcSCL([10, 0], [0, 0], 20), [0, 0], 10, 0, 180);                                      // the diameter is the longest chord
  assert.equal(DR.arcSCL([10, 0], [0, 0], 25).why, 'Chord longer than the diameter');
  assert.equal(DR.arcSCL([10, 0], [0, 0], 20.5).why, 'Chord longer than the diameter');
  assert.equal(DR.arcSCL([10, 0], [0, 0], -25).why, 'Chord longer than the diameter');
  is(DR.arcCSE([0, 0], [10, 0], [0, 10]), [0, 0], 10, 0, 90);                                  // C-S-E
  is(DR.arcCSE([0, 0], [10, 0], [0, 20]), [0, 0], 10, 0, 90);                                  // the end point is a direction only
  is(DR.arcCSA([0, 0], [10, 0], 90), [0, 0], 10, 0, 90);                                       // C-S-A
  is(DR.arcCSL([0, 0], [10, 0], 10), [0, 0], 10, 0, 60);                                       // C-S-L
  is(DR.arcSEA([10, 0], [0, 10], 90), [0, 0], 10, 0, 90);                                      // S-E-A
  is(DR.arcSEA([10, 0], [0, 10], -90), [10, 10], 10, 180, 270);                                // the other side
  is(DR.arcSED([10, 0], [0, 10], 90), [0, 0], 10, 0, 90);                                      // S-E-D: the start tangent points up
  is(DR.arcSER([10, 0], [0, 10], 10), [0, 0], 10, 0, 90);                                      // S-E-R
  is(DR.arcSER([10, 0], [0, 10], -10), [10, 10], 10, 270, 180);                                // negative = the major arc, 270° swept
  near(DR.sweepOf(270, 180), 270);
  assert.equal(DR.arcSER([10, 0], [0, 10], 5).why, 'Radius too small for these points');
  assert.ok(DR.arcSED([10, 0], [0, 10], 90 + 135).c, 'a tangent turning the other way gives a clockwise arc about the right-hand centre');
  assert.ok(DR.arcSED([10, 0], [0, 10], 135).why, 'a direction pointing at the end is a straight line');
  assert.ok(DR.arcSCA([10, 0], [10, 0], 90).why && DR.arcSCA([10, 0], [0, 0], 0).why && DR.arcSCA([10, 0], [0, 0], 360).why && DR.arcSCE([10, 0], [0, 0], [20, 0]).why, 'degenerate input is refused with a reason');
});

test('rectPts: corners in any order; rounded corners are bulges of a quarter circle', () => {
  assert.deepEqual(DR.rectPts([10, 20], [0, 5]), [[0, 5], [10, 5], [10, 20], [0, 20]]);
  const r = DR.rectPts([0, 0], [100, 60], 10);
  assert.equal(r.length, 8);
  assert.deepEqual(r.map((p) => [p[0], p[1]]), [[10, 0], [90, 0], [100, 10], [100, 50], [90, 60], [10, 60], [0, 50], [0, 10]]);
  near(r[1][2], Math.tan(Math.PI / 8)); near(r[3][2], Math.tan(Math.PI / 8)); assert.equal(r[0][2], undefined);
  assert.equal(DR.rectPts([0, 0], [100, 60], 0).length, 4);
  assert.equal(DR.rectPts([0, 0], [100, 20], 500)[0][0], 10, 'the radius is held to half the shorter side');
});

test('ellipseParams: the longer axis is the major one', () => {
  let e = DR.ellipseParams([10, 10], [60, 10], 20);
  assert.deepEqual(e.c, [10, 10]); assert.deepEqual(e.m, [50, 0]); near(e.ratio, 0.4);
  e = DR.ellipseParams([0, 0], [30, 40], 25);                         // axis 1 is 50 long at an angle
  assert.deepEqual(e.m, [30, 40]); near(e.ratio, 0.5);
  e = DR.ellipseParams([0, 0], [10, 0], 40);                          // the second axis is longer: it becomes the major one, turned a quarter round
  near(e.m[0], 0); near(e.m[1], 40); near(e.ratio, 0.25);
  assert.equal(DR.ellipseParams([0, 0], [0, 0], 5), null);
  assert.equal(DR.ellipseParams([0, 0], [5, 0], 0), null);
});

const click = (T, ...pts) => { let r; for (const p of pts) r = DR.toolClick(T, p); return r; };

test('Line: each click after the first makes a segment at once and carries on; typed points and direct distance; Enter ends and keeps them', () => {
  const T = DR.createTool('line');
  assert.equal(click(T, [0, 0]).made, null, 'the first point makes nothing');
  assert.deepEqual(click(T, [10, 0]).made, [{ t: 'line', a: [0, 0], b: [10, 0] }]);
  assert.deepEqual(T.pts, [[10, 0]], 'carries on from the last point');
  DR.toolHover(T, [10, 5]);                                            // the rubber band points up
  assert.deepEqual(DR.toolType(T, '20').made, [{ t: 'line', a: [10, 0], b: [10, 20] }]);   // direct distance: 20 straight up from (10, 0)
  assert.deepEqual(DR.toolType(T, '@5,0').made, [{ t: 'line', a: [10, 20], b: [15, 20] }]);
  assert.deepEqual(DR.toolType(T, '30,40').made[0].b, [30, 40]);
  assert.deepEqual(DR.toolType(T, '@10<90').made[0].b.map((v) => +v.toFixed(6)), [30, 50]);
  const r = DR.toolType(T, '');                                        // Enter: nothing more is made, nothing is taken back
  assert.equal(r.made, null);
  assert.deepEqual(T.pts, [], 'ready for the next line');
});

test('Line: Esc / Enter after only the first point adds nothing; a length with no direction says so; same point twice is refused', () => {
  const T = DR.createTool('line');
  click(T, [0, 0]);
  assert.match(DR.toolType(T, '10').msg, /Move the pointer/);
  assert.equal(T.pts.length, 1);
  const r = DR.toolFinish(T);
  assert.equal(r.made, null); assert.deepEqual(T.pts, []);
  assert.match(click(DR.createTool('line'), [1, 1], [1, 1]).msg, /last point again/);
});

test('Line: Undo (U or Ctrl+Z) takes the last segment back and starts from where it began; Close joins the last point to the first', () => {
  const T = DR.createTool('line');
  click(T, [0, 0], [10, 0], [10, 10]);
  assert.equal(T.trail.length, 2);
  assert.equal(DR.toolType(T, 'u').undoSeg, true, 'the app undoes the document step');
  assert.equal(DR.toolUndoSeg(T), 'seg');
  assert.deepEqual(T.pts, [[10, 0]]);
  click(T, [10, 10]);
  const r = DR.toolType(T, 'c');                                       // two segments made: Close adds the third, a closed triangle
  assert.deepEqual(r.made, [{ t: 'line', a: [10, 10], b: [0, 0] }]);
  assert.deepEqual(T.pts, []);
  assert.match(DR.toolType(T, 'c').msg, /Close needs two segments/);
  const U = DR.createTool('line');
  click(U, [5, 5]);
  assert.equal(DR.toolUndoSeg(U), 'point'); assert.deepEqual(U.pts, []);
  assert.equal(DR.toolUndoSeg(U), null);
  assert.equal(DR.toolUndoSeg(DR.createTool('polyline')), null);
});

test('Polyline: one LWPOLYLINE; C closes it', () => {
  const T = DR.createTool('polyline');
  click(T, [0, 0], [100, 0], [100, 50]);
  let r = DR.toolFinish(T);
  assert.equal(r.made.length, 1); assert.equal(r.made[0].t, 'poly'); assert.equal(r.made[0].closed, false); assert.equal(r.made[0].pts.length, 3);
  click(T, [0, 0], [100, 0], [100, 50]);
  r = DR.toolType(T, 'C');
  assert.equal(r.made[0].closed, true);
  click(T, [0, 0], [1, 1]);
  assert.equal(DR.toolType(T, 'c').made, null, 'two points cannot close');
});

test('Rectangle: two corners, or a first corner and W,H / @W,H (negative goes the other way)', () => {
  let T = DR.createTool('rect');
  let r = click(T, [10, 10], [110, 70]);
  assert.deepEqual(r.made[0], { t: 'poly', pts: [[10, 10], [110, 10], [110, 70], [10, 70]], closed: true });
  T = DR.createTool('rect');
  DR.toolType(T, '5,5');
  r = DR.toolType(T, '100,60');
  assert.deepEqual(r.made[0].pts, [[5, 5], [105, 5], [105, 65], [5, 65]]);
  T = DR.createTool('rect'); click(T, [5, 5]);
  r = DR.toolType(T, '@-20,10');
  assert.deepEqual(r.made[0].pts, [[-15, 5], [5, 5], [5, 15], [-15, 15]]);
  T = DR.createTool('rect'); click(T, [5, 5]);
  assert.match(click(T, [5, 40]).msg, /in a line/);
  assert.match(DR.toolType(T, '20').msg, /W,H|length|pointer/i, 'a bare length is no size');
});

test('Rounded rectangle: the radius is asked first, remembered, and can be changed with R', () => {
  const T = DR.createTool('rrect', { radius: 8 });
  assert.equal(T.stage, 'radius');
  assert.equal(DR.toolPrompt(T).prompt, 'Corner radius <8.00>:');
  DR.toolType(T, '');                                                  // Enter keeps 8
  assert.equal(T.stage, 'pts'); assert.equal(T.radius, 8);
  click(T, [0, 0]);
  const r = DR.toolType(T, '100,60');
  assert.equal(r.made[0].pts.length, 8);
  assert.equal(r.made[0].pts[0][0], 8);
  DR.toolType(T, 'r 12');                                              // the R option with its value
  assert.equal(T.radius, 12);
  click(T, [0, 0]);
  assert.equal(click(T, [100, 50]).made[0].pts[0][0], 12);
  const T2 = DR.createTool('rrect', { radius: 8 });
  DR.toolType(T2, '3');
  assert.equal(T2.radius, 3); assert.equal(T2.stage, 'pts');
  const T3 = DR.createTool('rrect', { radius: 8 });
  click(T3, [0, 0], [50, 50]);                                         // clicking the corner straight away keeps the radius
  assert.equal(T3.radius, 8);
  const T4 = DR.createTool('rrect');
  assert.match(DR.toolType(T4, '-2').msg, /0 or more/);
});

test('Circle: centre then radius (click or typed); D switches to a diameter', () => {
  let T = DR.createTool('circle');
  let r = click(T, [50, 50], [80, 50]);
  assert.deepEqual(r.made[0], { t: 'circle', c: [50, 50], r: 30 });
  T = DR.createTool('circle');
  DR.toolType(T, '10,20');
  r = DR.toolType(T, '25');
  assert.deepEqual(r.made[0], { t: 'circle', c: [10, 20], r: 25 });
  T = DR.createTool('circle'); click(T, [0, 0]);
  DR.toolType(T, 'd');
  assert.equal(DR.toolPrompt(T).prompt, 'Diameter [Radius]:');
  r = DR.toolType(T, '40');
  assert.equal(r.made[0].r, 20);
  T = DR.createTool('circle'); click(T, [0, 0]);
  DR.toolType(T, 'd'); DR.toolHover(T, [30, 40]);
  assert.equal(DR.toolPreview(T).readout, 'Ø 50.00');
  assert.equal(DR.toolPreview(T).shapes[0].r, 25);
  r = click(T, [30, 40]);                                              // a click is the diameter's other end
  assert.equal(r.made[0].r, 25);
  T = DR.createTool('circle'); click(T, [0, 0]);
  assert.match(DR.toolType(T, '0').msg, /above 0/);
});

test('Ellipse: centre, end of axis 1, then the other half-axis', () => {
  const T = DR.createTool('ellipse');
  click(T, [100, 100], [150, 100]);
  const r = click(T, [100, 120]);
  assert.equal(r.made[0].t, 'ellipse'); assert.deepEqual(r.made[0].m, [50, 0]); near(r.made[0].ratio, 0.4);
  click(T, [0, 0]);
  DR.toolHover(T, [0, 30]);                                            // axis 1 straight up, by direct distance
  DR.toolType(T, '30');
  assert.deepEqual(T.pts[1], [0, 30]);
  const r2 = DR.toolType(T, '10');                                     // typed half-axis
  near(r2.made[0].ratio, 1 / 3); assert.deepEqual(r2.made[0].m, [0, 30]);
});

test('Arc: three points, start → second → end', () => {
  const T = DR.createTool('arc');
  click(T, [10, 0], [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10]);
  const r = click(T, [0, 10]);
  assert.equal(r.made[0].t, 'arc'); nearPt(r.made[0].c, [0, 0]); near(r.made[0].r, 10); near(r.made[0].a0, 0); near(r.made[0].a1, 90);
  click(T, [0, 0], [5, 5]);
  assert.match(click(T, [10, 10]).msg, /in a line/);
  assert.equal(T.pts.length, 2, 'still waiting for the end point');
});

test('Arc (347a): typed C at the first / second prompt, then the end point, A or L; refusals stay at the prompt; U backs one step', () => {
  const type = (T, s) => DR.toolType(T, s);
  const arc = (r) => { assert.equal(r.msg, null); assert.equal(r.made[0].t, 'arc'); return r.made[0]; };
  // Start, Centre, End (C at the second prompt, case-free)
  let T = DR.createTool('arc');
  assert.match(DR.toolPrompt(T).prompt, /\[Center\]/); assert.ok(DR.toolWords(T).has('c') && !DR.toolWords(T).has('l'));
  click(T, [10, 0]); assert.match(DR.toolPrompt(T).prompt, /^Specify second point on the arc \[Center\/End\]/);
  type(T, 'C'); assert.equal(T.am, 'sc'); assert.match(DR.toolPrompt(T).prompt, /^Specify centre point of arc/);
  click(T, [0, 0]); assert.match(DR.toolPrompt(T).prompt, /^Specify end point of arc \(hold Ctrl to switch direction\) or \[Angle\/chord Length\]:$/);
  let a = arc(click(T, [0, 10])); nearPt(a.c, [0, 0]); near(a.a0, 0); near(a.a1, 90);
  assert.equal(T.am, null, 'the next arc starts at the 3-point prompts');
  // Start, Centre, Angle: typed "A" then the number; negative = clockwise
  click(T, [10, 0]); type(T, 'c'); click(T, [0, 0]); type(T, 'A'); assert.equal(T.ask, 'a'); assert.equal(DR.toolPrompt(T).prompt, 'Specify included angle (hold Ctrl to switch direction):');
  a = arc(type(T, '-90')); near(a.a0, 270); near(a.a1, 0);
  // "L" with the number after it, negative = major arc; a chord over the diameter is refused and the prompt stays
  click(T, [10, 0]); type(T, 'c'); click(T, [0, 0]);
  assert.equal(type(T, 'l 25').msg, 'Chord longer than the diameter'); assert.equal(T.ask, 'l'); assert.equal(T.pts.length, 2);
  assert.equal(type(T, '-10').msg, null); assert.equal(T.pts.length, 0, 'the major arc was made');
  click(T, [10, 0]); type(T, 'c'); click(T, [0, 0]); a = arc(type(T, 'l -10')); near(a.a0, 0); near(a.a1, 300);
  // Centre, Start, End (C at the first prompt): the end is a direction only
  T = DR.createTool('arc'); assert.equal(DR.toolBusy(T), false); type(T, 'C'); assert.equal(T.am, 'cs'); assert.equal(DR.toolBusy(T), true, 'a typed C is a command in progress'); assert.match(DR.toolPrompt(T).prompt, /^Specify centre point of arc/);
  click(T, [0, 0]); assert.match(DR.toolPrompt(T).prompt, /^Specify start point of arc/); click(T, [10, 0]);
  a = arc(click(T, [0, 20])); nearPt(a.c, [0, 0]); near(a.r, 10); near(a.a0, 0); near(a.a1, 90);
  type(T, 'c'); click(T, [0, 0]); click(T, [10, 0]); type(T, 'a 90'); assert.equal(T.pts.length, 0, 'C-S-A made the arc');
  type(T, 'c'); click(T, [0, 0]); click(T, [10, 0]); a = arc(type(T, 'l 10')); near(a.a1, 60);
  // anything else is not an option; the words E, A and L are refused at the first prompt (E is an option only at the second, 347b)
  T = DR.createTool('arc');
  for (const w of ['e', 'a', 'l', 'foo']) assert.equal(type(T, w).msg, '2D point or option keyword required.', w);
  click(T, [10, 0]); for (const w of ['a', 'l', 'd', 'r', 'foo']) assert.equal(type(T, w).msg, '2D point or option keyword required.', w); assert.equal(T.pts.length, 1);
  // U backs one step in every mode: the A prompt → the end point → the centre → the second-point prompt (C is an option again)
  type(T, 'c'); click(T, [0, 0]); type(T, 'a'); type(T, 'u'); assert.equal(T.ask, null); assert.equal(T.pts.length, 2);
  type(T, 'u'); assert.equal(T.pts.length, 1); assert.equal(T.am, 'sc'); type(T, 'u'); assert.equal(T.am, null); assert.equal(T.pts.length, 1);
  type(T, 'u'); assert.equal(T.pts.length, 0);
  type(T, 'c'); click(T, [0, 0]); click(T, [10, 0]); type(T, 'u'); assert.equal(T.pts.length, 1); type(T, 'u'); type(T, 'u'); assert.equal(T.am, null);
  // Esc leaves the typed C
  type(T, 'c'); assert.equal(DR.toolFinish(T).msg, 'Cancelled'); assert.equal(T.am, null);
  // the preview follows the pointer, then a typed value
  T = DR.createTool('arc'); click(T, [10, 0]); type(T, 'c'); click(T, [0, 0]); type(T, 'a'); DR.toolHover(T, [0, 10]);
  near(DR.toolPreview(T).shapes[0].a1, 90); near(DR.toolPreview({ ...T, value: -90 }).shapes[0].a0, 270);
  near(DR.arcValueAt(T, [0, 10]), 90);
});

test('Arc (347b): typed E at the second prompt, then A / D / R (negative = the other arc), Ctrl turns the arc the other way; refusals stay at the prompt; U backs one step', () => {
  const type = (T, s) => DR.toolType(T, s);
  const arc = (r) => { assert.equal(r.msg, null); assert.equal(r.made[0].t, 'arc'); return r.made[0]; };
  const is = (a, c, r, a0, a1) => { nearPt(a.c, c); near(a.r, r); near(a.a0, a0); near(a.a1, a1); };
  const se = (...words) => { const T = DR.createTool('arc'); click(T, [10, 0]); type(T, 'E'); click(T, [0, 10]); for (const w of words) type(T, w); return T; };
  // the prompts
  let T = DR.createTool('arc'); click(T, [10, 0]);
  type(T, 'e'); assert.equal(T.am, 'se'); assert.equal(DR.toolPrompt(T).prompt, 'Specify end point of arc (x,y):');
  click(T, [0, 10]); assert.equal(DR.toolPrompt(T).prompt, 'Type an option (hold Ctrl to switch direction) [Angle/Direction/Radius]:');
  type(T, 'A'); assert.equal(DR.toolPrompt(T).prompt, 'Specify included angle (hold Ctrl to switch direction):');
  type(T, 'u'); type(T, 'D'); assert.equal(DR.toolPrompt(T).prompt, 'Specify tangent direction for the start point of arc (hold Ctrl to switch direction):');
  type(T, 'u'); type(T, 'r'); assert.equal(DR.toolPrompt(T).prompt, 'Specify radius of arc (hold Ctrl to switch direction):');
  // S-E-A, S-E-D, S-E-R: the arcs AutoCAD gave (acad-347.txt), the value typed after the letter or at its own prompt
  is(arc(type(se(), 'a 90')), [0, 0], 10, 0, 90);
  is(arc(type(se('A'), '-90')), [10, 10], 10, 180, 270);
  is(arc(type(se(), 'D 90')), [0, 0], 10, 0, 90);
  is(arc(type(se('d'), '90')), [0, 0], 10, 0, 90);
  is(arc(type(se(), 'R 10')), [0, 0], 10, 0, 90);
  is(arc(type(se('r'), '-10')), [10, 10], 10, 270, 180);
  // refusals keep the points and the prompt; a retyped value then makes the arc
  T = se('r'); assert.equal(type(T, '5').msg, 'Radius too small for these points'); assert.equal(T.ask, 'r'); assert.equal(T.pts.length, 2); assert.equal(type(T, 'foo').msg, 'Requires numeric distance or second point.');
  is(arc(type(T, '10')), [0, 0], 10, 0, 90);
  T = se('d'); assert.match(type(T, '135').msg, /straight line/); assert.equal(T.ask, 'd'); assert.equal(T.pts.length, 2); assert.equal(type(T, 'foo').msg, 'Requires valid numeric angle or second point.');
  T = se('a'); assert.match(type(T, '0').msg, /between 0 and 360/); assert.equal(T.pts.length, 2); assert.equal(T.ask, 'a'); assert.match(type(T, '360').msg, /between 0 and 360/);
  T = se(); assert.match(DR.toolClick(T, [5, 5]).msg, /^Type A, D or R/); assert.equal(T.pts.length, 2, 'a centre pick at the S-E prompt keeps the points'); assert.equal(T.am, 'se');
  assert.equal(type(T, 'l').msg, '2D point or option keyword required.'); assert.equal(type(T, 'c').msg, '2D point or option keyword required.'); assert.equal(T.pts.length, 2);
  T = DR.createTool('arc'); click(T, [10, 0]); type(T, 'e'); assert.equal(type(T, '10,0').msg, 'That is the same point: pick another'); assert.equal(T.pts.length, 1);
  // U backs one step: the A prompt → the end-point prompt → the second-point prompt (C and E are options again) → the first point
  T = se('a'); type(T, 'u'); assert.equal(T.ask, null); assert.equal(T.pts.length, 2); type(T, 'u'); assert.equal(T.pts.length, 1); assert.equal(T.am, 'se');
  type(T, 'u'); assert.equal(T.am, null); assert.equal(T.pts.length, 1); type(T, 'u'); assert.equal(T.pts.length, 0);
  // Esc leaves the command's points and the E
  T = se('a'); assert.equal(DR.toolFinish(T).msg, 'Cancelled'); assert.equal(T.am, null); assert.equal(T.ask, null); assert.equal(T.pts.length, 0);
  // the pointer: A is twice the turn from the chord to the start tangent, D the direction from the start, R the distance from the start; the preview follows
  T = se('a'); DR.toolHover(T, [10, 10]); near(DR.arcValueAt(T, [10, 10]), 90); is(DR.toolPreview(T).shapes[0], [0, 0], 10, 0, 90); assert.deepEqual(DR.toolPreview(T).guides, [[[10, 0], [0, 10]]]);
  near(DR.arcValueAt(T, [10, -10]), -270);                                                           // a pointer below the start turns the other way round
  T = se('d'); near(DR.arcValueAt(T, [10, 10]), 90); T = se('r'); near(DR.arcValueAt(T, [10, 10]), 10);
  assert.equal(DR.toolPreview(se()).shapes.length, 0, 'before A / D / R only the chord guide shows');
  is(arc(DR.toolClick(se('d'), [10, 10])), [0, 0], 10, 0, 90);                                       // a click at the D prompt: the pointer gives the direction
  // Ctrl turns the arc the other way (toolClick / toolHover carry it): the mirror image in the chord / in the centre-start line; D runs the tangent backwards
  const ctrl = (T, v) => { DR.toolHover(T, [0, 0], true); return arc(type(T, v)); };
  is(ctrl(se('a'), '90'), [10, 10], 10, 180, 270);                                                   // = the negative angle
  is(ctrl(se('d'), '90'), [0, 0], 10, 90, 0);                                                        // the tangent points down: clockwise round the same centre
  is(ctrl(se('r'), '10'), [10, 10], 10, 180, 270);
  is(ctrl(se('r'), '-10'), [0, 0], 10, 90, 0);
  T = DR.createTool('arc'); click(T, [10, 0]); type(T, 'c'); click(T, [0, 0]);
  is(arc(DR.toolClick(T, [0, 10], null, true)), [0, 0], 10, 90, 0);                                  // S-C-E with Ctrl: clockwise from the start (10,0) to the pick (0,10)
  assert.equal(T.flip, true); DR.toolHover(T, [0, 10], false); assert.equal(T.flip, false); DR.toolHover(T, [0, 10]); assert.equal(T.flip, false, 'no flag leaves it alone');
  T = DR.createTool('arc'); click(T, [10, 0]); type(T, 'c'); click(T, [0, 0]); type(T, 'l'); DR.toolHover(T, [10, 5], true); is(ctrl(T, '10'), [0, 0], 10, 300, 0);
  T = DR.createTool('arc'); type(T, 'c'); click(T, [0, 0], [10, 0]); DR.toolHover(T, [0, 10]); T.flip = true; is(DR.toolPreview(T).shapes[0], [0, 0], 10, 90, 0);       // C-S-E preview
  T.flip = false; is(DR.toolPreview(T).shapes[0], [0, 0], 10, 0, 90);
  T = DR.createTool('arc'); click(T, [10, 0], [7.0710678, 7.0710678]); is(arc(DR.toolClick(T, [0, 10], null, true)), [0, 0], 10, 0, 90);        // the 3-point arc has no direction: Ctrl changes nothing
  // the mirror on S-C-L: the 90-degree chord arc turned = the clockwise 90-degree arc (arcSCA with -90)
  const ml = DR.arcMirror(DR.arcSCL([10, 0], [0, 0], 10 * Math.SQRT2), [0, 0], [10, 0]); is(ml, [0, 0], 10, 270, 0);
  // the mirror itself
  const m = DR.arcMirror({ c: [0, 0], r: 10, a0: 0, a1: 90 }, [10, 0], [0, 10]); nearPt(m.c, [10, 10]); near(m.a0, 180); near(m.a1, 270);
});

test('Esc: a circle in progress is cancelled; a line keeps what it has', () => {
  const T = DR.createTool('circle'); click(T, [0, 0]);
  const r = DR.toolFinish(T);
  assert.equal(r.made, null); assert.deepEqual(T.pts, []);
  assert.equal(DR.toolBusy(T), false);
});

test('toolPreview: readouts for each tool', () => {
  let T = DR.createTool('line'); click(T, [0, 0]); DR.toolHover(T, [30, 40]);
  let p = DR.toolPreview(T);
  assert.equal(p.readout, '50.00 mm · 53.13°'); assert.equal(p.shapes[0].pts.length, 2);
  T = DR.createTool('rect'); click(T, [10, 10]); DR.toolHover(T, [110, 70]);
  assert.equal(DR.toolPreview(T).readout, 'W 100.00 × H 60.00');
  T = DR.createTool('rrect', { radius: 5 }); DR.toolType(T, ''); click(T, [10, 10]); DR.toolHover(T, [110, 70]);
  assert.equal(DR.toolPreview(T).readout, 'W 100.00 × H 60.00 · R 5.00');
  T = DR.createTool('circle'); click(T, [0, 0]); DR.toolHover(T, [0, 12.5]);
  assert.equal(DR.toolPreview(T).readout, 'R 12.50');
  T = DR.createTool('arc'); click(T, [10, 0], [0, 10]); DR.toolHover(T, [-10, 0]);
  p = DR.toolPreview(T);
  assert.match(p.readout, /^R 10\.00 · 180\.00°$/); assert.equal(p.shapes[0].t, 'arc');
  T = DR.createTool('ellipse'); click(T, [0, 0], [40, 0]); DR.toolHover(T, [0, 10]);
  assert.equal(DR.toolPreview(T).readout, 'Axis 1 40.00 · Axis 2 10.00');
});

test('toolPrompt: the command line follows the stage', () => {
  const T = DR.createTool('line');
  assert.equal(DR.toolPrompt(T, 'Notes').status, 'Command: LINE   layer Notes');
  assert.match(DR.toolPrompt(T).prompt, /first point/);
  click(T, [0, 0], [5, 5], [9, 1]);
  assert.match(DR.toolPrompt(T).prompt, /Close \/ Undo/);
  assert.match(DR.toolPrompt(DR.createTool('polyline')).status, /POLYLINE/);
  assert.match(DR.toolPrompt(DR.createTool('rrect')).status, /Corner radius 5\.00/);
});

test('svgPath: lines, bulges, circles, arcs and ellipses in sheet coordinates (y flipped)', () => {
  assert.equal(DR.svgPath({ t: 'line', a: [0, 0], b: [10, 5] }, 100), 'M0 100L10 95');
  assert.equal(DR.svgPath({ t: 'poly', pts: [[0, 0], [10, 0], [10, 10]], closed: true }, 50), 'M0 50L10 50L10 40L0 50Z');
  assert.match(DR.svgPath({ t: 'poly', pts: DR.rectPts([0, 0], [20, 10], 3), closed: true }, 50), /A3 3 0 0 0/);
  assert.match(DR.svgPath({ t: 'circle', c: [5, 5], r: 2 }, 10), /^M3 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z$/);
  assert.equal(DR.svgPath({ t: 'arc', c: [0, 0], r: 10, a0: 0, a1: 90 }, 0), 'M10 0A10 10 0 0 0 0 -10');
  assert.match(DR.svgPath({ t: 'ellipse', c: [0, 0], m: [10, 0], ratio: 0.5 }, 0), /^M10 0A10 5 0 1 0 -10 0A10 5 0 1 0 10 0Z$/);
});

test('toEntity → save → reopen: every tool\'s shape survives a DXF round trip and is drawn', () => {
  const shapes = [
    { t: 'line', a: [0, 0], b: [100, 50] },
    { t: 'poly', pts: [[0, 100], [50, 100], [50, 150]], closed: false },
    { t: 'poly', pts: DR.rectPts([200, 0], [300, 60]), closed: true },
    { t: 'poly', pts: DR.rectPts([200, 100], [300, 160], 12), closed: true },
    { t: 'circle', c: [400, 50], r: 25 },
    { t: 'arc', c: [500, 50], r: 30, a0: 20, a1: 200 },
    { t: 'ellipse', c: [600, 50], m: [40, 0], ratio: 0.5 },
  ];
  const doc = newDoc(4);
  addEntities(doc, shapes.map((s) => DR.toEntity(s, { layer: 'Notes' }, 1)));
  const back = readDxf(writeDxf(doc));
  assert.deepEqual(back.entities.map((e) => e.type), ['LINE', 'LWPOLYLINE', 'LWPOLYLINE', 'LWPOLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE']);
  assert.ok(back.entities.every((e) => e.layer === 'Notes'));
  const fl = flatten(back);
  assert.equal(fl.items.length, 7);
  const [x0, y0, x1, y1] = fl.boxes.model;
  near(x0, 0, 1e-3); near(y0, 0, 1e-3); assert.ok(x1 > 639 && x1 < 641.5, 'the ellipse reaches 640: ' + x1); assert.ok(y1 >= 160 - 1e-3);
  const rr = back.entities[3].r;                                       // the rounded rectangle keeps its eight vertices and four bulges
  assert.equal(rr.c.filter((c) => c === 10).length, 8); assert.equal(rr.c.filter((c) => c === 42).length, 4);
  const el = back.entities[6].r, v = (code) => +el.v[el.c.indexOf(code)];
  near(v(11), 40); near(v(40), 0.5);
});

test('toEntity: points are mm, the file holds drawing units (factor = mm per unit)', () => {
  const inch = DR.toEntity({ t: 'line', a: [0, 0], b: [25.4, 50.8] }, {}, 25.4);
  const v = (code) => +inch.r.v[inch.r.c.indexOf(code)];
  near(v(11), 1); near(v(21), 2);
  const c = DR.toEntity({ t: 'circle', c: [25.4, 0], r: 12.7 }, {}, 25.4);
  near(+c.r.v[c.r.c.indexOf(40)], 0.5);
});

test('Circle 2P / 3P (346a): typed options at the centre prompt, the circle, *Invalid* refusals, typed C is Centre, Radius', () => {
  assert.deepEqual(DR.parseInput('2P'), { kind: 'word', w: '2p' });
  assert.deepEqual(DR.parseInput('3'), { kind: 'len', v: 3 });                 // 2 and 3 alone stay numbers
  const T = DR.createTool('circle');
  assert.match(DR.toolPrompt(T).prompt, /^Specify centre \(x,y\) \[3P\/2P\/Ttr \(tan tan radius\)\/Diameter\]:$/);
  assert.equal(DR.toolType(T, 'foo').msg, 'Point or option keyword required.');
  assert.equal(DR.toolType(DR.createTool('rect'), 'foo').msg, '"foo" is not an option here', 'other tools keep their message');
  DR.toolType(T, '2P');
  assert.equal(T.mode, '2p');
  assert.equal(DR.toolPrompt(T).prompt, "Specify first end point of circle's diameter (x,y):");
  DR.toolClick(T, [0, 0]);
  assert.equal(DR.toolPrompt(T).prompt, "Specify second end point of circle's diameter (x,y):");
  assert.equal(DR.toolClick(T, [0, 0]).msg, '*Invalid*');
  assert.equal(T.pts.length, 1, 'the equal point is refused, the prompt repeats');
  const two = DR.toolClick(T, [10, 0]).made[0];
  assert.equal(two.t, 'circle'); nearPt(two.c, [5, 0]); near(two.r, 5);
  assert.equal(T.mode, '2p', 'the tool stays in its mode for the next circle');
  DR.toolType(T, 'c');
  assert.equal(T.mode, 'cr', 'typed C is Centre, Radius');
  DR.toolType(T, '3p');
  assert.match(DR.toolPrompt(T).prompt, /^Specify first point on circle/);
  DR.toolClick(T, [0, 0]); DR.toolClick(T, [10, 0]);
  assert.equal(DR.toolClick(T, [20, 0]).msg, '*Invalid*', 'collinear');
  assert.equal(DR.toolClick(T, [10, 0]).msg, '*Invalid*', 'a repeated point');
  assert.equal(T.pts.length, 2);
  const three = DR.toolClick(T, [10, 10]).made[0];
  nearPt(three.c, [5, 5]); near(three.r, Math.hypot(5, 5));
  const pv = DR.createTool('circle', { mode: '3p' }); DR.toolClick(pv, [0, 0]); DR.toolClick(pv, [10, 0]); DR.toolHover(pv, [10, 10]);
  assert.equal(DR.toolPreview(pv).shapes[0].t, 'circle', 'a live circle follows the pointer');
  const cd = DR.createTool('circle', { mode: 'cd' });
  assert.equal(DR.toolPrompt((DR.toolClick(cd, [0, 0]), cd)).prompt, 'Diameter [Radius]:');
  assert.equal(DR.toolClick(cd, [10, 0]).made[0].r, 5, 'Centre, Diameter');
  assert.equal(cd.dia, true, 'and the next circle asks for a diameter too');
  assert.equal(DR.createTool('circle', { mode: 'bogus' }).mode, 'cr');
});

test('Circle Tan, Tan, Radius and Tan, Tan, Tan (346b): typed T / TTR, object picks, the radius, "Circle does not exist."', () => {
  const X = { t: 'l', a: [0, 0], b: [10, 0] }, Y = { t: 'l', a: [0, 0], b: [0, 10] };
  assert.deepEqual(DR.CIRCLE_MODES.slice(-2).map((m) => m[0]), ['ttr', 'ttt']);
  assert.ok(DR.toolWords(DR.createTool('circle')).has('t') && DR.toolWords(DR.createTool('circle')).has('ttr'));
  for (const w of ['T', 'ttr', 'TTR']) { const c = DR.createTool('circle'); DR.toolType(c, w); assert.equal(c.mode, 'ttr', w); }
  const T = DR.createTool('circle');
  DR.toolType(T, 'T');
  assert.equal(DR.toolPrompt(T).prompt, 'Specify point on object for first tangent of circle:');
  assert.equal(DR.toolClick(T, [5, 5]).msg, 'Requires a TAN object-snap and selection of Circle, Arc, or Line.', 'a pick on no object');
  assert.equal(DR.toolType(T, '3,4').msg, 'Requires a TAN object-snap and selection of Circle, Arc, or Line.', 'a typed point is no object either');
  assert.equal(T.pts.length, 0, 'the prompt repeats');
  DR.toolClick(T, [5, 0], X);
  assert.equal(DR.toolPrompt(T).prompt, 'Specify point on object for second tangent of circle:');
  DR.toolClick(T, [0, 5], Y);
  assert.equal(DR.toolPrompt(T).prompt, 'Specify radius of circle:');
  assert.equal(DR.toolType(T, '0').msg, 'Value must be positive and nonzero.');
  assert.equal(DR.toolType(T, '-3').msg, 'Value must be positive and nonzero.');
  assert.equal(T.pts.length, 2, 'the radius is asked again');
  const made = DR.toolType(T, '2').made[0];
  assert.equal(made.t, 'circle'); nearPt(made.c, [2, 2]); near(made.r, 2);
  assert.equal(T.mode, 'ttr', 'the tool stays in its mode'); assert.equal(T.pts.length, 0);
  DR.toolClick(T, [5, 0], X); DR.toolClick(T, [0, 5], Y);                // the radius by two points
  assert.equal(DR.toolClick(T, [20, 20]).msg, null); assert.equal(DR.toolPrompt(T).prompt, 'Specify second point:');
  DR.toolHover(T, [20, 23]);
  assert.equal(DR.toolPreview(T).shapes[0].r, 3, 'a live circle of the distance between the two points');
  const two = DR.toolClick(T, [20, 23]).made[0];
  nearPt(two.c, [3, 3]); near(two.r, 3);
  DR.toolClick(T, [5, 0], X); DR.toolClick(T, [5, 0], X);                // both picks on one object: no circle, the command ends
  const none = DR.toolType(T, '2');
  assert.deepEqual([none.made, none.msg, none.end], [null, 'Circle does not exist.', true]);
  assert.equal(T.pts.length, 0);
  DR.toolClick(T, [5, 0], X); DR.toolType(T, 'u'); assert.equal(T.pts.length, 0); assert.equal(T.objs.length, 0, 'U takes the last pick back');
  DR.toolType(T, 'c'); assert.equal(T.mode, 'cr', 'typed C is Centre, Radius');
  const ttt = DR.createTool('circle', { mode: 'ttt' });                  // Tan, Tan, Tan: three picks make it
  assert.equal(DR.toolType(ttt, 'foo').msg, 'Requires a TAN object-snap and selection of Circle, Arc, or Line.');
  DR.toolClick(ttt, [5, 0], X); DR.toolClick(ttt, [0, 5], Y);
  assert.equal(DR.toolPrompt(ttt).prompt, 'Specify point on object for third tangent of circle:');
  const r = DR.toolClick(ttt, [5, 5], { t: 'l', a: [10, 0], b: [0, 10] });
  nearPt(r.made[0].c, [10 - 5 * Math.SQRT2, 10 - 5 * Math.SQRT2]); near(r.made[0].r, 10 - 5 * Math.SQRT2);       // the incircle of the right triangle with legs 10
  DR.toolClick(ttt, [5, 0], X); DR.toolClick(ttt, [5, 0], X);
  const par = DR.toolClick(ttt, [5, 10], { t: 'l', a: [0, 10], b: [10, 10] });
  assert.deepEqual([par.made, par.msg, par.end], [null, 'Circle does not exist.', true]);
});

test('Arc Continue (347c): tangent from the end of a line, an arc or a polyline\'s last segment; nothing or a circle gives no arc', () => {
  const dirOf = (sh, s, dir) => { const c = DR.arcContinue(sh); nearPt(c.s, s); near(c.dir, dir); };
  dirOf({ t: 'line', a: [0, 0], b: [10, 0] }, [10, 0], 0);
  dirOf({ t: 'line', a: [10, 10], b: [0, 0] }, [0, 0], 225);
  dirOf({ t: 'arc', c: [0, 0], r: 10, a0: 0, a1: 90 }, [0, 10], 180);                       // anticlockwise: at its end it heads a quarter turn on
  dirOf({ t: 'poly', pts: [[0, 0, 0], [10, 0, 0], [10, 10, 0]], closed: false }, [10, 10], 90);
  dirOf({ t: 'poly', pts: [[0, 0, 0], [10, 0, Math.tan(Math.PI / 8)], [10, 10, 0]], closed: false }, [10, 10], 135);      // a quarter-circle last segment: the tangent has turned 45° from the chord
  dirOf({ t: 'poly', pts: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], closed: true }, [0, 0], 270);                  // closed: the segment back to the first point
  for (const sh of [null, { t: 'circle', c: [0, 0], r: 5 }, { t: 'ellipse', c: [0, 0], m: [5, 0], ratio: 0.5 }, { t: 'line', a: [1, 1], b: [1, 1] }]) assert.equal(DR.arcContinue(sh), null);
  // the tool: Enter at the first prompt starts at the end, asks only the end point (no Ctrl flip), and makes the tangent arc
  const go = (cont) => { const T = DR.createTool('arc'); T.cont = cont; return [T, DR.toolFinish(T)]; };
  let [T, r] = go({ t: 'line', a: [0, 0], b: [10, 0] });
  assert.equal(r.msg, null); assert.equal(T.am, 'ct'); assert.deepEqual(T.pts, [[10, 0]]); assert.equal(DR.toolPrompt(T).prompt, 'Specify end point of arc (x,y):');
  DR.toolHover(T, [20, 10]); const pv = DR.toolPreview(T).shapes[0]; nearPt(pv.c, [10, 10]); near(pv.a0, 270);
  r = DR.toolClick(T, [20, 10], null, true);                                                 // Ctrl held: ignored, the tangent fixes the direction
  nearPt(r.made[0].c, [10, 10]); near(r.made[0].r, 10); near(r.made[0].a0, 270); near(r.made[0].a1, 0);
  assert.equal(T.am, null, 'the arc is made, the tool asks for a new start point');
  [T, r] = go({ t: 'arc', c: [0, 0], r: 10, a0: 0, a1: 90 });                                // after an arc: the same circle goes on
  r = DR.toolClick(T, [-10, 0]); nearPt(r.made[0].c, [0, 0]); near(r.made[0].r, 10); near(r.made[0].a0, 90); near(r.made[0].a1, 180);
  [T, r] = go({ t: 'line', a: [0, 0], b: [10, 0] }); r = DR.toolClick(T, [20, 0]);          // an end point straight ahead is a straight line: refused, the prompt stays
  assert.match(r.msg, /straight line/); assert.equal(T.am, 'ct'); assert.equal(T.pts.length, 1);
  DR.toolType(T, 'u'); assert.equal(T.am, null); assert.equal(T.pts.length, 0, 'U goes back to the first prompt');
  // nothing / a circle last: the message, and the first prompt stays
  for (const cont of [null, { t: 'circle', c: [0, 0], r: 5 }]) {
    [T, r] = go(cont);
    assert.equal(r.msg, 'No line or arc to continue.'); assert.equal(T.am, null); assert.equal(T.pts.length, 0); assert.match(DR.toolPrompt(T).prompt, /^Specify start point/);
  }
});

test('Arc modes (347c): ARC_MODES in AutoCAD\'s order; a mode the button starts waits for what it needs, typed options leave it', () => {
  assert.deepEqual(DR.ARC_MODES.map((m) => m[1]), ['3-Point', 'Start, Centre, End', 'Start, Centre, Angle', 'Start, Centre, Length', 'Start, End, Angle', 'Start, End, Direction', 'Start, End, Radius', 'Centre, Start, End', 'Centre, Start, Angle', 'Centre, Start, Length', 'Continue']);
  assert.equal(DR.createTool('arc').mode, '3p'); assert.equal(DR.createTool('arc', { mode: 'cr' }).mode, '3p'); assert.equal(DR.createTool('line').mode, 'cr');
  const arc = (r) => { assert.equal(r.msg, null); return r.made[0]; };
  const is = (a, c, rad, a0, a1) => { nearPt(a.c, c); near(a.r, rad); near(a.a0, a0); near(a.a1, a1); };
  const mk = (mode) => DR.createTool('arc', { mode });
  let T = mk('sce'); click(T, [10, 0]); assert.equal(T.am, 'sc'); assert.equal(DR.toolPrompt(T).prompt, 'Specify centre point of arc (x,y):');
  click(T, [0, 0]); assert.match(DR.toolPrompt(T).prompt, /^Specify end point of arc/); is(arc(DR.toolClick(T, [0, 10])), [0, 0], 10, 0, 90);
  assert.equal(T.am, null, 'the mode goes on with a fresh start point'); click(T, [10, 0]); assert.equal(T.am, 'sc');
  T = mk('sca'); click(T, [10, 0], [0, 0]); assert.equal(T.ask, 'a'); is(arc(DR.toolType(T, '90')), [0, 0], 10, 0, 90);
  T = mk('scl'); click(T, [10, 0], [0, 0]); assert.equal(T.ask, 'l'); is(arc(DR.toolType(T, '14.142135623730951')), [0, 0], 10, 0, 90);
  T = mk('sea'); click(T, [10, 0]); assert.equal(T.am, 'se'); click(T, [0, 10]); assert.equal(T.ask, 'a'); is(arc(DR.toolType(T, '90')), [0, 0], 10, 0, 90);
  T = mk('sed'); click(T, [10, 0], [0, 10]); assert.equal(T.ask, 'd'); is(arc(DR.toolType(T, '90')), [0, 0], 10, 0, 90);
  T = mk('ser'); click(T, [10, 0], [0, 10]); assert.equal(T.ask, 'r'); is(arc(DR.toolType(T, '10')), [0, 0], 10, 0, 90);
  T = mk('cse'); assert.equal(T.am, 'cs'); assert.equal(DR.toolBusy(T), false, 'nothing is placed yet: Esc leaves the tool'); assert.equal(DR.toolPrompt(T).prompt, 'Specify centre point of arc (x,y):');
  click(T, [0, 0]); assert.equal(DR.toolPrompt(T).prompt, 'Specify start point of arc (x,y):'); click(T, [10, 0]); is(arc(DR.toolClick(T, [0, 10])), [0, 0], 10, 0, 90);
  assert.equal(T.am, 'cs'); assert.equal(T.pts.length, 0);
  T = mk('csa'); click(T, [0, 0], [10, 0]); assert.equal(T.ask, 'a'); is(arc(DR.toolType(T, '90')), [0, 0], 10, 0, 90);
  T = mk('csl'); click(T, [0, 0], [10, 0]); assert.equal(T.ask, 'l'); is(arc(DR.toolType(T, '14.142135623730951')), [0, 0], 10, 0, 90);
  // U goes back a point at a time and keeps the mode; Enter / Esc with a point placed cancels it
  T = mk('sca'); click(T, [10, 0], [0, 0]); DR.toolType(T, 'u'); assert.deepEqual([T.pts.length, T.am, T.ask], [1, 'sc', null]); DR.toolType(T, 'u'); assert.deepEqual([T.pts.length, T.am, T.ask], [0, null, null]);
  assert.equal(DR.toolType(T, 'u').msg, 'Nothing to undo'); click(T, [10, 0]); assert.equal(DR.toolFinish(T).msg, 'Cancelled'); assert.equal(T.pts.length, 0); assert.equal(T.mode, 'sca');
  T = mk('cse'); assert.equal(DR.toolType(T, 'u').msg, 'Nothing to undo'); assert.equal(T.am, 'cs');
  // a typed option at the first prompt is the old typed flow: the mode is gone
  T = mk('sce'); DR.toolType(T, 'c'); assert.deepEqual([T.am, T.mode], ['cs', '3p']); click(T, [0, 0], [10, 0]); is(arc(DR.toolClick(T, [0, 10])), [0, 0], 10, 0, 90); assert.equal(T.am, null);
});

console.log(n + ' draw tests passed');
