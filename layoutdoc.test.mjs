// layoutdoc.js — the layout model, its parts, and the settings kept inside the .dxf.   node layoutdoc.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readDxf, decodeDxf, flatten, unionBox, mapply } from './web/drawing.js';
import { writeDxf, newDoc, addEntities, rect, line, circle, insert, addBlock } from './web/dxf-write.js';
import { placedMat, placedBox, placement1, buildLayoutDoc } from './web/apply.js';
import * as LD from './web/layoutdoc.js';
import * as P from './web/place.js';
import { planPdf, readTitleBlock, withTitleBlock } from './web/pdf-export.js';

const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, a + ' != ' + b);
let n = 0;
function test(name, fn) { fn(); n++; console.log('ok', name); }
const load = (f) => readDxf(decodeDxf(readFileSync('fixtures/' + f)));
const R = (x) => Math.round(x * 1e6) / 1e6;

test('swatch strip recolours a private part including nested blocks, keeps geometry, source and saved colour', () => {
  const raw = newDoc(4);
  addBlock(raw, 'inner', [line(0, 0, 10, 10, { aci: 5 })]);
  addEntities(raw, insert('inner', 0, 0), line(0, 10, 10, 0));
  const part = LD.makePart('source', 'Bracket', raw, 1), before = structuredClone(raw);
  const coloured = LD.withPartColour(part, 'tc:16746496', 'private');
  assert.deepEqual(raw, before);
  assert.equal(coloured.id, 'private');
  assert.deepEqual(coloured.box, part.box);
  assert.ok(coloured.raw.entities.every((e) => e.tc === 16746496));
  assert.equal(coloured.raw.blocks.inner.entities[0].tc, 16746496);
  assert.equal(LD.withPartColour(coloured, 'tc:16746496', 'again'), null);
  const lay = LD.newLayout('Colours');
  lay.parts = { source: part, private: coloured };
  lay.placed = [placement1('source', 0, 0), placement1('private', 20, 0)];
  const reopened = LD.layoutFromRaw(readDxf(writeDxf(LD.layoutRaw(lay))), 'Colours');
  const saved = reopened.parts[reopened.placed[1].partId];
  assert.ok(saved.raw.entities.every((e) => e.tc === 16746496));
  assert.equal(Object.values(saved.raw.blocks)[0].entities[0].tc, 16746496);
});

/** A rectangle drawing w x h on layer OUT with one far-away dimension-layer line, as a document. */
function plate(w, h, o = {}) {
  const d = newDoc(4);
  addEntities(d, rect(0, 0, w, h, { layer: 'OUT' }), circle(w / 2, h / 2, Math.min(w, h) / 4, { layer: 'OUT' }));
  if (o.dim) addEntities(d, line(-500, -500, 900, -500, { layer: 'Dimensions' }));
  return d;
}

test('parts for placement exclude linked contours and keep unplaced parts', () => {
  const lay = LD.newLayout('contoured');
  lay.parts = Object.fromEntries(['a', 'b', 'ca'].map((id) => [id, { id }]));
  lay.placed = [{ partId: 'a', cid: 'source' }, { partId: 'ca', ct: 'source' }];
  assert.deepEqual(LD.partsForPlacement(lay).map((p) => p.id), ['a', 'b']);
  assert.equal(Object.keys(lay.parts).length, 3, 'filtering leaves the contour in the layout');
});

test('extractRaw: a selection, without the kept dimensions, sized without them', () => {
  const raw = plate(100, 60, { dim: true });
  assert.equal(raw.entities.length, 3);
  const all = LD.extractRaw(raw, null);
  assert.equal(all.entities.length, 2);
  const p = LD.makePart('a', 'plate', all);
  near(p.w, 100); near(p.h, 60);
  const one = LD.extractRaw(raw, new Set([0, 2]));              // the dimension (2) is in the selection and still left out
  assert.equal(one.entities.length, 1);
  assert.equal(LD.extractRaw(raw, new Set([2])), null);          // only a dimension: nothing to extract
  assert.equal(raw.entities.length, 3, 'the drawing is untouched');
});

test('extractRaw leaves the source PDF title block out of the part', () => {
  const title = { enabled: true, file: 'OTHER JOB' };
  const raw = withTitleBlock(plate(100, 60), title);
  addBlock(raw, 'OUTLINE', [line(0, 0, 3, 3)]);
  addEntities(raw, insert('OUTLINE', 10, 20));
  for (const sel of [null, new Set([2])]) {
    const extracted = LD.extractRaw(raw, sel);
    assert.deepEqual(Object.keys(extracted.blocks), ['OUTLINE']);
    assert.equal(readTitleBlock(readDxf(writeDxf(extracted))), undefined);
  }
  assert.deepEqual(readTitleBlock(raw), title, 'the source keeps its title block');
});

test('names: "<file> 1", "<file> 2" — the first free', () => {
  assert.equal(LD.nextName('cluster', []), 'cluster 1');
  assert.equal(LD.nextName('cluster', ['cluster 1', 'Cluster 2', 'other 3']), 'cluster 3');
  assert.equal(LD.nextName('a', ['A 1']), 'a 2');
});

test('a part is a DXF text and comes back with the same size, units and layers', () => {
  const raw = load('inch.dxf');
  const p = LD.makePart('i', 'inch', LD.extractRaw(raw, null));
  assert.equal(p.factor, 25.4);
  const text = LD.partToDxf(p);
  assert.ok(/^[\x00-\x7f]*$/.test(text));
  const back = LD.partFromDxf('j', 'inch', text);
  near(back.w, p.w, 1e-4); near(back.h, p.h, 1e-4); assert.equal(back.factor, 25.4);
  assert.equal(LD.partFromDxf('x', 'x', 'garbage'), null);
  assert.equal(LD.partFromDxf('x', 'x', writeDxf(newDoc())), null, 'no extents: not a part');
});

test('placed parts: matrix, box and INSERT agree for every turn and mirror', () => {
  const part = LD.makePart('a', 'plate', plate(100, 60), 1);
  const sheetH = 700;
  for (const rot of [0, 90, 180, 270, 30]) for (const mx of [false, true]) for (const my of [false, true]) {
    const pl = placement1('a', 200, 150, rot, mx, my);
    const bx = placedBox(part, pl);
    // the matrix maps the part's own box corners to the same box (y down)
    const M = placedMat(part, pl, sheetH), pts = [[0, 0], [100, 0], [100, 60], [0, 60]].map(([u, v]) => mapply(M, u, v));
    near(Math.min(...pts.map((p) => p[0])), bx[0], 1e-6); near(Math.max(...pts.map((p) => p[0])), bx[2], 1e-6);
    near(sheetH - Math.max(...pts.map((p) => p[1])), bx[1], 1e-6); near(sheetH - Math.min(...pts.map((p) => p[1])), bx[3], 1e-6);
    // and the INSERT in the file draws the same box
    const { doc } = buildLayoutDoc({ parts: { a: part }, placed: [pl], sheetW: 1000, sheetH });
    const fl = flatten(doc), items = fl.items.filter((it) => fl.layers[it.L[0]].name === 'Parts' || fl.layers[it.L[0]].name === 'OUT');
    const b = items.reduce((a, it) => unionBox(a, it.b), null);
    near(b[0], bx[0], 1e-4); near(b[1], bx[1], 1e-4); near(b[2], bx[2], 1e-4); near(b[3], bx[3], 1e-4);
  }
});

test('mirror is a negative scale on the INSERT, turn is its rotation, a mm part from inches is scaled 25.4', () => {
  const inch = LD.makePart('i', 'inch', LD.extractRaw(load('inch.dxf'), null));
  const { doc } = buildLayoutDoc({ parts: { i: inch }, placed: [placement1('i', 10, 20, 90, true, false), placement1('i', 0, 0, 0, false, true)], sheetW: 500, sheetH: 400 });
  const ins = doc.entities.filter((e) => e.type === 'INSERT'), v = (e, c) => +e.r.v[e.r.c.indexOf(c)];
  near(v(ins[0], 41), -25.4); near(v(ins[0], 42), 25.4); near(v(ins[0], 50), 90);
  near(v(ins[1], 41), 25.4); near(v(ins[1], 42), -25.4);
});

/** A layout of two different parts: a grid of the plate (typed 2 rows x 3 columns) and one turned, mirrored panel. */
function sample() {
  const lay = LD.newLayout('Test layout');
  lay.parts.a = LD.makePart('a', 'Plate Ünï', plate(100, 60), 1, 'plate.dxf');
  lay.parts.b = LD.makePart('b', 'panel', LD.extractRaw(load('sample.dxf'), null));
  Object.assign(lay.s, { sheetW: 900, sheetH: 600, gripBottom: 25, gripTop: 30, gripLeft: 30, crop: true, reg: false, gapX: 7, gapY: 3, rotate: '0', align: 'topleft',
    fit: false, rows: 2, cols: 3, extraRows: [{ after: 1, mm: 10 }], extraCols: [{ after: 2, mm: 4 }], gridPart: 'a' });
  lay.placed.push(placement1('b', 600, 300, 90, true, false));
  return lay;
}

test('layoutRaw: sheet, marks, a block per part, one INSERT per placed part (grid and loose), hidden settings block', () => {
  const lay = sample(), raw = LD.layoutRaw(lay);
  const ins = raw.entities.filter((e) => e.type === 'INSERT');
  assert.equal(ins.length, 6 + 1);
  assert.ok(ins.every((e) => e.layer === 'Parts'));
  assert.ok(raw.blocks['panel'] && raw.blocks[LD.LAYOUT_BLOCK]);
  assert.equal(raw.entities.filter((e) => e.layer === 'Sheet').length, 1);
  assert.ok(raw.entities.some((e) => e.layer === 'Marks'));
  assert.ok(!raw.entities.some((e) => e.type === 'INSERT' && String(e.r.v[e.r.c.indexOf(2)]).trim() === LD.LAYOUT_BLOCK), 'nothing inserts the settings block');
  // other CAD apps see the sheet and parts only: the settings block draws nothing
  const fl = flatten(raw), [x0, y0, x1, y1] = fl.boxes.model;
  assert.ok(x0 >= -1e-6 && y0 >= -1e-6 && x1 <= 900 + 1e-6 && y1 <= 600 + 1e-6, [x0, y0, x1, y1].join());
});

test('round trip: write, read, and the layout is back — settings, parts and every placed part', () => {
  const lay = sample(), text = writeDxf(LD.layoutRaw(lay), { escapeUnicode: true });
  assert.ok(/^[\x00-\x7f]*$/.test(text), 'ASCII only');
  const back = LD.layoutFromRaw(readDxf(text), 'Test layout.dxf');
  assert.equal(back.name, 'Test layout.dxf');
  assert.deepEqual(back.s, lay.s);
  assert.deepEqual(back.placed, lay.placed);
  assert.deepEqual(Object.keys(back.parts).sort(), ['a', 'b']);
  assert.equal(back.parts.a.name, 'Plate Ünï'); assert.equal(back.parts.a.src, 'plate.dxf', 'the file the part came from');
  for (const id of ['a', 'b']) { near(back.parts[id].w, lay.parts[id].w, 1e-4); near(back.parts[id].h, lay.parts[id].h, 1e-4); }
  // the placed parts are the same: the grid regenerates, and the file written again is the same file
  const a = LD.placedAll(lay), b = LD.placedAll(back);
  assert.equal(a.length, b.length);
  a.forEach((p, i) => { near(p.x, b[i].x); near(p.y, b[i].y); near(p.rot, b[i].rot); assert.equal(p.src, b[i].src); });
  const again = writeDxf(LD.layoutRaw(back), { escapeUnicode: true });
  assert.deepEqual({ ...LD.readMeta(readDxf(again)), name: 0 }, { ...LD.readMeta(readDxf(text)), name: 0 }, 'written again: the same settings');
  assert.equal(readDxf(again).entities.filter((e) => e.type === 'INSERT').length, 7);
});

test('TODO 156b1: a scaled placement is the INSERT scale, and the scale comes back from the file', () => {
  const lay = sample();
  lay.placed.push({ ...placement1('a', 300, 200, 30, false, true), sc: 2.5 });
  const raw = LD.layoutRaw(lay), ins = raw.entities.filter((e) => e.type === 'INSERT');
  const text = writeDxf(raw, { escapeUnicode: true }), back = LD.layoutFromRaw(readDxf(text), 'Scaled');
  const sc = back.placed.at(-1);
  near(sc.sc, 2.5); assert.equal(sc.mirrorY, true); near(sc.rot, 30);
  assert.equal(back.placed[0].sc, undefined, 'an unscaled part has no sc');
  assert.deepEqual(back.placed, lay.placed);
  const e = readDxf(text).entities.filter((x) => x.type === 'INSERT').at(-1);
  assert.equal(ins.length, 8);
  near(Number(e.r.v[e.r.c.indexOf(42)]), -2.5, 1e-6);       // Y scale = mirror x sc
  near(Number(e.r.v[e.r.c.indexOf(41)]), 2.5, 1e-6);
  const againRaw = readDxf(writeDxf(LD.layoutRaw(back))), again = LD.layoutFromRaw(againRaw);
  assert.deepEqual(again.placed, lay.placed, 'reopening and saving keeps the placement scale');
  near(again.parts.a.w, lay.parts.a.w); near(again.parts.a.h, lay.parts.a.h);
  const againInsert = againRaw.entities.filter((x) => x.type === 'INSERT').at(-1);
  near(Number(againInsert.r.v[againInsert.r.c.indexOf(41)]), 2.5);
  near(Number(againInsert.r.v[againInsert.r.c.indexOf(42)]), -2.5);
});

test('the settings need several TEXT chunks when long, and still round-trip (many extra gaps, a long name)', () => {
  const lay = sample();
  lay.s.extraRows = Array.from({ length: 60 }, (_, i) => ({ after: i + 1, mm: i + 0.5 }));
  lay.parts.a.name = 'x'.repeat(150) + '%%c ⌀ "quoted" \\ backslash';
  const raw = LD.layoutRaw(lay);
  assert.ok(raw.blocks[LD.LAYOUT_BLOCK].entities.length > 3);
  assert.ok(raw.blocks[LD.LAYOUT_BLOCK].entities.every((e) => e.r.v[e.r.c.indexOf(1)].length <= 200));
  const back = LD.layoutFromRaw(readDxf(writeDxf(raw, { escapeUnicode: true })));
  assert.equal(back.s.extraRows.length, 60); assert.equal(back.parts.a.name, lay.parts.a.name);
});

test('a drawing that is not one of ours is not a layout; odd settings fall back to the defaults', () => {
  assert.equal(LD.layoutFromRaw(load('sample.dxf')), null);
  assert.equal(LD.layoutFromRaw(readDxf(writeDxf(plate(10, 10)))), null);
  const s = LD.cleanSettings({ sheetW: -5, sheetH: 'abc', rotate: '45', align: 'x', rows: 0, cols: 2.7, crop: false, extraCols: [{ after: 0, mm: 5 }, { after: 2, mm: 3 }, null], gridPart: 5 });
  assert.equal(s.sheetW, LD.DEFAULTS.sheetW); assert.equal(s.sheetH, LD.DEFAULTS.sheetH); assert.equal(s.rotate, '0'); assert.equal(s.align, 'centre');
  const bare = LD.cleanSettings({});
  assert.equal(bare.crop, false); assert.equal(bare.reg, false, 'marks missing from a file are off, as the defaults say');
  assert.equal(LD.cleanSettings({ crop: true, reg: true }).crop, true);
  assert.equal(s.rows, 1); assert.equal(s.cols, 2); assert.equal(s.crop, false); assert.deepEqual(s.extraCols, [{ after: 2, mm: 3 }]); assert.equal(s.gridPart, null);
  // a block that was deleted by another app: the part is gone, its placements and the grid with it
  const lay = sample(), raw = LD.layoutRaw(lay);
  delete raw.blocks['panel'];
  const back = LD.layoutFromRaw(raw);
  assert.deepEqual(Object.keys(back.parts), ['a']); assert.equal(back.placed.length, 0);
});

test('two parts whose inner blocks share a name keep their own', () => {
  const mk = (r) => { const d = newDoc(4); addBlock(d, 'DIAL', [circle(0, 0, r, { layer: 'OUT' })]); addEntities(d, rect(0, 0, 50, 50, { layer: 'OUT' }), insert('DIAL', 25, 25)); return d; };
  const lay = LD.newLayout('x');
  lay.parts.a = LD.makePart('a', 'one', mk(5), 1); lay.parts.b = LD.makePart('b', 'two', mk(9), 1);
  lay.placed.push(placement1('a', 0, 0), placement1('b', 100, 0));
  const raw = LD.layoutRaw(lay);
  assert.ok(raw.blocks.DIAL && raw.blocks.DIAL_2);
  const back = LD.layoutFromRaw(readDxf(writeDxf(raw)));
  const radius = (id) => { const e = Object.values(back.parts[id].raw.blocks)[0].entities[0]; return +e.r.v[e.r.c.indexOf(40)]; };
  near(radius('a'), 5); near(radius('b'), 9);
});

test('usage, grid and marks follow what is placed', () => {
  const lay = sample(), L = LD.gridOf(lay);
  assert.equal(L.count, 6); assert.equal(L.manual, true);
  const all = LD.placedAll(lay, L);
  assert.deepEqual(LD.usesOf(all), { a: 6, b: 1 });
  assert.deepEqual(LD.usedIds(lay).sort(), ['a', 'b']);
  assert.equal(LD.marksOf(lay, all).crop.length, 8);
  lay.s.gridPart = null;
  assert.equal(LD.gridOf(lay), null); assert.equal(LD.placedAll(lay).length, 1); assert.deepEqual(LD.usedIds(lay), ['b']);
  assert.equal(LD.marksOf(lay, []).crop.length, 0);
});

test('any angle and a mirror: saved, reopened, drawn in the file and in the PDF where the app drew them', () => {
  const lay = LD.newLayout('turned');
  lay.parts.a = LD.makePart('a', 'plate', plate(100, 60), 1);
  const a = lay.parts.a;
  const placed = [
    P.rotateAbout(a, placement1('a', 300, 200), [350, 230], 33.3333),
    P.mirrorAbout(a, P.rotateAbout(a, placement1('a', 600, 100), [650, 130], 17.5), 'x'),
    P.mirrorAbout(a, P.mirrorAbout(a, placement1('a', 100, 400, 200), 'y'), 'x'),
    placement1('a', 800, 500, 359.5, false, true),
  ];
  lay.placed.push(...placed);
  const raw = readDxf(writeDxf(LD.layoutRaw(lay), { escapeUnicode: true }));
  // the INSERTs carry the angle and the sign of the scale
  const v = (e, c) => +e.r.v[e.r.c.indexOf(c)];
  const ins = raw.entities.filter((e) => e.type === 'INSERT');
  assert.equal(ins.length, 4);
  const sc = (e, c) => (e.r.c.includes(c) ? v(e, c) : 1);
  near(v(ins[0], 50), placed[0].rot, 1e-5); near(sc(ins[0], 41), 1); near(sc(ins[1], 41), -1); near(v(ins[1], 50), placed[1].rot, 1e-5);
  near(sc(ins[3], 42), -1); near(v(ins[3], 50), 359.5, 1e-5);
  // reopened: the same placements
  const back = LD.layoutFromRaw(raw);
  assert.equal(back.placed.length, 4);
  back.placed.forEach((p, i) => assert.ok(P.samePlacement({ ...p, x: R(p.x), y: R(p.y) }, { ...placed[i], x: R(placed[i].x), y: R(placed[i].y) }), 'placement ' + i + ': ' + JSON.stringify([p, placed[i]])));
  // what the file draws is the box the app uses, part by part and all together
  const fl = flatten(raw), shown = fl.items.filter((it) => fl.layers[it.L[0]].name === 'OUT');
  const want = placed.map((p) => placedBox(a, p)).reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])]);
  const got = shown.reduce((u, it) => unionBox(u, it.b), null);
  for (let i = 0; i < 4; i++) near(got[i], want[i], 1e-3);
  // and so does the PDF: the box of everything it draws
  const plan = planPdf({ name: 'turned', fl, factor: 1, off: new Set(), sheetW: 1000, sheetH: 700, hide: ['Sheet', 'Marks'] }, {});
  for (let i = 0; i < 4; i++) near(plan.box[i], want[i], 1e-3);
  assert.ok(plan.bytes().length > 500);
});

test('groups and locks are kept in the settings block and come back; an old file (none) opens as before', () => {
  const lay = sample();
  lay.placed.push(placement1('b', 100, 100), placement1('a', 300, 200, 30));
  lay.placed[0] = { ...lay.placed[0], g: 'grp1', lock: true };
  lay.placed[1] = { ...lay.placed[1], g: 'grp1' };
  const text = writeDxf(LD.layoutRaw(lay), { escapeUnicode: true });
  const back = LD.layoutFromRaw(readDxf(text), 'g.dxf');
  assert.deepEqual(back.placed, lay.placed);
  assert.equal(back.placed[0].g, 'grp1'); assert.equal(back.placed[0].lock, true);
  assert.equal(back.placed[1].g, 'grp1'); assert.equal(back.placed[1].lock, undefined, 'an unlocked part carries no lock');
  assert.equal(back.placed[2].g, undefined);
  // odd values fall away
  const raw = readDxf(text), m = LD.readMeta(raw);
  m.placed[2].g = 5; m.placed[2].lock = 'yes';
  const old = sample(); // the same layout with no groups: placements are exactly the plain ones
  const plain = LD.layoutFromRaw(readDxf(writeDxf(LD.layoutRaw(old), { escapeUnicode: true })), 'o.dxf');
  assert.deepEqual(plain.placed, old.placed);
  assert.ok(plain.placed.every((p) => !('g' in p) && !('lock' in p)));
});

test('Fit clears rotated mirrored placed boxes in sheet coordinates, including saved layouts', () => {
  const lay = LD.newLayout('Occupied');
  Object.assign(lay.s, { sheetW: 400, sheetH: 300, gripBottom: 0, gapX: 0, gapY: 0, align: 'topleft', gridPart: 'a' });
  lay.parts.a = LD.makePart('a', 'Plate', plate(100, 100));
  lay.placed.push(placement1('a', 100, 300, 90, true, false));
  const grid = LD.gridOf(lay);
  assert.equal(grid.skipped, 1); assert.equal(grid.count, 11);
  assert.deepEqual(grid.positions[0], { x: 100, y: 0 });
  assert.equal(LD.placedAll(lay).length, 12);
  const back = LD.layoutFromRaw(readDxf(writeDxf(LD.layoutRaw(lay))), 'Occupied.dxf');
  assert.deepEqual(LD.gridOf(back), grid);
  assert.equal(LD.layoutRaw(lay).entities.filter((e) => e.type === 'INSERT').length, 12);
});

test('TODO 127: anchored grids derive identically after save and reopen, without storing copies', () => {
  for (const fit of [true, false]) for (const rotate of ['0', '90']) {
    const lay = LD.newLayout('Anchored');
    lay.parts.a = LD.makePart('a', 'Plate', plate(100, 60));
    lay.parts.b = LD.makePart('b', 'Other', plate(100, 60));
    Object.assign(lay.s, { sheetW: 360, sheetH: 240, gripBottom: 0, gapX: 10, gapY: 10, gridPart: 'a', fit, rotate, cols: 3, rows: 2 });
    lay.placed.push(placement1('a', 130, rotate === '90' ? 150 : 90, rotate === '90' ? -90 : 0), placement1('b', 240, 90));
    const grid = LD.gridOf(lay), all = LD.placedAll(lay);
    assert.equal(grid.taken, 1);
    assert.equal(all.length, grid.count + 2);
    assert.equal(new Set(all.map((p) => `${p.x},${p.y}`)).size, all.length);
    const raw = LD.layoutRaw(lay);
    assert.equal(LD.readMeta(raw).placed.length, 2, 'only loose parts are stored');
    assert.equal(raw.entities.filter((e) => e.type === 'INSERT').length, all.length);
    const back = LD.layoutFromRaw(readDxf(writeDxf(raw)));
    assert.deepEqual(LD.gridOf(back), grid);
    assert.deepEqual(LD.placedAll(back), all);
  }
});

console.log(n + ' tests passed');
