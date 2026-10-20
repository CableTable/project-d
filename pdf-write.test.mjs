// pdf-write.js and pdf-export.js — the file's structure, page sizes, mirror, separations, tiles, text, no NaN.   node pdf-write.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs');
const D = await import('./web/drawing.js');
const P = await import('./web/pdf-write.js');
const X = await import('./web/pdf-export.js');
const { unitFactor, startHidden, shownItems, itemVisible } = await import('./web/doc.js');

const near = (a, b, tol = 1e-3, m = '') => assert.ok(Math.abs(a - b) <= tol, `${m} ${a} !~ ${b}`);
const load = (f) => { const raw = D.readDxf(D.decodeDxf(fs.readFileSync('fixtures/' + f))); const fl = D.flatten(raw); return { raw, fl }; };
const srcOf = (f, extra = {}) => {
  const { fl } = load(f);
  return { fl, factor: unitFactor(fl.units), off: startHidden(fl), sheetW: 1000, sheetH: 700, name: f.replace(/\.dxf$/, ''), date: '17-10-2026', ...extra };
};
const text = (bytes) => Buffer.from(bytes).toString('latin1');
const mediaBoxes = (t) => [...t.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
const content = (t, i) => [...t.matchAll(/stream\n([\s\S]*?)endstream/g)].map((m) => m[1])[i];
const pagesOf = (plan) => plan.pages.map((_, i) => plan.build(i));

test('contour DASHED and DOT print with colour and dash patterns before and after DXF save', async () => {
  const W = await import('./web/dxf-write.js');
  for (const defined of [false, true]) {
    const raw = W.newDoc(); W.addLayer(raw, 'Contour', { aci: 3 });
    if (defined) raw.ltypes = { DASHED: { pattern: [7, -4] }, DOT: { pattern: [0, -4] } };
    raw.entities = [W.line(10, 10, 50, 10, { layer: 'Contour', aci: 1, lt: 'DASHED' }),
      W.line(10, 20, 50, 20, { layer: 'Contour', aci: 1, lt: 'DOT' })];
    for (const doc of [raw, D.readDxf(W.writeDxf(raw))]) {
      const fl = D.flatten(doc);
      const plan = X.planPdf({ fl, factor: 1, off: new Set(), sheetW: 100, sheetH: 100 }, { page: 'sheet', separate: false, black: false });
      const cmds = plan.build(0).cmds;
      assert.ok(cmds.some((c) => c[0] === 'd' && c[1].length === 2 && c[1][0] > c[1][1]), 'dashes');
      assert.ok(cmds.some((c) => c[0] === 'd' && c[1].length === 2 && c[1][0] < c[1][1]), 'dots');
      assert.ok(text(plan.bytes()).includes('1 0 0 RG'), 'red ink');
    }
  }
});

test('structure: header, objects, xref offsets, trailer, page count', () => {
  const plan = X.planPdf(srcOf('sample.dxf'), { page: 'sheet', separate: true });
  const t = text(plan.bytes());
  assert.ok(t.startsWith('%PDF-1.4\n'));
  assert.ok(t.endsWith('%%EOF\n'));
  const xrefAt = Number(t.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(t.slice(xrefAt, xrefAt + 4), 'xref');
  const size = Number(t.match(/\/Size (\d+)/)[1]);
  const lines = t.slice(xrefAt).split('\n').slice(2, 2 + size);           // "0000000000 65535 f " then the objects
  assert.equal(lines.length, size);
  assert.equal(lines[0], '0000000000 65535 f ');
  lines.slice(1).forEach((l, i) => {
    assert.equal(l.length, 19);
    const at = Number(l.slice(0, 10));
    assert.ok(t.startsWith(`${i + 1} 0 obj\n`, at), `object ${i + 1} is at ${at}`);
  });
  assert.equal(Number(t.match(/\/Count (\d+)/)[1]), plan.count);
  assert.equal((t.match(/\/Type \/Page /g) || []).length, plan.count);
  // each stream's /Length is its real length
  for (const m of t.matchAll(/\/Length (\d+)>>\nstream\n([\s\S]*?)endstream/g)) assert.equal(Number(m[1]), m[2].length);
  for (const m of t.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream/g)) assert.equal(Number(m[1]), m[2].length);
  assert.ok(/^[\x00-\x7f]*$/.test(t.slice(t.indexOf('2 0 obj'))), 'ASCII after the header');
});

test('1:1: the MediaBox is the sheet in points, exactly', () => {
  for (const [w, h] of [[1000, 700], [297, 210], [1189, 841], [123.456, 78.9]]) {
    const plan = X.planPdf(srcOf('sample.dxf', { sheetW: w, sheetH: h }), { page: 'sheet', separate: false });
    const [bw, bh] = mediaBoxes(text(plan.bytes()))[0];
    near(bw / P.MM, w, 0.001, 'width'); near(bh / P.MM, h, 0.001, 'height');
  }
  near(P.MM * 25.4, 72, 1e-9);
});

test('the same input gives the same bytes', () => {
  const a = X.planPdf(srcOf('sample.dxf'), {}).bytes(), b = X.planPdf(srcOf('sample.dxf'), {}).bytes();
  assert.deepEqual(a, b);
});

test('no NaN or Infinity in any mode, on any fixture', () => {
  for (const f of ['sample.dxf', 'inch.dxf', 'many-layers.dxf']) {
    for (const page of ['sheet', 'tile', 'check']) for (const mirror of [false, true]) for (const negative of [false, true]) for (const separate of [false, true]) {
      const t = text(X.planPdf(srcOf(f), { page, mirror, negative, separate }).bytes());
      assert.ok(!/NaN|Infinity|undefined|e\+|e-\d/.test(t), `${f} ${page} ${mirror} ${negative} ${separate}`);
    }
  }
});

test('mirror flips x across the sheet width', () => {
  const src = srcOf('sample.dxf', { sheetW: 400 });
  const o = { page: 'sheet', separate: false, strip: false, crop: false, reg: false, black: true };
  const plain = X.planPdf(src, { ...o, mirror: false }).build(0), flipped = X.planPdf(src, { ...o, mirror: true }).build(0);
  const pts = (pg) => pg.cmds.filter((c) => c[0] === 'm' || c[0] === 'l').map((c) => [c[1], c[2]]);
  const a = pts(plain), b = pts(flipped);
  assert.equal(a.length, b.length); assert.ok(a.length > 20);
  a.forEach((p, i) => { near(b[i][0], 400 - p[0], 1e-9); near(b[i][1], p[1], 1e-9); });
  assert.notEqual(text(X.planPdf(src, { ...o, mirror: false }).bytes()), text(X.planPdf(src, { ...o, mirror: true }).bytes()));
});

test('mirror also mirrors the text matrix (the page is one mirrored film)', () => {
  const src = srcOf('sample.dxf');
  const a = X.planPdf(src, { page: 'sheet', separate: false, mirror: false, strip: true }).build(0).cmds.filter((c) => c[0] === 'T');
  const b = X.planPdf(src, { page: 'sheet', separate: false, mirror: true, strip: true }).build(0).cmds.filter((c) => c[0] === 'T');
  assert.equal(a.length, b.length); assert.ok(a.length > 0);
  assert.ok(a.every((c) => c[1][0] > 0)); assert.ok(b.every((c) => c[1][0] < 0));
});

test('separations: one page per layer with something on it, each named, in black', () => {
  const src = srcOf('sample.dxf');
  const plan = X.planPdf(src, { page: 'sheet', separate: true, black: false, crop: true, reg: true });
  const shown = shownItems(src.fl).filter((it) => itemVisible(it, src.off));
  const names = src.fl.layers.filter((l, i) => shown.some((it) => it.L[0] === i)).map((l) => l.name);
  assert.deepEqual(plan.pages.map((p) => p.layer), names);
  assert.equal(plan.count, names.length);
  const one = X.planPdf(src, { page: 'sheet', separate: false });
  assert.equal(one.count, 1);
  const black = X.planPdf(src, { page: 'sheet', separate: true, black: true, crop: true, reg: true });
  for (const pg of pagesOf(black)) for (const c of pg.cmds) if (c[0] === 'RG' || c[0] === 'rg') assert.deepEqual(c.slice(1), [0, 0, 0]);
  // with colours on, some layer prints in colour
  assert.ok(pagesOf(plan).some((pg) => pg.cmds.some((c) => c[0] === 'RG' && (c[1] !== c[2] || c[2] !== c[3]))));
  // every page carries the marks and its own layer name in the strip
  const t = text(black.bytes());
  names.forEach((n, i) => assert.ok(content(t, i).includes(`(sample \\267 17-10-2026 \\267 ${n.toUpperCase()} \\267 ${i + 1}/${names.length})`), n));
  const mk = (pg) => pg.cmds.filter((c) => c[0] === 'c').length;
  assert.ok(pagesOf(black).every((pg) => mk(pg) >= 16), 'registration circles on every page');
  // hidden layers are left out
  const hid = new Set([...src.off, 0]);
  assert.equal(X.planPdf({ ...src, off: hid }, { separate: true }).count, names.length - (names.includes(src.fl.layers[0].name) ? 1 : 0));
});

test('layers named in hide are not artwork', () => {
  const src = srcOf('sample.dxf');
  const all = X.planPdf(src, { separate: true }).pages.map((p) => p.layer);
  const some = X.planPdf({ ...src, hide: [all[0].toLowerCase()] }, { separate: true }).pages.map((p) => p.layer);
  assert.deepEqual(some, all.slice(1));
});

test('negative: a black page, white art, white marks', () => {
  const pg = X.planPdf(srcOf('sample.dxf'), { page: 'sheet', separate: false, negative: true, black: true }).build(0);
  assert.deepEqual(pg.cmds.slice(0, 5).map((c) => c[0]), ['rg', 'm', 'l', 'l', 'l']);
  assert.deepEqual(pg.cmds[0].slice(1), [0, 0, 0]);
  const strokes = pg.cmds.filter((c) => c[0] === 'RG');
  assert.ok(strokes.length > 0 && strokes.every((c) => c[1] === 1 && c[2] === 1 && c[3] === 1));
});

test('tiling: the page count follows the sheet and the paper; every tile has a label and an overlap', () => {
  const g = X.tileGrid(1000, 700, 420, 297), gp = X.tileGrid(1000, 700, 297, 420);
  assert.deepEqual([g.cols, g.rows], [3, 3]);                              // 404 × 281 tiles, 10 mm overlap: ceil(990 / 394) = 3, ceil(690 / 271) = 3
  assert.deepEqual([gp.cols, gp.rows], [4, 2]);                            // portrait: 8 tiles, fewer, so it is chosen
  assert.deepEqual(X.tileGrid(400, 280, 420, 297), { tw: 404, th: 281, cols: 1, rows: 1 });
  const src = srcOf('sample.dxf');
  const plan = X.planPdf(src, { page: 'tile', tilePaper: 'A3', separate: false });
  assert.equal(plan.count, 8);
  const [bw, bh] = mediaBoxes(text(plan.bytes()))[0];
  near(bw / P.MM, 297); near(bh / P.MM, 420);
  assert.deepEqual([plan.pages[4].tile.col, plan.pages[4].tile.row], [1, 2]);
  assert.ok(content(text(plan.bytes()), 4).includes('Tile 5/8'));
  // A4 landscape: 4 across and 4 down (portrait would be 6 × 3 = 18)
  assert.equal(X.planPdf(src, { page: 'tile', tilePaper: 'A4', separate: false }).count, 16);
  // separations multiply the tiles
  assert.equal(X.planPdf(src, { page: 'tile', separate: true }).count, 8 * X.planPdf(src, { page: 'sheet', separate: true }).count);
  // adjacent tiles overlap by 10 mm: tile 2 starts 10 mm before tile 1 ends
  const a = plan.pages[0]._geo.tile, b = plan.pages[1]._geo.tile;
  near(a.x0 + a.tw - b.x0, X.TILE.overlap);
  // the first row is the sheet's top, the last tile reaches the bottom
  near(plan.pages[0]._geo.tile.y0 + a.th, 700);
  assert.ok(plan.pages[7]._geo.tile.y0 <= 0);
  // a sheet that fits is one tile
  assert.equal(X.planPdf(srcOf('sample.dxf', { sheetW: 300, sheetH: 200 }), { page: 'tile', separate: false }).count, 1);
});

test('check print: fitted to the paper at a stated scale, with a title block', () => {
  const f = X.checkFit(1000, 700, 297, 210);
  near(f.s, Math.min((297 - 20) / 1000, (210 - 20 - 22) / 700));
  assert.equal(X.scaleText(0.25), '1 : 4'); assert.equal(X.scaleText(1 / 3), '1 : 3'); assert.equal(X.scaleText(0.2976), '1 : 3.36'); assert.equal(X.scaleText(2), '2 : 1');
  const plan = X.planPdf(srcOf('sample.dxf'), { page: 'check', checkPaper: 'A4', separate: false, mirror: true, negative: true });
  assert.equal(plan.count, 1);
  const [bw, bh] = mediaBoxes(text(plan.bytes()))[0];
  near(bw / P.MM, 297); near(bh / P.MM, 210);
  const c = content(text(plan.bytes()), 0);
  assert.ok(c.includes('(Scale 1 : ') && c.includes('Check print'));
  assert.equal(plan.pages[0].scale, X.checkFit(1000, 700, 297, 210).s);
  // film options do not apply to a check print: no black page
  assert.notEqual(plan.build(0).cmds[0][0], 'rg');
  // a tall sheet goes on a portrait page
  const tall = X.planPdf(srcOf('sample.dxf', { sheetW: 300, sheetH: 900 }), { page: 'check', separate: false }).pages[0];
  assert.ok(tall.h > tall.w);
});

test('text: escaping, WinAnsi, widths', () => {
  assert.equal(P.pdfString(P.winAnsi('a (b) c\\d')), '(a \\(b\\) c\\\\d)');
  assert.equal(P.pdfString(P.winAnsi('Ø12 ± 0.1° é')), '(\\330' + '12 \\261 0.1\\260 \\351)');
  assert.equal(P.winAnsi('⌀6'), 'Ø6');
  assert.equal(P.winAnsi('ā'), 'a');
  assert.equal(P.winAnsi('日本'), '??');
  assert.equal(P.winAnsi('€'), '\x80');
  assert.equal(P.winAnsi('a\tb\nc'), 'a b c');
  near(P.textWidthEm('Hello'), (722 + 556 + 222 + 222 + 556) / 1000, 1e-9);
  // a drawing's text with parentheses stays a valid string
  const pg = new P.Page(100, 100);
  pg.text([3, 0, 0, 3, 5, 5], P.winAnsi('R(5) \\ end'));
  const t = text(P.writePdf([pg]));
  assert.ok(t.includes('(R\\(5\\) \\\\ end) Tj'));
  assert.equal(P.num(NaN), '0'); assert.equal(P.num(-0.00001), '0'); assert.equal(P.num(1.23456789, 3), '1.235');
});

test('arcs and circles are Béziers that stay on the circle', () => {
  // a DXF circle of radius 50 at 100,100, no marks: 4 curves, every end point 50 from the centre
  const doc = D.readDxf('0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\n0\n10\n100\n20\n100\n40\n50\n0\nENDSEC\n0\nEOF\n');
  const fl = D.flatten(doc);
  const plan = X.planPdf({ fl, factor: 1, off: new Set(), sheetW: 300, sheetH: 300, name: 'c', date: '' }, { page: 'sheet', separate: false, strip: false, crop: false, reg: false, mirror: false });
  const cs = plan.build(0).cmds.filter((c) => c[0] === 'c');
  assert.equal(cs.length, 4);
  for (const c of cs) near(Math.hypot(c[5] - 100, c[6] - 100), 50, 1e-9);
});

test('independent check with pdfjs-dist: page count and size', async () => {
  let pdfjs;
  try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); } catch { return; }
  const plan = X.planPdf(srcOf('sample.dxf'), { page: 'tile', tilePaper: 'A3', separate: true });
  const doc = await pdfjs.getDocument({ data: plan.bytes(), verbosity: 0 }).promise;
  assert.equal(doc.numPages, plan.count);
  const pg = await doc.getPage(1);
  const [x0, y0, x1, y1] = pg.view;
  near((x1 - x0) / P.MM, 297, 0.01); near((y1 - y0) / P.MM, 420, 0.01);
  const tc = await (await doc.getPage(1)).getTextContent();
  assert.ok(tc.items.some((it) => /Tile 1\/8 /.test(it.str)), 'label text is readable');
  const one = await pdfjs.getDocument({ data: X.planPdf(srcOf('sample.dxf'), { page: 'sheet', separate: false }).bytes(), verbosity: 0 }).promise;
  const v = (await one.getPage(1)).view;
  near((v[2] - v[0]) / P.MM, 1000, 0.01); near((v[3] - v[1]) / P.MM, 700, 0.01);
});

// ---- the Part screen's PDF: the drawing and its dimensions on a page of their own
const E = await import('./web/edit.js');
const withDim = () => {
  const { raw } = load('outline.dxf');
  const dim = E.makeDimension([50, 20], [80, 40], 1, raw.blocks), next = E.addDimension(raw, dim);
  const doc = { ...raw, entities: next.entities, blocks: next.blocks };
  return { fl: D.flatten(doc), doc };
};
const partSrc = (extra = {}) => { const { fl } = withDim(); return X.partSource({ fl, factor: 1, off: new Set(), name: 'part', date: '17-10-2026', ...extra }); };
const PTS = 72 / 25.4;

test('part: the source is the drawing\'s box plus a 10 mm border, its corner at the border', () => {
  const s = partSrc();
  near(s.sheetW, 156, 1e-6); near(s.sheetH, 80, 0.5);                       // -20 … 116 by 0 … 60 (the dimension text is inside that)
  near(s.origin[0], -30, 1e-6);
  assert.equal(s.part, true);
  assert.equal(X.partSource({ fl: { items: [], layers: [] }, factor: 1 }), null);
  // hidden layers are not in it
  const { fl } = withDim(), dimLayer = fl.layers.findIndex((l) => l.name === 'Dimensions');
  const without = X.partSource({ fl, factor: 1, off: new Set([dimLayer]) }), full = X.partSource({ fl, factor: 1, off: new Set() });
  assert.ok(without.sheetH <= full.sheetH);
});

test('part, page cut to the part at 1:1: the MediaBox is the part plus the border, one page, no film options needed', () => {
  const s = partSrc(), plan = X.planPdf(s, { page: 'sheet', separate: false, mirror: false, crop: false, reg: false, strip: false, black: true });
  assert.equal(plan.count, 1);
  const [mb] = mediaBoxes(text(plan.bytes()));
  near(mb[0], s.sheetW * PTS, 0.01); near(mb[1], s.sheetH * PTS, 0.01);
  near(plan.box[0], 10, 1e-6); near(plan.box[1], 10, 0.5);                  // the art starts at the border
});

test('part: the dimension (its number too) is on the page; the page has no sheet outline and nothing of a layout', () => {
  const plan = X.planPdf(partSrc(), { page: 'sheet', separate: false, mirror: false, crop: false, reg: false, strip: false, black: true });
  const c = content(text(plan.bytes()), 0);
  assert.match(c, /\(36\.06\) Tj/);
  const layoutPlan = X.planPdf(srcOf('outline.dxf'), { page: 'sheet', separate: false, mirror: false, crop: false, reg: false, strip: false });
  assert.ok(!/\(36\.06\)/.test(content(text(layoutPlan.bytes()), 0)));
});

test('part, tiled 1:1: a small part is one tile; a big one is many, each labelled, on A4 or A3', () => {
  assert.equal(X.planPdf(partSrc(), { page: 'tile', tilePaper: 'A4', separate: false }).count, 1);
  const big = { ...partSrc(), sheetW: 1189, sheetH: 841 };
  const a4 = X.planPdf(big, { page: 'tile', tilePaper: 'A4', separate: false }), a3 = X.planPdf(big, { page: 'tile', tilePaper: 'A3', separate: false });
  assert.ok(a4.count > a3.count && a3.count > 1, `${a4.count} A4 pages, ${a3.count} A3 pages`);
  assert.ok(a4.pages.every((p) => p.tile && p.w >= 210));
  const t = text(a3.bytes());
  assert.match(t, /Tile 1\/\d+/);
  assert.equal(mediaBoxes(t).length, a3.count);
});

test('part, scaled to fit one page: A4 / A3 / A0, labelled not 1:1 with its scale', () => {
  const big = { ...partSrc(), sheetW: 1189, sheetH: 841, name: 'big' };
  for (const [paper, wide] of [['A4', 297], ['A3', 420], ['A0', 1189]]) {
    const plan = X.planPdf(big, { page: 'check', checkPaper: paper, separate: false });
    assert.equal(plan.count, 1);
    const [mb] = mediaBoxes(text(plan.bytes()));
    near(mb[0], wide * PTS, 0.01, paper);
    const t = content(text(plan.bytes()), 0);
    assert.match(t, /NOT 1:1/, paper + ' labelled');
    assert.match(t, /\(Fitted to one page: not 1:1/);
  }
  // A4 fits the 1189 × 841 mm part at about 1 : 4, and A0 at 1 : 1 less the margins
  assert.ok(X.planPdf(big, { page: 'check', checkPaper: 'A4', separate: false }).pages[0].scale < 0.3);
  assert.ok(X.planPdf(big, { page: 'check', checkPaper: 'A0', separate: false }).pages[0].scale > 0.9);
});

test('a sheet over 200 in gets /UserUnit and a PDF 1.6 header with the same physical size; normal sheets stay PDF 1.4', () => {
  const big = new P.Page(6000, 1000), small = new P.Page(420, 297);
  big.moveTo(0, 0); big.lineTo(6000, 0); big.stroke();
  const t = text(P.writePdf([big, small]));
  assert.ok(t.startsWith('%PDF-1.6\n'));
  assert.ok(/\/UserUnit 2 /.test(t) && (t.match(/UserUnit/g) || []).length === 1);
  const [b, s] = mediaBoxes(t);
  near(b[0] * 2 / P.MM, 6000, 0.01, 'physical width'); near(s[0] / P.MM, 420, 0.01);
  assert.ok(b[0] <= 14400 && b[1] <= 14400);
  assert.ok(text(P.writePdf([small])).startsWith('%PDF-1.4\n'));
});

test('freePdfName: never a name that is taken (in this run or on disk)', async () => {
  const onDisk = new Set(['bracket.pdf', 'bracket (2).pdf']);
  assert.equal(await X.freePdfName('bracket', async (n) => onDisk.has(n)), 'bracket (3).pdf');
  assert.equal(await X.freePdfName('other', async (n) => onDisk.has(n)), 'other.pdf');
});
