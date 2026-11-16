import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeEntities, ALREADY, NOT_AHEAD, ONE_LINE, FLAT } from './web/closeline.js';
import { line, arc, circle, lwpoly, ellipse } from './web/dxf-write.js';
import { shapeOf } from './web/grips.js';

const own = { layer: 'Cut', aci: 3, tc: 0x257abd, lt: 'DASHED', lw: 35 };
const xy = (e) => shapeOf(e).pts.map((p) => p.slice(0, 2).map((v) => Math.round(v * 1e6) / 1e6));

test('an L of two lines closes with a straight segment, one closed polyline with the first line properties', () => {
  const { result, skipped, note } = closeEntities([line(0, 10, 0, 0, own), line(0, 0, 10, 0)]);
  assert.equal(result.type, 'LWPOLYLINE'); assert.equal(shapeOf(result).closed, true); assert.equal(skipped.length, 0);
  assert.deepEqual(xy(result), [[0, 10], [0, 0], [10, 0]]);
  assert.deepEqual([result.layer, result.aci, result.tc, result.lt, result.lw], ['Cut', 3, 0x257abd, 'DASHED', 35]);
  assert.equal(note, NOT_AHEAD, 'the ends do not cross ahead of both: the note says it went straight');
});

test('Extend runs the end lines on to their crossing; Straight does not', () => {
  const v = () => [lwpoly([[4, 8], [0, 0], [10, 0], [6, 8]])];                 // a triangle open at the apex: the end lines meet at (5, 10)
  const e = closeEntities(v());
  assert.deepEqual(xy(e.result), [[5, 10], [0, 0], [10, 0]]); assert.equal(shapeOf(e.result).closed, true); assert.equal(e.note, '');
  const s = closeEntities(v(), { ends: 'straight' });
  assert.deepEqual(xy(s.result), [[4, 8], [0, 0], [10, 0], [6, 8]]); assert.equal(s.note, '', 'Straight never notes');
  const roof = closeEntities([line(0, 0, 4, 9), line(6, 9, 10, 0)]);          // the ridge meets at (5, 11.25); the base (the last gap) diverges: straight, noted
  assert.deepEqual(xy(roof.result), [[0, 0], [5, 11.25], [10, 0]]); assert.equal(roof.note, NOT_AHEAD);
});

test('Extend falls back to straight with a note: parallel ends, crossing behind an end, crossing too far, an arc end', () => {
  for (const ents of [[line(0, 0, 0, 10), line(5, 10, 5, 0)], [line(0, 0, 4, 9), line(6, 9, 8, 18)], [line(0, 0, 9, 1), line(9, 1.5, 8, 1.45)], [arc(0, 0, 10, 0, 90), line(0, 10, -10, 20)]]) {
    const { result, note } = closeEntities(ents);
    assert.ok(result, 'still closes'); assert.equal(shapeOf(result).closed, true); assert.equal(note, NOT_AHEAD);
  }
  assert.deepEqual(xy(closeEntities([line(0, 0, 0, 10), line(5, 10, 5, 0)]).result), [[0, 0], [0, 10], [5, 10], [5, 0]]);
});

test('a lone arc closes with its chord (a D), never a circle; the bulge stays', () => {
  const { result } = closeEntities([arc(0, 0, 10, 0, 180, own)]);
  assert.equal(result.type, 'LWPOLYLINE'); const s = shapeOf(result); assert.equal(s.closed, true); assert.equal(s.pts.length, 2);
  assert.ok(Math.abs(s.pts[0][2] - 1) < 1e-9, 'a half circle: bulge 1'); assert.equal(result.layer, 'Cut');
});

test('a polyline closes with its flag, ends already touching need no bridge', () => {
  const { result } = closeEntities([lwpoly([[0, 0], [10, 0], [10, 10], [0, 10]])]);
  assert.equal(shapeOf(result).closed, true); assert.equal(shapeOf(result).pts.length, 4);
  const three = closeEntities([line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 0)]);
  assert.equal(shapeOf(three.result).pts.length, 3); assert.equal(three.note, '');
});

test('two separate objects with far gaps: nearest ends first, then the last gap; a far-off third piece joins too', () => {
  const { result, skipped } = closeEntities([line(0, 0, 10, 0, own), line(10, 5, 10, 15), line(0, 15, 0, 5)], { ends: 'straight' });
  assert.equal(skipped.length, 0); assert.equal(shapeOf(result).closed, true);
  assert.deepEqual(xy(result), [[0, 15], [0, 5], [0, 0], [10, 0], [10, 5], [10, 15]], 'the nearest pair (equal gaps: the first) first; the last gap closes the ring'); assert.equal(result.layer, 'Cut');
});

test('two parallel lines offset sideways close as a trapezoid, never a bow-tie, either way round and either end mode', () => {
  const area = (r) => { const p = xy(r); return Math.abs(p.reduce((s, q, k) => s + q[0] * p[(k + 1) % p.length][1] - p[(k + 1) % p.length][0] * q[1], 0) / 2); };
  for (const ends of ['extend', 'straight']) for (const [ents, want] of [
    [[line(0, 0, 100, 0), line(150, 50, 260, 50)], 5250], [[line(0, 0, 100, 0), line(260, 50, 150, 50)], 5250],
    [[line(0, 0, 100, 0), line(150, 50, 250, 50)], 5000], [[line(0, 0, 100, 0), line(250, 50, 150, 50)], 5000]]) {
    const { result, why } = closeEntities(ents, { ends });
    assert.ok(result, `${ends}: ${why}`); assert.equal(area(result), want, `${ends}: ${JSON.stringify(xy(result))}`);
  }
});

test('refused: one straight line, pieces on one line, ellipses, closed objects, nothing', () => {
  assert.equal(closeEntities([line(0, 0, 10, 0)]).why, ONE_LINE);
  assert.equal(closeEntities([line(0, 0, 10, 0), line(20, 0, 30, 0)]).why, FLAT);
  assert.equal(closeEntities([ellipse(0, 0, 10, 0, 0.5)]).why, 'ellipses and splines are not closed');
  assert.equal(closeEntities([circle(0, 0, 5)]).why, ALREADY);
  assert.equal(closeEntities([lwpoly([[0, 0], [5, 0], [5, 5]], { closed: true })]).why, ALREADY);
  assert.equal(closeEntities([]).why, 'nothing selected');
  const mixed = closeEntities([lwpoly([[0, 0], [5, 0], [5, 5]], { closed: true }),line(0, 10, 0, 0), line(0, 0, 10, 0)]);
  assert.ok(mixed.result); assert.deepEqual(mixed.skipped.map((s) => s.reason), [ALREADY]);
});
