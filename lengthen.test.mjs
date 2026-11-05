import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lengthenEntity, lengthenInfo, lengthenWhy, CANNOT_LENGTHEN, ZERO_LENGTH } from './web/lengthen.js';
import { line, arc, circle, lwpoly, ellipse, entity, newDoc, addEntities, writeDxf } from './web/dxf-write.js';
import { shapeOf, get } from './web/grips.js';
import { readDxf } from './web/drawing.js';
import { geo, pathOf } from './web/modify.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 2e-6, `${a} != ${b}`);
const pointNear = (a, b) => a.slice(0, 2).forEach((v, i) => near(v, b[i]));

test('LINE: Delta / Percent / Total at either end keep the far end, properties and source', () => {
  for (const start of [false, true]) for (const [mode, value, length] of [['Delta', 10, 110], ['Delta', -40, 60], ['Percent', 50, 50], ['Total', 140, 140]]) {
    const e = line(0, 0, 100, 0, { layer: 'Cut', tc: 0x123456, lt: 'DASHED', lw: 35 }), before = structuredClone(e);
    const out = lengthenEntity(e, start ? [2, 3] : [98, 3], mode, value), s = shapeOf(out);
    near(lengthenInfo(out).length, length);
    assert.deepEqual(start ? s.b : s.a, start ? [100, 0] : [0, 0]);
    assert.equal(out.layer, e.layer); assert.equal(out.tc, e.tc); assert.equal(out.lt, e.lt); assert.equal(out.lw, e.lw);
    assert.deepEqual(e, before);
  }
  assert.deepEqual(shapeOf(lengthenEntity(line(0, 0, 60, 80), [60, 80], 'Dynamic', [90, 120])), { t: 'line', a: [0, 0], b: [90, 120] });
  assert.equal(lengthenEntity(line(0, 0, 100, 0), [100, 0], 'Dynamic', [-10, 3]), null);
});

test('ARC: length, percent, total and angle change only the chosen end, including across zero', () => {
  for (const start of [true, false]) for (const [mode, v, sweep] of [['Delta', Math.PI * 10, 180], ['Percent', 50, 45], ['Total', Math.PI * 5, 45], ['DeltaAngle', 30, 120], ['TotalAngle', 60, 60]]) {
    const e = arc(20, 30, 20, 315, 45), before = structuredClone(e), s = shapeOf(lengthenEntity(e, start ? [34, 16] : [34, 44], mode, v));
    near((s.a1 - s.a0 + 360) % 360, sweep); near(start ? s.a1 : s.a0, start ? 45 : 315);
    assert.deepEqual(e, before); assert.deepEqual(s.c, [20, 30]); near(s.r, 20);
  }
  const e = arc(0, 0, 50, 0, 90);
  near(lengthenInfo(e).length, 78.5398163397); near(lengthenInfo(e).angle, 90);
  near(shapeOf(lengthenEntity(e, [0, 50], 'Dynamic', [-50, 0])).a1, 180);
});

test('open polyline: whole-path percent / total affect only its first or last segment', () => {
  for (const start of [false, true]) for (const [mode, v, target] of [['Delta', 10, 210], ['Percent', 75, 150], ['Total', 250, 250]]) {
    const e = lwpoly([[0, 0], [100, 0], [100, 100]], { width: 3 }), before = structuredClone(e);
    e.r.c.push(38); e.r.v.push('7'); before.r.c.push(38); before.r.v.push('7');
    const out = lengthenEntity(e, start ? [1, 0] : [100, 99], mode, v), s = shapeOf(out);
    near(lengthenInfo(out).length, target); assert.deepEqual(s.pts[1], [100, 0]);
    assert.deepEqual(start ? s.pts.at(-1) : s.pts[0], start ? [100, 100] : [0, 0]);
    assert.equal(get(out.r, 43), 3); assert.equal(get(out.r, 38), 7); assert.deepEqual(e, before);
  }
});

test('polyline arc end: signed bulge changes sweep, centre / radius / widths and other segments stay', () => {
  for (const sign of [-1, 1]) for (const start of [true, false]) {
    const pts = start ? [[0, 0, sign, 2, 6], [20, 0], [40, 0]] : [[-20, 0], [0, 0, sign, 2, 6], [20, 0]];
    const e = entity('LWPOLYLINE', [[90, 3], [70, 0], ...pts.flatMap(([x, y, b = 0, w0, w1]) => [[10, x], [20, y], [42, b], ...(w0 ? [[40, w0], [41, w1]] : [])])]);
    const before = structuredClone(e), pick = start ? [0, 0] : [20, 0], seg = start ? 0 : 1;
    const out = lengthenEntity(e, pick, 'Delta', -Math.PI * 5), s = shapeOf(out), g = geo(pathOf(s).segs[seg]);
    pointNear(g.c, [10, 0]); near(g.r, 10); near(g.sw, sign * Math.PI / 2);
    near(s.pts[seg][2], sign * Math.tan(Math.PI / 8)); assert.deepEqual(s.pts[seg].slice(3), [2, 6]);
    assert.deepEqual(s.pts[1].slice(0, 2), shapeOf(e).pts[1].slice(0, 2));
    assert.deepEqual(e, before);
    const raw = newDoc(4); addEntities(raw, out); assert.ok(Math.abs(lengthenInfo(readDxf(writeDxf(raw)).entities[0]).length - (20 + Math.PI * 5)) < 1e-5);
  }
});

test('invalid types, closed objects, zero / negative end length and full sweeps refuse without mutation', () => {
  for (const e of [circle(0, 0, 10), lwpoly([[0, 0], [20, 0]], { closed: true }), ellipse(0, 0, 10, 0, .5), entity('SPLINE', []), entity('TEXT', [])]) {
    assert.equal(lengthenEntity(e, [0, 0], 'Delta', 10), null); assert.equal(lengthenWhy(e), CANNOT_LENGTHEN);
  }
  for (const e of [line(0, 0, 100, 0), arc(0, 0, 10, 0, 90), lwpoly([[0, 0], [100, 0], [100, 100]])]) {
    const before = structuredClone(e);
    for (const [mode, v, why] of [['Delta', -1000, ZERO_LENGTH], ['Percent', 0, ZERO_LENGTH], ['Percent', -50, ZERO_LENGTH], ['Total', 0, ZERO_LENGTH], ['Total', -10, ZERO_LENGTH], ['Delta', NaN, CANNOT_LENGTHEN]]) {
      assert.equal(lengthenEntity(e, [100, 100], mode, v), null); assert.equal(lengthenWhy(e, [100, 100], mode, v), why);
    }
    assert.deepEqual(e, before);
  }
  assert.equal(lengthenEntity(arc(0, 0, 10, 0, 90), [0, 10], 'TotalAngle', 360), null);
  assert.equal(lengthenWhy(arc(0, 0, 10, 0, 90), [0, 10], 'TotalAngle', 360), CANNOT_LENGTHEN);       // past a full turn: no zero-length text
  const l = line(0, 0, 100, 0);
  for (const mode of ['DeltaAngle', 'TotalAngle']) { assert.equal(lengthenEntity(l, [100, 0], mode, 30), null); assert.equal(lengthenWhy(l, [100, 0], mode, 30), CANNOT_LENGTHEN); }
  const tilted = line(0, 0, 100, 0); tilted.r.c.push(210, 220, 230); tilted.r.v.push('0.5', '0', '1');
  assert.equal(lengthenEntity(tilted, [100, 0], 'Delta', 10), null); assert.equal(lengthenWhy(tilted, [100, 0], 'Delta', 10), CANNOT_LENGTHEN);
  const dup = lwpoly([[0, 0], [50, 0], [50, 0], [100, 0]]), grown = lengthenEntity(dup, [100, 0], 'Delta', 10);
  near(lengthenInfo(dup).length, 100); assert.ok(grown && Math.abs(lengthenInfo(grown).length - 110) < 1e-9);
  assert.equal(lengthenInfo(lwpoly([[0, 0], [0, 0], [100, 0]])), null);       // a zero END segment still refuses
  const e = line(0, 0, 100, 0); assert.equal(lengthenEntity(e, [100, 0], 'Delta', 0), e);
});

test('negative extrusion picks use world coordinates while preserving the original normal', () => {
  const e = arc(20, 0, 10, 0, 90); e.r.c.push(210, 220, 230); e.r.v.push('0', '0', '-1');
  const out = lengthenEntity(e, [-30, 0], 'Percent', 50);
  near(get(out.r, 50), 45); near(get(out.r, 51), 90); assert.equal(get(out.r, 230), -1);
  const l = line(0, 0, 100, 0); l.r.c.push(210, 220, 230); l.r.v.push('0', '0', '-1');
  const changed = lengthenEntity(l, [100, 0], 'Delta', 10);
  assert.deepEqual(shapeOf(changed), { t: 'line', a: [0, 0], b: [110, 0] }); assert.equal(get(changed.r, 230), -1);
});

test('Dynamic polyline endpoints follow the line / arc support, keeping the other segments fixed', () => {
  for (const sign of [-1, 1]) for (const start of [true, false]) {
    const e = lwpoly(start ? [[0, 0, sign], [20, 0], [40, 0]] : [[-20, 0], [0, 0, sign], [20, 0]]);
    const result = lengthenEntity(e, start ? [0, 0] : [20, 0], 'Dynamic', [10, -10 * sign]);
    const s = shapeOf(result), g = geo(pathOf(s).segs[start ? 0 : 1]);
    near(g.r, 10); near(g.sw, sign * Math.PI / 2);
    pointNear(s.pts[start ? 0 : 2], [10, -10 * sign]);
    pointNear(s.pts[1], [20 * +start, 0]);
    assert.deepEqual(s.pts[start ? 2 : 0], shapeOf(e).pts[start ? 2 : 0]);
  }
  const e = lwpoly([[0, 0], [100, 0], [100, 100]]);
  assert.deepEqual(shapeOf(lengthenEntity(e, [0, 0], 'Dynamic', [-30, 7])).pts, [[-30, 0], [100, 0], [100, 100]]);
  for (const p of [null, [], [NaN, 0], [Infinity, 0]]) assert.equal(lengthenEntity(e, p, 'Delta', 10), null);
});
