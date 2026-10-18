// draw.js — the drawing tools' geometry and typed input.   node draw.test.mjs
import assert from 'node:assert/strict';
import * as DR from './web/draw.js';
import { readDxf, flatten } from './web/drawing.js';
import { newDoc, addEntities, writeDxf } from './web/dxf-write.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const nearPt = (a, b, e = 1e-6) => { near(a[0], b[0], e); near(a[1], b[1], e); };

test('parseInput: x,y, @dx,dy, polar, a length, words, Enter', () => {
  assert.deepEqual(DR.parseInput('10,20'), { kind: 'xy', rel: false, x: 10, y: 20 });
  assert.deepEqual(DR.parseInput(' 10 , -20.5 '), { kind: 'xy', rel: false, x: 10, y: -20.5 });
  assert.deepEqual(DR.parseInput('@5,-3'), { kind: 'xy', rel: true, x: 5, y: -3 });
  assert.deepEqual(DR.parseInput('@ .5,1'), { kind: 'xy', rel: true, x: 0.5, y: 1 });
  assert.deepEqual(DR.parseInput('@100<45'), { kind: 'polar', rel: true, len: 100, ang: 45 });
  assert.deepEqual(DR.parseInput('100<-30'), { kind: 'polar', rel: false, len: 100, ang: -30 });
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

test('Line: each click adds a point; Enter ends with a LINE per segment; typed points and direct distance', () => {
  const T = DR.createTool('line');
  assert.equal(click(T, [0, 0]).made, null);
  assert.equal(click(T, [10, 0]).made, null);
  DR.toolHover(T, [10, 5]);                                            // the rubber band points up
  assert.equal(DR.toolType(T, '20').made, null);                       // direct distance: 20 straight up from (10, 0)
  assert.deepEqual(T.pts[2], [10, 20]);
  DR.toolType(T, '@5,0');
  assert.deepEqual(T.pts[3], [15, 20]);
  DR.toolType(T, '30,40');
  assert.deepEqual(T.pts[4], [30, 40]);
  DR.toolType(T, '@10<90');
  assert.deepEqual(T.pts[5].map((v) => +v.toFixed(6)), [30, 50]);
  const r = DR.toolType(T, '');                                        // Enter
  assert.equal(r.made.length, 5); assert.ok(r.made.every((s) => s.t === 'line'));
  assert.deepEqual(r.made[0], { t: 'line', a: [0, 0], b: [10, 0] });
  assert.deepEqual(T.pts, [], 'ready for the next line');
});

test('Line: a length with no direction says so; Undo drops the last point; one point is no line; Close adds the last segment', () => {
  const T = DR.createTool('line');
  click(T, [0, 0]);
  assert.match(DR.toolType(T, '10').msg, /Move the pointer/);
  assert.equal(T.pts.length, 1);
  assert.match(DR.toolFinish(T).msg, /two points/);
  click(T, [0, 0], [10, 0], [10, 10]);
  DR.toolType(T, 'u');
  assert.equal(T.pts.length, 2);
  click(T, [10, 10]);
  const r = DR.toolType(T, 'c');                                       // three points: a closed triangle
  assert.equal(r.made.length, 3);
  assert.deepEqual(r.made[2], { t: 'line', a: [10, 10], b: [0, 0] });
  assert.match(DR.toolType(T, 'c').msg, /Close needs three/);
  assert.match(click(DR.createTool('line'), [1, 1], [1, 1]).msg, /last point again/);
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

console.log(n + ' draw tests passed');
