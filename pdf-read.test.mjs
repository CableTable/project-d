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

const near = (a, b, m, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps * (1 + Math.abs(b)), `${m || ''} ${a} !~ ${b}`);
const read = () => R.readPdf(new Uint8Array(fs.readFileSync('fixtures/vector.pdf')), { pdfjs });

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
  assert.equal(types.LINE, 9, 'four plate sides, the box\'s four, the leader');
});

test('as a drawing: mm from the page corner, one click on the plate picks its 8 pieces, the leader and the dial stay out', async () => {
  const { doc } = await read(), fl = D.flatten(doc);
  const b = fl.boxes.model;
  near(b[0], 5, 'x0'); near(b[2], 180, 'x1'); near(b[1], 20, 'y0'); near(b[3], 100, 'y1');
  const ed = E.makeIndex(doc, fl), e = E.hitEntity(ed, 100, 20.1, 1);
  assert.equal(doc.entities[e].type, 'LINE');
  const chain = E.chainAt(ed, e, E.chainTol(b, 1));
  assert.equal(chain.length, 8);
  assert.ok(chain.every((i) => doc.entities[i].type === 'LINE' || doc.entities[i].type === 'ARC'));
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
  near(f(l, 10), 10 * R.PT, 'x1'); near(f(l, 20), 20 * R.PT, 'y1'); near(f(l, 11), 20 * R.PT, 'x2');
  assert.equal(q.type, 'LWPOLYLINE'); assert.equal((+q.r.v[q.r.c.indexOf(70)]) & 1, 1, 'closed');
});

test('a PDF is told by its first bytes', () => {
  assert.equal(R.isPdf(new Uint8Array(fs.readFileSync('fixtures/vector.pdf'))), true);
  assert.equal(R.isPdf(new Uint8Array([0x30, 0x0a])), false);
});


test('a page with /Rotate: drawn as it is shown (a portrait page turned 90° is landscape), text turns with it', async () => {
  const OPS = pdfjs.OPS, view = [0, 0, 100, 200];
  const ops = { fnArray: [OPS.constructPath, OPS.stroke], argsArray: [[[OPS.moveTo, OPS.lineTo], [0, 0, 50, 0]], null] };
  const text = [{ str: 'AB', transform: [10, 0, 0, 10, 20, 30] }];
  const ends = (rotate) => {
    const { doc } = R.pdfToDoc({ ops, text, view, rotate }, OPS), l = doc.entities[0], f = (c) => +l.r.v[l.r.c.indexOf(c)];
    return [f(10), f(20), f(11), f(21)].map((v) => +(v / R.PT).toFixed(3));
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
