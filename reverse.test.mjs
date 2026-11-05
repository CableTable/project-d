import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reverse } from './web/reverse.js';
import { flatten, readDxf } from './web/drawing.js';
import { newDoc, line, arc, circle, ellipse, lwpoly, entity, text, writeDxf } from './web/dxf-write.js';
import { get } from './web/grips.js';

const own = { layer: 'Cut', aci: 3, lt: 'DASHED', lw: 35 };
const docOf = (...entities) => { const d = newDoc(4); d.entities.push(...entities); return d; };
const dots = (ops) => {       // a drawn path as pieces, each piece 9 points along it: [[x, y] ...]
  const pieces = [];
  let p = null, start = null;
  for (let i = 0; i < ops.length;) {
    const op = ops[i];
    if (op === 0) { p = start = [ops[i + 1], ops[i + 2]]; i += 3; } else if (op === 1) { const q = [ops[i + 1], ops[i + 2]]; pieces.push(Array.from({ length: 9 }, (_, k) => [p[0] + (q[0] - p[0]) * k / 8, p[1] + (q[1] - p[1]) * k / 8])); p = q; i += 3; } else if (op === 2) {
      const [cx, cy, r, a0, a1, cw] = ops.slice(i + 1, i + 7);
      let sw = cw ? a0 - a1 : a1 - a0; sw = ((sw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
      const pts = Array.from({ length: 9 }, (_, k) => { const a = cw ? a0 - sw * k / 8 : a0 + sw * k / 8; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
      pieces.push(pts); p = pts[8]; i += 7;
    } else { if (p && start && Math.hypot(p[0] - start[0], p[1] - start[1]) > 1e-9) pieces.push(Array.from({ length: 9 }, (_, k) => [p[0] + (start[0] - p[0]) * k / 8, p[1] + (start[1] - p[1]) * k / 8])); i += 1; }
  }
  return pieces;
};
const drawn = (e) => flatten(docOf(e)).items.filter((i) => i.k === 'p').flatMap((i) => dots(i.ops));
const key = (piece) => JSON.stringify(piece.map((q) => q.map((v) => Math.round(v * 1e6) / 1e6 + 0)));
/** The same shape, walked the other way: every piece reversed, and (open) in the opposite order. */
function sameBackwards(before, after, closed) {
  const want = before.map((p) => p.slice().reverse());
  if (!closed) want.reverse();
  assert.deepEqual(after.map(key).sort(), want.map(key).sort(), 'the same pieces, each walked backwards');
  if (!closed) assert.deepEqual(after.map(key), want.map(key), 'in the opposite order');
}

test('a line swaps its ends; layer, colour, line type and weight stay', () => {
  const l = line(1, 2, 30, 40, own), r = reverse(l);
  assert.deepEqual(r.r.v.slice(-6), ['30', '40', '0', '1', '2', '0']);
  assert.deepEqual([r.layer, r.aci, r.lt, r.lw], ['Cut', 3, 'DASHED', 35]);
  assert.equal(l.r.v[1], '1', 'the original is not touched');
  sameBackwards(drawn(l), drawn(r), false);
});

test('an open polyline: vertices backwards, bulges negated onto the right segment, widths swapped', () => {
  const p = lwpoly([[0, 0, 0.5], [10, 0], [10, 10, -0.3], [0, 10]], own), r = reverse(p);
  sameBackwards(drawn(p), drawn(r), false);
  assert.deepEqual([get(r.r, 10, 0), get(r.r, 20, 0), get(r.r, 10, 3), get(r.r, 20, 3)], [0, 10, 0, 0], 'the start is the old end');
  assert.deepEqual([get(r.r, 42, 0), get(r.r, 42, 1), get(r.r, 42, 2)], [0.3, -0.5, null], 'moved one segment, sign turned; the last vertex has none');
  assert.equal(r.layer, 'Cut'); assert.equal(get(r.r, 90), 4);
  assert.deepEqual(drawn(reverse(r)).map(key), drawn(p).map(key), 'twice is the original path');
});

test('polyline widths: start and end swap on each segment, a constant width stays', () => {
  const w = entity('LWPOLYLINE', [[90, 3], [70, 0], [10, 0], [20, 0], [40, 2], [41, 4], [10, 10], [20, 0], [40, 6], [41, 8], [10, 20], [20, 0]]), r = reverse(w);
  assert.deepEqual(r.r.c.map((c, k) => [c, r.r.v[k]]).filter(([c]) => [10, 40, 41].includes(c)).map(([c, v]) => c + ':' + v),
    ['10:20', '40:8', '41:6', '10:10', '40:4', '41:2', '10:0', '40:0', '41:0']);
  const k = reverse(lwpoly([[0, 0], [5, 5]], { width: 3 }));
  assert.equal(get(k.r, 43), 3);
});

test('a closed polyline with a bulge on its closing segment', () => {
  const p = lwpoly([[0, 0], [10, 0], [10, 10, 0.4], [0, 10, -0.7]], { closed: true }), r = reverse(p);
  sameBackwards(drawn(p), drawn(r), true);
  assert.equal(get(r.r, 70), 1, 'still closed');
  assert.deepEqual([get(r.r, 10, 0), get(r.r, 20, 0)], [0, 10]);
  assert.deepEqual(drawn(reverse(r)).map(key), drawn(p).map(key));
});

test('a 2D polyline reverses its VERTEX records the same way', () => {
  const vtx = (x, y, b = 0) => ({ type: 'VERTEX', c: [8, 10, 20, 30, ...(b ? [42] : [])], v: ['0', String(x), String(y), '0', ...(b ? [String(b)] : [])] });
  const make = (closed) => ({ ...entity('POLYLINE', [[66, 1], [10, 0], [20, 0], [30, 0], [70, closed ? 1 : 0]], own), kids: [vtx(0, 0, 0.5), vtx(10, 0), vtx(10, 10, -0.25), vtx(0, 10)] });
  for (const closed of [false, true]) {
    const p = make(closed), r = reverse(p);
    sameBackwards(drawn(p), drawn(r), closed);
    assert.deepEqual(r.kids.map((k) => k.v[1] + ',' + k.v[2]), ['0,10', '10,10', '10,0', '0,0']);
    assert.equal(r.layer, 'Cut');
    assert.deepEqual(drawn(reverse(r)).map(key), drawn(p).map(key));
  }
  assert.equal(reverse({ ...make(false), r: entity('POLYLINE', [[66, 1], [70, 8]]).r }), null, 'a 3-D polyline');
});

const spl = (extra = []) => entity('SPLINE', [[70, 8], [71, 3], [72, 9], [73, 5], [74, 0], ...[0, 0, 0, 0, 2, 5, 5, 5, 5].map((u) => [40, u]), [41, 1], [41, 2], [41, 1], [41, 3], [41, 1],
  ...[[0, 0], [5, 10], [10, 10], [15, -4], [20, 0]].flatMap(([x, y]) => [[10, x], [20, y], [30, 0]]), ...extra], own);
test('a spline: control points, weights, knots, tangents', () => {
  const s = spl([[12, 1], [22, 2], [32, 0], [13, -3], [23, 4], [33, 0]]), r = reverse(s);
  sameBackwards(drawn(s), drawn(r), false);
  const nums = (code) => r.r.c.flatMap((c, k) => (c === code ? [+r.r.v[k]] : []));
  assert.deepEqual(nums(40), [0, 0, 0, 0, 3, 5, 5, 5, 5], 'knots mirrored');
  assert.deepEqual(nums(41), [1, 3, 1, 2, 1], 'weights backwards');
  assert.deepEqual(nums(10), [20, 15, 10, 5, 0]);
  assert.deepEqual([12, 22, 32, 13, 23, 33].map((c) => nums(c)[0] + 0), [3, -4, 0, -1, -2, 0].map((x) => x + 0), 'start and end tangents swapped and negated');
  assert.equal(get(r.r, 73), 5); assert.equal(r.layer, 'Cut');
  assert.deepEqual(drawn(reverse(r)).map(key), drawn(s).map(key));
});

test('a spline with fit points only', () => {
  const f = entity('SPLINE', [[70, 1032], [71, 3], [72, 0], [73, 0], [74, 3], ...[[0, 0], [5, 5], [9, 1]].flatMap(([x, y]) => [[11, x], [21, y], [31, 0]])]), r = reverse(f);
  assert.deepEqual(r.r.c.flatMap((c, k) => (c === 11 ? [+r.r.v[k]] : [])), [9, 5, 0]);
  assert.equal(get(r.r, 74), 3);
});

test('arcs, circles, ellipses, text and a record with nothing in it are not reversible', () => {
  for (const e of [arc(0, 0, 5, 0, 90), circle(0, 0, 5), ellipse(0, 0, 5, 0, 0.5), text(0, 0, 2, 'a'), null, undefined]) assert.equal(reverse(e), null, e?.type);
  assert.equal(reverse(entity('SPLINE', [[70, 8], [71, 3]])), null);
});

test('saved: the DXF written after Reverse has the new order', () => {
  const d = docOf(reverse(lwpoly([[0, 0], [10, 0, 0.5], [10, 10]], own)), reverse(line(1, 2, 3, 4)), reverse(spl()));
  const back = readDxf(writeDxf(d));
  const [p, l, s] = back.entities;
  assert.deepEqual([get(p.r, 10, 0), get(p.r, 10, 2)], [10, 0]); assert.equal(get(p.r, 42, 0), -0.5); assert.equal(p.layer, 'Cut');
  assert.deepEqual([get(l.r, 10), get(l.r, 11)], [3, 1]);
  assert.equal(get(s.r, 10, 0), 20);
});
