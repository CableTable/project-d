import assert from 'node:assert/strict';
import test from 'node:test';
const { combine, isCombined, combinedLabel, fillCombined = () => null } = await import('./web/combine.js').catch(() => ({}));       // a missing module is a red test, not a load error (tools/base-check.mjs)
import { breakApart } from './web/breakapart.js';
import { newDoc, addLayer, addBlock, addEntities, rect, circle, line, text, insert, writeDxf } from './web/dxf-write.js';
import { readDxf, flatten } from './web/drawing.js';
import { containsFill, fillHatch, hatchKey } from './web/fill.js';
import { COMMANDS } from './web/cmdbar.js';
import { bindings } from './web/shortcuts.js';
import * as LD from './web/layoutdoc.js';

// a big square (0..100), a circle inside it, a square crossing its right edge, a loose line; all on different layers
function fixture(fill) {
  const raw = newDoc();
  addLayer(raw, 'Cut', { aci: 3 }); addLayer(raw, 'Holes', { aci: 2 }); addLayer(raw, 'Top', { aci: 5 });
  addEntities(raw, rect(0, 0, 100, 100, { layer: 'Cut', fill }), circle(30, 30, 10, { layer: 'Holes' }), rect(90, 40, 40, 20, { layer: 'Top', aci: 1, lw: 50, lt: 'DASHED' }), line(300, 0, 310, 0));
  return raw;
}
const fills = (raw) => flatten(raw).items.filter((it) => it.fill);
const hatchBlock = () => { const raw = fixture(); raw.entities[0].fill = 'aci:1'; return combine(raw, new Set([1, 0])).blocks['Combined 1']; };       // the filled square is the last pick

test('TODO 257: Combined fill is immutable, copy-on-write, even-odd in either order, and per-part on layouts', () => {
  for (const innerFirst of [false, true]) for (const initial of [null, 'aci:1']) for (const key of ['aci:1', 'aci:5', 'tc:16746496', 'bylayer', 'byblock', null]) {
    const raw = newDoc(), members = [rect(0, 0, 100, 100), circle(30, 30, 10)];
    if (innerFirst) members.reverse();
    addLayer(raw, 'Target', { aci: 3 });
    addBlock(raw, 'Combined 1', initial ? [fillHatch({ ...members[0], fill: initial }, members.slice(1)), ...members] : members);
    addBlock(raw, 'combined 2', [line(0, 0, 10, 0)]);
    addEntities(raw, insert('Combined 1', 0, 0, { layer: 'Target' }), insert('Combined 1', 200, 0));
    const e = raw.entities[0], before = writeDxf(raw), r = fillCombined(raw, e, key);
    assert.ok(r, 'Combined INSERT accepted');
    assert.equal(writeDxf(raw), before, 'source and shared copy untouched');
    const name = r.entity.r.v[r.entity.r.c.indexOf(2)], h = r.blocks[name].entities.find((x) => x.type === 'HATCH');
    assert.equal(h ? hatchKey(h) : null, key);
    if (key === initial) { assert.equal(r.entity, e, 'no-op'); continue; }
    assert.equal(name, 'Combined 3', 'case-insensitive free name');
    assert.equal(r.blocks['Combined 1'], raw.blocks['Combined 1']);
    if (key) {
      assert.equal(r.blocks[name].entities[0], h);
      const fl = flatten({ ...raw, entities: [r.entity], blocks: r.blocks }), f = fl.items.find((it) => it.fill);
      assert.ok(containsFill(f.ops, [10, 10])); assert.ok(!containsFill(f.ops, [30, 30]), 'hole in either member order');
      if (key === 'bylayer') assert.equal(f.css, '#00ff00');
      assert.ok(breakApart({ ...raw, blocks: r.blocks, entities: [r.entity] }, new Set([0])).entities.every((x) => x.fill === (key === 'byblock' ? 'bylayer' : key)));
    }
    const lay = LD.newLayout('257'), part = LD.objectPart('a', 'Ring', e, raw.layers, raw.header, raw.blocks);
    lay.layers = raw.layers; lay.parts.a = part; lay.placed.push(LD.objectPlacement(part), { ...LD.objectPlacement(part), x: 200 });
    const reopened = LD.layoutFromRaw(readDxf(writeDxf(LD.layoutRaw(lay))));
    assert.equal(LD.layersOf(reopened).Target?.aci, 3, 'reopened block object keeps its own layer colour');
    const view = LD.objectDoc(lay), next = fillCombined(view.raw, view.raw.entities[0], key, false);
    assert.equal(next.entity.r.v[next.entity.r.c.indexOf(2)], 'Combined 1', 'layout leaves block copying to objectReplace');
    view.raw.blocks = next.blocks;
    assert.ok(LD.objectReplace(lay, view, view.raw.entities[0], next.entity, () => 'b'));
    assert.equal(lay.parts.a, part, 'other placement retains the original part');
    assert.equal(lay.placed[0].partId, 'b');
    const own = lay.parts.b.raw.blocks['Combined 1'].entities.find((x) => x.type === 'HATCH');
    assert.equal(own ? hatchKey(own) : null, key);
  }
  const raw = newDoc(), e = insert('Combined 1', 0, 0);
  addBlock(raw, 'Combined 1', [line(0, 0, 10, 0)]); addEntities(raw, e);
  assert.equal(fillCombined(raw, e, 'aci:1'), null, 'open-only Combined skipped');
  addBlock(raw, 'Combined 1', [rect(0, 0, 10, 10)]);
  assert.equal(fillCombined(raw, { ...e, kids: [{}] }, 'aci:1'), null, 'attributes disqualify Combined');
  addBlock(raw, 'Ordinary', [rect(0, 0, 10, 10)]);
  assert.equal(fillCombined(raw, insert('Ordinary', 0, 0), 'aci:1'), null, 'ordinary block skipped');
  const r = fillCombined(raw, e, 'aci:1');
  assert.equal(r.entity.r.v[r.entity.r.c.indexOf(2)], 'Combined 1', 'unshared block keeps its name');
});

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

// ---- 218b: layouts ----
function layoutOf() {       // a (big square, g1), b (circle inside it, g1), c (crossing square), d (a line): loose layout objects
  const lay = LD.newLayout('Objs'), layers = LD.layersOf(lay);
  const mk = (id, ent, extra) => { const o = LD.objectPart(id, id, ent, layers); lay.parts[id] = o; lay.placed.push({ ...LD.objectPlacement(o), ...extra }); };
  mk('a', rect(0, 0, 100, 100), { g: 'g1' }); mk('b', circle(30, 30, 10), { g: 'g1', lock: false }); mk('c', { ...rect(90, 40, 40, 20), fill: 'aci:1' }, {}); mk('d', line(300, 0, 310, 0), {});
  return lay;
}
const combineOn = (lay, picks, newId = () => 'n1') => {
  const v = LD.objectDoc(lay), r = combine(v.raw, new Set(picks.map((i) => i)), new Set(), LD.dimensionNames(lay).taken);
  if (!r.error) LD.objectCommit(lay, v, r.entities, newId, r.heir, { ...v.raw.blocks, ...r.blocks });
  return { v, r };
};

test('layout Combine: the result is one block object "Combined n" in the heir\'s (last pick\'s) slot and group; its block comes with it (it was lost before)', () => {
  const lay = layoutOf(), { r } = combineOn(lay, [0, 2, 1]);       // the circle (in g1) is picked last
  assert.equal(r.error, undefined);
  assert.equal(r.heir.type, 'CIRCLE');
  assert.equal(lay.placed.length, 2);
  assert.equal(lay.placed[0].partId, 'n1', 'in the heir\'s slot'); assert.equal(lay.placed[1].partId, 'd');
  const part = lay.parts[lay.placed[0].partId];
  assert.equal(part.name, 'Combined 1', 'named "Combined n" like Line 1 (not the heir\'s name)');
  assert.deepEqual(Object.keys(part.raw.blocks), ['Combined 1'], 'the new block is in the part');
  assert.equal(lay.placed[0].g, 'g1', 'the heir\'s group');
  assert.deepEqual(Object.keys(lay.parts).sort(), ['d', 'n1'], 'the members\' parts are gone');
  const v2 = LD.objectDoc(lay);
  assert.deepEqual(v2.raw.entities.map((e) => e.type), ['INSERT', 'LINE']);
  assert.equal(combinedLabel(v2.raw.blocks, v2.raw.entities[0]), 'Combined (3 outlines)');
});

test('layout Combine: the number is picked against every part\'s blocks; the file keeps the Combined object (and its even-odd fill) on reopen', () => {
  const lay = layoutOf(), other = LD.objectPart('x', 'x', insert('Combined 1', 500, 0), LD.layersOf(lay), {}, { 'Combined 1': { base: [0, 0], xref: false, entities: [rect(0, 0, 5, 5)] } });
  lay.parts.x = other; lay.placed.push(LD.objectPlacement(other));       // another object already owns the block name "Combined 1"
  const { r } = combineOn(lay, [0, 1, 2]);
  assert.equal(r.name, 'Combined 2');
  assert.equal(r.filled, true);
  const back = LD.layoutFromRaw(readDxf(writeDxf(LD.layoutRaw(lay))));
  const v = LD.objectDoc(back), ins = v.raw.entities.filter((e) => e.type === 'INSERT');
  assert.equal(ins.length, 2, 'both block objects are still there: ' + v.raw.entities.map((e) => e.type));
  assert.ok(ins.some((e) => combinedLabel(v.raw.blocks, e) === 'Combined (3 outlines)'));
  assert.equal(flatten(v.raw).items.filter((it) => it.fill).length, 1, 'one fill over the three');
  const sheet = flatten(LD.layoutRaw(back)).items.filter((it) => it.fill);       // what a layout's PDF / print draws (even-odd)
  assert.equal(sheet.length, 1);
  assert.ok(containsFill(sheet[0].ops, [10, 10]), 'in the big square'); assert.ok(!containsFill(sheet[0].ops, [30, 30]), 'nested circle: hole'); assert.ok(!containsFill(sheet[0].ops, [95, 50]), 'crossing overlap: hole');
});

test('layout Break Apart of a Combined object: its outlines come back in its slot and group, the part and block go, the fill is per closed member', () => {
  const lay = layoutOf(); combineOn(lay, [0, 2, 1]);
  const v = LD.objectDoc(lay), ent = v.raw.entities[0], r = breakApart(v.raw, new Set([0]));
  assert.equal(r.error, undefined);
  LD.objectCommit(lay, v, r.entities, (() => { let n = 0; return () => 'p' + n++; })(), ent, r.blocks);
  assert.equal(lay.placed.length, 4);
  assert.deepEqual(lay.placed.map((p) => p.g || null), ['g1', 'g1', 'g1', null], 'the pieces stay in the group');
  assert.ok(!Object.values(lay.parts).some((p) => /^Combined/.test(p.name)), 'no Combined part is left');
  assert.deepEqual(LD.objectDoc(lay).raw.entities.map((e) => e.type), ['LWPOLYLINE', 'CIRCLE', 'LWPOLYLINE', 'LINE']);
});
