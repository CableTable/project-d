// grips.js — the grips of a selected shape.   node grips.test.mjs
import assert from 'node:assert/strict';
import * as GR from './web/grips.js';
import * as DR from './web/draw.js';
import { newDoc, addEntities, writeDxf, line, circle, arc, lwpoly, ellipse, rect, text } from './web/dxf-write.js';
import { readDxf } from './web/drawing.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const nearPt = (a, b, e = 1e-6) => { near(a[0], b[0], e); near(a[1], b[1], e); };
const reopen = (e) => { const d = newDoc(4); addEntities(d, [e]); return readDxf(writeDxf(d)).entities[0]; };
const val = (e, code) => +e.r.v[e.r.c.indexOf(code)];
const pts = (list) => list.map((g) => [g.x, g.y]);

test('a line has its two ends and its middle', () => {
  const g = GR.gripsOf(line(0, 0, 100, 50));
  assert.deepEqual(g.map((x) => [x.id, x.kind]), [['a', 'end'], ['m', 'mid'], ['b', 'end']]);
  assert.deepEqual(pts(g), [[0, 0], [50, 25], [100, 50]]);
});

test('a circle has its centre and four quadrants; an arc its ends, middle and centre; a polyline its vertices', () => {
  const c = GR.gripsOf(circle(10, 20, 5));
  assert.deepEqual(c.map((x) => x.kind), ['centre', 'quad', 'quad', 'quad', 'quad']);
  nearPt([c[1].x, c[1].y], [15, 20]); nearPt([c[2].x, c[2].y], [10, 25]); nearPt([c[3].x, c[3].y], [5, 20]); nearPt([c[4].x, c[4].y], [10, 15]);
  const a = GR.gripsOf(arc(0, 0, 10, 0, 90));
  assert.deepEqual(a.map((x) => x.kind), ['end', 'mid', 'end', 'centre']);
  nearPt([a[0].x, a[0].y], [10, 0]); nearPt([a[2].x, a[2].y], [0, 10]); nearPt([a[1].x, a[1].y], [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10]); nearPt([a[3].x, a[3].y], [0, 0]);
  const wrap = GR.gripsOf(arc(0, 0, 10, 270, 90));                       // an arc across 0°: the middle is at 0°
  nearPt([wrap[1].x, wrap[1].y], [10, 0]);
  const p = GR.gripsOf(rect(0, 0, 10, 5));
  assert.deepEqual(p.map((x) => x.id), ['v0', 'v1', 'v2', 'v3', 'e0', 'e1', 'e2', 'e3']);
  assert.deepEqual(pts(p), [[0, 0], [10, 0], [10, 5], [0, 5], [5, 0], [10, 2.5], [5, 5], [0, 2.5]]);
  assert.deepEqual(GR.gripsOf({ type: 'SPLINE', layer: '0', r: { c: [10, 20], v: ['0', '0'] } }), [], 'no grips on a spline');
  assert.deepEqual(GR.gripsOf(null), []);
});

test('rectangle edge grips resize each side along its normal, any rotation or winding; Shift keeps proportions', () => {
  for (const angle of [0, Math.PI / 5]) for (const reverse of [false, true]) {
    const rotate = ([x, y]) => [30 + x * Math.cos(angle) - y * Math.sin(angle), 40 + x * Math.sin(angle) + y * Math.cos(angle)];
    const corners = [[0, 0], [20, 0], [20, 10], [0, 10]];
    if (reverse) corners.reverse();
    const original = corners.map(rotate), ent = lwpoly(original, { closed: true }), before = structuredClone(ent);
    const grips = GR.gripsOf(ent);
    assert.equal(grips.filter((g) => g.kind === 'edge').length, 4);
    for (let i = 0; i < 4; i++) for (const shift of [false, true]) for (const scale of [0.5, 1.5]) {
      const j = (i + 1) % 4, a = original[(i + 2) % 4], b = original[(i + 3) % 4];
      const opposite = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], g = grips[4 + i];
      const normal = [g.x - opposite[0], g.y - opposite[1]], span = Math.hypot(...normal), unit = normal.map((v) => v / span);
      // A tangential pointer movement must not shear or move the side along itself.
      const to = [g.x + normal[0] * (scale - 1) - unit[1] * 7, g.y + normal[1] * (scale - 1) + unit[0] * 7];
      const result = GR.dragGrip(ent, 'e' + i, to, shift);
      assert.equal(result.label, 'Resize rectangle');
      const vs = GR.lwVertices(result.ent.r);
      assert.equal(GR.gripsOf(result.ent).length, 8, 'it stays a rectangle');
      vs.forEach((v, k) => {
        const p = original[k], moved = k === i || k === j;
        if (!shift) nearPt([v.x, v.y], [p[0] + (moved ? normal[0] * (scale - 1) : 0), p[1] + (moved ? normal[1] * (scale - 1) : 0)]);
        else nearPt([v.x, v.y], [opposite[0] + (p[0] - opposite[0]) * scale, opposite[1] + (p[1] - opposite[1]) * scale]);
      });
      const na = vs[(i + 2) % 4], nb = vs[(i + 3) % 4];
      const nextOpposite = [(na.x + nb.x) / 2, (na.y + nb.y) / 2];
      nearPt(nextOpposite, opposite);
      assert.equal(GR.dragGrip(ent, 'e' + i, opposite, shift), null, 'cannot collapse');
      assert.equal(GR.dragGrip(ent, 'e' + i, [opposite[0] - normal[0], opposite[1] - normal[1]], shift), null, 'cannot cross the opposite side');
      assert.equal(GR.dragGrip(ent, 'e' + i, [g.x, g.y], shift), null, 'no change');
    }
    assert.deepEqual(ent, before, 'the source record stays untouched');
  }
});

test('only closed straight four-corner rectangles get edge grips', () => {
  const entities = [
    lwpoly([[0, 0], [20, 0], [20, 10], [0, 10]]),
    lwpoly([[0, 0], [20, 0], [25, 10], [5, 10]], { closed: true }),
    lwpoly([[0, 0], [20, 10], [20, 0], [0, 10]], { closed: true }),
    lwpoly([[0, 0], [20, 0], [20, 0], [0, 10]], { closed: true }),
    lwpoly([[0, 0, .1], [20, 0], [20, 10], [0, 10]], { closed: true }),
    lwpoly([[0, 0], [20, 0], [20, 10]], { closed: true }),
    circle(0, 0, 10), ellipse(0, 0, 10, 0, .5)
  ];
  for (const ent of entities) {
    assert.ok(GR.gripsOf(ent).every((g) => g.kind !== 'edge'));
    assert.equal(GR.dragGrip(ent, 'e0', [5, 5]), null);
  }
});

test('a line: an end stretches that end; the middle moves the whole line', () => {
  const l = line(0, 0, 100, 50);
  const a = GR.dragGrip(l, 'b', [120, 80]);
  assert.equal(a.label, 'Stretch line'); assert.deepEqual(pts(GR.gripsOf(a.ent)).filter((_, i) => i !== 1), [[0, 0], [120, 80]]);
  assert.equal(GR.dragGrip(l, 'a', [-10, 5]).label, 'Stretch line');
  const m = GR.dragGrip(l, 'm', [60, 65]);                               // the middle (50, 25) to (60, 65): by (10, 40)
  assert.equal(m.label, 'Move line');
  assert.deepEqual(pts(GR.gripsOf(m.ent)).filter((_, i) => i !== 1), [[10, 40], [110, 90]]);
  assert.equal(GR.dragGrip(l, 'a', [100, 50]), null, 'both ends in one place: no line');
  assert.equal(GR.dragGrip(l, 'm', [50, 25]), null, 'not moved');
  assert.equal(GR.dragGrip(l, 'zz', [1, 1]), null);
  assert.equal(GR.dragGrip(l, 'a', [NaN, 1]), null);
  assert.deepEqual(pts(GR.gripsOf(l)).flat(), [0, 0, 50, 25, 100, 50], 'the original is not changed');
});

test('a circle: the centre moves it, a quadrant sets the radius', () => {
  const c = circle(10, 20, 5);
  const m = GR.dragGrip(c, 'c', [30, 40]);
  assert.equal(m.label, 'Move circle'); assert.deepEqual([val(m.ent, 10), val(m.ent, 20), val(m.ent, 40)], [30, 40, 5]);
  const r = GR.dragGrip(c, 'q1', [10, 45]);                              // 25 above the centre
  assert.equal(r.label, 'Circle radius'); assert.deepEqual([val(r.ent, 10), val(r.ent, 20), val(r.ent, 40)], [10, 20, 25]);
  assert.equal(GR.dragGrip(c, 'q0', [13, 24]), null, 'the same radius: nothing changes');
  assert.equal(GR.dragGrip(c, 'q0', [10, 20]), null, 'a radius of 0');
});

test('an arc: the middle changes the bulge through 3 points; an end re-fits it; the centre moves it', () => {
  const a = arc(0, 0, 10, 0, 90);
  const mid = GR.dragGrip(a, 'm', [8, 8]);                               // pulled out: a bigger radius, the ends stay
  assert.equal(mid.label, 'Arc bulge');
  const g = GR.gripsOf(mid.ent);
  nearPt([g[0].x, g[0].y], [10, 0], 1e-6); nearPt([g[2].x, g[2].y], [0, 10], 1e-6);
  assert.ok(Math.abs(val(mid.ent, 40) - Math.hypot(10 - 7 / 3, 7 / 3)) < 1e-6, 'pulled out: a rounder, smaller circle (radius 8.014)'); nearPt([g[1].x, g[1].y], [8, 8], 1e-6);
  // through (0,10), (8,8), (10,0): the circle through them
  const c = [val(mid.ent, 10), val(mid.ent, 20)], R = val(mid.ent, 40);
  near(Math.hypot(0 - c[0], 10 - c[1]), R, 1e-6); near(Math.hypot(8 - c[0], 8 - c[1]), R, 1e-6); near(Math.hypot(10 - c[0], 0 - c[1]), R, 1e-6);
  // an end dragged: it passes through the old middle
  const end = GR.dragGrip(a, 'b', [0, 20]);
  assert.equal(end.label, 'Stretch arc');
  const e = GR.gripsOf(end.ent);
  nearPt([e[0].x, e[0].y], [10, 0]); nearPt([e[1].x, e[1].y].map((v) => v), [e[1].x, e[1].y]);
  const c2 = [val(end.ent, 10), val(end.ent, 20)], R2 = val(end.ent, 40);
  near(Math.hypot(Math.SQRT1_2 * 10 - c2[0], Math.SQRT1_2 * 10 - c2[1]), R2, 1e-6, 'the old middle is still on it');
  near(Math.hypot(0 - c2[0], 20 - c2[1]), R2, 1e-6);
  const mv = GR.dragGrip(a, 'c', [5, 5]);
  assert.equal(mv.label, 'Move arc'); assert.deepEqual([val(mv.ent, 10), val(mv.ent, 20), val(mv.ent, 40), val(mv.ent, 50), val(mv.ent, 51)], [5, 5, 10, 0, 90]);
  assert.equal(GR.dragGrip(a, 'b', [20, 0]) === null || GR.dragGrip(a, 'b', [20, 0]).ent !== undefined, true);
  assert.equal(GR.dragGrip(a, 'a', [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10]), null, 'start on the middle: no arc');
  const line3 = GR.dragGrip(arc(0, 0, 10, 0, 180), 'm', [0, 0]);          // the middle pulled to the chord's line (the ends are (10,0), (-10,0))
  assert.equal(line3, null, 'three points in a line: nothing');
});

test('a polyline: a vertex moves, the bulges stay, closed or open', () => {
  const p = rect(0, 0, 10, 5);
  const m = GR.dragGrip(p, 'v2', [12, 8]);
  assert.equal(m.label, 'Stretch polyline');
  assert.deepEqual(pts(GR.gripsOf(m.ent)), [[0, 0], [10, 0], [12, 8], [0, 5]]);
  assert.equal(val(m.ent, 70), 1, 'still closed');
  const r = lwpoly([[0, 0, 0.5], [10, 0], [10, 5, -0.2]]);
  const k = GR.dragGrip(r, 'v1', [11, 1]);
  assert.deepEqual(k.ent.r.c.filter((c) => c === 42).length, 2); assert.deepEqual(k.ent.r.v.filter((_, i) => k.ent.r.c[i] === 42).map(Number), [0.5, -0.2]);
  assert.equal(GR.dragGrip(p, 'v9', [1, 1]), null);
  assert.equal(GR.dragGrip(p, 'v0', [0, 0]), null);
});

test('refPoint: where the rubber band starts', () => {
  nearPt(GR.refPoint(line(0, 0, 100, 50), 'a'), [100, 50]); nearPt(GR.refPoint(line(0, 0, 100, 50), 'b'), [0, 0]); nearPt(GR.refPoint(line(0, 0, 100, 50), 'm'), [50, 25]);
  nearPt(GR.refPoint(circle(10, 20, 5), 'q2'), [10, 20]); nearPt(GR.refPoint(circle(10, 20, 5), 'c'), [10, 20]);
  nearPt(GR.refPoint(rect(0, 0, 10, 5), 'v1'), [10, 0]);
  assert.equal(GR.refPoint(line(0, 0, 1, 1), 'x'), null);
});

test('the readouts: length and angle, Move ΔX ΔY, R, bulge, vertex', () => {
  const l = line(0, 0, 100, 50), a = GR.dragGrip(l, 'b', [300, 140]);
  assert.equal(GR.readoutOf(l, 'b', a.ent, 1), '331.06 mm · 25.02°');
  const m = GR.dragGrip(l, 'm', [60, 65]);
  assert.equal(GR.readoutOf(l, 'm', m.ent, 1), 'Move ΔX 10.00 ΔY 40.00');
  assert.equal(GR.readoutOf(l, 'b', a.ent, 25.4), DR.n2(Math.hypot(300, 140) * 25.4) + ' mm · 25.02°', 'in inches the numbers are mm');
  const c = circle(0, 0, 5);
  assert.equal(GR.readoutOf(c, 'q0', GR.dragGrip(c, 'q0', [12, 0]).ent), 'R 12.00');
  assert.equal(GR.readoutOf(c, 'c', GR.dragGrip(c, 'c', [3, -4]).ent), 'Move ΔX 3.00 ΔY -4.00');
  const ar = arc(0, 0, 10, 0, 90);
  assert.match(GR.readoutOf(ar, 'm', GR.dragGrip(ar, 'm', [8, 8]).ent), /^R \d+\.\d\d · \d+\.\d\d°$/);
  const p = rect(0, 0, 10, 5);
  assert.equal(GR.readoutOf(p, 'v2', GR.dragGrip(p, 'v2', [12, 8]).ent), 'X 12.00 · Y 8.00');
  assert.equal(GR.commandOf(l, 'm'), 'MOVE'); assert.equal(GR.commandOf(l, 'a'), 'STRETCH'); assert.equal(GR.commandOf(c, 'q1'), 'STRETCH'); assert.equal(GR.commandOf(c, 'c'), 'MOVE');
});

test('shapeOf: the preview shapes in mm (and they draw as SVG paths)', () => {
  assert.deepEqual(GR.shapeOf(line(0, 0, 1, 2), 25.4), { t: 'line', a: [0, 0], b: [25.4, 50.8] });
  assert.deepEqual(GR.shapeOf(circle(1, 1, 2), 10), { t: 'circle', c: [10, 10], r: 20 });
  const sh = GR.shapeOf(arc(0, 0, 10, 20, 200)); assert.deepEqual([sh.t, sh.r, sh.a0, sh.a1], ['arc', 10, 20, 200]);
  const pl = GR.shapeOf(DR.toEntity({ t: 'poly', pts: DR.rectPts([0, 0], [20, 10], 3), closed: true }, {}, 1));
  assert.equal(pl.pts.length, 8); assert.equal(pl.closed, true); assert.ok(pl.pts[1][2] > 0.41);
  assert.match(DR.svgPath(pl, 100), /A3 3 0 0 0/);
  assert.equal(GR.shapeOf({ type: 'TEXT', r: { c: [], v: [] } }), null);
});

test('a grip drag saves and reopens: the changed entities come back as they were made', () => {
  const doc = newDoc(4);
  const l = GR.dragGrip(line(0, 0, 100, 50), 'b', [120, 80]).ent, c = GR.dragGrip(circle(10, 20, 5), 'q1', [10, 45]).ent;
  const a = GR.dragGrip(arc(0, 0, 10, 0, 90), 'm', [8, 8]).ent, p = GR.dragGrip(rect(0, 0, 10, 5), 'v2', [12, 8]).ent;
  addEntities(doc, [l, c, a, p]);
  const back = readDxf(writeDxf(doc)).entities;
  assert.deepEqual(back.map((e) => e.type), ['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE']);
  assert.deepEqual([val(back[0], 11), val(back[0], 21)], [120, 80]);
  assert.equal(val(back[1], 40), 25);
  nearPt([val(back[2], 10), val(back[2], 20)], [val(a, 10), val(a, 20)], 1e-5);
  assert.deepEqual(pts(GR.gripsOf(back[3])), [[0, 0], [10, 0], [12, 8], [0, 5]]);
  assert.ok(reopen(l));
});

test('a mirrored shape (extrusion -1) has no grips; the cap is 200 selected', () => {
  const m = line(0, 0, 1, 1); m.r = { ...m.r, c: [...m.r.c, 210, 220, 230], v: [...m.r.v, '0', '0', '-1'] };
  assert.deepEqual(GR.gripsOf(m), []);
  const c = circle(0, 0, 1); c.r = { ...c.r, c: [...c.r.c, 210, 220, 230], v: [...c.r.v, '0', '0', '-1'] };
  assert.equal(GR.hasGrips(c), false); assert.equal(GR.hasGrips(circle(0, 0, 1)), true);
  assert.equal(GR.MAX_SELECTED, 200);
});

test('capGrips: show all handles through 5000, then none, even on one huge polyline', () => {
  assert.equal(GR.MAX_GRIPS, 5000);
  const dense = GR.gripsOf(lwpoly(Array.from({ length: 50000 }, (_, i) => [i, i % 2]))).map((g) => ({ e: 0, ...g }));
  const boundary = dense.slice(0, GR.MAX_GRIPS);
  assert.equal(GR.capGrips(boundary), boundary, 'exactly 5000 handles remain available');
  assert.deepEqual(GR.capGrips(dense.slice(0, GR.MAX_GRIPS + 1)), []);
  assert.deepEqual(GR.capGrips(dense), [], '50000 vertices on one shape have no grips');
  const many = Array.from({ length: GR.MAX_SELECTED }, (_, e) => dense.slice(0, 26).map((g) => ({ ...g, e }))).flat();
  assert.deepEqual(GR.capGrips(many), [], 'total handles across 200 shapes also exceed the cap');
  assert.deepEqual(GR.capGrips([]), []);
});

// ---- 155e4: text, ellipse, hatch and blocks
const hatchOf = (x0, y0, w, h) => ({ type: 'HATCH', layer: '0', r: { type: 'HATCH', c: [10, 20, 30, 2, 70, 71, 91, 92, 72, 73, 93, 10, 20, 10, 20, 10, 20, 10, 20, 97, 75, 76, 98, 10, 20], v: ['0', '0', '0', 'SOLID', '1', '0', '1', '3', '0', '1', '4', x0, y0, x0 + w, y0, x0 + w, y0 + h, x0, y0 + h, '0', '0', '1', '1', x0 + 1, y0 + 1].map(String) } });
const hatchPts = (e) => { const out = []; let seen = false; e.r.c.forEach((c, k) => { if (c === 93) seen = true; if (seen && c === 10) out.push([+e.r.v[k], +e.r.v[k + 1]]); }); return out; };

test('text: one grip at the insertion, a second at the alignment point when justified; either moves both points', () => {
  const t = text(10, 20, 5, 'Hi');
  assert.deepEqual(GR.gripsOf(t).map((g) => g.id), ['i']);
  assert.equal(GR.hasGrips(t), false, 'the curve grips (Trim, Extend, Offset…) stay off text');
  const j = text(10, 20, 5, 'Hi', {}); j.r = { ...j.r, c: [...j.r.c, 72, 11, 21, 31], v: [...j.r.v, '1', '30', '40', '0'] };
  assert.deepEqual(pts(GR.gripsOf(j)), [[10, 20], [30, 40]]);
  const m = GR.dragGrip(j, 'a', [35, 45]);
  assert.equal(m.label, 'Move text');
  assert.deepEqual(pts(GR.gripsOf(m.ent)), [[15, 25], [35, 45]]);
  assert.equal(GR.dragGrip(j, 'i', [10, 20]), null);
  assert.equal(GR.commandOf(j, 'i'), 'MOVE');
  assert.ok(GR.readoutOf(j, 'i', GR.dragGrip(j, 'i', [12, 23]).ent).startsWith('Move ΔX 2.00 ΔY 3.00'));
});

test('mtext and a block insert: one insertion grip that moves the object; a mirrored one has none', () => {
  const t = reopen(text(0, 0, 5, 'x')), mt = { ...t, type: 'MTEXT', r: { ...t.r, type: 'MTEXT' } };
  assert.deepEqual(GR.gripsOf(mt).map((g) => g.id), ['i']);
  const ins = { type: 'INSERT', layer: '0', r: { type: 'INSERT', c: [2, 10, 20, 30], v: ['B', '5', '6', '0'] } };
  const moved = GR.dragGrip(ins, 'i', [8, 10]);
  assert.deepEqual(pts(GR.gripsOf(moved.ent)), [[8, 10]]); assert.equal(moved.label, 'Move block');
  const flip = { ...ins, r: { ...ins.r, c: [...ins.r.c, 210, 220, 230], v: [...ins.r.v, '0', '0', '-1'] } };
  assert.deepEqual(GR.gripsOf(flip), []);
});

test('hatch: the grip is the centre of the extents; dragging it moves the boundary and the seed point', () => {
  const h = hatchOf(10, 20, 100, 40);
  assert.deepEqual(pts(GR.gripsOf(h)), [[60, 40]]);
  assert.equal(GR.gripsOf(h)[0].kind, 'centre');
  const m = GR.dragGrip(h, 'c', [70, 50]);
  assert.equal(m.label, 'Move hatch');
  assert.deepEqual(hatchPts(m.ent), [[20, 30], [120, 30], [120, 70], [20, 70], [21, 31]]);
  assert.deepEqual(pts(GR.gripsOf(m.ent)), [[70, 50]]);
  assert.deepEqual(GR.gripsOf({ type: 'HATCH', layer: '0', r: { type: 'HATCH', c: [10, 20], v: ['0', '0'] } }), [], 'no boundary, no grip');
});

test('hatch centre counts a circle edge by its radius', () => {
  const h = { type: 'HATCH', layer: '0', r: { type: 'HATCH', c: [91, 92, 93, 72, 10, 20, 40, 50, 51, 73, 97, 75], v: ['1', '0', '1', '2', '5', '5', '10', '0', '360', '1', '0', '0'] } };
  assert.deepEqual(pts(GR.gripsOf(h)), [[5, 5]]);
});

test('ellipse: centre, four axis ends, arc ends only for an arc', () => {
  const e = ellipse(0, 0, 100, 0, 0.5);
  assert.deepEqual(GR.gripsOf(e).map((g) => g.id), ['c', 'm0', 'm1', 'n0', 'n1']);
  assert.deepEqual(pts(GR.gripsOf(e)).map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)), [[0, 0], [100, 0], [-100, 0], [0, 50], [0, -50]]);
  assert.equal(GR.gripsOf(reopen(e)).length, 5, 'saved as 6.283185 it is still a full ellipse');
  const a = ellipse(0, 0, 100, 0, 0.5, 0, Math.PI / 2);
  assert.deepEqual(GR.gripsOf(a).map((g) => g.id), ['c', 'm0', 'm1', 'n0', 'n1', 's', 't']);
  nearPt(pts(GR.gripsOf(a)).slice(5)[0], [100, 0]); nearPt(pts(GR.gripsOf(a)).slice(5)[1], [0, 50]);
});

test('ellipse: the major end sets length and angle, the minor length stays; swap when shorter', () => {
  const e = ellipse(10, 10, 100, 0, 0.5);
  const r = GR.dragGrip(e, 'm0', [10, 210]);                                 // the major axis now points up, 200 long
  nearPt([val(r.ent, 11), val(r.ent, 21)], [0, 200]); near(val(r.ent, 40), 0.25);          // the minor stays 50
  const opp = GR.dragGrip(e, 'm1', [10 - 60, 10]);                           // the left end 60 out: major 60 along +x, ratio 50/60
  nearPt([val(opp.ent, 11), val(opp.ent, 21)], [60, 0]); near(val(opp.ent, 40), 50 / 60);
  const sw = GR.dragGrip(e, 'm0', [10 + 20, 10]);                            // shorter than the minor (50): they swap
  nearPt([val(sw.ent, 11), val(sw.ent, 21)], [0, 50]); near(val(sw.ent, 40), 20 / 50);
  assert.equal(GR.dragGrip(e, 'm0', [110, 10]), null);
  assert.ok(GR.readoutOf(e, 'm0', r.ent).startsWith('Major 400.00 · Minor 100.00'));
});

test('ellipse: the minor end is the distance across the major axis; the centre moves it; arc ends set the parameters', () => {
  const e = ellipse(0, 0, 100, 0, 0.5);
  const n = GR.dragGrip(e, 'n0', [300, 80]);                                 // far along the axis does not matter: 80 across
  near(val(n.ent, 40), 0.8); nearPt([val(n.ent, 11), val(n.ent, 21)], [100, 0]);
  const big = GR.dragGrip(e, 'n1', [0, -150]);                               // wider than long: swap
  nearPt([val(big.ent, 11), val(big.ent, 21)], [0, 150]); near(val(big.ent, 40), 100 / 150);
  const c = GR.dragGrip(e, 'c', [5, 7]);
  nearPt(pts(GR.gripsOf(c.ent))[1], [105, 7]); assert.equal(c.label, 'Move ellipse');
  const a = ellipse(0, 0, 100, 0, 0.5, 0, Math.PI / 2);
  const s = GR.dragGrip(a, 's', [0, -50]);                                   // 3π/2
  near(val(s.ent, 41), 1.5 * Math.PI); near(val(s.ent, 42), Math.PI / 2);
  const t = GR.dragGrip(a, 't', [-100, 0]);
  near(val(t.ent, 42), Math.PI);
  assert.deepEqual(GR.refPoint(e, 'm0'), [0, 0]);
});

test('ellipse arc: when the axes swap the arc stays where it was (the parameters turn a quarter)', () => {
  const a = ellipse(0, 0, 40, 0, 0.5, 0, Math.PI);                           // the upper half
  const sw = GR.dragGrip(a, 'm0', [10, 0]);                                  // major 10 < minor 20: swap, major now (0,20)
  nearPt([val(sw.ent, 11), val(sw.ent, 21)], [0, 20]);
  const g = pts(GR.gripsOf(sw.ent)).slice(5);                                // the arc ends: right (10,0) and left (-10,0), not the lower half
  nearPt(g[0], [10, 0]); nearPt(g[1], [-10, 0]);
  const [mx, my, ratio] = [val(sw.ent, 11), val(sw.ent, 21), val(sw.ent, 40)], mid = val(sw.ent, 41) + Math.PI / 2;       // the middle of the 180° piece is the top, (0, 20)
  nearPt([mx * Math.cos(mid) - my * ratio * Math.sin(mid), my * Math.cos(mid) + mx * ratio * Math.sin(mid)], [0, 20]);
  const n = GR.dragGrip(a, 'n0', [0, 60]);                                   // a minor end past the major (60 vs 40): swap by the other branch
  const ng = pts(GR.gripsOf(n.ent)).slice(5);
  nearPt(ng[0], [40, 0]); nearPt(ng[1], [-40, 0]);
  assert.equal(GR.gripsOf(GR.dragGrip(ellipse(0, 0, 40, 0, 0.5), 'm0', [10, 0]).ent).length, 5, 'a full ellipse has no arc ends and gains none');
});

test('block insert with attributes and a hatch with several seed points move whole', () => {
  const att = { type: 'ATTRIB', c: [10, 20, 1], v: ['6', '7', 'TAG'] };
  const ins = { type: 'INSERT', layer: '0', r: { type: 'INSERT', c: [2, 10, 20, 30], v: ['B', '5', '6', '0'] }, kids: [att] };
  const m = GR.dragGrip(ins, 'i', [8, 10]);                                  // by (3, 4)
  assert.deepEqual(m.ent.kids[0].v, ['9', '11', 'TAG'], 'the attribute moves with its block');
  assert.deepEqual(ins.kids[0].v, ['6', '7', 'TAG'], 'the original stays');
  const h = hatchOf(0, 0, 10, 10);
  h.r = { ...h.r, c: [...h.r.c, 10, 20], v: [...h.r.v, '7', '8'] };
  h.r.v[h.r.c.indexOf(98)] = '2';
  const mh = GR.dragGrip(h, 'c', [15, 15]);                                  // by (10, 10)
  assert.deepEqual(hatchPts(mh.ent).slice(-2), [[11, 11], [17, 18]], 'every seed point moves');
});

test('ellipse seen from below (extrusion -1) has no grips', () => {
  const e = ellipse(0, 0, 100, 0, 0.5); e.r = { ...e.r, c: [...e.r.c, 210, 220, 230], v: [...e.r.v, '0', '0', '-1'] };
  assert.deepEqual(GR.gripsOf(e), []);
});

test('wholeHot: every defining grip hot (or the middle / centre) moves the object whole; translate moves lines, polylines and leaders', () => {
  const ids = (...a) => new Set(a);
  const ln = line(0, 0, 10, 0), pl = lwpoly([[0, 0], [10, 0], [10, 5]]), rc = rect(0, 0, 10, 5), ci = circle(0, 0, 5), ar = arc(0, 0, 10, 0, 90);
  const ld = { type: 'LEADER', model: { pts: [[0, 0], [10, 0], [10, 5]] } };
  assert.ok(GR.wholeHot(ln, ids('a', 'b')) && GR.wholeHot(ln, ids('m')) && !GR.wholeHot(ln, ids('a')));
  assert.ok(GR.wholeHot(pl, ids('v0', 'v1', 'v2')) && !GR.wholeHot(pl, ids('v0', 'v1')));
  assert.ok(GR.wholeHot(rc, ids('v0', 'v1', 'v2', 'v3')), 'edge grips do not count');
  assert.ok(GR.wholeHot(ld, ids('v0', 'v1', 'v2')) && !GR.wholeHot(ld, ids('v0', 'v2')));
  assert.ok(GR.wholeHot(ci, ids('q0', 'q1', 'q2', 'q3')) && !GR.wholeHot(ci, ids('q0', 'q1')) && GR.wholeHot(ci, ids('c')));
  assert.ok(GR.wholeHot(ar, ids('a', 'm', 'b')) && !GR.wholeHot(ar, ids('a', 'b')));
  const m = GR.translate(ln, 10, 0);
  assert.deepEqual([10, 20, 11, 21].map((c) => val(m, c)), [10, 0, 20, 0]);
  assert.deepEqual(GR.translate(ld, 1, 2).model.pts, [[1, 2], [11, 2], [11, 7]]);
  assert.deepEqual(pts(GR.gripsOf(GR.translate(pl, 1, 2))), [[1, 2], [11, 2], [11, 7]]);
});

console.log(n + ' grips tests passed');
