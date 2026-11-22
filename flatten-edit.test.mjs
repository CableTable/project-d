import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flatten, flattenEdit, pickAt, pickIndex, readDxf } from './web/drawing.js';
import { addBlock, addEntities, addLayer, circle, insert, line, newDoc, writeDxf } from './web/dxf-write.js';
import { addDimension, makeDimension, moveEntities, removeEntities } from './web/edit.js';

function drawing() {
  const raw = newDoc(4);
  addLayer(raw, 'Marks', { aci: 3 });
  addBlock(raw, 'Mark', [circle(0, 0, 2, { layer: 'Marks' }), line(0, 0, 0, 2)]);
  addEntities(raw, line(1, 1, 4, 3), line(7, 4, 10, 8), insert('Mark', 14, 14), line(20, 1, 22, 3, { layer: 'Marks' }));
  return readDxf(writeDxf(raw));
}

test('319a Delete patches order, shifted entity indexes and INSERT ranges', () => {
  const raw = drawing(), fl = flatten(raw), hidden = new Set();
  const next = { ...raw, ...removeEntities(raw, new Set([1])) };
  const patched = flattenEdit(raw, next, fl, hidden);
  assert.deepEqual(patched, flatten(next, hidden));
  assert.equal(patched.items[0], fl.items[0], 'keep the unchanged first item');
  assert.equal(patched.items[1].ops, fl.items[2].ops, 'reuse the shifted block geometry');
});

test('319a Move patches only the changed geometry, including the drawing bounds', () => {
  const raw = drawing(), fl = flatten(raw), hidden = new Set();
  const next = { ...raw, ...moveEntities(raw, new Set([1]), -12, 20) };
  const patched = flattenEdit(raw, next, fl, hidden);
  assert.deepEqual(patched, flatten(next, hidden));
  assert.equal(patched.items[2], fl.items[2], 'keep the unchanged block item');
  assert.notDeepEqual(patched.items[1].b, fl.items[1].b);
});

test('319a a changed layer table falls back to the full flatten', () => {
  const raw = drawing(), fl = flatten(raw), hidden = new Set();
  const next = { ...raw, ...moveEntities(raw, new Set([1]), -12, 20), layers: { ...raw.layers, Marks: { ...raw.layers.Marks, aci: 1 } } };
  const drawn = flattenEdit(raw, next, fl, hidden);
  assert.deepEqual(drawn, flatten(next, hidden));
  assert.notEqual(drawn.items[0], fl.items[0], 'rebuild even the unchanged first item');
});

// 319c: the fallbacks of patchEntities (rv-319a gap): each one gives a drawing equal to a fresh flatten, built again (no item kept)
function fallsBack(raw, next) {
  const fl = flatten(raw), drawn = flattenEdit(raw, next, fl, new Set());
  assert.deepEqual(drawn, flatten(next, new Set()));
  assert.ok(drawn.items.every((it) => !fl.items.includes(it)), 'every item is drawn again');
}

test('319c hole-fill: deleting a closed outline while another entity is filled draws everything again', () => {
  const raw = readDxf(writeDxf(Object.assign(newDoc(4), { entities: [circle(0, 0, 9), circle(0, 0, 3), line(20, 0, 30, 0)] })));
  raw.entities[0] = { ...raw.entities[0], fill: 'aci:1' };
  fallsBack(raw, { ...raw, ...removeEntities(raw, new Set([1])) });
});

test('319c block definition changed: draws everything again', () => {
  const raw = drawing(), mark = raw.blocks.Mark;
  fallsBack(raw, { ...raw, blocks: { ...raw.blocks, Mark: { ...mark, entities: mark.entities.slice(1) } } });
});

test('319c the last plain entity on a layer: the layer list could change, so draw everything again', () => {
  const raw = drawing();
  fallsBack(raw, { ...raw, ...removeEntities(raw, new Set([3])) });
});

test('319c a changed linetype table draws everything again', () => {
  const raw = drawing();
  fallsBack(raw, { ...raw, ...moveEntities(raw, new Set([1]), 5, 5), ltypes: { ...raw.ltypes } });
});

test('319c a stale hidden set (d.hid) is no patch: hidden entities draw everything again', () => {
  const raw = drawing(), fl = flatten(raw), hidden = new Set([raw.entities[0]]), next = { ...raw, ...removeEntities(raw, new Set([1])) };
  const drawn = flattenEdit(raw, next, fl, hidden);
  assert.deepEqual(drawn, flatten(next, hidden));
  assert.ok(drawn.items.every((it) => !fl.items.includes(it)));
});

// TODO 356: an added dimension (a new block + its INSERT) and a moved INSERT patch the draw; the result is the full flatten's, item for item
const seen = (fl) => ({ ...fl, mats: null, items: fl.items.map((it) => ({ ...it, m: fl.mats[it.m] })) });      // a patch may number the matrices differently: compare the matrices themselves
const dimension = (raw) => addDimension(raw, makeDimension([1, 1], [4, 3], 1, raw.blocks));
function patches(raw, next, fl = flatten(raw), hidden = new Set()) {
  const drawn = flattenEdit(raw, next, fl, hidden);
  assert.deepEqual(seen(drawn), seen(flatten(next, hidden)));
  assert.equal(drawn.items[0], fl.items[0], 'the unchanged first item is kept: patched, not drawn again');
  return { fl, drawn };
}

test('356 the first dimension adds its layer and its INSERT after the old items', () => {
  const raw = drawing(), fl = flatten(raw);
  assert.ok(!raw.layers.Dimensions && !fl.layers.some((l) => l.name === 'Dimensions'));
  const { drawn } = patches(raw, { ...raw, ...dimension(raw) }, fl);
  assert.equal(drawn.layers.at(-1).name, 'Dimensions');
  assert.ok(drawn.items.length > fl.items.length && drawn.insertions.length > fl.insertions.length);
  assert.equal(fl.layers.length, drawn.layers.length - 1, 'the old drawing is left as it was (Undo)');
});

test('356 a second dimension and an added line patch too', () => {
  const raw = drawing(), first = { ...raw, ...dimension(raw) };
  Object.assign(raw, first);
  const fl = flatten(raw);
  patches(raw, { ...raw, ...addDimension(raw, makeDimension([7, 4], [10, 8], 1, raw.blocks)) }, fl);
  patches(raw, { ...raw, entities: [...raw.entities, line(30, 30, 33, 31, { layer: 'Marks' })] }, fl);
});

test('356 a moved INSERT draws only itself again, its range and insertion point follow', () => {
  const raw = drawing(), fl = flatten(raw), next = { ...raw, ...moveEntities(raw, new Set([2]), 5, -2) };       // entity 2 is the INSERT
  const { drawn } = patches(raw, next, fl);
  assert.equal(drawn.items[1], fl.items[1], 'a line away from it is kept');
  assert.notDeepEqual(drawn.insertions[0].p, fl.insertions[0].p);
  assert.equal(drawn.items.at(-1), fl.items.at(-1), 'the last line is kept');
});

test('356 with a layer switched off: an added line and a moved INSERT patch the same', () => {
  const raw = drawing();
  raw.layers.Marks.off = true;
  const fl = flatten(raw);
  assert.ok(!fl.layers.find((l) => l.name === 'Marks').on);
  patches(raw, { ...raw, entities: [...raw.entities, line(30, 30, 33, 31, { layer: 'Marks' })] }, fl);
  patches(raw, { ...raw, ...moveEntities(raw, new Set([2]), 5, -2) }, fl);
});

test('356 hidden entities (d.hid) draw everything again, with the same result', () => {
  const raw = drawing(), fl = flatten(raw), hidden = new Set([raw.entities[0]]), next = { ...raw, ...dimension(raw) };
  const drawn = flattenEdit(raw, next, fl, hidden);
  assert.deepEqual(drawn, flatten(next, hidden));
  assert.ok(drawn.items.every((it) => !fl.items.includes(it)));
});

test('356 fallbacks: a new block an old INSERT named, a changed block, an added filled outline', () => {
  const raw = drawing(), dim = makeDimension([1, 1], [4, 3], 1, raw.blocks);
  const asked = { ...raw, entities: [...raw.entities, insert(dim.name, 0, 0)] }, was = flatten(asked);       // names a block that is not there yet: draws nothing
  const lateBlock = { ...asked, blocks: { ...raw.blocks, [dim.name]: dim.block } };
  const drawn = flattenEdit(asked, lateBlock, was, new Set());
  assert.deepEqual(seen(drawn), seen(flatten(lateBlock)));
  assert.ok(drawn.items.every((it) => !was.items.includes(it)));
  fallsBack(raw, { ...raw, entities: [...raw.entities, { ...raw.entities[0], fill: 'aci:1' }] });
});

test('356 the pick index after a patch hits what a fresh one does, at 3 points', () => {
  const raw = drawing(), fl = flatten(raw);
  const dim = dimension(raw), moved = moveEntities(raw, new Set([2]), 5, -2);
  for (const [next, points] of [[{ ...raw, ...dim }, [[1, 1], [2.5, 2], [7, 4]]], [{ ...raw, ...moved }, [[19, 12], [19, 14], [10, 6]]]]) {
    const drawn = flattenEdit(raw, next, fl, new Set()), fresh = pickIndex(drawn, false), patched = pickIndex(drawn, false, undefined, undefined, { ix: pickIndex(fl, false), fl });       // the old index is spent by the patch: a new one each time
    for (const [x, y] of points) {
      const a = pickAt(fresh, x, y, 0.5), b = pickAt(patched, x, y, 0.5);
      assert.equal(b.ent?.it, a.ent?.it, `item at ${x}, ${y}`);
      assert.deepEqual(b.snap, a.snap, `snap at ${x}, ${y}`);
    }
    assert.ok(pickAt(fresh, ...points[0], 0.5).ent, 'the first point is on a line');
  }
});
