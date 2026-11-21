// shape.js — TODO 139a Shape tool nodes.   node --test shape.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SH from './web/shape.js';
import * as GR from './web/grips.js';
import * as MO from './web/modify.js';
import { line, circle, arc, lwpoly, ellipse } from './web/dxf-write.js';

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
