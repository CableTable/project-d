import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rayHit, extendEntity } from './web/extend.js';
import { shapeOf } from './web/grips.js';
import { line, circle, arc, lwpoly, text } from './web/dxf-write.js';

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
  assert.match(extendEntity(circle(0, 0, 5), [line(20, -5, 20, 5)], [5, 0]).error, /lines/);
  assert.match(extendEntity(ent, [text(30, 0, 5, 'x')], [9, 0]).error, /No boundary/);
});
