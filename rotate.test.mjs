import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from './web/dxf-write.js';
import { flatten, mapply, readDxf } from './web/drawing.js';
import { rotateEntities, rotationAngle, rotationMatrix } from './web/rotate.js';
import { addDimension, buildDim } from './web/edit.js';

const value = (e, code) => +e.r.v[e.r.c.indexOf(code)];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const pair = (e, code, want) => { close(value(e, code), want[0]); close(value(e, code + 10), want[1]); };
const pivot = [3, 7];
const turned = (p, a, vector = false) => {
  const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
  const [x, y] = p.map((v, i) => v - (vector ? 0 : pivot[i]));
  return [x * c - y * s + (vector ? 0 : pivot[0]), x * s + y * c + (vector ? 0 : pivot[1])];
};
const make = (type, pairs) => W.entity(type, pairs, { layer: 'Cut', aci: 3, lw: 25 });
const points = [[10, 12], [20, 14], [11, 18], [21, 20]];
const fixtures = [
  [W.line(12, 14, 18, 20), [10, 11]],
  [W.point(12, 14), [10]], [W.circle(12, 14, 8), [10]],
  [W.arc(12, 14, 8, 350, 370), [10], [], [50, 51]],
  [W.lwpoly([[12, 14, .5], [18, 20, -.25]], { closed: true, width: 2 }), [10]],
  [{ ...make('POLYLINE', [[66, 1], [70, 1], [10, 0], [20, 0]]), kids: [make('VERTEX', [[10, 12], [20, 14], [42, .5]]).r] }, []],
  [W.ellipse(12, 14, 8, 2, .4, .2, 2.7), [10], [11]],
  [make('SPLINE', [...points, [12, 4], [22, 2], [13, 2], [23, 3], [40, 0], [40, 1]]), [10, 11], [12, 13]],
  ...['TEXT', 'ATTRIB', 'ATTDEF'].map((type) => [make(type, [...points, [40, 5], [50, 20], [1, 'Turn']]), [10, 11], [], [50]]),
  [make('MTEXT', [...points, [40, 5], [1, 'Turn']]), [10], [11]],
  [make('MTEXT', [...points, [40, 5], [50, 20], [1, 'Turn']]), [10], [11], [50]],
  [make('MTEXT', [[10, 12], [20, 14], [40, 5], [50, 20], [1, 'Turn']]), [10], [], [50]],
  ...['SOLID', 'TRACE', '3DFACE'].map((type) => [make(type, [...points, [12, 25], [22, 4], [13, 26], [23, 5]]), [10, 11, 12, 13]]),
  [W.insert('Part', 12, 14, { rot: 20, sx: 2, sy: .5 }), [10], [], [50]],
  [make('LEADER', [...points.slice(0, 2), ...points.slice(0, 2), [211, 1], [221, 0]]), [10], [211]],
  [make('ACAD_TABLE', [[2, 'Part'], ...points]), [10], [11]],
  ...['WIPEOUT', 'IMAGE'].map((type) => [make(type, [...points, [12, 2], [22, 8], [14, .5], [24, .5]]), [10], [11, 12]]),
  [make('VIEWPORT', [[10, 12], [20, 14], [40, 50], [41, 30], [51, 20]]), [10], [], [51]],
];

for (const a of [90, 45]) for (const copy of [false, true]) test(`Rotate each Move kind: ${a} degrees, copy=${copy}`, () => {
  for (const [e, pts, vec = [], angles = []] of fixtures) {
    const raw = W.newDoc(); W.addBlock(raw, 'Part', [W.line(0, 0, 5, 0)]); W.addEntities(raw, e, W.line(1, 1, 2, 2));
    const before = structuredClone(raw), next = rotateEntities(raw, new Set([0]), pivot, a, copy), result = next.entities[copy ? 2 : 0];
    assert.deepEqual(raw, before, `${e.type} input unchanged`);
    assert.equal(next.entities[1], raw.entities[1]);
    if (copy) assert.equal(next.entities[0], e);
    for (const code of pts) pair(result, code, turned([value(e, code), value(e, code + 10)], a));
    for (const code of vec) pair(result, code, turned([value(e, code), value(e, code + 10)], a, true));
    for (const code of angles) close(value(result, code), value(e, code) + a);
    for (const code of [40, 41, 42, 43, 70, 71]) if (e.r.c.includes(code)) close(value(result, code), value(e, code));
    for (const prop of ['layer', 'aci', 'lw', 'lt', 'ps', 'flip']) assert.equal(result[prop], e[prop]);
    if (e.kids) { const kid = { r: result.kids[0] }; pair(kid, 10, turned([12, 14], a)); close(value(kid, 42), .5); }
    assert.deepEqual(next.blocks.Part, raw.blocks.Part, 'shared block stays local');
  }
});

test('Rotate repeated polyline vertices, omitted angles, missing y and mirrored OCS', () => {
  const raw = W.newDoc();
  W.addEntities(raw, W.lwpoly([[12, 14, .5], [18, 20, -.25]]), W.text(12, 14, 5, 'Turn'), W.insert('Part', 12, 14),
    make('POINT', [[10, 12]]), { ...W.arc(-12, 14, 8, 10, 50), flip: true },
    make('MTEXT', [[10, 12], [20, 14], [11, 0], [21, 0], [40, 5], [1, 'Turn']]),
    make('DIMENSION', [...points, [70, 0]]));
  raw.entities[2].kids = [make('ATTRIB', [...points, [40, 5], [50, 20], [1, 'Attribute']]).r];
  const r = rotateEntities(raw, new Set(raw.entities.map((_, i) => i)), pivot, 90);
  const xs = r.entities[0].r.v.filter((_, i) => r.entities[0].r.c[i] === 10).map(Number);
  assert.deepEqual(xs, [-4, -10]); close(value(r.entities[1], 50), 90); close(value(r.entities[2], 50), 90);
  pair(r.entities[3], 10, turned([12, 0], 90));
  pair(r.entities[4], 10, [4, 16]); close(value(r.entities[4], 50), -80);
  close(value(r.entities[5], 50), 90); close(value(r.entities[6], 50), 90);
  pair({ r: r.entities[2].kids[0] }, 10, turned([12, 14], 90)); close(value({ r: r.entities[2].kids[0] }, 50), 110);
});

test('Rotate hatches: polyline and arc boundaries, ellipse vectors, pattern origins / offsets, seed points', () => {
  const e = make('HATCH', [[10, 0], [20, 0], [91, 3], [92, 2], [72, 1], [73, 1], [93, 2],
    [10, 12], [20, 14], [42, .5], [10, 18], [20, 20], [97, 0], [92, 0], [93, 1], [72, 2],
    [10, 12], [20, 14], [40, 8], [50, 10], [51, 80], [73, 1], [97, 0], [92, 0], [93, 1], [72, 3],
    [10, 12], [20, 14], [11, 8], [21, 2], [40, .4], [50, 10], [51, 80], [97, 0],
    [75, 0], [52, 20], [78, 1], [53, 30], [43, 12], [44, 14], [45, 8], [46, 2], [49, 2], [98, 1], [10, 12], [20, 14]]);
  for (const a of [90, 45]) for (const copy of [false, true]) {
    const raw = { ...W.newDoc(), entities: [e] }, r = rotateEntities(raw, new Set([0]), pivot, a, copy).entities.at(-1);
    close(value(r, 10), 0); close(value(r, 20), 0); close(value(r, 42), .5); close(value(r, 49), 2);
    pair(r, 11, turned([8, 2], a, true));
    for (const [x, y, vector] of [[43, 44, false], [45, 46, true]]) {
      const p = turned([value(e, x), value(e, y)], a, vector); close(value(r, x), p[0]); close(value(r, y), p[1]);
    }
    close(value(r, 52), 20 + a); close(value(r, 53), 30 + a);
    const xs = r.r.v.filter((_, i) => r.r.c[i] === 10).map(Number);
    xs.slice(1).forEach((x, i) => close(x, turned(i === 1 ? [18, 20] : [12, 14], a)[0]));
    const angles = r.r.v.filter((_, i) => r.r.c[i] === 50).map(Number);
    assert.deepEqual(angles, [10 + a, 10], 'ellipse parameter angles stay local');
  }
});

test('Rotate hatch arc endpoints stay joined to their boundary line in either direction', () => {
  for (const ccw of [0, 1, undefined]) for (const copy of [false, true]) {
    const e = make('HATCH', [[70, 1], [91, 1], [92, 0], [93, 2], [72, 2],
      [10, 12], [20, 14], [40, 8], [50, 0], [51, 180], ...(ccw == null ? [] : [[73, ccw]]),
      [72, 1], [10, 4], [20, 14], [11, 20], [21, 14], [97, 0], [75, 0], [98, 0]]);
    const raw = { ...W.newDoc(), entities: [e] }, before = structuredClone(raw);
    const next = rotateEntities(raw, new Set([0]), pivot, 90, copy);
    const { items } = flatten({ ...raw, ...next, entities: [next.entities.at(-1)] });
    const ops = items[0].ops;
    assert.deepEqual([ops[0], ops[3], ops[10], ops[13], ops[16]], [0, 2, 1, 1, 9]);
    for (const [angle, line, original] of [[ops[7], 14, [20, 14]], [ops[8], 11, [4, 14]]]) {
      const endpoint = [ops[4] + ops[6] * Math.cos(angle), ops[5] + ops[6] * Math.sin(angle)];
      endpoint.forEach((v, i) => { close(v, ops[line + i]); close(v, turned(original, 90)[i]); });
    }
    assert.equal(ops[9], ccw === 0 ? 1 : 0);
    assert.deepEqual(raw, before);
    if (copy) assert.equal(next.entities[0], e);
  }
});

test('Rotate an ARC read with extrusion -Z places its centre and endpoints in world coordinates', () => {
  const doc = W.newDoc();
  W.addEntities(doc, make('ARC', [[10, -12], [20, 14], [40, 8], [50, 10], [51, 50], [210, 0], [220, 0], [230, -1]]));
  const raw = readDxf(W.writeDxf(doc));
  assert.equal(raw.entities[0].flip, true);
  for (const degrees of [90, -90]) for (const copy of [false, true]) {
    const next = rotateEntities(raw, new Set([0]), pivot, degrees, copy);
    const fl = flatten({ ...raw, ...next, entities: [next.entities.at(-1)] }), it = fl.items[0];
    const world = (x, y) => mapply(fl.mats[it.m], x, y);
    const check = (point, original) => point.forEach((v, i) => close(v, turned(original, degrees)[i]));
    check(world(it.ops[4], it.ops[5]), [12, 14]);
    for (const [index, angle] of [[7, 10], [8, 50]]) {
      check(world(it.ops[4] + it.ops[6] * Math.cos(it.ops[index]), it.ops[5] + it.ops[6] * Math.sin(it.ops[index])),
        [12 - 8 * Math.cos(angle * Math.PI / 180), 14 + 8 * Math.sin(angle * Math.PI / 180)]);
    }
  }
});

test('Rotate MLeader context points, directions and leader points without translating vectors', () => {
  for (const type of ['MLEADER', 'MULTILEADER']) for (const a of [90, 45]) for (const copy of [false, true]) {
    const e = make(type, [[300, 'CONTEXT_DATA{'], [10, 12], [20, 14], [12, 12], [22, 14], [13, 8], [23, 2], [42, .2],
      [302, 'LEADER{'], [10, 12], [20, 14], [11, 8], [21, 2], [304, 'LEADER_LINE{'], [10, 12], [20, 14], [305, '}'], [303, '}'], [301, '}']]);
    const raw = { ...W.newDoc(), entities: [e] }, r = rotateEntities(raw, new Set([0]), pivot, a, copy).entities.at(-1);
    pair(r, 10, turned([12, 14], a)); pair(r, 12, turned([12, 14], a));
    pair(r, 13, turned([8, 2], a, true)); pair(r, 11, turned([8, 2], a, true)); close(value(r, 42), .2 + a * Math.PI / 180);
  }
});

test('Rotate native dimensions isolates shared world blocks; kept dimension copies own their blocks', () => {
  for (const a of [90, 45]) for (const copy of [false, true]) {
    const raw = W.newDoc(); W.addBlock(raw, '*D1', [W.line(12, 14, 18, 20)]);
    W.addEntities(raw, make('DIMENSION', [[2, '*D1'], ...points, [50, 20]]), make('DIMENSION', [[2, '*D1'], ...points]));
    const before = structuredClone(raw), next = rotateEntities(raw, new Set([0]), pivot, a, copy), dim = next.entities[copy ? 2 : 0];
    const name = dim.r.v[dim.r.c.indexOf(2)]; assert.notEqual(name, '*D1');
    close(value(dim, 50), 20 + a);
    pair(next.blocks[name].entities[0], 10, turned([12, 14], a));
    assert.deepEqual(next.blocks['*D1'], raw.blocks['*D1']); assert.deepEqual(raw, before);
    Object.assign(raw, addDimension(raw, buildDim('aligned', { a: [12, 14], b: [18, 20], offset: 5, textH: 3 }, 1, 'PD_DIM_1')));
    const kept = rotateEntities(raw, new Set([2]), pivot, a, true);
    const name2 = kept.entities.at(-1).r.v[kept.entities.at(-1).r.c.indexOf(2)];
    assert.notEqual(name2, 'PD_DIM_1'); assert.deepEqual(kept.blocks.PD_DIM_1, raw.blocks.PD_DIM_1);
    const fl = flatten({ ...raw, ...kept, entities: [kept.entities.at(-1)] });
    const p = fl.items[0], start = mapply(fl.mats[p.m], p.ops[1], p.ops[2]);
    const orig = flatten({ ...raw, entities: [raw.entities[2]] }), op = orig.items[0];
    const expected = turned(mapply(orig.mats[op.m], op.ops[1], op.ops[2]), a);
    start.forEach((v, i) => close(v, expected[i]));
  }
});

test('Rotate angle convention, Shift steps, negative / full turns and invalid inputs', () => {
  close(rotationAngle([0, 0], [1, 1]), 45); close(rotationAngle([0, 0], [0, -1]), -90);
  close(rotationAngle([0, 0], [10, 3], true), 15);
  const raw = { ...W.newDoc(), entities: [W.line(12, 14, 18, 20)] };
  for (const a of [-90, 0, 45, 90, 360, 450]) {
    const want = turned([12, 14], a);
    pair(rotateEntities(raw, new Set([0]), pivot, a).entities[0], 10, want);
    mapply(rotationMatrix(pivot, a), 12, 14).forEach((v, i) => close(v, want[i]));
  }
  for (const [p, a] of [[null, 90], [[NaN, 0], 90], [pivot, Infinity]]) assert.throws(() => rotateEntities(raw, new Set([0]), p, a), /finite/);
  assert.throws(() => rotateEntities({ ...raw, entities: [make('UNKNOWN', points)] }, new Set([0]), pivot, 90));
});
