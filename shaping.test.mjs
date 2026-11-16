// shaping.js — seven Shaping operations on closed outlines (TODO 122).   node shaping.test.mjs
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
  assert.equal(S.operandsOf([big, sq(5, 5, 4)]).length, 2);          // a nested pair alone is two shapes (TODO 288a); with a third shape it is a hole again (next test)
});

test('pieces: the rings of one shape with holes share a number, separate pieces differ (TODO 288a fix)', () => {
  const t = S.shape('trim', [sq(0, 0, 100), sq(40, 40, 20)], 0);   // a nested pair: the outer gets a hole
  assert.equal(t.rings.length, 2); assert.deepEqual(t.pieces, [t.pieces[0], t.pieces[0]]);
  const w = S.shape('weld', [sq(0, 0, 10), sq(50, 0, 10)]);          // two separate shapes
  assert.equal(w.rings.length, 2); assert.notEqual(w.pieces[0], w.pieces[1]);
});

test('a square with a hole is one shape; welding it keeps the hole, trimming a square off its corner cuts into the ring', () => {
  const ring = [sq(0, 0, 20), sq(5, 5, 10)];
  assert.equal(S.operandsOf([...ring, sq(40, 0, 5)]).length, 2);
  near(S.operandsOf([...ring, sq(40, 0, 5)])[0].area, 300);
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

test('a bar whose corners are all inside the U\'s outline but which crosses the gap is two outlines, not a hole', () => {
  const u = { pts: [[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]] };
  const bar = sq(5, 20, 20, 5);                                                                        // corners (5,20) (25,20) (25,25) (5,25): all inside the arms
  assert.equal(S.operandsOf([u, bar]).length, 2);
  assert.equal(S.shape('weld', [u, bar]).error, undefined);
  near(S.shape('weld', [u, bar]).area, 700 + 5 * 10);                                                  // the gap between the arms (10 wide, 5 high) fills
  near(S.shape('weld', [u, bar, sq(40, 0, 5)]).area, 700 + 50 + 25);
});

test('degenerate input is an error, not a throw', () => {
  assert.match(S.shape('weld', [sq(0, 0, 10), { pts: [[NaN, 0], [1, 1], [2, 0]] }]).error, /Shaping failed/);
  assert.match(S.shape('trim', [sq(0, 0, 10), { pts: [] }]).error, /Shaping failed/);
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
  assert.equal(S.operandsOf([sq(0, 0, 10), sq(0, 0, 5, 10)]).length, 2);   // one inside the other, edges shared: a nested pair, two shapes
  assert.equal(S.operandsOf([sq(0, 0, 10), sq(0, 0, 5, 10), sq(30, 0, 5)]).length, 2);   // with a third shape the inner one is a hole
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

test('Simplify: overlapping squares in either order trim the back one; the front one is left as it is', () => {
  const a = sq(0, 0, 10), b = sq(5, 5, 10);
  for (const loops of [[a, b], [b, a]]) {
    const r = S.shape('simplify', loops);
    near(r.area, 175); assert.equal(r.rings.length, 1);
    assert.deepEqual(r.sources, [0]); assert.deepEqual(r.untouched, [1]);
    near(S.operandsOf([r.rings[0]])[0].area, 75);
    near(S.shape('intersect', [r.rings[0], loops[1]]).area, 0);
  }
});

test('Simplify: an outline nothing in front overlaps is untouched (a circle and a far square give no new rings)', () => {
  const r = S.shape('simplify', [circle(0, 0, 5), sq(100, 100, 10)]);
  assert.equal(r.rings.length, 0); assert.deepEqual(r.untouched, [0, 1]);
  near(r.area, r.operands[0].area + 100);
  const o = S.shape('simplify', [circle(0, 0, 5), sq(100, 100, 10), sq(3, 0, 10)]);   // the square at 3 covers part of the circle only
  assert.deepEqual(o.untouched, [1, 2]); assert.equal(o.rings.length, 1); assert.deepEqual(o.sources, [0]);
});

test('Simplify drops a fully covered outline and subtracts all outlines in front', () => {
  const a = sq(0, 0, 10);
  const r = S.shape('simplify', [a, a, sq(5, 0, 10)]);
  near(r.area, 150); assert.equal(r.rings.length, 1);
  assert.deepEqual(r.sources, [1]); assert.deepEqual(r.untouched, [2]);
  near(S.operandsOf([r.rings[0]])[0].area, 50);
});

for (const [op, target] of [['frontminus', 1], ['backminus', 0]]) {
  test(op + ': overlapping squares in both orders use drawing order, not the picked target', () => {
    const a = sq(0, 0, 10), b = sq(5, 5, 10);
    for (const loops of [[a, b], [b, a]]) {
      const r = S.shape(op, loops, 1 - target);
      assert.equal(r.target, target); near(r.area, 75); assert.equal(r.rings.length, 1);
      assert.deepEqual(r.sources, [target]);
      assert.deepEqual(r.rings, S.shape('trim', loops, target).rings);
    }
    const r = S.shape(op, [a, a]);
    near(r.area, 0); assert.deepEqual(r.rings, []);
  });
}

test('Front / Back minus subtract every other outline, including three overlapping outlines', () => {
  const a = sq(0, 0, 10), b = sq(4, -5, 10), c = sq(6, 4, 10);
  for (const loops of [[a, b, c], [c, b, a]]) {
    const front = S.shape('frontminus', loops), back = S.shape('backminus', loops);
    near(front.area, loops[2] === c ? 100 - 24 - 8 + 4 : 100 - 30 - 24 + 4);
    near(back.area, loops[0] === a ? 100 - 30 - 24 + 4 : 100 - 24 - 8 + 4);
    assert.equal(front.target, 2); assert.equal(back.target, 0);
  }
});

test('Create boundary: overlapping squares in either order give one union; disjoint squares give two', () => {
  const a = sq(0, 0, 10), b = sq(5, 5, 10);
  for (const loops of [[a, b], [b, a]]) {
    const r = S.shape('boundary', loops);
    near(r.area, 175); assert.equal(r.rings.length, 1);
  }
  const r = S.shape('boundary', [a, sq(20, 0, 10)]);
  near(r.area, 200); assert.equal(r.rings.length, 2);
});

test('new operations keep the even-odd hole rule and shared failure note', () => {
  for (const op of ['simplify', 'frontminus', 'backminus', 'boundary']) {
    assert.match(S.shape(op, [sq(0, 0, 10), { pts: [] }]).error, /Shaping failed/);
    const r = S.shape(op, [sq(0, 0, 20), sq(5, 5, 10), sq(18, 0, 10)]);
    near(r.area, { simplify: 380, frontminus: 80, backminus: 280, boundary: 380 }[op]);
    if (op === 'simplify' || op === 'boundary') assert.equal(r.rings.length, 2);   // the big one with its hole; the far square is untouched by Simplify
  }
});

// TODO 288a: one outline wholly inside another (a nested pair, nothing else) = two shapes; standard area maths, drawing order = list order
const outer = sq(0, 0, 20), inner = sq(5, 5, 10);
test('nested pair: Weld is the outer outline, Create boundary too', () => {
  for (const op of ['weld', 'boundary']) { const r = S.shape(op, [outer, inner]); assert.equal(r.error, undefined); near(r.area, 400); assert.equal(r.rings.length, 1); }
});
test('nested pair: Trim with the outer as target cuts a hole (2 rings, one source); with the inner as target nothing is left', () => {
  const r = S.shape('trim', [outer, inner], 0);
  near(r.area, 300); assert.equal(r.rings.length, 2); assert.deepEqual(r.sources, [0, 0]);
  const e = S.shape('trim', [outer, inner], 1);
  assert.equal(e.error, undefined); assert.equal(e.rings.length, 0); near(e.area, 0);
});
test('nested pair: Intersect is the inner outline', () => {
  const r = S.shape('intersect', [outer, inner]); near(r.area, 100); assert.equal(r.rings.length, 1);
});
test('nested pair: Simplify gives the back one a hole and keeps the front one; an inner one at the back is covered', () => {
  const r = S.shape('simplify', [outer, inner]);
  assert.equal(r.rings.length, 2); assert.deepEqual(r.sources, [0, 0]); assert.deepEqual(r.untouched, [1]); near(r.area, 400);
  const c = S.shape('simplify', [inner, outer]);
  assert.equal(c.rings.length, 0); assert.deepEqual(c.untouched, [1]); near(c.area, 400);
});
test('nested pair: Front minus back and Back minus front are the area maths, empty when the inner one is cut', () => {
  const f = S.shape('frontminus', [inner, outer]), b = S.shape('backminus', [outer, inner]);
  for (const r of [f, b]) { near(r.area, 300); assert.equal(r.rings.length, 2); }
  for (const r of [S.shape('frontminus', [outer, inner]), S.shape('backminus', [inner, outer])]) { assert.equal(r.error, undefined); assert.equal(r.rings.length, 0); near(r.area, 0); }
});
test('a part with a hole and a separate shape: Weld keeps the hole', () => {
  const r = S.shape('weld', [outer, inner, sq(30, 0, 5)]);
  near(r.area, 300 + 25); assert.equal(r.rings.length, 3);
});

test('drawing entity order wins over selection order and loop discovery order', () => {
  const back = { ...sq(0, 0, 10), ents: new Set([0, 1, 2, 3]) }, front = { ...sq(5, 5, 10), ents: new Set([4]) };
  const r = S.shape('frontminus', [front, back], 1);
  assert.equal(r.operands[r.target].loops[0], 0);
  assert.deepEqual(r.rings, S.shape('trim', [front, back], 0).rings);
  const s = S.shape('simplify', [front, back]);
  assert.deepEqual(s.operands.map((o) => o.loops[0]), [1, 0]);
});

test('goneEntities: an entity shared by a used and an unused loop, or an open line, is kept', () => {
  const loops = [{ ents: new Set([0, 1, 2, 3]) }, { ents: new Set([3, 4, 5]) }, { ents: new Set([6, 7]) }];
  assert.deepEqual([...S.goneEntities(loops, new Set([7]), [0, 2])].sort(), [0, 1, 2, 6]);   // 3 also makes unused loop 1; 7 is also an open line
  assert.deepEqual([...S.goneEntities(loops, new Set(), [])], []);
});

console.log(n + ' passed');
