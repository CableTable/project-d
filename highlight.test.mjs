import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintDrawing } from './web/render.js';

// TODO 323b: the selection overlay strokes runs of items, not one stroke per item (150k selected items took 0.4 s).
function paint(hl) {
  const calls = [], c = {
    setTransform() {}, clearRect() {}, setLineDash(d) { calls.push(['dash', d.length]); }, beginPath() { calls.push(['begin']); },
    moveTo() { calls.push(['move']); }, lineTo() { calls.push(['line']); }, arc() { calls.push(['arc']); }, closePath() {},
    rect() { calls.push(['rect']); }, stroke() { calls.push(['stroke']); },
  };
  paintDrawing({ width: 100, height: 100, getContext: () => c }, { fl: { mats: [[1, 0, 0, 1, 0, 0]], items: [] }, off: new Set(), factor: 1, sheetH: 100,
    ox: 0, oy: 0, scale: 1, w: 100, h: 100, dpr: 1, part: 'over', hl, accent: '#00f' });
  return calls;
}
const count = (calls, name) => calls.filter((x) => x[0] === name).length;
const line = (cap) => ({ k: 'p', m: 0, ops: [0, 0, 0, 1, 10, 0], b: [0, 0, 10, 0], cap });
const text = { k: 't', m: 0, b: [1, 1, 5, 5] };

test('selection overlay: items of one style share one stroke; a new cap, a text box or an arc-first path starts another', () => {
  let calls = paint([line(), line(), line(), line()]);
  assert.equal(count(calls, 'stroke'), 1);
  assert.equal(count(calls, 'move'), 4); assert.equal(count(calls, 'line'), 4);
  calls = paint([line(), line(), line('round'), text, text]);
  assert.equal(count(calls, 'stroke'), 3, 'butt lines, round line, text boxes');
  assert.equal(count(calls, 'rect'), 2, 'a text item is a rectangle outline');
  calls = paint([line(), { k: 'p', m: 0, ops: [2, 5, 5, 3, 0, 6, 0], b: [2, 2, 8, 8] }, line()]);
  assert.equal(count(calls, 'stroke'), 2, 'an arc first in its ops must not join the path before it (the line after it starts with a move)');
});

test('selection overlay: dashed paths stay dashed, text boxes solid, at most 5000 items per stroke', () => {
  const calls = paint([line(), text]);
  assert.deepEqual(calls.filter((x) => x[0] === 'dash').map((x) => x[1]), [2, 0]);
  assert.equal(count(paint(Array.from({ length: 5001 }, () => line())), 'stroke'), 2);
  assert.equal(count(paint(Array.from({ length: 5000 }, () => line())), 'stroke'), 1);
  assert.equal(count(paint([]), 'stroke'), 0);
});
