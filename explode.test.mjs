import assert from 'node:assert/strict';
import test from 'node:test';
import { explodePolyline, explodeInsert, explodeSelection } from './web/explode.js';
import { newDoc, addLayer, addBlock, addEntities, line, arc, circle, ellipse, lwpoly, insert, entity, text, writeDxf } from './web/dxf-write.js';
import { get } from './web/grips.js';
import { flatten, mapply, readDxf } from './web/drawing.js';
import { resolve } from './web/cmdbar.js';
import { buildDim, addDimension } from './web/edit.js';

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

test('insert attributes become text at their drawing position with their own properties', () => {
  const doc = blockDoc([line(1, 2, 2, 2)], { rot: 90, sx: 2, sy: 3 });
  doc.entities[0].kids = [entity('ATTRIB', [[10, 25], [20, 35], [40, 2], [1, 'Value'], [62, 2]], { layer: 'Own' }).r];
  const pieces = result(doc).entities;
  assert.equal(pieces[1].type, 'TEXT'); assert.equal(pieces[1].layer, 'Own'); assert.equal(pieces[1].aci, 2);
  nearAll(numbers(pieces[1], [10, 20, 40]), [25, 35, 2]);
});

test('a hidden attribute is dropped, and an attribute\'s vertical alignment (74) becomes the TEXT one (73)', () => {
  const doc = blockDoc([line(1, 2, 2, 2)]);
  doc.entities[0].kids = [
    entity('ATTRIB', [[10, 25], [20, 35], [40, 2], [1, 'Shown'], [70, 0], [73, 5], [74, 2]], { layer: 'Own' }).r,
    entity('ATTRIB', [[10, 25], [20, 35], [40, 2], [1, 'Hidden'], [70, 1]], { layer: 'Own' }).r,
    entity('ATTRIB', [[10, 25], [20, 35], [40, 2], [1, 'Invisible'], [60, 1]], { layer: 'Own' }).r,
  ];
  const pieces = result(doc).entities;
  assert.equal(pieces.length, 2); assert.equal(pieces[1].type, 'TEXT');
  assert.deepEqual(pieces[1].r.v[pieces[1].r.c.indexOf(1)], 'Shown');
  assert.equal(get(pieces[1].r, 73), 2); assert.equal(get(pieces[1].r, 74), null); assert.equal(get(pieces[1].r, 70), null);
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
