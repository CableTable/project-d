import assert from 'node:assert/strict';
import test from 'node:test';
import { explodePolyline, explodeInsert, explodeSelection } from './web/explode.js';
import { newDoc, addLayer, addBlock, addEntities, line, arc, circle, ellipse, lwpoly, insert, entity, text, writeDxf } from './web/dxf-write.js';
import { get } from './web/grips.js';
import { flatten, mapply, readDxf } from './web/drawing.js';
import { resolve } from './web/cmdbar.js';

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

test('untransformable or missing block members leave the whole insert intact with a reason', () => {
  for (const doc of [blockDoc([line(0, 0, 1, 1), entity('HATCH', [])]), blockDoc([insert('Missing', 0, 0)])]) {
    const out = explodeSelection(doc, new Set([0]));
    assert.equal(out.exploded, 0); assert.equal(out.entities[0], doc.entities[0]); assert.equal(out.errors.length, 1);
  }
});
