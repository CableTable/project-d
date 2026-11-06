import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as W from './web/dxf-write.js';
import { readDxf, decodeDxf, flatten } from './web/drawing.js';
import { newLayout, layoutRaw, readMeta } from './web/layoutdoc.js';
import { addDimension, buildDim } from './web/edit.js';

const get = (e, c) => +e.r.v[e.r.c.indexOf(c)];
const back = (doc, opts) => readDxf(W.writeDxf(doc, opts));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);

test('TODO 109a: mm to inches scales each entity and block once, keeps ratios and the entire source', () => {
  const doc = W.newDoc(4);
  W.addBlock(doc, 'part', [W.line(25.4, 0, 50.8, 0), W.circle(25.4, 0, 12.7)], [25.4, 0]);
  const ins = W.insert('part', 25.4, 50.8, { sx: 2, sy: 3, cols: 2, dx: 25.4 });
  ins.kids = [W.entity('ATTRIB', [[10, 25.4], [20, 50.8], [40, 2.54], [1, 'tag']]).r];
  W.addEntities(doc, W.line(0, 0, 100, 0), W.circle(25.4, 50.8, 12.7), W.arc(25.4, 0, 25.4, 12.345678, 123.456789),
    W.ellipse(25.4, 50.8, 50.8, 25.4, .333333), W.lwpoly([[0, 0, .414214], [25.4, 0]], { width: 2.54 }),
    W.text(25.4, 0, 2.54, 'unchanged'), ins,
    W.entity('SPLINE', [[70, 0], [71, 1], [72, 4], [73, 2], [40, 0], [40, .123456], [40, 1], [40, 1], [10, 25.4], [20, 0], [10, 50.8], [20, 25.4]]));
  const dim = addDimension(doc, buildDim('aligned', { a: [0, 0], b: [25.4, 0], offset: 10, override: 'custom <>' }, 1, 'PD_DIM_1'));
  assert.ok(dim); Object.assign(doc, dim);
  W.addEntities(doc, W.entity('DIMENSION', [[2, 'native'], [70, 0], [10, 25.4], [20, 0], [13, 0], [23, 0], [14, 25.4], [24, 0], [42, 25.4], [1, 'override']]));
  W.addBlock(doc, 'native', [W.line(0, 0, 25.4, 0), W.text(0, 0, 2.54, '25.40')]);
  const before = structuredClone(doc), saved = back(doc, { units: 'in', scale: 2 });
  assert.deepEqual(doc, before, 'entities, header, blocks, children and metadata are untouched');
  assert.equal(saved.header.$INSUNITS, '1'); assert.equal(saved.header.$MEASUREMENT, '0');
  near(get(saved.entities[0], 11), 100 / 25.4 * 2);
  near(get(saved.entities[1], 40), 1); near(get(saved.entities[2], 40), 2); near(get(saved.entities[2], 50), 12.345678);
  near(get(saved.entities[3], 11), 4); near(get(saved.entities[3], 21), 2); near(get(saved.entities[3], 40), .333333);
  near(get(saved.entities[4], 43), .2); near(get(saved.entities[4], 42), .414214);
  near(get(saved.entities[5], 40), .2); assert.equal(saved.entities[5].r.v[saved.entities[5].r.c.indexOf(1)], 'unchanged');
  near(get(saved.entities[6], 10), 2); near(get(saved.entities[6], 41), 2); near(get(saved.entities[6], 42), 3); near(get(saved.entities[6], 43), 1); near(get(saved.entities[6], 44), 2);
  near(+saved.entities[6].kids[0].v[saved.entities[6].kids[0].c.indexOf(40)], .2);
  assert.deepEqual(saved.blocks.part.base, [2, 0]); near(get(saved.blocks.part.entities[0], 11), 4);
  near(get(saved.entities[7], 10), 2); assert.deepEqual(saved.entities[7].r.v.filter((_, k) => saved.entities[7].r.c[k] === 40), ['0', '0.123456', '1', '1']);
  const native = saved.entities.find((e) => e.type === 'DIMENSION'); near(get(native, 42), 2);
  assert.equal(native.r.v[native.r.c.indexOf(1)], 'override'); near(get(saved.blocks.native.entities[0], 11), 2);
  const dimText = Object.entries(saved.blocks).find(([n]) => /^PD_DIM_/.test(n))[1].entities.filter((e) => e.type === 'TEXT');
  assert.ok(dimText.some((e) => e.r.v.includes('custom 2.00')));
  assert.deepEqual(flatten(saved).boxes.model?.map(Number.isFinite), [true, true, true, true]);
});

test('TODO 109a: feet, cm, m and unitless; header lengths scale, patterns and negative PDSIZE stay', () => {
  for (const [units, target, scale, expected] of [[2, 'mm', 1, 304.8], [5, 'mm', 1, 10], [6, 'in', 1, 1000 / 25.4], [0, 'unitless', 2, 2]]) {
    const doc = W.addEntities(W.newDoc(units), W.line(0, 0, 1, 0));
    for (const k of ['$DIMTXT', '$DIMASZ', '$DIMEXE', '$DIMEXO', '$DIMGAP', '$LTSCALE', '$PDSIZE']) doc.header[k] = '1';
    doc.ltypes.DASHED = { pattern: [1.234567, -.345678] };
    const before = structuredClone(doc), saved = back(doc, { units: target, scale });
    assert.deepEqual(doc, before); near(get(saved.entities[0], 11), expected);
    for (const k of ['$DIMTXT', '$DIMASZ', '$DIMEXE', '$DIMEXO', '$DIMGAP', '$LTSCALE', '$PDSIZE']) near(+saved.header[k], expected);
    assert.deepEqual(saved.ltypes.DASHED.pattern, doc.ltypes.DASHED.pattern);
    near(saved.header.$EXTMAX[0], expected); assert.equal(saved.header.$INSUNITS, target === 'unitless' ? '0' : target === 'mm' ? '4' : '1');
  }
  for (const size of ['0', '-3']) {
    const doc = W.newDoc(); doc.header.$PDSIZE = size;
    const saved = back(doc, { scale: 2 }); assert.equal(saved.header.$PDSIZE, size);
    assert.deepEqual(saved.header.$EXTMIN, [1e20, 1e20]); assert.deepEqual(saved.header.$EXTMAX, [-1e20, -1e20]);
  }
  const doc = W.addEntities(W.newDoc(), W.line(1, 2, 3, 4));
  assert.deepEqual(back(doc, { scale: 2, extents: [1, 2, 3, 4] }).header.$EXTMAX, [6, 8]);
  for (const type of [2, 5, 6]) {
    const dim = W.addEntities(W.newDoc(), W.entity('DIMENSION', [[70, type], [10, 1], [20, 0], [42, 1.234567]]));
    assert.equal(get(back(dim, { scale: 2, precision: 2 }).entities[0], 42), type === 6 ? 2.47 : 1.234567);
  }
});

test('TODO 109a: precision 2 and 0 round lengths, keep bulges, ratios, knots, angles and INSERT factors at six', () => {
  const doc = W.newDoc(); W.addBlock(doc, 'B', [W.line(0, 0, 1.234567, 0)]);
  W.addEntities(doc, W.line(1.234567, 2.345678, 7.874016, 0), W.ellipse(1.234567, 0, 7.874016, 0, .333333),
    W.lwpoly([[1.234567, 0, .414214], [7.874016, 0]], { width: 1.234567 }), W.insert('B', 1.234567, 0, { sx: 1.234567, rot: 12.345678 }),
    W.entity('SPLINE', [[10, 1.234567], [20, 0], [40, .123456]]), W.arc(0, 0, 1.234567, 12.345678, 123.456789),
    W.entity('MTEXT', [[10, 1.234567], [20, 0], [11, .707107], [21, .707107], [40, 1.234567], [1, 'direction']]),
    W.entity('DIMENSION', [[70, 2], [10, 1.234567], [20, 0], [42, 1.234567]]));
  for (const precision of [2, 0]) {
    const saved = back(doc, { precision });
    assert.equal(get(saved.entities[0], 10), precision === 2 ? 1.23 : 1);
    assert.equal(get(saved.entities[0], 11), precision === 2 ? 7.87 : 8);
    assert.equal(get(saved.entities[1], 40), .333333); assert.equal(get(saved.entities[2], 42), .414214);
    assert.equal(get(saved.entities[2], 43), precision === 2 ? 1.23 : 1);
    assert.equal(get(saved.entities[3], 41), 1.234567); assert.equal(get(saved.entities[3], 50), 12.345678);
    assert.equal(get(saved.entities[4], 40), .123456); assert.equal(get(saved.entities[5], 50), 12.345678);
    assert.equal(get(saved.entities[5], 40), precision === 2 ? 1.23 : 1);
    assert.equal(get(saved.entities[6], 11), .707107); assert.equal(get(saved.entities[6], 40), precision === 2 ? 1.23 : 1);
    assert.equal(get(saved.entities[7], 42), 1.234567, 'angular measurement is not a length');
  }
});

test('TODO 109a: default writer options are byte-identical to dc04385', () => {
  for (const [file, hash] of [['sample.dxf', 'fbf9497f2fe92e6fc707e37ab371dfb7e04cab7d7c1ba195034b1a9de191e5c7'],
    ['inch.dxf', '09a48a5e7a87d62abcfe3f541ab53f426e5079dde99574650977a3e6d813a2e1'],
    ['many-layers.dxf', 'cd55c9db46f71712f0ae936d2b3cc74bd29faf929441526e5504753b6ad59f27']]) {
    const doc = readDxf(decodeDxf(readFileSync('fixtures/' + file))), original = W.writeDxf(doc);
    assert.equal(createHash('sha256').update(original).digest('hex'), hash);
    assert.equal(W.writeDxf(doc, { scale: 1, precision: 6 }), original);
  }
  assert.equal(W.fmt(1.23456789), '1.234568');
});

test('TODO 109a: layouts keep metadata at factor 1 and drop it otherwise; invalid options refuse', () => {
  const doc = layoutRaw(newLayout('Export')), before = structuredClone(doc);
  assert.ok(readMeta(back(doc, { units: 'mm', scale: 1 })));
  assert.equal(readMeta(back(doc, { units: 'in', scale: 1 })), null);
  assert.equal(readMeta(back(doc, { scale: 2 })), null);
  assert.deepEqual(doc, before);
  for (const opts of [{ scale: 0 }, { scale: -1 }, { scale: Infinity }, { scale: NaN }, { scale: '2' }, { precision: -1 },
    { precision: 9 }, { precision: 1.5 }, { precision: '2' }, { units: 'ft' }, { units: 'unitless' }]) assert.throws(() => W.writeDxf(doc, opts));
});
