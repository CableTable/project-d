// props.js — the Properties section's model.   node props.test.mjs
import assert from 'node:assert/strict';
import * as P from './web/props.js';
import { newDoc, addEntities, writeDxf, line, circle, arc, lwpoly, rect, text, ellipse } from './web/dxf-write.js';
import { readDxf } from './web/drawing.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const reopen = (e) => { const d = newDoc(4); addEntities(d, [e]); return readDxf(writeDxf(d)).entities[0]; };
const field = (ents, key, f = 1) => P.fieldsOf(ents, f).find((x) => x.key === key);

test('summarize: one shape, several alike, a mix; a differing value is null', () => {
  const a = line(0, 0, 10, 0, { layer: 'Cut' }), b = line(0, 5, 10, 5, { layer: 'Cut', aci: 1 }), c = circle(0, 0, 3, { layer: 'Marks' });
  assert.deepEqual(P.summarize([]), { n: 0, kind: null, chip: '', layer: null, colour: null, lt: null });
  const one = P.summarize([a]);
  assert.equal(one.chip, 'Line'); assert.equal(one.layer, 'Cut'); assert.equal(one.colour, 'bylayer'); assert.equal(one.lt, 'BYLAYER');
  const two = P.summarize([a, b]);
  assert.equal(two.chip, 'Line × 2'); assert.equal(two.kind, 'LINE'); assert.equal(two.layer, 'Cut'); assert.equal(two.colour, null, 'colours differ');
  const mix = P.summarize([a, c]);
  assert.equal(mix.chip, '2 shapes'); assert.equal(mix.kind, null); assert.equal(mix.layer, null);
});

test('colour and line type: keys, labels, setting them (a colour clears a true colour)', () => {
  const e = line(0, 0, 1, 1);
  assert.equal(P.colourKey(e), 'bylayer');
  const red = P.withColour(e, 'aci:1');
  assert.equal(P.colourKey(red), 'aci:1'); assert.equal(red.aci, 1);
  assert.equal(P.colourKey(P.withColour(red, 'bylayer')), 'bylayer');
  assert.equal(P.colourKey({ ...e, tc: 0xff8800 }), 'tc:16746496'); assert.equal(P.colourLabel('tc:16746496'), 'True colour'); assert.equal(P.colourLabel('aci:40'), 'Colour 40');
  assert.equal(P.withColour({ ...e, tc: 5 }, 'aci:5').tc, null);
  assert.equal(P.ltKey(e), 'BYLAYER'); assert.equal(P.ltKey({ ...e, lt: 'Dashed' }), 'DASHED');
  assert.equal(P.withLineType(e, 'DASHED').lt, 'DASHED'); assert.equal(P.withLineType(P.withLineType(e, 'DASHED'), 'BYLAYER').lt, null);
  assert.equal(P.ltLabel('DASHED'), 'DASHED'); assert.equal(P.ltLabel('DOT'), 'DOT'); assert.equal(P.ltLabel('HIDDEN'), 'Hidden');
  assert.equal(P.withLayer(e, 'Cut').layer, 'Cut');
});

test('a line: length (editable), angle, ends; a new length moves the end along the line; varies when lengths differ', () => {
  const l = line(10, 10, 10, 60);
  assert.deepEqual(P.fieldsOf([l], 1).map((x) => [x.key, x.editable]), [['length', true], ['angle', false], ['startX', false], ['startY', false], ['endX', false], ['endY', false]]);
  near(field([l], 'length').value, 50); near(field([l], 'angle').value, 90);
  const m = reopen(P.setField(l, 'length', 80));
  near(field([m], 'length').value, 80); near(field([m], 'startY').value, 10); near(field([m], 'endY').value, 90); near(field([m], 'endX').value, 10);
  assert.equal(P.setField(l, 'length', 0), null); assert.equal(P.setField(l, 'length', NaN), null); assert.equal(P.setField(l, 'angle', 3), null);
  assert.equal(field([l, line(0, 0, 3, 0)], 'length').value, null, 'varies');
  near(field([l, line(0, 0, 0, 50)], 'length').value, 50);
  near(field([l], 'length', 25.4).value, 50 * 25.4, 1e-9);                       // inches: shown in mm
  near(field([P.setField(l, 'length', 254, 25.4)], 'length', 25.4).value, 254, 1e-9);
  assert.deepEqual(P.fieldsOf([l, circle(0, 0, 1)], 1), [], 'a mix has no geometry');
});

test('a circle: radius, diameter, centre', () => {
  const c = circle(30, 40, 5);
  assert.deepEqual(P.fieldsOf([c], 1).map((x) => x.key), ['radius', 'diameter', 'centreX', 'centreY']);
  near(field([c], 'diameter').value, 10);
  near(field([P.setField(c, 'diameter', 30)], 'radius').value, 15);
  near(field([P.setField(c, 'radius', 7)], 'radius').value, 7);
  const m = P.setField(P.setField(c, 'centreX', 1), 'centreY', 2);
  near(field([m], 'centreX').value, 1); near(field([m], 'centreY').value, 2);
  assert.equal(P.setField(c, 'radius', 0), null); assert.equal(P.setField(c, 'radius', -3), null);
});

test('an arc: a new length keeps the radius and changes the sweep; the ends follow; more than a full circle is refused', () => {
  const a = arc(0, 0, 10, 0, 90);
  near(field([a], 'length').value, 10 * Math.PI / 2, 1e-9); near(field([a], 'sweep').value, 90);
  const b = P.setField(a, 'length', 10 * Math.PI);                                // half a circle
  near(field([b], 'radius').value, 10); near(field([b], 'sweep').value, 180, 1e-6); near(field([b], 'startX').value, 10, 1e-9);
  near(field([b], 'endX').value, -10, 1e-9);
  assert.equal(P.setField(a, 'length', 2 * Math.PI * 10 + 1), null); assert.equal(P.setField(a, 'length', 0), null);
  const full = P.setField(a, 'length', 2 * Math.PI * 10);
  near(field([full], 'sweep').value, 360);
  const w = arc(0, 0, 10, 270, 90);                                               // across 0°
  near(field([w], 'sweep').value, 180); near(field([P.setField(w, 'length', 5 * Math.PI)], 'sweep').value, 90, 1e-6);
  near(field([P.setField(a, 'radius', 20)], 'radius').value, 20); near(field([P.setField(a, 'radius', 20)], 'sweep').value, 90);
  near(field([P.setField(a, 'centreX', 5)], 'startX').value, 15);
});

test('a polyline: length and (closed) area, with bulges; read only', () => {
  const r = rect(0, 0, 10, 5);
  near(field([r], 'length').value, 30); near(field([r], 'area').value, 50); assert.equal(field([r], 'length').editable, false); assert.equal(field([r], 'vertices').value, 4);
  assert.equal(field([lwpoly([[0, 0], [10, 0], [10, 5]])], 'area'), undefined, 'open: no area');
  const half = lwpoly([[0, 0, 1], [10, 0]], { closed: true });         // two points, a bulge of 1 = a half circle: a D of radius 5
  near(field([half], 'area').value, Math.PI * 25 / 2, 1e-6); near(field([half], 'length').value, 10 + Math.PI * 5, 1e-6);
});

test('text: height and angle edit; the text and its layer stay', () => {
  const t = text(5, 6, 4, 'Hello', { layer: 'Notes', aci: 1 });
  assert.deepEqual(P.fieldsOf([t], 1).map((x) => [x.key, x.editable]), [['textH', true], ['textAngle', true]]);
  near(field([t], 'textH').value, 4);
  const u = reopen(P.setField(t, 'textH', 9));
  near(field([u], 'textH').value, 9); assert.equal(u.layer, 'Notes'); assert.equal(u.aci, 1);
  near(field([reopen(P.setField(t, 'textAngle', 30))], 'textAngle').value, 30);
  assert.equal(P.setField(t, 'textH', 0), null);
});

test('other kinds have no geometry fields; a mirrored shape has none', () => {
  assert.deepEqual(P.fieldsOf([ellipse(0, 0, 10, 0, 0.5)], 1), []);
  assert.deepEqual(P.fieldsOf([], 1), []);
  const mirrored = { ...circle(0, 0, 4), r: { ...circle(0, 0, 4).r, c: [...circle(0, 0, 4).r.c, 210, 220, 230], v: [...circle(0, 0, 4).r.v, '0', '0', '-1'] } };
  assert.deepEqual(P.fieldsOf([mirrored], 1), []);
});

test('Match properties copies layer, colour and line type, nothing else', () => {
  const src = line(0, 0, 5, 5, { layer: 'Cut', aci: 1, lt: 'DASHED' }), dst = circle(1, 2, 3, { layer: 'Parts' });
  const m = P.matchProps(src, dst);
  assert.equal(m.layer, 'Cut'); assert.equal(m.aci, 1); assert.equal(m.lt, 'DASHED'); assert.equal(m.type, 'CIRCLE'); assert.equal(m.r, dst.r, 'the geometry is shared, unchanged');
  assert.equal(P.matchChanges(src, m), false); assert.equal(P.matchChanges(src, dst), true);
});

test('Select similar: by layer, by drawn colour (ByLayer resolves through its layer), by type', () => {
  const layers = { Cut: { aci: 1, tc: null }, Parts: { aci: 7, tc: null } };
  const list = [line(0, 0, 1, 1, { layer: 'Cut' }), line(0, 0, 1, 2, { layer: 'Parts', aci: 1 }), circle(0, 0, 1, { layer: 'Cut' }), line(0, 0, 1, 3, { layer: 'Parts' }), line(0, 0, 1, 4, { layer: 'Dimensions' })];
  assert.deepEqual(P.similar(list, list[0], 'layer', layers), [0, 2]);
  assert.deepEqual(P.similar(list, list[0], 'colour', layers), [0, 1, 2], 'ByLayer on a red layer and an own red are both red');
  assert.deepEqual(P.similar(list, list[0], 'type', layers), [0, 1, 3, 4]);
  assert.deepEqual(P.similar(list, list[0], 'type', layers, 'Dimensions'), [0, 1, 3], 'kept dimensions are skipped');
  assert.equal(P.effectiveColour(list[3], layers), 'aci:7');
});

console.log(n + ' props tests passed');
