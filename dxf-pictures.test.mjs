import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDxf, flatten } from './web/drawing.js';
import { newDoc, entity, addBlock, insert, line, writeDxfWithReport, saveReportNote } from './web/dxf-write.js';
import { extractRaw, makePart, partToDxf } from './web/layoutdoc.js';
import { encodePng } from './web/pictures.js';

const field = (r, c) => r.v[r.c.indexOf(c)];
const records = (text) => {
  const lines = text.split(/\r?\n/), all = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (+lines[i] === 0) all.push({ type: lines[i + 1], c: [], v: [] });
    else { all.at(-1).c.push(+lines[i]); all.at(-1).v.push(lines[i + 1]); }
  }
  return all;
};

test('TODO 305b: rotated picture round trips as IMAGE / IMAGEDEF and a sibling PNG, never pixels in DXF text', async () => {
  const doc = newDoc(), pic = entity('IMAGE', [[10, 30], [20, 40], [30, 0], [11, 0.3], [21, 0.4], [31, 0],
    [12, -0.8], [22, 0.6], [32, 0], [13, 2], [23, 3]]);
  pic.r.px = await encodePng(2, 3, new Uint8Array(24).fill(255));
  doc.entities = [pic];
  const before = structuredClone(doc);
  const report = writeDxfWithReport(doc, { name: 'turned.dxf' });
  assert.deepEqual(report.skipped, [], 'a picture is writable');
  assert.deepEqual(report.pictures, [{ name: 'turned-img1.png', px: pic.r.px }]);
  assert.doesNotMatch(report.text, /data:image|base64/);
  const back = readDxf(report.text), image = back.entities[0];
  assert.equal(image.type, 'IMAGE');
  const marker = image.r.v.indexOf('AcDbRasterImage');
  assert.deepEqual(image.r.c.slice(marker, marker + 3), [100, 90, 10]);
  assert.equal(image.r.v[marker + 1], '0');
  assert.equal(image.r.file, 'turned-img1.png');
  for (const code of [10, 20, 30, 11, 21, 31, 12, 22, 32, 13, 23]) assert.equal(+field(image.r, code), +field(pic.r, code), 'group ' + code);
  assert.equal(image.r.px, undefined, 'pixels come from the sibling, not DXF');
  assert.equal(flatten(back).items.length, 0, 'without the sibling IMAGE stays undrawn');
  image.r.px = report.pictures[0].px;
  assert.deepEqual(flatten(back).items, flatten(doc).items);
  assert.deepEqual(back.header.$EXTMIN, [27.6, 40]);
  assert.deepEqual(back.header.$EXTMAX, [30.6, 42.6]);
  const all = records(report.text), byHandle = new Map(all.map((r) => [field(r, 5), r]));
  const def = byHandle.get(field(image.r, 340)), reactor = byHandle.get(field(image.r, 360));
  assert.equal(def.type, 'IMAGEDEF'); assert.equal(field(def, 1), image.r.file);
  assert.equal(+field(def, 10), 2); assert.equal(+field(def, 20), 3);
  assert.equal(reactor.type, 'IMAGEDEF_REACTOR');
  assert.ok(reactor.v.includes(field(image.r, 5)), 'reactor points back to IMAGE');
  assert.ok(def.v.includes(field(reactor, 5)), 'definition lists its reactor');
  const dict = all.find((r) => r.type === 'DICTIONARY' && r.v.includes(field(def, 5)));
  assert.ok(dict, 'image dictionary owns the definition');
  assert.ok(all.some((r) => r.type === 'DICTIONARY' && r.v.includes('ACAD_IMAGE_DICT') && r.v.includes(field(dict, 5))));
  assert.equal(all.filter((r) => r.type === 'CLASS' && ['IMAGE', 'IMAGEDEF', 'IMAGEDEF_REACTOR'].includes(field(r, 1))).length, 3);
  assert.deepEqual(doc, before, 'Save leaves the drawing untouched');

  const exported = writeDxfWithReport(doc, { name: 'inches.dxf', units: 'in', scale: 2 });
  const scaled = readDxf(exported.text).entities[0];
  for (const code of [10, 20, 11, 21, 12, 22]) assert.ok(Math.abs(+field(scaled.r, code) - +field(pic.r, code) * 2 / 25.4) < 1e-6, 'scaled group ' + code);
  assert.equal(+field(scaled.r, 13), 2); assert.equal(+field(scaled.r, 23), 3);
  assert.equal(exported.pictures[0].name, 'inches-img1.png');
  assert.deepEqual(doc, before, 'Export leaves the drawing untouched');
  const coarse = readDxf(writeDxfWithReport(doc, { units: 'in', precision: 0 }).text).entities[0];
  for (const code of [11, 21, 12, 22]) assert.ok(Math.abs(+field(coarse.r, code) - +field(pic.r, code) / 25.4) < 1e-6, 'per-pixel vectors keep precision: ' + code);

  addBlock(doc, 'Picture', [structuredClone(pic)]); doc.entities.push(insert('Picture', 100, 20));
  const multiple = writeDxfWithReport(doc, { name: 'two pictures.dxf' });
  assert.deepEqual(multiple.pictures.map((p) => p.name), ['two pictures-img1.png', 'two pictures-img2.png']);
  const nested = readDxf(multiple.text);
  assert.ok(nested.blocks.Picture.entities[0].r.file);
  assert.notEqual(nested.blocks.Picture.entities[0].r.file, nested.entities[0].r.file);
  assert.equal(writeDxfWithReport(nested).pictures.length, 0, 'unresolved references do not invent PNG files');
});

test('TODO 358a: pictures on layer "PDF pages" are saved as <drawing>-pageN.png, numbered apart from -imgN.png, and read back by name', async () => {
  const doc = newDoc(), px = await encodePng(2, 3, new Uint8Array(24).fill(255));
  const pic = (layer, x) => { const e = entity('IMAGE', [[10, x], [20, 0], [30, 0], [11, 1], [21, 0], [31, 0], [12, 0], [22, 1], [32, 0], [13, 2], [23, 3]], { layer }); e.r.px = px; return e; };
  doc.layers['PDF pages'] = doc.layers[0]; doc.entities = [pic('PDF pages', 0), pic('0', 50), pic('PDF pages', 100)];
  const report = writeDxfWithReport(doc, { name: 'scan.dxf' });
  assert.deepEqual(report.pictures.map((p) => p.name), ['scan-page1.png', 'scan-img1.png', 'scan-page2.png']);
  assert.deepEqual(readDxf(report.text).entities.map((e) => [e.layer, e.r.file]), [['PDF pages', 'scan-page1.png'], ['0', 'scan-img1.png'], ['PDF pages', 'scan-page2.png']]);
});

test('TODO 305b: extracting a part skips pictures when sibling PNGs cannot be written', async () => {
  const doc = newDoc(), pic = entity('IMAGE', [[10, 0], [20, 0], [11, 1], [21, 0], [12, 0], [22, 1], [13, 2], [23, 3]]);
  pic.r.px = await encodePng(2, 3, new Uint8Array(24).fill(255));
  addBlock(doc, 'Picture', [structuredClone(pic)]);
  doc.entities = [line(0, 0, 10, 10), pic, insert('Picture', 20, 0)];
  const part = makePart('extract', 'Extract', extractRaw(doc, new Set([0, 1, 2])), 1), before = structuredClone(part.raw);
  const report = writeDxfWithReport(part.raw, { escapeUnicode: true, pictures: false });
  assert.deepEqual(report.skipped, [{ type: 'IMAGE', count: 2 }]);
  assert.match(saveReportNote(report), /2 objects not saved: IMAGE x2/);
  assert.deepEqual(report.pictures, []);
  assert.doesNotMatch(report.text, /IMAGE|IMAGEDEF|drawing-img1\.png/);
  assert.equal(readDxf(report.text).entities[0].type, 'LINE');
  assert.equal(partToDxf(part), report.text, 'the library writer also disables pictures');
  assert.deepEqual(part.raw, before, 'extraction keeps the source pictures');
});
