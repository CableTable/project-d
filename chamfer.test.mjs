import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chamferEntities, chamferSegment } from './web/fillet.js';
import { line, lwpoly, arc, newDoc, addEntities, writeDxf } from './web/dxf-write.js';
import { shapeOf, get, lwVertices } from './web/grips.js';
import { readDxf } from './web/drawing.js';

const a = line(0, 0, 100, 0, { layer: 'Cut', aci: 3, lt: 'DASHED' });
const b = line(100, 0, 100, 100, { layer: 'Cut', aci: 1 });
const solve = (d1 = 10, d2 = 10, trim = true, second = b, method = 'Distance') => chamferEntities(a, [50, 0], second, [100, 50], d1, d2, trim, { layer: 'Current' }, method);
const point = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `${a} != ${b}`));

test('Chamfer distances trim both lines; bevel inherits the shared layer and first properties', () => {
  const { ents } = solve(10, 20);
  assert.equal(ents.length, 3);
  point(shapeOf(ents[0]).b, [90, 0]); point(shapeOf(ents[1]).a, [100, 20]);
  const bevel = shapeOf(ents[2]); point(bevel.a, [90, 0]); point(bevel.b, [100, 20]);
  assert.equal(ents[2].layer, 'Cut'); assert.equal(ents[2].aci, 3); assert.equal(ents[2].lt, 'DASHED');
  assert.equal(shapeOf(a).b[0], 100, 'pure: source stays untouched');
  const raw = newDoc(4); addEntities(raw, ...ents);
  const saved = readDxf(writeDxf(raw)); point(shapeOf(saved.entities[2]).b, [100, 20]);
});

test('different layers use the current layer, while layer names compare case insensitively', () => {
  const second = line(100, 0, 100, 100, { layer: 'Mark' });
  const bevel = solve(10, 10, true, second).ents[2];
  assert.equal(bevel.layer, 'Current'); assert.ok(bevel.aci == null || bevel.aci === 256);
  assert.equal(solve(10, 10, true, { ...b, layer: 'cut' }).ents[2].layer, 'Cut');
});

test('Trim refuses setbacks at or past far ends; No trim permits them and preserves both objects', () => {
  assert.equal(solve(200, 200).error, 'Chamfer distance is too large');
  assert.equal(solve(100, 10).error, 'Chamfer distance is too large');
  const { ents } = solve(200, 200, false);
  assert.equal(ents[0], a); assert.equal(ents[1], b);
  point(shapeOf(ents[2]).a, [-100, 0]); point(shapeOf(ents[2]).b, [100, 200]);
});

test('Angle uses the first length and bevel angle, including a non-right corner', () => {
  point(shapeOf(solve(10, 30, true, b, 'Angle').ents[2]).b, [100, 10 * Math.tan(Math.PI / 6)]);
  const s = Math.sqrt(3) / 2, x = line(100, 0, 0, 0), y = line(0, 0, 50, 100 * s);
  const r = chamferEntities(x, [50, 0], y, [25, 50 * s], 10, 30, true, undefined, 'Angle');
  point(shapeOf(r.ents[2]).a, [10, 0]); point(shapeOf(r.ents[2]).b, [2.5, 5 * s]);
  assert.match(solve(10, 120, true, b, 'Angle').error, /angle does not fit/);
});

test('zero distances make a sharp corner, extending short lines without a zero-length bevel', () => {
  const x = line(0, 0, 80, 0), y = line(100, 20, 100, 100);
  const r = chamferEntities(x, [50, 0], y, [100, 50], 0, 0);
  assert.equal(r.ents.length, 2); point(shapeOf(r.ents[0]).b, [100, 0]); point(shapeOf(r.ents[1]).a, [100, 0]);
  assert.deepEqual(solve(0, 0, false).ents, [a, b]);
  assert.deepEqual(solve(0, 0).ents, [a, b], 'an unchanged sharp corner adds no replacement');
  const crossing = chamferEntities(line(-100, 0, 100, 0), [-50, 0], line(0, -100, 0, 100), [0, 50], 10, 20);
  point(shapeOf(crossing.ents[2]).a, [-10, 0]); point(shapeOf(crossing.ents[2]).b, [0, 20]);
});

test('parallel, arc, bulged segment, zero-length and invalid distances are refused', () => {
  assert.equal(solve(10, 10, true, line(0, 10, 100, 10)).error, 'Lines are parallel');
  assert.equal(solve(10, 10, true, arc(100, 0, 10, 0, 90)).error, 'Chamfer requires 2 lines (not arc segments). ');
  assert.equal(chamferSegment(lwpoly([[0, 0, 1], [100, 0]]), [50, -50]).error, 'Chamfer requires 2 lines (not arc segments). ');
  assert.match(solve(-1).error, /0 or more/); assert.match(solve(NaN).error, /0 or more/);
  assert.match(solve(1e-12, 1e-12).error, /drawing precision/);
  assert.match(chamferEntities(line(0, 0, 0, 0), [0, 0], b, [100, 50], 10, 10).error, /no length/);
});

test('straight polyline segments work with a LINE and preserve untouched vertices and widths', () => {
  const poly = lwpoly([[100, 0], [100, 100], [150, 100, .5]], { layer: 'Cut', width: 2 });
  const r = solve(10, 20, true, poly);
  assert.equal(r.ents[1].type, 'LWPOLYLINE');
  assert.deepEqual(lwVertices(r.ents[1].r).map((v) => [v.x, v.y, v.b]), [[100, 20, 0], [100, 100, 0], [150, 100, .5]]);
  assert.equal(get(r.ents[1].r, 43), 2);
});

test('two picks on an open or closed polyline insert a straight bevel, including the closing corner', () => {
  for (const closed of [false, true]) {
    const e = lwpoly([[0, 0], [100, 0], [100, 100], [0, 100]], { closed, width: 2 });
    for (const reverse of [false, true]) {
      const p = reverse ? [[100, 50], [50, 0]] : [[50, 0], [100, 50]];
      const r = chamferEntities(e, p[0], e, p[1], 10, 10);
      assert.equal(r.ents.length, 1);
      assert.deepEqual(lwVertices(r.ents[0].r).map((v) => [v.x, v.y]), [[0, 0], [90, 0], [100, 10], [100, 100], [0, 100]]);
      assert.equal(get(r.ents[0].r, 43), 2); assert.equal(get(r.ents[0].r, 70), closed ? 1 : 0);
    }
    if (closed) {
      const r = chamferEntities(e, [0, 50], e, [50, 0], 10, 10);
      assert.deepEqual(lwVertices(r.ents[0].r).slice(0, 2).map((v) => [v.x, v.y]), [[0, 10], [10, 0]]);
    }
    const r = chamferEntities(e, [50, 0], e, [100, 50], 10, 10, false);
    assert.equal(r.ents[0], e); assert.equal(r.ents[1].type, 'LINE');
  }
});

test('non-adjacent segments of one polyline and inner polyline vertices are refused, an open end works', () => {
  const zig = lwpoly([[0, 0], [100, 0], [100, 10], [200, -50]]);
  assert.equal(chamferEntities(zig, [50, 0], zig, [150, -20], 10, 10).error, 'Pick two adjacent segments of the same polyline');
  const sq = lwpoly([[0, 0], [100, 0], [100, 100]], { closed: true });
  assert.equal(chamferEntities(sq, [50, 0], sq, [50, 50], 10, 10).error, undefined, 'a closed polyline\'s last and first segments are neighbours');
  const l = lwpoly([[0, 0], [100, 0], [100, 100]]), cut = line(120, -50, 120, 50);
  const bad = chamferEntities(l, [50, 0], cut, [120, 0], 10, 10);
  assert.match(bad.error, /separate objects/); assert.equal(bad.ents, undefined);
  const end = lwpoly([[0, 0], [100, 0], [100, 100]]), c2 = line(-20, -50, -20, 50);
  const ok = chamferEntities(end, [20, 0], c2, [-20, 20], 10, 10);
  assert.deepEqual(lwVertices(ok.ents[0].r).map((v) => [v.x, v.y]), [[-10, 0], [100, 0], [100, 100]]);
});
