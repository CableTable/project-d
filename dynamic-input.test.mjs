import test from 'node:test';
import assert from 'node:assert/strict';
import { createTool, toolType, toolHover, dynamicInput } from './web/draw.js';
import { createInput, hasTyped, escapeInput, inputKey, pointInput, inputMode, toolPointInput, anchorOf, firstPoint, readOnlyLength } from './web/dynamic-input.js';

test('Dynamic input: translated points, signed deltas and all angle quadrants', () => {
  assert.deepEqual(dynamicInput([10, 20], [13, 24], 2), { length: '5.00 mm', angle: '53.13°', dx: '3.00 mm', dy: '4.00 mm' });
  for (const [point, angle] of [[[1, 0], 0], [[1, 1], 45], [[0, 1], 90], [[-1, 1], 135], [[-1, 0], 180], [[-1, -1], 225], [[0, -1], 270], [[1, -1], 315]]) {
    const fields = dynamicInput([0, 0], point, 2);
    assert.equal(fields.angle, angle.toFixed(2) + '°');
    assert.equal(fields.dx, point[0].toFixed(2) + ' mm');
    assert.equal(fields.dy, point[1].toFixed(2) + ' mm');
  }
});

test('Dynamic input: decimals 0–4, coincident points, rounding without negative zero or 360°', () => {
  for (let dp = 0; dp <= 4; dp++) {
    assert.deepEqual(dynamicInput([1, 1], [1, 1], dp), { length: (0).toFixed(dp) + ' mm', angle: (0).toFixed(dp) + '°', dx: (0).toFixed(dp) + ' mm', dy: (0).toFixed(dp) + ' mm' });
    const fields = dynamicInput([0, 0], [1.23456, -0.0000001], dp);
    assert.equal(fields.length, (1.23456).toFixed(dp) + ' mm');
    assert.equal(fields.dx, (1.23456).toFixed(dp) + ' mm');
    assert.equal(fields.dy, (0).toFixed(dp) + ' mm');
    assert.equal(fields.angle, (0).toFixed(dp) + '°');
  }
  assert.equal(dynamicInput([0, 0], [-0.0000001, 1], 4).dx, '0.0000 mm');
});

const keys = (text, first = false, s = createInput(first)) => [...text].reduce((s, k) => inputKey(s, k, first), s);
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, a + ' != ' + b));
test('Dynamic input: Tab locks, cycles, preserves typed values and Backspace edits the active field', () => {
  let s = inputKey(keys('50'), 'Tab', false);
  assert.deepEqual(s.locked, [true, false]); assert.equal(s.active, 1);
  s = keys('90', false, s); s = inputKey(s, 'Tab', false);
  assert.equal(s.active, 0); assert.deepEqual(s.locked, [true, true]);
  near(pointInput(s, [10, 20], [999, 999]).point, [10, 70]);
  s = inputKey(s, 'Backspace', false); assert.deepEqual(s.values, ['5', '90']);
  assert.deepEqual(s.locked, [false, true]);
  for (const key of ['c', 'U', 'Enter', 'ArrowLeft', '+']) assert.equal(inputKey(s, key, false), null);
});
test('Dynamic input: typing into a locked field replaces its value, then Tab locks it again', () => {
  for (const first of [true, false]) {
    let s = inputKey(keys('50', first), 'Tab', first);
    s = inputKey(s, 'Tab', first);
    s = keys('3', first, s);
    assert.deepEqual(s.values, ['3', '']); assert.deepEqual(s.locked, [false, false]);
    s = keys('2', first, s);
    assert.deepEqual(s.values, ['32', '']);
    s = inputKey(s, 'Tab', first);
    assert.equal(s.active, 1); assert.deepEqual(s.locked, [true, false]);
  }
});
test('Dynamic input: mouse fills untyped fields, signed lengths and typed angles override mouse angles', () => {
  near(pointInput(keys('30'), [10, 20], [13, 24]).point, [28, 44]);
  near(pointInput(keys('-30'), [10, 20], [13, 24]).point, [-8, -4]);
  near(pointInput(keys('50<90'), [10, 20], [99, 20]).point, [10, 70]);
  near(pointInput(keys('<90'), [10, 20], [40, 20]).point, [10, 50]);
  assert.equal(pointInput(keys('30'), [0, 0], [1, 1]).text, '@30<45');
  assert.deepEqual(pointInput(keys('-30'), [10, 20], [13, 24]).live, [5, Math.atan2(4, 3) * 180 / Math.PI]);
  for (const y of [1e-20, 1e25]) {
    const result = pointInput(keys('10,', true), null, [0, y]);
    assert.equal(result.why, ''); assert.equal(result.point[1], y);
  }
});
test('Dynamic input: comma defaults relative, # absolute, @ relative, and first point X / Y', () => {
  for (const text of ['10,0', '@10,0']) near(pointInput(keys(text), [20, 30], [99, 99]).point, [30, 30]);
  near(pointInput(keys('#0,0'), [20, 30], [99, 99]).point, [0, 0]);
  near(pointInput(keys('@-5<180'), [20, 30], [99, 99]).point, [25, 30]);
  let s = keys('10', true); s = inputKey(s, 'Tab', true); s = keys('20', true, s);
  assert.deepEqual(pointInput(s, null, [999, 999]).labels, ['X', 'Y']);
  near(pointInput(s, null, [999, 999]).point, [10, 20]);
  near(pointInput(keys('10,20', true), null, [999, 999]).point, [10, 20]);
  near(pointInput(keys('10', true), null, [99, 42]).point, [10, 42]);
  near(pointInput(keys('#10', false), [20, 30], [99, 42]).point, [10, 42]);
});
test('Dynamic input: bad and overflowing numbers fail validation; first Esc clears, second delegates cancellation', () => {
  const s = keys('1..2');
  assert.equal(pointInput(s, [0, 0], [10, 0]).point, null);
  assert.match(pointInput(s, [0, 0], [10, 0]).why, /Length must be a finite number/);
  assert.ok(pointInput(keys('9'.repeat(400)), null, [0, 0]).why);
  const cleared = escapeInput(s, false);
  assert.equal(hasTyped(cleared), false); assert.equal(escapeInput(cleared, false), null);
  assert.deepEqual(escapeInput(keys('@', true), true), createInput(true));
});

const toolKeys = (T, text) => keys(text, !T.pts.length, createInput(!T.pts.length, inputMode(T)));
test('TODO 69c: Polyline uses absolute first X / Y and its latest vertex for Line entry rules', () => {
  const T = createTool('polyline');
  T.last = [900, 900]; toolHover(T, [99, 99]);
  let s = toolKeys(T, '10'); s = inputKey(s, 'Tab', true); s = keys('20', true, s);
  assert.deepEqual(toolPointInput(s, T).labels, ['X', 'Y']);
  toolType(T, toolPointInput(s, T).text);
  toolType(T, '@5,5'); toolHover(T, [200, 200]);
  s = toolKeys(T, '50'); s = inputKey(s, 'Tab', false); s = keys('90', false, s);
  near(toolPointInput(s, T).point, [15, 75]);
  toolType(T, toolPointInput(s, T).text);
  near(T.pts.at(-1), [15, 75]);
  near(toolPointInput(toolKeys(T, '#0,0'), T).point, [0, 0]);
  near(toolPointInput(toolKeys(T, '@-10,0'), T).point, [5, 75]);
  near(toolPointInput(toolKeys(T, '-10<90'), T).point, [15, 65]);
});

for (const kind of ['rect', 'rrect']) test(`TODO 69c: ${kind} first corner, signed sizes in every quadrant, live fields, locks and validation`, () => {
  const T = createTool(kind);
  if (kind === 'rrect') {
    assert.equal(inputMode(T), null, 'radius stays in the command bar');
    toolType(T, '3');
  }
  T.last = [900, 900]; toolHover(T, [80, 90]);
  assert.equal(inputMode(T), 'xy');
  assert.deepEqual(toolPointInput(toolKeys(T, '100,100'), T).point, [100, 100]);
  toolType(T, toolPointInput(toolKeys(T, '100,100'), T).text);
  assert.equal(inputMode(T), 'size');
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const flip of [-1, 1]) {
    toolHover(T, [100 + sx * 80, 100 + sy * 60]);
    let s = toolKeys(T, String(30 * flip)); s = inputKey(s, 'Tab', false); s = keys(String(20 * flip), false, s);
    const result = toolPointInput(s, T);
    assert.deepEqual(result.labels, ['Width', 'Height']);
    near(result.point, [100 + sx * flip * 30, 100 + sy * flip * 20]);
    const copy = { ...T, pts: [...T.pts] }, made = toolType(copy, result.text).made;
    const xs = made[0].pts.map((p) => p[0]), ys = made[0].pts.map((p) => p[1]);
    near([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)],
      [100 + Math.min(0, sx * flip * 30), 100 + Math.max(0, sx * flip * 30), 100 + Math.min(0, sy * flip * 20), 100 + Math.max(0, sy * flip * 20)]);
  }
  toolHover(T, [20, 160]);
  let s = inputKey(toolKeys(T, '30'), 'Tab', false);
  near(toolPointInput(s, T).point, [70, 160]);
  s = inputKey(s, 'Tab', false); s = keys('40', false, s);
  assert.deepEqual(s.values, ['40', '']);
  near(toolPointInput(s, T).point, [60, 160]);
  s = escapeInput(s, false);
  assert.equal(s.mode, 'size'); assert.equal(hasTyped(s), false); assert.equal(escapeInput(s, false), null);
  near(toolPointInput(toolKeys(T, ',20'), T).point, [20, 120]);
  for (const [text, label] of [['0,20', 'Width'], ['30,0', 'Height'], ['-0,20', 'Width'], ['1..2,20', 'Width']]) {
    const result = toolPointInput(toolKeys(T, text), T);
    assert.equal(result.point, null); assert.match(result.why, new RegExp(label));
  }
  assert.equal(inputMode(createTool('circle')), null);
});

test('TODO 69d: Measure types its first point only, then shows a read-only length', () => {
  const T = { kind: 'measure', pts: [], hover: [30, 40] };
  assert.equal(inputMode(T), 'xy'); assert.equal(firstPoint(T), true); assert.equal(readOnlyLength(T), false);
  near(toolPointInput(toolKeys(T, '10,20'), T).point, [10, 20]);
  T.pts = [[5, 5]];
  assert.equal(inputMode(T), null, 'no field to type in at the second point'); assert.equal(readOnlyLength(T), true);
  T.pts = [[5, 5], [8, 9]];
  assert.equal(inputMode(T), null); assert.equal(readOnlyLength(T), false);
});

test('TODO 69d: Set length follows Line: X / Y, then Length + Angle from the first point, then none', () => {
  const T = { kind: 'setlen', pts: [], hover: [30, 40] };
  assert.equal(inputMode(T), 'xy'); assert.equal(firstPoint(T), true);
  T.pts = [[10, 10]];
  assert.equal(inputMode(T), 'polar'); assert.deepEqual(anchorOf(T), [10, 10]);
  const h = Math.hypot(20, 30);
  near(toolPointInput(toolKeys(T, '50'), T).point, [10 + 50 * 20 / h, 10 + 50 * 30 / h]);
  near(toolPointInput(keys('90', false, inputKey(toolKeys(T, '10'), 'Tab', false)), T).point, [10, 20]);
  T.pts = [[10, 10], [20, 20]];
  assert.equal(inputMode(T), null, 'the real length is typed in the panel');
});

test('TODO 69d: Dimension: X / Y, then Distance + Angle from the first point, then absolute X / Y for the dimension line', () => {
  const T = { kind: 'dimension', pts: [], hover: [30, 40] };
  assert.equal(inputMode(T), 'xy'); assert.equal(firstPoint(T), true);
  near(toolPointInput(toolKeys(T, '10,20'), T).point, [10, 20]);
  T.pts = [[10, 20]];
  assert.equal(inputMode(T), 'polar'); assert.deepEqual(anchorOf(T), [10, 20]); assert.equal(firstPoint(T), false);
  let s = inputKey(toolKeys(T, '40'), 'Tab', false); s = keys('90', false, s);
  assert.deepEqual(toolPointInput(s, T).labels, ['Distance', 'Angle']);
  near(toolPointInput(s, T).point, [10, 60]);
  T.pts = [[10, 20], [10, 60]];
  assert.equal(inputMode(T), 'xy', 'the dimension line place is an absolute X / Y');
  assert.equal(anchorOf(T), undefined); assert.equal(firstPoint(T), true);
  const r = toolPointInput(toolKeys(T, '25,30'), T);
  assert.deepEqual(r.labels, ['X', 'Y']); near(r.point, [25, 30]);
  near(toolPointInput(toolKeys(T, '25'), T).point, [25, 40]);
});
