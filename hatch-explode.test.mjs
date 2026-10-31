import assert from 'node:assert/strict';
import test from 'node:test';
import { explodeHatch } from './web/hatch-explode.js';
import { explodeSelection } from './web/explode.js';
import { entity, newDoc, lwpoly } from './web/dxf-write.js';
import { get } from './web/grips.js';
import * as LD from './web/layoutdoc.js';
import { flatten } from './web/drawing.js';

const rectangle = [[0, 0], [100, 0], [100, 50], [0, 50]];
const hatch = ({ hole = false, spacing = 5, solid = 0, gradient = 0, a = 45, d = [] } = {}) => entity('HATCH', [
  [2, solid ? 'SOLID' : 'ANSI31'], [70, solid], [71, 1], [91, hole ? 2 : 1],
  [92, 2], [72, 0], [73, 1], [93, 4], ...rectangle.flatMap(([x, y]) => [[10, x], [20, y]]), [97, 0],
  ...(hole ? [[92, 0], [93, 1], [72, 2], [10, 50], [20, 25], [40, 20], [50, 0], [51, 360], [73, 1], [97, 0]] : []),
  [75, 0], [76, 1], [52, a], [41, 1], [77, 0], [78, 1], [53, a], [43, 0], [44, 0],
  [45, -Math.sin(a * Math.PI / 180) * spacing], [46, Math.cos(a * Math.PI / 180) * spacing], [79, d.length], ...d.map((v) => [49, v]), [98, 0], [450, gradient],
], { layer: 'Cut', aci: 2, tc: 0x123456, lt: 'DASHED' });
const coords = (e) => [10, 20, 11, 21].map((c) => get(e.r, c));

test('ANSI31-like family: LINEs inside a 100 x 50 rectangle, exact circular hole, hatch properties and boundary kept', () => {
  for (const hole of [false, true]) {
    const e = hatch({ hole }), before = structuredClone(e), pieces = explodeHatch(e);
    assert.ok(pieces.length > 20);
    for (const p of pieces) {
      assert.equal(p.type, 'LINE');
      for (const key of ['layer', 'aci', 'tc', 'lt']) assert.equal(p[key], e[key]);
      const [x, y, xx, yy] = coords(p);
      for (const t of [0, .25, .5, .75, 1]) {
        const px = x + t * (xx - x), py = y + t * (yy - y);
        assert.ok(px >= -1e-8 && px <= 100 + 1e-8 && py >= -1e-8 && py <= 50 + 1e-8);
        if (hole) assert.ok(Math.hypot(px - 50, py - 25) >= 20 - 1e-8, 'no part of a line enters the hole');
      }
    }
    assert.deepEqual(e, before);
    const doc = newDoc(), boundary = lwpoly(rectangle, { closed: true }); doc.entities = [boundary, e];
    const r = explodeSelection(doc, new Set([1]));
    assert.equal(r.entities[0], boundary); assert.equal(r.exploded, 1);
    assert.deepEqual(r.messages, ['Hatch boundary associativity removed.']);
  }
});

test('solid and gradient hatches are refused, counted as not exploded, and stay intact', () => {
  for (const e of [hatch({ solid: 1 }), hatch({ gradient: 1 })]) {
    const doc = newDoc(); doc.entities = [e];
    const r = explodeSelection(doc, new Set([0]));
    assert.equal(r.exploded, 0); assert.equal(r.entities[0], e);
    assert.deepEqual(r.errors, ['Cannot explode HATCH']);
  }
});

test('100,000 output lines are accepted; more are refused with the exact count', () => {
  assert.equal(explodeHatch(hatch({ a: 0, spacing: .0005 })).length, 100000);
  assert.throws(() => explodeHatch(hatch({ a: 0, spacing: .0004 })), /Hatch too dense to explode \(125000 lines\)/);
});

test('dashes keep their phase and gaps, negative spacing works, and ByLayer remains ByLayer', () => {
  const e = hatch({ a: 0, spacing: -10, d: [3, -2] }); e.aci = 256; e.tc = null;
  const pieces = explodeHatch(e);
  assert.equal(pieces.length, 100);
  for (const p of pieces) {
    const [x, , xx] = coords(p); assert.ok(Math.abs(xx - x - 3) < 1e-9); assert.equal(x % 5, 0);
    assert.equal(p.aci, 256); assert.equal(p.tc, null);
  }
});

test('TODO 155i1: a loose layout hatch explodes after rotation, scale and mirror, preserving the boundary and layer', () => {
  const lay = LD.newLayout('Hatch'), layers = newDoc(4).layers;
  const e = hatch({ hole: true }), part = LD.objectPart('h', 'Hatch', e, layers), outline = LD.objectPart('b', 'Boundary', lwpoly(rectangle, { closed: true }), layers);
  lay.parts = { h: part, b: outline }; lay.placed = [{ ...LD.objectPlacement(part), x: 200, y: 100, rot: 30, mirrorX: true, sc: 2 }, LD.objectPlacement(outline)];
  const before = structuredClone(lay.placed[1]); let id = 0;
  const r = LD.explodePlaced(lay, [0], () => 'o' + id++);
  assert.equal(r.done, 1); assert.deepEqual(r.errors, []); assert.deepEqual(r.messages, ['Hatch boundary associativity removed.']);
  assert.deepEqual(lay.placed.at(-1), before);
  assert.equal(r.pieces.length, explodeHatch(e).length);
  assert.ok(r.pieces.every((i) => lay.parts[lay.placed[i].partId].raw.entities[0].type === 'LINE'));
  const solid = LD.objectPart('s', 'Solid hatch', hatch({ solid: 1 }), layers);
  lay.parts.s = solid; lay.placed.push(LD.objectPlacement(solid));
  const refused = LD.explodePlaced(lay, [lay.placed.length - 1], () => 'o' + id++);
  assert.equal(refused.done, 0); assert.deepEqual(refused.errors, ['Cannot explode HATCH']);
  assert.ok(flatten(part.raw).items.some((it) => it.k === 'h'));
});
