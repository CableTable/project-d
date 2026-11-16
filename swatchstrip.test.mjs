import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyRgb } from './web/colour.js';
import { recentColours, stripGroups, STANDARD_SWATCHES } from './web/swatchstrip.js';

test('recent colours: 12 maximum, newest first, repeats move to the top without mutating the source', () => {
  let list = [];
  for (let i = 1; i <= 15; i++) list = recentColours(list, 'aci:' + i);
  assert.deepEqual(list, Array.from({ length: 12 }, (_, i) => 'aci:' + (15 - i)));
  const before = list.slice();
  assert.deepEqual(recentColours(list, 'aci:8'), ['aci:8', ...list.filter((k) => k !== 'aci:8')]);
  assert.deepEqual(list, before);
  assert.deepEqual(recentColours(['bad', 'tc:16777216', 'bylayer', 'byblock', 'aci:0', 'aci:256', 'tc:0', 'tc:0'], null), ['tc:0']);
  assert.deepEqual(recentColours({}, 'aci:1'), ['aci:1']);
});

test('strip model: standards, saved true colours, recents and safe titles', () => {
  const groups = stripGroups([{ id: '#ff8800' }, { id: '#FF8800' }, { id: '<script>' }, null], ['aci:2', 'tc:0', 'aci:2']);
  assert.deepEqual(groups.map((g) => g.group), ['standard', 'saved', 'recent']);
  assert.deepEqual(groups[0].swatches.map((s) => s.key), STANDARD_SWATCHES);
  assert.deepEqual(groups[1].swatches, [{ key: 'tc:16746496', title: '#FF8800', id: '#ff8800' }]);
  assert.deepEqual(groups[2].swatches.map((s) => s.title), ['Colour 2', '#000000']);
  assert.equal(stripGroups(null, null)[1].swatches.length, 0);
});

test('standard set: 99 swatches, greys first, ACI 1-9 kept, no repeated colour', () => {
  assert.equal(STANDARD_SWATCHES.length, 99);
  assert.deepEqual(STANDARD_SWATCHES.slice(0, 9).map((k) => keyRgb(k)[0]), [0, 26, 51, 77, 102, 153, 179, 204, 230]);
  assert.equal(STANDARD_SWATCHES[9], 'tc:16777215');
  assert.deepEqual(STANDARD_SWATCHES.slice(10, 19), Array.from({ length: 9 }, (_, i) => 'aci:' + (i + 1)));
  assert.equal(new Set(STANDARD_SWATCHES).size, 99);
  const tcs = STANDARD_SWATCHES.filter((k) => k.startsWith('tc:'));
  assert.equal(tcs.length, 90);
  assert.equal(new Set(tcs.map((k) => keyRgb(k).join())).size, 90);
  assert.ok(!tcs.some((k) => keyRgb(k).join() === keyRgb('aci:8').join()), 'no true colour repeats ACI 8');
  assert.deepEqual(keyRgb(STANDARD_SWATCHES[19]), [247, 212, 212], 'first hue, 90% lightness');
  const titles = stripGroups([], [])[0].swatches.slice(0, 10).map((s) => s.title);
  assert.deepEqual([titles[0], titles[1], titles[8], titles[9]], ['Black', 'Grey 90%', 'Grey 10%', 'White']);
});
