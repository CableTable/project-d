// cmdbar.js — the floating command bar: aliases, autocomplete, option chips, keys, placement.   node cmdbar.test.mjs
import assert from 'node:assert/strict';
import * as CB from './web/cmdbar.js';
import { fixedKey } from './web/shortcuts.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }

test('tooltip text uses the command aliases and keys, with no empty brackets', () => {
  const tip = (label, name) => CB.tooltipText(label, CB.resolve(name));
  assert.equal(tip('Line', 'line'), 'Line (L)');
  assert.equal(tip('Wireframe', 'wireframe'), 'Wireframe (F9)');
  assert.equal(tip('Copy', 'copy'), 'Copy (CO)');
  for (const c of CB.COMMANDS.filter((c) => fixedKey(c.name))) {
    assert.equal(CB.tooltipText(c.name, c), c.name + (c.alias.length ? ` (${c.alias[0].toUpperCase()})` : ''));
  }
  assert.equal(tip('Rectangle', 'rect'), 'Rectangle (REC)');
  assert.equal(tip('Pan', 'pan'), 'Pan');
  assert.equal(tip('Show guides', 'unknown'), 'Show guides');
  assert.equal(CB.tooltipText('Line', { alias: ['ln'], key: 'F6' }), 'Line (LN, F6)');
  assert.equal(CB.tooltipText('Rotate', CB.resolve('rotate'), 'draw'), 'Rotate (RO)');
  assert.equal(CB.tooltipText('Rotate', CB.resolve('rotate'), 'layout'), 'Rotate (R)');
  assert.equal(CB.tooltipText('Copy', { ...CB.resolve('copy'), alias: ['cp'] }), 'Copy (CP)');
  assert.equal(CB.tooltipText('Mirror X', CB.resolve('mx'), 'layout', 'Mirror X: flip the part left to right about its centre'),
    'Mirror X\nMirror X: flip the part left to right about its centre');
  assert.equal(CB.tooltipText('Line', CB.resolve('line'), 'draw', 'Straight segments'), 'Line (L)\nStraight segments');
});

test('every name and alias is lower case, and no command repeats a word on the same tab', () => {
  for (const tab of ['draw', 'layout']) {
    const seen = new Map();
    for (const c of CB.COMMANDS.filter((x) => !x.where || x.where === tab)) for (const w of [c.name, ...c.alias]) {
      if (CB.aliasScope(c, w) && CB.aliasScope(c, w) !== tab) continue;
      assert.equal(w, w.toLowerCase());
      assert.ok(!seen.has(w), `${w} is both ${seen.get(w)} and ${c.name} on a ${tab} tab`);
      seen.set(w, c.name);
    }
  }
});

test('resolve: name or alias, any case, the open tab first', () => {
  assert.equal(CB.resolve('L').name, 'line');
  assert.equal(CB.resolve(' Offset ').name, 'offset');
  assert.equal(CB.resolve('mv').name, 'move');
  assert.equal(CB.resolve('move').where, 'draw');
  assert.equal(CB.resolve('m').name, 'measure');
  assert.equal(CB.resolve('m', 'draw').name, 'measure');
  for (const tab of ['draw', 'layout']) for (const word of ['measure', 'mea']) assert.equal(CB.resolve(word, tab).name, 'measure');
  assert.equal(CB.resolve('ct').name, 'contour');
  assert.equal(CB.resolve('contour').name, 'contour');
  assert.equal(CB.resolve('co').name, 'copy');
  for (const word of ['f', 'fillet']) assert.equal(CB.resolve(word, 'draw').name, 'fillet');
  for (const word of ['sc', 'scale']) { assert.equal(CB.resolve(word, 'draw').name, 'scale'); assert.equal(CB.resolve(word, 'draw').where, 'draw'); }
  assert.equal(CB.resolve('copy').where, 'draw');
  for (const tab of ['draw', 'layout', 'compare']) {
    assert.equal(CB.resolve('nu', tab).name, 'nudge');
    assert.equal(CB.resolve('nudge', tab).where, '');
  }
  assert.equal(CB.resolve('r', 'draw').name, 'rectangle');
  assert.equal(CB.resolve('r', 'layout').name, 'rotate');
  for (const tab of ['draw', 'layout']) for (const word of ['ro', 'rotate']) assert.equal(CB.resolve(word, tab).name, 'rotate');
  assert.equal(CB.COMMANDS.filter((c) => c.name === 'rotate').length, 1);
  assert.equal(CB.resolve('a', 'layout').name, 'apply');
  assert.equal(CB.resolve('sr', 'layout').name, 'step');
  assert.equal(CB.resolve('a', 'draw').name, 'arc');
  assert.equal(CB.resolve('zzz'), null);
  assert.equal(CB.resolve(''), null);
});

test('suggest: an exact alias first, then names that start with the text, with how much is typed', () => {
  const s = CB.suggest('ro', 'layout');
  assert.equal(s[0].cmd.name, 'rotate');
  assert.equal(s[0].hit, 2);
  assert.equal(CB.suggest('l', 'draw')[0].cmd.name, 'line');
  assert.equal(CB.suggest('r', 'draw')[0].cmd.name, 'rectangle');
  assert.deepEqual(CB.suggest('o', 'draw').map((x) => x.cmd.name).slice(0, 2), ['offset', 'open']);
  assert.deepEqual(CB.suggest('', 'draw'), []);
  assert.deepEqual(CB.suggest('12', 'draw'), [], 'a number is not a command');
  assert.deepEqual(CB.suggest('distance 7', 'draw'), [], 'a word with a value is not looked up');
  assert.equal(CB.suggest('o').length <= 6, true);
});

test('suggest: the ones for the open tab come before the others', () => {
  const names = CB.suggest('r', 'layout').map((x) => x.cmd.name);
  assert.equal(names[0], 'rotate');
  assert.ok(names.indexOf('rectangle') < 0 || names.indexOf('rectangle') > names.indexOf('rotate'));
  assert.ok(CB.suggest('tool wi', 'draw').length === 0);
  assert.equal(CB.suggest('dimen', 'draw')[0].cmd.name, 'dimension');
  assert.equal(CB.suggest('mirr', 'draw')[0].cmd.name, 'mirror');
});

test('parseOptions: the words in the last [bracket], with the underlined letters as the key', () => {
  const o = CB.parseOptions('Angle <0.00>: [Pivot / Copy / Esc]:');
  assert.deepEqual(o.map((x) => [x.word, x.key, x.rest]), [['Pivot', 'P', 'ivot'], ['Copy', 'C', 'opy']]);
  assert.deepEqual(CB.parseOptions('Specify centre point or [3P/2P/Ttr]:').map((x) => x.key), ['3P', '2P', 'T']);
  assert.deepEqual(CB.parseOptions('Option [Inside / Outside / Distance / Steps / Sharp / Rounded / Apply]:').map((x) => x.key), ['I', 'O', 'D', 'S', 'Sh', 'R', 'A']);
  assert.deepEqual(CB.parseOptions('Erase source objects? [Yes / No] <No>:').map((x) => x.word), ['Yes', 'No']);
  assert.deepEqual(CB.parseOptions('Click an outline to select it. [Extract / Keep only / Measure]:'), [], 'a phrase is not a one-word option');
  assert.deepEqual(CB.parseOptions('Select the object to offset:'), []);
  assert.deepEqual(CB.parseOptions(''), []);
});

test('matchOption: the key or the whole word, any case', () => {
  const o = CB.parseOptions('[Copy/Reference/Pivot]:');
  assert.equal(CB.matchOption(o, 'c').word, 'Copy');
  assert.equal(CB.matchOption(o, 'P').word, 'Pivot');
  assert.equal(CB.matchOption(o, 'reference').word, 'Reference');
  assert.equal(CB.matchOption(o, 'x'), null);
  assert.equal(CB.matchOption(o, ''), null);
  assert.equal(CB.matchOption([], 'c'), null);
});

test('spaceIsEnter: repeats on an empty bar, accepts a command, types a space in text entry and in a phrase', () => {
  assert.equal(CB.spaceIsEnter('', 'OFFSET'), true);
  assert.equal(CB.spaceIsEnter('  ', ''), true);
  assert.equal(CB.spaceIsEnter('line', '', 'draw'), true);
  assert.equal(CB.spaceIsEnter('distance', 'CONTOUR', 'draw'), false);
  assert.equal(CB.spaceIsEnter('distance 7', 'CONTOUR', 'draw'), false);
  assert.equal(CB.spaceIsEnter('', 'TEXT'), false, 'Text types a space');
  assert.equal(CB.spaceIsEnter('line', 'Rename'), false);
});

test('keyOpensBar: letters and digits on the drawing; never in a field, a dialog or with Ctrl / Alt', () => {
  const k = (key, o = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...o });
  assert.equal(CB.keyOpensBar(k('l')), 'l');
  assert.equal(CB.keyOpensBar(k('L')), 'L');
  assert.equal(CB.keyOpensBar(k('5')), '5');
  assert.equal(CB.keyOpensBar(k('l'), { inField: true }), null);
  assert.equal(CB.keyOpensBar(k('l'), { dialog: true }), null);
  assert.equal(CB.keyOpensBar(k('l', { ctrlKey: true })), null);
  assert.equal(CB.keyOpensBar(k('d', { altKey: true })), null);
  assert.equal(CB.keyOpensBar(k('Enter')), null);
  assert.equal(CB.keyOpensBar(k('F2')), null);
  assert.equal(CB.keyOpensBar(k('@')), null, 'a symbol alone is not a command');
  assert.equal(CB.keyOpensBar(k('@'), { active: true }), '@', 'but it starts a typed point while a command waits');
  assert.equal(CB.keyOpensBar(k('-'), { active: true }), '-');
});

test('placeBar: 20 px right and below, flipped left / up at the edges, always inside', () => {
  const area = { w: 1000, h: 600 }, size = { w: 380, h: 120 };
  assert.deepEqual(CB.placeBar({ x: 100, y: 100 }, size, area), { x: 120, y: 120 });
  assert.deepEqual(CB.placeBar({ x: 800, y: 100 }, size, area), { x: 400, y: 120 }, 'flips left');
  assert.deepEqual(CB.placeBar({ x: 100, y: 550 }, size, area), { x: 120, y: 410 }, 'flips up');
  assert.deepEqual(CB.placeBar({ x: 990, y: 590 }, size, area), { x: 590, y: 450 }, 'both');
  assert.deepEqual(CB.placeBar({ x: 100, y: 100 }, { w: 1200, h: 700 }, area), { x: 0, y: 0 }, 'bigger than the canvas: held at the corner');
  for (const [x, y] of [[0, 0], [1000, 600], [500, 300], [999, 1], [1, 599]]) {
    const p = CB.placeBar({ x, y }, size, area);
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + size.w <= area.w && p.y + size.h <= area.h, `(${x},${y}) → ${p.x},${p.y}`);
  }
});

test('placeBox: separate up-left Line and readout bounds leave a clear, stationary corner', () => {
  const cursor = { x: 400, y: 300 }, size = { w: 300, h: 60 }, area = { w: 1000, h: 600 };
  const avoid = [[367, 267, 403, 303], [413, 313, 509, 343]];
  const placed = CB.placeBox(cursor, cursor, size, area, avoid);
  assert.deepEqual(placed, { x: 420, y: 220, corner: 1, anchor: cursor }, 'right-above is the first corner that clears both rectangles');
  assert.equal(CB.placeBar(cursor, size, area, 20, avoid, 2).corner, 2, 'left-below is also clear and can stay there');
  const next = { x: 405, y: 305 }, moved = [[367, 267, 408, 308], [418, 318, 514, 348]];
  assert.deepEqual(CB.placeBox(placed.anchor, next, size, area, moved, placed.corner), placed, 'a clear box keeps its original anchor');
});

test('placeBar: avoidance tries corners in order, then the least overlap', () => {
  const cursor = { x: 300, y: 300 }, size = { w: 100, h: 60 }, area = { w: 800, h: 600 };
  const place = (avoid, corner = null) => CB.placeBar(cursor, size, area, 20, avoid, corner);
  assert.deepEqual(place([]), { x: 320, y: 320, corner: 0 });
  assert.deepEqual(place([[0, 0, 50, 50]]), { x: 320, y: 320, corner: 0 });
  assert.deepEqual(place([[310, 310, 500, 500]]), { x: 320, y: 220, corner: 1 });
  assert.deepEqual(place([[310, 0, 500, 600]]), { x: 180, y: 320, corner: 2 });
  assert.deepEqual(place([[250, 250, 600, 600]]), { x: 180, y: 220, corner: 3 }, 'all overlap: left-above covers the least');
  assert.deepEqual(place([[250, 250, 600, 600], [200, 200, 250, 250]]), { x: 180, y: 320, corner: 2 }, 'all overlap: sum the covered area across both rectangles');
  assert.deepEqual(place([[0, 0, 340, 340]]), { x: 320, y: 320, corner: 0 }, 'all overlap: right-below covers the least');
  assert.equal(place([[0, 0, 800, 600]]).corner, 0, 'equal areas keep the specified order');
  assert.equal(place([[310, 310, 500, 500]], 2).corner, 2, 'keep a clear sticky corner even when an earlier one is clear');
  assert.equal(place([[310, 310, 500, 500]], 0).corner, 1, 'switch when the sticky corner overlaps');
  assert.equal(place([[0, 0, 50, 50]], 3).corner, 3, 'a clear left-above corner stays');
  assert.deepEqual(CB.placeBar(cursor, size, area, 20, null, 3), { x: 320, y: 320 }, 'no avoid ignores stickiness, preserving the old result');
});

test('placeBar: avoid candidates clamp at canvas edges, including an oversized box', () => {
  const area = { w: 500, h: 300 }, avoid = [[0, 0, 1, 1]];
  assert.deepEqual(CB.placeBar({ x: 495, y: 295 }, { w: 100, h: 60 }, area, 20, avoid), { x: 400, y: 215, corner: 1 }, 'the clamped right-below corner would sit on the cursor');
  assert.deepEqual(CB.placeBar({ x: 850, y: 560 }, { w: 300, h: 70 }, { w: 900, h: 600 }, 20, avoid), { x: 600, y: 470, corner: 1 }, 'near the bottom-right edge the box stays off the cursor');
  assert.deepEqual(CB.placeBar({ x: 0, y: 0 }, { w: 100, h: 60 }, area, 20, [[20, 20, 120, 80]]), { x: 20, y: 0, corner: 1 }, 'least overlap is measured after clamping, among corners off the cursor');
  assert.deepEqual(CB.placeBar({ x: 5, y: 5 }, { w: 600, h: 400 }, area, 20, avoid), { x: 0, y: 0, corner: 0 });
});

test('placeBox: stays at its anchor while the kept corner is clear', () => {
  const anchor = { x: 460, y: 300 }, cursor = { x: 650, y: 300 };
  const size = { w: 300, h: 70 }, area = { w: 1400, h: 800 };
  assert.deepEqual(CB.placeBox(anchor, cursor, size, area, [[250, 100, 450, 500]], 0), { x: 480, y: 320, corner: 0, anchor });
  assert.deepEqual(CB.placeBox(anchor, cursor, size, area, [[480, 320, 780, 390]], 0), { x: 670, y: 210, corner: 1, anchor: cursor }, 'an overlapping kept corner re-anchors before choosing a corner');
  assert.deepEqual(CB.placeBox(anchor, cursor, size, area, [[250, 100, 650, 500]], 0), { x: 670, y: 320, corner: 0, anchor: cursor }, 'Circle: all old corners overlap and the kept corner is least covered, but the cursor has a clear corner');
});

test('placeBox: when all four corners overlap, follows the cursor with the least overlap', () => {
  const anchor = { x: 300, y: 300 }, cursor = { x: 350, y: 320 };
  const size = { w: 100, h: 60 }, area = { w: 800, h: 600 }, avoid = [[250, 250, 600, 600]];
  const placed = CB.placeBox(anchor, cursor, size, area, avoid, 0);
  assert.deepEqual(placed, { x: 230, y: 240, corner: 3, anchor: cursor }, 'left-above has the least overlap at the new cursor');
  const next = { x: 360, y: 330 };
  assert.deepEqual(CB.placeBox(placed.anchor, next, size, area, avoid, placed.corner),
    { x: 240, y: 350, corner: 2, anchor: next }, 'an overlapping box follows the cursor, breaking equal-overlap ties in corner order');
});

test('history: filter, copy text, the last three fade', () => {
  const lines = [{ pre: 'Command:', ans: 'L', cls: 'cm' }, { pre: 'LINE Specify first point:', ans: '0,0' }, { pre: 'Opened a.dxf' }, { pre: 'Command:', ans: 'OFFSET', cls: 'cm' }];
  assert.equal(CB.filterLines(lines, 'line').length, 1);
  assert.deepEqual(CB.filterLines(lines, 'OFFSET').map((l) => l.ans), ['OFFSET']);
  assert.equal(CB.filterLines(lines, '  ').length, 4);
  assert.equal(CB.linesText(lines), 'Command: L\nLINE Specify first point: 0,0\nOpened a.dxf\nCommand: OFFSET');
  assert.deepEqual(CB.fadeOf(lines).map((l) => l.age), [3, 2, 1]);
  assert.deepEqual(CB.fadeOf(lines.slice(0, 1)).map((l) => l.age), [1]);
  assert.deepEqual(CB.fadeOf([]), []);
});

console.log(n + ' cmdbar tests passed');
