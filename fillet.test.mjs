import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from './web/dxf-write.js';
import { filletLines, filletEntities } from './web/fillet.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const pt = (p, q) => { close(p[0], q[0]); close(p[1], q[1]); };
const value = (e, code) => +e.r.v[e.r.c.indexOf(code)];

test('a right-angle corner: tangent points, centre and a 90° arc', () => {
  const f = filletLines([[0, 0], [10, 0]], [5, 0], [[10, 0], [10, 10]], [10, 5], 2);
  pt(f.l1[0], [0, 0]); pt(f.l1[1], [8, 0]); pt(f.l2[0], [10, 2]); pt(f.l2[1], [10, 10]);
  pt(f.arc.c, [8, 2]); close(f.arc.r, 2); close(f.arc.a0, 270); close(f.arc.a1, 0);
});

test('lines that do not reach the corner are extended; the pick side is kept', () => {
  const f = filletLines([[0, 0], [6, 0]], [1, 0], [[10, 4], [10, 10]], [10, 9], 1);
  pt(f.l1[1], [9, 0]); pt(f.l2[0], [10, 1]);
  const g = filletLines([[-10, 0], [10, 0]], [-5, 0], [[0, -10], [0, 10]], [0, 5], 1);     // crossing lines keep the picked halves
  pt(g.l1[0], [-10, 0]); pt(g.l1[1], [-1, 0]); pt(g.l2[0], [0, 1]); pt(g.l2[1], [0, 10]);
  pt(g.arc.c, [-1, 1]); close(g.arc.a0, 270); close(g.arc.a1, 0);
});

test('a 60° corner: tangent length r / tan(30°), arc sweeps 120°', () => {
  const c = Math.cos(Math.PI / 3), s = Math.sin(Math.PI / 3);
  const f = filletLines([[10, 0], [0, 0]], [5, 0], [[0, 0], [10 * c, 10 * s]], [c, s], 1), t = 1 / Math.tan(Math.PI / 6);
  pt(f.l1[1], [t, 0]); pt(f.l2[0], [t * c, t * s]); pt(f.arc.c, [t, 1]);
  close((f.arc.a1 - f.arc.a0 + 360) % 360, 120);
});

test('radius 0 makes a sharp corner and no arc', () => {
  const f = filletLines([[0, 0], [7, 0]], [1, 0], [[10, 3], [10, 10]], [10, 9], 0);
  pt(f.l1[1], [10, 0]); pt(f.l2[0], [10, 0]); assert.equal(f.arc, null);
});

test('invalid cases: parallel, radius too big, negative radius, zero-length line', () => {
  assert.match(filletLines([[0, 0], [10, 0]], [5, 0], [[0, 5], [10, 5]], [5, 5], 1).error, /parallel/);
  assert.match(filletLines([[0, 0], [10, 0]], [5, 0], [[20, 0], [30, 0]], [25, 0], 1).error, /parallel/);
  assert.match(filletLines([[0, 0], [10, 0]], [5, 0], [[10, 0], [10, 3]], [10, 2], 5).error, /too big/);
  assert.match(filletLines([[0, 0], [10, 0]], [5, 0], [[10, 0], [10, 10]], [10, 5], -1).error, /0 or more/);
  assert.match(filletLines([[0, 0], [0, 0]], [0, 0], [[10, 0], [10, 10]], [10, 5], 1).error, /no length/);
});

test('entities: two LINEs keep their layer and colour; the arc joins on the first line\'s layer', () => {
  const a = W.line(0, 0, 10, 0, { layer: 'Cut', aci: 3 }), b = W.line(10, 0, 10, 10, { layer: 'Mark', aci: 1 });
  const { ents } = filletEntities(a, [5, 0], b, [10, 5], 2);
  assert.deepEqual(ents.map((e) => [e.type, e.layer]), [['LINE', 'Cut'], ['LINE', 'Mark'], ['ARC', 'Cut']]);
  close(value(ents[0], 11), 8); close(value(ents[1], 20), 2); close(value(ents[2], 40), 2);
  assert.equal(filletEntities(a, [5, 0], b, [10, 5], 0).ents.length, 2);
  assert.match(filletEntities(a, [5, 0], a, [6, 0], 1).error, /different/);
  assert.match(filletEntities(a, [5, 0], W.circle(0, 0, 5), [5, 0], 1).error, /two lines/);
});
