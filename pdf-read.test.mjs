// pdf-read.js — a vector PDF as a drawing.   node pdf-read.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const fs = await import('node:fs');
const R = await import('./web/pdf-read.js');
const D = await import('./web/drawing.js');
const E = await import('./web/edit.js');
const W = await import('./web/dxf-write.js');
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

