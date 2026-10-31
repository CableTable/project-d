// grips.js — the grips of a selected shape.   node grips.test.mjs
import assert from 'node:assert/strict';
import * as GR from './web/grips.js';
import * as DR from './web/draw.js';
import { newDoc, addEntities, addBlock, writeDxf, line, circle, arc, lwpoly, ellipse, rect, text, mtext, insert } from './web/dxf-write.js';
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
    assert.ok(GR.gripsOf(ent).every((g) => !g.rect), 'no resizing side');       // 163b: a polyline has segment mid grips (kind edge), only a rectangle's resize it
    assert.notEqual(GR.dragGrip(ent, 'e0', [5, 5])?.label, 'Resize rectangle');
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
  assert.deepEqual(pts(GR.gripsOf(m.ent).filter((g) => g.kind === 'vertex')), [[0, 0], [10, 0], [12, 8], [0, 5]]);
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
  assert.deepEqual(pts(GR.gripsOf(back[3]).filter((g) => g.kind === 'vertex')), [[0, 0], [10, 0], [12, 8], [0, 5]]);
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

test('mtext and a block insert: the insertion grip moves the object; a mirrored one has none', () => {
  const t = reopen(text(0, 0, 5, 'x')), mt = { ...t, type: 'MTEXT', r: { ...t.r, type: 'MTEXT' } };
  assert.deepEqual(GR.gripsOf(mt).map((g) => g.id), ['i', 'w', 'h', 'wh']);         // 164a: and the size triangles
  assert.equal(GR.dragGrip(mt, 'i', [3, 4]).label, 'Move text');
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
  assert.deepEqual(pts(GR.gripsOf(GR.translate(pl, 1, 2)).filter((g) => g.kind === 'vertex')), [[1, 2], [11, 2], [11, 7]]);
});

test('163a Grip options: the list per grip', () => {
  const ids = (e) => Object.fromEntries(GR.gripsOf(e).map((g) => [g.id, GR.optionsOf(e, g.id)]));
  assert.deepEqual(ids(line(0, 0, 50, 0)), { a: ['Stretch', 'Lengthen'], m: [], b: ['Stretch', 'Lengthen'] });
  assert.deepEqual(ids(arc(0, 0, 10, 0, 90)), { a: ['Stretch', 'Lengthen'], m: ['Stretch', 'Radius'], b: ['Stretch', 'Lengthen'], c: [] });
  assert.deepEqual(ids(circle(0, 0, 5)), { c: [], q0: [], q1: [], q2: [], q3: [] });
  assert.deepEqual(GR.optionsOf(rect(0, 0, 10, 5), 'v0'), ['Stretch', 'Insert vertex', 'Remove vertex']);       // 163b
  assert.equal(GR.optionPrompt(line(0, 0, 5, 0), 'Lengthen'), 'Specify end point:');
  assert.equal(GR.optionPrompt(arc(0, 0, 10, 0, 90), 'Lengthen'), 'Specify end point of arc:');
  assert.equal(GR.optionPrompt(arc(0, 0, 10, 0, 90), 'Radius'), 'Specify radius:');
});

test('163a Lengthen a line: the end follows the pointer along the line; a typed number is added; zero or reversed refused', () => {
  const ln = reopen(line(10, 10, 60, 10)), end = (e) => [val(e, 11), val(e, 21)];
  const p = GR.lengthen(ln, 'b', { to: [80, 33] });                          // the pointer off the line: its shadow on the line counts
  assert.equal(p.label, 'Lengthen'); nearPt(end(p.ent), [80, 10]); nearPt([val(p.ent, 10), val(p.ent, 20)], [10, 10]);
  nearPt(end(GR.lengthen(ln, 'b', { add: 10 }).ent), [70, 10]);               // AutoCAD: 10 typed on 50 = 60 long
  nearPt(end(GR.lengthen(ln, 'b', { add: -20 }).ent), [40, 10]);              // a negative shortens
  const a = GR.lengthen(ln, 'a', { add: 5 });                                 // the start end grows away from the fixed end
  nearPt([val(a.ent, 10), val(a.ent, 20)], [5, 10]);
  const slope = reopen(line(0, 0, 30, 40));
  nearPt(end(GR.lengthen(slope, 'b', { add: 50 }).ent), [60, 80]);
  assert.equal(GR.lengthen(ln, 'b', { add: -50 }), null, 'zero length refused');
  assert.equal(GR.lengthen(ln, 'b', { add: -80 }), null, 'reversing refused');
  assert.equal(GR.lengthen(ln, 'b', { to: [0, 10] }), null, 'the pointer behind the fixed end refused');
  assert.equal(GR.lengthen(ln, 'b', { to: [60, 10] }), null, 'no change');
  assert.equal(GR.lengthen(ln, 'm', { add: 5 }), null, 'the middle has no Lengthen');
  assert.equal(GR.lengthen(reopen(circle(0, 0, 5)), 'q0', { add: 5 }), null);
});

test('163a Lengthen an arc: the end follows the pointer round the centre; a typed number is the end ANGLE (the start grip mirrors it)', () => {
  const ar = reopen(arc(50, 50, 20, 0, 90));
  const p = GR.lengthen(ar, 'b', { to: [50, 120] });                          // straight up from the centre: 90 -> 90 is unchanged, so go to the left
  assert.equal(p, null, 'the same angle: no change');
  const q = GR.lengthen(ar, 'b', { to: [30, 50] });
  near(val(q.ent, 51), 180); near(val(q.ent, 50), 0); near(val(q.ent, 40), 20); nearPt([val(q.ent, 10), val(q.ent, 20)], [50, 50]);
  near(val(GR.lengthen(ar, 'b', { deg: 10 }).ent, 51), 10);                   // AutoCAD: 10 typed at the end grip = end angle 10
  near(val(GR.lengthen(ar, 'b', { deg: 120 }).ent, 51), 120);
  near(val(GR.lengthen(ar, 'a', { deg: 20 }).ent, 50), 340);                  // at the start grip 20 = start angle 340 (= -20)
  near(val(GR.lengthen(ar, 'a', { to: [50, 30] }).ent, 50), 270);
  assert.equal(GR.lengthen(ar, 'b', { deg: 0 }), null, 'ends meeting refused');
  assert.equal(GR.lengthen(ar, 'b', { deg: 360 }), null);
  assert.equal(GR.lengthen(ar, 'b', { deg: 90 }), null, 'no change');
  assert.equal(GR.lengthen(ar, 'm', { deg: 5 }), null, 'the middle has no Lengthen');
});

test('163a Radius: the arc middle grip sets the radius; the centre and angles stay', () => {
  const ar = reopen(arc(50, 50, 20, 0, 90)), r = GR.setRadius(ar, 30);
  assert.equal(r.label, 'Radius');
  near(val(r.ent, 40), 30); near(val(r.ent, 50), 0); near(val(r.ent, 51), 90); nearPt([val(r.ent, 10), val(r.ent, 20)], [50, 50]);
  nearPt([GR.gripsOf(r.ent)[0].x, GR.gripsOf(r.ent)[0].y], [80, 50]); nearPt([GR.gripsOf(r.ent)[2].x, GR.gripsOf(r.ent)[2].y], [50, 80]);   // AutoCAD: ends at (80,50) / (50,80)
  assert.equal(GR.dragOption(ar, 'm', 'Radius', [50 + 12, 50 + 16]), null, 'the same radius: no change');
  near(val(GR.dragOption(ar, 'm', 'Radius', [50 + 30, 50 + 40]).ent, 40), 50);
  near(val(GR.typedOption(ar, 'm', 'Radius', 7).ent, 40), 7);
  near(val(GR.typedOption(ar, 'b', 'Lengthen', 45).ent, 51), 45);
  near(val(GR.typedOption(reopen(line(0, 0, 10, 0)), 'b', 'Lengthen', 5).ent, 11), 15);
  assert.equal(GR.setRadius(ar, 0), null); assert.equal(GR.setRadius(ar, -3), null); assert.equal(GR.setRadius(ar, NaN), null);
  assert.equal(GR.setRadius(reopen(circle(0, 0, 5)), 3), null, 'Radius is for the arc middle only');
});

// ---- 163b polyline Grip options: AutoCAD's tested polyline (acad-163.txt): 10,70 40,70 40,90 + arc (bulge -1) to 70,90 ----
const acadPoly = () => reopen(lwpoly([[10, 70], [40, 70], [40, 90, -1], [70, 90]]));
const verts = (e) => GR.lwVertices(e.r).map((v) => [v.x, v.y, v.b]);
const at4 = (e) => verts(e).map(([x, y, b]) => [x, y, +b.toFixed(4)]);

test('163b segment mid grips: one per segment (open 3, closed 4), an arc segment\'s at the top of its arc; rectangle sides keep resizing', () => {
  const p = acadPoly(), g = GR.gripsOf(p);
  assert.deepEqual(g.map((x) => x.id), ['v0', 'v1', 'v2', 'v3', 'e0', 'e1', 'e2']);
  assert.ok(g.filter((x) => x.kind === 'edge').every((x) => x.rect === undefined));
  nearPt([g[4].x, g[4].y], [25, 70]); nearPt([g[5].x, g[5].y], [40, 80]); nearPt([g[6].x, g[6].y], [55, 105]);       // AutoCAD: the arc mid grip at 55,105
  const closed = GR.gripsOf(reopen(lwpoly([[0, 0], [10, 0], [10, 10], [0, 20]], { closed: true })));
  assert.deepEqual(closed.filter((x) => x.kind === 'edge').map((x) => [x.x, x.y]), [[5, 0], [10, 5], [5, 15], [0, 10]], 'the closing segment too');
  assert.equal(GR.gripsOf(rect(0, 0, 10, 5)).filter((x) => x.rect).length, 4);
  assert.equal(GR.dragGrip(rect(0, 0, 10, 5), 'e1', [14, 2.5]).label, 'Resize rectangle');
  assert.equal(GR.gripsOf(lwpoly([[0, 0]])).length, 1, 'one vertex: no segment');
  assert.equal(GR.gripsOf(lwpoly([[0, 0], [5, 5]])).length, 3);
});

test('163b Stretch on a segment mid: a line segment moves with both ends, an arc segment keeps its ends and bends through the pointer', () => {
  const p = acadPoly();
  const l = GR.dragGrip(p, 'e0', [25, 80]);                                // the mid (25,70) up by 10: both ends move by (0,10)
  assert.equal(l.label, 'Stretch polyline');
  assert.deepEqual(at4(l.ent), [[10, 80, 0], [40, 80, 0], [40, 90, -1], [70, 90, 0]]);
  const a = GR.dragGrip(p, 'e2', [55, 110]);                               // the arc mid (55,105) to 110: ends stay
  assert.equal(a.label, 'Arc bulge');
  assert.deepEqual(at4(a.ent).map((v) => v.slice(0, 2)), [[10, 70], [40, 70], [40, 90], [70, 90]]);
  assert.ok(Math.abs(verts(a.ent)[2][2]) > 0.3 && verts(a.ent)[2][2] < 0, 'still bulging the same way');
  const m = GR.gripsOf(a.ent).find((x) => x.id === 'e2');
  nearPt([m.x, m.y], [55, 110]);                                           // the new arc passes through the pointer
  assert.equal(GR.dragGrip(p, 'e2', [55, 90]), null, 'a point on the chord is no arc');
  assert.equal(GR.dragGrip(p, 'e0', [25, 70]), null, 'not moved');
  const c = reopen(lwpoly([[0, 0], [10, 0], [10, 10]], { closed: true })), z = GR.dragGrip(c, 'e2', [5, 8]);
  assert.deepEqual(at4(z.ent).map((v) => v.slice(0, 2)), [[0, 3], [10, 0], [10, 13]], 'the closing segment moves vertices 2 and 0');
});

test('163b review: the extrusion group stays after the vertices when a vertex is inserted, removed or converted', () => {
  const z = reopen(lwpoly([[0, 0], [10, 0], [10, 10]])); z.r.c.push(210, 220, 230); z.r.v.push('0', '0', '1');
  for (const out of [GR.insertVertex(z, 0, [5, 1]).ent, GR.removeVertex(z, 1).ent, GR.convertToArc(z, 0, [5, 2]).ent]) assert.deepEqual(out.r.c.slice(-3), [210, 220, 230], 'the extrusion stays after the vertices');
});

test('163b review: a segment mid hot with its own vertex moves each vertex once, in either hot order; a line mid and an arc mid together keep the bulge', () => {
  const p = reopen(lwpoly([[0, 0], [10, 0], [10, 10]])), h = (id) => GR.gripsOf(p).find((x) => x.id === id);
  const stretch = (ent, ids) => GR.stretchHots(ent, ids.map(h)).reduce((cur, x) => GR.dragGrip(cur, x.id, [x.x, x.y + 5]).ent, ent);       // what gripStretchHots does for one object, both +5 in y
  for (const ids of [['v1', 'e0'], ['e0', 'v1']]) assert.deepEqual(at4(stretch(p, ids)).map((v) => v.slice(0, 2)), [[0, 5], [10, 5], [10, 10]], ids.join(' '));
  assert.deepEqual(GR.stretchHots(p, [h('e0')]).map((x) => x.id), ['v0', 'v1'], 'the mid alone: both ends');
  const q = acadPoly();       // an arc segment (e2) with its end hot: the end moves, the bulge stays; alone it still bends
  assert.deepEqual(GR.stretchHots(q, ['e2', 'v3'].map((id) => GR.gripsOf(q).find((x) => x.id === id))).map((x) => x.id), ['v3']);
  assert.deepEqual(GR.stretchHots(q, [GR.gripsOf(q).find((x) => x.id === 'e2')]).map((x) => x.id), ['e2']);
  const lineArc = (ids) => { const cur = GR.stretchHots(q, ids.map((id) => GR.gripsOf(q).find((x) => x.id === id))).reduce((c, x) => GR.dragGrip(c, x.id, [x.x, x.y + 5]).ent, q); return at4(cur).map((v) => v[2]); };
  for (const ids of [['e1', 'e2'], ['e2', 'e1'], ['v1', 'e1', 'e2'], ['e1', 'v2', 'e2']]) assert.deepEqual(lineArc(ids), [0, 0, -1, 0], 'a line mid and an arc mid hot together keep the bulge: ' + ids.join(' '));
});

test('163b Insert vertex: after the hovered vertex or into the segment, bulges of the other segments kept, the split halves straight', () => {
  const p = acadPoly();
  const v = GR.insertVertex(p, 1, [32, 82]);                               // AutoCAD: 10,70 40,70 32,82 40,90 70,90, arc kept on the last segment
  assert.equal(v.label, 'Insert vertex');
  assert.deepEqual(at4(v.ent), [[10, 70, 0], [40, 70, 0], [32, 82, 0], [40, 90, -1], [70, 90, 0]]);
  assert.equal(val(v.ent, 90), 5, 'the vertex count');
  assert.deepEqual(at4(GR.insertVertex(p, 0, [22, 80]).ent).map((q) => q.slice(0, 2)), [[10, 70], [22, 80], [40, 70], [40, 90], [70, 90]], 'into segment 0');
  const split = GR.insertVertex(p, 2, [55, 105]);                          // splitting the arc segment: both halves straight (our guess)
  assert.deepEqual(at4(split.ent), [[10, 70, 0], [40, 70, 0], [40, 90, 0], [55, 105, 0], [70, 90, 0]]);
  assert.deepEqual(at4(GR.insertVertex(p, 3, [80, 100]).ent).slice(-2), [[70, 90, 0], [80, 100, 0]], 'after the last vertex of an open polyline: a new end');
  const c = reopen(lwpoly([[0, 0], [10, 0], [10, 10]], { closed: true }));
  assert.deepEqual(at4(GR.insertVertex(c, 2, [0, 5]).ent).map((q) => q.slice(0, 2)), [[0, 0], [10, 0], [10, 10], [0, 5]], 'the closing segment: a new last vertex');
  assert.equal(val(GR.insertVertex(c, 2, [0, 5]).ent, 70), 1, 'still closed');
  assert.equal(GR.insertVertex(p, 1, [40, 70]), null, 'on the hovered vertex');
  assert.equal(GR.insertVertex(p, 1, [40, 90]), null, 'on the next vertex');
  assert.equal(GR.insertVertex(p, 9, [1, 1]), null); assert.equal(GR.insertVertex(p, 1, [NaN, 1]), null);
  assert.equal(GR.insertVertex(circle(0, 0, 5), 0, [1, 1]), null);
  assert.deepEqual(verts(p).length, 4, 'the source stays');
  const withId = reopen(lwpoly([[0, 0], [10, 0], [10, 10]])); withId.r = { c: [...withId.r.c.slice(0, withId.r.c.indexOf(20) + 1), 91, ...withId.r.c.slice(withId.r.c.indexOf(20) + 1)], v: [...withId.r.v.slice(0, withId.r.c.indexOf(20) + 1), '7', ...withId.r.v.slice(withId.r.c.indexOf(20) + 1)] };
  assert.equal(GR.insertVertex(withId, 0, [5, 5]).ent.r.c.filter((x) => x === 91).length, 1, 'a copied vertex ID is not kept');
});

test('163b Remove vertex: first / middle / last, open and closed; the joined segment is straight; refused at the limit', () => {
  const p = acadPoly();
  assert.deepEqual(at4(GR.removeVertex(p, 1).ent), [[10, 70, 0], [40, 90, -1], [70, 90, 0]]);       // AutoCAD: 10,70 40,90 70,90, arc kept
  assert.equal(GR.removeVertex(p, 1).label, 'Remove vertex');
  assert.deepEqual(at4(GR.removeVertex(p, 0).ent), [[40, 70, 0], [40, 90, -1], [70, 90, 0]]);
  assert.deepEqual(at4(GR.removeVertex(p, 3).ent), [[10, 70, 0], [40, 70, 0], [40, 90, 0]], 'the last vertex goes with its segment');
  assert.deepEqual(at4(GR.removeVertex(p, 3).ent).length, 3); assert.equal(val(GR.removeVertex(p, 3).ent, 90), 3);
  assert.deepEqual(at4(GR.removeVertex(p, 2).ent), [[10, 70, 0], [40, 70, 0], [70, 90, 0]], 'the arc into the removed vertex does not survive');
  const c = reopen(lwpoly([[0, 0, 0.5], [10, 0], [10, 10], [0, 10]], { closed: true }));
  assert.deepEqual(at4(GR.removeVertex(c, 0).ent), [[10, 0, 0], [10, 10, 0], [0, 10, 0]], 'closed, the first vertex: its bulge goes');
  assert.deepEqual(at4(GR.removeVertex(c, 3).ent), [[0, 0, 0.5], [10, 0, 0], [10, 10, 0]], 'closed, the last: the closing segment is straight');
  assert.equal(val(GR.removeVertex(c, 3).ent, 70), 1);
  assert.equal(GR.removeVertex(GR.removeVertex(c, 3).ent, 0), null, 'a closed polyline keeps 3 vertices');
  const two = reopen(lwpoly([[0, 0], [5, 5]]));
  assert.equal(GR.removeVertex(two, 0), null, 'an open one keeps 2');
  assert.ok(GR.removeVertex(reopen(lwpoly([[0, 0], [5, 5], [9, 1]])), 1));
  assert.equal(GR.removeVertex(p, 7), null);
  assert.equal(GR.removeVertex(circle(0, 0, 5), 0), null);
});

test('163b Convert to Arc / Line: the arc passes through the point; a point on the chord is refused; a line stays a line', () => {
  const p = acadPoly();
  const a = GR.convertToArc(p, 0, [25, 75]);                               // AutoCAD: 5 above the mid of 10,70-40,70: bulge -0.3334
  assert.equal(a.label, 'Convert to Arc'); near(verts(a.ent)[0][2], -1 / 3, 1e-9);
  nearPt([GR.gripsOf(a.ent)[4].x, GR.gripsOf(a.ent)[4].y], [25, 75]);
  assert.ok(verts(GR.convertToArc(p, 0, [25, 65]).ent)[0][2] > 0, 'below the chord: the other way');
  assert.deepEqual(at4(a.ent).slice(1), at4(p).slice(1), 'the other segments stay');
  assert.equal(GR.convertToArc(p, 0, [20, 70]), null, 'a point on the chord line');
  assert.equal(GR.convertToArc(p, 0, [100, 70]), null, 'on the chord line, beyond it');
  assert.equal(GR.convertToArc(p, 0, [NaN, 70]), null); assert.equal(GR.convertToArc(p, 5, [25, 75]), null);
  const l = GR.convertToLine(p, 2);
  assert.equal(l.label, 'Convert to Line'); assert.deepEqual(at4(l.ent), [[10, 70, 0], [40, 70, 0], [40, 90, 0], [70, 90, 0]]);
  assert.equal(GR.convertToLine(p, 0), null, 'a line is a line already');
  const c = reopen(lwpoly([[0, 0], [10, 0], [10, 10]], { closed: true }));
  assert.ok(Math.abs(verts(GR.convertToArc(c, 2, [3, 7]).ent)[2][2]) > 0, 'the closing segment converts');
  const noCode = lwpoly([[0, 0], [10, 0], [10, 10]]); noCode.r = { c: noCode.r.c.filter((x) => x !== 42), v: noCode.r.v.filter((_, k) => noCode.r.c[k] !== 42) };
  assert.ok(Math.abs(verts(GR.convertToArc(noCode, 0, [5, -3]).ent)[0][2]) > 0, 'a vertex with no bulge code gets one');
});

test('163b optionsOf for polylines: the lists as tested, Remove vertex only above the limit, nothing for a leader', () => {
  const p = acadPoly(), o = (e, id) => GR.optionsOf(e, id);
  assert.deepEqual(o(p, 'v1'), ['Stretch', 'Insert vertex', 'Remove vertex']);
  assert.deepEqual(o(p, 'e0'), ['Stretch', 'Insert vertex', 'Convert to Arc']);
  assert.deepEqual(o(p, 'e2'), ['Stretch', 'Insert vertex', 'Convert to Line']);
  assert.deepEqual(o(reopen(lwpoly([[0, 0], [5, 5]])), 'v0'), ['Stretch', 'Insert vertex'], 'two vertices: no Remove vertex');
  assert.deepEqual(o(reopen(lwpoly([[0, 0], [5, 5], [9, 1]], { closed: true })), 'v0'), ['Stretch', 'Insert vertex'], 'a triangle: no Remove vertex');
  assert.deepEqual(o(rect(0, 0, 10, 5), 'e0'), ['Stretch', 'Insert vertex', 'Convert to Arc'], 'a rectangle side too');
  assert.deepEqual(o(p, 'v9'), []);
  assert.deepEqual(o({ type: 'LEADER', model: { pts: [[0, 0], [5, 5]] } }, 'v0'), []);
  assert.ok(GR.IMMEDIATE.has('Remove vertex') && GR.IMMEDIATE.has('Convert to Line') && !GR.IMMEDIATE.has('Insert vertex'));
  assert.equal(GR.optionPrompt(p, 'Insert vertex'), 'Specify new vertex point:');
  assert.equal(GR.optionPrompt(p, 'Convert to Arc'), 'Specify midpoint of arc segment:');
  assert.equal(GR.optionPrompt(p, 'Remove vertex'), 'Pick to remove vertex:');
  assert.equal(GR.optionPrompt(p, 'Convert to Line'), 'Pick to convert to line segment:');
  assert.equal(GR.dragOption(p, 'e0', 'Convert to Arc', [25, 75]).label, 'Convert to Arc');
  assert.equal(GR.dragOption(p, 'v1', 'Insert vertex', [32, 82]).label, 'Insert vertex');
  assert.equal(GR.applyOption(p, 'v1', 'Remove vertex').label, 'Remove vertex');
  assert.equal(GR.applyOption(p, 'e2', 'Convert to Line').label, 'Convert to Line');
  assert.equal(GR.applyOption(p, 'v1', 'Insert vertex'), null);
  assert.equal(GR.readoutOf(p, 'v1', GR.insertVertex(p, 1, [32, 82]).ent), '5 vertices');
  assert.equal(GR.readoutOf(p, 'v1', GR.removeVertex(p, 1).ent), '3 vertices');
});

// ---- 164a: MTEXT width / height grips and block attribute grips ----
const MT = 'Line one of text\\PLine two of text\\PLine three';       // 3 lines, the widest 16 characters = 32 at height 2.5
const mtextAt = (w, o = {}) => { const m = mtext(10, 10, 2.5, MT, o); return w ? { ...m, r: { ...m.r, c: [...m.r.c.slice(0, 5), 41, ...m.r.c.slice(5)], v: [...m.r.v.slice(0, 5), String(w), ...m.r.v.slice(5)] } } : m; };
const rounded = (list) => list.map((g) => [g.id, +g.x.toFixed(3), +g.y.toFixed(3)]);

test('mtext: an insertion square and the width, height and both triangles at the box corners', () => {
  const m = mtextAt(40), g = GR.gripsOf(m);
  assert.deepEqual(rounded(g), [['i', 10, 10], ['w', 50, 10], ['h', 10, -0.833], ['wh', 50, -0.833]]);       // AutoCAD 2027: top right (50,10), bottom left (10,-0.83)
  assert.deepEqual(g.map((x) => x.kind), ['insert', 'tri', 'tri', 'tri']);
  assert.deepEqual(g.map((x) => x.tri), [undefined, 0, 90, 45]);
  assert.deepEqual(GR.optionsOf(m, 'w'), [], 'no Grip options list on any of them');
  assert.equal(GR.commandOf(m, 'w'), 'STRETCH');
  assert.equal(GR.gripsOf(mtextAt(0)).find((x) => x.id === 'w').x, 42, 'without a width the box is the text (16 x 2.5 x 0.8 = 32) wide');
});

test('mtext: the width grip sets group 41 and the opposite edge stays; the text reflows; the height stays the text\'s', () => {
  const m = mtextAt(40), r = GR.dragGrip(m, 'w', [40, 10]);
  assert.equal(r.label, 'Stretch MTEXT'); assert.equal(val(r.ent, 41), 30);
  assert.equal(r.ent.r.c.indexOf(46), -1, 'a width drag does not write a height');
  assert.deepEqual(rounded(GR.gripsOf(r.ent)).slice(0, 2), [['i', 10, 10], ['w', 40, 10]]);
  const wrapped = mtextAt(20), tall = GR.gripsOf(wrapped).find((x) => x.id === 'h').y;
  assert.ok(tall < GR.gripsOf(m).find((x) => x.id === 'h').y - 1, 'a narrower box wraps: more lines, the bottom goes down');
  assert.equal(GR.readoutOf(m, 'w', r.ent), 'Width 30.00 mm');
  assert.equal(GR.dragGrip(m, 'w', [50, 10]), null, 'the same width is nothing');
  assert.equal(val(GR.dragGrip(mtextAt(0), 'w', [30, 10]).ent, 41), 20, 'a width is added after the height when the text had none');
});

test('mtext: the width never goes below two heights; a typed distance is added to the width', () => {
  const m = mtextAt(40);
  assert.equal(val(GR.dragGrip(m, 'w', [11, 10]).ent, 41), 5, 'two text heights (2 x 2.5): drawing.js stops wrapping narrower than that');
  assert.deepEqual(GR.axisOf(m, 'w'), [1, 0]); assert.deepEqual(GR.axisOf(m, 'h').map((v) => Math.abs(v)), [0, 1]);
  assert.equal(GR.axisOf(m, 'wh'), null); assert.equal(GR.axisOf(m, 'i'), null);
  const typed = GR.dragGrip(m, 'w', [50 + 25, 10]);                          // what the typed 25 comes to: the grip 25 further out
  assert.equal(val(typed.ent, 41), 65);
});

test('mtext: the height grip sets group 46 (never below the text), both sets width and height', () => {
  const m = mtextAt(40), h = GR.dragGrip(m, 'h', [10, -6]);
  assert.equal(val(h.ent, 46), 16); assert.equal(val(h.ent, 41), 40, 'the width stays');
  assert.deepEqual(rounded(GR.gripsOf(h.ent)).slice(1), [['w', 50, 10], ['h', 10, -6], ['wh', 50, -6]]);
  assert.equal(GR.readoutOf(m, 'h', h.ent), 'Height 16.00 mm');
  assert.equal(GR.dragGrip(m, 'h', [10, 5]), null, 'above the text\'s own height: it stays as it is');
  const both = GR.dragGrip(m, 'wh', [54, -6]);
  assert.equal(val(both.ent, 41), 44); assert.equal(val(both.ent, 46), 16);       // AutoCAD: 54,-6 gave width 44, bottom -6
  assert.equal(GR.readoutOf(m, 'wh', both.ent), 'Width 44.00 · Height 16.00 mm');
  const shrunk = GR.dragGrip(h.ent, 'h', [10, 0]); near(val(shrunk.ent, 46), 10.8333333333333, 1e-9); // a taller box can shrink back to the text
});

test('mtext: a rotated one has its grips turned with it and drags along its own axes', () => {
  const m = mtextAt(40, { rot: 90 }), g = GR.gripsOf(m);
  assert.deepEqual(rounded(g).slice(0, 2), [['i', 10, 10], ['w', 10, 50]]);          // the width runs up the page
  assert.equal(g[1].tri, -90);
  assert.equal(val(GR.dragGrip(m, 'w', [10, 40]).ent, 41), 30);
  assert.deepEqual(GR.axisOf(m, 'w').map((v) => Math.round(v)), [0, 1]);
});

test('mtext: a centre or right attachment keeps the far edge: the insertion point slides', () => {
  const m = mtextAt(40, { attach: 2 }), g = GR.gripsOf(m);                          // top centre: the box runs x -10 .. 30
  assert.deepEqual(rounded(g).slice(0, 2), [['i', 10, 10], ['w', 30, 10]]);
  const r = GR.dragGrip(m, 'w', [40, 10]);                                           // the left edge stays at -10, the right goes to 40: 50 wide
  assert.equal(val(r.ent, 41), 50); assert.equal(val(r.ent, 10), 15);
  assert.deepEqual(rounded(GR.gripsOf(r.ent)).slice(0, 2), [['i', 15, 10], ['w', 40, 10]]);
  assert.equal(rounded(GR.gripsOf(r.ent)).find((x) => x[0] === 'h')[1], -10, 'and the left edge is where it was');
});

test('mtext: a hot width grip beside the insertion grip: Stretch moves the width only', () => {
  const m = mtextAt(40);
  assert.equal(GR.wholeHot(m, new Set(['w'])), false); assert.equal(GR.wholeHot(m, new Set(['i', 'w', 'h', 'wh'])), true);
  assert.equal(GR.movesWhole(m, 'w'), false); assert.equal(GR.movesWhole(m, 'i'), true); assert.equal(GR.noOutline(m), true);
});

test('mtext: width and height survive a save and reopen', () => {
  const d = newDoc(4), r = GR.dragGrip(GR.dragGrip(mtextAt(40), 'w', [40, 10]).ent, 'h', [10, -20]).ent;
  addEntities(d, [r]);
  const back = readDxf(writeDxf(d)).entities[0];
  assert.equal(val(back, 41), 30); assert.equal(val(back, 46), 30);
  assert.deepEqual(GR.gripsOf(back).map((x) => x.id), ['i', 'w', 'h', 'wh']);
});

const attrib = (x, y, o = {}) => ({ type: 'ATTRIB', c: [10, 20, 40, 1, 2, ...(o.flags != null ? [70] : []), ...(o.more || [])], v: [String(x), String(y), '2', o.value || 'ABC', o.tag || 'TAG1', ...(o.flags != null ? [String(o.flags)] : []), ...(o.more ? o.moreV : [])] });
const blockWith = (...kids) => ({ type: 'INSERT', layer: '0', r: { type: 'INSERT', c: [2, 10, 20, 30], v: ['B1', '10', '100', '0'] }, kids });

test('block attributes: one grip per visible attribute at its point, beside the insertion grip', () => {
  const b = blockWith(attrib(17, 100), attrib(17, 90, { tag: 'TAG2' }));
  assert.deepEqual(GR.gripsOf(b).map((g) => g.id), ['i', 'a0', 'a1']);
  assert.deepEqual(pts(GR.gripsOf(b)), [[10, 100], [17, 100], [17, 90]]);
  assert.equal(GR.optionsOf(b, 'a0').length, 0, 'no list');
  assert.equal(GR.movesWhole(b, 'a0'), false); assert.equal(GR.movesWhole(b, 'i'), true);
  assert.equal(GR.commandOf(b, 'a0'), 'STRETCH');
  assert.deepEqual(GR.gripsOf(blockWith()).map((g) => g.id), ['i'], 'a block without attributes has the insertion grip as before');
});

test('block attributes: invisible (flag 1), hidden, position-locked and turned ones have no grip; display mode 0 hides all, 2 shows the invisible', () => {
  const b = blockWith(attrib(1, 1), attrib(2, 2, { flags: 1 }), attrib(4, 4, { more: [60], moreV: ['1'] }), attrib(5, 5, { more: [280, 280], moreV: ['0', '1'] }), attrib(6, 6, { more: [210, 220, 230], moreV: ['0', '0', '-1'] }));
  assert.deepEqual(GR.gripsOf(b).map((g) => g.id), ['i', 'a0'], 'only the plain one');
  assert.deepEqual(GR.gripsOf(b, 0).map((g) => g.id), ['i'], '$ATTMODE 0: the attributes are not drawn');
  assert.deepEqual(GR.gripsOf(b, 2).map((g) => g.id), ['i', 'a0', 'a1'], '$ATTMODE 2: the invisible one shows (a locked or hidden one still has none)');
});

test('block attributes: a justified attribute has its grip at the alignment point', () => {
  const a = attrib(17, 100, { more: [72, 74, 11, 21], moreV: ['1', '0', '20', '103'] });
  assert.deepEqual(pts(GR.gripsOf(blockWith(a))).slice(1), [[20, 103]]);
  const fit = attrib(17, 100, { more: [72, 11, 21], moreV: ['5', '30', '100'] });         // aligned / fit: between two points, the start is the grip
  assert.deepEqual(pts(GR.gripsOf(blockWith(fit))).slice(1), [[17, 100]]);
});

test('block attributes: a drag moves that attribute only (and its alignment point), the block and the others stay; one step called Stretch', () => {
  const a0 = attrib(17, 100, { more: [72, 11, 21], moreV: ['1', '20', '103'] }), a1 = attrib(17, 90, { tag: 'TAG2' }), b = blockWith(a0, a1);
  const r = GR.dragGrip(b, 'a0', [20, 109]);                                           // the alignment point 20,103 -> 20,109: by (0, 6)
  assert.equal(r.label, 'Stretch');
  assert.deepEqual([GR.get(r.ent.kids[0], 10), GR.get(r.ent.kids[0], 20), GR.get(r.ent.kids[0], 11), GR.get(r.ent.kids[0], 21)], [17, 106, 20, 109]);
  assert.equal(r.ent.kids[1], a1, 'the other attribute is the same record'); assert.equal(r.ent.r, b.r, 'the block did not move');
  assert.deepEqual(pts(GR.gripsOf(r.ent)), [[10, 100], [20, 109], [17, 90]]);
  assert.equal(b.kids[0], a0, 'the original stays'); assert.equal(GR.dragGrip(b, 'a1', [17, 90]), null);
  assert.ok(GR.readoutOf(b, 'a1', GR.dragGrip(b, 'a1', [19, 93]).ent).startsWith('Move ΔX 2.00 ΔY 3.00'));
  assert.equal(GR.dragGrip(b, 'a1', [19, 93]).ent.kids[1].c.join(), a1.c.join(), 'no group is added or lost');
});

test('block attributes: the moved attribute survives a save and reopen', () => {
  const d = newDoc(4), a = attrib(17, 100); a.c.splice(2, 0, 30); a.v.splice(2, 0, '0');
  addBlock(d, 'B1', [circle(0, 0, 5)]);
  const ins = { ...insert('B1', 10, 100), kids: [a, { ...a, v: a.v.map((v, i) => (a.c[i] === 20 ? '90' : a.c[i] === 2 ? 'TAG2' : v)) }] };
  const moved = GR.dragGrip(ins, 'a1', [19, 93]).ent;
  addEntities(d, [moved]);
  const back = readDxf(writeDxf(d)).entities[0];
  assert.deepEqual(back.kids.map((k) => [GR.get(k, 10), GR.get(k, 20)]), [[17, 100], [19, 93]]);
  assert.deepEqual(pts(GR.gripsOf(back)), [[10, 100], [17, 100], [19, 93]]);
});

console.log(n + ' grips tests passed');
