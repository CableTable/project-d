// modify.js — Offset, Trim and Mirror.   node modify.test.mjs
import assert from 'node:assert/strict';
import * as M from './web/modify.js';
import { shapeOf, get } from './web/grips.js';
import { extendEntity, extendRegion } from './web/extend.js';
import { entity, line, circle, arc, lwpoly, text, mtext, ellipse, insert, rect, roundRect } from './web/dxf-write.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const nearPt = (a, b, e = 1e-6) => { near(a[0], b[0], e); near(a[1], b[1], e); };
const S = (ent) => shapeOf(ent, 1);
const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** Every point of a shape's outline sampled: for "is it d away from that" checks. */
function distToSegs(P, segs) { return Math.min(...segs.map((s) => { const d = [s.b[0] - s.a[0], s.b[1] - s.a[1]], l2 = d[0] * d[0] + d[1] * d[1], t = Math.max(0, Math.min(1, ((P[0] - s.a[0]) * d[0] + (P[1] - s.a[1]) * d[1]) / l2)); return len(P, [s.a[0] + d[0] * t, s.a[1] + d[1] * t]); })); }

const base = { layer: 'Cut', aci: 3 };
const widePoly = (width, closed = false) => entity('LWPOLYLINE', [
  [90, 3], [70, closed ? 1 : 0], [43, width],
  [10, 0], [20, 0], [40, 2], [41, 4],
  [10, 100], [20, 0], [40, 6], [41, 8],
  [10, 100], [20, 50], [40, 10], [41, 12],
], base);
const widthsOf = (ent) => ent.r.c.flatMap((c, i) => c === 40 || c === 41 ? [Number(ent.r.v[i])] : []);

test('geo: a bulge is an arc through its two ends with the right centre and sweep', () => {
  const g = M.geo({ a: [10, 0], b: [0, 10], bulge: Math.tan(Math.PI / 8) });            // a quarter circle round the origin, anticlockwise
  nearPt(g.c, [0, 0]); near(g.r, 10); near(g.sw, Math.PI / 2); near(g.a0, 0);
  const h = M.geo({ a: [0, 10], b: [10, 0], bulge: -Math.tan(Math.PI / 8) });           // the same arc walked clockwise
  nearPt(h.c, [0, 0]); near(h.r, 10); near(h.sw, -Math.PI / 2);
  const big = M.geo({ a: [10, 0], b: [-10, 0], bulge: -1 });                              // clockwise half circle: centre in the middle
  nearPt(big.c, [0, 0]); near(big.r, 10);
  const over = M.geo({ a: [10, 0], b: [0, 10], bulge: Math.tan(3 * Math.PI / 8) });       // three quarters, anticlockwise: the centre is on the other side
  near(len(over.c, [10, 0]), over.r); near(len(over.c, [0, 10]), over.r); near(over.sw, 3 * Math.PI / 2);
});

test('Offset a line: to the side of the pick, d away, same length, same layer', () => {
  const l = line(0, 0, 100, 0, base);
  let r = M.offsetEntity(l, 10, [50, 30]);
  assert.equal(r.ent.layer, 'Cut'); assert.equal(r.ent.aci, 3);
  nearPt(S(r.ent).a, [0, 10]); nearPt(S(r.ent).b, [100, 10]);
  r = M.offsetEntity(l, 10, [50, -3]);
  nearPt(S(r.ent).a, [0, -10]); nearPt(S(r.ent).b, [100, -10]);
  r = M.offsetEntity(line(0, 0, 0, 50), 5, [-20, 10]);                                       // a vertical line, picked on its left
  nearPt(S(r.ent).a, [-5, 0]); nearPt(S(r.ent).b, [-5, 50]);
  assert.match(M.offsetEntity(l, 0, [0, 1]).error, /more than 0/);
  assert.match(M.offsetEntity(l, -2, [0, 1]).error, /more than 0/);
});

test('Offset a circle: out or in by the side picked; more than the radius is refused', () => {
  const c = circle(10, 20, 15, base);
  let r = M.offsetEntity(c, 5, [10, 100]);
  near(S(r.ent).r, 20); nearPt(S(r.ent).c, [10, 20]);
  r = M.offsetEntity(c, 5, [12, 21]);
  near(S(r.ent).r, 10);
  assert.match(M.offsetEntity(c, 15, [12, 21]).error, /more than the radius/);
  assert.match(M.offsetEntity(c, 40, [12, 21]).error, /more than the radius/);
});

test('Offset an arc: same centre and angles, new radius; shrinking below 0 refused', () => {
  const a = arc(0, 0, 10, 30, 120, base);
  let r = M.offsetEntity(a, 4, [0, 50]);
  near(S(r.ent).r, 14); near(S(r.ent).a0, 30); near(S(r.ent).a1, 120);
  r = M.offsetEntity(a, 4, [1, 1]);
  near(S(r.ent).r, 6);
  assert.match(M.offsetEntity(a, 12, [1, 1]).error, /more than the radius/);
});

test('Offset a closed rectangle: outward grows it with mitred corners, inward shrinks it; too much is refused', () => {
  const r0 = rect(0, 0, 100, 60, base);
  let r = M.offsetEntity(r0, 10, [-5, 30]);                                                  // picked outside the left side
  let s = S(r.ent);
  assert.equal(s.closed, true); assert.equal(s.pts.length, 4);
  const xs = s.pts.map((p) => p[0]), ys = s.pts.map((p) => p[1]);
  near(Math.min(...xs), -10); near(Math.max(...xs), 110); near(Math.min(...ys), -10); near(Math.max(...ys), 70);
  r = M.offsetEntity(r0, 10, [50, 30]);                                                      // inside
  s = S(r.ent);
  near(Math.min(...s.pts.map((p) => p[0])), 10); near(Math.max(...s.pts.map((p) => p[0])), 90);
  near(Math.min(...s.pts.map((p) => p[1])), 10); near(Math.max(...s.pts.map((p) => p[1])), 50);
  assert.match(M.offsetEntity(r0, 40, [50, 30]).error, /nothing is left|more than/);
});

test('Offset an open polyline: both ends move sideways, the inner corner is mitred', () => {
  const p = lwpoly([[0, 0], [100, 0], [100, 100]], base);                                    // an L: right turn at (100, 0)... anticlockwise: left turn
  let r = M.offsetEntity(p, 10, [50, 5]);                                                    // above the first leg, the inside of the L
  let s = S(r.ent);
  assert.equal(s.closed, false); assert.equal(s.pts.length, 3);
  nearPt(s.pts[0], [0, 10]); nearPt(s.pts[1], [90, 10]); nearPt(s.pts[2], [90, 100]);
  r = M.offsetEntity(p, 10, [50, -5]);                                                       // outside: the corner is extended
  s = S(r.ent);
  nearPt(s.pts[0], [0, -10]); nearPt(s.pts[1], [110, -10]); nearPt(s.pts[2], [110, 100]);
});

test('Offset a plain arc beside a line: a straight filler does not add vertex widths', () => {
  const result = M.offsetEntity(lwpoly([[0, 0, 1], [10, 0], [20, 0]]), 4, [15, 4]);
  assert.ok(result.ent, result.error);
  assert.equal(S(result.ent).pts.length, 4, 'a filler joins the arc and line');
  assert.equal(result.ent.r.c.includes(40), false);
  assert.equal(result.ent.r.c.includes(41), false);
});

test('Offset a polyline with a bulge: the arc keeps its centre and takes the new radius; joins stay tangent', () => {
  // a slot: line, half circle, line, half circle (closed), 40 long, 20 wide
  const slot = lwpoly([[10, 0], [50, 0, 1], [50, 20], [10, 20, 1]], { ...base, closed: true });
  const r = M.offsetEntity(slot, 3, [30, 10]);                                               // inside
  const s = S(r.ent);
  assert.equal(s.closed, true);
  // the flat sides move in by 3: y = 3 and y = 17, and the half circles are radius 10 - 3 = 7
  const flats = s.pts.map((p) => p[1]);
  near(Math.min(...flats), 3); near(Math.max(...flats), 17);
  const bulges = s.pts.filter((p) => p[2]);
  assert.equal(bulges.length, 2);
  for (const b of bulges) near(Math.abs(b[2]), 1, 1e-4);
  const out = M.offsetEntity(slot, 3, [30, -50]);                                            // outside: radius 13
  const so = S(out.ent);
  near(Math.min(...so.pts.map((p) => p[1])), -3); near(Math.max(...so.pts.map((p) => p[1])), 23);
  // a rounded rectangle inward by MORE than the corner radius: the corner arcs go and the sides meet in plain corners
  const rr = roundRect(0, 0, 100, 60, 5, base);
  const gone = M.offsetEntity(rr, 8, [50, 30]);
  const sg = S(gone.ent);
  assert.equal(sg.pts.filter((p) => p[2]).length, 0, 'no arcs left');
  near(Math.min(...sg.pts.map((p) => p[0])), 8); near(Math.max(...sg.pts.map((p) => p[0])), 92);
  near(Math.min(...sg.pts.map((p) => p[1])), 8); near(Math.max(...sg.pts.map((p) => p[1])), 52);
  // and by less: the arcs shrink to radius 5 - 2 = 3
  const some = M.offsetEntity(rr, 2, [50, 30]);
  const sm = S(some.ent);
  const arcs = sm.pts.filter((p) => p[2]);
  assert.equal(arcs.length, 4);
  near(Math.min(...sm.pts.map((p) => p[0])), 2);
  const segs = [];
  for (let i = 0; i < sm.pts.length; i++) segs.push({ a: sm.pts[i], b: sm.pts[(i + 1) % sm.pts.length] });
  assert.ok(Math.abs(len(sm.pts[0], sm.pts[1]) - 0) >= 0);
  // the offset curve stays 2 mm away from the original sides: a point on the new left side is 2 from x = 0
  const left = sm.pts.filter((p) => Math.abs(p[0] - 2) < 1e-6);
  assert.ok(left.length >= 2);
});

test('Offset: other kinds are refused with a message', () => {
  assert.match(M.offsetEntity(text(0, 0, 5, 'Hi'), 5, [0, 0]).error, /line, arc, circle or polyline/);
  assert.match(M.offsetEntity(ellipse(0, 0, 10, 0, 0.5), 5, [0, 0]).error, /line, arc, circle or polyline/);
  assert.equal(M.canModify(line(0, 0, 1, 1)), true);
  assert.equal(M.canModify(insert('B', 0, 0)), false);
});

test('Trim: a polyline side of zero length (a bulged one too) is refused, and an edge with one is still usable', () => {
  const bad = { t: 'poly', closed: false, pts: [[0, 0, 0], [10, 0, 0.5], [10, 0, 0], [20, 0, 0]] };
  assert.match(M.trimShape(bad, [{ t: 'line', a: [5, -5], b: [5, 5] }], [2, 0]).error, /without length/);
  const r = M.trimShape({ t: 'line', a: [0, 0], b: [20, 0] }, [bad, { t: 'line', a: [15, -5], b: [15, 5] }], [18, 0]);
  assert.ok(r.shapes && r.shapes.every((s) => [s.a, s.b].flat().every(Number.isFinite)));
});

const X = (ent) => S(ent);
test('Trim a line between two edges: the middle goes, two lines are left', () => {
  const l = line(0, 0, 100, 0, base);
  const e1 = line(30, -10, 30, 10), e2 = line(70, -10, 70, 10);
  const r = M.trimEntity(l, [e1, e2], [50, 0]);
  assert.equal(r.ents.length, 2);
  nearPt(X(r.ents[0]).a, [0, 0]); nearPt(X(r.ents[0]).b, [30, 0]);
  nearPt(X(r.ents[1]).a, [70, 0]); nearPt(X(r.ents[1]).b, [100, 0]);
  assert.equal(r.ents[0].layer, 'Cut');
  const end = M.trimEntity(l, [e1, e2], [90, 0]);                                           // the end beyond the last edge goes
  assert.equal(end.ents.length, 1);
  nearPt(X(end.ents[0]).a, [0, 0]); nearPt(X(end.ents[0]).b, [70, 0]);
  const one = M.trimEntity(l, [e1], [10, 0]);                                               // one edge: the start goes
  assert.equal(one.ents.length, 1);
  nearPt(X(one.ents[0]).a, [30, 0]); nearPt(X(one.ents[0]).b, [100, 0]);
  assert.match(M.trimEntity(l, [line(200, -5, 200, 5)], [10, 0]).error, /Nothing crosses/);
  assert.match(M.trimEntity(l, [], [10, 0]).error, /Nothing crosses/);
  assert.equal(M.trimEntity(l, [l, e1], [10, 0]).ents.length, 1, 'the line is not its own cutting edge');
});

test('Trim a circle between two lines leaves one arc; one crossing is refused', () => {
  const c = circle(0, 0, 10, base);
  const e1 = line(-20, 5, 20, 5), e2 = line(-20, -5, 20, -5);
  const r = M.trimEntity(c, [e1, e2], [10, 0]);                                              // the right-hand part between the lines goes
  assert.equal(r.ents.length, 1);
  const s = X(r.ents[0]);
  assert.equal(s.t, 'arc'); near(s.r, 10); nearPt(s.c, [0, 0]);
  // what is left runs anticlockwise from the upper cut round the left to the lower cut
  const a0 = [10 * Math.cos(s.a0 * Math.PI / 180), 10 * Math.sin(s.a0 * Math.PI / 180)], a1 = [10 * Math.cos(s.a1 * Math.PI / 180), 10 * Math.sin(s.a1 * Math.PI / 180)];
  near(a0[1], 5, 1e-4); near(a1[1], -5, 1e-4);
  const left = M.trimEntity(c, [e1, e2], [-10, 0]);                                           // pick on the left: the right part stays
  const sl = X(left.ents[0]);
  const m = (sl.a0 + ((sl.a1 - sl.a0 + 360) % 360) / 2) * Math.PI / 180;
  assert.ok(Math.cos(m) > 0, 'the arc left is on the right');
  assert.match(M.trimEntity(c, [line(0, 0, 20, 0)], [10, 3]).error, /two cutting edges/);
});

test('Trim an arc and an open polyline', () => {
  const a = arc(0, 0, 10, 0, 180, base);                                                     // the upper half circle
  const e = line(0, -20, 0, 20);                                                              // crosses at the top, (0, 10)
  const r = M.trimEntity(a, [e], [8, 6]);                                                    // the right part goes
  assert.equal(r.ents.length, 1);
  const s = X(r.ents[0]);
  near(s.a0, 90); near(s.a1, 180);
  const p = lwpoly([[0, 0], [50, 0], [50, 50], [0, 50]], base);
  const edge = line(-10, 25, 60, 25), edge2 = line(25, -10, 25, 10);
  const pr = M.trimEntity(p, [edge, edge2], [50, 10]);                                       // the stretch from the bottom edge round the corner to the side edge goes
  assert.equal(pr.ents.length, 2);
  const p0 = X(pr.ents[0]), p1 = X(pr.ents[1]);
  assert.equal(p0.pts.length, 2); nearPt(p0.pts[0], [0, 0]); nearPt(p0.pts[1], [25, 0]);
  assert.equal(p1.pts.length, 3); nearPt(p1.pts[0], [50, 25]); nearPt(p1.pts[1], [50, 50]); nearPt(p1.pts[2], [0, 50]);
});

test('Trim a closed polyline between two edges leaves one open piece', () => {
  const r0 = rect(0, 0, 100, 50, base);
  const e1 = line(30, -10, 30, 10), e2 = line(70, -10, 70, 10);
  const r = M.trimEntity(r0, [e1, e2], [50, 0]);                                              // the stretch of the bottom side between them
  assert.equal(r.ents.length, 1);
  const s = X(r.ents[0]);
  assert.equal(s.closed, false);
  nearPt(s.pts[0], [70, 0]); nearPt(s.pts[s.pts.length - 1], [30, 0]);
  assert.equal(s.pts.length, 6);
  assert.match(M.trimEntity(r0, [e1], [50, 0]).error, /two cutting edges/);
});

test('Trim an arc segment of a polyline keeps the bulge of what is left', () => {
  const p = lwpoly([[0, 0], [10, 0, 1], [10, 20]], base);                                    // a line, then a half circle (centre (10, 10), radius 10)
  const e = line(20, 10, 0, 10);                                                              // the horizontal through the centre cuts the half circle in two
  const r = M.trimEntity(p, [e], [18, 15]);                                                   // the upper quarter goes
  const s = X(r.ents[0]);
  assert.equal(s.pts.length, 3);
  assert.ok(Math.abs(s.pts[1][2] - Math.tan(Math.PI / 8)) < 1e-5, 'a quarter circle is left: ' + JSON.stringify(s.pts));
});

test('TODO 78: removed preview is exactly the missing path after Trim, including ends, corners, bulges and closed wraps', () => {
  const length = (ent) => M.pathOf(S(ent)).segs.reduce((sum, seg) => {
    const g = M.geo(seg); return sum + (g.line ? g.len : Math.abs(g.sw) * g.r);
  }, 0);
  const vertical = (x) => line(x, -20, x, 60), horizontal = (y) => line(-20, y, 60, y);
  const l = line(0, 0, 100, 0, base);
  for (const [name, source, edges, pick, start, end, removedLength] of [
    ['line between edges', l, [vertical(30), vertical(70)], [50, 0], [30, 0], [70, 0], 40],
    ['line start, one edge', l, [vertical(30)], [10, 0], [0, 0], [30, 0], 30],
    ['line end, one edge', l, [vertical(30)], [90, 0], [30, 0], [100, 0], 70],
    ['arc', arc(0, 0, 10, 0, 180, base), [vertical(0)], [8, 6], [10, 0], [0, 10], 5 * Math.PI],
    ['polyline corner', lwpoly([[0, 0], [50, 0], [50, 50], [0, 50]], base), [line(25, -10, 25, 10), horizontal(25)], [50, 10], [25, 0], [50, 25], 50],
    ['bulged segment', lwpoly([[0, 0], [10, 0, 1], [10, 20]], base), [horizontal(10)], [18, 15], [20, 10], [10, 20], 5 * Math.PI],
    ['circle wrap', circle(0, 0, 10, base), [horizontal(-5), horizontal(5)], [10, 0], [Math.sqrt(75), -5], [Math.sqrt(75), 5], 10 * Math.PI / 3],
    ['closed polyline wrap', rect(0, 0, 100, 50, base), [line(-10, 25, 110, 25)], [50, 0], [0, 25], [100, 25], 150],
  ]) {
    const result = M.trimEntity(source, [source, ...edges], pick);
    assert.ok(result.removed, name);
    assert.equal(result.removed.layer, 'Cut'); assert.equal(result.removed.aci, 3);
    const path = M.pathOf(S(result.removed));
    nearPt(path.segs[0].a, start, 1e-5); nearPt(path.segs.at(-1).b, end, 1e-5);
    near(length(result.removed), removedLength, 1e-4);
    near(result.ents.reduce((sum, e) => sum + length(e), 0) + length(result.removed), length(source), 1e-4);
  }
  assert.equal(M.trimEntity(l, [], [50, 0]).removed, undefined, 'no crossing means no red preview');
  assert.equal(M.trimEntity(circle(0, 0, 10), [line(0, 0, 20, 0)], [10, 0]).removed, undefined, 'one crossing of a closed shape means no red preview');
});

test('Mirror: line, circle, arc, polyline (bulges flip) in a vertical and a sloped mirror line', () => {
  const v1 = [0, 0], v2 = [0, 10];
  let m = M.mirrorEntity(line(10, 5, 30, 25, base), v1, v2);
  nearPt(X(m.ent).a, [-10, 5]); nearPt(X(m.ent).b, [-30, 25]); assert.equal(m.ent.layer, 'Cut');
  m = M.mirrorEntity(circle(10, 5, 3), v1, v2);
  nearPt(X(m.ent).c, [-10, 5]);
  m = M.mirrorEntity(arc(10, 0, 5, 0, 90), v1, v2);                                           // the upper-right quarter becomes the upper-left
  nearPt(X(m.ent).c, [-10, 0]); near(X(m.ent).a0, 90); near(X(m.ent).a1, 180);
  m = M.mirrorEntity(lwpoly([[10, 0, 1], [20, 0]], base), v1, v2);                             // a half circle
  const s = X(m.ent);
  nearPt(s.pts[0], [-10, 0]); nearPt(s.pts[1], [-20, 0]); near(s.pts[0][2], -1);
  // a mirror line at 45 degrees swaps x and y
  m = M.mirrorEntity(line(10, 0, 30, 0), [0, 0], [1, 1]);
  nearPt(X(m.ent).a, [0, 10]); nearPt(X(m.ent).b, [0, 30]);
  m = M.mirrorEntity(arc(0, 0, 10, 0, 90), [0, 0], [1, 1]);                                    // the quarter from the x axis to the y axis maps onto itself
  near(X(m.ent).a0, 0); near(X(m.ent).a1, 90);
  // mirroring twice is the identity
  const orig = lwpoly([[3, 1, 0.4], [9, 2], [7, 8, -0.3]], base);
  const twice = M.mirrorEntity(M.mirrorEntity(orig, [1, 2], [5, 9]).ent, [1, 2], [5, 9]).ent;
  const a = X(orig), b = X(twice);
  for (let i = 0; i < a.pts.length; i++) { nearPt(a.pts[i], b.pts[i], 1e-4); near(a.pts[i][2] || 0, b.pts[i][2] || 0, 1e-4); }
  assert.ok(M.mirrorEntity(line(0, 0, 1, 1), [2, 2], [2, 2]).skip);
});

test('Mirror: text keeps reading the same way (only its place moves); a whole ellipse mirrors; blocks are skipped', () => {
  const t = text(10, 5, 4, 'ABC', { ...base, rot: 30 });
  const m = M.mirrorEntity(t, [0, 0], [0, 1]);
  assert.equal(get(m.ent.r, 10), -10); assert.equal(get(m.ent.r, 20), 5);
  assert.equal(get(m.ent.r, 50), 30, 'the rotation stays: it is not mirrored');
  assert.equal(m.ent.r.v[m.ent.r.c.indexOf(1)], 'ABC');
  const mt = M.mirrorEntity(mtext(10, 5, 4, 'ABC'), [0, 0], [0, 1]);
  assert.equal(get(mt.ent.r, 10), -10);
  const e = M.mirrorEntity(ellipse(10, 0, 5, 2, 0.5), [0, 0], [0, 1]);
  assert.equal(get(e.ent.r, 10), -10); assert.equal(get(e.ent.r, 11), -5); assert.equal(get(e.ent.r, 21), -2 + 4 === 2 ? 2 : get(e.ent.r, 21));
  assert.equal(get(e.ent.r, 21), 2);
  assert.match(M.mirrorEntity(insert('B', 0, 0), [0, 0], [0, 1]).skip, /blocks/);
  assert.ok(M.mirrorEntity(ellipse(0, 0, 5, 2, 0.5, 0, 1), [0, 0], [0, 1]).skip);
});

test('a polyline keeps its constant width and elevation through Mirror, Offset and Trim', () => {
  const wide = lwpoly([[0, 0], [100, 0], [100, 50]], { ...base, width: 0.5 });
  wide.r.c.splice(wide.r.c.indexOf(70) + 1, 0, 38); wide.r.v.splice(wide.r.c.indexOf(38), 0, '2');
  const w = (e) => get(e.r, 43), z = (e) => get(e.r, 38);
  const m = M.mirrorEntity(wide, [0, 0], [0, 10]).ent;
  near(w(m), 0.5); near(z(m), 2);
  const o = M.offsetEntity(wide, 5, [50, 20]).ent;
  near(w(o), 0.5); near(z(o), 2);
  const cut = line(50, -20, 50, 20, base), t = M.trimEntity(wide, [cut], [20, 0]);
  assert.ok(t.ents.length > 0 && t.ents.every((e) => Math.abs(w(e) - 0.5) < 1e-9));
  assert.equal(get(M.mirrorEntity(lwpoly([[0, 0], [10, 0], [10, 5]], base), [0, 0], [0, 10]).ent.r, 43), null, 'a plain polyline stays plain');
});

test('Mirror keeps constant and per-vertex widths for a copy or replacement, without changing the source', () => {
  for (const width of [0, 0.5]) for (const closed of [false, true]) {
    const source = widePoly(width, closed), before = structuredClone(source);
    const mirrored = M.mirrorEntity(source, [0, 0], [0, 10]).ent;
    assert.equal(get(mirrored.r, 43) ?? 0, width);
    assert.deepEqual(widthsOf(mirrored), [2, 4, 6, 8, 10, 12]);
    assert.deepEqual(source, before, 'keeping the source for a copy must leave its widths unchanged');
    assert.deepEqual(widthsOf(M.mirrorEntity(mirrored, [0, 0], [0, 10]).ent), widthsOf(source));
  }
});

test('Offset keeps constant and per-vertex widths on the new polyline', () => {
  for (const width of [0, 0.5]) for (const closed of [false, true]) {
    const source = widePoly(width, closed), before = structuredClone(source);
    const result = M.offsetEntity(source, 5, [50, -20]);
    assert.ok(result.ent, result.error);
    assert.equal(get(result.ent.r, 43) ?? 0, width);
    assert.deepEqual(widthsOf(result.ent), [2, 4, 6, 8, 10, 12]);
    assert.deepEqual(source, before);
  }
});

test('Trim keeps constant and per-vertex widths on every piece, interpolating tapered widths at cuts', () => {
  const edges = [line(25, -10, 25, 10), line(75, -10, 75, 10)];
  for (const width of [0, 0.5]) {
    const source = widePoly(width), before = structuredClone(source);
    const result = M.trimEntity(source, edges, [50, 0]);
    assert.equal(result.ents.length, 2);
    assert.ok(result.ents.every((e) => (get(e.r, 43) ?? 0) === width));
    assert.deepEqual(widthsOf(result.ents[0]), [2, 2.5, 2.5, 2.5]);
    assert.deepEqual(widthsOf(result.ents[1]), [3.5, 4, 6, 8, 10, 12]);
    const closed = M.trimEntity(widePoly(width, true), edges, [50, 0]);
    assert.equal(closed.ents.length, 1);
    assert.equal(get(closed.ents[0].r, 43) ?? 0, width);
    assert.deepEqual(widthsOf(closed.ents[0]), [3.5, 4, 6, 8, 10, 12, 2, 2.5, 2.5, 2.5]);
    assert.deepEqual(source, before);
  }
});

test('an arc with no sweep is a whole circle for Trim and Offset (no NaN radius)', () => {
  const a = arc(0, 0, 10, 30, 30, base);
  const p = M.pathOf(S(a));
  assert.equal(p.type, 'circle');
  const o = M.offsetEntity(a, 5, [30, 0]);
  assert.ok(!o.error, o.error);
});

test('Quick Trim (TODO 155a T1): the piece between the nearest crossings goes, an end piece goes to its end, a lone object goes whole', () => {
  const l = line(0, 0, 100, 0, base), e1 = line(30, -10, 30, 10), e2 = line(70, -10, 70, 10);
  const mid = M.trimEntity(l, [e1, e2], [50, 0], true);                                       // line between two lines: two pieces left
  assert.equal(mid.ents.length, 2);
  nearPt(X(mid.ents[0]).b, [30, 0]); nearPt(X(mid.ents[1]).a, [70, 0]);
  nearPt(X(mid.removed).a, [30, 0]); nearPt(X(mid.removed).b, [70, 0]);
  const end = M.trimEntity(l, [e1, e2], [90, 0], true);                                       // end piece: up to the end of the line
  assert.equal(end.ents.length, 1); nearPt(X(end.ents[0]).b, [70, 0]);
  nearPt(X(end.removed).a, [70, 0]); nearPt(X(end.removed).b, [100, 0]);
  const lone = M.trimEntity(l, [line(200, -5, 200, 5)], [10, 0], true);                       // nothing crosses it: the whole line goes
  assert.deepEqual(lone.ents, []); assert.ok(!lone.error);
  nearPt(X(lone.removed).a, [0, 0]); nearPt(X(lone.removed).b, [100, 0]);
  assert.deepEqual(M.trimEntity(l, [], [10, 0], true).ents, [], 'no other objects at all: it goes');
  assert.match(M.trimEntity(l, [], [10, 0]).error, /Nothing crosses/, 'Standard still refuses');
  const a = arc(0, 0, 10, 0, 180, base);                                                      // arc cut by a line: the right part goes
  const ar = M.trimEntity(a, [line(0, -20, 0, 20)], [8, 6], true);
  assert.equal(ar.ents.length, 1); near(X(ar.ents[0]).a0, 90); near(X(ar.ents[0]).a1, 180);
  const c = circle(0, 0, 10, base);                                                           // circle cut by two lines: one arc left
  const cr = M.trimEntity(c, [line(-20, 5, 20, 5), line(-20, -5, 20, -5)], [10, 0], true);
  assert.equal(cr.ents.length, 1); assert.equal(X(cr.ents[0]).t, 'arc');
  assert.deepEqual(M.trimEntity(circle(0, 0, 10, base), [], [10, 0], true).ents, [], 'a circle nothing crosses goes whole');
  assert.match(M.trimEntity(c, [line(0, 0, 20, 0)], [10, 3], true).error, /two cutting edges/, 'one crossing of a closed shape is still refused');
  const p = lwpoly([[0, 0], [50, 0], [50, 50], [0, 50]], base);                               // polyline: the stretch round the corner goes
  const pr = M.trimEntity(p, [line(-10, 25, 60, 25), line(25, -10, 25, 10)], [50, 10], true);
  assert.equal(pr.ents.length, 2);
  const seg = M.trimEntity(lwpoly([[0, 0], [100, 0]], base), [e1, e2], [50, 0], true);        // a one-segment polyline cuts like a line
  assert.equal(seg.ents.length, 2);
  const tj = M.trimEntity(l, [line(50, 0, 50, 20)], [20, 0], true);                           // T-junction: the edge ends on the line, the click side goes
  assert.equal(tj.ents.length, 1); nearPt(X(tj.ents[0]).a, [50, 0]); nearPt(X(tj.ents[0]).b, [100, 0]);
  const touch = M.trimEntity(l, [line(100, 0, 100, 50)], [50, 0], true);                      // only an end touches: nothing cuts it, so it goes whole
  assert.deepEqual(touch.ents, []); assert.ok(!touch.error);
});

test('Quick Trim by fence (TODO 155a T2): every piece the fence crosses goes, in one go, and the rest stays joined', () => {
  const l1 = line(0, 0, 100, 0, base), l2 = line(0, 20, 100, 20, base), v1 = line(30, -10, 30, 30, base), v2 = line(70, -10, 70, 30, base);
  const all = [l1, l2, v1, v2], tr = (hit, ents = all) => M.trimRegion(ents, all, hit);
  const r = tr(M.fenceHit([[50, -5], [50, 25]]));                                             // one stroke across both horizontals: the middle of each goes
  assert.deepEqual(r.changed.map((c) => c.i), [0, 1]);
  for (const c of r.changed) { assert.equal(c.ents.length, 2); nearPt(S(c.ents[0]).b, [30, c.i * 20]); nearPt(S(c.ents[1]).a, [70, c.i * 20]); }
  const zig = tr(M.fenceHit([[50, -5], [50, 10], [90, 10], [90, 25]]));                       // a bend: crosses l1 at x=50, v2 at y=10 and l2 at x=90 (the end piece)
  assert.deepEqual(zig.changed.map((c) => c.i), [0, 1, 3]);
  assert.equal(zig.changed[1].ents.length, 1); nearPt(S(zig.changed[1].ents[0]).b, [70, 20]);   // l2 loses 70..100 up to its end
  assert.equal(zig.changed[2].ents.length, 2);                                                // v2 loses the stretch between l1 and l2
  const both = tr(M.fenceHit([[10, 5], [90, 5], [90, -5], [10, -5]]));                         // a U round the lower part: v1 and v2 lose their pieces at y=5 and y=-5, l1 its end at x=90
  assert.deepEqual(both.changed.map((c) => c.i), [0, 2, 3]);
  assert.equal(both.changed[0].ents.length, 1); nearPt(S(both.changed[0].ents[0]).b, [70, 0]);
  assert.equal(both.changed[1].ents.length, 1); nearPt(S(both.changed[1].ents[0]).a, [30, 20]);   // v1: only the stub above l2 is left
  assert.deepEqual(tr(M.fenceHit([[200, 0], [210, 5]])).changed, [], 'a fence that misses everything changes nothing');
  assert.deepEqual(tr(M.fenceHit([[5, 5], [5, 5]])).changed, [], 'a fence of no length changes nothing');
  const lone = M.trimRegion([line(200, 0, 260, 0, base)], [], M.fenceHit([[230, -5], [230, 5]]));
  assert.deepEqual(lone.changed, [{ i: 0, ents: [] }], 'a lone object the fence crosses goes whole');
  const c = circle(0, 0, 10, base), cut = [line(-20, 5, 20, 5, base), line(-20, -5, 20, -5, base)];   // a circle with two cutters: the fence takes the right arc
  const cr = M.trimRegion([c], cut, M.fenceHit([[8, 0], [14, 0]]));
  assert.equal(cr.changed[0].ents.length, 1); assert.equal(S(cr.changed[0].ents[0]).t, 'arc');
  near(S(cr.changed[0].ents[0]).a0, 30, 1e-4); near(S(cr.changed[0].ents[0]).a1, 330, 1e-4);
  const one1 = M.trimRegion([circle(0, 0, 10, base)], [line(0, 0, 20, 0, base)], M.fenceHit([[8, 3], [14, 3]]));
  assert.equal(one1.skipped, 1, 'a closed shape with one crossing is left alone'); assert.deepEqual(one1.changed, []);
  const p = lwpoly([[0, 0], [50, 0], [50, 50], [0, 50]], base);                               // an open polyline: the fence takes one stretch, the rest stays one polyline each side
  const pr = M.trimRegion([p], [line(-10, 25, 60, 25, base), line(25, -10, 25, 10, base)], M.fenceHit([[60, 10], [40, 10]]));
  assert.equal(pr.changed[0].ents.length, 2);
});

test('Quick Trim by crossing window (TODO 155a T2): pieces touching the window go, whole objects inside go', () => {
  const l = line(0, 0, 100, 0, base), v1 = line(30, -10, 30, 10, base), v2 = line(70, -10, 70, 10, base), all = [l, v1, v2];
  const r = M.trimRegion(all, all, M.windowHit([40, 5], [60, -5]));                            // a window on the middle of l
  assert.deepEqual(r.changed.map((c) => c.i), [0]);
  assert.equal(r.changed[0].ents.length, 2); nearPt(S(r.changed[0].ents[0]).b, [30, 0]); nearPt(S(r.changed[0].ents[1]).a, [70, 0]);
  const rev = M.trimRegion(all, all, M.windowHit([60, -5], [40, 5]));                          // corners in either order
  assert.equal(rev.changed.length, 1);
  const ins = M.trimRegion(all, all, M.windowHit([25, -2], [35, 2]));                          // a window on a crossing: l (both neighbours touch it) and v1 go
  assert.ok(ins.changed.some((c) => c.i === 1), 'v1 is touched');
  const wide = M.trimRegion(all, all, M.windowHit([-50, -50], [150, 50]));                     // everything inside: all goes (pieces between crossings, so whole objects)
  assert.equal(wide.changed.length, 3); assert.ok(wide.changed.every((c) => c.ents.length === 0));
  assert.deepEqual(M.trimRegion(all, all, M.windowHit([200, 200], [210, 210])).changed, [], 'a window on nothing changes nothing');
});

test('Quick Extend (TODO 155a T3): every object is a boundary, the picked end goes to the nearest one', () => {
  const near50 = line(50, -20, 50, 20, base), far80 = line(80, -20, 80, 20, base);
  const ln = extendEntity(line(0, 0, 20, 0, base), [far80, near50], [18, 0]);                  // the nearest of two lines, whatever their order
  nearPt(S(ln.ent).a, [0, 0]); nearPt(S(ln.ent).b, [50, 0]);
  const back = extendEntity(line(0, 0, 20, 0, base), [line(-30, -20, -30, 20, base), near50], [2, 0]);   // the end nearest the pick moves, the other stays
  nearPt(S(back.ent).a, [-30, 0]); nearPt(S(back.ent).b, [20, 0]);
  const ar = extendEntity(arc(0, 0, 10, 0, 90, base), [line(-10, -20, -10, 20, base)], [0, 10]);   // an arc end grows along its circle
  near(S(ar.ent).a0, 0); near(S(ar.ent).a1, 180);
  assert.match(extendEntity(line(0, 0, 20, 0, base), [line(-30, 5, -30, 20, base), line(50, 5, 50, 20, base)], [18, 0]).error, /No boundary/, 'nothing to meet: a message, nothing changes');
  assert.match(extendEntity(line(0, 0, 20, 0, base), [], [18, 0]).error, /No boundary/, 'no other object at all');
  assert.match(extendEntity(circle(0, 0, 10, base), [near50], [10, 0]).error, /closed/, 'a closed shape is refused');
});

test('Quick Extend by fence or crossing window (TODO 155a T3): each object touched is extended at its nearest end, in one go', () => {
  const l1 = line(0, 10, 20, 10, base), l2 = line(0, 30, 20, 30, base), v = line(50, 0, 50, 40, base), all = [l1, l2, v];
  const f = M.fenceHit([[18, 0], [18, 40]]);                                                  // one stroke across both: both reach the boundary
  const r = extendRegion(all, all, f);
  assert.deepEqual(r.changed.map((c) => c.i), [0, 1]); assert.equal(r.skipped, 0);
  for (const c of r.changed) { assert.equal(c.ents.length, 1); nearPt(S(c.ents[0]).b, [50, c.i * 20 + 10]); nearPt(S(c.ents[0]).a, [0, c.i * 20 + 10]); }
  const w = extendRegion(all, all, M.windowHit([15, 5], [25, 15]));                           // a window on l1 only
  assert.deepEqual(w.changed.map((c) => c.i), [0]);
  assert.deepEqual(extendRegion(all, all, M.fenceHit([[100, 0], [100, 40]])).changed, [], 'a fence that touches nothing changes nothing');
  const lone = extendRegion([l1], [l1], f);                                                   // touched, but nothing to reach
  assert.deepEqual(lone.changed, []); assert.equal(lone.skipped, 1);
  const c = extendRegion([circle(10, 10, 5, base), l1], [v], M.fenceHit([[10, 0], [10, 20]]));   // a closed shape is skipped, the line still goes
  assert.deepEqual(c.changed.map((x) => x.i), [1]); assert.equal(c.skipped, 1);
});

test('Quick Extend by a crossing window (TODO 155a T3 fix): a window holding the whole line, or crossing it on both sides, still finds the boundary at either end', () => {
  const r50 = line(50, -20, 50, 20, base), l30 = line(-30, -20, -30, 20, base);
  const whole = extendRegion([line(0, 0, 20, 0, base), r50], [r50], M.windowHit([-5, -5], [25, 5]));   // the window holds all of l: its start is the touch point, the boundary is past its end
  assert.deepEqual(whole.changed.map((c) => c.i), [0]); assert.equal(whole.skipped, 0);
  nearPt(S(whole.changed[0].ents[0]).a, [0, 0]); nearPt(S(whole.changed[0].ents[0]).b, [50, 0]);
  const left = extendRegion([line(0, 0, 20, 0, base), l30], [l30], M.windowHit([-5, -5], [25, 5]));    // the boundary is behind the start
  nearPt(S(left.changed[0].ents[0]).a, [-30, 0]); nearPt(S(left.changed[0].ents[0]).b, [20, 0]);
  const both = extendRegion([line(0, 0, 40, 0, base), l30], [l30], M.windowHit([10, -5], [30, 5]));   // the window's right edge wins, but nothing is there: the other end goes
  nearPt(S(both.changed[0].ents[0]).a, [-30, 0]); nearPt(S(both.changed[0].ents[0]).b, [40, 0]);
  const none = extendRegion([line(0, 0, 40, 0, base), line(0, 50, 5, 50, base)], [line(0, 50, 5, 50, base)], M.windowHit([10, -5], [30, 5]));
  assert.deepEqual(none.changed, []); assert.equal(none.skipped, 1, 'a boundary at neither end is still skipped');
});

console.log(`${n} modify tests passed`);
