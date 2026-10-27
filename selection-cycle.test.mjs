import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cyclePick } from './web/selection-cycle.js';
import { createHistory, hitEntities, makeIndex } from './web/edit.js';
import { newDoc, addEntities, addLayer, line, circle, insert, addBlock, text, lwpoly } from './web/dxf-write.js';
import { flatten, readDxf } from './web/drawing.js';
import { writeDxf } from './web/dxf-write.js';

test('TODO 71c: duplicates cycle topmost first, wrap, and reset by spot, hits, history or explicit clear', () => {
  const doc = newDoc(4);
  addEntities(doc, line(0, 0, 100, 0), line(0, 0, 100, 0));
  const raw = readDxf(writeDxf(doc)), hits = hitEntities(makeIndex(raw, flatten(raw)), 50, 0, 1);
  assert.deepEqual(hits, [1, 0]);
  const hist = createHistory();
  let state = null;
  const pick = (point = [100, 200], list = hits) => (state = cyclePick(state, list, point, 7, hist.revision));
  assert.equal(pick().hit, 1);
  assert.equal(pick([103, 204]).hit, 0);
  assert.equal(pick().hit, 1);
  assert.equal(pick([108, 200]).index, 0, 'another spot starts at the top');
  assert.equal(pick([114, 200]).index, 1);
  assert.equal(pick([120, 200]).index, 0, 'small steps cannot drift the original spot');
  assert.equal(pick([120, 200], [1]).index, 0, 'a changed hit list resets');
  assert.equal(pick([120, 200], []), null);
});

test('TODO 71c: every history edit, undo, redo and clear resets the cycle, even with identical candidates', () => {
  const hist = createHistory(), hits = [2, 1, 0];
  let state;
  const pick = () => (state = cyclePick(state, hits, [10, 20], 7, hist.revision));
  for (const change of [() => hist.push('before'), () => hist.undo('after'), () => hist.redo('before'), () => hist.clear()]) {
    pick(); assert.equal(pick().index, 1);
    change(); assert.equal(pick().index, 0);
    state = null;
  }
  pick(); pick(); state = null;
  assert.equal(pick().index, 0, 'Esc or a tab switch explicitly clears state');
  assert.equal(cyclePick(state, [], [10, 20], 7, hist.revision), null);
});

test('TODO 71c: all hits use real line/arc geometry, area rules, visibility, and one candidate per block', () => {
  const doc = newDoc(4);
  addLayer(doc, 'Hidden');
  addBlock(doc, 'Pair', [line(0, 0, 100, 0), line(0, 0, 100, 0)]);
  addEntities(doc, line(0, 0, 100, 0), circle(50, 50, 50), insert('Pair', 0, 0),
    line(0, 0, 100, 0, { layer: 'Hidden' }), text(50, 0, 5, 'A'),
    lwpoly([[0, 10], [100, 10], [100, 100]]));
  const raw = readDxf(writeDxf(doc)), fl = flatten(raw);
  const off = new Set([fl.layers.findIndex((l) => l.name === 'Hidden')]);
  const ed = makeIndex(raw, fl, off, new Set([4]));
  assert.deepEqual(hitEntities(ed, 50, .5, 1), [2, 1, 0]);
  assert.deepEqual(hitEntities(ed, 50, 50, 1), [], 'empty corners and circle centres miss');
  assert.deepEqual(hitEntities(makeIndex(raw, fl), 51, 1, 1), [4, 3, 2, 1, 0]);
});
