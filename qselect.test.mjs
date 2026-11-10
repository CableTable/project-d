import assert from 'node:assert/strict';
import { test } from 'node:test';
import { objectTypes, propertiesOf, operatorsOf, valuesOf, quickSelect } from './web/qselect.js';
import { line, circle, arc, lwpoly, text, entity, insert } from './web/dxf-write.js';
import { encode } from './web/text.js';
import { fieldsOf } from './web/props.js';

const layers = { '0': { aci: 7 }, A: { aci: 1 }, B: { aci: 5 }, Off: { off: true }, Frozen: { frozen: true }, Locked: { flags: 4 } };
const ents = [line(0, 0, 50, 0, { layer: 'A', aci: 1 }), line(0, 20, 50, 20, { layer: 'A' }),
  circle(20, 50, 10, { layer: 'A' }), circle(70, 50, 20, { layer: 'B', lw: 25 }),
  text(0, 90, 5, 'Pump', { layer: 'B' }), text(0, 110, 5, 'Valve.[1]', { layer: 'B' })];
const select = (rule, entities = ents, ls = layers) => quickSelect(entities, ls, { type: 'Multiple', property: 'layer', operator: 'eq', value: 'A', ...rule });

test('scope types are alphabetic, Multiple only for a mix; properties reuse every numeric field', () => {
  assert.deepEqual(objectTypes(ents), [['Multiple', 'Multiple'], ['CIRCLE', 'Circle'], ['LINE', 'Line'], ['TEXT', 'Text']]);
  assert.deepEqual(objectTypes([ents[0], ents[1]]), [['LINE', 'Line']]);
  assert.deepEqual(objectTypes([]), []);
  assert.deepEqual(propertiesOf(ents, 'Multiple').map((p) => p.label), ['Colour', 'Layer', 'Line type', 'Line weight']);
  const examples = [ents[0], ents[2], arc(0, 0, 20, 0, 90), lwpoly([[0, 0], [10, 0], [10, 10]], true), ents[4], encode({ type: 'MTEXT', x: 0, y: 0, h: 5, lines: ['Pump', 'A'], angle: 0, ha: 0 })];
  for (const e of examples) {
    assert.deepEqual(propertiesOf([e], e.type).filter((p) => p.kind === 'number').map((p) => p.key), fieldsOf([e]).map((f) => f.key));
    assert.equal(propertiesOf([e], e.type).some((p) => p.key === 'contents'), ['TEXT', 'MTEXT'].includes(e.type));
  }
  assert.ok(propertiesOf(ents, 'LINE').some((p) => p.label === 'Start X'));
});

test('every list operator, with drawn colour, layer, line type and DXF line weight', () => {
  assert.deepEqual(operatorsOf('list').map(([key]) => key), ['eq', 'ne', 'all']);
  for (const [property, value, matches] of [['layer', 'a', [0, 1, 2]], ['colour', 'aci:1', [0, 1, 2]], ['lt', 'bylayer', [0, 1, 2, 3, 4, 5]], ['lw', '25', [3]]]) {
    assert.deepEqual(select({ property, value }), matches);
    assert.deepEqual(select({ property, value, operator: 'ne' }), ents.map((_, i) => i).filter((i) => !matches.includes(i)));
    assert.deepEqual(select({ property, operator: 'all', value: '' }), [0, 1, 2, 3, 4, 5]);
  }
  assert.deepEqual(valuesOf(ents, layers, 'layer'), [['A', 'A'], ['B', 'B']]);
  assert.deepEqual(valuesOf([{ ...ents[0], layer: '-A' }, { ...ents[1], layer: '0' }], layers, 'layer'), [['0', '0'], ['-A', '-A']]);
  assert.deepEqual(valuesOf(ents, layers, 'colour'), [['aci:5', 'Blue'], ['aci:1', 'Red']]);
  assert.deepEqual(valuesOf([ents[3]], layers, 'colour'), [['aci:5', 'Blue']]);          // ByLayer on a non-current layer: its own layer's colour, no ByLayer entry
  assert.deepEqual(valuesOf(ents, layers, 'lt'), [['BYLAYER', 'ByLayer']]);
  assert.deepEqual(valuesOf(ents, layers, 'lw'), [['25', '0.25 mm'], ['-1', 'ByLayer']]);
  assert.deepEqual(select({ property: 'colour', value: 'tc:1234' }, [{ ...ents[0], tc: 1234 }, { ...ents[1], layer: 'True' }], { True: { tc: 1234 } }), [0, 1]);
});

test('every numeric operator uses the panel decimals, including unit conversion and inequalities', () => {
  assert.deepEqual(operatorsOf('number').map(([key]) => key), ['eq', 'ne', 'gt', 'lt', 'all']);
  for (const [operator, expected] of [['eq', [2]], ['ne', [3]], ['gt', [3]], ['lt', []], ['all', [2, 3]]]) {
    assert.deepEqual(select({ type: 'CIRCLE', property: 'radius', value: '10', operator }), expected);
  }
  const rounds = [circle(0, 0, 15.004), circle(0, 0, 15.006)];
  assert.deepEqual(select({ type: 'CIRCLE', property: 'radius', value: '15.00' }, rounds), [0]);
  assert.deepEqual(select({ type: 'CIRCLE', property: 'radius', value: '15.00', operator: 'gt' }, rounds), [1]);
  assert.deepEqual(select({ type: 'CIRCLE', property: 'radius', value: '254', factor: 25.4 }), [2]);
  assert.deepEqual(select({ type: 'CIRCLE', property: 'radius', value: '15.004', dp: 3 }, rounds), [0]);          // decimals follow the panel
  assert.deepEqual(select({ type: 'CIRCLE', property: 'radius', value: '15.00', dp: 3 }, rounds), []);          // 15.004 is not 15.000 at 3 decimals
  const mirrored = [...ents, entity('CIRCLE', [[10, 0], [20, 0], [40, 10], [210, 0], [220, 0], [230, -1]], { layer: 'A' })];
  assert.deepEqual(select({ type: 'CIRCLE', property: 'radius', value: '10' }, mirrored), []);          // a mirrored circle in the scope hides Radius
  assert.deepEqual(select({ type: 'CIRCLE', property: 'radius', value: '10', scope: [2, 3] }, mirrored), [2]);          // outside the scope it does not
  assert.deepEqual(select({ property: 'layer', value: 'A', scope: [0, 6] }, [...ents, insert('Blk', 0, 0, { layer: 'A' })]), [0, 6]);          // INSERT under Multiple
  for (const value of ['', ' ', 'NaN', 'Infinity', '12junk']) assert.deepEqual(select({ type: 'CIRCLE', property: 'radius', value }), []);
});

test('every text operator, case-insensitive * and ?, regex punctuation is literal and MText spans lines', () => {
  assert.deepEqual(operatorsOf('text').map(([key]) => key), ['eq', 'ne', 'wildcard', 'all']);
  for (const [operator, value, expected] of [['eq', 'pUMP', [4]], ['ne', 'pump', [5]], ['wildcard', 'p?m*', [4]], ['wildcard', 'Valve.[?]', [5]], ['wildcard', 'ValveX[1]', []], ['all', '', [4, 5]]]) {
    assert.deepEqual(select({ type: 'TEXT', property: 'contents', operator, value }), expected);
  }
  const mtext = encode({ type: 'MTEXT', x: 0, y: 0, h: 5, lines: ['Pump', 'A'], angle: 0, ha: 0 });
  assert.deepEqual(select({ type: 'MTEXT', property: 'contents', operator: 'wildcard', value: 'P*A' }, [mtext]), [0]);
  assert.deepEqual(select({ type: 'TEXT', property: 'contents', value: '' }), []);
  assert.deepEqual(select({ type: 'TEXT', property: 'contents', operator: 'wildcard', value: '?' }, [text(0, 0, 5, '🟠')]), [0]);
});

test('Exclude complements type and property together within the scope; hidden, frozen and locked stay out', () => {
  assert.deepEqual(select({ type: 'CIRCLE', property: 'radius', operator: 'gt', value: 15, exclude: true }), [0, 1, 2, 4, 5]);
  assert.deepEqual(select({ type: 'CIRCLE', property: 'radius', operator: 'all', exclude: true, scope: [0, 2, 3] }), [0]);
  assert.deepEqual(select({ scope: [1, 3] }), [1]);
  assert.deepEqual(select({ scope: [] }), []);
  const hidden = ['Off', 'Frozen', 'Locked'].map((layer) => line(0, 0, 5, 0, { layer }));
  assert.deepEqual(select({ operator: 'all' }, [...ents, ...hidden]), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(select({ exclude: true }, [...ents, ...hidden]), [3, 4, 5]);
  assert.deepEqual(select({ property: 'layer', operator: 'gt', value: 'A' }), []);
  assert.deepEqual(select({ property: 'unknown' }), []);
  assert.deepEqual(select({ operator: 'all' }, [entity('POINT', [[10, 0], [20, 0]])]), [0]);
});

test('TODO 222b: an mm drawing parses a number value as Number() did; only inch / ft / ft-in take marks', () => {
  const len = (value, unit) => select({ type: 'LINE', property: 'length', operator: 'eq', value, unit });
  assert.deepEqual(len('5e1', 'mm'), [0, 1]);       // 1e3-style input still works in mm
  assert.deepEqual(len('5e1'), [0, 1]);
  assert.deepEqual(len('50,0', 'mm'), []);          // decimal comma is not a number in mm (it was not before the drawing unit)
  assert.deepEqual(len('50', 'mm'), [0, 1]);
  assert.deepEqual(len(`0'-1.97"`, 'ft-in'), [0, 1]);       // 50 mm = 1.9685"
  assert.deepEqual(len('1.969"', 'inch'), [0, 1]);
});
