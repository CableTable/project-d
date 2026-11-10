import assert from 'node:assert/strict';
import test from 'node:test';
const { combine, isCombined, combinedLabel } = await import('./web/combine.js').catch(() => ({}));       // a missing module is a red test, not a load error (tools/base-check.mjs)
import { breakApart } from './web/breakapart.js';
import { newDoc, addLayer, addBlock, addEntities, rect, circle, line, text, insert, writeDxf } from './web/dxf-write.js';
import { readDxf, flatten } from './web/drawing.js';
import { containsFill } from './web/fill.js';
import { COMMANDS } from './web/cmdbar.js';
import { bindings } from './web/shortcuts.js';

// a big square (0..100), a circle inside it, a square crossing its right edge, a loose line; all on different layers
function fixture(fill) {
  const raw = newDoc();
  addLayer(raw, 'Cut', { aci: 3 }); addLayer(raw, 'Holes', { aci: 2 }); addLayer(raw, 'Top', { aci: 5 });
  addEntities(raw, rect(0, 0, 100, 100, { layer: 'Cut', fill }), circle(30, 30, 10, { layer: 'Holes' }), rect(90, 40, 40, 20, { layer: 'Top', aci: 1, lw: 50, lt: 'DASHED' }), line(300, 0, 310, 0));
  return raw;
}
const fills = (raw) => flatten(raw).items.filter((it) => it.fill);
const hatchBlock = () => { const raw = fixture(); raw.entities[0].fill = 'aci:1'; return combine(raw, new Set([1, 0])).blocks['Combined 1']; };       // the filled square is the last pick

test('Combine: one INSERT of "Combined 1" with the picked outlines unchanged on layer 0 / ByBlock, the last pick\'s look on the INSERT', () => {
  const raw = fixture(), before = writeDxf(raw), r = combine(raw, new Set([0, 1, 2]));
  assert.equal(r.error, undefined);
  assert.deepEqual(r.entities.map((e) => e.type), ['INSERT', 'LINE']);
  assert.deepEqual([...r.selected], [0]);
  const ins = r.entities[0], block = r.blocks['Combined 1'];
  assert.deepEqual([ins.layer, ins.aci, ins.lw, ins.lt], ['Top', 1, 50, 'DASHED'], 'the last pick: colour, width, linetype, layer');
  assert.equal(block.entities.length, 3);
  for (const m of block.entities) assert.deepEqual([m.layer, m.aci, m.lw, m.lt], ['0', 0, -2, 'BYBLOCK']);
  assert.equal(block.entities[0].r.v[block.entities[0].r.c.indexOf(10)], raw.entities[0].r.v[raw.entities[0].r.c.indexOf(10)], 'geometry untouched');
  assert.equal(writeDxf(raw), before, 'the source is not mutated');
  assert.equal(combinedLabel(r.blocks, ins), 'Combined (3 outlines)');
  assert.equal(combine({ ...raw, blocks: r.blocks }, new Set([0, 1]), new Set()).name, 'Combined 2', 'next free number');
});

test('isCombined: the name AND only outlines plus at most one HATCH', () => {
  const o = [rect(0, 0, 5, 5)], hatch = hatchBlock().entities[0];
  assert.equal(hatch.type, 'HATCH');
  assert.ok(isCombined('Combined 7', { entities: o }));
  assert.ok(isCombined('Combined 7', { entities: [hatch, ...o] }));
  assert.ok(!isCombined('Plate', { entities: o }), 'name');
  assert.ok(!isCombined('Combined 7', { entities: [hatch, hatch, ...o] }), 'two hatches');
  assert.ok(!isCombined('Combined 7', { entities: [...o, text('x', 0, 0, 2)] }), 'text');
  assert.ok(!isCombined('Combined 7', { entities: [] }));
  assert.ok(!isCombined('Combined 7', { entities: o, xref: true }));
});

test('refused: fewer than 2, text, hatch, ordinary blocks, locked layers, other spaces; the document is untouched', () => {
  const raw = fixture();
  addBlock(raw, 'Plate', [rect(0, 0, 4, 4)]); addEntities(raw, text('Hi', 0, 0, 2), insert('Plate', 5, 5), { ...rect(0, 0, 3, 3), ps: true });
  raw.entities.push(hatchBlock().entities[0]);
  for (const [sel, why] of [[[0], /at least 2/], [[], /at least 2/], [[0, 4], /text/], [[0, 5], /block/], [[0, 7], /hatch/], [[0, 6], /different spaces/]]) {
    assert.match(combine(raw, new Set(sel)).error, why);
  }
  assert.match(combine(raw, new Set([0, 1]), new Set(['Holes'])).error, /locked/);
  assert.equal(raw.entities.length, 8, 'nothing was added or removed');
});

test('a Combined object in the pick is flattened into the new one (members reset to layer 0 / ByBlock); a refused transform is refused', () => {
  const raw = fixture(), one = combine(raw, new Set([0, 1]));
  const doc = { ...raw, entities: one.entities, blocks: one.blocks };           // [Combined 1 (Cut), rect (Top), line]
  assert.equal(doc.entities[0].layer, 'Holes', 'the circle was picked last');
  const two = combine(doc, new Set([1, 0]), new Set());                          // the plain rectangle first, the Combined object last
  assert.equal(two.error, undefined);
  assert.equal(two.entities[0].layer, 'Holes', 'the last pick is the Combined one');
  const members = two.blocks[two.name].entities;
  assert.equal(two.name, 'Combined 2', 'next free number');
  assert.equal(two.blocks['Combined 1'], undefined, 'the flattened block goes');
  assert.equal(members.length, 3);
  for (const m of members) assert.deepEqual([m.layer, m.aci, m.lw, m.lt], ['0', 0, -2, 'BYBLOCK']);
  const bad = { ...doc, entities: [insert('Combined 1', 0, 0, { sx: 0 }), doc.entities[1]], blocks: one.blocks };
  assert.match(combine(bad, new Set([0, 1])).error, /invalid block scale/);
});

test('a fill is ONE even-odd HATCH over every closed member: a nested circle and a crossing overlap are holes, on screen and in the DXF', () => {
  const raw = fixture('aci:2'), r = combine(raw, new Set([0, 1, 2]));      // last pick = the crossing square, no fill => no fill
  assert.equal(r.filled, false);
  const raw2 = fixture(); raw2.entities[2].fill = 'aci:1';
  const f = combine(raw2, new Set([0, 1, 2]));
  assert.equal(f.filled, true);
  const block = f.blocks['Combined 1'];
  assert.deepEqual(block.entities.map((e) => e.type), ['HATCH', 'LWPOLYLINE', 'CIRCLE', 'LWPOLYLINE']);
  assert.ok(block.entities.slice(1).every((m) => !m.fill), 'the members carry no fill of their own');
  const doc = { ...raw2, entities: f.entities, blocks: f.blocks }, shown = fills(doc);
  assert.equal(shown.length, 1);
  assert.ok(containsFill(shown[0].ops, [10, 10]), 'in the big square');
  assert.ok(!containsFill(shown[0].ops, [30, 30]), 'nested circle: hole');
  assert.ok(!containsFill(shown[0].ops, [95, 50]), 'crossing overlap: hole');
  assert.ok(containsFill(shown[0].ops, [120, 50]), 'the crossing square outside the big one: filled');
  const back = readDxf(writeDxf(doc));
  assert.deepEqual(back.blocks['Combined 1'].entities.map((e) => e.type), ['HATCH', 'LWPOLYLINE', 'CIRCLE', 'LWPOLYLINE'], 'saved and reopened: still one HATCH inside the block');
  assert.ok(isCombined('Combined 1', back.blocks['Combined 1']));
  assert.equal(fills(back).length, 1);
  assert.ok(!containsFill(fills(back)[0].ops, [95, 50]));
  assert.equal(writeDxf(back).split('\n').filter((l) => l.trim() === 'HATCH').length, 1, 'one HATCH written');
});

test('an own block "Combined x" holding text is no Combined object: saved and reopened, its fill is linked', () => {
  const raw = newDoc();
  addBlock(raw, 'Combined x', [rect(0, 0, 10, 10, { fill: 'aci:1' }), text(1, 1, 2, 'hi')]);
  addEntities(raw, insert('Combined x', 0, 0));
  const back = readDxf(writeDxf(raw)), types = back.blocks['Combined x'].entities.map((e) => e.type);
  assert.ok(!types.includes('HATCH'), 'HATCH folded into the outline: ' + types);
  assert.equal(back.blocks['Combined x'].entities.find((e) => e.type === 'LWPOLYLINE').fill, 'aci:1');
  assert.equal(fills(back).length, 1);
});

test('Break Apart on a Combined object drops the HATCH and every closed member comes back filled; other copies keep theirs', () => {
  const raw = fixture(); raw.entities[2].fill = 'aci:1';
  const f = combine(raw, new Set([0, 1, 2])), doc = { ...raw, entities: [...f.entities, insert('Combined 1', 500, 0, { layer: 'Cut' })], blocks: f.blocks };
  const r = breakApart(doc, new Set([0]));
  assert.equal(r.error, undefined);
  assert.deepEqual(r.entities.map((e) => e.type), ['LWPOLYLINE', 'CIRCLE', 'LWPOLYLINE', 'LINE', 'INSERT']);
  assert.deepEqual(r.entities.slice(0, 3).map((e) => e.fill), ['aci:1', 'aci:1', 'aci:1']);
  assert.deepEqual(r.entities.slice(0, 3).map((e) => e.layer), ['Top', 'Top', 'Top'], 'the Combined object\'s layer');
  assert.deepEqual([...r.selected], [0, 1, 2]);
  assert.equal(r.blocks['Combined 1'].entities[0].type, 'HATCH', 'the other copy keeps its fill');
  const plain = fixture(), c = combine(plain, new Set([0, 1, 2])), p = breakApart({ ...plain, entities: c.entities, blocks: c.blocks }, new Set([0]));
  assert.ok(p.entities.slice(0, 3).every((e) => !e.fill), 'no fill, none comes back');
  const byBlock = fixture(); byBlock.entities[2].fill = 'byblock'; byBlock.entities[2].aci = 1;
  const b = combine(byBlock, new Set([0, 1, 2]));
  assert.equal(b.blocks['Combined 1'].entities[0].aci, 256, 'a ByBlock fill outside a block is the layer colour: ByLayer in the block');
});

test('a filled Combined object picked last keeps its fill when flattened; picked earlier, the last pick\'s (no) fill wins; a mirrored one flattens', () => {
  const raw = fixture(); raw.entities[0].fill = 'aci:1';
  const one = combine(raw, new Set([1, 0])), mirrored = { ...raw, entities: [{ ...one.entities[0], r: { ...one.entities[0].r, c: [...one.entities[0].r.c, 41, 42], v: [...one.entities[0].r.v, '-1', '1'] } }, raw.entities[2]], blocks: one.blocks };
  const keep = combine(mirrored, new Set([1, 0]));
  assert.equal(keep.error, undefined);
  const hatch = keep.blocks[keep.name].entities[0];
  assert.equal(hatch.type, 'HATCH'); assert.equal(hatch.aci, 1);
  assert.equal(keep.blocks[keep.name].entities.length, 4, 'one HATCH, the square, the circle, the crossing square');
  assert.equal(combine(mirrored, new Set([0, 1])).filled, false, 'the last pick (plain, no fill) wins');
});

test('Combine is a command with Ctrl+L, its own key wins over the new default', () => {
  assert.ok(COMMANDS.some((c) => c.name === 'combine' && c.key === 'Ctrl+L'));
  assert.equal(bindings({ line: { key: 'Ctrl+L' } }).combine.key, '');
  assert.equal(bindings({}).combine.key, 'Ctrl+L');
});
