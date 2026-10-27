import { test } from 'node:test';
import assert from 'node:assert/strict';
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
