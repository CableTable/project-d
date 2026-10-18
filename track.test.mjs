// track.js — polar tracking and object-snap tracking.   node track.test.mjs
import assert from 'node:assert/strict';
import * as TK from './web/track.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const R = (o) => TK.resolve({ acq: [], tol: 2, step: 0.01, inc: 0, base: null, ...o });
const base = [10, 10], pt = (x, y, kind = 'end') => ({ x, y, kind });

test('polar locks onto the ray at a multiple of the increment, at the pointer\'s distance, on the 0.01 grid', () => {
  const r = R({ p: [10 + 120 * Math.cos(Math.PI / 6) + 0.5, 10 + 60 + 0.3], base, inc: 15 });       // 30°, about 120 away, 1.x off the ray
  assert.equal(r.ray.a, 30);
  const len = Math.hypot(r.q[0] - 10, r.q[1] - 10);
  near(Math.atan2(r.q[1] - 10, r.q[0] - 10) * 180 / Math.PI, 30);
  near(len, Math.round(len * 100) / 100, 1e-9);
  assert.match(r.text, /^Polar: 1\d\d\.\d\d < 30°$/);
});
test('polar does not lock beyond the tolerance, near the base, or when it is off', () => {
  assert.equal(R({ p: [60, 10 + 50 * Math.tan(8 * Math.PI / 180) * 1], base, inc: 15, tol: 1 }), null, 'about 8° off a ray, 7 away: out');
  assert.equal(R({ p: [10.5, 10.2], base, inc: 15 }), null, 'inside the tolerance of the base');
  assert.equal(R({ p: [60, 10.1], base, inc: 0 }), null, 'polar off');
  assert.equal(R({ p: [60, 10.1], base: null, inc: 15 }), null, 'no base point');
});
test('a bigger increment skips rays: 90° only has the axes', () => {
  assert.equal(R({ p: [60, 10 + 50 * Math.tan(Math.PI / 12)], base, inc: 90, tol: 1 }), null);
  assert.equal(R({ p: [60, 10.4], base, inc: 90 }).ray.a, 0);
  near(R({ p: [10.3, 70], base, inc: 90 }).q[0], 10);
});
test('a tracking line locks the pick on the acquired point\'s horizontal or vertical, readout names the snap kind', () => {
  const v = R({ p: [30.7, 55.123], acq: [pt(30, 20)] });
  assert.equal(v.q[0], 30); near(v.q[1], 55.12); assert.equal(v.text, 'Endpoint: 90°'); assert.equal(v.cross, false);
  const h = R({ p: [47.321, 20.9], acq: [pt(30, 20, 'mid')] });
  near(h.q[0], 47.32); near(h.q[1], 20); assert.equal(h.text, 'Midpoint: 0°');
  assert.equal(R({ p: [47, 23], acq: [pt(30, 20)] }), null, 'too far from both lines');
});
test('two tracking lines meet at a cross and the pick lands exactly there', () => {
  const r = R({ p: [30.8, 40.9], acq: [pt(30, 20), pt(80, 41, 'centre')] });
  assert.deepEqual(r.q, [30, 41]); assert.equal(r.cross, true); assert.equal(r.text, 'Centre: 0° · Endpoint: 90°');
  const same = R({ p: [30.5, 20.5], acq: [pt(30, 20)] });                       // one point's own two lines meet at the point itself: no cross
  assert.equal(same.cross, false);
});
test('a tracking line meets a polar ray: the cross wins over either alone', () => {
  const r = R({ p: [70.4, 10 + 60 * Math.tan(Math.PI / 6) + 0.3], base, inc: 15, acq: [pt(70, 0)] });     // the 30° ray meets x = 70 at y = 10 + 60·tan 30°
  near(r.q[0], 70); near(r.q[1], 10 + 60 * Math.tan(Math.PI / 6)); assert.equal(r.cross, true); assert.equal(r.text, 'Endpoint: 90° · Polar: 30°');
});
test('a ray meets a tracking line only in front of the base, and not a parallel one', () => {  assert.equal(R({ p: [10.2, 30.1], base, inc: 90, acq: [pt(0, 30)], tol: 0.5 }).cross, true, 'the 90° ray meets y = 30');  assert.equal(R({ p: [10.2, -10.1], base, inc: 90, acq: [pt(0, -10)], tol: 0.5 }).cross, true, 'the 270° ray meets y = -10');  assert.equal(R({ p: [60, 10.2], base, inc: 90, acq: [pt(0, 10)], tol: 0.5 }).cross, false, 'the 0° ray and y = 10 are parallel');});
test('acquire, release, and at most 7 are kept (the oldest drops)', () => {
  let l = TK.toggleAcquired([], pt(1, 1), 1e-3);
  assert.equal(l.length, 1);
  l = TK.toggleAcquired(l, pt(1, 1), 1e-3);
  assert.equal(l.length, 0, 'hovering on it again releases it');
  for (let i = 0; i < 9; i++) l = TK.toggleAcquired(l, pt(i, i), 1e-3);
  assert.equal(l.length, 7); assert.deepEqual(l[0], pt(2, 2)); assert.deepEqual(l[6], pt(8, 8));
});
test('only ends, middles, centres and points can be acquired', () => {
  assert.deepEqual(['end', 'mid', 'centre', 'node', 'near', 'quad'].map(TK.acquirable), [true, true, true, true, false, false]);
  assert.deepEqual(TK.INCREMENTS, [90, 45, 30, 22.5, 15, 10, 5]);
});
test('22.5° and the readout drop trailing zeros', () => {
  const r = R({ p: [10 + 50 * Math.cos(22.5 * Math.PI / 180), 10 + 50 * Math.sin(22.5 * Math.PI / 180) + 0.2], base, inc: 22.5 });
  assert.equal(r.ray.a, 22.5); assert.match(r.text, / < 22\.5°$/);
});

console.log(`${n} track tests passed`);
