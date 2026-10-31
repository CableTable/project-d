import assert from 'node:assert/strict';
import test from 'node:test';
import { explodePolyline, explodeInsert, explodeSelection } from './web/explode.js';
import { newDoc, addLayer, addBlock, addEntities, line, arc, circle, ellipse, lwpoly, insert, entity, text, writeDxf } from './web/dxf-write.js';
import { get } from './web/grips.js';
import { flatten, mapply, readDxf, pickIndex } from './web/drawing.js';
import { resolve } from './web/cmdbar.js';
import { buildDim, addDimension, moveEntities } from './web/edit.js';
import * as LD from './web/layoutdoc.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
const numbers = (e, codes) => codes.map((c) => get(e.r, c));
const nearAll = (a, b) => { assert.equal(a.length, b.length); a.forEach((v, i) => near(v, b[i])); };
const options = { layer: 'Cut', aci: 3, tc: 0x123456, lt: 'DASHED', lw: 35, lts: 2, ps: true };
const blockDoc = (members, at = {}) => {
  const doc = newDoc(); addLayer(doc, 'Cut', { aci: 5 }); addLayer(doc, 'Own', { aci: 2 });
  addBlock(doc, 'B', members, [1, 2]); addEntities(doc, insert('B', 10, 20, { layer: 'Cut', ...at }));
  return doc;
};
const result = (doc) => explodeInsert(doc.entities[0], doc);

test('bulge becomes an exact ARC; straight segments and all common properties survive', () => {
  const e = lwpoly([[0, 0, 1], [10, 0], [10, 5]], options), before = structuredClone(e);
  const pieces = explodePolyline(e);
  assert.deepEqual(pieces.map((e) => e.type), ['ARC', 'LINE']);
  nearAll(numbers(pieces[0], [10, 20, 40, 50, 51]), [5, 0, 5, 180, 0]);
  nearAll(numbers(pieces[1], [10, 20, 11, 21]), [10, 0, 10, 5]);
  for (const p of pieces) for (const [key, value] of Object.entries(options)) assert.equal(p[key], value);
  assert.deepEqual(e, before, 'source is immutable');
  nearAll(numbers(explodePolyline(lwpoly([[0, 0, -1], [10, 0]]))[0], [10, 20, 40, 50, 51]), [5, 0, 5, 0, 180]);
  const quarter = explodePolyline(lwpoly([[5, 0, Math.tan(Math.PI / 8)], [0, 5]]))[0];
  nearAll(numbers(quarter, [10, 20, 40, 50, 51]), [0, 0, 5, 0, 90]);
});

test('closed lightweight and legacy polylines include the closing segment, including its bulge', () => {
  const lw = lwpoly([[0, 0], [10, 0], [10, 10, 1]], { closed: true });
  const old = entity('POLYLINE', [[70, 1]]);
  old.kids = [[0, 0, 0], [10, 0, 0], [10, 10, 1]].map(([x, y, b]) => entity('VERTEX', [[10, x], [20, y], [42, b]]).r);
  for (const source of [lw, old]) {
    const pieces = explodePolyline(source);
    assert.deepEqual(pieces.map((e) => e.type), ['LINE', 'LINE', 'ARC']);
    nearAll(numbers(pieces[2], [10, 20, 40]), [5, 5, Math.sqrt(50)]);
  }
  assert.equal(explodePolyline(lwpoly([[0, 0], [10, 0]], { closed: true })).length, 2);
});

test('insert applies base point, translation, rotation and non-uniform mirrored scale', () => {
  const doc = blockDoc([line(2, 3, 4, 5)], { sx: -2, sy: 3, rot: 90 }), before = structuredClone(doc);
  const pieces = result(doc).entities;
  nearAll(numbers(pieces[0], [10, 20, 11, 21]), [7, 18, 1, 14]);
  assert.deepEqual(doc, before);
});

test('layer 0 and BYBLOCK inherit; named layers, explicit colours and BYLAYER stay their own', () => {
  const doc = blockDoc([line(1, 2, 3, 2, { aci: 0, lt: 'BYBLOCK', lw: -2 }), line(1, 3, 3, 3, { layer: 'Own', aci: 0 }), line(1, 4, 3, 4, { layer: 'Own', aci: 1 }), line(1, 5, 3, 5, { layer: 'Own' })], { aci: 256, lt: 'DASHED', lw: 35 });
  let pieces = result(doc).entities;
  assert.deepEqual(pieces.map((e) => [e.layer, e.aci]), [['Cut', 5], ['Own', 5], ['Own', 1], ['Own', 256]]);
  assert.equal(pieces[0].lt, 'DASHED'); assert.equal(pieces[0].lw, 35);
  doc.entities[0].tc = 0xabcdef;
  pieces = result(doc).entities;
  assert.equal(pieces[0].tc, 0xabcdef); assert.equal(pieces[1].tc, 0xabcdef); assert.equal(pieces[2].tc, null);
});

test('a nested insert stays one INSERT; another Explode releases its members at the same position', () => {
  const doc = blockDoc([insert('Inner', 3, 4, { sx: -1, sy: 2, rot: 90, aci: 0 })], { sx: -2, sy: 3, rot: 90, aci: 1 });
  addBlock(doc, 'Inner', [line(0, 0, 2, 1, { aci: 0 })]);
  const first = result(doc);
  assert.equal(first.entities.length, 1); assert.equal(first.entities[0].type, 'INSERT');
  const second = explodeInsert(first.entities[0], { ...doc, ...first });
  nearAll(numbers(second.entities[0], [10, 20, 11, 21]), [4, 16, 10, 20]);
  assert.equal(second.entities[0].layer, 'Cut'); assert.equal(second.entities[0].aci, 1);
});

test('a sheared nested insert keeps its level, geometry and colour across Save and a second Explode', () => {
  const doc = blockDoc([insert('Inner', 3, 4, { rot: 35, aci: 0 })], { sx: -2, sy: 3, rot: 90, aci: 1 });
  addBlock(doc, 'Inner', [line(0, 0, 2, 1, { aci: 0 })], [1, 1]);
  const original = flatten(doc), first = result(doc);
  assert.deepEqual(first.entities.map((e) => e.type), ['INSERT']);
  const saved = readDxf(writeDxf({ ...doc, ...first }));
  const second = explodeInsert(saved.entities[0], saved).entities;
  const item = original.items[0], m = original.mats[item.m];
  const expected = [...mapply(m, 0, 0), ...mapply(m, 2, 1)];
  numbers(second[0], [10, 20, 11, 21]).forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 2e-6));
  assert.equal(second[0].aci, 1); assert.equal(second[0].layer, 'Cut');
});

test('stretched circles and arcs become exact ellipses, with mirrored arc ends and sweep', () => {
  const doc = blockDoc([circle(1, 2, 2), arc(1, 2, 2, 0, 90)], { sx: -2, sy: 3, rot: 90 });
  const [full, part] = result(doc).entities;
  assert.equal(full.type, 'ELLIPSE'); assert.equal(part.type, 'ELLIPSE');
  nearAll(numbers(full, [10, 20, 11, 21, 40, 41, 42]), [10, 20, 6, 0, 2 / 3, 0, 2 * Math.PI]);
  const at = (t) => [get(part.r, 10) + get(part.r, 11) * Math.cos(t) - get(part.r, 21) * get(part.r, 40) * Math.sin(t), get(part.r, 20) + get(part.r, 21) * Math.cos(t) + get(part.r, 11) * get(part.r, 40) * Math.sin(t)];
  nearAll(at(get(part.r, 41)), [4, 20]); nearAll(at(get(part.r, 42)), [10, 16]);
  const round = result(blockDoc([arc(1, 2, 2, 0, 90)], { sx: -2, sy: 2, rot: 90 })).entities[0];
  assert.equal(round.type, 'ARC'); nearAll(numbers(round, [40, 50, 51]), [4, 180, 270]);
});

test('block arrays, text and an elliptical member retain their geometry', () => {
  const doc = blockDoc([line(1, 2, 2, 2), text(1, 2, 2, 'Label'), ellipse(1, 2, 3, 0, .5)], { sx: 2, sy: 2, rot: 90, cols: 2, dx: 10 });
  const pieces = result(doc).entities;
  assert.equal(pieces.length, 6);
  nearAll(numbers(pieces[0], [10, 20, 11, 21]), [10, 20, 10, 22]);
  nearAll(numbers(pieces[3], [10, 20, 11, 21]), [10, 30, 10, 32]);
  nearAll(numbers(pieces[1], [10, 20, 40, 50]), [10, 20, 4, 90]);
  assert.equal(pieces[2].type, 'ELLIPSE'); near(get(pieces[2].r, 40), .5);
});

test('Explode drops ATTRIB values and releases transformed ATTDEFs on their definition layers', () => {
  const doc = blockDoc([line(1, 2, 2, 2),
    entity('ATTDEF', [[10, 2], [20, 3], [11, 2], [21, 3], [40, 2], [2, 'TAG'], [1, 'Default'], [70, 1], [72, 1], [74, 2]], { layer: 'Own' }),
    entity('ATTDEF', [[10, 1], [20, 2], [40, 1], [2, 'ZERO'], [1, 'Default']], { layer: '0' }),
  ], { rot: 90, sx: 2, sy: 3 });
  doc.entities[0].kids = [entity('ATTRIB', [[10, 25], [20, 35], [40, 2], [1, 'Value'], [62, 2]], { layer: 'Own' }).r];
  const pieces = result(doc).entities;
  assert.deepEqual(pieces.map((e) => e.type), ['LINE', 'ATTDEF', 'ATTDEF']);
  assert.deepEqual(pieces.map((e) => e.layer), ['Cut', 'Own', '0']);
  nearAll(numbers(pieces[1], [10, 20, 11, 21, 40, 50]), [7, 22, 7, 22, 6, 90]);
  near(get(pieces[1].r, 41), 2 / 3);
  assert.equal(get(pieces[1].r, 70), 1); assert.equal(get(pieces[1].r, 74), 2);
  assert.deepEqual(flatten({ ...doc, entities: pieces }).items.filter((it) => it.k === 't').map((it) => it.lines[0]), ['TAG', 'ZERO']);
});

test('BURST keeps all values as visible TEXT on the insert layer, with TEXT vertical alignment and valid saved subclasses', () => {
  const doc = blockDoc([line(1, 2, 2, 2), entity('ATTDEF', [[10, 1], [20, 2], [40, 2], [2, 'TAG'], [1, 'Default']])], { rot: 90, sx: 2, sy: 3 });
  doc.entities[0].kids = [
    entity('ATTRIB', [[10, 25], [20, 35], [40, 2], [1, 'Shown'], [70, 0], [73, 5], [74, 2]], { layer: 'Own' }).r,
    entity('ATTRIB', [[10, 25], [20, 35], [40, 2], [1, 'Hidden'], [70, 1]], { layer: 'Own' }).r,
    entity('ATTRIB', [[10, 25], [20, 35], [40, 2], [1, 'Invisible'], [60, 1]], { layer: 'Own' }).r,
  ];
  const loaded = readDxf(writeDxf(doc)), before = structuredClone(loaded);
  const r = explodeSelection(loaded, new Set([0]), new Set(), true), pieces = r.entities;
  assert.deepEqual(pieces.map((e) => e.type), ['LINE', 'TEXT', 'TEXT', 'TEXT']);
  assert.ok(pieces.every((e) => e.layer === 'Cut' && !e.hidden));
  assert.deepEqual(pieces.slice(1).map((e) => e.r.v[e.r.c.indexOf(1)]), ['Shown', 'Hidden', 'Invisible']);
  nearAll(numbers(pieces[1], [10, 20, 40]), [25, 35, 2]);
  assert.equal(get(pieces[1].r, 73), 2); assert.equal(get(pieces[1].r, 74), null); assert.equal(get(pieces[1].r, 70), null);
  const saved = readDxf(writeDxf({ ...loaded, ...r }));
  assert.ok(saved.entities.slice(1).every((e) => !e.r.v.includes('AcDbAttribute') && e.r.v.includes('AcDbText')));
  assert.deepEqual(flatten(saved).items.filter((it) => it.k === 't').map((it) => it.lines[0]), ['Shown', 'Hidden', 'Invisible']);
  assert.deepEqual(loaded, before);
  assert.equal(explodeSelection(loaded, new Set([0]), new Set(['Cut']), true).skipped, 1);
  assert.equal(resolve('BURST', 'draw').name, 'burst'); assert.equal(resolve('BURST', 'layout').name, 'burst');
  loaded.entities[0].kids[0].v[loaded.entities[0].kids[0].c.indexOf(1)] = 'Edited source value';
  loaded.blocks.B.entities[0].r.v[loaded.blocks.B.entities[0].r.c.indexOf(11)] = '999';
  assert.equal(pieces[1].r.v[pieces[1].r.c.indexOf(1)], 'Shown');
  assert.notEqual(get(pieces[0].r, 11), 999, 'editing the source after BURST leaves its loose results fixed');
});

test('BURST without attributes is Explode; nested inserts keep their attributes, including under shear', () => {
  const inner = insert('Inner', 3, 4, { rot: 35 });
  inner.kids = [entity('ATTRIB', [[10, 4], [20, 5], [40, 2], [1, 'Inner value'], [2, 'INNER'], [70, 1]]).r];
  for (const sx of [2, 3]) {
    const doc = blockDoc([inner], { sx, sy: 3, rot: 90 });
    addBlock(doc, 'Inner', [line(0, 0, 2, 1), entity('ATTDEF', [[10, 1], [20, 1], [40, 2], [2, 'INNER'], [1, 'Default']])]);
    const plain = explodeInsert(doc.entities[0], doc), burst = explodeInsert(doc.entities[0], doc, true);
    assert.deepEqual(burst, plain);
    assert.deepEqual(burst.entities.map((e) => e.type), ['INSERT']);
    const nested = burst.entities[0];
    assert.equal(nested.kids.length, 1); assert.equal(nested.kids[0].type, 'ATTRIB');
    assert.equal(nested.kids[0].v[nested.kids[0].c.indexOf(1)], 'Inner value');
    assert.equal(get(nested.kids[0], 70), 1);
    nearAll([get(nested.kids[0], 10), get(nested.kids[0], 20)], [1, 20 + 3 * sx]);
    const again = explodeInsert(nested, { ...doc, ...burst }, true);
    assert.deepEqual(again.entities.map((e) => e.type), ['LINE', 'TEXT']);
    doc.entities[0].kids = [entity('ATTRIB', [[10, 25], [20, 35], [40, 2], [1, 'Outer value']]).r];
    assert.deepEqual(explodeInsert(doc.entities[0], doc, true).entities.map((e) => e.type), ['INSERT', 'TEXT']);
  }
});

test('loose invisible ATTDEF draws its tag with TEXT styling, can move and supplies an insertion snap; definitions inside blocks stay undrawn', () => {
  const pairs = [[10, 10], [20, 20], [11, 30], [21, 40], [40, 3], [50, 35], [41, 1.5], [71, 2], [72, 1], [74, 2], [7, 'Standard'], [70, 1], [2, 'TAG'], [1, 'Default']];
  const doc = newDoc(), att = entity('ATTDEF', pairs);
  addEntities(doc, att);
  const fl = flatten(doc), it = fl.items[0];
  const equivalent = entity('TEXT', pairs.filter(([c]) => ![1, 2, 70].includes(c)).map(([c, v]) => [c === 74 ? 73 : c, v]).concat([[1, 'TAG']]));
  assert.deepEqual(it, flatten({ ...doc, entities: [equivalent] }).items[0]);
  assert.deepEqual(pickIndex(fl, false).snaps.filter((s) => s.kind === 'insertion').map(({ x, y }) => [x, y]), [[30, 40]]);
  const moved = moveEntities(doc, new Set([0]), 5, 7).entities[0];
  nearAll(numbers(moved, [10, 20, 11, 21]), [15, 27, 35, 47]);
  addBlock(doc, 'B', [att]); doc.entities = [insert('B', 0, 0)];
  assert.equal(flatten(doc).items.length, 0);
});

test('layout INSERT Explode and BURST carry ATTDEF tags or both visible values through placement, save and reopen; locks skip', () => {
  const doc = blockDoc([line(1, 2, 11, 2), ...[0, 1].map((n) => entity('ATTDEF', [[10, 1], [20, 4 + n * 5], [40, 2], [2, 'TAG' + n], [1, 'Default'], [70, n]], { layer: 'Own' }))]);
  doc.entities[0].kids = [0, 1].map((n) => entity('ATTRIB', [[10, 10], [20, 22 + n * 5], [40, 2], [2, 'TAG' + n], [1, 'Value' + n], [70, n]], { layer: 'Own' }).r);
  for (const burst of [false, true]) {
    const lay = LD.newLayout('Attributes');
    lay.parts.b = LD.objectPart('b', 'Block', doc.entities[0], doc.layers, doc.header, doc.blocks);
    lay.placed = [{ ...LD.objectPlacement(lay.parts.b), x: 100, y: 100, rot: 90 }];
    let id = 0;
    const original = structuredClone(lay.placed);
    lay.placed[0].lock = true;
    assert.equal(LD.explodePlaced(lay, [0], () => 'o' + id++, burst).done, 0);
    lay.placed = original;
    const r = LD.explodePlaced(lay, [0], () => 'o' + id++, burst);
    assert.equal(r.done, 1); assert.equal(r.pieces.length, 3);
    const pieces = lay.placed.map((p) => lay.parts[p.partId].raw.entities[0]);
    assert.deepEqual(pieces.map((e) => e.type), ['LINE', burst ? 'TEXT' : 'ATTDEF', burst ? 'TEXT' : 'ATTDEF']);
    assert.deepEqual(pieces.slice(1).map((e) => e.layer), burst ? ['Cut', 'Cut'] : ['Own', 'Own']);
    const saved = readDxf(writeDxf(LD.layoutRaw(lay))), reopened = LD.layoutFromRaw(saved);
    assert.equal(reopened.placed.length, 3);
    assert.deepEqual(flatten(saved).items.filter((it) => it.k === 't').map((it) => it.lines[0]), burst ? ['Value0', 'Value1'] : ['TAG0', 'TAG1']);
  }
});

test('a polyline seen from below keeps the mirrored arc sweep', () => {
  const e = { ...lwpoly([[0, 0, 1], [10, 0]]), flip: true };
  nearAll(numbers(explodePolyline(e)[0], [10, 20, 40, 50, 51]), [-5, 0, 5, 180, 0]);
});

test('selection skips locked layers and other types, selects new pieces, and does not mutate input', () => {
  const doc = blockDoc([line(0, 0, 1, 1)]);
  addEntities(doc, lwpoly([[0, 0], [1, 0], [1, 1]]), line(8, 8, 9, 9), lwpoly([[0, 0], [2, 0]], { layer: 'Cut' }));
  const before = structuredClone(doc), out = explodeSelection(doc, new Set([1, 2, 3]), new Set(['Cut']));
  assert.equal(out.exploded, 1); assert.equal(out.skipped, 1);
  assert.deepEqual([...out.selected], [1, 2]); assert.equal(out.entities.length, 5);
  assert.equal(out.entities[0], doc.entities[0]); assert.equal(out.entities[3], doc.entities[2]); assert.equal(out.entities[4], doc.entities[3]);
  assert.deepEqual(doc, before);
  assert.equal(explodeSelection(doc, new Set([2])).exploded, 0);
  assert.equal(explodeSelection(doc, new Set()).exploded, 0);
  assert.equal(resolve('X', 'draw').name, 'explode'); assert.equal(resolve('EXPLODE', 'draw').name, 'explode');
});

// ---- TODO 156b2c3b: Explode of a dimension
const dimDoc = (kind, params, override) => {
  const doc = newDoc(4), made = buildDim(kind, { ...params, override }, 1, 'PD_DIM_' + ({ aligned: '', linear: 'H', angle: 'A' }[kind]) + '1', 2);
  addLayer(doc, 'Notes', { aci: 3 });
  Object.assign(doc, addDimension(doc, { ...made, insert: { ...made.insert, layer: 'Notes' } }));
  return doc;
};
const textOf = (e) => e.r.v[e.r.c.indexOf(1)];
for (const [name, kind, params, counts] of [
  ['aligned', 'aligned', { a: [0, 0], b: [100, 0], offset: 20, textH: 5 }, { LINE: 3, SOLID: 2, MTEXT: 1 }],
  ['linear', 'linear', { a: [0, 0], b: [100, 40], offset: 20, axis: 'h', textH: 5 }, { LINE: 3, SOLID: 2, MTEXT: 1 }],
  ['angle', 'angle', { v: [0, 0], r: 50, a0: 0, a1: 60, textH: 5 }, { ARC: 1, SOLID: 2, MTEXT: 1 }],
]) {
  test(`explode a ${name} dimension: its lines, SOLID arrows and one MTEXT on its layer; no attdef, point or block left`, () => {
    for (const override of [undefined, 'Width <> mm']) {
      const doc = dimDoc(kind, params, override), before = structuredClone(doc);
      const out = explodeSelection(doc, new Set([0]));
      assert.equal(out.exploded, 1);
      assert.deepEqual(out.entities.map((e) => e.type).sort(), Object.entries(counts).flatMap(([k, n]) => Array(n).fill(k)).sort());
      assert.ok(out.entities.every((e) => e.layer === 'Notes'), "all on the dimension's layer");
      const shown = textOf(out.entities.find((e) => e.type === 'MTEXT'));
      if (override) assert.match(shown, /^Width \S+ mm$/, 'the override with <> filled in'); else assert.match(shown, /^[\d.]+°?$/);
      assert.equal(out.entities.some((e) => e.type === 'ATTDEF' || e.type === 'POINT' || e.type === 'INSERT'), false);
      assert.deepEqual(Object.keys(out.blocks), [], "the dimension's block goes with it");
      assert.deepEqual([...out.selected], out.entities.map((_, i) => i));
      assert.deepEqual(doc, before, 'the input is untouched (Undo gets the dimension back)');
    }
  });
}

test('exploding one of two dimensions sharing a block keeps the block; a rotated insert still explodes', () => {
  const doc = dimDoc('aligned', { a: [0, 0], b: [100, 0], offset: 20, textH: 5 });
  doc.entities.push(insert('PD_DIM_1', 0, 0, { layer: 'Notes', rot: 90 }));
  const out = explodeSelection(doc, new Set([1]));
  assert.equal(out.exploded, 1); assert.deepEqual(Object.keys(out.blocks), ['PD_DIM_1']);
  assert.equal(out.entities[0], doc.entities[0]);
  nearAll(numbers(out.entities.find((e) => e.type === 'MTEXT'), [50]), [90]);
});

test('a mirrored dimension explodes into text that reads left to right; a backslash in the override is escaped', () => {
  for (const at of [{ sx: -1 }, { sy: -1 },{ sx: -1, rot: 30 }]) {
    const doc = dimDoc('aligned', { a: [0, 0], b: [100, 0], offset: 20, textH: 5 });
    doc.entities[0] = insert('PD_DIM_1', 0, 0, { layer: 'Notes', ...at });
    const rot = get(explodeSelection(doc, new Set([0])).entities.find((e) => e.type === 'MTEXT').r, 50);
    assert.ok(rot > -90 - 1e-9 && rot <= 90 + 1e-9, `${JSON.stringify(at)}: rotation ${rot} reads left to right`);
  }
  // the text keeps its side of the dimension line (line at |y| = 20, text anchored at |y| = 22): sx -1 sits above, sy -1 hangs below
  for (const [at, attach, y] of [[{ sx: -1 }, 8, 22], [{ sy: -1 }, 2, -22]]) {
    const doc = dimDoc('aligned', { a: [0, 0], b: [100, 0], offset: 20, textH: 5 });
    doc.entities[0] = insert('PD_DIM_1', 0, 0, { layer: 'Notes', ...at });
    const t = explodeSelection(doc, new Set([0])).entities.find((e) => e.type === 'MTEXT').r;
    assert.equal(get(t, 71), attach, `${JSON.stringify(at)}: MTEXT attachment`);
    assert.ok(Math.abs(get(t, 20) - y) < 1e-9, `${JSON.stringify(at)}: text anchored at y ${get(t, 20)}`);
  }
  const doc = dimDoc('aligned', { a: [0, 0], b: [100, 0], offset: 20, textH: 5 }, 'A\\P <>');
  assert.ok(textOf(explodeSelection(doc, new Set([0])).entities.find((e) => e.type === 'MTEXT')).startsWith('A\\\\P '));
});

test('mirrored dimension INSERT rotations 90 and 270 keep exploded text upright and on its side of the line', () => {
  for (const [sx, sy, rot, x, y, attach] of [[-1, 1, 90, -22, -50, 8], [-1, 1, 270, 22, 50, 2], [1, -1, 90, 22, 50, 2], [1, -1, 270, -22, -50, 8]]) {
    const doc = dimDoc('aligned', { a: [0, 0], b: [100, 0], offset: 20, textH: 5 });
    doc.entities[0] = insert('PD_DIM_1', 0, 0, { layer: 'Notes', sx, sy, rot });
    const out = explodeSelection(doc, new Set([0])), text = out.entities.find((e) => e.type === 'MTEXT');
    assert.equal(out.exploded, 1);
    nearAll(numbers(text, [10, 20, 50, 71]), [x, y, 90, attach]);
    assert.equal(textOf(text), '100.00');
  }
});

test('untransformable or missing block members leave the whole insert intact with a reason', () => {
  for (const doc of [blockDoc([line(0, 0, 1, 1), entity('HATCH', [])]), blockDoc([insert('Missing', 0, 0)])]) {
    const out = explodeSelection(doc, new Set([0]));
    assert.equal(out.exploded, 0); assert.equal(out.entities[0], doc.entities[0]); assert.equal(out.errors.length, 1);
  }
});

test('mirrored and turned text explodes into the box the INSERT showed (backward / upside-down text hangs the other way)', () => {
  for (const at of [{ sx: -1 }, { sy: -1 }, { sx: -1, sy: -1 }, { rot: 180 }, { sy: -1, rot: 90 }]) {
    const doc = blockDoc([text(3, 4, 2, 'HELLO'), line(0, 0, 1, 1)], at), want = flatten(doc).boxes.model;
    flatten({ ...doc, entities: result(doc).entities }).boxes.model.forEach((v, i) => near(v, want[i]));
  }
});

test('a DIMENSION member explodes as one INSERT of its block, in place', () => {
  const doc = newDoc(); addBlock(doc, '*D1', [line(0, 0, 20, 0), text(8, 4, 2, '20')]); addBlock(doc, 'B', [entity('DIMENSION', [[2, '*D1']])]);
  addEntities(doc, insert('B', 10, 20, { rot: 90, sx: -2 }));
  const out = result(doc);
  assert.deepEqual(out.entities.map((e) => e.type), ['INSERT']);
  const want = flatten(doc).boxes.model;
  flatten({ ...doc, blocks: out.blocks, entities: out.entities }).boxes.model.forEach((v, i) => near(v, want[i]));
});

test('explodeInsert throws for a missing block, an external reference and a DIMENSION whose block is missing', () => {
  const missing = blockDoc([insert('Missing', 0, 0)]), dim = blockDoc([entity('DIMENSION', [[2, '*D9']])]);
  for (const doc of [missing, dim]) assert.throws(() => explodeInsert(doc.entities[0], doc), /missing block or external reference/);
  addBlock(missing, 'X', [], [0, 0]); missing.blocks.X.xref = true; addBlock(missing, 'C', [insert('X', 0, 0)]);
  assert.throws(() => explodeInsert(insert('C', 0, 0), missing), /missing block or external reference/);
});

test('a second DIMENSION, or an existing PD_EXPLODE_1, gets the next PD_EXPLODE_n name', () => {
  const doc = newDoc();
  addBlock(doc, '*D1', [line(0, 0, 5, 0)]); addBlock(doc, '*D2', [line(0, 0, 0, 5)]); addBlock(doc, 'PD_EXPLODE_1', [line(9, 9, 10, 10)]);
  addBlock(doc, 'B', [entity('DIMENSION', [[2, '*D1']]), entity('DIMENSION', [[2, '*D2']])]); addEntities(doc, insert('B', 0, 0));
  const out = result(doc);
  assert.equal(out.blocks.PD_EXPLODE_1, doc.blocks.PD_EXPLODE_1, 'the existing block is untouched');
  assert.equal(out.blocks.PD_EXPLODE_2, doc.blocks['*D1']); assert.equal(out.blocks.PD_EXPLODE_3, doc.blocks['*D2']);
});

test('TODO 155i1: native DIMENSION uses its world-coordinate *D block, keeps resolved text and drops POINTs / Defpoints', () => {
  const doc = newDoc(4);
  addLayer(doc, 'Notes', { aci: 3 }); addLayer(doc, 'Defpoints', { aci: 7 });
  const built = buildDim('aligned', { a: [10, 20], b: [110, 20], offset: 30, textH: 5, override: 'Width <> mm' }, 1, 'PD_DIM_1');
  addBlock(doc, '*D1', [...built.block.entities, entity('POINT', [[10, 10], [20, 20]], { layer: 'Defpoints' }), line(10, 20, 10, 30, { layer: 'defPOINTS' })], [7, 9]);
  const native = entity('DIMENSION', [[2, '*D1'], [70, 33], [1, 'Width <> mm'], [42, 100], [10, 110], [20, 50]], { layer: 'Notes', tc: 0x123456 });
  doc.entities = [native];
  const before = structuredClone(doc), out = explodeSelection(doc, new Set([0]));
  assert.equal(out.exploded, 1); assert.deepEqual(out.errors, []);
  assert.ok(out.entities.every((e) => e.type !== 'POINT' && e.layer === 'Notes'));
  nearAll(numbers(out.entities[0], [10, 20, 11, 21]), [10, 50, 110, 50]);
  assert.equal(out.entities.filter((e) => e.type === 'SOLID').length, 2);
  assert.equal(textOf(out.entities.find((e) => e.type === 'MTEXT')), 'Width 100.00 mm');
  const spaced = structuredClone(doc); spaced.entities[0].r.v[spaced.entities[0].r.c.indexOf(1)] = ' Width <> mm ';
  assert.equal(textOf(explodeSelection(spaced, new Set([0])).entities.find((e) => e.type === 'MTEXT')), 'Width 100.00 mm');
  assert.ok(!out.blocks['*D1']); assert.deepEqual(doc, before);
  doc.entities.push({ ...native });
  assert.ok(explodeSelection(doc, new Set([0])).blocks['*D1'], 'another dimension still uses the anonymous block');
});

test('TODO 155i1: ISO-25-like native block text is already resolved, including units and suppressed zeros', () => {
  for (const type of ['TEXT', 'MTEXT']) {
    const doc = newDoc(4);
    addBlock(doc, '*D1', [entity(type, [[10, 50], [20, 5], [40, 2.5], [1, '100 mm']])]);
    doc.entities = [entity('DIMENSION', [[2, '*D1'], [70, 1], [1, '<> mm'], [42, 100]])];
    const out = explodeSelection(doc, new Set([0]));
    assert.equal(out.exploded, 1); assert.deepEqual(out.errors, []);
    assert.equal(textOf(out.entities.find((e) => e.type === 'MTEXT')), '100 mm');
  }
});

test('TODO 155i1: native DIMENSION without a block builds lines, SOLID arrows and MTEXT; rotated and aligned geometry', () => {
  for (const [type, rotation] of [[1, 0], [0, 0], [0, 30], [0, 90]]) {
    const c = Math.cos(rotation * Math.PI / 180), s = Math.sin(rotation * Math.PI / 180);
    const at = (code, x, y) => [[code, x * c - y * s], [code + 10, x * s + y * c]];
    const doc = newDoc(4); addLayer(doc, 'Notes');
    doc.entities = [entity('DIMENSION', [[2, '*Dmissing'], [70, type + 32], [1, 'Width <> mm'], [50, rotation],
      ...at(13, 0, 0), ...at(14, 100, 0), ...at(10, 100, 20)], { layer: 'Notes' })];
    const out = explodeSelection(doc, new Set([0]));
    assert.equal(out.exploded, 1, JSON.stringify(out.errors));
    assert.deepEqual(out.entities.map((e) => e.type).sort(), ['LINE', 'LINE', 'LINE', 'MTEXT', 'SOLID', 'SOLID']);
    assert.ok(out.entities.every((e) => e.layer === 'Notes'));
    assert.equal(textOf(out.entities.find((e) => e.type === 'MTEXT')), 'Width 100.00 mm');
    nearAll(numbers(out.entities[0], [10, 20, 11, 21]), [-20 * s, 20 * c, 100 * c - 20 * s, 100 * s + 20 * c]);
    assert.deepEqual(out.blocks, {});
  }
});

test('TODO 155i1: native block MTEXT keeps resolved formatting and chunks regardless of override; invalid fallback leaves source', () => {
  const doc = newDoc(4);
  addBlock(doc, '*D1', [line(0, 0, 30, 0), entity('MTEXT', [[10, 15], [20, 2], [40, 2], [3, '{\\C1;Width '], [1, '30,0}']])]);
  doc.entities = [entity('DIMENSION', [[2, '*D1'], [70, 0], [1, '{\\C1;Width <>}'], [42, 30]])];
  doc.header.$DIMDEC = '3';
  for (const override of ['{\\C1;Width <>}', ' Width <> ', '<>', 'Custom', ' ']) {
    doc.entities[0].r.v[doc.entities[0].r.c.indexOf(1)] = override;
    const tx = explodeSelection(doc, new Set([0])).entities.find((e) => e.type === 'MTEXT');
    assert.equal(textOf(tx), '30,0}');
    assert.equal(tx.r.v[tx.r.c.indexOf(3)], '{\\C1;Width ');
  }
  doc.entities = [entity('DIMENSION', [[70, 1]])];
  const invalid = explodeSelection(doc, new Set([0]));
  assert.equal(invalid.exploded, 0); assert.equal(invalid.entities[0], doc.entities[0]);
  assert.match(invalid.errors[0], /invalid definition points/);
});

test('TODO 155i1: native dimensions are loose layout objects, survive Save, explode with their placement and undo snapshot stays intact', () => {
  const doc = newDoc(4), built = buildDim('aligned', { a: [0, 0], b: [100, 0], offset: 20, textH: 5, override: 'Width <>' }, 1, 'PD_DIM_1');
  addBlock(doc, '*D1', built.block.entities);
  const e = entity('DIMENSION', [[2, '*D1'], [70, 1], [42, 100], [1, 'Width <>']]);
  const lay = LD.newLayout('Native');
  lay.parts.d = LD.objectPart('d', 'Native dimension', e, doc.layers, doc.header, doc.blocks);
  lay.placed = [LD.objectPlacement(lay.parts.d)];
  const saved = LD.layoutFromRaw(readDxf(writeDxf(LD.layoutRaw(lay))));
  assert.equal(saved.placed.length, 1);
  assert.equal(saved.parts[saved.placed[0].partId].raw.entities[0].type, 'DIMENSION');
  const snap = structuredClone(saved), p = saved.placed[0]; p.rot = 90; p.sc = 2;
  let id = 0;
  const r = LD.explodePlaced(saved, [0], () => 'o' + id++);
  assert.equal(r.done, 1); assert.deepEqual(r.errors, []);
  const pieces = saved.placed.map((p) => saved.parts[p.partId].raw.entities[0]);
  assert.deepEqual(pieces.map((e) => e.type).sort(), ['LINE', 'LINE', 'LINE', 'MTEXT', 'SOLID', 'SOLID']);
  assert.equal(textOf(pieces.find((e) => e.type === 'MTEXT')), 'Width 100.00');
  assert.equal(snap.parts[snap.placed[0].partId].raw.entities[0].type, 'DIMENSION');
  assert.equal(LD.layoutFromRaw(readDxf(writeDxf(LD.layoutRaw(saved)))).placed.length, 6);
});

test('TODO 155i1: native fallback radius, diameter, two-line and three-point angles use dimension geometry', () => {
  const pt = (c, x, y) => [[c, x], [c + 10, y]];
  for (const [kind, points, label] of [
    [4, [...pt(10, 0, 0), ...pt(15, 20, 0)], 'R20.00'],
    [3, [...pt(10, -20, 0), ...pt(15, 20, 0)], 'Ø40.00'],
    [2, [...pt(13, 0, 0), ...pt(14, 30, 0), ...pt(15, 0, 0), ...pt(16, 0, 30), ...pt(10, 20, 20)], '90.00°'],
    [5, [...pt(13, 30, 0), ...pt(14, 0, 30), ...pt(15, 0, 0), ...pt(10, 20, 20)], '90.00°'],
  ]) {
    const doc = newDoc(4); doc.entities = [entity('DIMENSION', [[70, kind], [1, 'Value <>'], ...points])];
    const out = explodeSelection(doc, new Set([0]));
    assert.equal(out.exploded, 1, JSON.stringify(out.errors));
    assert.equal(textOf(out.entities.find((e) => e.type === 'MTEXT')), 'Value ' + label);
    assert.ok(out.entities.some((e) => e.type === 'SOLID'));
  }
});

test('TODO 155i1: layout native dimension without a graphics block also has extents and explodes through explodeDims', () => {
  const lay = LD.newLayout('Fallback'), raw = newDoc(4);
  const e = entity('DIMENSION', [[70, 1], [1, 'Width <>'], [13, 0], [23, 0], [14, 100], [24, 0], [10, 100], [20, 20]]);
  lay.parts.d = LD.objectPart('d', 'Native', e, raw.layers);
  assert.ok(lay.parts.d);
  lay.placed = [LD.objectPlacement(lay.parts.d)];
  let id = 0;
  assert.equal(LD.explodeDims(lay, [0], () => 'o' + id++), 1);
  assert.equal(lay.placed.length, 6);
  assert.equal(textOf(lay.placed.map((p) => lay.parts[p.partId].raw.entities[0]).find((e) => e.type === 'MTEXT')), 'Width 100.00');
});
