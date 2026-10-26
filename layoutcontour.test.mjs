// layoutcontour.js — Contour on a placed part of a layout.   node layoutcontour.test.mjs
import assert from 'node:assert/strict';
import { readDxf, flatten } from './web/drawing.js';
import { writeDxf, newDoc, addEntities, rect, circle, line } from './web/dxf-write.js';
import { placedBox, placement1 } from './web/apply.js';
import * as LD from './web/layoutdoc.js';
import * as LC from './web/layoutcontour.js';

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const near = (a, b, t = 1e-4) => assert.ok(Math.abs(a - b) <= t, a + ' != ' + b);
const nearBox = (a, b) => a.forEach((v, i) => near(v, b[i]));

const CFG = { dist: 10, steps: 1, dir: 'outside', corners: 'sharp' };
const STYLE = { id: 'c1', name: 'plate - contour 1', layer: 'Contour', colour: 'bylayer', lt: 'BYLAYER', dash: [] };
/** A 100 x 60 plate with a round hole, as a layout part. */
function plate() {
  const d = newDoc(4);
  addEntities(d, rect(0, 0, 100, 60, { layer: 'OUT' }), circle(50, 30, 15, { layer: 'OUT' }));
  return LD.makePart('a', 'plate', d, 1);
}
const grow = (b, k) => [b[0] - k, b[1] - k, b[2] + k, b[3] + k];

test('the outer outline only: a hole is left alone, a part with no closed outline says so', () => {
  const r = LC.partContour(plate(), CFG);
  assert.equal(r.kind, 'ok');
  assert.equal(r.res.made, 1, 'one ring, not one for the hole');
  const d = newDoc(4);
  addEntities(d, line(0, 0, 50, 0, { layer: 'OUT' }), line(50, 0, 50, 30, { layer: 'OUT' }));
  assert.equal(LC.partContour(LD.makePart('o', 'open', d, 1), CFG).kind, 'open');
});

test('the contour part is the ring: outside 10 mm grows the box by 10, inside shrinks it', () => {
  const p = plate(), out = LC.contourPart(p, LC.partContour(p, CFG).res, STYLE);
  near(out.w, 120); near(out.h, 80);
  const inn = LC.contourPart(p, LC.partContour(p, { ...CFG, dir: 'inside' }).res, STYLE);
  near(inn.w, 80); near(inn.h, 40);
  assert.deepEqual([...new Set(out.raw.entities.map((e) => e.layer))], ['Contour']);
});

test('steps: every ring of one run is in the one contour part', () => {
  const p = plate(), r = LC.partContour(p, { ...CFG, steps: 3 });
  assert.equal(r.res.made, 3);
  const c = LC.contourPart(p, r.res, STYLE);
  near(c.w, 100 + 60); near(c.h, 60 + 60);
});

test('the contour lies on its part for any turn and mirror, so the two boxes nest evenly', () => {
  const p = plate(), c = LC.contourPart(p, LC.partContour(p, CFG).res, STYLE);
  for (const pl of [placement1('a', 30, 40), placement1('a', 30, 40, 90), placement1('a', 200, 100, 180, true, false), placement1('a', 5, 5, 270, true, true), placement1('a', 5, 5, 180, false, true)]) {
    nearBox(placedBox(c, LC.contourPlacement(p, pl, c)), grow(placedBox(p, pl), 10));
  }
});

test('turned by an odd angle the two boxes still share a centre', () => {
  const p = plate(), c = LC.contourPart(p, LC.partContour(p, CFG).res, STYLE), pl = placement1('a', 200, 100, 37, true, false);
  const mid = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  nearBox(mid(placedBox(c, LC.contourPlacement(p, pl, c))), mid(placedBox(p, pl)));
});

test('the preview rings are the same places on the sheet (y up)', () => {
  const p = plate(), pl = placement1('a', 30, 40, 90), r = LC.partContour(p, CFG);
  const xs = LC.sheetLoops(p, pl, r.res, 700).flat().map((q) => q[0]), ys = LC.sheetLoops(p, pl, r.res, 700).flat().map((q) => q[1]);
  const b = grow(placedBox(p, pl), 10);
  near(Math.min(...xs), b[0]); near(Math.max(...xs), b[2]); near(Math.min(...ys), b[1]); near(Math.max(...ys), b[3]);
});

test('a style: colour and a dashed line style are kept in the part', () => {
  const p = plate(), c = LC.contourPart(p, LC.partContour(p, CFG).res, { ...STYLE, colour: 'aci:1', lt: 'DASHED', dash: [7, 4] });
  assert.ok(c.raw.entities.every((e) => e.aci === 1 && e.lt === 'DASHED'));
  assert.deepEqual(c.raw.ltypes.DASHED.pattern, [7, -4]);
});

test('saved and reopened: the contour part, its placement and the links come back', () => {
  const lay = LD.newLayout('L'), p = plate();
  lay.parts.a = p;
  const c = LC.contourPart(p, LC.partContour(p, CFG).res, STYLE);
  lay.parts[c.id] = c;
  const src = { ...placement1('a', 30, 40, 90), g: 'g1', cid: 'c9' };
  lay.placed = [src, { ...LC.contourPlacement(p, src, c), g: 'g1', ct: 'c9' }];
  const back = LD.layoutFromRaw(readDxf(writeDxf(LD.layoutRaw(lay))), 'L');
  assert.equal(back.placed.length, 2);
  assert.deepEqual(back.placed.map((q) => [q.g, q.cid, q.ct]), [['g1', 'c9', undefined], ['g1', undefined, 'c9']]);
  const names = Object.values(back.parts).map((q) => q.name).sort();
  assert.deepEqual(names, ['plate', 'plate - contour 1']);
  const bc = Object.values(back.parts).find((q) => q.name.endsWith('contour 1')), bp = Object.values(back.parts).find((q) => q.name === 'plate');
  nearBox(placedBox(bc, back.placed[1]), grow(placedBox(bp, back.placed[0]), 10));
  assert.ok(flatten(readDxf(writeDxf(LD.layoutRaw(lay)))).items.length > 0);
});

console.log(n + ' tests passed');
