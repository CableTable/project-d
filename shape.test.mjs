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
