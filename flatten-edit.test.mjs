import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flatten, flattenEdit, flId, MAX_VISITS, pickAt, pickIndex, readDxf } from './web/drawing.js';
import { addBlock, addEntities, addLayer, circle, insert, line, newDoc, writeDxf } from './web/dxf-write.js';
import { addDimension, makeDimension, moveEntities, removeEntities } from './web/edit.js';
import { bigDoc } from './tools/gen-big-dxf.mjs';

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
  const full = flatten(raw), next = { ...raw, ...dimension(raw) }, near = flattenEdit(raw, next, { ...full, visits: MAX_VISITS - 1 }, new Set());       // the visit budget is the whole drawing's: only a full draw can say it ran out
  assert.ok(near.items.every((it) => !full.items.includes(it)));
  assert.ok(flattenEdit(raw, next, { ...full, visits: MAX_VISITS - 1000 }, new Set()).items[0] === full.items[0], 'with room left it patches');
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

test('356 on a bigger drawing the pick grid is patched (a new insertion snap, a moved one) and equals a fresh grid', () => {
  const raw = readDxf(writeDxf(bigDoc(6000))), fl = flatten(raw);
  const at = raw.entities.findIndex((e, i) => e.type === 'INSERT' && i > 3000), spent = () => ({ ix: pickIndex(fl, false), fl });
  for (const next of [{ ...raw, ...addDimension(raw, makeDimension([100, 100], [180, 100], 1, raw.blocks)) }, { ...raw, ...moveEntities(raw, new Set([at]), 5, -2) }]) {
    const drawn = flattenEdit(raw, next, fl, new Set());
    assert.equal(drawn.items[0], fl.items[0], 'patched');
    const prev = spent(), patched = pickIndex(drawn, false, undefined, undefined, prev), fresh = pickIndex(drawn, false);
    assert.equal(prev.ix.sc, patched.sc, 'the old grid was patched in place, not built again');
    assert.deepEqual(patched.sc, fresh.sc);
    assert.deepEqual(patched.pc, fresh.pc);
    assert.deepEqual([patched.G, patched.head, patched.snaps.length, patched.pieces.length], [fresh.G, fresh.head, fresh.snaps.length, fresh.pieces.length]);
  }
});

test('359d a patch says where it differs (fl.dirty): Move, Delete, add; a full draw and a copy say nothing', () => {
  const raw = drawing(), fl = flatten(raw), hidden = new Set(), box = ({ x0, y0, x1, y1 }) => [x0, y0, x1, y1];
  assert.equal(fl.dirty, undefined, 'a full flatten has no dirty box');
  const moved = flattenEdit(raw, { ...raw, ...moveEntities(raw, new Set([1]), -12, 20) }, fl, hidden), a = fl.items[1].b, b = moved.items[1].b;
  assert.deepEqual(box(moved.dirty), [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])], 'Move: the old box and the new one');
  assert.equal(moved.dirty.from, flId(fl));
  assert.deepEqual(moved.dirty.ents, [1]);
  assert.equal(Object.keys(moved).includes('dirty'), false, 'hidden: equal to a fresh flatten, gone from a copy');
  assert.equal({ ...moved }.dirty, undefined);
  const gone = flattenEdit(raw, { ...raw, ...removeEntities(raw, new Set([1])) }, fl, hidden);
  assert.deepEqual(box(gone.dirty), fl.items[1].b, 'Delete: the old box');
  const next = { ...raw, ...dimension(raw) }, added = flattenEdit(raw, next, fl, hidden), tail = added.items.slice(fl.items.length);
  assert.deepEqual(box(added.dirty), tail.map((it) => it.b).reduce((u, c) => [Math.min(u[0], c[0]), Math.min(u[1], c[1]), Math.max(u[2], c[2]), Math.max(u[3], c[3])]), 'add: the new items');
  assert.deepEqual(added.dirty.ents, []);
  const layered = flattenEdit(raw, { ...raw, ...moveEntities(raw, new Set([1]), 1, 1), layers: { ...raw.layers, Marks: { ...raw.layers.Marks, aci: 1 } } }, fl, hidden);
  assert.equal(layered.dirty, undefined, 'a layer table change is a full flatten');
  assert.equal(flattenEdit(raw, raw, fl, hidden), fl, 'no edit: the same draw, its picture stays');
  assert.ok(moved.dirty.lw >= 0 && Number.isFinite(moved.dirty.w));
});
