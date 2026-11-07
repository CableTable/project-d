import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as W from './web/dxf-write.js';
import { readDxf, decodeDxf, flatten } from './web/drawing.js';
import { newLayout, layoutRaw, readMeta } from './web/layoutdoc.js';
import { addDimension, buildDim, relabel } from './web/edit.js';
import { nativeDimensionOverrides } from './web/dimension-dxf.js';
import { measuredText, readOverride, measureOverride } from './web/dimension-text.js';

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
  assert.ok(dimText.some((e) => e.r.v.includes('custom 2.0000"')));
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
    const units = +doc.header.$INSUNITS === 1 ? 'in' : 'mm';
    assert.equal(W.writeDxf(doc, { units, scale: 1, precision: 6 }), original);
  }
  const doc = W.newDoc(); doc.header.$MEASUREMENT = '0';
  assert.equal(W.writeDxf(doc, { units: 'mm', scale: 1, precision: 6 }), W.writeDxf(doc));
  delete doc.header.$INSUNITS;
  assert.equal(W.writeDxf(doc, { units: 'unitless', scale: 1, precision: 6 }), W.writeDxf(doc), 'an absent unit header stays absent');
  assert.equal(W.fmt(1.23456789), '1.234568');
});

for (const [source, target, length, factor, expected] of [[1, 'mm', 1, 25.4, '25.40'], [4, 'in', 25.4, 1, '1.0000"']]) {
  test(`TODO 109a fix: kept dimension labels from geometry, ${source === 1 ? 'in to mm' : 'mm to in'}`, () => {
    for (const units of ['mm', 'inch']) for (const native of [false, true]) {
      let doc = W.newDoc(source);
      Object.assign(doc, addDimension(doc, buildDim('aligned', { a: [0, 0], b: [length, 0], offset: 0, units, override: 'Width <>' }, factor, 'PD_DIM_1')));
      if (native) doc = nativeDimensionOverrides(doc);
      const before = structuredClone(doc), saved = back(doc, { units: target });
      assert.deepEqual(doc, before);
      assert.ok(saved.blocks.PD_DIM_1.entities.some((e) => e.type === 'TEXT' && e.r.v.includes('Width ' + expected)), `${source} to ${target}, ${units}, native ${native}`);
    }
  });
}
test('TODO 109a fix: unit conversion relabels even when scale cancels its geometry factor', () => {
  const doc = W.newDoc(1);
  Object.assign(doc, addDimension(doc, buildDim('aligned', { a: [0, 0], b: [1, 0], offset: 0, units: 'inch' }, 25.4, 'PD_DIM_1')));
  assert.ok(back(doc, { units: 'mm', scale: 1 / 25.4 }).blocks.PD_DIM_1.entities.some((e) => e.r.v.includes('1.00')), 'labels change even when the combined geometry factor is one');
});

test('TODO 109a fix: native MTEXT scales at 2, preserving formatting, suffix and the dimension override', () => {
  const doc = W.newDoc();
  W.addBlock(doc, '*D1', [W.line(0, 0, 25.4, 0), W.mtext(0, 0, 2.5, '{\\A1;\\H0.7x;25.40 mm}')]);
  W.addEntities(doc, W.entity('DIMENSION', [[2, '*D1'], [70, 1], [13, 0], [23, 0], [14, 25.4], [24, 0], [42, 25.4], [1, '{\\A1;<> mm}']]));
  const before = structuredClone(doc), saved = back(doc, { scale: 2 });
  assert.deepEqual(doc, before);
  assert.ok(saved.blocks['*D1'].entities[1].r.v.includes('{\\A1;\\H0.7x;50.80 mm}'));
  assert.ok(saved.entities[0].r.v.includes('{\\A1;<> mm}'));
  const inches = back(doc, { units: 'in' });
  assert.ok(inches.blocks['*D1'].entities[1].r.v.includes('{\\A1;\\H0.7x;1.0000"}'));
});

test('TODO 109a fix 2: %%c diameter labels and stacked tolerances convert, alternate units follow the scale', () => {
  const texts = ['%%c25.40', '{\\A1;%%C25.40}', '25.40\\S+0.1^-0.1;', '25.40 [1.00]', '25.40 mm [1.00]'];
  const doc = W.newDoc();      // one dimension per text: a block has one primary value
  texts.forEach((t, i) => {
    W.addBlock(doc, '*D' + i, [W.mtext(0, 0, 2.5, t)]);
    W.addEntities(doc, W.entity('DIMENSION', [[2, '*D' + i], [70, 1], [13, 0], [23, 0], [14, 25.4], [24, 0], [42, 25.4]]));
  });
  const before = structuredClone(doc), got = (opts) => { const s = back(doc, opts); return texts.map((_, i) => s.blocks['*D' + i].entities[0].r.v.slice(-1)[0]); };
  assert.deepEqual(got({ units: 'in' }), ['%%c1.0000"', '{\\A1;%%C1.0000"}', '1.0000"\\S+0.004^-0.004;', '1.0000" [1.00]', '1.0000" [1.00]']);
  assert.deepEqual(got({ scale: 2 }), ['%%c50.80', '{\\A1;%%C50.80}', '50.80\\S+0.2^-0.2;', '50.80 [2.00]', '50.80 mm [2.00]']);
  assert.deepEqual(doc, before);
});

test('TODO 109a fix 4: one number scan, one row per dimension label form through Export', async (t) => {
  const rows = [      // [label, export options, label saved, geometry length, source units]
    ['25.40\\S+.1^-.1;', { units: 'in' }, '1.0000"\\S+.004^-.004;'],
    ['25.40\\S+.1^-.1;', { scale: 2 }, '50.80\\S+.2^-.2;'],
    ['∅25.40', { units: 'in' }, '∅1.0000"'],
    ['\\U+220525.40', { units: 'in' }, '∅1.0000"'],
    ['25.40%%p0.1', { units: 'in' }, '1.0000"%%p0.004'],
    ['25.40±0.1', { units: 'in' }, '1.0000"±0.004'],
    ['%%c25.40%%p0.1', { scale: 2 }, '%%c50.80%%p0.2'],
    ['25.40 [1.00]', { scale: 2 }, '50.80 [2.00]'],
    ['25.40 [1.00]', { units: 'in', scale: 2 }, '2.0000" [2.00]'],
    ['25.40 [1.00]', { units: 'in' }, '1.0000" [1.00]'],
    ['25.40\\S+0.1^-0.1;', { scale: 1e-101 }, '0.00\\S+0.' + '0'.repeat(100) + '^-0.' + '0'.repeat(100) + ';'],      // 100 decimals: the toFixed limit
    ['\\pi2.5;25.40', { units: 'in' }, '\\pi2.5;1.0000"'],      // \p takes parameters
    ['\\pxi-3,t3;25.40', { scale: 2 }, '\\pxi-3,t3;50.80'],
    ['25.40 ±0.1 mm', { units: 'in' }, '1.0000" ±0.004"'],      // a unit change swaps the suffix on every number
    ['25.40 ±0.1 mm', { scale: 2 }, '50.80 ±0.2 mm'],
    ['{\\L25.40\\l}', { units: 'in' }, '{\\L1.0000"\\l}'],
    ['25.40\\P', { units: 'in' }, '1.0000"\\P'],
    ['\\S25.50^25.30;', { units: 'in' }, '\\S1.0039^0.9961;'],
    ['25.40\\S+0.1#-0.1;', { units: 'in' }, '1.0000"\\S+0.004#-0.004;'],
    ['.50"', { units: 'mm' }, '12.70', .5, 1],
    ['R.25"', { scale: 2 }, 'R0.50"', .25, 1],
    ['%%c.50', { scale: 2 }, '%%c1.00'],
    ['{\\H2.5;\\A1;\\L25.40\\l\\P}', { units: 'in' }, '{\\H2.5;\\A1;\\L1.0000"\\l\\P}'],
    ['5', { units: 'in' }, '0.20"', 5],
    ['12', { units: 'in' }, '0.47"', 12],
    ['100', { units: 'in' }, '3.94"', 100],
    ['5', { units: 'in' }, '0.20"', null],      // no native measurement: convert the number itself
    ['60.00°', { units: 'in' }, '60.00°'],
    ['60.00°', { scale: 2 }, '60.00°'],
  ];
  for (const [label, opts, expected, length = 25.4, source = 4] of rows) await t.test(`${label} ${JSON.stringify(opts)}`, () => {
    const doc = W.newDoc(source);
    W.addBlock(doc, '*D1', [W.line(0, 0, length ?? 5, 0), W.mtext(0, 0, 2.5, label)]);
    W.addEntities(doc, W.entity('DIMENSION', [[2, '*D1'], [70, 1], ...(length == null ? [] : [[13, 0], [23, 0], [14, length], [24, 0], [42, length]])]));
    const before = structuredClone(doc);
    const e = back(doc, opts).blocks['*D1'].entities[1];
    assert.equal(e.r.v[e.r.c.indexOf(1)], expected, `${label} ${JSON.stringify(opts)}`);
    assert.deepEqual(doc, before, 'Export never changes the source');
  });
});

test('TODO 109a fix 4: unreadable labels stay unchanged and are listed in the Export report note', async (t) => {
  const labels = ['25,40', 'unreadable', '25.40\\S+0.1#-0.1', '{\\H2.5 25.40}',
    '4X∅10', '2X25.40', '2 X 25.40', '2X 25.40', 'M10', 'SEE NOTE 3', '25.40 (NOTE 3)', '4 HOLES ∅10', '(25.40)', '25.40 TYP', '25.40 50.80',
    '5\'-6"', '10\'-12"', '2.00 x 45°', '2.5 m', '25.4 cm', '5.5 ft', '%%176 60', '60° TYP'];
  for (const opts of [{ units: 'in' }, { scale: 2 }]) for (const label of labels) await t.test(`${label} ${JSON.stringify(opts)}`, () => {
    const doc = W.newDoc();
    W.addBlock(doc, '*D1', [W.mtext(0, 0, 2.5, label)]);
    W.addEntities(doc, W.entity('DIMENSION', [[2, '*D1'], [70, 1], [42, 25.4]]));
    const before = structuredClone(doc), report = W.writeDxfWithReport(doc, opts);
    assert.equal(readDxf(report.text).blocks['*D1'].entities[0].r.v.slice(-1)[0], label);
    assert.deepEqual(report.unreadLabels, [label]);
    assert.ok(W.saveReportNote(report).includes(label));
    assert.deepEqual(doc, before);
  });
});

test('TODO 109a fix 4: kept Measure deltas are recomputed after relabel, including native overrides', async (t) => {
  for (const [opts, measured, dx, dy] of [[{ units: 'in' }, '1.0000"', '1.0000', '0.0000'], [{ scale: 2 }, '50.80', '50.80', '0.00']]) for (const native of [false, true]) await t.test(`${JSON.stringify(opts)} native ${native}`, () => {
    let doc = W.newDoc();
    const override = measureOverride([0, 0], [25.4, 0], 1, 2);
    Object.assign(doc, addDimension(doc, buildDim('aligned', { a: [0, 0], b: [25.4, 0], offset: 0, override }, 1, 'PD_DIM_1')));
    if (native) doc = nativeDimensionOverrides(doc);
    const before = structuredClone(doc), text = W.writeDxf(doc, opts), saved = readDxf(text), ents = saved.blocks.PD_DIM_1.entities;
    const expected = `<>  (ΔX ${dx}, ΔY ${dy})`;
    assert.equal(readOverride(ents), expected);
    assert.equal(measuredText(ents), measured);
    assert.ok(ents.some((e) => e.type === 'TEXT' && e.r.v.includes(expected.replace('<>', measured))));
    if (native) assert.ok(text.split('  0\r\nDIMENSION\r\n')[1].split('  0\r\n')[0].includes('  1\r\n' + expected + '\r\n'));
    assert.deepEqual(doc, before);
  });
});

test('TODO 109a fix 5: a kept callout uses the label unit and the points as the INSERT draws them', async (t) => {
  for (const [name, source, labelUnits, factor, b, opts, rotate, label, deltas] of [
    ['inch source, mm label, scale 2', 1, 'mm', 25.4, [1, 0], { scale: 2 }, 0, '50.80', 'ΔX 50.80, ΔY 0.00'],
    ['mm source, inch label, scale 2', 4, 'inch', 1, [25.4, 0], { scale: 2 }, 0, '2.00"', 'ΔX 2.00, ΔY 0.00'],
    ['mm source, inch label, to inches', 4, 'inch', 1, [25.4, 0], { units: 'in' }, 0, '1.0000"', 'ΔX 1.0000, ΔY 0.0000'],
    ['INSERT rotated 90, scale 2', 4, 'mm', 1, [25.4, 0], { scale: 2 }, 90, '50.80', 'ΔX 0.00, ΔY 50.80'],
    ['INSERT rotated 90, to inches', 4, 'mm', 1, [25.4, 0], { units: 'in' }, 90, '1.0000"', 'ΔX 0.0000, ΔY 1.0000'],
  ]) await t.test(name, () => {
    const doc = W.newDoc(source);
    Object.assign(doc, addDimension(doc, buildDim('aligned', { a: [0, 0], b, offset: 0, units: labelUnits, override: measureOverride([0, 0], b, 1, 2) }, factor, 'PD_DIM_1')));
    const ins = doc.entities.find((e) => e.type === 'INSERT'); if (rotate) { ins.r.c.push(50); ins.r.v.push(String(rotate)); }
    const before = structuredClone(doc), ents = back(doc, opts).blocks.PD_DIM_1.entities;
    assert.equal(readOverride(ents), `<>  (${deltas})`);
    assert.equal(measuredText(ents), label);
    assert.deepEqual(doc, before);
  });
});

test('TODO 109a fix 5: native group 42 counts only above 0; a block has one primary value', async (t) => {
  for (const [name, texts, m42, expected] of [
    ['42 = 0', ['25.40'], 0, ['1.0000"']],
    ['42 = -1', ['25.40'], -1, ['1.0000"']],
    ['42 missing', ['25.40'], null, ['1.0000"']],
    ['42 = 25.4', ['25.40'], 25.4, ['1.0000"']],
    ['separate +0.1 text', ['25.40', '+0.1'], 25.4, ['1.0000"', '+0.004']],
  ]) await t.test(name, () => {
    const doc = W.newDoc();
    W.addBlock(doc, '*D1', texts.map((x, i) => W.mtext(0, i, 2.5, x)));
    W.addEntities(doc, W.entity('DIMENSION', [[2, '*D1'], [70, 1], ...(m42 == null ? [] : [[42, m42]])]));
    const before = structuredClone(doc), got = back(doc, { units: 'in' }).blocks['*D1'].entities.map((e) => e.r.v[e.r.c.indexOf(1)]);
    assert.deepEqual(got, expected);
    assert.deepEqual(doc, before);
  });
});

test('TODO 109a fix 5: <> labels and blank texts stay without a note; Scale at factor 1 leaves .50; Scale keeps counts and codes', () => {
  const doc = W.newDoc();
  W.addBlock(doc, '*D1', [W.mtext(0, 0, 2.5, 'Width <>'), W.mtext(0, 1, 2.5, ' ')]);
  W.addEntities(doc, W.entity('DIMENSION', [[2, '*D1'], [70, 1], [42, 25.4]]));
  const report = W.writeDxfWithReport(doc, { units: 'in' }), ents = readDxf(report.text).blocks['*D1'].entities;
  assert.deepEqual(ents.map((e) => e.r.v[e.r.c.indexOf(1)]), ['Width <>', ' ']);
  assert.equal(report.unreadLabels, undefined);
  const read = [], one = (x, s) => relabel([W.mtext(0, 0, 2.5, x)], s, null, (l) => read.push(l))[0].r.v.slice(-1)[0];
  assert.equal(one('.50', 1), '.50');
  assert.equal(one('4X∅10', 2), '4X∅10');
  assert.equal(one('SEE NOTE 3', 2), 'SEE NOTE 3');
  assert.equal(one('\\pxi-3,t3;25.40', 2), '\\pxi-3,t3;50.80');
  assert.deepEqual(read, ['4X∅10', 'SEE NOTE 3']);
});

test('TODO 109a fix: DIMSTYLE lengths and DIMLFAC follow scale and target units, including PD_DIM styles', () => {
  let doc = W.newDoc();
  Object.assign(doc, addDimension(doc, buildDim('aligned', { a: [0, 0], b: [25.4, 0], offset: 10, textH: 2.5, override: 'Width <>' }, 1, 'PD_DIM_1')));
  doc = nativeDimensionOverrides(doc);
  const lengths = [41, 42, 43, 44, 45, 46, 47, 48, 49, 140, 141, 142, 147, 148];
  doc.dimstyles.Standard = { c: [...lengths, 40, 143, 144, 146, 271], v: [...lengths.map(() => '2.5'), '3', '0.5', '2', '.5', '2'] };
  W.addEntities(doc, W.entity('LEADER', [[3, 'Standard'], [10, 0], [20, 0]]));
  const val = (r, c) => +r.v[r.c.indexOf(c)], before = structuredClone(doc);
  const scaled = back(doc, { scale: 2 });
  for (const c of lengths) near(val(scaled.dimstyles.Standard, c), 5);
  near(val(scaled.dimstyles.Standard, 143), .5);       // DIMALTF is a multiplier, not a length
  near(val(scaled.dimstyles.Standard, 40), 3); near(val(scaled.dimstyles.Standard, 144), 2); near(val(scaled.dimstyles.Standard, 146), .5);
  for (const [units, target] of [['mm', 4], ['in', 1]]) {
    const saved = back(doc, { units, scale: 2 }), factor = units === 'in' ? 2 / 25.4 : 2;
    near(val(saved.dimstyles.PD_DIM_1, 140), 2.5 * factor);
    near(val(saved.dimstyles.PD_DIM_1, 144), 1);
    near(val(saved.dimstyles.Standard, 144), units === 'in' ? 1 : 2);
    assert.equal(saved.header.$INSUNITS, String(target));
  }
  assert.deepEqual(doc, before);
});

test('TODO 109a fix: other source units export unchanged; unsupported conversions refuse; header sizes scale', () => {
  for (const units of [3, 7, 8, 10, 14]) {
    const doc = W.addEntities(W.newDoc(units), W.line(1, 2, 3, 4));
    assert.equal(W.writeDxf(doc, { scale: 1, precision: 6 }), W.writeDxf(doc));
    assert.equal(back(doc, { scale: 2 }).header.$INSUNITS, String(units));
    assert.throws(() => W.writeDxf(doc, { units: 'mm' }), /Cannot convert/);
  }
  const doc = W.newDoc();
  Object.assign(doc.header, { $TEXTSIZE: '2.5', $LIMMIN: [1, 2], $LIMMAX: [3, 4], $INSBASE: [5, 6] });
  const before = structuredClone(doc), saved = back(doc, { scale: 2 });
  assert.equal(saved.header.$TEXTSIZE, '5');
  for (const key of ['$LIMMIN', '$LIMMAX', '$INSBASE']) assert.deepEqual(saved.header[key], doc.header[key].map((n) => n * 2));
  assert.deepEqual(doc, before);
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
