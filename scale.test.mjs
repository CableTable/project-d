import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from './web/dxf-write.js';
import { flatten, mapply } from './web/drawing.js';
import { addDimension, buildDim, dimOfEntity, dimGeom } from './web/edit.js';
import { followDimensions } from './web/linked-dimensions.js';
import { scaleEntities, scaleFactor, scaleDistance, scaleMatrix } from './web/scale.js';

const value = (e, code) => +e.r.v[e.r.c.indexOf(code)];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const base = [3, 7], scaled = (p, s) => p.map((v, i) => base[i] + (v - base[i]) * s);
const make = (type, pairs) => W.entity(type, pairs, { layer: 'Cut', aci: 3, lw: 25 });
const pts = [[10, 12], [20, 14], [11, 18], [21, 20]];
const fixtures = [
  [W.line(12, 14, 18, 20), [10, 11]], [W.point(12, 14), [10]],
  [W.circle(12, 14, 8), [10], [], [40]], [W.arc(12, 14, 8, 10, 80), [10], [], [40]],
  [W.lwpoly([[12, 14, .5], [18, 20, -.25]], { closed: true, width: 2 }), [10]],
  [{ ...make('POLYLINE', [[66, 1], [70, 1], [40, 2], [41, 3]]), kids: [make('VERTEX', [...pts.slice(0, 2), [40, 2], [41, 3], [42, .5]]).r] }, []],
  [W.ellipse(12, 14, 8, 2, .4, .2, 2.7), [10], [11]],
  [make('SPLINE', [...pts, [12, 4], [22, 2], [13, 2], [23, 3], [40, 0], [40, 1]]), [10, 11], [12, 13]],
  ...['TEXT', 'ATTRIB', 'ATTDEF'].map((t) => [make(t, [...pts, [40, 5], [41, .8], [50, 20], [1, 'Scale']]), [10, 11], [], [40]]),
  [make('MTEXT', [...pts, [40, 5], [41, 30], [42, 20], [43, 12], [50, 20], [1, 'Scale']]), [10], [], [40, 41, 42, 43]],
  ...['SOLID', 'TRACE', '3DFACE'].map((t) => [make(t, [...pts, [12, 25], [22, 4], [13, 26], [23, 5]]), [10, 11, 12, 13]]),
  [W.insert('Part', 12, 14, { rot: 20, sx: 2, sy: .5 }), [10], [], [41, 42, 43]],
  [make('LEADER', [...pts.slice(0, 2), ...pts.slice(0, 2), [40, 3], [41, 5], [211, 1], [221, 0]]), [10], [], [40, 41]],
  [make('ACAD_TABLE', [[2, 'Part'], ...pts]), [10]],
  ...['WIPEOUT', 'IMAGE'].map((t) => [make(t, [...pts, [12, 2], [22, 8], [14, .5], [24, .5]]), [10], [11, 12]]),
  [make('VIEWPORT', [...pts.slice(0, 2), [40, 50], [41, 30], [45, 80], [51, 20]]), [10], [], [40, 41]],
];

for (const [e, points, vectors = [], lengths = []] of fixtures) for (const s of [2, .5]) for (const copy of [false, true]) test(`Scale ${e.type}: ${s}, copy=${copy}`, () => {
  const raw = W.newDoc(); W.addBlock(raw, 'Part', [W.line(0, 0, 5, 0)]); W.addEntities(raw, e, W.line(1, 1, 2, 2));
  const before = structuredClone(raw), next = scaleEntities(raw, new Set([0]), base, s, copy), result = next.entities[copy ? 2 : 0];
  assert.deepEqual(raw, before); assert.equal(next.entities[1], raw.entities[1]);
  if (copy) assert.equal(next.entities[0], e);
  for (const code of points) [code, code + 10].forEach((c, i) => close(value(result, c), scaled([value(e, code), value(e, code + 10)], s)[i]));
  for (const code of vectors) for (const c of [code, code + 10]) close(value(result, c), value(e, c) * s);
  for (const code of lengths) close(value(result, code), value(e, code) * s);
  for (const code of [40, 41, 42, 43, 45, 50, 51, 70, 71, 211, 221]) if (e.r.c.includes(code) && !lengths.includes(code)) close(value(result, code), value(e, code));
  for (const prop of ['layer', 'aci', 'lw', 'lt', 'ps', 'flip']) assert.equal(result[prop], e[prop]);
  if (e.kids) { const kid = { r: result.kids[0] }; close(value(kid, 10), scaled([12, 14], s)[0]); close(value(kid, 20), scaled([12, 14], s)[1]); for (const c of [40, 41, 42]) close(value(kid, c), value({ r: e.kids[0] }, c)); }
  assert.deepEqual(next.blocks.Part, raw.blocks.Part);
  if (e.type === 'ACAD_TABLE') { const name = result.r.v[result.r.c.indexOf(2)]; close(value(next.blocks[name].entities[0], 11), 5 * s); }
});

for (const s of [2, .5]) for (const copy of [false, true]) test(`Scale hatches and multileaders: ${s}, copy=${copy}`, () => {
  const hatch = make('HATCH', [[10, 0], [20, 0], [91, 3], [92, 2], [72, 1], [93, 2], ...pts.slice(0, 2), [42, .5], [10, 18], [20, 20],
    [92, 0], [93, 1], [72, 2], ...pts.slice(0, 2), [40, 8], [50, 10], [51, 80],
    [92, 0], [93, 1], [72, 3], ...pts, [40, .4], [75, 0], [41, 2], [52, 20], [43, 12], [44, 14], [45, 8], [46, 2], [49, 3], [98, 1], ...pts.slice(0, 2)]);
  const leaders = ['MLEADER', 'MULTILEADER'].map((t) => make(t, [[300, 'CONTEXT_DATA{'], ...pts.slice(0, 2), [12, 12], [22, 14], [13, 1], [23, 0], [41, 5], [42, .2], [140, 3],
    [302, 'LEADER{'], ...pts.slice(0, 2), [11, 1], [21, 0], [40, 4], [304, 'LEADER_LINE{'], ...pts.slice(0, 2), [305, '}'], [303, '}'], [301, '}']]));
  const raw = { ...W.newDoc(), entities: [hatch, ...leaders] }, before = structuredClone(raw);
  const result = scaleEntities(raw, new Set([0, 1, 2]), base, s, copy).entities.slice(copy ? 3 : 0);
  assert.deepEqual(raw, before);
  const h = result[0]; close(value(h, 10), 0); close(value(h, 20), 0); close(value(h, 42), .5); close(value(h, 50), 10); close(value(h, 52), 20);
  close(value(h, 11), 18 * s); close(value(h, 21), 20 * s); close(value(h, 43), scaled([12, 14], s)[0]); close(value(h, 44), scaled([12, 14], s)[1]);
  close(value(h, 45), 8 * s); close(value(h, 46), 2 * s); close(value(h, 49), 3 * s);
  assert.deepEqual(h.r.v.filter((_, i) => h.r.c[i] === 40).map(Number), [8 * s, .4]);
  for (const e of result.slice(1)) { close(value(e, 10), scaled([12, 14], s)[0]); close(value(e, 12), scaled([12, 14], s)[0]); close(value(e, 13), 1); close(value(e, 11), 1); close(value(e, 41), 5 * s); close(value(e, 40), 4 * s); close(value(e, 140), 3 * s); close(value(e, 42), .2); }
});

for (const s of [2, .5]) for (const copy of [false, true]) test(`Scale native and kept dimensions, shared blocks and linked measurements: ${s}, copy=${copy}`, () => {
  const raw = W.newDoc(); W.addBlock(raw, '*D1', [W.line(12, 14, 18, 20), W.text(12, 14, 3, '10.00')]);
  W.addEntities(raw, make('DIMENSION', [[2, '*D1'], ...pts, [13, 12], [23, 14], [14, 18], [24, 20], [42, 10], [70, 0]]), make('DIMENSION', [[2, '*D1'], ...pts]));
  Object.assign(raw, addDimension(raw, buildDim('aligned', { a: [12, 14], b: [22, 14], offset: 5, textH: 3 }, 1, 'PD_DIM_1')));
  const before = structuredClone(raw), next = scaleEntities(raw, new Set([0, 2]), base, s, copy), native = next.entities[copy ? 3 : 0], kept = next.entities[copy ? 4 : 2];
  assert.deepEqual(raw, before); assert.deepEqual(next.blocks['*D1'], raw.blocks['*D1']); assert.deepEqual(next.blocks.PD_DIM_1, raw.blocks.PD_DIM_1);
  close(value(native, 10), scaled([12, 14], s)[0]); close(value(native, 11), scaled([18, 20], s)[0]); close(value(native, 42), 10 * s);
  const name = native.r.v[native.r.c.indexOf(2)]; close(value(next.blocks[name].entities[0], 10), scaled([12, 14], s)[0]);
  assert.equal(next.blocks[name].entities[1].r.v[next.blocks[name].entities[1].r.c.indexOf(1)], (10 * s).toFixed(2));
  const dim = dimOfEntity({ ...raw, ...next }, copy ? 4 : 2); close(dim.params.textH, 3 * s);
  const label = next.blocks[dim.name].entities.find((e) => e.type === 'TEXT'); assert.equal(label.r.v[label.r.c.indexOf(1)], (10 * s).toFixed(2));
  const original = flatten({ ...raw, entities: [raw.entities[2]] }), after = flatten({ ...raw, ...next, entities: [kept] });
  for (const [i, it] of after.items.entries()) if (it.k === 'p') {
    const p = mapply(after.mats[it.m], it.ops[1], it.ops[2]), old = original.items[i];
    const want = scaled(mapply(original.mats[old.m], old.ops[1], old.ops[2]), s); p.forEach((v, j) => close(v, want[j]));
  }
  const linked = W.newDoc(); W.addEntities(linked, W.line(12, 14, 22, 14)); Object.assign(linked, addDimension(linked, buildDim('aligned', { a: [12, 14], b: [22, 14], offset: 5, textH: 3 }, 1, 'PD_DIM_1')));
  const followed = followDimensions(linked, scaleEntities(linked, new Set([0]), base, s, copy));
  const params = dimOfEntity({ ...linked, ...followed }, 1).params;
  params.b.forEach((v, i) => close(v, copy ? [22, 14][i] : scaled([22, 14], s)[i]));
});

test('Scale every kept dimension style, text position and height; angles keep their measured value', () => {
  const fixtures = [
    ['linear', 'PD_DIM_H1', { a: [12, 14], b: [22, 24], offset: 5, axis: 'h' }],
    ['radius', 'PD_DIM_R1', { c: [12, 14], r: 10, p: [30, 14] }],
    ['diameter', 'PD_DIM_D1', { a: [12, 14], b: [32, 14], offset: 0 }],
    ['angle', 'PD_DIM_A1', { v: [12, 14], r: 10, a0: 10, a1: 80 }],
  ];
  for (const [kind, name, params] of fixtures) for (const s of [2, .5]) for (const copy of [false, true]) {
    const raw = W.newDoc(); Object.assign(raw, addDimension(raw, buildDim(kind, { ...params, textH: 3, pos: 'above' }, 1, name)));
    const before = structuredClone(raw), next = scaleEntities(raw, new Set([0]), base, s, copy), index = copy ? 1 : 0;
    const dim = dimOfEntity({ ...raw, ...next }, index), block = next.blocks[dim.name];
    close(dim.params.textH, 3 * s);
    const tx = block.entities.find((e) => e.type === 'TEXT'), old = raw.blocks[name].entities.find((e) => e.type === 'TEXT');
    close(value(tx, 10), value(old, 10) * s); close(value(tx, 20), value(old, 20) * s);
    assert.equal(tx.r.v[tx.r.c.indexOf(1)], dimGeom(kind, dim.params, 1, dim.dp).label);
    assert.deepEqual(raw, before);
  }
  for (const kind of [2, 5]) {
    const raw = { ...W.newDoc(), entities: [make('DIMENSION', [...pts, [70, kind], [42, 1.2]])] };
    close(value(scaleEntities(raw, new Set([0]), base, 2).entities[0], 42), 1.2);
  }
});

test('Scale repeated points, missing y, reflected OCS, attributes, implicit insert factors and invalid input', () => {
  const raw = W.newDoc(); W.addEntities(raw, W.lwpoly([[12, 14, .5], [18, 20, -.25]]), make('POINT', [[10, 12]]), { ...W.arc(-12, 14, 8, 10, 50), flip: true }, W.insert('Part', 12, 14));
  raw.entities[3].kids = [make('ATTRIB', [...pts, [40, 5], [1, 'Attribute']]).r];
  const next = scaleEntities(raw, new Set([0, 1, 2, 3]), base, 2);
  assert.deepEqual(next.entities[0].r.v.filter((_, i) => next.entities[0].r.c[i] === 10).map(Number), [21, 33]);
  close(value(next.entities[1], 20), -7); close(value(next.entities[2], 10), -21); close(value(next.entities[2], 40), 16);
  for (const c of [41, 42, 43]) close(value(next.entities[3], c), 2);
  close(value({ r: next.entities[3].kids[0] }, 40), 10); close(value({ r: next.entities[3].kids[0] }, 10), 21);
  for (const s of [2, .5]) mapply(scaleMatrix(base, s), 12, 14).forEach((v, i) => close(v, scaled([12, 14], s)[i]));
  close(scaleDistance([3, 7], [6, 11]), 5);
  for (const input of ['0', '-1', '', 'NaN', 'Infinity', '1e309', 'abc', '2mm', '1,2', '0x10']) assert.equal(scaleFactor(input), null);
  for (const input of ['2', '0.5', ' +2 ', '1e-2']) close(scaleFactor(input), +input);
  for (const s of [0, -1, NaN, Infinity]) assert.throws(() => scaleEntities(raw, new Set([0]), base, s), /positive factor/);
  assert.throws(() => scaleEntities(raw, new Set([0]), [NaN, 0], 2), /finite/);
  assert.throws(() => scaleEntities({ ...raw, entities: [make('UNKNOWN', pts)] }, new Set([0]), base, 2), /Cannot/);
});
