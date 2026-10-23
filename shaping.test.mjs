// shaping.js — Weld, Trim, Intersect on closed outlines (TODO 122a).   node shaping.test.mjs
import assert from 'node:assert/strict';
import * as S from './web/shaping.js';
import * as E from './web/edit.js';
import * as D from './web/drawing.js';
import * as W from './web/dxf-write.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps * (1 + Math.abs(b)), `${a} !~ ${b}`);
const sq = (x, y, w, h = w) => ({ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] });
const circle = (cx, cy, r, steps = 1440) => ({ pts: Array.from({ length: steps }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / steps), cy + r * Math.sin(2 * Math.PI * i / steps)]) });

test('two overlapping squares: weld, intersect and trim areas are exact', () => {
  const a = sq(0, 0, 10), b = sq(5, 5, 10);
  const w = S.shape('weld', [a, b]), i = S.shape('intersect', [a, b]), t = S.shape('trim', [a, b], 0);
  near(w.area, 175); assert.equal(w.rings.length, 1);
  near(i.area, 25); assert.equal(i.rings.length, 1);
  near(t.area, 75); assert.equal(t.rings.length, 1);
  near(S.shape('trim', [a, b], 1).area, 75);                       // the other one as the target: the same area, the other piece
});

test('trim takes the target minus every other outline; with no target it is the largest', () => {
  const big = sq(0, 0, 20), s1 = sq(-2, 2, 4), s2 = sq(18, 10, 4);
  const r = S.shape('trim', [s1, big, s2]);                          // the big one is the target
  assert.equal(r.target, 1); near(r.area, 400 - 8 - 8);
  assert.equal(r.rings.length, 1);
  assert.equal(S.operandsOf([big, sq(5, 5, 4)]).length, 1);          // a cutter wholly inside the target is its hole, not a cutter
});

test('a square with a hole is one shape; welding it keeps the hole, trimming a square off its corner cuts into the ring', () => {
  const ring = [sq(0, 0, 20), sq(5, 5, 10)];
  assert.equal(S.operandsOf(ring).length, 1);
  near(S.operandsOf(ring)[0].area, 300);
  const w = S.shape('weld', [...ring, sq(18, 0, 10)]);
  near(w.area, 300 + 80); assert.equal(w.rings.length, 2);         // the hole stays
  const t = S.shape('trim', [...ring, sq(-5, -5, 10)], 0);
  near(t.area, 300 - 25);
  const o = S.shape('intersect', [...ring, sq(-5, -5, 15)]);
  near(o.area, 100 - 25);                                            // the corner block, minus the part of the hole in it
});

test('a smaller square crossing a bigger one is not taken for a hole', () => {
  const r = S.operandsOf([sq(0, 0, 10), sq(8, 8, 4)]);
  assert.equal(r.length, 2);
  near(S.shape('weld', [sq(0, 0, 10), sq(8, 8, 4)]).area, 100 + 16 - 4);
});

test('touching squares weld into one rectangle; a shared corner stays two pieces; a shared edge intersects to nothing', () => {
  const w = S.shape('weld', [sq(0, 0, 10), sq(10, 0, 10)]);
  near(w.area, 200); assert.equal(w.rings.length, 1); assert.equal(w.rings[0].length, 4);
  const c = S.shape('weld', [sq(0, 0, 10), sq(10, 10, 10)]);
  near(c.area, 200); assert.equal(c.rings.length, 2);
  assert.equal(S.shape('intersect', [sq(0, 0, 10), sq(10, 0, 10)]).rings.length, 0);
});

test('disjoint outlines: intersect is empty, weld keeps both, trim leaves the target', () => {
  const a = sq(0, 0, 10), b = sq(30, 0, 10);
  assert.equal(S.shape('intersect', [a, b]).rings.length, 0);
  assert.equal(S.shape('weld', [a, b]).rings.length, 2);
  near(S.shape('trim', [a, b], 0).area, 100);
});

test('shared vertices and equal squares', () => {
  near(S.shape('weld', [sq(0, 0, 10), sq(0, 0, 10)]).area, 100);
  near(S.shape('intersect', [sq(0, 0, 10), sq(0, 0, 10)]).area, 100);
  assert.equal(S.shape('trim', [sq(0, 0, 10), sq(0, 0, 10)], 0).rings.length, 0);
  assert.equal(S.operandsOf([sq(0, 0, 10), sq(0, 0, 5, 10)]).length, 1);   // one inside the other, edges shared: a hole
});

test('circle against a square, within the chord tolerance', () => {
  const r = 10, c = circle(0, 0, r), half = sq(0, -20, 40);              // the right half of the circle
  near(S.shape('intersect', [c, half]).area, Math.PI * r * r / 2, 1e-5);
  near(S.shape('trim', [c, half], 0).area, Math.PI * r * r / 2, 1e-5);
  near(S.shape('weld', [c, half]).area, 40 * 40 + Math.PI * r * r / 2, 1e-5);
});

test('three outlines intersect to the area common to all', () => {
  near(S.shape('intersect', [sq(0, 0, 10), sq(5, 0, 10), sq(0, 5, 10)]).area, 25);
});

test('fewer than two shapes, and an unknown operation, are errors', () => {
  assert.match(S.shape('weld', [sq(0, 0, 10)]).error, /at least 2/);
  assert.match(S.shape('weld', [sq(0, 0, 20), sq(5, 5, 10)]).error, /at least 2/);
  assert.match(S.shape('nope', [sq(0, 0, 1), sq(0, 0, 1)]).error, /Unknown/);
});

test('outlineLoops: closed outlines come out, an open polyline is counted open, entities are tracked', () => {
  const doc = W.newDoc();
  W.addEntities(doc, W.rect(0, 0, 10, 10), W.rect(5, 5, 10, 10), W.lwpoly([[0, 0], [30, 0], [30, 5]]), W.circle(50, 50, 5),
    W.line(100, 0, 110, 0), W.line(110, 0, 110, 10), W.line(110, 10, 100, 10), W.line(100, 10, 100, 0));
  const raw = D.readDxf(W.writeDxf(doc)), fl = D.flatten(raw), ed = E.makeIndex(raw, fl);
  const r = E.outlineLoops(ed, raw.entities.map((_, i) => i), 1e-6);
  assert.equal(r.loops.length, 4); assert.equal(r.open, 1);
  assert.deepEqual([...r.loops[r.loops.length - 1].ents].sort(), [4, 5, 6, 7]);   // the four lines make one loop
  const s = S.shape('weld', r.loops);
  near(s.area, 100 + 100 - 25 + Math.PI * 25 + 100, 1e-3);
});

console.log(n + ' passed');
