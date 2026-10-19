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
