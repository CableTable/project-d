import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, format, formatArea, displayUnit, defaultUnit, sidecarPath, isSidecar, encode, decode, UNITS } from './web/units.js';
import { fieldsOf, fieldText, fieldUnit, parseField, setField } from './web/props.js';
import { line, circle, lwpoly } from './web/dxf-write.js';
import { measureTwo, formatMeasure, lineOf } from './web/edit.js';
import { rulerTicks } from './web/guides.js';
import { quickSelect, numberValue } from './web/qselect.js';
import { dragGrip, readoutOf } from './web/grips.js';
import { readout } from './web/gripmode.js';
import { fmtLength, label } from './web/geom.js';
import { dynamicInput } from './web/draw.js';
import { parseInput, typedPoint, createTool, toolType } from './web/draw.js';
import { parseMm, parseAngle } from './web/place.js';
import { typedLength } from './web/linked-dimensions.js';
import { COMMANDS } from './web/cmdbar.js';
import { createInput, inputKey, pointInput, toolPointInput } from './web/dynamic-input.js';
import { parseLine } from './web/array.js';
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('TODO 222b: display unit and areas, with unchanged mm precision', () => {
  assert.equal(displayUnit(), 'mm');
  assert.equal(displayUnit({ raw: { header: { $INSUNITS: 1 } } }), 'inch');
  assert.equal(displayUnit({ raw: { header: { $INSUNITS: 2 } } }), 'ft');
  assert.equal(displayUnit({ drawingUnit: 'ft-in', raw: { header: { $INSUNITS: 4 } } }), 'ft-in');
  assert.equal(formatArea(1234.567), '1234.57 mm²');
  assert.equal(formatArea(25.4 ** 2, 'inch'), '1.00 in²');
  for (const unit of ['ft', 'ft-in']) assert.equal(formatArea(304.8 ** 2 * 12.3456, unit), '12.35 ft²');
  assert.equal(formatArea(0, 'ft-in'), '0.00 ft²');
  assert.equal(format(1066.8, 'mm', (v) => v.toFixed(2)), '1066.80');
});

test('TODO 222b: Properties displays lengths, coordinates, radius and areas; marks store file units once', () => {
  for (const factor of [1, 25.4, 304.8]) {
    const ent = line(0, 0, 1066.8 / factor, 0);
    const field = fieldsOf([ent], factor).find((f) => f.key === 'length');
    assert.equal(fieldText(field), '1066.80'); assert.equal(fieldText(field, 'ft-in'), `3'-6"`);
    const changed = setField(ent, 'length', parseField('length', "4'", 'ft-in'), factor);
    near(lineOf(changed)[2] * factor, 1219.2); near(lineOf(ent)[2] * factor, 1066.8);
    const c = circle(1066.8 / factor, -152.4 / factor, 152.4 / factor);
    for (const [key, expected] of [['radius', `0'-6"`], ['diameter', `1'-0"`], ['centreX', `3'-6"`], ['centreY', `-0'-6"`]]) {
      assert.equal(fieldText(fieldsOf([c], factor).find((f) => f.key === key), 'ft-in'), expected);
    }
    near(fieldsOf([setField(c, 'centreX', parseField('centreX', "10'", 'inch'), factor)], factor).find((f) => f.key === 'centreX').value, 3048);
    near(fieldsOf([setField(c, 'radius', parseField('radius', '6"', 'ft'), factor)], factor)[0].value, 152.4);
  }
  const area = fieldsOf([lwpoly([[0, 0], [304.8, 0], [304.8, 304.8], [0, 304.8]], { closed: true })]).find((f) => f.key === 'area');
  assert.equal(fieldText(area), '92903.04'); assert.equal(fieldText(area, 'ft-in'), '1.00');
  assert.equal(fieldUnit(area, 'ft-in'), 'ft²'); assert.equal(fieldUnit({ unit: 'mm' }, 'inch'), 'inch');
  assert.equal(parseField('length', 'bad', 'ft-in'), null);
  assert.equal(parseField('textAngle', '30', 'ft-in'), 30);
  assert.equal(fieldText({ key: 'angle', unit: '°', value: 30 }, 'ft-in'), '30.00');
});

test('TODO 222b: Measure, callout, geometry labels and grip lengths share drawing-unit formats; angles stay degrees', () => {
  const m = measureTwo([0, 0], [1066.8, 0]);
  assert.equal(formatMeasure(m), 'Distance 1066.8 mm   ΔX 1066.8   ΔY 0   Angle 0°');
  assert.equal(formatMeasure(m, 'ft-in'), `Distance 3'-6"   ΔX 3'-6"   ΔY 0'-0"   Angle 0°`);
  assert.equal(fmtLength(1066.8, 'ft'), "3.500'");
  assert.equal(label({ kind: 'distance', value: 1066.8, dx: 1066.8, dy: 0 }, 'ft-in'), `Distance 3'-6" (x 3'-6" · y 0'-0")`);
  assert.equal(dynamicInput([0, 0], [1066.8, 0], 2, 'ft-in').length, `3'-6"`);
  assert.equal(dynamicInput([0, 0], [1066.8, 0], 2).length, '1066.80 mm');
  const ent = line(0, 0, 1000, 0), next = dragGrip(ent, 'b', [1066.8, 0]).ent;
  assert.equal(readoutOf(ent, 'b', next), '1066.80 mm · 0.00°');
  assert.equal(readoutOf(ent, 'b', next, 1, 'ft-in'), `3'-6" · 0.00°`);
  assert.equal(readout('MOVE', [0, 0], [1066.8, 0], 1, 'ft-in'), `Move ΔX 3'-6" ΔY 0'-0"`);
  assert.equal(readout('ROTATE', [0, 0], 30, 1, 'ft-in'), 'Rotate 30.00°');
});

test('TODO 222b: ruler labels at whole feet/inches and minor ticks on inches, including negative coordinates', () => {
  for (const scale of [.1, 1, 10]) for (const unit of ['inch', 'ft-in']) {
    const ticks = rulerTicks(-1066.8, 1066.8, scale, 64, unit);
    const majorFactor = unit === 'inch' ? 25.4 : 304.8;
    for (const t of ticks.ticks) near(t.v / (t.major ? majorFactor : 25.4), Math.round(t.v / (t.major ? majorFactor : 25.4)), 1e-7);
    assert.ok(ticks.ticks.some((t) => t.v === 0 && t.major));
  }
  const ticks = rulerTicks(0, 1066.8, 1, 64, 'ft-in');
  assert.deepEqual(ticks.ticks.filter((t) => t.major).map((t) => format(t.v, 'ft-in')), [`0'-0"`, `1'-0"`, `2'-0"`, `3'-0"`]);
  near(ticks.minor, 25.4);
});

test('TODO 222b: Quick select length marks and shown precision in every unit, file units and area filters', () => {
  const ents = [line(0, 0, 1066.8, 0), line(0, 0, 1219.2, 0)];
  for (const [unit, value] of [['mm', '1066.8'], ['inch', '42.000"'], ['ft', "3.500'"], ['ft-in', `3'-6"`]]) {
    for (const [operator, expected] of [['eq', [0]], ['gt', [1]], ['lt', []], ['ne', [1]]]) {
      assert.deepEqual(quickSelect(ents, {}, { type: 'LINE', property: 'length', operator, value, unit }), expected);
    }
  }
  assert.deepEqual(quickSelect([line(0, 0, 3.5, 0)], {}, { type: 'LINE', property: 'length', operator: 'eq', value: `3'-6"`, unit: 'ft-in', factor: 304.8 }), [0]);
  assert.deepEqual(quickSelect(ents, {}, { type: 'LINE', property: 'length', operator: 'eq', value: 'bad', unit: 'ft-in' }), []);
  const poly = lwpoly([[0, 0], [304.8, 0], [304.8, 304.8]], { closed: true });
  assert.deepEqual(quickSelect([poly], {}, { type: 'LWPOLYLINE', property: 'area', operator: 'eq', value: '.5', unit: 'ft-in' }), [0]);
  assert.equal(numberValue('1e308', { unit: 'mm²' }, 'ft-in'), null);
});

test('TODO 222a: lengths, marks in any unit, comma rule and invalid tokens', () => {
  for (const u of UNITS) {
    near(parse(`3'6"`, u), 1066.8); near(parse(`10'`, u), 3048); near(parse('6"', u), 152.4);
    near(parse(`-5'-3"`, u), -1600.2); near(parse(`5'-3.25"`, u), 1606.55);
    assert.equal(parse('12 mm', u), 12);
    for (const s of [`'`, '"', '', '1e3', '12abc', `3'-`, '--3', 'Infinity', '1,2,3']) assert.equal(parse(s, u), null, `${u}: ${s}`);
  }
  assert.equal(parse('12,5', 'mm'), 12.5);
  for (const u of ['inch', 'ft', 'ft-in']) {
    assert.equal(parse('12,5', u), null); assert.equal(parse('12,5mm', u), null);
  }
  near(parse('3', 'inch'), 76.2); near(parse('3', 'ft'), 914.4); near(parse('3', 'ft-in'), 914.4);
  near(parseMm(`3'6"`, 'ft-in'), 1066.8);
  assert.equal(parseAngle(`10'`), null); assert.equal(parseAngle('30°'), 30);
});

test('TODO 222a: every printed form reads back, including negative and carrying inches', () => {
  assert.equal(format(1600.2, 'ft'), "5.250'");
  assert.equal(format(60, 'inch'), '2.362"');
  assert.equal(format(1600.2, 'ft-in'), `5'-3"`);
  assert.equal(format(1606.55, 'ft-in'), `5'-3.25"`);
  assert.equal(format(-1600.2, 'ft-in'), `-5'-3"`);
  assert.equal(format(304.799, 'ft-in'), `1'-0"`);
  for (const u of UNITS) for (const n of [0, .001, -.001, 60, 1066.8, -1600.2, 1606.55, 304.799, 1e6]) {
    const text = format(n, u), back = parse(text, u);
    assert.notEqual(back, null, text); assert.equal(format(back, u), text);
    near(n, back, (u === 'mm' ? .005 : u === 'inch' ? .0127 : u === 'ft' ? .1524 : .127) + 1e-8);
  }
});

test('TODO 222a: overflowing point tokens reach the finite check; scalar lengths stay refused', () => {
  const huge = '9'.repeat(310);
  for (const unit of UNITS) {
    for (const text of [huge + ',0', '@0,-' + huge, huge + 'mm,0', huge + "',0", '@' + huge + '<30']) {
      const input = parseInput(text, unit);
      assert.ok(['xy', 'polar'].includes(input.kind), text);
      assert.equal(typedPoint(input, [0, 0]), null, text);
    }
    assert.equal(parse(huge, unit), null);
    assert.equal(parseInput(huge + 'abc,0', unit).kind, 'bad');
  }
});

test('TODO 222a: point tokens, polar degrees, option values and dimension styles', () => {
  const xy = parseInput(`3',4'`, 'inch'), rel = parseInput(`@3',6"`, 'ft');
  assert.equal(xy.kind, 'xy'); assert.equal(xy.rel, false); near(xy.x, 914.4); near(xy.y, 1219.2);
  assert.equal(rel.rel, true); near(rel.x, 914.4); near(rel.y, 152.4);
  assert.deepEqual(parseInput(`10'<30`, 'ft-in'), { kind: 'polar', rel: false, abs: false, len: 3048, ang: 30 });
  assert.deepEqual(parseInput('1,2', 'ft'), { kind: 'xy', rel: false, abs: false, x: 304.8, y: 609.6 });
  for (const s of [`'`, '"', `3',4',5'`, `10'<30'`]) assert.equal(parseInput(s, 'ft').kind, 'bad');
  const c = createTool('circle'); toolType(c, '0,0', 'ft');
  near(toolType(c, `r 3'6"`, 'ft-in').made[0].r, 1066.8);
  near(typedLength(`3'6"`), 1066.8); near(typedLength(`3'6"`, 'inch'), 42);
  near(typedLength('6"'), 152.4);
  near(typedLength('3.5', 'inch', 'ft-in'), 42);
  const array = parseLine(`s 3'6" 2' col 3 1`, 'rect', 'ft-in');
  assert.deepEqual(array.map((s) => s.opt), ['spacing', 'columns']); near(array[0].args[0], 1066.8);
  assert.equal(array[0].args[1], 609.6); assert.deepEqual(array[1].args, [3, 304.8]);
});

test('TODO 222a: Dynamic input converts typed lengths once and keeps angles and mouse values', () => {
  let s = createInput(false);
  for (const key of `3'6"<30`) s = inputKey(s, key, false);
  const r = pointInput(s, [0, 0], [2000, 1000], 'Length', 'ft-in');
  near(Math.hypot(...r.point), 1066.8); near(Math.atan2(r.point[1], r.point[0]) * 180 / Math.PI, 30);
  near(parseInput(r.text, 'ft-in').len, 1066.8);
  s = createInput(true); s.values[0] = '2';
  const xy = pointInput(s, null, [10, 15], 'Length', 'ft'); near(xy.point[0], 609.6); assert.equal(xy.point[1], 15);
  s = createInput(false, 'radius'); s.values[0] = '6"';
  const radius = toolPointInput(s, { kind: 'circle', pts: [[0, 0]], hover: [100, 0] }, 'ft');
  near(radius.value, 152.4); near(parseInput(radius.text, 'ft').v, 152.4);
  s.mode = 'angle'; s.values[0] = '30';
  assert.equal(toolPointInput(s, { pts: [[0, 0]], hover: [100, 0] }, 'ft').value, 30);
});

test('TODO 222a: command names and aliases reserve length marks', () => {
  for (const c of COMMANDS) for (const word of [c.name, ...c.alias]) assert.doesNotMatch(word, /['"]/);
});

test('TODO 222a: defaults and validated sidecars', () => {
  assert.equal(defaultUnit('1'), 'inch'); assert.equal(defaultUnit(2), 'ft');
  for (const n of [0, 4, 6, undefined]) assert.equal(defaultUnit(n), 'mm');
  assert.equal(sidecarPath('C:\\jobs.v2\\a.b.DXF'), 'C:\\jobs.v2\\a.b.DXF.pdunits.json');
  for (const ext of ['dxf', 'dwg', 'pdf']) assert.equal(sidecarPath('C:/jobs/a.' + ext), 'C:/jobs/a.' + ext + '.pdunits.json');
  assert.equal(sidecarPath('C:/jobs/.dxf'), 'C:/jobs/.dxf.pdunits.json');
  assert.equal(isSidecar('a.PDUNITS.JSON'), true);
  for (const u of UNITS) assert.equal(decode(encode(u)), u);
  for (const s of ['{}', '{', 'null', '{"kind":"Project D drawing unit","unit":"m"}']) assert.equal(decode(s), null);
});
