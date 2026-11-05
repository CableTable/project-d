import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakEntity, breakAtPoint, breakWhy } from './web/break.js';
import { line, arc, circle, lwpoly, ellipse, entity, writeDxf, newDoc, addEntities } from './web/dxf-write.js';
import { shapeOf, get } from './web/grips.js';
import { readDxf } from './web/drawing.js';
import { newLayout, objectPart, objectPlacement, objectDoc, objectCommit } from './web/layoutdoc.js';

const shapes = (pieces) => pieces.map((e) => shapeOf(e));
const near = (a, b) => assert.ok(Math.abs(a - b) < 2e-6, `${a} != ${b}`);

test('LINE projects points, sorts reversed picks, clamps past ends, and splits without a gap', () => {
  const e = line(0, 0, 100, 0), original = structuredClone(e);
  assert.deepEqual(shapes(breakEntity(e, [70, 5], [30, -8])), [{ t: 'line', a: [0, 0], b: [30, 0] }, { t: 'line', a: [70, 0], b: [100, 0] }]);
  assert.deepEqual(shapes(breakEntity(e, [-20, 5], [30, 0])), [{ t: 'line', a: [30, 0], b: [100, 0] }]);
  assert.equal(breakEntity(e, [-10, 0], [110, 0]).length, 0);
  const pieces = shapes(breakAtPoint(e, [40, 20]));
  assert.deepEqual(pieces[0].b, pieces[1].a); assert.deepEqual(pieces[0].b, [40, 0]);
  assert.deepEqual(e, original);
});

test('ARC projects radially across angle zero and keeps finite ends', () => {
  const e = arc(0, 0, 10, 270, 180), p = (a) => [20 * Math.cos(a * Math.PI / 180), 20 * Math.sin(a * Math.PI / 180)];
  const parts = shapes(breakEntity(e, p(90), p(0)));
  near(parts[0].a0, 270); near(parts[0].a1, 0); near(parts[1].a0, 90); near(parts[1].a1, 180);
  assert.equal(breakEntity(arc(0, 0, 10, 0, 90), [-10, 0], p(45)).length, 1);
  assert.equal(breakAtPoint(e, p(0)).length, 2);
});

test('CIRCLE removes counterclockwise from first to second, including wrap and negative extrusion', () => {
  const e = circle(0, 0, 10);
  assert.deepEqual(shapes(breakEntity(e, [20, 0], [0, 20])), [{ t: 'arc', c: [0, 0], r: 10, a0: 90, a1: 0 }]);
  const wrap = shapes(breakEntity(e, [0, -20], [20, 0]))[0]; near(wrap.a0, 0); near(wrap.a1, 270);
  const flipped = entity('CIRCLE', [[10, -20], [20, 0], [40, 10], [230, -1]]);
  const out = shapes(breakEntity(flipped, [30, 0], [20, 10]))[0];
  assert.deepEqual(out.c, [20, 0]); near(out.a0, 90); near(out.a1, 0);
  assert.equal(breakAtPoint(e, [10, 0]), null);
});

test('open polylines retain and split positive / negative bulges and variable widths', () => {
  for (const sign of [1, -1]) {
    const e = entity('LWPOLYLINE', [[90, 3], [70, 0], [10, 0], [20, 0], [42, sign], [40, 2], [41, 6], [10, 20], [20, 0], [10, 40], [20, 0]]);
    const parts = shapes(breakAtPoint(e, [10, -10 * sign]));
    assert.equal(parts.length, 2);
    near(parts[0].pts[0][2], sign * Math.tan(Math.PI / 8));
    near(parts[1].pts[0][2], sign * Math.tan(Math.PI / 8));
    assert.deepEqual(parts[0].pts[0].slice(3), [2, 4]);
    assert.deepEqual(parts[1].pts[0].slice(3), [4, 6]);
    assert.deepEqual(parts[0].pts.at(-1).slice(0, 2), parts[1].pts[0].slice(0, 2));
    assert.deepEqual(parts[1].pts.at(-1), [40, 0]);
  }
});

test('closed polyline opens across the seam, same-point opens with no gap; two-vertex loop supported', () => {
  const e = lwpoly([[0, 0], [20, 0], [20, 20], [0, 20]], { closed: true });
  const [out] = shapes(breakEntity(e, [10, 0], [20, 10]));
  assert.equal(out.closed, false); assert.deepEqual(out.pts, [[20, 10], [20, 20], [0, 20], [0, 0], [10, 0]]);
  const [split] = shapes(breakEntity(e, [10, 0], [10, 0]));
  assert.deepEqual(split.pts[0], split.pts.at(-1)); assert.equal(split.closed, false);
  assert.equal(breakAtPoint(e, [10, 0]), null);
  assert.equal(breakEntity(lwpoly([[0, 0, 1], [20, 0, 1]], { closed: true }), [10, -10], [10, 10]).length, 1);
});

test('pieces preserve all common source properties, constant width and elevation through DXF', () => {
  const props = { layer: 'Cut', aci: 3, tc: 0x123456, lt: 'DASHED', lw: 35, lts: 2 };
  const e = lwpoly([[0, 0, 1], [20, 0], [40, 0]], { ...props, width: 3 });
  e.r.c.push(38); e.r.v.push('7');
  const parts = breakAtPoint(e, [10, -10]);
  for (const piece of parts) {
    for (const key of Object.keys(props)) assert.equal(piece[key], props[key]);
    assert.equal(get(piece.r, 43), 3); assert.equal(get(piece.r, 38), 7);
  }
  const d = newDoc(4); addEntities(d, parts);
  assert.equal(readDxf(writeDxf(d)).entities.length, 2);
});

test('unsupported, invalid and degenerate geometry returns null', () => {
  for (const e of [ellipse(0, 0, 10, 0, .5), entity('SPLINE', []), entity('TEXT', []), line(0, 0, 0, 0)]) assert.equal(breakEntity(e, [0, 0], [1, 0]), null);
  assert.equal(breakEntity(line(0, 0, 10, 0), [NaN, 0], [1, 0]), null);
});

test('a circle at one point is refused (no zero-sweep arc); a repeated vertex has its own note', () => {
  const c = circle(0, 0, 10), same = 'Cannot break a closed object at one point';
  for (const [p1, p2] of [[[10, 0], [10, 0]], [[10, 0], [30, 0]], [[0, 5], [0, 99]]]) {
    assert.equal(breakEntity(c, p1, p2), null); assert.equal(breakWhy(c, p1, p2), same);
  }
  assert.equal(breakEntity(c, [10, 0], [0, 10]).length, 1);
  const dup = lwpoly([[0, 0], [10, 0], [10, 0], [20, 0]]);
  assert.equal(breakEntity(dup, [5, 0], [15, 0]), null);
  assert.equal(breakWhy(dup, [5, 0], [15, 0]), 'The polyline has a side without length');
  assert.equal(breakWhy(entity('TEXT', []), [0, 0], [1, 0]), 'Break works on lines, arcs, circles and polylines');
  const box = lwpoly([[0, 0], [20, 0], [20, 20], [0, 20]], { closed: true });       // Break at point: the closed polyline says so too (TODO 97c)
  assert.equal(breakAtPoint(box, [10, 0]), null); assert.equal(breakWhy(box, [10, 0], [10, 0]), same);
  assert.equal(breakWhy(box, [10, 0], [30, 5]), same);       // breakDo passes (m.p0 || p, p): two different points reach the same note
});

test('layout split pieces keep their source member group and leave the saved source untouched', () => {
  const lay = newLayout('Break'), e = line(10, 10, 110, 10);
  lay.parts.a = objectPart('a', 'Source', e, newDoc(4).layers); lay.parts.b = objectPart('b', 'Other', line(10, 30, 110, 30), newDoc(4).layers);
  lay.placed = [{ ...objectPlacement(lay.parts.a), g: 'g1' }, { ...objectPlacement(lay.parts.b), g: 'g1' }];
  const before = structuredClone(lay), view = objectDoc(lay), source = view.raw.entities[0];
  let id = 0;
  objectCommit(lay, view, [ ...breakAtPoint(source, [60, 10]), view.raw.entities[1] ], () => `new${++id}`);
  assert.equal(lay.placed.length, 3); assert.ok(lay.placed.every((p) => p.g === 'g1'));
  assert.equal(before.placed.length, 2); assert.equal(before.parts.a.raw.entities.length, 1);
});
