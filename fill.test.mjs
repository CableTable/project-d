import test from 'node:test';
import assert from 'node:assert/strict';
import { newDoc, rect, roundRect, circle, ellipse, lwpoly, entity, addBlock, insert, writeDxf } from './web/dxf-write.js';
import { readDxf, flatten } from './web/drawing.js';
import { boundary, boundariesMatch, closedOutline, containsPoint, fillHatch, copyColours } from './web/fill.js';
import { moveEntities, copyEntities, removeEntities } from './web/edit.js';
import { rotateEntities } from './web/rotate.js';
import { scaleEntities } from './web/scale.js';
import { mirrorEntity } from './web/modify.js';
import { dragGrip } from './web/grips.js';
import { cutterDoc } from './web/dxf-cutter.js';
import { explodeInsert, explodeSelection } from './web/explode.js';
import { offsetEntity } from './web/modify.js';
import { breakApart } from './web/breakapart.js';
import { makeIndex, outlineLoops, joinTinyGaps } from './web/edit.js';
import * as S from './web/shaping.js';
import { copySnapshot, pasteSnapshot } from './web/clipboard.js';
import { newLayout, makePart, layoutRaw } from './web/layoutdoc.js';
import { placement1 } from './web/apply.js';
import { ink } from './web/render.js';
import { nearestAci, keyRgb } from './web/colour.js';

const fill = 'tc:1149183', filled = (e) => ({ ...e, fill });
const docOf = (...entities) => ({ ...newDoc(), entities });
const spline = () => entity('SPLINE', [[70, 1], [71, 1], [72, 7], [73, 5], ...[0, 0, 1, 2, 3, 4, 4].map((v) => [40, v]),
  ...[[10, 10], [30, 10], [30, 30], [10, 30], [10, 10]].flatMap(([x, y]) => [[10, x], [20, y]])]);

test('TODO 148c: all closed outline kinds save solid HATCH before outline, exact RGB + nearest ACI, link on read', () => {
  const legacy = entity('POLYLINE', [[70, 1]]);
  legacy.kids = [[10, 10], [30, 10], [30, 30], [10, 30]].map(([x, y]) => ({ type: 'VERTEX', c: [10, 20], v: [String(x), String(y)] }));
  for (const e of [rect(10, 10, 20, 20), roundRect(10, 10, 30, 20, 4), circle(100, 35, 20), circle(1000, -800, 1200), ellipse(20, 20, 15, 5, .5), spline(), legacy]) {
    assert.ok(closedOutline(e), e.type);
    const raw = docOf(filled(e)), text = writeDxf(raw);
    assert.match(text, /HATCH\r\n/); assert.ok(text.indexOf('HATCH\r\n') < text.lastIndexOf(e.type + '\r\n'));
    assert.match(text, /420\r\n1149183\r\n/);
    assert.match(text, new RegExp('62\\r\\n' + nearestAci(keyRgb(fill)) + '\\r\\n'));
    const reopened = readDxf(text);
    assert.equal(reopened.entities.length, 1, e.type);
    assert.equal(reopened.entities[0].fill, fill);
    assert.ok(boundariesMatch(boundary(e), boundary(reopened.entities[0])));
    assert.equal(flatten(reopened).items[0].attachedFill, true);
    assert.equal(readDxf(writeDxf(reopened)).entities[0].fill, fill);
  }
});

test('TODO 148c: HATCH boundary matches reversed/subdivided edges, leaves unmatched, patterned and holed HATCH alone', () => {
  const outline = lwpoly([[30, 30], [30, 10], [20, 10], [10, 10], [10, 30]], { closed: true });
  const hatch = fillHatch(filled(rect(10, 10, 20, 20)));
  const reopened = readDxf(writeDxf(docOf(circle(90, 90, 3), hatch, outline)));
  assert.equal(reopened.entities.length, 2); assert.equal(reopened.entities[1].fill, fill);
  for (const [code, val] of [[70, '0'], [91, '2']]) {
    const other = structuredClone(hatch); other.r.v[other.r.c.indexOf(code)] = val;
    assert.equal(readDxf(writeDxf(docOf(other, outline))).entities.length, 2);
  }
  assert.equal(readDxf(writeDxf(docOf(hatch, rect(10, 10, 21, 20)))).entities[0].type, 'HATCH');
  assert.ok(!containsPoint(boundary(circle(0, 0, 10)), [9, 9]));
  assert.ok(containsPoint(boundary(circle(0, 0, 10)), [0, 0]));
  const external = entity('HATCH', [[10, 0], [20, 0], [30, 0], [2, 'SOLID'], [70, 1], [71, 0], [91, 1], [92, 1], [93, 1],
    [72, 2], [10, 100], [20, 35], [40, 20], [50, 0], [51, 360], [73, 1], [97, 0], [75, 0], [76, 1], [98, 0]], { tc: 0x1188ff });
  assert.equal(readDxf(writeDxf(docOf(external, circle(100, 35, 20)))).entities[0].fill, fill, 'standard arc-edge HATCH right before its outline links');
  const elliptical = entity('HATCH', [[10, 0], [20, 0], [30, 0], [2, 'SOLID'], [70, 1], [71, 0], [91, 1], [92, 1], [93, 1],
    [72, 3], [10, 100], [20, 35], [11, 25], [21, 10], [40, .7], [50, 30], [51, 390], [73, 1], [97, 0], [75, 0], [76, 1], [98, 0]], { tc: 0x1188ff });
  assert.equal(readDxf(writeDxf(docOf(elliptical, ellipse(100, 35, 25, 10, .7)))).entities[0].fill, fill, 'exact ellipse HATCH links despite different boundary sampling');
});

test('TODO 148c: variable-width polylines get one fill of the whole outline', () => {
  const e = filled(lwpoly([[0, 0], [20, 0], [20, 20], [0, 20]], { closed: true }));
  e.r.c.push(40, 41); e.r.v.push('2', '4');
  const fl = flatten(docOf(e)), fills = fl.items.filter((it) => it.attachedFill);
  assert.equal(fills.length, 1); assert.deepEqual(fills[0].b, [0, 0, 20, 20]);
});

test('TODO 148c: moves, copies, rotation, scale, mirror and grips derive the fill from the new boundary; Delete removes both', () => {
  const raw = docOf(filled(rect(10, 10, 20, 20))), sel = new Set([0]);
  const results = [moveEntities(raw, sel, 9, 4), copyEntities(raw, sel, 9, 4), rotateEntities(raw, sel, [0, 0], 37), scaleEntities(raw, sel, [0, 0], 2),
    { entities: [mirrorEntity(raw.entities[0], [0, 0], [0, 1]).ent] }, { entities: [dragGrip(raw.entities[0], 'v0', [8, 7]).ent] }];
  for (const result of results) {
    const next = result.entities.at(-1); assert.equal(next.fill, fill);
    assert.equal(readDxf(writeDxf(docOf(next))).entities[0].fill, fill);
    assert.ok(!boundariesMatch(boundary(raw.entities[0]), boundary(next)));
  }
  assert.equal(flatten({ ...raw, ...removeEntities(raw, sel) }).items.length, 0);
});

test('TODO 148c: fills survive blocks, placed-part explosion and cutter export drops and counts them', () => {
  const raw = newDoc(); addBlock(raw, 'Part', [filled(circle(0, 0, 10)), filled(rect(20, 20, 10, 10))]); raw.entities = [insert('Part', 20, 30, { rot: 45 })];
  const opened = readDxf(writeDxf(raw)); assert.equal(opened.blocks.Part.entities[0].fill, fill);
  const exploded = explodeInsert(opened.entities[0], opened); assert.ok(exploded.entities.every((e) => e.fill === fill));
  const cut = cutterDoc(opened, .01); assert.equal(cut.left, 2);
  assert.ok(cut.doc.entities.every((e) => !e.fill)); assert.doesNotMatch(writeDxf(cut.doc), /HATCH/);
});

test('TODO 148c: Eyedropper copies effective line colour and fill only, including No fill', () => {
  const dst = filled(rect(0, 0, 10, 10, { layer: 'Keep', lt: 'DASHED', lw: 80 }));
  const next = copyColours({ ...circle(0, 0, 2), layer: 'Source' }, dst, { Source: { tc: 0xff8800 } });
  assert.equal(next.tc, 0xff8800); assert.equal(next.fill, null);
  assert.equal(next.layer, 'Keep'); assert.equal(next.lt, 'DASHED'); assert.equal(next.lw, 80);
});

test('TODO 148c review: only a visible HATCH right before its outline, same layer and space, becomes the fill', () => {
  const outline = rect(10, 10, 20, 20), hatch = fillHatch(filled(outline));
  const stays = (...list) => readDxf(writeDxf(docOf(...list))).entities.some((e) => e.type === 'HATCH');
  assert.equal(stays(hatch, outline), false);
  assert.ok(stays({ ...hatch, layer: 'HATCHLAYER' }, outline), 'another layer');
  assert.ok(stays({ ...hatch, hidden: true }, outline), 'hidden');
  assert.ok(stays({ ...hatch, ps: true }, outline), 'paper space');
  assert.ok(stays(hatch, circle(0, 0, 1), outline), 'not adjacent');
  assert.ok(stays(outline, hatch), 'after its outline');
  const back = readDxf(writeDxf(docOf({ ...hatch, layer: 'HATCHLAYER', hidden: true }, outline))).entities.find((e) => e.type === 'HATCH');
  assert.equal(back.hidden, true); assert.equal(back.layer, 'HATCHLAYER');
});

test('TODO 148c review: a palette fill round-trips as the same key (62 only), true colour as 420', () => {
  for (const key of ['aci:1', 'aci:7', 'bylayer', 'byblock']) {
    const text = writeDxf(docOf({ ...rect(0, 0, 10, 10), fill: key }));
    assert.doesNotMatch(text, /420\r\n/, key);
    assert.equal(readDxf(text).entities[0].fill, key);
  }
});

test('TODO 148c review: a fill with its own colour keeps it in the light theme; aci:7 still flips', () => {
  const item = (key) => flatten(docOf({ ...rect(0, 0, 10, 10), fill: key })).items.find((it) => it.attachedFill);
  assert.equal(item('tc:' + 0xff8000).exact, true); assert.equal(item('tc:' + 0xff8000).css, '#ff8000');
  assert.equal(item('aci:1').exact, true);
  assert.ok(!item('aci:7').exact); assert.notEqual(ink(item('aci:7').css, false), item('aci:7').css);
});

test('TODO 148c review: the fill survives Copy / paste between tabs', () => {
  const snap = copySnapshot(docOf(filled(rect(10, 10, 20, 20))), new Set([0]), 1, 'a.dxf');
  const pasted = pasteSnapshot(snap, { raw: newDoc(4), factor: 1, space: 0, dp: 2, names: ['0'], hidden: [], locked: [], cur: '0' });
  assert.equal(pasted.entities[0].fill, fill);
  assert.equal(flatten(docOf(...pasted.entities)).items.filter((it) => it.attachedFill).length, 1);
});

test('TODO 148c review: Offset, Join, Shaping, Explode and Break Apart on a filled shape leave no orphan fill', () => {
  const raw = docOf(filled(rect(0, 0, 10, 10)), filled(rect(5, 5, 10, 10)));
  assert.equal(offsetEntity(raw.entities[0], 2, [20, 20]).ent.fill, fill, 'Offset: the copy is filled too');
  const ed = makeIndex(raw, flatten(raw));
  joinTinyGaps(raw, ed, 0.1);                                                    // closed outlines have no gaps: nothing to join, no crash
  assert.equal(S.shape('weld', outlineLoops(ed, [0, 1]).loops).rings.length, 1);   // Shaping: the new outline is plain; the sources go with their fills
  const x = explodeSelection(raw, new Set([0]));
  assert.ok(x.entities.slice(0, 4).every((e) => e.type === 'LINE' && !e.fill), 'Explode: the lines carry no fill');
  assert.equal(x.entities[4].fill, fill);
  const b = newDoc(); addBlock(b, 'P', [filled(rect(0, 0, 10, 10))]); b.entities = [insert('P', 0, 0)];
  assert.equal(breakApart(b, new Set([0])).entities[0].fill, fill, 'Break Apart: the outline keeps its fill');
});

test('TODO 148c review: a filled part placed on a layout draws its fill', () => {
  const lay = newLayout('L');
  lay.parts = { p: makePart('p', 'Plate', docOf(filled(rect(0, 0, 20, 20))), 1) }; lay.placed = [placement1('p', 30, 40)];
  assert.equal(flatten(readDxf(writeDxf(layoutRaw(lay)))).items.filter((it) => it.attachedFill).length, 1);
});
