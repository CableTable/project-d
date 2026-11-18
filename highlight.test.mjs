import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintDrawing } from './web/render.js';

// TODO 323b: the selection overlay strokes runs of items, not one stroke per item (150k selected items took 0.4 s).
const mats = [[1, 0, 0, 1, 0, 0]];
function paint(hl, extra = {}) {
  const calls = [], c = {
    setTransform() {}, clearRect() {}, setLineDash(d) { calls.push(['dash', d.length]); },
    stroke() { calls.push(['stroke']); },
  };
  globalThis.Path2D = class {                    // node has none: the overlay's paths record their calls here (TODO 329a)
    moveTo() { calls.push(['move']); } lineTo() { calls.push(['line']); } arc() { calls.push(['arc']); } closePath() {} rect() { calls.push(['rect']); }
  };
  paintDrawing({ width: 100, height: 100, getContext: () => c }, { fl: { mats, items: [] }, off: new Set(), factor: 1, sheetH: 100,
    ox: 0, oy: 0, scale: 1, w: 100, h: 100, dpr: 1, part: 'over', hl, accent: '#00f', ...extra });
  return calls;
}
const count = (calls, name) => calls.filter((x) => x[0] === name).length;
const line = (cap) => ({ k: 'p', m: 0, ops: [0, 0, 0, 1, 10, 0], b: [0, 0, 10, 0], cap });
const text = { k: 't', m: 0, b: [1, 1, 5, 5] };

test('selection overlay: items of one style share one stroke; a new cap or a text box starts another, an arc-first path gets its own start point', () => {
  let calls = paint([line(), line(), line(), line()]);
  assert.equal(count(calls, 'stroke'), 1);
  assert.equal(count(calls, 'move'), 4); assert.equal(count(calls, 'line'), 4);
  calls = paint([line(), line(), line('round'), text, text]);
  assert.equal(count(calls, 'stroke'), 3, 'butt lines, round line, text boxes');
  assert.equal(count(calls, 'rect'), 2, 'a text item is a rectangle outline');
  calls = paint([line(), { k: 'p', m: 0, ops: [2, 5, 5, 3, 0, 6, 0], b: [2, 2, 8, 8] }, line()]);
  assert.equal(count(calls, 'stroke'), 1);
  assert.deepEqual(calls.filter((x) => x[0] !== 'dash' && x[0] !== 'stroke').map((x) => x[0]), ['move', 'line', 'move', 'arc', 'move', 'line'], 'an arc first in its ops starts with its own move: it must not join the path before it');
  calls = paint([line(), text, line(), text, line()]);
  assert.equal(count(calls, 'stroke'), 2, 'text boxes between paths do not start a stroke each');
});

test('selection overlay: dashed paths stay dashed, text boxes solid, at most 100 items per stroke', () => {
  const calls = paint([line(), text]);
  assert.deepEqual(calls.filter((x) => x[0] === 'dash').map((x) => x[1]), [2, 0]);
  assert.equal(count(paint(Array.from({ length: 101 }, () => line())), 'stroke'), 2);
  assert.equal(count(paint(Array.from({ length: 100 }, () => line())), 'stroke'), 1);
  assert.equal(count(paint([]), 'stroke'), 0);
});

test('selection overlay (329a): above 20 000 selected paths the overlay is solid and thin', () => {
  const widths = (n) => {
    const w = [], c = { setTransform() {}, clearRect() {}, setLineDash(d) { w.push(['dash', d.length]); }, stroke() {}, set lineWidth(x) { w.push(['width', x]); } };
    globalThis.Path2D = class { moveTo() {} lineTo() {} arc() {} closePath() {} rect() {} };
    paintDrawing({ width: 100, height: 100, getContext: () => c }, { fl: { mats, items: [] }, off: new Set(), factor: 1, sheetH: 100,
      ox: 0, oy: 0, scale: 1, w: 100, h: 100, dpr: 1, part: 'over', hl: Array.from({ length: n }, () => line()), accent: '#00f' });
    return w;
  };
  assert.deepEqual(widths(20000).slice(0, 2), [['width', 2.6], ['dash', 2]]);
  assert.deepEqual(widths(20001).slice(0, 2), [['width', 1], ['dash', 0]]);
});

test('selection overlay (329a): the same selection repainted is not rebuilt; a zoom, other items or a changed path are', () => {
  const hl = Array.from({ length: 50 }, () => line());
  assert.equal(count(paint(hl), 'line'), 50);
  const again = paint(hl);
  assert.equal(count(again, 'line'), 0, 'pan / panel toggle: same Path2D');
  assert.equal(count(again, 'stroke'), 1, 'still drawn');
  assert.equal(count(paint(hl, { ox: 20 }), 'line'), 0, 'a pan at the same zoom');
  assert.equal(count(paint(hl, { scale: 2 }), 'line'), 50, 'a zoom');
  assert.equal(count(paint([...hl]), 'line'), 50, 'a new selection');
  paint(hl); hl[7] = line();
  assert.equal(count(paint(hl), 'line'), 50, 'an item replaced in place');
});

test('selection overlay (329a): wireframe strokes the selected paths in runs too (it.ops is not a flag)', () => {
  const hl = Array.from({ length: 20 }, () => ({ k: 'p', m: 0, ops: [0, 0, 0, 1, 10, 0], b: [0, 0, 10, 0] }));
  assert.equal(count(paint(hl, { wireframe: true }), 'stroke'), 1);
  const text2 = Array.from({ length: 4 }, () => ({ k: 't', m: 0, ops: [0, 0, 0, 1, 5, 5], b: [0, 0, 5, 5] }));
  assert.equal(count(paint(text2, { wireframe: true }), 'stroke'), 1, 'text with ops in Wireframe: traced, one run');
  const boxes = paint(text2);
  assert.equal(count(boxes, 'stroke'), 1, 'not in Wireframe: boxes, one run');
  assert.equal(count(boxes, 'rect'), 4);
});
