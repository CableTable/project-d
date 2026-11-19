// pdf-read.js — a vector PDF as a drawing.   node pdf-read.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs');
const R = await import('./web/pdf-read.js');
const D = await import('./web/drawing.js');
const E = await import('./web/edit.js');
const W = await import('./web/dxf-write.js');
const P = await import('./web/pdf-write.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const F = await import('./web/fill.js');
const C = await import('./web/colour.js');

const near = (a, b, m, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps * (1 + Math.abs(b)), `${m || ''} ${a} !~ ${b}`);
const read = () => R.readPdf(new Uint8Array(fs.readFileSync('fixtures/vector.pdf')), { pdfjs });
const pdfPath = (codes, coords, paint = pdfjs.OPS.stroke) => R.pdfToDoc({ ops: {
  fnArray: [pdfjs.OPS.constructPath, paint], argsArray: [[codes, coords], null],
} }, pdfjs.OPS);

const colourDoc = (...operations) => R.pdfToDoc({ ops: {
  fnArray: operations.map(([name]) => pdfjs.OPS[name]), argsArray: operations.map(([, args = null]) => args),
} }, pdfjs.OPS).doc;
const triangle = ['constructPath', [[pdfjs.OPS.moveTo, pdfjs.OPS.lineTo, pdfjs.OPS.lineTo], [0, 0, 20, 0, 20, 20]]];

test('TODO 300: stroke, fill and fill+stroke keep colours on first-seen ByLayer outlines', () => {
  const doc = colourDoc(['setStrokeRGBColor', new Uint8ClampedArray([255, 0, 0])], triangle, ['stroke'],
    ['setFillRGBColor', [0, 255, 0]], triangle, ['fill'], triangle, ['fillStroke'],
    ['setFillRGBColor', [255, 255, 255]], triangle, ['fill']);
  assert.deepEqual(Object.keys(doc.layers), ['#FF0000', '#00FF00', '#FFFFFF']);
  assert.deepEqual(Object.values(doc.layers).map((l) => [l.aci, l.tc]), [[1, null], [3, null], [7, 0xffffff]]);
  assert.deepEqual(doc.entities.map((e) => [e.layer, e.aci, e.tc, e.fill]), [
    ['#FF0000', 256, null, undefined], ['#00FF00', 256, null, 'aci:3'],
    ['#FF0000', 256, null, 'aci:3'], ['#FFFFFF', 256, null, 'tc:16777215'],
  ]);
  assert.deepEqual(doc.entities.map(F.closedOutline), [false, true, true, true]);
  for (const raw of [doc, D.readDxf(W.writeDxf(doc))]) {
    const white = D.flatten(raw).items.filter((it) => it.css === '#ffffff');
    assert.equal(white.length, 2, 'white fill and outline both survive');
    assert.ok(white.every((it) => it.exact), 'true-colour white must not turn black in the light theme');
  }
});

test('TODO 300: q/Q and form scopes restore stroke and fill; gray, CMYK and sc/scn components', () => {
  const doc = colourDoc(['setStrokeGray', [0.5]], triangle, ['stroke'], ['save'],
    ['setStrokeCMYKColor', [0, 1, 1, 0]], ['setFillGray', [0.25]], triangle, ['fillStroke'], ['restore'], triangle, ['fillStroke'],
    ['paintFormXObjectBegin', [null]], ['setFillCMYKColor', [1, 0, 0, 0]], triangle, ['fill'], ['paintFormXObjectEnd'], triangle, ['fill'],
    ['setStrokeColor', [0, 1, 0]], triangle, ['stroke'], ['setFillColorN', [0, 0, 0, 0]], triangle, ['fill'],
    ['setStrokeColorN', [0.75]], triangle, ['stroke']);
  assert.deepEqual(doc.entities.map((e) => e.layer), ['#808080', '#FF0000', '#808080', '#00FFFF', '#000000', '#00FF00', '#FFFFFF', '#BFBFBF']);
  assert.deepEqual(doc.entities.slice(1, 5).map((e) => e.fill), [C.rgbKey([64, 64, 64]), 'tc:0', 'aci:4', 'tc:0']);
});

const circlePath = (radius) => {
  const k = radius * 0.5522847498, { moveTo: m, curveTo: c } = pdfjs.OPS;
  return { codes: [m, c, c, c, c], coords: [radius, 0, radius, k, k, radius, 0, radius,
    -k, radius, -radius, k, -radius, 0, -radius, -k, -k, -radius, 0, -radius, k, -radius, radius, -k, radius, 0] };
};
test('TODO 300: a filled circle stays one closed shape within 0.01 mm of its cubic', () => {
  const { codes, coords } = circlePath(1000), { doc } = pdfPath(codes, coords, pdfjs.OPS.fill);
  assert.equal(doc.entities.length, 1);
  assert.ok(F.closedOutline(doc.entities[0])); assert.equal(doc.entities[0].fill, 'tc:0');
  const boundary = F.boundary(doc.entities[0]), k = 0.5522847498;
  for (let i = 1; i < 97; i++) {
    const t = i / 97, u = 1 - t;
    const p = [u ** 3 + 3 * u * u * t + 3 * u * t * t * k, 3 * u * u * t * k + 3 * u * t * t + t ** 3].map((n) => n * 1000 * R.PT);
    assert.ok(F.edgeDist(p, boundary) <= 0.01, 'curve to outline distance at ' + t);
  }
});
test('TODO 300: compound fill and eoFill keep a ring hole, including after Save to DXF', () => {
  const outer = circlePath(50), inner = circlePath(20);
  for (const paint of [pdfjs.OPS.fill, pdfjs.OPS.eoFill, pdfjs.OPS.eoFillStroke]) {
    const { doc } = pdfPath([...outer.codes, ...inner.codes], [...outer.coords, ...inner.coords], paint);
    assert.equal(doc.entities.length, 2); assert.ok(doc.entities.every(F.closedOutline));
    for (const raw of [doc, D.readDxf(W.writeDxf(doc))]) {
      assert.equal(raw.entities.length, 2); assert.equal(raw.entities[0].fill, 'tc:0');
      const fills = D.flatten(raw).items.filter((it) => it.attachedFill);
      assert.equal(fills.length, 1, 'inner subpath must not paint over the hole');
      assert.equal(F.containsFill(fills[0].ops, [0, 0]), false);
      assert.equal(F.containsFill(fills[0].ops, [30 * R.PT, 0]), true);
    }
  }
});
test('TODO 300: text follows its fill colour and first-seen layer, including a mixed-colour text item', () => {
  const { OPS } = pdfjs, glyph = (unicode) => ({ unicode, width: 500 });
  const { doc } = R.pdfToDoc({ ops: {
    fnArray: [OPS.setFillRGBColor, OPS.showText, OPS.save, OPS.setFillRGBColor, OPS.showText, OPS.restore, OPS.showText, OPS.constructPath, OPS.stroke],
    argsArray: [[255, 0, 0], [[glyph('A')]], null, [0, 0, 255], [[glyph('B')]], null, [[glyph('C')]], triangle[1], null],
  }, text: [{ str: 'ABC', width: 30, transform: [10, 0, 0, 10, 0, 0] }] }, OPS);
  assert.deepEqual(Object.keys(doc.layers), ['#FF0000', '#0000FF', '#000000']);
  assert.deepEqual(D.flatten(doc).layers.map((l) => l.name), Object.keys(doc.layers), 'displayed layers also follow first-seen paint order');
  assert.deepEqual(doc.entities.filter((e) => e.type === 'TEXT').map((e) => [e.r.v[e.r.c.indexOf(1)], e.layer]),
    [['A', '#FF0000'], ['B', '#0000FF'], ['C', '#FF0000']]);
});
test('TODO 300: non-PDF Illustrator bytes are rejected by the unchanged signature check', () => {
  assert.equal(R.isPdf(new TextEncoder().encode('%!PS-Adobe-3.0\n%%Creator: Illustrator')), false);
  assert.equal(R.isPdf(new TextEncoder().encode('prefix%PDF-1.6')), false);
});

const colourPdf = (content) => {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 140 110] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += 'xref\n0 5\n0000000000 65535 f \n' + offsets.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  return new TextEncoder().encode(pdf + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
};
test('TODO 300: real PDF colours use pdf.js byte RGB arguments; filled shapes round-trip', async () => {
  const bytes = colourPdf('1 0 0 RG\n10 10 m 110 10 l S\n0 1 0 rg\n10 30 m 50 30 l 50 60 l f\nq\n0 0 1 RG\n70 30 40 30 re B\nQ\n10 80 m 110 80 l S\n');
  const { doc } = await R.readPdf(bytes, { pdfjs });
  assert.deepEqual(Object.keys(doc.layers), ['#FF0000', '#00FF00', '#0000FF']);
  assert.deepEqual(doc.entities.map((e) => [e.layer, e.fill]), [
    ['#FF0000', undefined], ['#00FF00', 'aci:3'], ['#0000FF', 'aci:3'], ['#FF0000', undefined],
  ]);
  const back = D.readDxf(W.writeDxf(doc));
  assert.deepEqual(back.entities.map((e) => [e.layer, e.fill]), doc.entities.map((e) => [e.layer, e.fill]));
});

test('TODO 300: real g/G, k/K and sc/scn operators normalize into coloured outlines', async () => {
  const bytes = colourPdf('0.5 G 0 0 m 20 0 l S\n0.25 g 0 0 20 20 re f\n0 0 0 0 K 0 30 m 20 30 l S\n1 1 1 1 k 30 0 20 20 re f\n/DeviceRGB CS 0 1 0 SC 0 40 m 20 40 l S\n/DeviceRGB cs 0 0 1 scn 60 0 20 20 re f\n');
  const { doc } = await R.readPdf(bytes, { pdfjs });
  // DeviceCMYK is already converted by pdf.js's colour profile before the operator list reaches us.
  assert.deepEqual(doc.entities.map((e) => e.layer), ['#808080', '#404040', '#FFFFFF', '#06060C', '#00FF00', '#0000FF']);
  assert.deepEqual(doc.entities.filter((e) => e.fill).map((e) => e.fill), [C.rgbKey([64, 64, 64]), C.rgbKey([6, 6, 12]), 'aci:5']);
});

test('TODO 272a: three contiguous lines become one open polyline, even back at the start', () => {
  const { moveTo: m, lineTo: l } = pdfjs.OPS;
  const { doc, paths } = pdfPath([m, l, l, l], [0, 0, 10, 0, 10, 10, 0, 0]);
  assert.equal(paths, 1);
  assert.deepEqual(doc.entities, [W.lwpoly([[0, 0], [10 * R.PT, 0], [10 * R.PT, 10 * R.PT], [0, 0]], { layer: '#000000' })]);
});

test('TODO 272a: h closes joined lines; fills keep their colour and paint operations stay separate', () => {
  const { moveTo: m, lineTo: l, closePath: h, fill, stroke, constructPath } = pdfjs.OPS;
  const { doc, paths } = pdfPath([m, l, l, h], [0, 0, 10, 0, 10, 10], fill);
  assert.equal(paths, 1);
  assert.deepEqual(doc.entities, [W.lwpoly([[0, 0], [10 * R.PT, 0], [10 * R.PT, 10 * R.PT]], { closed: true, layer: '#000000', fill: 'tc:0' })]);
  const separate = R.pdfToDoc({ ops: { fnArray: [constructPath, stroke, constructPath, stroke],
    argsArray: [[[m, l], [0, 0, 10, 0]], null, [[m, l], [10, 0, 20, 0]], null] } }, pdfjs.OPS);
  assert.equal(separate.paths, 2);
});

test('TODO 272a fix: m l l l(start) h closes without a repeated point', async () => {
  const { moveTo: m, lineTo: l, closePath: h } = pdfjs.OPS;
  const { doc, paths } = pdfPath([m, l, l, l, h], [0, 0, 10, 0, 10, 10, 0, 0]);
  assert.equal(paths, 1);
  assert.deepEqual(doc.entities, [W.lwpoly([[0, 0], [10 * R.PT, 0], [10 * R.PT, 10 * R.PT]], { closed: true, layer: '#000000' })]);
  const r = (await import('./web/modify.js')).offsetEntity(doc.entities[0], 0.5, [3, 1]);
  assert.ok(!r.error, r.error);
});

test('TODO 272a: move gaps within 1e-6 mm join; larger gaps split the chain', () => {
  const { moveTo: m, lineTo: l } = pdfjs.OPS;
  for (const [gap, count] of [[0.5e-6, 1], [2e-6, 2]]) {
    const { doc, paths } = pdfPath([m, l, m, l], [0, 0, 10, 0, 10 + gap / R.PT, 0, 20, 0]);
    assert.equal(paths, count);
    assert.equal(doc.entities.length, count);
    assert.ok(doc.entities.every((e) => e.type === 'LWPOLYLINE'));
    near(D.flatten(doc).boxes.model[2], 20 * R.PT);
  }
});

test('TODO 272a: line-arc-line emits polyline, ARC, polyline; h never closes across the arc', () => {
  const { moveTo: m, lineTo: l, curveTo: c, closePath: h } = pdfjs.OPS, K = 0.5522847498;
  const coords = [20, 0, 10, 0, 10, 10 * K, 10 * K, 10, 0, 10, 0, 20];
  for (const close of [false, true]) {
    const { doc, paths } = pdfPath([m, l, c, l, ...(close ? [h] : [])], coords);
    assert.equal(paths, 3);
    assert.deepEqual(doc.entities.map((e) => e.type), ['LWPOLYLINE', 'ARC', 'LWPOLYLINE']);
    assert.equal(+doc.entities[2].r.v[doc.entities[2].r.c.indexOf(70)], 0);
    assert.deepEqual(doc.entities[2], W.lwpoly([[0, 10 * R.PT], [0, 20 * R.PT], ...(close ? [[20 * R.PT, 0]] : [])], { layer: '#000000' }));
  }
});

test('TODO 272a: noncircular curve pieces join straight neighbours and rectangles flush the chain', () => {
  const { moveTo: m, lineTo: l, curveTo: c, rectangle: r } = pdfjs.OPS;
  const { doc, paths } = pdfPath([m, l, c, l, r], [-10, 0, 0, 0, 10, 20, 20, -20, 30, 0, 40, 0, 50, 0, 10, 5]);
  assert.equal(paths, 2);
  assert.deepEqual(doc.entities.map((e) => e.type), ['LWPOLYLINE', 'LWPOLYLINE']);
  assert.ok(+doc.entities[0].r.v[doc.entities[0].r.c.indexOf(90)] > 4);
  assert.equal(+doc.entities[1].r.v[doc.entities[1].r.c.indexOf(70)], 1);
});

test('T32: searchable invisible text is not artwork; visible text and the original stroked A survive', async () => {
  const bytes = fs.readFileSync('fixtures/pdf-search-text.pdf');
  const mixed = await R.readPdf(new Uint8Array(bytes), { pdfjs });
  assert.equal(mixed.paths, 2); assert.equal(mixed.texts, 1);
  assert.deepEqual(mixed.doc.entities.filter((e) => e.type === 'TEXT').map((e) => e.r.v[e.r.c.indexOf(1)]), ['C']);
  const hidden = await R.readPdf(new Uint8Array(bytes), { pdfjs, page: 2 });
  assert.equal(hidden.paths, 2); assert.equal(hidden.texts, 0);
  assert.ok(hidden.doc.entities.every((e) => e.type === 'LWPOLYLINE'));
});

test('T32: rendering modes 3 / 7 are invisible, other modes paint; save and form scopes restore text mode', () => {
  const OPS = pdfjs.OPS, glyph = (unicode) => ({ unicode, width: 600 });
  const fnArray = [], argsArray = [], text = [];
  const op = (fn, a = []) => { fnArray.push(fn); argsArray.push(a); };
  for (let mode = 0; mode <= 7; mode++) {
    op(OPS.save); op(OPS.setTextRenderingMode, [mode]); op(OPS.showText, [[glyph(String(mode))]]); op(OPS.restore);
    text.push({ str: String(mode), transform: [10, 0, 0, 10, mode * 10, 0] });
  }
  op(OPS.paintFormXObjectBegin, [null]); op(OPS.setTextRenderingMode, [3]); op(OPS.showText, [[glyph('X')]]); op(OPS.paintFormXObjectEnd);
  op(OPS.showText, [[glyph('Y')]]);
  text.push({ str: 'X', transform: [10, 0, 0, 10, 80, 0] }, { str: 'Y', transform: [10, 0, 0, 10, 90, 0] });
  const r = R.pdfToDoc({ ops: { fnArray, argsArray }, text }, OPS);
  assert.deepEqual(r.doc.entities.map((e) => e.r.v[e.r.c.indexOf(1)]), ['0', '1', '2', '4', '5', '6', 'Y']);
});

test('T32: a combined text item splits around invisible glyphs, keeping advances, kerning and rotation', () => {
  const OPS = pdfjs.OPS, glyph = (unicode, width) => ({ unicode, width });
  const ops = { fnArray: [OPS.showText, OPS.setTextRenderingMode, OPS.showText, OPS.setTextRenderingMode, OPS.showText],
    argsArray: [[[glyph('W', 900), -100]], [3], [[glyph('X', 700)]], [0], [[glyph('I', 300)]]] };
  const { doc } = R.pdfToDoc({ ops, text: [{ str: 'WXI', width: 20, transform: [0, 10, -10, 0, 5, 8] }] }, OPS);
  const [w, i] = doc.entities, f = (e, c) => +e.r.v[e.r.c.indexOf(c)];
  assert.deepEqual(doc.entities.map((e) => e.r.v[e.r.c.indexOf(1)]), ['W', 'I']);
  near(f(w, 10), 5 * R.PT); near(f(w, 20), 8 * R.PT);
  near(f(i, 10), 5 * R.PT); near(f(i, 20), (8 + 17) * R.PT); near(f(i, 50), 90);
});

test('a Bézier quarter circle is an ARC; a wavy one is not', () => {
  const K = 0.5522847498, r = 10;
  const a = R.bezierArc([r, 0], [r, K * r], [K * r, r], [0, r]);
  near(a.r, 10); near(a.cx, 0, 'cx'); near(a.cy, 0, 'cy'); near(a.a0, 0); near(a.a1, 90);
  const cw = R.bezierArc([0, r], [K * r, r], [r, K * r], [r, 0]);       // the same quarter drawn the other way round
  near(cw.a0, 0); near(cw.a1, 90);
  assert.equal(R.bezierArc([0, 0], [10, 20], [20, -20], [30, 0]), null);
  assert.equal(R.bezierArc([0, 0], [10, 0], [20, 0], [30, 0]), null, 'a straight one');
});

test('the fixture reads: 160 × 80 plate, dial, box, leader and text, in mm from the page corner', async () => {
  const r = await read();
  assert.equal(r.pages, 1);
  near(r.mm[0], 200, 'w', 1e-4); near(r.mm[1], 120, 'h', 1e-4);
  assert.equal(r.texts, 1);
  const types = {};
  for (const e of r.doc.entities) types[e.type] = (types[e.type] || 0) + 1;
  assert.equal(types.TEXT, 1);
  assert.equal(types.ARC, 8, 'four plate corners and four of the dial');
  assert.equal(types.LWPOLYLINE, 6, 'four plate sides, one closed box, the leader');
});

test('as a drawing: mm from the page corner, one click on the plate picks its 8 pieces, the leader and the dial stay out', async () => {
  const { doc } = await read(), fl = D.flatten(doc);
  const b = fl.boxes.model;
  near(b[0], 5, 'x0'); near(b[2], 180, 'x1'); near(b[1], 20, 'y0'); near(b[3], 100, 'y1');
  const ed = E.makeIndex(doc, fl), e = E.hitEntity(ed, 100, 20.1, 1);
  assert.equal(doc.entities[e].type, 'LWPOLYLINE');
  const chain = E.chainAt(ed, e, E.chainTol(b, 1));
  assert.equal(chain.length, 8);
  assert.ok(chain.every((i) => doc.entities[i].type === 'LWPOLYLINE' || doc.entities[i].type === 'ARC'));
  const kept = E.keepOnly(doc, new Set(chain)), d2 = { ...doc, entities: kept.entities, blocks: kept.blocks }, b2 = D.flatten(d2).boxes.model;
  near(b2[2] - b2[0], 160, 'width'); near(b2[3] - b2[1], 80, 'height');
});

test('text: at its place, capitals 0.7 of the font size, upright', async () => {
  const { doc } = await read(), t = doc.entities.find((e) => e.type === 'TEXT');
  const f = (c) => t.r.v[t.r.c.indexOf(c)];
  assert.equal(f(1), 'HELLO');
  near(+f(10), 105, 'x'); near(+f(20), 80, 'y'); near(+f(40), 6 * 0.7, 'height');
});

test('it saves as a DXF and reads back the same', async () => {
  const { doc } = await read();
  assert.deepEqual(W.unwritable(doc), []);
  const back = D.readDxf(W.writeDxf(doc, { escapeUnicode: true }));
  assert.equal(back.entities.length, doc.entities.length);
  assert.equal(back.header.$INSUNITS, '4');
});

test('pure conversion: the CTM and a form\'s matrix apply, clips are not drawn, rectangles close', () => {
  const OPS = pdfjs.OPS;
  const ops = { fnArray: [OPS.save, OPS.transform, OPS.constructPath, OPS.stroke, OPS.restore, OPS.constructPath, OPS.endPath, OPS.constructPath, OPS.fill],
    argsArray: [null, [2, 0, 0, 2, 10, 20], [[OPS.moveTo, OPS.lineTo], [0, 0, 5, 0]], null, null, [[OPS.moveTo, OPS.lineTo], [0, 0, 99, 99]], null, [[OPS.rectangle], [0, 0, 10, 5]], null] };
  const r = R.pdfToDoc({ ops, text: [], view: [0, 0, 100, 100] }, OPS);
  const [l, q] = r.doc.entities;
  assert.equal(r.doc.entities.length, 2, 'the clipped path is dropped');
  const f = (e, c) => +e.r.v[e.r.c.indexOf(c)];
  near(f(l, 10), 10 * R.PT, 'x1'); near(f(l, 20), 20 * R.PT, 'y1'); near(+l.r.v[l.r.c.lastIndexOf(10)], 20 * R.PT, 'x2');
  assert.equal(q.type, 'LWPOLYLINE'); assert.equal((+q.r.v[q.r.c.indexOf(70)]) & 1, 1, 'closed');
});

test('a PDF is told by its first bytes', () => {
  assert.equal(R.isPdf(new Uint8Array(fs.readFileSync('fixtures/vector.pdf'))), true);
  assert.equal(R.isPdf(new Uint8Array([0x30, 0x0a])), false);
});

test('TODO 253b: PDF sniff reads only the view bytes', () => {
  const bytes = new TextEncoder().encode('xx%PDF-1.7tail');
  for (const [input, expected] of [
    [new DataView(bytes.buffer, 2, 8), true],
    [bytes.subarray(2, 10), true],
    [new Uint8ClampedArray(bytes.buffer, 2, 8), true],
    [bytes.subarray(2, 5), false],
    [new DataView(bytes.buffer, 2, 3), false],
    [bytes.subarray(3), false],
    [bytes.buffer, false],
    [bytes.slice(2).buffer, true],
  ]) assert.equal(R.isPdf(input), expected, `${input.constructor.name}, offset ${input.byteOffset}, length ${input.byteLength}`);
});


test('a page with /Rotate: drawn as it is shown (a portrait page turned 90° is landscape), text turns with it', async () => {
  const OPS = pdfjs.OPS, view = [0, 0, 100, 200];
  const ops = { fnArray: [OPS.constructPath, OPS.stroke], argsArray: [[[OPS.moveTo, OPS.lineTo], [0, 0, 50, 0]], null] };
  const text = [{ str: 'AB', transform: [10, 0, 0, 10, 20, 30] }];
  const ends = (rotate) => {
    const { doc } = R.pdfToDoc({ ops, text, view, rotate }, OPS), l = doc.entities[0], f = (c) => +l.r.v[l.r.c.indexOf(c)];
    return [f(10), f(20), +l.r.v[l.r.c.lastIndexOf(10)], +l.r.v[l.r.c.lastIndexOf(20)]].map((v) => +(v / R.PT).toFixed(3));
  };
  assert.deepEqual(ends(0), [0, 0, 50, 0]);
  assert.deepEqual(ends(90), [0, 100, 0, 50], 'bottom-left goes to top-left, the line runs down');
  assert.deepEqual(ends(180), [100, 200, 50, 200]);
  assert.deepEqual(ends(270), [200, 0, 200, 50]);
  const t90 = R.pdfToDoc({ ops, text, view, rotate: 90 }, OPS).doc.entities[1];
  near(+t90.r.v[t90.r.c.indexOf(50)], -90, 'text turns clockwise with the page');
  // a real file: the page size comes out swapped
  const bytes = P.writePdf([Object.assign(new P.Page(100, 200), {})]);
  const turned = new Uint8Array(Buffer.from(Buffer.from(bytes).toString('latin1').replace('/MediaBox', '/Rotate 90 /MediaBox'), 'latin1'));
  const r = await R.readPdf(turned, { pdfjs });
  near(r.mm[0], 200, 'w', 1e-3); near(r.mm[1], 100, 'h', 1e-3);
});

test('a page with 200 000 line pieces opens (no push(...list) over the argument limit)', () => {
  const OPS = pdfjs.OPS, n = 200000, codes = [], c = [];
  for (let i = 0; i < n; i++) { codes.push(OPS.moveTo, OPS.lineTo); c.push(i % 500, 0, i % 500, 5); }
  const ops = { fnArray: [OPS.constructPath, OPS.stroke], argsArray: [[codes, c], null] };
  const { doc } = R.pdfToDoc({ ops, text: [], view: [0, 0, 600, 100] }, OPS);
  assert.ok(doc.entities.length >= n, 'pieces: ' + doc.entities.length);
});

test('a v curve (no first control point) starts at the current point, also when the path goes on in a later op', () => {
  const OPS = pdfjs.OPS, r = 10;
  // a quarter circle (r, 0) → (0, r) written as m, then c split across two ops: m in the first, v (curveTo2) in the second
  const ops = { fnArray: [OPS.constructPath, OPS.constructPath, OPS.stroke], argsArray: [[[OPS.moveTo], [r, 0]], [[OPS.curveTo2], [r, r, 0, r]], null] };
  const { doc } = R.pdfToDoc({ ops, text: [], view: [0, 0, 100, 100] }, OPS);
  assert.ok(doc.entities.length === 1 && doc.entities[0].type === 'LWPOLYLINE', 'a curve with a first control point at the start is not a circle arc: ' + doc.entities.map((e) => e.type));
  // the same curve as a c with the first control point at the start gives the identical points
  const ops2 = { fnArray: [OPS.constructPath, OPS.stroke], argsArray: [[[OPS.moveTo, OPS.curveTo], [r, 0, r, 0, r, r, 0, r]], null] };
  const b = R.pdfToDoc({ ops: ops2, text: [], view: [0, 0, 100, 100] }, OPS).doc.entities[0];
  assert.deepEqual(doc.entities[0].r.v.map(Number), b.r.v.map(Number));
});

// TODO 305a: a PDF with one 4 x 2 RGB picture under a turned, skewed ctm, a 1-colour stencil and a line
const pictureBytes = () => {
  const content = 'q 40 20 -20 30 100 10 cm /Im1 Do Q\nq 10 0 0 10 5 5 cm /Mk Do Q\n0 0 m 50 0 l S\n';
  const rgb = ['ff0000', '00ff00', '0000ff', 'ffffff', '000000', 'ffff00', '00ffff', 'ff00ff'].join('') + '>';        // 8 pixels, top row first
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /XObject << /Im1 5 0 R /Mk 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    `<< /Type /XObject /Subtype /Image /Width 4 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${rgb.length} >>\nstream\n${rgb}\nendstream`,
    '<< /Type /XObject /Subtype /Image /Width 8 /Height 1 /ImageMask true /BitsPerComponent 1 /Filter /ASCIIHexDecode /Length 3 >>\nstream\nAA>\nendstream'];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  return new TextEncoder().encode(pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
};
test('TODO 305a: a picture becomes an IMAGE with its place from the ctm (to 0.01 mm), a stencil is counted and left out', async () => {
  const r = await R.readPdf(pictureBytes(), { pdfjs });
  assert.deepEqual([r.pictures, r.stencils, r.paths], [1, 1, 1]);
  const [pic, line] = r.doc.entities;                                   // pictures come first: under the line
  assert.deepEqual([pic.type, pic.layer, line.type], ['IMAGE', 'PDF pictures', 'LWPOLYLINE']);
  assert.ok(r.doc.layers['PDF pictures'], 'its own layer');
  const f = (c) => +pic.r.v[pic.r.c.indexOf(c)], PTMM = R.PT;
  const mm = (v) => v * PTMM;
  const near2 = (a, b, m) => assert.ok(Math.abs(a - b) < 0.01, `${m} ${a} !~ ${b}`);
  near2(f(10), mm(100), 'insert x'); near2(f(20), mm(10), 'insert y');
  near2(f(11) * f(13), mm(40), 'u x'); near2(f(21) * f(13), mm(20), 'u y');         // u, v are one pixel's sides (DXF): times the pixels = the picture's side
  near2(f(12) * f(23), mm(-20), 'v x'); near2(f(22) * f(23), mm(30), 'v y');
  assert.deepEqual([f(13), f(23)], [4, 2]);
  assert.match(pic.r.px, /^data:image\/png;base64,/);
  assert.ok(!pic.r.v.some((v) => v.includes('data:')), 'pixels are in r.px, never in the group codes');
  const flat = D.flatten(r.doc), item = flat.items.find((it) => it.k === 'i');
  assert.ok(item && item.px === pic.r.px && item.ops.length, 'drawing.js flattens it to a picture item with an outline');
  const ix = D.pickIndex(flat, false), at = D.pickAt(ix, mm(100) + mm(20) * 0.5, mm(10) + mm(10) * 0.5, 0.01);       // on the bottom edge's middle (u/2 along)
  assert.equal(at.ent?.it, flat.items.indexOf(item), 'the frame is pickable');
  const w = W.writeDxf(r.doc);
  assert.ok(!w.includes('data:image') && /\nIMAGE\r?\n/.test(w), 'DXF Save writes the IMAGE reference without pixels (305b)');
});

test('TODO 330: pageLayout puts pages left to right, 10 mm apart, tops aligned, and caps the size', () => {
  const one = R.pageLayout([[595, 842]]);
  assert.deepEqual([one.dpi, one.W, one.H, one.cells.length], [150, Math.ceil(595 * 150 / 72), Math.ceil(842 * 150 / 72), 1], 'one page: as renderPdfPage draws it');
  const a = R.pageLayout([[200, 100], [100, 300], [150, 50]]), gap = Math.round(10 / 25.4 * 150);
  assert.equal(a.dpi, 150);
  assert.deepEqual(a.cells.map((c) => c.y), [0, 0, 0], 'top edges aligned');
  assert.equal(a.cells[1].x, a.cells[0].w + gap); assert.equal(a.cells[2].x, a.cells[1].x + a.cells[1].w + gap);
  assert.equal(a.W, a.cells[0].w + a.cells[1].w + a.cells[2].w + 2 * gap, 'width = the pages + 2 gaps');
  assert.equal(a.H, a.cells[1].h, 'height = the tallest page');
  const big = R.pageLayout(Array(40).fill([2384, 3370]));              // 40 A0 sheets: far over 16384 px
  assert.ok(big.dpi < 150 && big.W <= 16384 && big.H <= 16384 && big.W * big.H <= 64e6, `capped ${big.dpi} dpi ${big.W}x${big.H}`);
  assert.equal(R.pageLayout([[2000, 2000]]).dpi, 150, '4167 px a side, 17 MP: under both caps');
  assert.equal(R.pageLayout([[4000, 4000]]).dpi, 144, '8333 px a side = 69 MP at 150 dpi: the area cap gives 8000 x 8000 = 64 MP at 144');
  assert.equal(R.pageLayout([[10000, 100]]).dpi, 117, 'the side cap: 16384 px / 138.9 in = 117.96: 117 dpi (118 would be 16389 px)');
});
