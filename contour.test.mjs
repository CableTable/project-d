// contour.js — offset closed outlines of lines and arcs, inside or outside, in steps, sharp or rounded corners.   node contour.test.mjs
import assert from 'node:assert/strict';
import * as C from './web/contour.js';
import * as D from './web/drawing.js';
import * as W from './web/dxf-write.js';
import * as E from './web/edit.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, m, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * (1 + Math.abs(b)), `${m || ''} ${a} !~ ${b}`);
const PI = Math.PI;

test('TODO 155c fixes: partial closed outlines differ from real open chains and unrelated closed selections', () => {
  const doc = W.newDoc();
  W.addEntities(doc, [W.line(0, 0, 10, 0), W.line(10, 0, 10, 10), W.line(10, 10, 0, 10), W.line(0, 10, 0, 0),
    W.line(20, 0, 30, 0), W.line(30, 0, 30, 10), W.circle(50, 50, 2)]);
  const raw = D.readDxf(W.writeDxf(doc)), ed = E.makeIndex(raw, D.flatten(raw));
  for (const i of [0, 1]) assert.equal(C.partialOutline(ed, new Set([i]), .01), true, 'horizontal or vertical edge');
  assert.equal(C.partialOutline(ed, new Set([0, 1, 2, 3]), .01), false, 'already complete');
  assert.equal(C.partialOutline(ed, new Set([4]), .01), false, 'a genuinely open chain');
  assert.equal(C.partialOutline(ed, new Set([4, 6]), .01), false, 'an unrelated selected circle cannot close the open chain');
  assert.equal(C.partialOutline(ed, new Set([0, 6]), .01), true, 'a full loop and a partial loop');
  W.addEntities(doc, [W.line(10, 10, 15, 10), W.line(15, 10, 15, 15), W.line(15, 15, 10, 15), W.line(10, 15, 10, 10)]);
  const joined = D.readDxf(W.writeDxf(doc));
  assert.equal(C.partialOutline(E.makeIndex(joined, D.flatten(joined)), new Set([0, 1, 2, 3]), .01), true, 'a selected loop can still be part of a larger joined outline');
});

const poly = (pts) => pts.map((p, i) => C.seg(p, pts[(i + 1) % pts.length]));
const rect = (x, y, w, h) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
const BU = Math.tan(PI / 8);
/** A rectangle with quarter-circle corners of radius r (anticlockwise). */
function roundRect(x, y, w, h, r) {
  const q = (p0, p1, b = 0) => C.seg(p0, p1, b);
  return [q([x + r, y], [x + w - r, y]), q([x + w - r, y], [x + w, y + r], BU), q([x + w, y + r], [x + w, y + h - r]), q([x + w, y + h - r], [x + w - r, y + h], BU),
    q([x + w - r, y + h], [x + r, y + h]), q([x + r, y + h], [x, y + h - r], BU), q([x, y + h - r], [x, y + r]), q([x, y + r], [x + r, y], BU)];
}
/** A circle as three arcs of 120°. */
function circ(cx, cy, r) {
  const at = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)], b = Math.tan(PI / 6);
  return [C.seg(at(0), at(2 * PI / 3), b), C.seg(at(2 * PI / 3), at(4 * PI / 3), b), C.seg(at(4 * PI / 3), at(2 * PI), b)];
}
const lShape = poly([[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]]);
const closed = (loop) => loop.every((s, i) => { const p = loop[(i + loop.length - 1) % loop.length]; return Math.hypot(s.p0[0] - p.p1[0], s.p0[1] - p.p1[1]) < 1e-6; });
const off = (loop, t, corners = 'sharp') => { const r = C.offsetLoop(loop, t, { corners }); assert.ok(r.ok, 'offset ' + t + ' failed: ' + r.why); assert.ok(closed(r.loop), 'the result is closed'); return r.loop; };

test('areas: a rectangle, a circle, a rounded rectangle, an L; anticlockwise is positive', () => {
  near(C.loopArea(rect(0, 0, 100, 60)), 6000);
  near(C.loopArea(C.reverseLoop(rect(0, 0, 100, 60))), -6000);
  near(C.loopArea(circ(5, 5, 20)), PI * 400);
  near(C.loopArea(roundRect(0, 0, 100, 60, 18)), 6000 - (4 - PI) * 324);
  near(C.loopArea(lShape), 6400);
});

test('a rectangle: outward sharp is a bigger rectangle, inward a smaller one', () => {
  const o = off(rect(0, 0, 100, 60), 10);
  assert.equal(o.length, 4);
  near(C.loopArea(o), 120 * 80);
  const xs = o.flatMap((s) => [s.p0[0], s.p1[0]]), ys = o.flatMap((s) => [s.p0[1], s.p1[1]]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((v) => Math.round(v * 1e6) / 1e6), [-10, 110, -10, 70]);
  const i = off(rect(0, 0, 100, 60), -10);
  near(C.loopArea(i), 80 * 40);
  const ix = i.flatMap((s) => [s.p0[0], s.p1[0]]);
  near(Math.min(...ix), 10); near(Math.max(...ix), 90);
});

test('a rectangle, rounded corners outward: an arc of radius d about each corner', () => {
  const o = off(rect(0, 0, 100, 60), 10, 'rounded');
  assert.equal(o.length, 8);
  assert.equal(o.filter((s) => s.b).length, 4);
  near(C.loopArea(o), 100 * 60 + 2 * (100 + 60) * 10 + PI * 100);
  for (const s of o.filter((q) => q.b)) { const A = C.arcOf(s); near(A.r, 10); near(A.sweep, PI / 2); }
  // inward corners stay sharp: they are cut where the sides cross
  const i = off(rect(0, 0, 100, 60), -10, 'rounded');
  assert.equal(i.length, 4); near(C.loopArea(i), 80 * 40);
});

test('a rounded rectangle: the corner radius grows or shrinks by d; when it runs out the corner is sharp', () => {
  const rr = roundRect(0, 0, 100, 60, 18);
  const o = off(rr, 10);
  near(C.loopArea(o), 120 * 80 - (4 - PI) * 28 * 28);
  assert.equal(o.filter((s) => s.b).length, 4);
  for (const s of o.filter((q) => q.b)) near(C.arcOf(s).r, 28);
  const i = off(rr, -10);
  near(C.loopArea(i), 80 * 40 - (4 - PI) * 64);
  for (const s of i.filter((q) => q.b)) near(C.arcOf(s).r, 8);
  const j = off(rr, -20);                                         // r = 18 − 20 < 0: the arcs are gone
  assert.equal(j.filter((s) => s.b).length, 0); assert.equal(j.length, 4);
  near(C.loopArea(j), 60 * 20);
  const same = off(rr, 10, 'rounded');                              // smooth joins: nothing extra is added
  assert.equal(same.length, 8);
});

test('a circle: radius ± d; inward past the radius it closes up', () => {
  const c = circ(50, 50, 20);
  near(C.loopArea(off(c, 5)), PI * 625);
  near(C.loopArea(off(c, -5)), PI * 225);
  assert.equal(off(c, 5).length, 3, 'still three arcs');
  const r = C.offsetLoop(c, -20, {});
  assert.equal(r.ok, false); assert.match(r.why, /close up/);
  assert.equal(C.offsetLoop(c, -25, {}).ok, false);
});

test('a polygon: inward until it closes up (a triangle, at its inradius)', () => {
  const tri = poly([[0, 0], [60, 0], [0, 80]]);                  // 3-4-5 ×20: inradius = area / semi-perimeter = 2400 / 120 = 20
  const a = off(tri, -10);
  const s = (20 - 10) / 20;                                       // similar triangle, scaled by (r − d) / r
  near(C.loopArea(a), 2400 * s * s, 'area', 1e-6);
  assert.equal(C.offsetLoop(tri, -20, {}).ok, false, 'at the inradius it is a point');
  assert.equal(C.offsetLoop(tri, -25, {}).ok, false, 'past it the triangle would be turned round');
  assert.equal(C.offsetLoop(rect(0, 0, 100, 60), -30, {}).ok, false, 'a rectangle closes up at half its short side');
  assert.equal(C.offsetLoop(rect(0, 0, 100, 60), -35, {}).ok, false);
  assert.equal(C.offsetLoop(rect(0, 0, 100, 60), -29, {}).ok, true);
});

test('an L-shaped (concave) outline: sharp and rounded corners outward, inward', () => {
  const d = 5;
  near(C.loopArea(off(lShape, d)), 6400 + 400 * d + 4 * d * d, 'sharp: A + P d + (5 − 1) d²');
  const r = off(lShape, d, 'rounded');
  near(C.loopArea(r), 6400 + 400 * d + (5 * PI / 4 - 1) * d * d, 'rounded: the five outer corners are quarter discs');
  assert.equal(r.filter((s) => s.b).length, 5);
  near(C.loopArea(off(lShape, -d)), 4500, 'inward sharp: legs 30 wide: 90 × 30 + 30 × 60');
});

test('sharp corners: a very sharp point is cut flat (the miter is limited to 4 × d)', () => {
  const spike = poly([[0, 0], [100, 0], [0, 6]]);                 // a thin wedge: its tip, at (100, 0), is a spike of about 3.4°
  const o = off(spike, 3);
  assert.ok(o.length > 3, 'a bevel was added at the spike: ' + o.length);
  const xs = o.flatMap((s) => [s.p0[0], s.p1[0]]);
  assert.ok(Math.max(...xs) < 100 + 4 * 3 + 1e-6, 'it does not run out to a long needle: ' + Math.max(...xs));
  // an ordinary right angle keeps its miter
  assert.equal(off(rect(0, 0, 10, 10), 3).length, 4);
});

test('contour(): steps from the original, rounded corners grow with the step; stops early with a reason', () => {
  const r = C.contour([rect(0, 0, 100, 60)], { dist: 10, steps: 3, outward: true, corners: 'rounded' });
  assert.equal(r.made, 3); assert.equal(r.steps.length, 3); assert.equal(r.stopped, null);
  [1, 2, 3].forEach((k, i) => near(C.loopArea(r.steps[i][0]), 6000 + 320 * 10 * k + PI * 100 * k * k, 'step ' + k));
  const c = C.contour([rect(0, 0, 100, 60)], { dist: 10, steps: 5, outward: false, corners: 'sharp' });
  assert.equal(c.made, 2, 'steps 1 and 2 fit (80 × 40, 60 × 20); step 3 would be 40 × 0');
  assert.deepEqual(c.stopped, { step: 3, why: 'it would close up' });
  const none = C.contour([circ(0, 0, 5)], { dist: 6, steps: 2, outward: false, corners: 'sharp' });
  assert.equal(none.made, 0); assert.equal(none.stopped.step, 1);
});

test('holes move the other way: a plate with a hole, outward, the hole shrinks; a hole that closes up is dropped', () => {
  const plate = rect(0, 0, 100, 60), hole = C.reverseLoop(circ(50, 30, 12));                 // a hole drawn the other way about: still found
  const r = C.contour([plate, hole], { dist: 5, steps: 2, outward: true, corners: 'sharp' });
  assert.equal(r.steps.length, 2); assert.equal(r.steps[0].length, 2);
  const areas = r.steps[0].map((l) => C.loopArea(l)).sort((a, b) => a - b);
  near(areas[0], PI * 49, 'the hole is 12 − 5 = 7 across'); near(areas[1], 110 * 70);
  const r2 = C.contour([plate, hole], { dist: 5, steps: 3, outward: true, corners: 'sharp' });
  assert.equal(r2.steps.length, 3); assert.equal(r2.steps[2].length, 1, 'at step 3 (15 mm) the hole has closed up');
  assert.equal(r2.dropped, 1);
  const inw = C.contour([plate, hole], { dist: 5, steps: 1, outward: false, corners: 'sharp' });
  const ia = inw.steps[0].map((l) => C.loopArea(l)).sort((a, b) => a - b);
  near(ia[0], PI * 17 * 17, 'inward: the hole grows by 5'); near(ia[1], 90 * 50, 'the plate shrinks');

});

test('buildLoops: pieces in any order and direction join into closed loops; open pieces are counted', () => {
  const segs = [...rect(0, 0, 10, 10), ...rect(50, 50, 5, 5)];
  const shuffled = [segs[3], C.seg(segs[1].p1, segs[1].p0), segs[6], segs[0], segs[4], segs[2], C.seg(segs[7].p1, segs[7].p0), segs[5]];
  const r = C.buildLoops(shuffled, 1e-6);
  assert.equal(r.loops.length, 2); assert.equal(r.open, 0);
  assert.deepEqual(r.loops.map((l) => Math.round(C.loopArea(l))).sort((a, b) => a - b), [25, 100], 'both anticlockwise');
  assert.ok(r.loops.every(closed));
  const openBox = C.buildLoops(rect(0, 0, 10, 10).slice(0, 3), 1e-6);
  assert.equal(openBox.loops.length, 0); assert.equal(openBox.open, 3);
  const gap = C.buildLoops([C.seg([0, 0], [10, 0]), C.seg([10, 0.0004], [10, 10]), C.seg([10, 10], [0, 10]), C.seg([0, 10], [0, 0])], 0.001);
  assert.equal(gap.loops.length, 1, 'a gap under the tolerance is joined');
  assert.equal(C.buildLoops([C.seg([0, 0], [10, 0]), C.seg([10, 0.5], [10, 10]), C.seg([10, 10], [0, 10]), C.seg([0, 10], [0, 0])], 0.001).loops.length, 0);
  // a loop whose last piece starts it: grown from the other end
  const mid = C.buildLoops([segs[1], segs[0], segs[2], segs[3]], 1e-6);
  assert.equal(mid.loops.length, 1);
});

test('arcs: bulge ↔ centre, radius and sweep; three points; reversed', () => {
  const s = C.seg([10, 0], [0, 10], Math.tan(PI / 8));                // a quarter circle about the origin, anticlockwise
  const A = C.arcOf(s);
  near(A.c[0], 0, '', 1e-9); near(A.c[1], 0, '', 1e-9); near(A.r, 10); near(A.sweep, PI / 2); near(A.a0, 0, '', 1e-9);
  const cw = C.arcOf(C.seg([0, 10], [10, 0], -Math.tan(PI / 8)));
  near(cw.c[0], 0, '', 1e-9); near(cw.sweep, -PI / 2);
  near(C.bulgeOf3([10, 0], [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10], [0, 10]), Math.tan(PI / 8));
  near(C.bulgeOf3([0, 10], [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10], [10, 0]), -Math.tan(PI / 8));
  assert.equal(C.bulgeOf3([0, 0], [5, 5], [10, 10]), 0, 'in a line');
  // a big arc (240°) keeps its centre on the right side of the chord
  const big = C.arcOf(C.seg([10 * Math.cos(-PI / 3), 10 * Math.sin(-PI / 3)], [-10, 0], Math.tan(PI / 3)));
  near(big.c[0], 0, '', 1e-9); near(big.c[1], 0, '', 1e-9); near(big.sweep, 4 * PI / 3);
});

test('loopPoints samples arcs; toEntities: LINEs and ARCs in degrees, a whole circle is one CIRCLE', () => {
  const pts = C.loopPoints(roundRect(0, 0, 100, 60, 18), 5);
  assert.ok(pts.length > 8 * 2);
  const ents = C.toEntities(roundRect(0, 0, 100, 60, 18), 'Contour');
  assert.deepEqual(ents.map((e) => e.type), ['LINE', 'ARC', 'LINE', 'ARC', 'LINE', 'ARC', 'LINE', 'ARC']);
  assert.ok(ents.every((e) => e.layer === 'Contour'));
  const v = (e, c) => +e.r.v[e.r.c.indexOf(c)];
  assert.deepEqual([v(ents[1], 50), v(ents[1], 51)].map((x) => Math.round(x * 1e6) / 1e6), [270, 0], 'the first corner arc runs from 270° to 0°');
  assert.equal(C.toEntities(circ(5, 5, 7), 'Contour').length, 1);
  assert.equal(C.toEntities(circ(5, 5, 7), 'Contour')[0].type, 'CIRCLE');
  near(+C.toEntities(circ(5, 5, 7), 'Contour')[0].r.v[C.toEntities(circ(5, 5, 7), 'Contour')[0].r.c.indexOf(40)], 7);
  // a clockwise arc is written anticlockwise from its end to its start
  const cwArc = C.toEntities([C.seg([10, 0], [0, 10], -Math.tan(PI / 8)), C.seg([0, 10], [10, 0])], 'X');
  assert.equal(cwArc[0].type, 'ARC');
});

test('from a drawing: a closed polyline, a rounded rectangle and a circle become loops (lines and arcs from what is drawn)', () => {
  const doc = W.newDoc(4);
  W.addEntities(doc, W.rect(0, 0, 100, 60, { layer: 'A' }), W.roundRect(200, 0, 100, 60, 18, { layer: 'B' }), W.circle(400, 30, 20, { layer: 'C' }),
    W.line(500, 0, 600, 0, { layer: 'D' }), W.line(600, 0, 600, 50, { layer: 'D' }), W.arc(600, 70, 20, 270, 360, { layer: 'D' }));
  const raw = D.readDxf(W.writeDxf(doc)), fl = D.flatten(raw), ed = E.makeIndex(raw, fl);
  const loopsOf = (ents) => C.buildLoops(C.segmentsFromItems(ed, ents), 1e-4);
  const r = loopsOf([0]); assert.equal(r.loops.length, 1); near(C.loopArea(r.loops[0]), 6000);
  const rr = loopsOf([1]); assert.equal(rr.loops.length, 1); near(C.loopArea(rr.loops[0]), 6000 - (4 - PI) * 324, '', 1e-5);
  assert.equal(rr.loops[0].filter((s) => s.b).length, 4);
  const cc = loopsOf([2]); assert.equal(cc.loops.length, 1); near(C.loopArea(cc.loops[0]), PI * 400, '', 1e-5);
  assert.equal(cc.loops[0].length, 3, 'a circle is three arcs of 120°');
  const op = loopsOf([3, 4, 5]); assert.equal(op.loops.length, 0); assert.ok(op.open >= 3, 'an open chain stays open');
  const all = loopsOf([0, 1, 2]); assert.equal(all.loops.length, 3);
  // the contour of the drawing's rounded rectangle
  const c = C.contour(rr.loops, { dist: 10, steps: 3, outward: true, corners: 'rounded' });
  assert.equal(c.made, 3);
  assert.equal(c.steps[0][0].length, 8, 'the 6-decimal file data still joins smoothly: no stray bits at the tangent joints');
  near(C.loopArea(c.steps[2][0]), 160 * 120 - (4 - PI) * 48 * 48, 'step 3: 30 mm out, corner radius 18 + 30', 1e-5);
});

test('the contour outlines are ordinary lines and arcs: they pick, chain and snap like any other geometry (his ask)', () => {
  const doc = W.newDoc(4);
  W.addEntities(doc, W.rect(0, 0, 100, 60, { layer: 'A' }));
  const raw0 = D.readDxf(W.writeDxf(doc)), ed0 = E.makeIndex(raw0, D.flatten(raw0));
  const loops = C.buildLoops(C.segmentsFromItems(ed0, [0]), 1e-4).loops;
  const r = C.contour(loops, { dist: 10, steps: 1, outward: true, corners: 'rounded' });
  W.addLayer(doc, 'Contour', { aci: 3 });
  W.addEntities(doc, ...C.toEntities(r.steps[0][0], 'Contour'));
  const raw = D.readDxf(W.writeDxf(doc)), fl = D.flatten(raw), ed = E.makeIndex(raw, fl);
  assert.equal(raw.entities.filter((e) => e.layer === 'Contour').length, 8);
  assert.ok(fl.layers.some((l) => l.name === 'Contour'), 'the layer is in the drawing');
  const sn = E.snapPick(ed, 0.3, -10.2, 1, true);                       // the end of the bottom contour line, (0, -10)
  assert.equal(sn.kind, 'end'); near(sn.x, 0, 'x', 1e-6); near(sn.y, -10, 'y', 1e-6);
  const arcMid = E.snapPick(ed, 50, -9.7, 1, true);                       // the middle of that line
  assert.ok(arcMid && arcMid.kind === 'mid' && Math.abs(arcMid.y + 10) < 1e-6);
  const e = E.hitEntity(ed, 50, -10, 0.5);
  assert.equal(raw.entities[e].layer, 'Contour');
  assert.equal(E.chainAt(ed, e, E.chainTol(fl.boxes.model, 1)).length, 8, 'the eight pieces chain into one outline');
  // and the area of that picked outline is what the contour made
  const ap = E.areaPerimeter(ed, new Set(E.chainAt(ed, e, E.chainTol(fl.boxes.model, 1))), 1, E.chainTol(fl.boxes.model, 1));
  near(ap.area, 6000 + 320 * 10 + PI * 100, 'area', 1e-5);
});

test('an arc with no radius or no sweep adds no zero-length piece (the outline still offsets); a very dense loop does not overflow the stack', () => {
  const doc = W.newDoc(4);
  W.addEntities(doc, W.rect(0, 0, 100, 60, { layer: 'A' }), W.arc(50, 30, 0, 0, 90, { layer: 'A' }));
  const raw = D.readDxf(W.writeDxf(doc)), ed = E.makeIndex(raw, D.flatten(raw));
  const segs = C.segmentsFromItems(ed, [0, 1]);
  assert.ok(segs.every((s) => Math.hypot(s.p1[0] - s.p0[0], s.p1[1] - s.p0[1]) > 1e-12), 'no zero-length segment');
  const { loops } = C.buildLoops(segs, 1e-4);
  assert.equal(loops.length, 1);
  assert.equal(C.offsetLoop(loops[0], 5).ok, true);
  const N = 150000, big = Array.from({ length: N }, (_, i) => [1000 * Math.cos((2 * PI * i) / N), 1000 * Math.sin((2 * PI * i) / N)]);
  assert.doesNotThrow(() => C.offsetLoop(poly(big), 1));
});

console.log(n + ' contour tests passed');
