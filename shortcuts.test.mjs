import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as SC from './web/shortcuts.js';
import * as CB from './web/cmdbar.js';

test('key strings and events normalize to the same modifier order, including Cmd', () => {
  assert.equal(SC.normalizeKey(' shift + w + ALT + control '), 'Ctrl+Alt+Shift+W');
  assert.equal(SC.normalizeKey('cmd+1'), 'Ctrl+1');
  assert.equal(SC.normalizeKey('escape'), 'Esc');
  assert.equal(SC.normalizeKey('ctrl+unknown'), null);
  assert.equal(SC.normalizeKey('ctrl+alt'), null);
  assert.equal(SC.normalizeKey('+W'), null);
  assert.equal(SC.eventKey({ key: 'Control', ctrlKey: true }), null);
  assert.equal(SC.eventKey({ key: 'W', ctrlKey: true, altKey: true }), 'Ctrl+Alt+W');
  assert.equal(SC.eventKey({ key: ' ', altKey: true }), 'Alt+Space');
  assert.equal(SC.eventKey({ key: 's', metaKey: true }), 'Ctrl+S');
  assert.equal(SC.eventKey({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+1');
});

test('every reserved key has a reason; bare and Shift letters/digits cannot be keys', () => {
  assert.deepEqual(Object.keys(SC.RESERVED).sort(), ['Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Esc', 'Delete', 'F2', 'F10', 'F11', 'F5', 'Ctrl+R', 'Ctrl+D'].sort());
  assert.ok(SC.keyReason('Ctrl+D'));
  for (const key of ['w', 'Shift+W', '1', 'Shift+2', 'Space', 'Enter', 'Tab', 'Backspace', 'ArrowUp', 'Shift+ArrowLeft']) assert.match(SC.keyReason(key), /typing and drawing/);
  for (const key of ['Ctrl+Alt+W', 'Alt+W', 'F6', 'Ctrl+Shift+1', 'Shift+F6']) assert.equal(SC.keyReason(key), '');
});

test('defaults have no clashes; aliases overlap across draw/layout only, keys clash across scopes', () => {
  const b = SC.bindings();
  assert.deepEqual(SC.clashes(b), []);
  b.contour.alias.push('ww'); b.group.alias.push('ww');
  assert.deepEqual(SC.clashes(b), []);
  b.contour.alias.push('mi'); b.contour.key = 'Ctrl+G';
  assert.ok(SC.clashes(b).some((c) => c.field === 'alias' && c.other === 'contour' && c.name === 'mirror'));
  assert.ok(SC.clashes(b).some((c) => c.field === 'key' && c.name === 'contour' && c.other === 'group'));
  b.fit.alias.push('ww');
  assert.equal(SC.clashes(b).filter((c) => c.value === 'ww').length, 2);
  b.line.alias = ['<img src=x>', 'contour']; b.line.key = 'Ctrl+S';
  assert.ok(SC.clashes(b).filter((c) => c.reason).length >= 3);
});

test('Swap exchanges complete cells using the previous edited cell, leaving no duplicate binding', () => {
  const b = SC.bindings();
  b.contour.alias = ['co', 'mi']; b.contour.key = 'Ctrl+G';
  let swapped = SC.swap(b, 'contour', 'mirror', 'alias', ['co', 'ww']);
  swapped = SC.swap(swapped, 'contour', 'group', 'key', 'Ctrl+Alt+W');
  assert.deepEqual(swapped.contour.alias, ['mi']); assert.deepEqual(swapped.mirror.alias, ['co', 'ww']);
  assert.equal(swapped.contour.key, 'Ctrl+G'); assert.equal(swapped.group.key, 'Ctrl+Alt+W');
  assert.deepEqual(SC.clashes(swapped), []);
  assert.deepEqual(b.mirror.alias, ['mi'], 'pure: input is unchanged');
});

test('PGP parses aliases and KEY comments, ignores ordinary comments, counts unknown and malformed lines', () => {
  const { draft, skipped } = SC.parsePgp('; ordinary comment\nWW, *CONTOUR\nQQ, *CONTOUR\n;KEY CONTOUR, alt+ctrl+w\nX, *MISSING\n;KEY MISSING, F6\nbroken\n;KEY LINE, nonsense');
  assert.equal(skipped, 4); assert.deepEqual(draft.contour.alias, ['ww', 'qq']);
  assert.equal(draft.contour.key, 'Ctrl+Alt+W'); assert.deepEqual(draft.line.alias, ['l']);
  assert.ok(SC.clashes(SC.parsePgp(';KEY CONTOUR, Ctrl+S').draft).some((c) => c.reason));
  assert.equal(SC.parsePgp(';KEY SAVE, Alt+W').skipped, 1);
  assert.equal(SC.parsePgp('BOOM, *__proto__').skipped, 1);
});

test('PGP round trip includes keys, no aliases, removed default keys, and all default bindings', () => {
  const b = SC.bindings();
  b.contour.alias = ['co', 'ww']; b.contour.key = 'Ctrl+Alt+W'; b.line.alias = []; b.fit.key = '';
  const text = SC.writePgp(b), imported = SC.parsePgp(text);
  assert.match(text, /WW,        \*CONTOUR\r\n/);
  assert.match(text, /;KEY CONTOUR, Ctrl\+Alt\+W/);
  assert.equal(imported.skipped, 0); assert.deepEqual(imported.draft, b);
});

test('only differences persist and runtime lookup, suggestions and Space use own aliases without mutating TABLE', () => {
  const b = SC.bindings(); b.contour.alias = ['ww']; b.contour.key = 'Ctrl+Alt+W';
  const diff = SC.differences(b), cmds = SC.commandsFor(b);
  assert.deepEqual(diff, { contour: { alias: ['ww'], key: 'Ctrl+Alt+W' } });
  assert.deepEqual(SC.bindings(diff), b);
  assert.deepEqual(SC.differences(SC.bindings()), {});
  assert.equal(CB.resolve('ww', 'draw', cmds).name, 'contour');
  assert.equal(CB.resolve('co', 'draw', cmds), null);
  assert.equal(CB.suggest('ww', 'draw', 6, cmds)[0].cmd.name, 'contour');
  assert.equal(CB.spaceIsEnter('ww', '', 'draw', cmds), true);
  assert.equal(CB.resolve('co', 'draw').name, 'contour');
  assert.equal(CB.resolve('shortcuts').name, 'shortcuts');
  assert.deepEqual(SC.bindings({ contour: { alias: 123, key: null }, missing: {} }), SC.bindings());
});
