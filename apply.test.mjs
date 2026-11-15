// apply.js — the layout Apply builds: INSERTs on a grid, y up, rotation, marks, round trip.   node apply.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs');
const D = await import('./web/drawing.js');
const W = await import('./web/dxf-write.js');
const A = await import('./web/apply.js');
const { stepRepeat } = await import('./web/layout.js');
const { unitFactor } = await import('./web/doc.js');

const base = { sheetW: 1000, sheetH: 700, gripTop: 10, gripRight: 10, gripBottom: 30, gripLeft: 10, gapX: 5, gapY: 5, rotate: '0', align: 'centre' };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m || ''} ${a} !~ ${b}`);
const load = (f) => { const raw = D.readDxf(D.decodeDxf(fs.readFileSync('fixtures/' + f))); const fl = D.flatten(raw); return { raw, fl }; };
const inserts = (doc) => doc.entities.filter((e) => e.type === 'INSERT');
const pair = (e, code) => e.r.v[e.r.c.indexOf(code)];
/** The drawn box of everything except the sheet outline and the marks. */
const partsBox = (doc) => { const fl = D.flatten(doc); return fl.items.filter((it) => !['Sheet', 'Marks'].includes(fl.layers[it.L[0]].name)).reduce((a, it) => D.unionBox(a, it.b), null); };
const onLayer = (doc, l) => doc.entities.filter((e) => e.layer === l);

test('block names are valid', () => {
  assert.equal(A.blockName('front panel v2.dxf'), 'front_panel_v2');
  assert.equal(A.blockName('Bracket 1.5'), 'Bracket_1.5');
  assert.equal(A.blockName('plate.DXF'), 'plate');
  assert.equal(A.blockName('Bracket.other'), 'Bracket.other');
  assert.equal(A.blockName('a<b>:c/d.dxf'), 'a_b_c_d');
  assert.equal(A.blockName('.dxf'), 'PART'); assert.equal(A.blockName(''), 'PART');
});

test('demo part: one INSERT per position, on Parts, y up (corner copy checked against the sheet)', () => {
  const L = stepRepeat({ ...base, partW: 120, partH: 80 });
  const doc = A.buildLayout({ part: { name: 'Overlay-A', w: 120, h: 80 }, layout: L, ...base });
  assert.equal(L.count, 49);
  assert.equal(inserts(doc).length, 49);
  assert.ok(inserts(doc).every((e) => e.layer === 'Parts'));
  assert.ok(doc.blocks['Overlay-A']);
  // top-left copy on the sheet (y down) = top of the sheet; here its INSERT is its bottom-left corner, y up
  const p0 = L.positions[0], i0 = inserts(doc)[0];
  near(+pair(i0, 10), p0.x); near(+pair(i0, 20), 700 - p0.y - 80);
  // the first row is the top row: its y is the largest
  const ys = inserts(doc).map((e) => +pair(e, 20));
  near(Math.max(...ys), +pair(i0, 20));
  // every copy's bounding box inside the sheet and outside the gripper band at the bottom (30 mm)
  const [x0, y0, x1, y1] = partsBox(doc);
  assert.ok(x0 >= 0 && y0 >= 30 - 1e-6 && x1 <= 1000 && y1 <= 700, [x0, y0, x1, y1].join());
  // the sheet outline
  const sheet = onLayer(doc, 'Sheet'); assert.equal(sheet.length, 1);
  assert.deepEqual(sheet[0].r.v.slice(sheet[0].r.c.indexOf(10)).filter((_, i) => sheet[0].r.c[sheet[0].r.c.indexOf(10) + i] === 10).map(Number), [0, 1000, 1000, 0]);
});

test('flipped corner: a part on the sheet\'s top edge ends at the sheet\'s top in y up', () => {
  const L = stepRepeat({ ...base, partW: 120, partH: 80, align: 'topleft' });
  const doc = A.buildLayout({ part: { name: 'P', w: 120, h: 80 }, layout: L, ...base });
  const b = partsBox(doc);
  near(b[3], 700 - 10);               // margin 10 at the top
  near(b[0], 10);
});

test('rotated: INSERT turned 270° with the right offset, copies stay inside their footprint', () => {
  const L = stepRepeat({ ...base, partW: 120, partH: 80, rotate: '90' });
  assert.ok(L.rotated);
  const doc = A.buildLayout({ part: { name: 'P', w: 120, h: 80 }, layout: L, ...base, crop: false, reg: false });
  const ins = inserts(doc);
  assert.equal(ins.length, L.count);
  assert.ok(ins.every((e) => +pair(e, 50) === 270));
  // the first copy's drawn box equals its footprint (80 wide, 120 tall) at the top-left position, y up
  const p0 = L.positions[0], one = A.buildLayout({ part: { name: 'P', w: 120, h: 80 }, layout: { ...L, positions: [p0], count: 1 }, ...base, crop: false, reg: false });
  const b = partsBox(one);
  near(b[0], p0.x); near(b[2], p0.x + 80); near(b[1], 700 - p0.y - 120); near(b[3], 700 - p0.y);
  // the part's own corner (its bottom-left, y up) lands at the footprint's top-left
});

test('marks: on layer Marks when on, absent when off; same geometry as the preview', () => {
  const L = stepRepeat({ ...base, partW: 120, partH: 80 });
  const on = A.buildLayout({ part: { name: 'P', w: 120, h: 80 }, layout: L, ...base });
  assert.equal(onLayer(on, 'Marks').filter((e) => e.type === 'LINE').length, 8 + 8);   // 8 crop ticks + 4 crosses × 2
  assert.equal(onLayer(on, 'Marks').filter((e) => e.type === 'CIRCLE').length, 4);
  const off = A.buildLayout({ part: { name: 'P', w: 120, h: 80 }, layout: L, ...base, crop: false, reg: false });
  assert.equal(onLayer(off, 'Marks').length, 0);
  const crop = A.buildLayout({ part: { name: 'P', w: 120, h: 80 }, layout: L, ...base, reg: false });
  assert.equal(onLayer(crop, 'Marks').length, 8);
  // a corner tick: the top-left one is at (gx0 - 25, gy0) on the sheet → y up
  const t = onLayer(on, 'Marks').find((e) => e.type === 'LINE');
  near(+pair(t, 10), L.x0 - 25); near(+pair(t, 20), 700 - L.y0);
});

test('drawing as the part: sample.dxf, copied layers and blocks, units, round trip', () => {
  const { raw, fl } = load('sample.dxf');
  const part = A.partFromDrawing('sample.dxf', raw, fl, unitFactor(fl.units));
  near(part.w, 165.9); near(part.h, 119.3);
  const L = stepRepeat({ ...base, partW: part.w, partH: part.h, sheetW: 600, sheetH: 400 });
  assert.ok(L.count > 1);
  const doc = A.buildLayout({ part, layout: L, ...base, sheetW: 600, sheetH: 400 });
  assert.equal(inserts(doc).length, L.count);
  assert.ok(doc.blocks.sample);
  // layer names ignore case: the file's SHEET is the app's Sheet
  for (const n of Object.keys(raw.layers)) assert.ok(Object.keys(doc.layers).some((k) => k.toLowerCase() === n.toLowerCase()), n);
  for (const n of ['Parts', 'Sheet', 'Marks']) assert.ok(doc.layers[n], n);
  assert.ok(raw.entities.length > 0);
  // the original is untouched
  assert.ok(raw.entities.every((e) => e === e) && !raw.blocks.sample);
  // writing and reading again gives the same insert count and layers; drawn boxes sit inside the sheet
  const text = W.writeDxf(doc, { escapeUnicode: true });
  assert.ok(/^[\x00-\x7f]*$/.test(text), 'ASCII only');
  const back = D.readDxf(text);
  assert.equal(back.entities.filter((e) => e.type === 'INSERT').length, L.count);
  for (const n of ['Parts', 'Sheet', 'Marks', ...Object.keys(raw.layers)]) assert.ok(Object.keys(back.layers).some((k) => k.toLowerCase() === n.toLowerCase()), n);
  const lower = Object.keys(back.layers).map((k) => k.toLowerCase());
  assert.equal(new Set(lower).size, lower.length, 'no two layers with the same name');
  const fb = D.flatten(back), [x0, y0, x1, y1] = fb.boxes.model;
  assert.ok(x0 >= -1e-6 && y0 >= -1e-6 && x1 <= 600 + 1e-6 && y1 <= 400 + 1e-6, [x0, y0, x1, y1].join());
  // the first copy's extents match the part's extents (min corner at the insert point)
  const one = A.buildLayout({ part, layout: { ...L, positions: [L.positions[0]], count: 1 }, ...base, sheetW: 600, sheetH: 400, crop: false, reg: false });
  const sheetless = D.flatten(one).items.filter((it) => !it.L.some((l) => ['Sheet'].includes(D.flatten(one).layers[l].name)));
  const bb = sheetless.reduce((a, it) => D.unionBox(a, it.b), null);
  near(bb[2] - bb[0], part.w, 'width'); near(bb[3] - bb[1], part.h, 'height');
  near(bb[0], L.positions[0].x, 'x'); near(bb[1], 400 - L.positions[0].y - part.h, 'y');
});

test('inch drawing: INSERT scaled to mm', () => {
  const { raw, fl } = load('inch.dxf');
  const f = unitFactor(fl.units); assert.equal(f, 25.4);
  const part = A.partFromDrawing('inch.dxf', raw, fl, f);
  const L = stepRepeat({ ...base, partW: part.w, partH: part.h });
  const doc = A.buildLayout({ part, layout: L, ...base, crop: false, reg: false });
  assert.equal(doc.header.$INSUNITS, '4');
  assert.equal(+pair(inserts(doc)[0], 41), 25.4);
  const one = A.buildLayout({ part, layout: { ...L, positions: [L.positions[0]], count: 1 }, ...base, crop: false, reg: false });
  const bb = D.flatten(one).items.filter((it) => D.flatten(one).layers[it.L[0]].name !== 'Sheet').reduce((a, it) => D.unionBox(a, it.b), null);
  near(bb[2] - bb[0], part.w); near(bb[3] - bb[1], part.h);
});

test('a drawing with no extents is not a part', () => {
  const doc = W.newDoc(); const fl = D.flatten(doc);
  assert.equal(A.partFromDrawing('x.dxf', doc, fl, 1), null);
});

test('TODO 156b1: scaled, turned and mirrored placements round-trip as INSERT scales, including inch parts', () => {
  for (const file of ['sample.dxf', 'inch.dxf']) {
    const { raw, fl } = load(file), factor = unitFactor(fl.units);
    const part = A.partFromDrawing(file, raw, fl, factor);
    const pl = { ...A.placement1('p', 300, 200, 90, true, false), sc: 2.5 };
    const { doc } = A.buildLayoutDoc({ parts: { p: part }, placed: [pl], ...base });
    const back = D.readDxf(W.writeDxf(doc)), ins = inserts(back);
    assert.equal(ins.length, 1);
    near(+pair(ins[0], 41), -factor * pl.sc); near(+pair(ins[0], 42), factor * pl.sc);
    near(+pair(ins[0], 50), pl.rot); near(+pair(ins[0], 10), pl.x); near(+pair(ins[0], 20), pl.y);
    const expected = A.placedBox(part, pl), actual = partsBox(back);
    actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-3, `${file}: saved box ${i}`));
  }
});

test('preview slots: each copy lands on its slot, its base where Apply puts the INSERT (also rotated)', () => {
  const { raw, fl } = load('sample.dxf');
  const part = A.partFromDrawing('sample.dxf', raw, fl, unitFactor(fl.units));
  for (const rotate of ['0', '90']) {
    const L = stepRepeat({ ...base, rotate, partW: part.w, partH: part.h });
    assert.ok(L.count > 1, 'rotate ' + rotate); assert.equal(!!L.rotated, rotate === '90');
    const mats = A.slotMats(part, L), ins = A.placements(L, base.sheetH);
    L.positions.forEach((p, i) => {
      const M = mats[i], [x0, y0, x1, y1] = part.box;
      const a = D.mapply(M, x0, y0), b = D.mapply(M, x1, y1);
      near(Math.min(a[0], b[0]), p.x, 'left'); near(Math.max(a[0], b[0]), p.x + L.partW, 'right');
      near(Math.min(a[1], b[1]), p.y, 'top'); near(Math.max(a[1], b[1]), p.y + L.partH, 'bottom');
      // the block's base (x0, y0) is the INSERT point, y up
      near(a[0], ins[i].x, 'insert x'); near(base.sheetH - a[1], ins[i].y, 'insert y');
    });
  }
});

test('parts from two files that share a block name: the nested reference follows the renamed block; names ignore case', () => {
  const part = (name, ents, blocks, layer) => {
    const d = W.newDoc(); for (const [n, e] of Object.entries(blocks)) W.addBlock(d, n, e);
    if (layer) W.addLayer(d, layer);
    d.entities = ents;
    return { name, raw: d, space: 0, box: [0, 0, 10, 10], w: 10, h: 10, factor: 1 };
  };
  const a = part('a', [W.insert('LOGO', 0, 0)], { LOGO: [W.line(0, 0, 1, 0)] }, 'Cut');
  const b = part('b', [W.insert('OUTER', 0, 0)], { Logo: [W.circle(0, 0, 1)], OUTER: [W.insert('logo', 0, 0)] }, 'CUT');   // 'logo': the reference differs in case from the block
  const { doc } = A.buildLayoutDoc({ parts: { a, b }, placed: [{ partId: 'a', x: 0, y: 0 }, { partId: 'b', x: 20, y: 0 }], sheetW: 100, sheetH: 100 });
  const nm = (e) => e.r.v[e.r.c.indexOf(2)];
  assert.ok(doc.blocks.Logo_2 || doc.blocks.LOGO_2, 'the clashing block (ignoring case) was renamed');
  const outer = Object.entries(doc.blocks).find(([k]) => k.toLowerCase() === 'outer')[1];
  assert.ok(/^logo_2$/i.test(nm(outer.entities[0])), 'OUTER, copied under its own name, points at the renamed block: ' + nm(outer.entities[0]));
  const back = D.readDxf(W.writeDxf(doc, { escapeUnicode: true }));
  const lay = Object.keys(back.layers).map((k) => k.toLowerCase()), blk = Object.keys(back.blocks).map((k) => k.toLowerCase());
  assert.equal(new Set(lay).size, lay.length); assert.equal(new Set(blk).size, blk.length);
});

// ---- TODO 283: an applied grid keeps a grid id and can be laid again
const LD = await import('./web/layoutdoc.js');
function appliedLayout(rows = 2, cols = 2) {
  const lay = LD.newLayout('Applied'), raw = W.newDoc(4);
  W.addEntities(raw, W.roundRect(0, 0, 100, 60, 0));
  lay.parts.p = LD.makePart('p', 'Plate', raw, 1);
  Object.assign(lay.s, { sheetW: 1000, sheetH: 700, gripTop: 0, gripBottom: 0, gripLeft: 0, gripRight: 0, fit: false, rows, cols, gapX: 5, gapY: 5, gridPart: 'p' });
  const L = A.gridLayout(lay, lay.s);
  A.bakeGrid(lay, 'a', A.gridPlacements(L, lay.s.sheetH, 'p'), L);
  return lay;
}
const xsOf = (lay) => [...new Set(lay.placed.map((p) => Math.round(p.x * 1e6) / 1e6))].sort((a, b) => a - b);

test('TODO 283: Apply keeps a grid id and the grid\'s settings and slots; every copy is on its slot', () => {
  const lay = appliedLayout();
  assert.equal(lay.placed.length, 4); assert.ok(lay.placed.every((p) => p.gid === 'a'));
  assert.deepEqual(lay.grids.a.slots.map((s) => [s.r, s.c]), [[0, 0], [0, 1], [1, 0], [1, 1]]);
  assert.deepEqual([lay.grids.a.rows, lay.grids.a.cols, lay.grids.a.gapX, lay.grids.a.gridPart], [2, 2, 5, 'p']);
  assert.deepEqual(lay.placed.map((p) => A.slotOf(lay, p)), [0, 1, 2, 3]);
  assert.equal(A.slotOf(lay, { partId: 'p', x: 1, y: 1, rot: 0 }), -1, 'a plain placement is in no grid');
  assert.equal(A.relayGrid(lay, 'none'), null);
});

test('TODO 283: Update grid: Rows 2 to 3 and a bigger gap lay six copies at the new spacing', () => {
  const lay = appliedLayout();
  Object.assign(lay.grids.a, { rows: 3, gapX: 20, gapY: 9 });
  const r = A.relayGrid(lay, 'a');
  assert.deepEqual(r, { moved: 4, added: 2, dropped: 0 });
  assert.equal(lay.placed.length, 6);
  const want = A.gridPlacements(A.gridLayout(lay, lay.grids.a), 700, 'p');
  assert.deepEqual(lay.placed.map((p) => [p.x, p.y]), want.map((p) => [p.x, p.y]), 'the copies are on the new grid, in order');
  const xs = xsOf(lay); near(xs[1] - xs[0], 120, 'gap X 20 + width 100');
  assert.equal(new Set(lay.placed.map((p) => p.y)).size, 3);
  assert.ok(lay.placed.every((p) => A.slotOf(lay, p) >= 0), 'still in the grid, so it can be updated again');
  Object.assign(lay.grids.a, { rows: 1, cols: 2 });      // Fit changing the count: the slots past it go
  assert.deepEqual(A.relayGrid(lay, 'a'), { moved: 2, added: 0, dropped: 4 });
  assert.equal(lay.placed.length, 2);
});

test('TODO 283: a copy moved or deleted by hand leaves the grid: Update keeps it where it is and its slot stays empty', () => {
  const lay = appliedLayout();
  lay.placed[0].x += 7;                          // moved by hand
  lay.placed.splice(3, 1);                       // slot (1,1) deleted
  assert.equal(A.slotOf(lay, lay.placed[0]), -1);
  const moved = { ...lay.placed[0] };
  lay.grids.a.rows = 3;
  const r = A.relayGrid(lay, 'a');
  assert.deepEqual(r, { moved: 2, added: 2, dropped: 0 });
  assert.equal(lay.placed.length, 5, 'the hand-moved copy, two laid again, two new in the third row; the deleted slot is not refilled');
  assert.deepEqual(lay.placed[0], moved, 'the moved copy stays');
  assert.ok(!lay.placed.some((p) => A.slotOf(lay, p) === lay.grids.a.slots.findIndex((s) => s.r === 1 && s.c === 1)));
  lay.grids.a.rows = 1; lay.grids.a.cols = 1;
  assert.deepEqual(A.relayGrid(lay, 'a'), { moved: 0, added: 0, dropped: 4 }, 'slot (0,0) was the moved copy\'s: empty; every other copy is past the grid and goes');
  assert.deepEqual(lay.placed.map((p) => p.x), [moved.x]);
});

test('TODO 283: nothing fits: Update changes nothing', () => {
  const lay = appliedLayout();
  lay.grids.a.rows = 400; lay.grids.a.cols = 400;         // 160000 copies: stepRepeat gives none
  const before = JSON.stringify([lay.placed, lay.grids]);
  assert.equal(A.relayGrid(lay, 'a'), null);
  assert.equal(JSON.stringify([lay.placed, lay.grids]), before);
});

test('TODO 283: the grid ids and grids are saved with the layout and read back; an old layout has none', () => {
  const lay = appliedLayout();
  const back = LD.layoutFromRaw(D.readDxf(W.writeDxf(LD.layoutRaw(lay))), 'x');
  assert.deepEqual(back.placed.map((p) => p.gid), ['a', 'a', 'a', 'a']);
  assert.deepEqual(back.grids, lay.grids);
  const old = LD.layoutFromRaw(D.readDxf(W.writeDxf(LD.layoutRaw({ ...lay, grids: {}, placed: lay.placed.map(({ gid, ...p }) => p) }))), 'x');
  assert.deepEqual(old.grids, {}); assert.ok(old.placed.every((p) => !('gid' in p)));
  assert.equal(A.slotOf(old, old.placed[0]), -1);
});

// The live grid skips cells other parts cover and lines up with a copy of the same part; the applied grid must keep exactly that
function liveApplied(loose, rows = 3, cols = 3, rest = {}) {
  const lay = LD.newLayout('Live'), mk = (id, w, h) => { const raw = W.newDoc(4); W.addEntities(raw, W.roundRect(0, 0, w, h, 0)); lay.parts[id] = LD.makePart(id, id, raw, 1); };
  mk('p', 100, 60); mk('q', 40, 700);
  Object.assign(lay.s, { sheetW: 1000, sheetH: 700, gripTop: 0, gripBottom: 0, gripLeft: 0, gripRight: 0, fit: false, rows, cols, gapX: 5, gapY: 5, gridPart: 'p', ...rest });
  lay.placed = loose.map((p) => ({ ...p }));
  const L = LD.gridOf(lay);
  A.bakeGrid(lay, 'a', A.gridPlacements(L, lay.s.sheetH, 'p'), L);
  return { lay, L };
}
const snap = (lay) => JSON.stringify([lay.placed, lay.grids]);
const hits = (lay, a, b) => { const [p, q] = [A.placedBox(lay.parts[a.partId], a), A.placedBox(lay.parts[b.partId], b)]; return p[0] < q[2] - 1e-6 && p[2] > q[0] + 1e-6 && p[1] < q[3] - 1e-6 && p[3] > q[1] + 1e-6; };

test('TODO 283: a loose part in the grid\'s way: Update with nothing changed moves and adds nothing; a new cell is not laid over it', () => {
  const loose = [A.placement1('q', 345, 0)];        // 40 mm wide: covers the whole first column of a 3 × 3 grid centred at x 345
  const { lay, L } = liveApplied(loose);
  assert.equal(L.skipped, 3, 'the live grid skipped the first column');
  assert.equal(lay.placed.length, 1 + 6);
  const before = snap(lay);
  assert.deepEqual(A.relayGrid(lay, 'a'), { moved: 0, added: 0, dropped: 0 });
  assert.equal(snap(lay), before, 'nothing changed at all');
  assert.deepEqual(lay.grids.a.slots.filter((s) => s.x == null).map((s) => [s.r, s.c]), [[0, 0], [1, 0], [2, 0]], 'the skipped cells are empty slots, numbered by the true column');
  assert.deepEqual(lay.grids.a.slots.filter((s) => s.x != null).map((s) => s.c).sort(), [1, 1, 1, 2, 2, 2]);
  lay.grids.a.rows = 4;                              // a new row: its first cell is under the loose part, the other two are free
  const r = A.relayGrid(lay, 'a');
  assert.deepEqual(r, { moved: 6, added: 2, dropped: 0 });
  assert.ok(!lay.placed.filter((p) => p.gid === 'a').some((p) => hits(lay, p, lay.placed[0])), 'no copy over the loose part');
  assert.ok(lay.grids.a.slots.some((s) => s.r === 3 && s.c === 0 && s.x == null), 'and its slot stays empty');
});

test('TODO 283: a grid lined up with an existing copy: Update with nothing changed does not shift it', () => {
  const loose = [A.placement1('p', 123, 17)];
  const { lay, L } = liveApplied(loose);
  assert.equal(L.taken, 1, 'the live grid took the existing copy as its cell');
  const free = A.gridLayout(lay, lay.s);
  assert.notDeepEqual(L.positions[0], free.positions[0], 'lined up, so not where a fresh centred grid would be');
  const before = snap(lay);
  assert.deepEqual(A.relayGrid(lay, 'a'), { moved: 0, added: 0, dropped: 0 });
  assert.equal(snap(lay), before);
  assert.ok(!lay.placed.filter((p) => p.gid === 'a').some((p) => hits(lay, p, lay.placed[0])), 'no copy over the existing one');
});

test('TODO 283: a whole column skipped at Apply keeps its numbering through a save, an Update and Update again', () => {
  const { lay } = liveApplied([A.placement1('q', 345, 0)], 2, 3);
  const cols = () => lay.grids.a.slots.filter((s) => s.x != null).map((s) => s.c).sort().join('');
  assert.equal(cols(), '1122');
  const back = LD.layoutFromRaw(D.readDxf(W.writeDxf(LD.layoutRaw(lay))), 'x');
  assert.deepEqual(back.grids.a.slots, lay.grids.a.slots, 'empty slots are saved and read back');
  const snapBack = snap(back);
  assert.deepEqual(A.relayGrid(back, 'a'), { moved: 0, added: 0, dropped: 0 }, 'unchanged after reopening too');
  assert.equal(snap(back), snapBack);
  lay.grids.a.gapY = 9;
  assert.deepEqual(A.relayGrid(lay, 'a'), { moved: 4, added: 0, dropped: 0 }, 'the four copies move, none is added to column 0');
  assert.equal(cols(), '1122');
  assert.deepEqual(A.relayGrid(lay, 'a'), { moved: 0, added: 0, dropped: 0 });
});

test('TODO 283: rows typed but not updated before the save: Update after reopen lays the grid again; an untouched grid stays put', () => {
  const { lay } = liveApplied([], 2, 3);
  const reopen = (l) => LD.layoutFromRaw(D.readDxf(W.writeDxf(LD.layoutRaw(l))), 'x');
  assert.deepEqual(A.relayGrid(reopen(lay), 'a'), { moved: 0, added: 0, dropped: 0 }, 'nothing typed: nothing moves');
  lay.grids.a.rows = 3;                              // typed, no Update, saved
  const back = reopen(lay);
  assert.equal(back.grids.a.rows, 3);
  assert.deepEqual(A.relayGrid(back, 'a'), { moved: 6, added: 3, dropped: 0 }, '2 × 3 → 3 × 3');
  assert.equal(back.placed.filter((p) => p.gid === 'a').length, 9);
});

test('TODO 283: slots past 1000 columns do not collide (key r,c)', () => {
  const lay = LD.newLayout('Wide'), raw = W.newDoc(4);
  W.addEntities(raw, W.roundRect(0, 0, 1, 1, 0));
  lay.parts.p = LD.makePart('p', 'Dot', raw, 1);
  const L = { rows: 2, cols: 1002, cells: [[0, 1000], [1, 0]] };      // (1, 0) and (0, 1000) were both key 1000
  A.bakeGrid(lay, 'a', [{ x: 1, y: 1, rot: 0 }, { x: 2, y: 2, rot: 0 }], L, { ...lay.s, extraRows: [], extraCols: [] });
  assert.equal(lay.grids.a.slots.length, 2 * 1002, 'every cell has exactly one slot');
});

test('TODO 283: a big grid (4648-ish copies) is laid again and read fast', () => {
  const lay = LD.newLayout('Big'), raw = W.newDoc(4);
  W.addEntities(raw, W.roundRect(0, 0, 10, 10, 0));
  lay.parts.p = LD.makePart('p', 'Chip', raw, 1);
  Object.assign(lay.s, { sheetW: 1000, sheetH: 700, fit: true, gapX: 2, gapY: 2, gridPart: 'p', rotate: '0' });
  const L = LD.gridOf(lay);
  assert.ok(L.count > 4000, 'count ' + L.count);
  A.bakeGrid(lay, 'a', A.gridPlacements(L, 700, 'p'), L);
  const last = lay.placed[lay.placed.length - 1];
  let t = performance.now();
  assert.equal(A.slotOf(lay, last), L.count - 1);
  const read = performance.now() - t;
  assert.ok(read < 5, 'a state read with the last copy selected: ' + read + ' ms');
  t = performance.now();
  assert.deepEqual(A.relayGrid(lay, 'a'), { moved: 0, added: 0, dropped: 0 });
  const same0 = performance.now() - t;
  lay.grids.a.gapX = 3;
  t = performance.now();
  const r = A.relayGrid(lay, 'a');
  const dt = performance.now() - t;
  assert.ok(r.moved > 3000 && r.dropped > 0, JSON.stringify(r));
  assert.ok(dt < 500, 'relayGrid ' + dt + ' ms (unchanged ' + same0 + ' ms)');
  // The first read after a relay rebuilds the slot map once; the best of three reads is the steady cost (a parallel test run can stall one read).
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    t = performance.now();
    A.slotOf(lay, lay.placed[lay.placed.length - 1]);
    best = Math.min(best, performance.now() - t);
  }
  assert.ok(best < 5, 'a state read after the relay: best ' + best + ' ms');
});
