import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from './web/dxf-write.js';
import { filletLines, filletEntities } from './web/fillet.js';
import { shapeOf } from './web/grips.js';

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
  assert.match(filletEntities(a, [5, 0], W.circle(0, 0, 5), [5, 0], 1).error, /circles.*not supported/);
});

const near = (a, b) => assert.ok(Math.abs(a - b) < 3e-6, `${a} != ${b}`);
const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const end = (s, a) => [s.c[0] + s.r * Math.cos(a * Math.PI / 180), s.c[1] + s.r * Math.sin(a * Math.PI / 180)];
// Check the saved geometry, independently of the solver: endpoints join, radii / lines are tangent, and no source grows into a circle.
function tangent(ents, radius) {
  assert.equal(ents.length, 3);
  const fillet = shapeOf(ents[2]), ends = [end(fillet, fillet.a0), end(fillet, fillet.a1)];
  near(fillet.r, radius);
  for (const e of ents.slice(0, 2)) {
    const s = shapeOf(e), points = s.t === 'line' ? [s.a, s.b] : [end(s, s.a0), end(s, s.a1)];
    const pairs = points.flatMap((p) => ends.map((q) => ({ p, q, d: distance(p, q) }))).sort((a, b) => a.d - b.d);
    near(pairs[0].d, 0);
    const { p } = pairs[0], radial = p.map((v, i) => v - fillet.c[i]);
    const v = s.t === 'line' ? s.b.map((x, i) => x - s.a[i]) : [-(p[1] - s.c[1]), p[0] - s.c[0]];
    near((v[0] * radial[0] + v[1] * radial[1]) / Math.hypot(...v), 0);
    const keptSign = p === points[0] ? 1 : -1, filletSign = pairs[0].q === ends[0] ? 1 : -1;
    const away = v.map((x) => x * keptSign), join = [-radial[1] * filletSign, radial[0] * filletSign];
    near((away[0] * join[0] + away[1] * join[1]) / (Math.hypot(...away) * Math.hypot(...join)), -1);
    if (s.t === 'arc') assert.ok((s.a1 - s.a0 + 360) % 360 > 0);
  }
}

test('LINE / ARC: both line sides and both arc sides, including reversed entity order', () => {
  const line = W.line(-20, 0, 20, 0, { layer: 'Cut', aci: 3 });
  const arc = W.arc(0, 5, 10, 180, 360, { layer: 'Mark', aci: 1 });
  const before = structuredClone([line, arc]);
  for (const lp of [[-15, 0], [0, 0]]) for (const ap of [[-6, -3], [-9.5, 2]]) {
    const f = filletEntities(line, lp, arc, ap, 2); tangent(f.ents, 2);
    const l = shapeOf(f.ents[0]), a = shapeOf(f.ents[1]);
    if (lp[0] < -10) pt(l.a, [-20, 0]); else pt(l.b, [20, 0]);
    if (ap[1] < 0) close(a.a1, 360); else close(a.a0, 180);
    assert.deepEqual(f.ents.map((e) => [e.layer, e.aci]), [['Cut', 3], ['Mark', 1], ['Cut', 3]]);
    const reversed = filletEntities(arc, ap, line, lp, 2); tangent(reversed.ents, 2);
    assert.deepEqual(reversed.ents.slice(0, 2), [f.ents[1], f.ents[0]]);
    assert.equal(reversed.ents[2].layer, 'Mark');
  }
  assert.deepEqual([line, arc], before);
});

test('ARC / ARC: all four kept-side combinations at the crossing', () => {
  const a = W.arc(0, 0, 10, 0, 180), b = W.arc(10, 0, 10, 0, 180);
  for (const p of [[8, 6], [-8, 6]]) for (const q of [[18, 6], [2, 6]]) {
    const f = filletEntities(a, p, b, q, 2); tangent(f.ents, 2);
    const s = f.ents.slice(0, 2).map((e) => shapeOf(e));
    if (p[0] > 0) close(s[0].a0, 0); else close(s[0].a1, 180);
    if (q[0] > 10) close(s[1].a0, 0); else close(s[1].a1, 180);
    assert.deepEqual(filletEntities(b, q, a, p, 2).ents.slice(0, 2), [f.ents[1], f.ents[0]]);
  }
});

test('radius 0: intersecting line/arc and arc/arc keep the picked endpoints without adding an arc', () => {
  const a = W.arc(0, 0, 10, 0, 180), b = W.arc(10, 0, 10, 0, 180);
  const f = filletEntities(a, [-8, 6], b, [18, 6], 0);
  assert.equal(f.ents.length, 2); near(value(f.ents[0], 50), 60); near(value(f.ents[1], 51), 120);
  const g = filletEntities(W.line(-20, 0, 20, 0), [-15, 0], a, [0, 10], 0);
  assert.equal(g.ents.length, 2); close(value(g.ents[0], 11), -10); close(value(g.ents[1], 51), 180);
});

test('separated and concentric supports: tangent fillets exist, but radius 0 is undefined', () => {
  const a = W.arc(0, 0, 10, 0, 180), b = W.arc(25, 0, 10, 0, 180);
  tangent(filletEntities(a, [8, 6], b, [17, 6], 4).ents, 4);
  const line = W.line(-30, 15, 30, 15);
  tangent(filletEntities(line, [-20, 15], a, [-8, 6], 4).ents, 4);
  assert.match(filletEntities(line, [-20, 15], a, [8, 6], 0).error, /intersect/);
  assert.match(filletEntities(a, [8, 6], b, [17, 6], 0).error, /intersect/);
  tangent(filletEntities(a, [8, 6], W.arc(0, 0, 6, 0, 180), [-4.8, 3.6], 2).ents, 2);
  tangent(filletEntities(W.arc(0, 0, 10, 0, 20), [9.85, 1.74], W.arc(0, 0, 6, 180, 200), [-5.91, -1.04], 8).ents, 8);
});

test('impossible radii and swallowed finite arcs refuse without changing either source', () => {
  const line = W.line(-20, 0, 20, 0), a = W.arc(0, 5, 10, 210, 211), b = W.arc(10, 5, 10, 0, 180);
  const before = structuredClone([line, a, b]);
  assert.match(filletEntities(line, [-15, 0], a, [-8.62, -.07], 2).error, /miss or swallow/);
  assert.match(filletEntities(a, [-9, 2], b, [18, 11], 100).error, /miss or swallow/);
  assert.match(filletEntities(W.line(-20, 30, 20, 30), [-15, 30], b, [18, 11], 1).error, /No tangent/);
  assert.match(filletEntities(a, [-9, 2], W.arc(100, 0, 10, 0, 180), [100, 10], 1).error, /No tangent/);
  for (const r of [-1, Infinity, NaN]) assert.match(filletEntities(line, [-15, 0], b, [18, 11], r).error, /0 or more/);
  assert.deepEqual([line, a, b], before);
});

test('wrapped arcs and clockwise OCS -Z arcs give the same world geometry and survive DXF read', async () => {
  const { readDxf } = await import('./web/drawing.js');
  const line = W.line(-20, 0, 20, 0), arc = W.arc(3, 5, 10, 180, 360);
  const mirrored = W.arc(-3, 5, 10, 180, 360);
  mirrored.r.c.push(210, 220, 230); mirrored.r.v.push('0', '0', '-1');
  const raw = W.newDoc(4); W.addEntities(raw, mirrored);
  const read = readDxf(W.writeDxf(raw)).entities[0]; assert.equal(read.flip, true);
  const shapes = (f) => f.ents.map((e) => { const s = shapeOf(e); return s.t === 'arc' ? { ...s, a0: s.a0 % 360, a1: s.a1 % 360 } : s; });
  assert.deepEqual(shapes(filletEntities(line, [-15, 0], read, [-6, -3], 2)), shapes(filletEntities(line, [-15, 0], arc, [-6, -3], 2)));
  tangent(filletEntities(W.arc(0, 0, 10, 300, 240), [8, 6], W.arc(10, 0, 10, 300, 240), [2, 6], 2).ents, 2);
  tangent(filletEntities(read, [-6, -3], W.arc(10, 5, 10, 180, 360), [4, -3], 2).ents, 2);
  assert.deepEqual(shapes(filletEntities(line, [-15, 0], read, [-6, -3], 0)), shapes(filletEntities(line, [-15, 0], arc, [-6, -3], 0)));
});

test('degenerate / tilted arcs, polylines and subprecision results are refused', () => {
  const line = W.line(-20, 0, 20, 0), a = W.arc(0, 5, 10, 180, 360);
  for (const e of [W.arc(0, 5, 0, 180, 360), W.arc(0, 5, 10, 0, 360), W.line(0, 0, 0, 0)]) {
    assert.match(filletEntities(e, [0, 0], a, [-6, -3], 2).error, /no length/);
  }
  const tilted = structuredClone(a); tilted.r.c.push(210, 220, 230); tilted.r.v.push('1', '0', '1');
  assert.match(filletEntities(line, [-15, 0], tilted, [-6, -3], 2).error, /drawing plane/);
  assert.match(filletEntities(line, [-15, 0], W.lwpoly([[0, 0], [1, 1]]), [0, 0], 2).error, /polylines.*not supported/);
  assert.match(filletEntities(line, [-15, 0], a, [-6, -3], 1e-7).error, /precision/);
});
