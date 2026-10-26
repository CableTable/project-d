import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rayHit, extendEntity } from './web/extend.js';
import { shapeOf } from './web/grips.js';
import { get } from './web/grips.js';
import { line, circle, arc, lwpoly, text, entity } from './web/dxf-write.js';

const close = (p, q) => assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-7, `${p} != ${q}`);
const S = (e) => shapeOf(e, 1);

test('rayHit: the nearest boundary ahead wins; boundaries behind or beside are ignored', () => {
  const edges = [line(20, -5, 20, 5), line(30, -5, 30, 5), line(-5, -5, -5, 5), line(15, 1, 25, 1)].map(S);
  close(rayHit([0, 0], [10, 0], edges), [20, 0]);
  close(rayHit([10, 0], [0, 0], edges), [-5, 0]);
  assert.equal(rayHit([0, 0], [0, 10], edges), null);
});

test('rayHit: circles, arcs and bulged polylines', () => {
  close(rayHit([0, 0], [10, 0], [S(circle(30, 0, 5))]), [25, 0]);
  close(rayHit([30, 0], [31, 0], [S(circle(30, 0, 5))]), [35, 0]);                         // from inside: the far side
  close(rayHit([0, 0], [10, 0], [S(arc(30, 0, 5, 90, 270))]), [25, 0]);
  close(rayHit([0, 0], [10, 0], [S(arc(30, 0, 5, -90, 90))]), [35, 0]);                     // only the far half is there
  close(rayHit([0, 0], [1, 0], [S(lwpoly([[50, -10, 0], [50, 10, 0]]))]), [50, 0]);
  close(rayHit([0, 5], [1, 5], [S(lwpoly([[100, 0, 1], [100, 10, 0]]))]), [105, 5]);         // a half circle bulging out to x = 105
});

test('rayHit: an end already on a boundary goes on to the next one; parallel boundaries never meet', () => {
  const edges = [line(10, -5, 10, 5), line(40, -5, 40, 5)].map(S);
  close(rayHit([0, 0], [10, 0], edges), [40, 0]);
  assert.equal(rayHit([0, 0], [10, 0], [S(line(0, 3, 50, 3))]), null);
});

test('extendEntity: the end nearest the pick moves, the other stays; layer kept', () => {
  const ent = line(0, 0, 10, 0, { layer: 'Cut' }), edges = [line(20, -5, 20, 5), line(-8, -5, -8, 5)];
  let r = extendEntity(ent, edges, [8, 0]);
  close(S(r.ent).a, [0, 0]); close(S(r.ent).b, [20, 0]); assert.equal(r.ent.layer, 'Cut');
  r = extendEntity(ent, edges, [2, 0]);
  close(S(r.ent).a, [-8, 0]); close(S(r.ent).b, [10, 0]);
});

test('extendEntity: no boundary ahead, not a line, or the line itself as its only boundary → an error', () => {
  const ent = line(0, 0, 10, 0);
  assert.match(extendEntity(ent, [line(0, 5, 10, 5)], [9, 0]).error, /No boundary/);
  assert.match(extendEntity(ent, [ent], [9, 0]).error, /No boundary/);
  assert.match(extendEntity(text(0, 0, 5, 'x'), [line(20, -5, 20, 5)], [5, 0]).error, /Extend takes/);
  assert.match(extendEntity(ent, [text(30, 0, 5, 'x')], [9, 0]).error, /No boundary/);
});

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const BQ = Math.tan(Math.PI / 8);   // a quarter circle's bulge

test('extendEntity arc: the picked end grows along its own circle to a line or a circle, the other end stays', () => {
  const a = arc(0, 0, 10, 0, 90);
  let s = S(extendEntity(a, [line(-20, 0, 0, 0)], [0, 10]).ent);
  near(s.a0, 0); near(s.a1, 180); near(s.r, 10); close(s.c, [0, 0]);
  s = S(extendEntity(a, [line(5, -20, 5, 20)], [10, 0]).ent);                       // the hit inside its own span does not count
  near(s.a0, 300); near(s.a1, 90);
  s = S(extendEntity(a, [circle(-10, 0, 10)], [0, 10]).ent);
  near(s.a0, 0); near(s.a1, 120);
  assert.equal(extendEntity(arc(0, 0, 10, 0, 90, { layer: 'Cut' }), [line(-20, 0, 0, 0)], [0, 10]).ent.layer, 'Cut');
});

test('extendEntity arc: no boundary ahead is the existing error; a circle is a closed shape', () => {
  assert.match(extendEntity(arc(0, 0, 10, 0, 90), [line(-5, 20, -5, 30)], [0, 10]).error, /No boundary/);
  assert.match(extendEntity(arc(0, 0, 10, 0, 90), [arc(0, 0, 10, 90, 180)], [0, 10]).error, /No boundary/);   // same circle never meets
  assert.match(extendEntity(circle(0, 0, 5), [line(20, -5, 20, 5)], [5, 0]).error, /Can't extend a closed shape/);
});

test('extendEntity polyline: a straight end segment runs along its line, widths and layer kept', () => {
  const p = lwpoly([[0, 0], [10, 0], [10, 5]], { width: 2, layer: 'Cut' }), r = extendEntity(p, [line(0, 20, 20, 20), line(-6, -5, -6, 5)], [10, 5]);
  assert.deepEqual(S(r.ent).pts, [[0, 0], [10, 0], [10, 20]]); assert.equal(r.ent.layer, 'Cut');
  assert.equal(get(r.ent.r, 43), 2, 'constant width kept');
  assert.deepEqual(S(extendEntity(p, [line(-6, -5, -6, 5)], [0, 0]).ent).pts, [[-6, 0], [10, 0], [10, 5]]);
  const tapered = entity('LWPOLYLINE', [[90, 2], [70, 0], [10, 0], [20, 0], [40, 1], [41, 3], [10, 10], [20, 0], [40, 3], [41, 3]]);
  assert.deepEqual(S(extendEntity(tapered, [line(30, -5, 30, 5)], [10, 0]).ent).pts, [[0, 0, 0, 1, 3], [30, 0, 0, 3, 3]]);
  assert.match(extendEntity(p, [line(0, 3, 20, 3)], [10, 5]).error, /No boundary/);
});

test('extendEntity polyline: a bulged end segment runs along its arc', () => {
  let s = S(extendEntity(lwpoly([[20, 0], [10, 0, BQ], [0, 10]]), [line(-20, 0, 0, 0)], [0, 10]).ent);   // the quarter circle grows to a half
  close(s.pts[2], [-10, 0]); near(s.pts[1][2], 1); close(s.pts[0], [20, 0]);
  s = S(extendEntity(lwpoly([[20, 0], [10, 0, -BQ], [0, -10]]), [line(-20, 0, 0, 0)], [0, -10]).ent);
  close(s.pts[2], [-10, 0]); near(s.pts[1][2], -1); close(s.pts[1], [10, 0]); close(s.pts[0], [20, 0]);
  s = S(extendEntity(lwpoly([[10, 0, BQ], [0, 10]]), [line(5, -20, 5, -1)], [10, 0]).ent);                // the start end, clockwise
  close(s.pts[0], [5, -Math.sqrt(75)]); near(s.pts[0][2], Math.tan(Math.PI * 150 / 180 / 4)); close(s.pts[1], [0, 10]);
});

test('extendEntity polyline: a closed polyline is a closed shape', () => {
  assert.match(extendEntity(lwpoly([[0, 0], [10, 0], [10, 5]], { closed: true }), [line(30, -5, 30, 5)], [10, 0]).error, /Can't extend a closed shape/);
});
