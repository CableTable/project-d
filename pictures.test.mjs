// pictures.js — the pixels of a PDF's pictures (TODO 305a); the PDF writer's image XObjects; recovery keeps them.   node pictures.test.mjs
const { test } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const zlib = await import('node:zlib');
const PIC = await import('./web/pictures.js');
const P = await import('./web/pdf-write.js');
const R = await import('./web/pdf-read.js');
const RC = await import('./web/recovery.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

/** A PNG data URL → { w, h, type, rows: the unfiltered bytes of each row } (our files only: 8 bit, filter 0). */
const unpng = (url) => {
  const b = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), type = b[25];
  const len = b.readUInt32BE(33), idat = b.subarray(41, 41 + len), raw = zlib.inflateSync(idat), n = type === 2 ? 3 : 4;
  assert.equal(b.subarray(41 + len + 4 + 4, 41 + len + 8 + 4).toString(), 'IEND');
  return { w, h, type, rows: Array.from({ length: h }, (_, y) => [...raw.subarray(y * (w * n + 1), (y + 1) * (w * n + 1))]) };
};

test('TODO 305a: pdf.js pixels (grey 1 bit, RGB, RGBA) become RGBA; nothing without data', () => {
  assert.deepEqual([...PIC.toRgba({ width: 2, height: 1, kind: 2, data: Uint8Array.of(1, 2, 3, 4, 5, 6) }).rgba], [1, 2, 3, 255, 4, 5, 6, 255]);
  assert.deepEqual([...PIC.toRgba({ width: 1, height: 1, kind: 3, data: Uint8Array.of(1, 2, 3, 4) }).rgba], [1, 2, 3, 4]);
  assert.deepEqual([...PIC.toRgba({ width: 3, height: 1, kind: 1, data: Uint8Array.of(0b10100000) }).rgba], [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  assert.equal(PIC.toRgba({ width: 2, height: 2, kind: 2, data: Uint8Array.of(1) }), null, 'too little data');
  assert.equal(PIC.toRgba({ width: 2, height: 2, kind: 2 }), null);
});

test('TODO 305a: encodePng writes an RGB PNG when opaque, RGBA when not; isPng tells it', async () => {
  const opaque = await PIC.encodePng(2, 1, Uint8Array.of(9, 8, 7, 255, 6, 5, 4, 255));
  assert.ok(PIC.isPng(opaque));
  assert.deepEqual(unpng(opaque), { w: 2, h: 1, type: 2, rows: [[0, 9, 8, 7, 6, 5, 4]] });
  const clear = await PIC.encodePng(1, 2, Uint8Array.of(9, 8, 7, 255, 6, 5, 4, 10));
  assert.deepEqual(unpng(clear), { w: 1, h: 2, type: 6, rows: [[0, 9, 8, 7, 255], [0, 6, 5, 4, 10]] });
  for (const bad of [null, '', 'data:image/png;base64,<script>', 'data:image/svg+xml;base64,AAAA', 42]) assert.equal(PIC.isPng(bad), false);
});

test('TODO 305a: the PDF writer puts a picture (with alpha) on the page; pdf.js reads it back where it was put', async () => {
  const img = { w: 2, h: 1, rgb: Uint8Array.of(255, 0, 0, 0, 255, 0), a: Uint8Array.of(255, 128) };
  const page = new P.Page(100, 50);
  page.image([40, 0, 0, 20, 10, 5], img); page.image([20, 0, 0, 10, 60, 5], img);                  // the same picture twice: one XObject
  const bytes = P.writePdf([page]), text = Buffer.from(bytes).toString('latin1');
  assert.equal((text.match(/\/Subtype \/Image/g) || []).length, 2, 'the picture and its alpha, once');
  assert.match(text, /\/SMask \d+ 0 R/);
  assert.equal((text.match(/ Do Q/g) || []).length, 2);
  const r = await R.readPdf(bytes, { pdfjs });
  assert.equal(r.pictures, 2);
  const [a, b] = r.doc.entities, f = (e, c) => +e.r.v[e.r.c.indexOf(c)];
  for (const [e, x, w] of [[a, 10, 40], [b, 60, 20]]) {
    assert.ok(Math.abs(f(e, 10) - x) < 0.01 && Math.abs(f(e, 20) - 5) < 0.01, 'insert');
    assert.ok(Math.abs(f(e, 11) * f(e, 13) - w) < 0.01, 'width');
  }
  const none = P.writePdf([new P.Page(10, 10)]);
  assert.ok(!Buffer.from(none).toString('latin1').includes('/XObject'), 'a page without pictures is as before');
});

test('TODO 305a: a recovery copy keeps its pictures, whole and only valid ones', async () => {
  const px = await PIC.encodePng(1, 1, Uint8Array.of(1, 2, 3, 255));
  const pic = { type: 'IMAGE', layer: 'PDF pictures', r: { type: 'IMAGE', c: [8], v: ['PDF pictures'], px } };
  assert.equal(RC.isPicture(pic), true);
  assert.equal(RC.isPicture({ ...pic, r: { ...pic.r, px: 'javascript:alert(1)' } }), false);
  const [c] = RC.cleanCopies([{ id: 'a', name: 'n', kind: 'drawing', dxf: '0\nEOF', pics: [pic, { type: 'LINE' }, null] }]);
  assert.deepEqual(c.pics, [pic]);
  assert.deepEqual(RC.cleanCopies([{ id: 'a', name: 'n', kind: 'drawing', dxf: 'x' }])[0].pics, []);
});
