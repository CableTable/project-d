// shape.js — TODO 139a Shape tool nodes.   node --test shape.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SH from './web/shape.js';
import * as GR from './web/grips.js';
import * as MO from './web/modify.js';
import { line, circle, arc, lwpoly, ellipse, entity } from './web/dxf-write.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const nodes = (ent, ...ids) => SH.nodesOf(ent).filter((n) => ids.includes(n.id));
const pts = (ent) => SH.nodesOf(ent).map((n) => [+n.x.toFixed(6) + 0, +n.y.toFixed(6) + 0]);       // + 0: -0 becomes 0

test('nodes: polyline vertices, line and arc ends, circle quadrants; none on other kinds', () => {
  assert.deepEqual(SH.nodesOf(lwpoly([[0, 0], [10, 0], [10, 5]])).map((n) => n.id), ['v0', 'v1', 'v2']);
  assert.deepEqual(SH.nodesOf(line(0, 0, 10, 0)).map((n) => n.id), ['a', 'b']);
  assert.deepEqual(SH.nodesOf(arc(0, 0, 10, 0, 90)).map((n) => n.id), ['a', 'b']);
  assert.deepEqual(SH.nodesOf(circle(0, 0, 5)).map((n) => n.id), ['q0', 'q1', 'q2', 'q3']);
  assert.deepEqual(SH.nodesOf(ellipse(0, 0, 10, 0, 0.5)), []);
  assert.deepEqual(SH.nodesOf(null), []);
});

test('nodesIn: the nodes inside a box (corners either way)', () => {
  const list = SH.nodesOf(lwpoly([[0, 0], [10, 0], [10, 5]]));
  assert.deepEqual(SH.nodesIn(list, [11, 6], [9, -1]).map((n) => n.id), ['v1', 'v2']);
});

test('dragNodes: polyline — the picked vertices move by one offset, the rest stay', () => {
  const p = lwpoly([[0, 0], [10, 0], [10, 5], [0, 5]], { closed: true });
  const r = SH.dragNodes(p, nodes(p, 'v1', 'v2'), 3, 1);
  assert.deepEqual(pts(r.ent), [[0, 0], [13, 1], [13, 6], [0, 5]]);
  assert.deepEqual(pts(SH.dragNodes(p, SH.nodesOf(p), 2, 2).ent), [[2, 2], [12, 2], [12, 7], [2, 7]], 'every vertex: moved whole');
});

test('dragNodes: line — one end stretches, both ends move it', () => {
  const l = line(0, 0, 10, 0);
  assert.deepEqual(pts(SH.dragNodes(l, nodes(l, 'b'), 0, 4).ent), [[0, 0], [10, 4]]);
  assert.deepEqual(pts(SH.dragNodes(l, nodes(l, 'a', 'b'), 1, 2).ent), [[1, 2], [11, 2]]);
});

test('dragNodes: arc — one end re-fits through its middle, both ends move it whole', () => {
  const a = arc(0, 0, 10, 0, 90);
  const one = SH.dragNodes(a, nodes(a, 'a'), 0, -2).ent;
  assert.deepEqual(pts(one)[0], [10, -2]);
  assert.deepEqual(pts(one)[1], [0, 10], 'the other end stays');
  const both = SH.dragNodes(a, nodes(a, 'a', 'b'), 5, 5).ent;
  assert.deepEqual(pts(both), [[15, 5], [5, 15]]);
  near(GR.get(both.r, 40), 10);
});

test('dragNodes: circle — one quadrant sets the radius, two or more move the circle (grill R3)', () => {
  const c = circle(0, 0, 5);
  const one = SH.dragNodes(c, nodes(c, 'q0'), 3, 0).ent;
  near(GR.get(one.r, 40), 8); near(GR.get(one.r, 10), 0);
  const two = SH.dragNodes(c, nodes(c, 'q0', 'q2'), 3, 4).ent;
  near(GR.get(two.r, 40), 5); near(GR.get(two.r, 10), 3); near(GR.get(two.r, 20), 4);
});

// TODO 139b1 add a node: the outline is the same both ways (every sampled point of one lies on the other)
const samples = (ent) => MO.pathOf(GR.shapeOf(ent)).segs.flatMap((s) => [0, 0.25, 0.5, 0.75].map((f) => MO.pointAt(MO.geo(s), f)));
function sameOutline(a, b) {
  for (const [x, y] of [[a, b], [b, a]]) for (const p of samples(x)) near(MO.closest(MO.pathOf(GR.shapeOf(y)), p).d, 0);
}
const props = { layer: 'CUT', aci: 3, lt: 'DASHED', lw: 35 };

test('addNode: a line becomes a 2-segment open polyline, the node at the click, props kept', () => {
  const l = line(0, 0, 10, 0, props), r = SH.addNode(l, [4, 0.5]);
  assert.equal(r.ent.type, 'LWPOLYLINE'); assert.equal(r.label, 'Add node');
  assert.deepEqual(pts(r.ent), [[0, 0], [4, 0], [10, 0]]);
  assert.equal(GR.shapeOf(r.ent).closed, false);
  for (const k of Object.keys(props)) assert.equal(r.ent[k], props[k], k);
  sameOutline(l, r.ent);
});

test('addNode: a circle becomes a closed polyline of arcs (its quadrants and the click are nodes), outline unchanged', () => {
  const c = circle(2, 1, 5, props), r = SH.addNode(c, [2 + 5 * Math.cos(0.5), 1 + 5 * Math.sin(0.5)]);
  assert.equal(r.ent.type, 'LWPOLYLINE'); assert.equal(GR.shapeOf(r.ent).closed, true);
  assert.equal(SH.nodesOf(r.ent).length, 5);
  assert.ok(GR.lwVertices(r.ent.r).every((v) => v.b > 0), 'every segment an arc');
  assert.equal(r.ent.layer, 'CUT');
  sameOutline(c, r.ent);
});

test('addNode: an arc becomes an open polyline of two arcs, outline unchanged', () => {
  const a = arc(0, 0, 10, 0, 90, props), r = SH.addNode(a, [Math.SQRT1_2 * 11, Math.SQRT1_2 * 11]);
  assert.deepEqual(pts(r.ent), [[10, 0], [7.071068, 7.071068], [0, 10]]);
  assert.equal(GR.shapeOf(r.ent).closed, false);
  sameOutline(a, r.ent);
});

test('addNode: a polyline — a straight segment stays straight, a bulged one splits into two arcs of its circle', () => {
  const p = lwpoly([[0, 0], [10, 0, 1], [10, 10], [0, 10]], { closed: true, ...props });
  const straight = SH.addNode(p, [5, -1]).ent;
  assert.deepEqual(pts(straight), [[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]]);
  assert.deepEqual(GR.lwVertices(straight.r).map((v) => v.b), [0, 0, 1, 0, 0]);
  sameOutline(p, straight);
  const bulged = SH.addNode(p, [15, 5]).ent;       // the half circle from (10, 0) to (10, 10) through (15, 5)
  assert.deepEqual(pts(bulged)[2], [15, 5]);
  GR.lwVertices(bulged.r).slice(1, 3).forEach((v) => near(v.b, Math.tan(Math.PI / 8)));
  assert.equal(bulged.layer, 'CUT');
  sameOutline(p, bulged);
});

test('addNode: refused on a node, beyond tol, and on kinds with no nodes', () => {
  assert.equal(SH.addNode(line(0, 0, 10, 0), [0, 0]), null);
  assert.equal(SH.addNode(line(0, 0, 10, 0), [5, 3], 1), null);
  assert.ok(SH.addNode(line(0, 0, 10, 0), [5, 0.5], 1));
  assert.equal(SH.addNode(ellipse(0, 0, 10, 0, 0.5), [10, 0]), null);
});

// TODO 139b2 delete nodes
const bulges = (ent) => GR.lwVertices(ent.r).map((v) => +v.b.toFixed(6) + 0);

test('deleteNodes: the merged segment is straight (two lines, a line and an arc, arcs of two circles, arcs turning opposite ways)', () => {
  const sq = lwpoly([[0, 0], [10, 0], [10, 5], [0, 5]], { ...props });
  const r = SH.deleteNodes(sq, ['v1']);
  assert.equal(r.label, 'Delete node'); assert.equal(r.ent.layer, 'CUT');
  assert.deepEqual(pts(r.ent), [[0, 0], [10, 5], [0, 5]]);
  assert.deepEqual(bulges(SH.deleteNodes(lwpoly([[0, 0], [10, 0, 0.5], [20, 0], [30, 5]]), ['v1']).ent), [0, 0, 0], 'a line and an arc');
  assert.deepEqual(bulges(SH.deleteNodes(lwpoly([[0, 0, 0.5], [10, 0, 0.3], [20, 0], [30, 5]]), ['v1']).ent), [0, 0, 0], 'two circles');
  assert.deepEqual(bulges(SH.deleteNodes(lwpoly([[0, 0, 0.5], [10, 0, -0.5], [20, 0], [30, 5]]), ['v1']).ent), [0, 0, 0], 'opposite turns');
  assert.deepEqual(pts(SH.deleteNodes(lwpoly([[0, 0], [10, 0], [20, 5]]), ['v0']).ent), [[10, 0], [20, 5]], 'an end node goes');
});

test('deleteNodes: both neighbours arcs of one circle — one arc of that circle, outline unchanged', () => {
  const p = lwpoly([[0, 0], [10, 0, 1], [10, 10], [0, 10]], { closed: true });
  const split = SH.addNode(p, [15, 5]).ent, back = SH.deleteNodes(split, ['v2']).ent;       // a node added on the half circle, then deleted
  assert.deepEqual(bulges(back), [0, 1, 0, 0]);
  sameOutline(p, back);
  const a = SH.addNode(arc(0, 0, 10, 0, 270), [10 * Math.cos(2.4), 10 * Math.sin(2.4)]).ent, one = SH.deleteNodes(a, ['v1']).ent;
  assert.equal(GR.lwVertices(one.r).length, 2);
  near(bulges(one)[0], Math.tan(Math.PI * 3 / 8), 1e-5);       // over half a turn: 270 degrees
  sameOutline(arc(0, 0, 10, 0, 270), one);
  const c = SH.addNode(circle(0, 0, 5), [5 * Math.cos(0.5), 5 * Math.sin(0.5)]).ent, two = SH.deleteNodes(c, ['v1', 'v2']).ent;       // v0 (0 deg), v3, v4 stay
  near(bulges(two)[0], 1, 1e-5); sameOutline(circle(0, 0, 5), two);
  const first = SH.deleteNodes(c, ['v0']).ent;       // a closed polyline's first node: the arc joins its last
  assert.equal(GR.lwVertices(first.r).length, 4); near(bulges(first)[3], Math.tan((Math.PI / 2 + 0.5) / 4), 1e-5);
  sameOutline(circle(0, 0, 5), SH.deleteNodes(c, ['v1']).ent);
});

test('deleteNodes: never below 2 nodes open / 3 closed (all stay); lines, arcs, circles and other kinds keep theirs', () => {
  assert.equal(SH.deleteNodes(lwpoly([[0, 0], [10, 0]]), ['v0']), null);
  assert.equal(SH.deleteNodes(lwpoly([[0, 0], [10, 0], [10, 5]]), ['v0', 'v1']), null, 'a set that would go too low: none go');
  assert.equal(SH.deleteNodes(lwpoly([[0, 0], [10, 0], [10, 5]], { closed: true }), ['v1']), null);
  assert.ok(SH.deleteNodes(lwpoly([[0, 0], [10, 0], [10, 5], [0, 5]], { closed: true }), ['v1']));
  for (const e of [line(0, 0, 10, 0), arc(0, 0, 10, 0, 90), circle(0, 0, 5), ellipse(0, 0, 10, 0, 0.5)]) assert.equal(SH.deleteNodes(e, ['a']), null);
  assert.equal(SH.deleteNodes(lwpoly([[0, 0], [10, 0], [10, 5]]), []), null);
});

// TODO 139c Break at node / Join nodes
const closedP = lwpoly([[0, 0], [10, 0, 1], [10, 10], [0, 10]], { closed: true, ...props });       // the right side is a half circle
const union = (pieces) => pieces.flatMap((e) => samples(e));       // sample points of every piece: all lie on the source outline

test('breakNodes: a closed polyline opens at the node — one open polyline starting there, arcs keep their bulge, props kept', () => {
  const [r, ...more] = SH.breakNodes(closedP, ['v1']);
  assert.equal(more.length, 0);
  assert.equal(GR.shapeOf(r).closed, false);
  assert.deepEqual(pts(r), [[10, 0], [10, 10], [0, 10], [0, 0], [10, 0]]);
  assert.deepEqual(bulges(r), [1, 0, 0, 0, 0]);
  for (const k of Object.keys(props)) assert.equal(r[k], props[k], k);
  for (const p of union([r])) near(MO.closest(MO.pathOf(GR.shapeOf(closedP)), p).d, 0);
  assert.deepEqual(SH.breakNodes(closedP, ['v1', 'v3']).map(pts), [[[10, 0], [10, 10], [0, 10]], [[0, 10], [0, 0], [10, 0]]], 'two nodes: two pieces');
});

test('breakNodes: an open polyline splits at its inner nodes; its end nodes cut nothing', () => {
  const p = lwpoly([[0, 0], [10, 0, 0.5], [20, 0], [30, 5]], props), r = SH.breakNodes(p, ['v1']);
  assert.deepEqual(r.map(pts), [[[0, 0], [10, 0]], [[10, 0], [20, 0], [30, 5]]]);
  assert.deepEqual(r.map(bulges), [[0, 0], [0.5, 0, 0]]);
  assert.ok(r.every((e) => e.layer === 'CUT' && !GR.shapeOf(e).closed));
  assert.equal(SH.breakNodes(p, ['v0', 'v3']), null);
  assert.equal(SH.breakNodes(p, ['v0', 'v2']).length, 2);
  assert.equal(SH.breakNodes(p, ['v1', 'v2']).length, 3);
});

test('breakNodes: on an arc (made two by a node) the outline stays and each half keeps its bulge', () => {
  const a = arc(0, 0, 10, 0, 90, props), two = SH.addNode(a, [Math.SQRT1_2 * 11, Math.SQRT1_2 * 11]).ent, r = SH.breakNodes(two, ['v1']);
  assert.equal(r.length, 2);
  r.forEach((e) => near(bulges(e)[0], Math.tan(Math.PI / 16), 1e-5));
  for (const p of union(r)) near(MO.closest(MO.pathOf(GR.shapeOf(a)), p).d, 0, 3e-6);       // Break's pieces are written to 6 decimals (modify.js rebuilt)
});

test('breakNodes: a circle opens at its quadrant node into one open outline of four arcs; a line, an arc and an ellipse have no inner node', () => {
  const [r] = SH.breakNodes(circle(0, 0, 5, props), ['q1']);
  assert.deepEqual(pts(r), [[0, 5], [-5, 0], [0, -5], [5, 0], [0, 5]]);
  assert.equal(r.layer, 'CUT');
  for (const e of [line(0, 0, 10, 0), arc(0, 0, 10, 0, 90), ellipse(0, 0, 10, 0, 0.5), null]) assert.equal(SH.breakNodes(e, ['a', 'b']), null);
  assert.equal(SH.breakNodes(lwpoly([[0, 0], [10, 0], [10, 5]], { closed: true }), []), null);
});

const ends = (ent, id) => ({ ent, id });

test('joinNodes: the two end nodes of one open object close it (the Close tool: extend or straight)', () => {
  const p = lwpoly([[0, 0], [10, 0], [10, 10]], props), r = SH.joinNodes(ends(p, 'v0'), ends(p, 'v2'));
  assert.equal(r.label, 'Close'); assert.equal(GR.shapeOf(r.result).closed, true); assert.equal(r.result.layer, 'CUT');
  const l = line(0, 0, 10, 0);
  assert.ok(SH.joinNodes(ends(l, 'a'), ends(l, 'b')).why, 'a single line cannot be closed');
});

test('joinNodes: two objects — both ends move to their midpoint, then the joined result as it comes', () => {
  const a = lwpoly([[0, 0], [10, 0]], props), b = lwpoly([[10.4, 0.2], [20, 5]], { layer: 'OTHER' }), r = SH.joinNodes(ends(a, 'v1'), ends(b, 'v0'));
  assert.equal(r.label, 'Join nodes'); assert.equal(r.result.type, 'LWPOLYLINE'); assert.equal(r.result.layer, 'CUT', 'the first object is the source');
  assert.deepEqual(pts(r.result), [[0, 0], [10.2, 0.1], [20, 5]]);
  const l = SH.joinNodes(ends(line(0, 0, 10, 0), 'b'), ends(line(10.4, 0, 20, 0), 'a'));
  assert.equal(l.result.type, 'LINE', 'collinear lines merge into one line'); assert.deepEqual([GR.get(l.result.r, 10), GR.get(l.result.r, 11)], [0, 20]);
  const same = SH.joinNodes(ends(arc(0, 0, 100, 0, 40), 'b'), ends(arc(0, 0, 100, 40, 90), 'a'));
  assert.equal(same.result?.type, 'ARC', 'arcs of one circle that touch merge into one arc');
  const gap = SH.joinNodes(ends(arc(0, 0, 100, 0, 40), 'b'), ends(arc(0, 0, 100, 40.2, 90), 'a'));
  assert.equal(gap.result?.type, 'LWPOLYLINE', gap.why);       // the re-fitted ends are on two circles now: a polyline of two arcs
  assert.equal(GR.lwVertices(gap.result.r).length, 3);
});

test('joinNodes: refused with its why — an inner node, a closed object, a circle', () => {
  const p = lwpoly([[0, 0], [10, 0], [10, 10]]);
  for (const [x, y] of [[ends(p, 'v1'), ends(line(0, 0, 1, 1), 'a')], [ends(lwpoly([[0, 0], [10, 0], [10, 5]], { closed: true }), 'v0'), ends(p, 'v0')], [ends(circle(0, 0, 5), 'q0'), ends(p, 'v0')]]) assert.match(SH.joinNodes(x, y).why, /end nodes/);
});

// ---- TODO 139e1: Bezier splines
const cubicAt = (b, k, t) => [0, 1].map((i) => { const [p0, p1, p2, p3] = b.P.slice(3 * k, 3 * k + 4).map((p) => p[i]), u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3; });
const spl = (c, v) => entity('SPLINE', [[70, 8], ...c.map((k, i) => [k, v[i]])]);

test('toCurve: a circle becomes a closed Bezier spline of 4 cubics on the same circle, layer kept', () => {
  const r = SH.toCurve(circle(5, 7, 10, { layer: 'CUT', aci: 3 }), ['q1']);
  assert.equal(r.ent.type, 'SPLINE'); assert.equal(r.ent.layer, 'CUT'); assert.equal(r.ent.aci, 3);
  const b = SH.bezierOf(r.ent);
  assert.ok(b.closed && b.n === 4, JSON.stringify(b?.n));
  assert.deepEqual(SH.nodesOf(r.ent).map((n) => [Math.round(n.x), Math.round(n.y)]), [[15, 7], [5, 17], [-5, 7], [5, -3]], 'the quadrants stay the nodes');
  for (let k = 0; k < 4; k++) for (const t of [0.25, 0.5, 0.8]) { const [x, y] = cubicAt(b, k, t); near(Math.hypot(x - 5, y - 7), 10, 3e-3); }
  assert.deepEqual(r.ids, ['n1'], 'the clicked quadrant is node 1 still');
});

test('toCurve: a polyline keeps its outline — lines are straight cubics (handles at 1/3, 2/3), an arc its closest cubic; closed stays closed', () => {
  const p = lwpoly([[0, 0], [10, 0, Math.tan(Math.PI / 8)], [10, 10]], { closed: true });
  const r = SH.toCurve(p, ['v0']), b = SH.bezierOf(r.ent);
  assert.ok(b.closed && b.n === 3);
  assert.deepEqual(b.P.slice(0, 4).map((q) => [+q[0].toFixed(6), +q[1].toFixed(6)]), [[0, 0], [3.333333, 0], [6.666667, 0], [10, 0]]);
  const mid = cubicAt(b, 1, 0.5), g = MO.geo(MO.pathOf(GR.shapeOf(p)).segs[1]);       // the arc from (10,0) to (10,10): bulge tan(22.5°) = a quarter turn
  near(Math.hypot(mid[0] - g.c[0], mid[1] - g.c[1]), g.r, 1e-3);
});

test('toCurve: a long arc is split in cubics of at most a quarter turn; a line gives one segment; the last node of an open object has no segment after', () => {
  const a = SH.toCurve(arc(0, 0, 10, 0, 270), ['a']);
  assert.equal(SH.bezierOf(a.ent).n, 3);
  const l = line(0, 0, 10, 0);
  assert.equal(SH.bezierOf(SH.toCurve(l, ['a']).ent).n, 1);
  assert.match(SH.toCurve(l, ['b']).why, /segment after/);
  assert.match(SH.toCurve(lwpoly([[0, 0], [5, 5], [9, 1]]), ['v2']).why, /segment after/);
  assert.ok(SH.toCurve(lwpoly([[0, 0], [5, 5], [9, 1]]), ['v2', 'v1']).ent, 'one node with a segment after is enough');
  assert.match(SH.toCurve(lwpoly([[0, 0], [5, 5]], { width: 2 }), ['v0']).why, /width/);
});

test('Bezier nodes: the segment ends; handles only on the nodes asked for; other splines have no nodes (Not a Bezier curve)', () => {
  const s = SH.toCurve(lwpoly([[0, 0], [10, 0], [10, 10]]), ['v0']).ent;
  assert.deepEqual(SH.nodesOf(s).map((n) => n.id), ['n0', 'n1', 'n2']);
  assert.deepEqual(SH.handlesOf(s, ['n1']).map((h) => h.id), ['o1', 'i1']);
  assert.deepEqual(SH.handlesOf(s, ['n0']).map((h) => h.id), ['o0'], 'an open curve start has one handle');
  assert.deepEqual(SH.handlesOf(s, ['n2']).map((h) => h.id), ['i2']);
  assert.deepEqual(SH.handlesOf(s, []), []);
  assert.deepEqual(SH.nodesIn([...SH.nodesOf(s), ...SH.handlesOf(s, ['n1'])], [-1, -1], [11, 11]).map((n) => n.id), ['n0', 'n1', 'n2'], 'a box picks nodes, not handles');
  const quad = spl([71, 72, 73, 74, 40, 40, 40, 40, 40, 40, 10, 20, 10, 20, 10, 20], [2, 6, 3, 0, 0, 0, 0, 1, 1, 1, 0, 0, 5, 5, 10, 0]);
  assert.deepEqual(SH.nodesOf(quad), []);
  assert.equal(SH.toCurve(quad, ['n0']).why, 'Not a Bezier curve'); assert.equal(SH.toLine(quad, ['n0']).why, 'Not a Bezier curve');
});

test('dragNodes on a Bezier spline: a node takes its handles, a handle moves alone, every node moves it whole; a closed curve wraps', () => {
  const s = SH.toCurve(lwpoly([[0, 0], [30, 0], [30, 30]]), ['v0']).ent, P = (e) => SH.bezierOf(e).P.map((q) => q.slice(0, 2).map((v) => +v.toFixed(6) + 0));
  const was = P(s), pick = (ent, ...ids) => [...SH.nodesOf(ent), ...SH.handlesOf(ent, ['n0', 'n1', 'n2'])].filter((g) => ids.includes(g.id));
  const n1 = SH.dragNodes(s, pick(s, 'n1'), 1, 2);
  assert.equal(n1.label, 'Move node');
  assert.deepEqual(P(n1.ent).map((q, k) => [q[0] - was[k][0], q[1] - was[k][1]]), [[0, 0], [0, 0], [1, 2], [1, 2], [1, 2], [0, 0], [0, 0]], 'node 1 and both its handles');
  const h = SH.dragNodes(s, pick(s, 'o1'), 4, -3);
  assert.equal(h.label, 'Move handle');
  assert.deepEqual(P(h.ent).map((q, k) => [q[0] - was[k][0], q[1] - was[k][1]]), [[0, 0], [0, 0], [0, 0], [0, 0], [4, -3], [0, 0], [0, 0]]);
  assert.deepEqual(P(SH.dragNodes(s, SH.nodesOf(s), 2, 1).ent), was.map((q) => [q[0] + 2, q[1] + 1]), 'all nodes: whole');
  assert.equal(SH.dragNodes(s, pick(s, 'n1'), 0, 0).ent, s, 'no move, same object');
  const c = SH.toCurve(circle(0, 0, 10), ['q0']).ent, cp = (e) => SH.bezierOf(e).P, c0 = cp(c);
  const m = cp(SH.dragNodes(c, [...SH.nodesOf(c), ...SH.handlesOf(c, ['n0'])].filter((g) => g.id === 'n0'), 1, 1).ent);
  const r6 = (q) => q.slice(0, 2).map((v) => +v.toFixed(6) + 0);
  assert.deepEqual([m[0], m[12], m[1], m[11]].map(r6), [0, 12, 1, 11].map((k) => r6([c0[k][0] + 1, c0[k][1] + 1])), 'closed: the first point is the last, both its handles move');
  assert.ok(SH.bezierOf(SH.dragNodes(c, SH.handlesOf(c, ['n0']).filter((g) => g.id === 'i0'), 1, 0).ent).closed, 'still closed');
});

test('toLine: the segment after the node gets its handles on the chord; a straight one and a last node say why', () => {
  const s = SH.toCurve(lwpoly([[0, 0], [30, 0], [30, 30]]), ['v0']).ent;
  assert.match(SH.toLine(s, ['n0']).why, /straight already/, 'a fresh line segment is straight');
  const bent = SH.dragNodes(s, SH.handlesOf(s, ['n1']).filter((g) => g.id === 'o1'), 5, 8).ent;
  assert.match(SH.toLine(bent, ['n2']).why, /segment after/);
  assert.match(SH.toLine(bent, ['n0']).why, /straight already/, 'another segment');
  const r = SH.toLine(bent, ['n1']);
  assert.equal(r.ent.type, 'SPLINE'); assert.equal(r.label, 'To line');
  assert.deepEqual(SH.bezierOf(r.ent).P.map((q) => q.slice(0, 2).map((v) => +v.toFixed(6) + 0)), SH.bezierOf(s).P.map((q) => q.slice(0, 2).map((v) => +v.toFixed(6) + 0)), 'back on the chord, at 1/3 and 2/3');
  assert.match(SH.toLine(r.ent, ['n1']).why, /straight already/);
  assert.match(SH.toCurve(s, ['n0']).why, /Bezier curve already/);
});

// ---- TODO 139e2a: node types
const poly = () => SH.toCurve(lwpoly([[0, 0], [30, 0], [30, 30]]), ['v0']).ent;       // node n1 at (30, 0): out handle (30, 10), in handle (20, 0)
const hp = (e, id) => { const h = SH.handlesOf(e, ['n' + id.slice(1)]).find((g) => g.id === id); return [h.x, h.y]; };
const pull = (e, id, dx, dy) => SH.dragNodes(e, SH.handlesOf(e, ['n' + id.slice(1)]).filter((g) => g.id === id), dx, dy);
const vec = (e, id) => { const n = SH.nodesOf(e).find((k) => k.id === 'n' + id.slice(1)), h = hp(e, id); return [h[0] - n.x, h[1] - n.y]; };
const collinear = (e, i) => { const [a, b] = [vec(e, 'o' + i), vec(e, 'i' + i)]; near(a[0] * b[1] - a[1] * b[0], 0, 1e-6 * Math.hypot(...a) * Math.hypot(...b)); assert.ok(a[0] * b[0] + a[1] * b[1] < 0, 'opposite ways'); };

test('nodeType: read back from the handles (collinear + equal = Symmetrical, collinear = Smooth, else Cusp); ends and other curves have none', () => {
  const s = poly(), bent = pull(s, 'o1', 5, 8).ent;
  assert.equal(SH.nodeType(s, 'n1'), 'Cusp', 'a corner');
  assert.equal(SH.nodeType(s, 'n0'), null, 'an open curve end'); assert.equal(SH.nodeType(s, 'n9'), null); assert.equal(SH.nodeType(circle(0, 0, 1), 'q0'), null);
  const c = SH.toCurve(circle(0, 0, 10), ['q0']).ent, { cusps, ...bare } = c;
  assert.deepEqual(cusps, ['n0', 'n1', 'n2', 'n3'], 'To curve: every new node is a Cusp, though a circle quadrant reads Symmetrical');
  assert.equal(SH.nodeType(c, 'n2'), 'Cusp'); assert.equal(SH.nodeType(bare, 'n2'), 'Symmetrical', 'what a reload gives');
  assert.equal(SH.nodeType(SH.setNodeType(bent, ['n1'], 'Smooth').ent, 'n1'), 'Smooth');
  const quad = spl([71, 72, 73, 74, 40, 40, 40, 40, 40, 40, 10, 20, 10, 20, 10, 20], [2, 6, 3, 0, 0, 0, 0, 1, 1, 1, 0, 0, 5, 5, 10, 0]);
  assert.equal(SH.nodeType(quad, 'n0'), null);
});

test('setNodeType: Smooth keeps lengths and the straight side, Symmetrical equal lengths, Cusp frees; one result per call', () => {
  const bent = pull(poly(), 'o1', 5, 8).ent, was = hp(bent, 'i1');
  const sm = SH.setNodeType(bent, ['n1'], 'Smooth');
  assert.equal(sm.label, 'Smooth node'); assert.equal(SH.nodeType(sm.ent, 'n1'), 'Smooth'); collinear(sm.ent, 1);
  assert.deepEqual(hp(sm.ent, 'i1'), was, 'the straight side keeps its handle');
  near(Math.hypot(...vec(sm.ent, 'o1')), Math.hypot(5, 18)); near(Math.hypot(...vec(sm.ent, 'i1')), 10);
  const sy = SH.setNodeType(sm.ent, ['n1'], 'Symmetrical');
  assert.equal(SH.nodeType(sy.ent, 'n1'), 'Symmetrical'); collinear(sy.ent, 1); near(Math.hypot(...vec(sy.ent, 'o1')), 10);
  const cu = SH.setNodeType(sy.ent, ['n1'], 'Cusp');
  assert.equal(SH.nodeType(cu.ent, 'n1'), 'Cusp', 'collinear handles, still a Cusp'); assert.deepEqual(SH.bezierOf(cu.ent).P, SH.bezierOf(sy.ent).P, 'Cusp moves nothing');
  assert.match(SH.setNodeType(cu.ent, ['n1'], 'Cusp').why, /Cusp already/); assert.match(SH.setNodeType(sy.ent, ['n1'], 'Symmetrical').why, /Symmetrical already/);
  const both = pull(bent, 'i1', -3, 5).ent, b2 = SH.setNodeType(both, ['n1'], 'Symmetrical').ent;       // both sides curved: they share the bisector
  collinear(b2, 1); near(Math.hypot(...vec(b2, 'o1')), Math.hypot(...vec(b2, 'i1'))); assert.equal(SH.nodeType(b2, 'n1'), 'Symmetrical');
  near(Math.hypot(...vec(b2, 'o1')), (Math.hypot(5, 18) + Math.hypot(...vec(both, 'i1'))) / 2);
  assert.equal(SH.bezierOf(SH.setNodeType(b2, ['n1'], 'Cusp').ent).n, 2, 'still a curve of 2 segments');
});

test('setNodeType: greyed with its why — not Bezier, an end node, a straight node, already, a zero-length handle; several nodes: those that can change', () => {
  const s = poly(), bent = pull(s, 'o1', 5, 8).ent;
  assert.match(SH.setNodeType(s, ['n1'], 'Smooth').why, /No curve on either side/);
  assert.match(SH.setNodeType(s, ['n0'], 'Smooth').why, /end node/);
  assert.equal(SH.setNodeType(lwpoly([[0, 0], [1, 1]]), ['v0'], 'Smooth').why, 'Not a Bezier curve');
  const zero = pull(bent, 'i1', 10, 0).ent;       // the in handle sits on its node
  assert.match(SH.setNodeType(zero, ['n1'], 'Smooth').why, /zero length/);
  assert.equal(SH.nodeType(SH.setNodeType(zero, ['n1'], 'Symmetrical').ent, 'n1'), 'Symmetrical', 'Symmetrical gives it the other length');
  const r = SH.setNodeType(bent, ['n0', 'n1', 'n2'], 'Smooth');
  assert.equal(SH.nodeType(r.ent, 'n1'), 'Smooth'); assert.equal(SH.nodeType(r.ent, 'n0'), null);
});

test('dragNodes on a handle keeps its node type: Smooth turns the other handle (length kept), Symmetrical mirrors it, Cusp leaves it; node + handle together move rigidly', () => {
  const bent = pull(poly(), 'o1', 5, 8).ent, sm = SH.setNodeType(bent, ['n1'], 'Smooth').ent, sy = SH.setNodeType(bent, ['n1'], 'Symmetrical').ent;
  const a = pull(sm, 'o1', 0, 6).ent;
  assert.equal(SH.nodeType(a, 'n1'), 'Smooth'); collinear(a, 1); near(Math.hypot(...vec(a, 'i1')), 10, 1e-9);
  const b = pull(sy, 'i1', 2, 3).ent;
  assert.equal(SH.nodeType(b, 'n1'), 'Symmetrical'); collinear(b, 1); near(Math.hypot(...vec(b, 'o1')), Math.hypot(...vec(b, 'i1')));
  const cu = SH.setNodeType(sy, ['n1'], 'Cusp').ent, c = pull(cu, 'o1', 4, 4).ent;
  assert.deepEqual(hp(c, 'i1'), hp(cu, 'i1')); assert.equal(SH.nodeType(c, 'n1'), 'Cusp', 'a Cusp stays one, and the entity remembers it');
  const together = SH.dragNodes(sm, [...SH.nodesOf(sm).filter((g) => g.id === 'n1'), ...SH.handlesOf(sm, ['n1'])], 3, 3).ent;
  assert.equal(SH.nodeType(together, 'n1'), 'Smooth'); near(Math.hypot(...vec(together, 'o1')), Math.hypot(...vec(sm, 'o1')));
  assert.deepEqual(hp(pull(sm, 'o1', 0, 0).ent, 'i1'), hp(sm, 'i1'), 'no move');
});

test('node types on a closed curve: node 0 wraps (its in handle is the last control point); a handle drag keeps Symmetrical', () => {
  const c = SH.toCurve(circle(0, 0, 10), ['q0']).ent, s = SH.setNodeType(c, ['n0'], 'Symmetrical').ent;
  assert.equal(SH.nodeType(s, 'n0'), 'Symmetrical'); assert.equal(SH.nodeType(s, 'n1'), 'Cusp', 'the others stay');
  const d = pull(s, 'i0', 3, -2).ent;
  collinear(d, 0); near(Math.hypot(...vec(d, 'o0')), Math.hypot(...vec(d, 'i0'))); assert.ok(SH.bezierOf(d).closed);
  assert.equal(SH.setNodeType(c, ['n0'], 'Cusp').why, 'This node is Cusp already');
});
