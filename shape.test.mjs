// shape.js — TODO 139a Shape tool nodes.   node --test shape.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SH from './web/shape.js';
import * as GR from './web/grips.js';
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
