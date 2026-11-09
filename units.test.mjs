import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, format, defaultUnit, sidecarPath, isSidecar, encode, decode, UNITS } from './web/units.js';
import { parseInput, createTool, toolType } from './web/draw.js';
import { parseMm, parseAngle } from './web/place.js';
import { typedLength } from './web/linked-dimensions.js';
import { COMMANDS } from './web/cmdbar.js';
import { createInput, inputKey, pointInput, toolPointInput } from './web/dynamic-input.js';
import { parseLine } from './web/array.js';
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

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
  assert.equal(sidecarPath('C:\\jobs.v2\\a.b.DXF'), 'C:\\jobs.v2\\a.b.pdunits.json');
  assert.equal(sidecarPath('C:/jobs/a.dwg'), 'C:/jobs/a.pdunits.json');
  assert.equal(sidecarPath('C:/jobs/.dxf'), 'C:/jobs/.dxf.pdunits.json');
  assert.equal(isSidecar('a.PDUNITS.JSON'), true);
  for (const u of UNITS) assert.equal(decode(encode(u)), u);
  for (const s of ['{}', '{', 'null', '{"kind":"Project D drawing unit","unit":"m"}']) assert.equal(decode(s), null);
});
