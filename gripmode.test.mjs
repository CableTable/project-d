// gripmode.js — the grip modes of a hot grip.   node gripmode.test.mjs
import assert from 'node:assert/strict';
import * as GM from './web/gripmode.js';
import { newDoc, addEntities, writeDxf, line, circle } from './web/dxf-write.js';
import { readDxf } from './web/drawing.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const val = (e, code) => +e.r.v[e.r.c.indexOf(code)];
const raw = () => { const d = newDoc(4); addEntities(d, [line(0, 0, 100, 0), line(0, 10, 50, 10), circle(5, 5, 2)]); return readDxf(writeDxf(d)); };

test('the cycle is STRETCH → MOVE → ROTATE → SCALE → MIRROR → STRETCH, with AutoCAD\'s header and prompt', () => {
  let i = 0;
  const seen = [GM.MODES[i]];
  for (let k = 0; k < 5; k++) seen.push(GM.MODES[i = GM.cycle(i)]);
  assert.deepEqual(seen, ['STRETCH', 'MOVE', 'ROTATE', 'SCALE', 'MIRROR', 'STRETCH']);
  assert.equal(GM.header('ROTATE'), '** ROTATE **');
  assert.equal(GM.prompt('ROTATE'), 'Specify rotation angle or [Base point/Copy/Undo/Reference/eXit]:');
  assert.equal(GM.prompt('MIRROR'), 'Specify second point or [Base point/Copy/Undo/eXit]:');
});

test('what a pick means: angle from the base (0 = east), distance from the base, the point itself', () => {
  near(GM.valueAt('ROTATE', [10, 10], [10, 20]), 90);
  near(GM.valueAt('SCALE', [10, 10], [13, 14]), 5);
  assert.deepEqual(GM.valueAt('MOVE', [0, 0], [3, 4]), [3, 4]);
});

test('Rotate turns only the selected objects about the base; 0 changes nothing', () => {
  const r = raw(), out = GM.apply(r, new Set([0, 1]), 'ROTATE', [0, 0], 90);
  assert.equal(out.entities.length, 3);
  near(val(out.entities[0], 11), 0); near(val(out.entities[0], 21), 100);
  near(val(out.entities[1], 10), -10); near(val(out.entities[1], 20), 0);
  assert.equal(out.entities[2], r.entities[2], 'the unselected circle is the same record');
  assert.equal(GM.apply(r, new Set([0]), 'ROTATE', [0, 0], 0), null);
});

test('Scale multiplies about the base; 1 changes nothing; 0 or less is refused', () => {
  const r = raw(), out = GM.apply(r, new Set([0, 2]), 'SCALE', [0, 0], 2);
  near(val(out.entities[0], 11), 200); near(val(out.entities[2], 40), 4); near(val(out.entities[2], 10), 10);
  assert.equal(GM.apply(r, new Set([0]), 'SCALE', [0, 0], 1), null);
  assert.throws(() => GM.apply(r, new Set([0]), 'SCALE', [0, 0], 0));
});

test('Move shifts every selected object by base → point', () => {
  const r = raw(), out = GM.apply(r, new Set([0, 1]), 'MOVE', [0, 0], [5, 7]);
  near(val(out.entities[0], 10), 5); near(val(out.entities[0], 21), 7); near(val(out.entities[1], 20), 17);
  assert.equal(GM.apply(r, new Set([0]), 'MOVE', [3, 3], [3, 3]), null);
});

test('Mirror reflects in the line base → point and the originals go (same indexes)', () => {
  const r = raw(), out = GM.apply(r, new Set([0, 1]), 'MIRROR', [0, 0], [1, 0]);
  assert.equal(out.entities.length, 3);
  near(val(out.entities[0], 21), 0); near(val(out.entities[1], 20), -10); near(val(out.entities[1], 21), -10);
  assert.equal(GM.apply(r, new Set([0]), 'MIRROR', [2, 2], [2, 2]), null);
});

test('Rotate 180 flips the line through the base', () => {
  const out = GM.apply(raw(), new Set([0]), 'ROTATE', [0, 0], 180);
  near(val(out.entities[0], 11), -100); near(val(out.entities[0], 21), 0);
});

test('Mirror in the Y axis (base → up) flips x; an object that cannot be mirrored is reported, and nothing mirrorable throws', () => {
  const r = raw(), out = GM.apply(r, new Set([0, 1]), 'MIRROR', [0, 0], [0, 1]);
  near(val(out.entities[0], 11), -100); near(val(out.entities[1], 11), -50); near(val(out.entities[1], 10), 0);
  assert.deepEqual(out.skipped, []);
  r.entities.push({});                                             // no shape: mirrorEntity skips it
  assert.deepEqual(GM.apply(r, new Set([0, 3]), 'MIRROR', [0, 0], [0, 1]).skipped, ['it has no shape']);
  assert.throws(() => GM.apply(r, new Set([3]), 'MIRROR', [0, 0], [0, 1]), /nothing could be mirrored \(it has no shape\)/);
});

test('Scale outside 0.0001 .. 10000 is refused (the layout Scale command\'s range); the mode name is title case', () => {
  const r = raw();
  for (const k of [0, -2, 1e-5, 1e5]) assert.throws(() => GM.apply(r, new Set([0]), 'SCALE', [0, 0], k), /between 0\.0001 and 10000/);
  assert.ok(GM.apply(r, new Set([0]), 'SCALE', [0, 0], 1e4));
  assert.deepEqual(GM.MODES.map(GM.nameOf), ['Stretch', 'Move', 'Rotate', 'Scale', 'Mirror']);
});

console.log(n + ' passed');
