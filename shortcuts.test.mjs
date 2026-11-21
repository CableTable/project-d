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
  assert.deepEqual(Object.keys(SC.RESERVED).sort(), ['Ctrl+C', 'Ctrl+V', 'Ctrl+Shift+V', 'Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+Shift+Z', 'Esc', 'Delete', 'F2', 'F3', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'F5', 'Ctrl+R', 'Ctrl+D', 'Alt+Z', 'Alt+Tab'].sort());
  assert.equal(SC.keyReason('Ctrl+D'), 'Reserved for Duplicate.');
  for (const key of ['w', 'Shift+W', '1', 'Shift+2', 'Space', 'Enter', 'Tab', 'Backspace', 'ArrowUp', 'Shift+ArrowLeft']) assert.match(SC.keyReason(key), /typing and drawing/);
  for (const key of ['Ctrl+Alt+W', 'Alt+W', 'F6', 'Ctrl+Shift+1', 'Shift+F6']) assert.equal(SC.keyReason(key), '');
});

test('defaults have no clashes; aliases overlap across draw/layout only, keys clash across scopes', () => {
  const b = SC.bindings();
  assert.deepEqual(SC.clashes(b), []);
  b.trace.alias.push('ww'); b.apply.alias.push('ww');
  assert.deepEqual(SC.clashes(b), []);
  b.trace.alias.push('mi'); b.trace.key = 'Ctrl+G';
  assert.ok(SC.clashes(b).some((c) => c.field === 'alias' && c.other === 'trace' && c.name === 'mirror'));
  assert.ok(SC.clashes(b).some((c) => c.field === 'key' && c.name === 'trace' && c.other === 'group'));
  b.fit.alias.push('ww');
  assert.equal(SC.clashes(b).filter((c) => c.value === 'ww').length, 2);
  b.line.alias = ['<img src=x>', 'contour']; b.line.key = 'Ctrl+S';
  assert.ok(SC.clashes(b).filter((c) => c.reason).length >= 3);
});

test('saved own keys win over new tab defaults; explicit tab bindings still report clashes', () => {
  const overrides = { properties: { key: 'ctrl+tab' }, contour: { key: 'Ctrl+W' }, mirror: { key: 'Ctrl+Shift+Tab' } };
  const b = SC.bindings(overrides);
  for (const name of ['closetab', 'nexttab', 'previoustab']) assert.equal(b[name].key, '');
  assert.equal(b.properties.key, 'Ctrl+Tab');
  assert.deepEqual(SC.clashes(b), []);
  assert.deepEqual(SC.bindings(SC.differences(b)), b, 'cleared defaults persist');
  assert.ok(SC.clashes(SC.bindings({ ...overrides, nexttab: { key: 'Ctrl+Tab' } })).some((c) => c.field === 'key'));
});

test('Copy / Paste stay fixed and clear older conflicting own keys, including tab keys that capture field input', () => {
  const b = SC.bindings({ closetab: { key: 'Ctrl+C' }, properties: { key: 'Ctrl+V' }, line: { key: 'Ctrl+Shift+V' }, copy: { key: 'Alt+C' }, paste: { key: 'Alt+V' }, pasteorig: { key: 'Alt+P' } });
  assert.equal(b.closetab.key, ''); assert.equal(b.properties.key, '');
  assert.equal(b.copy.key, 'Ctrl+C'); assert.equal(b.paste.key, 'Ctrl+V');
  assert.equal(b.line.key, ''); assert.equal(b.pasteorig.key, 'Ctrl+Shift+V');
  assert.deepEqual(SC.clashes(b), []);
});

test('loading drops reserved toggle keys from old shortcuts and keeps aliases and unrelated keys', () => {
  for (const key of ['F3', 'F7', 'F8', 'F9', 'F12']) {
    const overrides = { line: { alias: ['ln'], key: key.toLowerCase() }, nexttab: { key }, properties: { key: 'F6' } };
    const b = SC.bindings(overrides);
    assert.deepEqual(b.line, { alias: ['ln'], key: '', extra: [] });
    assert.equal(b.nexttab.key, '');
    assert.equal(b.properties.key, 'F6');
    assert.equal(b.wireframe.key, 'F9');
    assert.deepEqual(SC.clashes(b), []);
    assert.deepEqual(SC.bindings(SC.differences(b)), b);
    assert.equal(overrides.line.key, key.toLowerCase(), 'loading does not mutate storage');
  }
});

test('Swap exchanges complete cells using the previous edited cell, leaving no duplicate binding', () => {
  const b = SC.bindings();
  b.contour.alias = ['cx', 'mi']; b.contour.key = 'Ctrl+G';
  let swapped = SC.swap(b, 'contour', 'mirror', 'alias', ['cx', 'ww']);
  swapped = SC.swap(swapped, 'contour', 'group', 'key', 'Ctrl+Alt+W');
  assert.deepEqual(swapped.contour.alias, ['mi']); assert.deepEqual(swapped.mirror.alias, ['cx', 'ww']);
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
  b.contour.alias = ['cx', 'ww']; b.contour.key = 'Ctrl+Alt+W'; b.line.alias = []; b.fit.key = '';
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
  assert.equal(CB.resolve('co', 'draw', cmds).name, 'copy');
  assert.equal(CB.suggest('ww', 'draw', 6, cmds)[0].cmd.name, 'contour');
  assert.equal(CB.spaceIsEnter('ww', '', 'draw', cmds), true);
  assert.equal(CB.resolve('ct', 'draw').name, 'contour');
  assert.equal(CB.resolve('shortcuts').name, 'shortcuts');
  assert.deepEqual(SC.bindings({ contour: { alias: 123, key: null }, missing: {} }), SC.bindings());
});

test('TODO 134 extra keys: same rule as main keys, fixed commands too, stored as differences, old records unchanged', () => {
  const b = SC.bindings();
  assert.deepEqual(b.delete.extra, []); assert.deepEqual(SC.bindings({ delete: { key: 'x' } }).delete.extra, [], 'an old record without extra loads unchanged');
  b.delete.extra = ['alt+x', 'Alt+X', 'Ctrl+Alt+D']; b.saveas.extra = ['Alt+S'];
  const kept = SC.bindings(SC.differences(b));
  assert.deepEqual(kept.delete.extra, ['Alt+X', 'Ctrl+Alt+D'], 'normalised, no repeat'); assert.equal(kept.delete.key, 'Delete', 'the fixed main key stays');
  assert.deepEqual(SC.differences(kept), { delete: { extra: ['Alt+X', 'Ctrl+Alt+D'] }, saveas: { extra: ['Alt+S'] } }, 'only differences');
  assert.deepEqual(SC.bindings(SC.differences(b)).saveas, b.saveas);
  assert.deepEqual(SC.bindings({ delete: { extra: 'Alt+X' }, save: { extra: [3, 'Alt+Q'] } }).save.extra, ['Alt+Q'], 'malformed extra ignored');
  assert.equal(SC.commandsFor(kept).find((c) => c.name === 'delete').extra[0], 'Alt+X');
  assert.deepEqual(SC.clashes(kept), []);
});

test('TODO 134 extra keys: reserved keys are errors, another command\'s main or extra key is a clash, a repeat is refused', () => {
  const reasons = (b) => SC.clashes(b).map((c) => [c.name, c.field, c.value, !!c.reason, c.other]);
  for (const key of ['Ctrl+S', 'Delete', 'Esc', 'Alt+Z', 'Alt+Tab', 'F3']) { const b = SC.bindings(); b.line.extra = [key]; assert.deepEqual(reasons(b), [['line', 'extra', key, true, undefined]], key); }
  assert.match(SC.keyReason('Alt+Z'), /Snap/); assert.match(SC.keyReason('Alt+Tab'), /Windows/);
  let b = SC.bindings(); b.line.extra = ['W']; assert.match(SC.clashes(b)[0].reason, /typing and drawing/, 'same rule as a main key: Ctrl or Alt');
  b = SC.bindings(); b.delete.extra = ['Ctrl+G']; assert.deepEqual(reasons(b), [['delete', 'extra', 'Ctrl+G', false, 'group']], 'a main key of another command: the extra is named');
  b = SC.bindings(); b.group.extra = ['Ctrl+Alt+W']; b.line.extra = ['Ctrl+Alt+W'];
  assert.deepEqual(reasons(b), [['line', 'extra', 'Ctrl+Alt+W', false, 'group']], 'extra against extra: reported once, on the earlier row');
  b = SC.bindings(); b.group.extra = ['Ctrl+Alt+W', 'Ctrl+Alt+W'.toLowerCase()]; assert.equal(SC.clashes(SC.bindings(SC.differences(b))).length, 0, 'bindings() drops the repeat');
  b = SC.bindings(); b.group.extra = ['Ctrl+Alt+W', 'Ctrl+Alt+W']; assert.match(SC.clashes(b)[0].reason, /already a key of this command/);
  b = SC.bindings(); b.group.extra = ['Ctrl+G']; assert.match(SC.clashes(b)[0].reason, /already a key of this command/, 'the command\'s own main key');
  assert.deepEqual(SC.clashes(SC.bindings({ delete: { extra: ['Ctrl+G'] } })).length, 1, 'a loaded clash is reported');
  b = SC.bindings(); b.line.extra = ['Ctrl+C']; assert.equal(SC.bindings(SC.differences(b)).line.extra.length, 0, 'an old own key now owned by the clipboard is dropped on load');
  const s = SC.swap(SC.bindings({ delete: { extra: ['Alt+X'] } }), 'line', 'group', 'key', 'Ctrl+Alt+W');
  assert.deepEqual(s.delete.extra, ['Alt+X'], 'Swap keeps extra keys');
});

test('TODO 134 PGP: one ;KEY line per key, the first is the main key, an old one-line file reads unchanged', () => {
  const b = SC.bindings();
  b.delete.extra = ['Alt+X', 'Ctrl+Alt+D']; b.save.extra = ['Alt+S']; b.contour.key = 'Ctrl+Alt+W'; b.contour.extra = ['Alt+W']; b.fit.key = ''; b.fit.extra = ['Alt+F'];
  const text = SC.writePgp(b);
  assert.match(text, /;KEY DELETE, Delete\r\n;KEY DELETE, Alt\+X\r\n;KEY DELETE, Ctrl\+Alt\+D\r\n/);
  assert.match(text, /;KEY FIT, \r\n;KEY FIT, Alt\+F\r\n/);
  const back = SC.parsePgp(text);
  assert.equal(back.skipped, 0); assert.deepEqual(back.draft, b);
  assert.deepEqual(SC.clashes(back.draft), []);
  const old = SC.parsePgp(';KEY DELETE, Delete\r\n;KEY CONTOUR, Alt+W\r\n');
  assert.equal(old.skipped, 0); assert.deepEqual(old.draft.delete.extra, []); assert.equal(old.draft.contour.key, 'Alt+W');
  const keep = SC.parsePgp(';KEY DELETE, Delete\n;KEY DELETE, Alt+X\n;KEY DELETE, Alt+X\n;KEY DELETE, nonsense', b);
  assert.deepEqual(keep.draft.delete.extra, ['Alt+X'], 'a file\'s keys replace the extra list'); assert.equal(keep.skipped, 2, 'the repeat and the nonsense');
  assert.deepEqual(keep.draft.save.extra, ['Alt+S'], 'a command the file does not mention keeps its extra keys');
  assert.equal(SC.parsePgp(';KEY SAVE, Alt+Q\n;KEY SAVE, Alt+Q').skipped, 1, 'a fixed command\'s main key stays; its extra passes');
});
