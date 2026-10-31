import assert from 'node:assert/strict';
import test from 'node:test';
import * as LD from './web/layoutdoc.js';
import { newDoc, addLayer, addEntities, line, circle, rect } from './web/dxf-write.js';
import { placement1 } from './web/apply.js';
import { quickSelect, objectTypes, propertiesOf } from './web/qselect.js';
import { effectiveColour, similar } from './web/props.js';

function fixture() {
  const lay = LD.newLayout('Quick Select'), raw = newDoc(4), layers = LD.layersOf(lay);
  addLayer(lay, 'A', { aci: 1 }); addLayer(lay, 'B', { aci: 5 });
  addLayer(lay, 'Off', { off: true }); addLayer(lay, 'Frozen', { frozen: true }); addLayer(lay, 'Locked');
  layers.Locked.flags = 4;
  addEntities(raw, rect(0, 0, 20, 20, { layer: 'A' }));
  lay.parts.part = LD.makePart('part', 'Part', raw, 1);
  lay.s.gridPart = 'part'; lay.s.fit = false; lay.s.rows = 1; lay.s.cols = 2;
  lay.placed.push(placement1('part', 300, 100));
  for (const [id, e] of [['a', line(10, 10, 60, 10, { layer: 'A', lw: 25, lt: 'DASHED' })],
    ['b', line(10, 30, 60, 30, { layer: 'B' })], ['c', circle(90, 60, 10, { layer: 'A' })],
    ...['Off', 'Frozen', 'Locked'].map((layer) => [layer, line(0, 0, 10, 0, { layer })])]) {
    lay.parts[id] = LD.objectPart(id, id, e, layers);
    lay.placed.push(LD.objectPlacement(lay.parts[id]));
  }
  lay.placed[2].lock = true;
  return { lay, placed: LD.placedAll(lay) };
}
const rule = { property: 'layer', operator: 'eq', value: 'A' };
const matches = (s, extra = {}) => quickSelect(s.entities, s.layers, { ...rule, scope: s.scope, ...extra });

test('TODO 162b: maps Layout objects and transformed geometry to placed indices, never grid or placed parts', () => {
  const { lay, placed } = fixture(), a = placed.findIndex((p) => p.partId === 'a');
  placed[a] = { ...placed[a], x: 100, y: 200, sc: 2 };
  const s = LD.objectSelection(lay, placed, []);
  assert.equal(s.entities.length, 6);
  assert.deepEqual(objectTypes(s.entities), [['Multiple', 'Multiple'], ['CIRCLE', 'Circle'], ['LINE', 'Line']]);
  assert.equal(propertiesOf(s.entities, 'LINE').find((p) => p.key === 'length').kind, 'number');
  assert.equal(s.entities[0].lw, 25); assert.equal(s.entities[0].lt, 'DASHED');
  assert.equal(effectiveColour(s.entities[0], s.layers), 'aci:1');
  assert.deepEqual(s.apply(matches(s)), [a, placed.findIndex((p) => p.partId === 'c')]);
  assert.deepEqual(s.apply(matches(s, { property: 'length', operator: 'eq', value: '100', type: 'LINE' })), [a]);
  assert.equal(s.factor, 1);
});

test('TODO 162b: Current selection holds only selected Layout objects, including mixed selections', () => {
  const { lay, placed } = fixture(), a = placed.findIndex((p) => p.partId === 'a');
  const parts = placed.flatMap((p, i) => lay.parts[p.partId].obj ? [] : [i]);
  assert.equal(LD.objectSelection(lay, placed, parts).selection.size, 0);
  const s = LD.objectSelection(lay, placed, [...parts, a]);
  assert.deepEqual([...s.selection], [0]);
  assert.deepEqual(s.apply(matches(s, { scope: s.scope.filter((i) => s.selection.has(i)) })), [a]);
  const c = placed.findIndex((p) => p.partId === 'c');
  assert.deepEqual([...LD.objectSelection(lay, placed, [c, ...parts, a]).selection], [2, 0], 'Select similar uses pick order, skipping parts');
});

test('TODO 162b: skips hidden and frozen layers, locked layers / placements and hidden objects for both commands', () => {
  const { lay, placed } = fixture(), s = LD.objectSelection(lay, placed, [], (id) => id === 'c');
  assert.deepEqual(s.scope, [0]);
  assert.deepEqual(matches(s, { operator: 'all' }), [0]);
  const same = similar(s.entities, s.entities[0], 'type', s.layers).filter((i) => s.scope.includes(i));
  assert.deepEqual(s.apply(same), [placed.findIndex((p) => p.partId === 'a')]);
  lay.parts.a.off.add(lay.parts.a.fl.layers.findIndex((l) => l.name === 'A'));
  assert.deepEqual(LD.objectSelection(lay, placed, [], (id) => id === 'c').scope, []);
});

test('TODO 162b: Append keeps selected grid / placed parts and objects; replace and zero matches drop them', () => {
  const { lay, placed } = fixture(), a = placed.findIndex((p) => p.partId === 'a'), c = placed.findIndex((p) => p.partId === 'c');
  const selected = [0, placed.findIndex((p) => p.partId === 'part' && p.src === 'loose'), a], s = LD.objectSelection(lay, placed, selected);
  assert.equal(placed[0].src, 'grid');
  assert.deepEqual(s.apply(matches(s), true), [...selected, c]);
  assert.deepEqual(s.apply(matches(s)), [a, c]);
  assert.deepEqual(s.apply([], true), selected);
  assert.deepEqual(s.apply([]), []);
  assert.deepEqual(s.apply(matches(s, { exclude: true })), []);
});
