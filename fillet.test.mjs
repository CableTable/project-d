import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from './web/dxf-write.js';
import { filletLines, filletEntities } from './web/fillet.js';
import { shapeOf } from './web/grips.js';
import { filletPolylineShape, filletAllPolyline } from './web/fillet.js';
import { pathOf, geo } from './web/modify.js';
import { readDxf } from './web/drawing.js';

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

test('invalid cases: collinear, radius too big, negative radius, zero-length line', () => {
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
    if (e.type === 'CIRCLE') {
      const s = shapeOf(e), p = ends.slice().sort((p, q) => Math.abs(distance(p, s.c) - s.r) - Math.abs(distance(q, s.c) - s.r))[0];
      near(distance(p, s.c), s.r);
      near(((p[0] - s.c[0]) * (p[1] - fillet.c[1]) - (p[1] - s.c[1]) * (p[0] - fillet.c[0])) / (s.r * radius), 0);
      continue;
    }
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

test('LINE / CIRCLE: nearest tangent on either side of the picks, both orders, circle untouched and No trim', () => {
  const line = W.line(-20, 0, 20, 0, { layer: 'Cut' }), circle = W.circle(0, 10, 5, { layer: 'Mark' });
  const before = structuredClone([line, circle]);
  for (const side of [-1, 1]) {
    const p = [side * 10, 0], q = [0, 5], f = filletEntities(line, p, circle, q, 3);
    assert.ok(f.ents, f.error); tangent(f.ents, 3);
    assert.equal(f.ents[1], circle); assert.equal(f.ents[2].layer, 'Cut');
    near(value(f.ents[2], 10), side * Math.sqrt(15)); near(value(f.ents[2], 20), 3);
    const reversed = filletEntities(circle, q, line, p, 3);
    tangent(reversed.ents, 3); assert.equal(reversed.ents[0], circle); assert.equal(reversed.ents[2].layer, 'Mark');
    assert.deepEqual(reversed.ents[1], f.ents[0]);
    const noTrim = filletEntities(line, p, circle, q, 3, false);
    assert.equal(noTrim.ents[0], line); assert.equal(noTrim.ents[1], circle); assert.deepEqual(noTrim.ents[2], f.ents[2]);
  }
  assert.deepEqual([line, circle], before);
});

test('CIRCLE / CIRCLE: outside tangent solutions follow the picks and leave both sources unchanged', () => {
  const a = W.circle(0, 0, 5), b = W.circle(16, 0, 5), before = structuredClone([a, b]);
  for (const side of [-1, 1]) {
    const p = [4, side * 3], q = [12, side * 3], f = filletEntities(a, p, b, q, 4);
    assert.ok(f.ents, f.error); tangent(f.ents, 4);
    assert.equal(f.ents[0], a); assert.equal(f.ents[1], b);
    near(value(f.ents[2], 10), 8); near(value(f.ents[2], 20), side * Math.sqrt(17));
    assert.deepEqual(filletEntities(b, q, a, p, 4).ents[2], f.ents[2]);
    assert.deepEqual(filletEntities(a, p, b, q, 4, false).ents, f.ents);
  }
  assert.deepEqual([a, b], before);
  const outer = W.circle(0, 0, 10), inner = W.circle(0, 0, 6);
  const concentric = filletEntities(outer, [10, 0], inner, [6, 0], 2);
  tangent(concentric.ents, 2); pt(shapeOf(concentric.ents[2]).c, [8, 0]);
  assert.equal(concentric.ents[0], outer); assert.equal(concentric.ents[1], inner);
});

test('ARC / CIRCLE: trim the finite arc, preserve the circle; impossible and zero radii refuse', () => {
  const arc = W.arc(0, 0, 5, 0, 180), circle = W.circle(16, 0, 5), before = structuredClone([arc, circle]);
  const f = filletEntities(arc, [0, 5], circle, [12, 3], 4);
  assert.ok(f.ents, f.error); tangent(f.ents, 4);
  assert.equal(f.ents[1], circle); assert.ok(value(f.ents[0], 50) > 0); close(value(f.ents[0], 51), 180);
  tangent(filletEntities(circle, [12, 3], arc, [0, 5], 4).ents, 4);
  assert.deepEqual(filletEntities(arc, [0, 5], circle, [12, 3], 4, false).ents.slice(0, 2), [arc, circle]);
  assert.match(filletEntities(W.arc(0, 0, 5, 0, 30), [4.9, .5], circle, [12, 3], 100).error, /No tangent.*radius.*miss or swallow/);
  for (const other of [arc, W.line(-20, 0, 20, 0), W.circle(30, 0, 5)]) {
    assert.equal(filletEntities(circle, [12, 3], other, [0, 5], 0).error, 'Fillet with a circle needs a radius above 0');
    assert.equal(filletEntities(other, [0, 5], circle, [12, 3], 0).error, 'Fillet with a circle needs a radius above 0');
  }
  assert.match(filletEntities(W.circle(0, 0, 0), [0, 0], arc, [0, 5], 2).error, /no length/);
  const tilted = structuredClone(circle); tilted.r.c.push(210); tilted.r.v.push('1');
  assert.match(filletEntities(arc, [0, 5], tilted, [12, 3], 4).error, /drawing plane/);
  assert.deepEqual([arc, circle], before);
});

test('parallel lines: a gap-sized semicircle at the first picked end, both orders, extend and No trim', () => {
  for (const reverse of [false, true]) for (const side of [-1, 1]) for (const radius of [0, 1, 100]) {
    const pair = [W.line(0, 0, 20, 0), W.line(2, 6, 18, 6)];
    if (reverse) pair.reverse();
    const [a, b] = pair, picks = [a, b].map((e) => [side < 0 ? value(e, 10) + 1 : value(e, 11) - 1, value(e, 20)]);
    const f = filletEntities(a, picks[0], b, picks[1], radius), arc = shapeOf(f.ents[2]);
    assert.equal(f.ents[0], a); tangent(f.ents, 3);
    const x = value(a, side < 0 ? 10 : 11);
    near(arc.c[0], x); near(arc.c[1], 3); near((arc.a1 - arc.a0 + 360) % 360, 180);
    const mid = end(arc, arc.a0 + 90); assert.ok(side * (mid[0] - x) > 0, 'semicircle lies beyond the first endpoint');
    close(value(f.ents[1], side < 0 ? 10 : 11), x);
    const noTrim = filletEntities(a, picks[0], b, picks[1], radius, false);
    assert.equal(noTrim.ents[0], a); assert.equal(noTrim.ents[1], b); assert.deepEqual(noTrim.ents[2], f.ents[2]);
  }
  const f = filletLines([[0, 20], [0, 0]], [0, 1], [[6, 8], [6, 30]], [6, 9], 50);
  pt(f.arc.c, [3, 0]); pt(f.l2[0], [6, 0]); close(f.arc.r, 3);
  assert.match(filletEntities(W.line(0, 0, 10, 0), [1, 0], W.line(0, 1e-7, 10, 1e-7), [1, 1e-7], 5).error, /precision/);
});

test('OCS -Z circle: solve in drawing coordinates and keep the original circle record', () => {
  const line = W.line(-20, 0, 20, 0), circle = W.circle(3, 10, 5), mirrored = W.circle(-3, 10, 5);
  mirrored.r.c.push(210, 220, 230); mirrored.r.v.push('0', '0', '-1');
  const f = filletEntities(line, [-10, 0], circle, [3, 5], 3), g = filletEntities(line, [-10, 0], mirrored, [3, 5], 3);
  assert.deepEqual(g.ents[0], f.ents[0]); assert.deepEqual(g.ents[2], f.ents[2]); assert.equal(g.ents[1], mirrored);
  const raw = W.newDoc(4); W.addEntities(raw, ...g.ents);
  const saved = readDxf(W.writeDxf(raw)); assert.equal(saved.entities[1].flip, true);
  assert.deepEqual(shapeOf(saved.entities[2]), shapeOf(f.ents[2]));
});

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

test('degenerate / tilted arcs, mixed polyline pairs and subprecision results are refused', () => {
  const line = W.line(-20, 0, 20, 0), a = W.arc(0, 5, 10, 180, 360);
  for (const e of [W.arc(0, 5, 0, 180, 360), W.arc(0, 5, 10, 0, 360), W.line(0, 0, 0, 0)]) {
    assert.match(filletEntities(e, [0, 0], a, [-6, -3], 2).error, /no length/);
  }
  const tilted = structuredClone(a); tilted.r.c.push(210, 220, 230); tilted.r.v.push('1', '0', '1');
  assert.match(filletEntities(line, [-15, 0], tilted, [-6, -3], 2).error, /drawing plane/);
  assert.match(filletEntities(line, [-15, 0], W.lwpoly([[0, 0], [1, 1]]), [0, 0], 2).error, /same polyline/);
  assert.match(filletEntities(line, [-15, 0], a, [-6, -3], 1e-7).error, /precision/);
});

function poly(pts, { legacy = false, closed = false, widths = false } = {}) {
  const e = W.lwpoly(pts, { closed, layer: 'Cut', aci: 3, width: 2 });
  e.r.v[e.r.c.indexOf(70)] = String(closed ? 129 : 128);
  e.r.c.push(38); e.r.v.push('7');
  if (widths) {
    for (let i = pts.length - 1; i >= 0; i--) {
      const k = e.r.c.map((c, k) => c === 20 ? k : -1).filter((k) => k >= 0)[i] + 1;
      e.r.c.splice(k, 0, 40, 41); e.r.v.splice(k, 0, String(i + 1), String(i + 2));
    }
  }
  if (!legacy) return e;
  const old = W.entity('POLYLINE', [[66, 1], [70, closed ? 129 : 128], [30, 7], [40, 3], [41, 4]], e);
  old.kids = pts.map((p, i) => ({ type: 'VERTEX', c: [10, 20, 30, 42, 40, 41, 70], v: [p[0], p[1], 0, p[2] || 0, i + 1, i + 2, 0].map(String) }));
  return old;
}
const records = (e) => e.type === 'POLYLINE' ? e.kids : (() => {
  const vs = [];
  e.r.c.forEach((c, k) => { if (c === 10) vs.push({ c: [], v: [] }); if (vs.length && [10, 20, 42, 40, 41].includes(c)) { vs.at(-1).c.push(c); vs.at(-1).v.push(e.r.v[k]); } });
  return vs;
})();
const widthsOf = (e) => records(e).map((r) => [40, 41].map((c) => r.c.includes(c) ? +r.v[r.c.indexOf(c)] : null));
const savedPoly = (e) => { const d = W.newDoc(4); W.addEntities(d, e); return readDxf(W.writeDxf(d)).entities[0]; };

test('Polyline option: closed and open corners, both windings, with saved tangent bulges and properties', () => {
  for (const closed of [false, true]) for (const winding of [1, -1]) {
    const e = poly([[0, 0], [20, 0], [20, winding * 20], [0, winding * 20]], { closed, widths: true });
    const before = structuredClone(e), f = filletAllPolyline(e, 2), out = savedPoly(f.ents[0]);
    assert.equal(f.count, closed ? 4 : 2); assert.equal(f.short, 0);
    const sh = filletPolylineShape(out), arcs = pathOf(sh).segs.filter((s) => s.bulge);
    assert.equal(sh.closed, closed); assert.equal(arcs.length, f.count);
    assert.equal(sh.pts.length, closed ? 8 : 6);
    for (const s of arcs) { near(s.bulge, winding * Math.tan(Math.PI / 8)); near(geo(s).r, 2); }
    assert.equal(out.layer, 'Cut'); assert.equal(value(out, 43), 2); assert.equal(value(out, 38), 7);
    assert.deepEqual(widthsOf(out).filter((_, i) => i % 2 === 0), closed ? [[1, 2], [2, 3], [3, 4], [4, 5]] : [[1, 2], [2, 3], [3, 4]]);
    assert.deepEqual(e, before);
  }
});

test('Polyline option in No trim leaves the polyline alone and adds one ARC per corner (AutoCAD)', () => {
  for (const [closed, corners] of [[true, 4], [false, 2]]) {
    const e = poly([[0, 0], [20, 0], [20, 20], [0, 20]], { closed }), f = filletAllPolyline(e, 2, false);
    assert.equal(f.count, corners); assert.equal(f.ents[0], e); assert.equal(f.ents.length, corners + 1);
    for (const a of f.ents.slice(1)) { assert.equal(a.type, 'ARC'); near(value(a, 40), 2); }
  }
  const one = filletAllPolyline(poly([[0, 0], [20, 0], [20, 20]]), 2, false);
  assert.equal(one.count, 1); assert.equal(one.ents.length, 2);
});

test('Polyline option skips short corners and prevents adjacent fillets from consuming a shared segment', () => {
  const f = filletAllPolyline(poly([[0, 0], [20, 0], [20, 1], [40, 1], [40, 20]]), 2);
  assert.equal(f.count, 1); assert.equal(f.short, 2);
  assert.equal(filletPolylineShape(f.ents[0]).pts.filter((p) => p[2]).length, 1);
  const g = filletAllPolyline(poly([[0, 0], [20, 0], [20, 3], [40, 3]]), 2);
  assert.equal(g.count, 1); assert.equal(g.short, 1);
  assert.match(filletAllPolyline(poly([[0, 0], [1, 0]]), -1).error, /0 or more/);
  assert.match(filletAllPolyline(W.line(0, 0, 10, 0), 1).error, /LWPOLYLINE/);
});

test('Polyline option replaces arcs between straight segments and radius zero restores sharp corners', () => {
  for (const closed of [false, true]) {
    const e = poly([[0, 0], [20, 0], [20, 20], [0, 20]], { closed });
    const rounded = filletAllPolyline(e, 2).ents[0];
    const again = filletAllPolyline(savedPoly(rounded), 3);
    assert.equal(again.count, closed ? 4 : 2); assert.equal(again.short, 0);
    const sh = filletPolylineShape(savedPoly(again.ents[0]));
    assert.equal(sh.pts.length, closed ? 8 : 6);
    for (const s of pathOf(sh).segs.filter((s) => s.bulge)) near(geo(s).r, 3);
    const sharp = filletAllPolyline(rounded, 0);
    assert.equal(sharp.count, closed ? 4 : 2); assert.equal(sharp.short, 0);
    assert.deepEqual(filletPolylineShape(savedPoly(sharp.ents[0])), filletPolylineShape(e));
    assert.equal(filletAllPolyline(e, 0).ents[0], e, 'already sharp adds no edit');
  }
  const untouched = poly([[0, 0, .5], [10, 0, .5], [20, 0]]);
  assert.equal(filletAllPolyline(untouched, 2).ents[0], untouched, 'arcs without two flanking lines stay');
});

test('Polyline option keeps arcs between diverging lines and still replaces converging ones', () => {
  for (const winding of [1, -1]) {
    const slot = poly([[0, -10], [50, -5, 1], [50, 5], [0, 10, 1]]
      .map(([x, y, b = 0]) => [x, y * winding, b * winding]), { closed: true });
    const before = structuredClone(slot), f = filletAllPolyline(slot, 2);
    assert.equal(f.count, 1); assert.equal(f.short, 0);
    const sh = filletPolylineShape(savedPoly(f.ents[0]));
    assert.deepEqual([sh.pts[0], sh.pts.at(-1)], [[0, -10 * winding, 0], [0, 10 * winding, winding]]);
    const arcs = pathOf(sh).segs.filter((s) => s.bulge);
    assert.equal(arcs.length, 2); near(geo(arcs[0]).r, 2); near(arcs[1].bulge, winding);
    assert.deepEqual(slot, before);
    const keyhole = poly([[10, -5], [0, -10, 1], [0, 10], [10, 5]]
      .map(([x, y, b = 0]) => [x, y * winding, b * winding]));
    const g = filletAllPolyline(keyhole, 2);
    assert.equal(g.count, 0); assert.equal(g.short, 0); assert.equal(g.ents[0], keyhole);
    const oversized = filletAllPolyline(keyhole, 20);
    assert.equal(oversized.count, 0); assert.equal(oversized.short, 0); assert.equal(oversized.ents[0], keyhole);
  }
});

test('No trim keeps the picked lines or arcs and adds only the fillet arc', () => {
  const a = W.line(0, 0, 10, 0), b = W.line(10, 0, 10, 10);
  const f = filletEntities(a, [5, 0], b, [10, 5], 2, false);
  assert.equal(f.ents[0], a); assert.equal(f.ents[1], b); assert.equal(f.ents[2].type, 'ARC');
  assert.deepEqual(filletEntities(a, [5, 0], b, [10, 5], 0, false).ents, [a, b]);
  const arc = W.arc(3, 5, 10, 180, 360), line = W.line(-20, 0, 20, 0);
  const g = filletEntities(line, [-15, 0], arc, [-6, -3], 2, false);
  assert.equal(g.ents[0], line); assert.equal(g.ents[1], arc); assert.equal(g.ents[2].type, 'ARC');
});

test('No trim on adjacent polyline segments keeps the source and adds a standalone arc in drawing coordinates', () => {
  for (const legacy of [false, true]) for (const flip of [1, -1]) {
    const e = poly([[0, 0], [10, 0], [10, 10]], { legacy });
    e.r.c.push(210, 220, 230); e.r.v.push('0', '0', String(flip));
    const f = filletEntities(e, [5 * flip, 0], e, [10 * flip, 5], 2, false);
    assert.equal(f.ents[0], e); assert.equal(f.ents.length, 2); assert.equal(f.ents[1].type, 'ARC');
    const arc = shapeOf(savedPoly(f.ents[1]));
    pt(arc.c, [8 * flip, 2]); close(arc.r, 2);
    pt(end(arc, arc.a0), flip > 0 ? [8, 0] : [-10, 2]);
    pt(end(arc, arc.a1), flip > 0 ? [10, 2] : [-8, 0]);
  }
});

test('open polyline: one entity, tangent vertex pair, other bulges, widths, flags and elevation survive Save', () => {
  for (const legacy of [false, true]) for (const reverse of [false, true]) {
    const e = poly([[0, 0], [10, 0], [10, 10, .25], [20, 10]], { legacy, widths: true }), before = structuredClone(e);
    const picks = reverse ? [[10, 5], [5, 0]] : [[5, 0], [10, 5]];
    const f = filletEntities(e, picks[0], e, picks[1], 2);
    assert.equal(f.ents.length, 1); const out = f.ents[0], pts = filletPolylineShape(out).pts;
    assert.equal(out.type, e.type); assert.equal(out.layer, 'Cut'); assert.equal(out.aci, 3);
    assert.equal(pts.length, 5); pt(pts[1], [8, 0]); pt(pts[2], [10, 2]); close(pts[1][2], Math.tan(Math.PI / 8));
    assert.deepEqual(pts.slice(3), [[10, 10, .25], [20, 10, 0]]);
    assert.deepEqual(widthsOf(out), [[1, 2], reverse ? [2, 3] : [1, 2], [2, 3], [3, 4], [4, 5]]);
    assert.equal(value(out, 70), 128); assert.equal(value(out, legacy ? 30 : 38), 7);
    if (!legacy) assert.equal(value(out, 43), 2);
    const saved = savedPoly(out); assert.equal(filletPolylineShape(saved).pts.length, 5); near(filletPolylineShape(saved).pts[1][2], Math.tan(Math.PI / 8));
    assert.deepEqual(widthsOf(saved), widthsOf(out)); assert.equal(value(saved, 70), 128);
    assert.deepEqual(e, before);
  }
});

test('closed polylines: closing segment meets both neighbours in either winding and pick order', () => {
  for (const legacy of [false, true]) for (const winding of [1, -1]) for (const reverse of [false, true]) {
    const e = poly([[0, 0], [10, 0], [10, winding * 10], [0, winding * 10]], { legacy, closed: true });
    for (const neighbour of [[5, 0], [5, winding * 10]]) {
      const picks = [[0, winding * 5], neighbour]; if (reverse) picks.reverse();
      const f = filletEntities(e, picks[0], e, picks[1], 2), out = savedPoly(f.ents[0]);
      const sh = filletPolylineShape(out), arcs = sh.pts.filter((p) => p[2]);
      assert.equal(sh.closed, true); assert.equal(sh.pts.length, 5); assert.equal(value(out, 70), 129);
      assert.equal(arcs.length, 1); near(arcs[0][2], winding * Math.tan(Math.PI / 8));
      near(geo(pathOf(sh).segs.find((s) => s.bulge)).r, 2);
    }
  }
});

test('bulged neighbours: trim line/arc and arc/arc in both directions, with tangent joins', () => {
  for (const bulges of [[0, .5], [.5, 0], [.5, -.5], [-.5, .5], [2, -.5]]) for (const direction of [1, -1]) {
    const e = poly([[0, 0, bulges[0] * direction], [10, 0, bulges[1] * direction], [10, direction * 10]]);
    const P = pathOf(filletPolylineShape(e));
    const mid = (s) => { const g = geo(s); return g.line ? [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2] : end({ ...g, a0: g.a0 * 180 / Math.PI }, (g.a0 + g.sw / 2) * 180 / Math.PI); };
    const p = P.segs.map(mid), f = filletEntities(e, p[0], e, p[1], .5);
    assert.ok(f.ents, JSON.stringify({ bulges, direction, error: f.error }));
    const out = pathOf(filletPolylineShape(f.ents[0])), g = out.segs.map(geo), arc = g[1]; close(arc.r, .5);
    for (const k of [0, 2]) {
      const tip = k ? out.segs[2].a : out.segs[0].b, radial = tip.map((v, i) => v - arc.c[i]);
      const v = g[k].line ? g[k].u : [-(tip[1] - g[k].c[1]), tip[0] - g[k].c[0]];
      near((v[0] * radial[0] + v[1] * radial[1]) / Math.hypot(...v), 0);
      if (!g[k].line) { close(g[k].r, geo(P.segs[k ? 1 : 0]).r); assert.ok(Math.abs(g[k].sw) < Math.abs(geo(P.segs[k ? 1 : 0]).sw)); }
    }
    const reversed = filletEntities(e, p[1], e, p[0], .5); assert.deepEqual(filletPolylineShape(reversed.ents[0]), filletPolylineShape(f.ents[0]));
  }
});

test('polyline refusals and radius zero change no input', () => {
  const e = poly([[0, 0], [10, 0], [10, 10], [0, 10]]), before = structuredClone(e);
  assert.match(filletEntities(e, [5, 0], e, [5, 10], 2).error, /adjacent/);
  assert.match(filletEntities(e, [5, 0], e, [6, 0], 2).error, /adjacent/);
  for (const other of [W.line(10, 0, 10, 10), W.arc(10, 5, 5, 270, 90), structuredClone(e)]) assert.match(filletEntities(e, [5, 0], other, [10, 5], 2).error, /same polyline/);
  for (const r of [10, 1000]) assert.match(filletEntities(e, [5, 0], e, [10, 5], r).error, /too big/);
  assert.match(filletEntities(e, [5, 0], e, [10, 5], 1e-7).error, /precision/);
  for (const b of [.5, -.5]) { const curved = poly([[0, 0, b], [10, 0], [10, 10]]); assert.match(filletEntities(curved, [5, -b * 5], curved, [10, 5], 1000).error, /too big/); }
  for (const r of [-1, NaN, Infinity]) assert.match(filletEntities(e, [5, 0], e, [10, 5], r).error, /0 or more/);
  assert.deepEqual(filletEntities(e, [5, 0], e, [10, 5], 0).ents, [e]); assert.deepEqual(e, before);
  const tilted = structuredClone(e); tilted.r.c.push(210); tilted.r.v.push('1'); assert.match(filletEntities(tilted, [5, 0], tilted, [10, 5], 2).error, /drawing plane/);
});

test('two-vertex closed polyline: picks choose either shared endpoint, including reversed picks', () => {
  for (const legacy of [false, true]) for (const x of [2, 8]) {
    const e = poly([[0, 0], [10, 0, 1]], { closed: true, legacy });
    for (const picks of [[[x, 0], [x, 2]], [[x, 2], [x, 0]]]) {
      const f = filletEntities(e, picks[0], e, picks[1], 1);
      assert.ok(f.ents, f.error); const sh = filletPolylineShape(savedPoly(f.ents[0]));
      assert.equal(sh.closed, true); assert.equal(sh.pts.length, 3);
      const arcs = pathOf(sh).segs.filter((s) => s.bulge).map(geo);
      assert.equal(arcs.length, 2); near(Math.min(...arcs.map((g) => g.r)), 1); near(Math.max(...arcs.map((g) => g.r)), 5);
      assert.ok(sh.pts.some((p) => p[0] === (x < 5 ? 10 : 0) && p[1] === 0), 'the other corner stays');
    }
  }
});

test('OCS -Z polylines solve and preview in drawing coordinates without changing the source frame', () => {
  for (const legacy of [false, true]) {
    const e = poly([[0, 0, .5], [10, 0], [10, 10]], { legacy });
    const mirrored = structuredClone(e); mirrored.r.c.push(210, 220, 230); mirrored.r.v.push('0', '0', '-1');
    const a = filletEntities(e, [5, -2.5], e, [10, 5], 1).ents[0];
    const b = filletEntities(mirrored, [-5, -2.5], mirrored, [-10, 5], 1).ents[0];
    assert.equal(value(b, 230), -1);
    const expected = filletPolylineShape(a, 2).pts.map((p) => [-p[0], p[1], -p[2]]);
    assert.deepEqual(filletPolylineShape(b, 2).pts, expected);
    assert.equal(savedPoly(b).flip, true);
  }
});
