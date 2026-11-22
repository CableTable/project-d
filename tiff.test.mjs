import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { readTiff, tiffDpi } from './web/tiff.js';
import { makeTiff, TWO_PAGES, G4_PAGE } from './tools/make-tiff-fixture.mjs';

const gray = (page, x, y) => { const i = (y * page.w + x) * 4; return [...page.rgba.subarray(i, i + 4)]; };
// readTiff gives headers only; each page is decoded on demand
const decoded = async (pages) => { for (const p of pages) if (p.decode) p.rgba = await p.decode(); return pages; };

test('TODO 138: the 2-page LZW fixture decodes to its sizes, dpi and pixels', async () => {
  const bytes = readFileSync('fixtures/two-pages-lzw.tif');
  assert.deepEqual([...bytes], [...makeTiff(TWO_PAGES)], 'fixtures/two-pages-lzw.tif is what tools/make-tiff-fixture.mjs writes');
  const heads = readTiff(bytes);
  assert.deepEqual(heads.map(({ n, w, h, dpi, rgba }) => ({ n, w, h, dpi, rgba })),
    [{ n: 1, w: 300, h: 150, dpi: [150, 150], rgba: undefined }, { n: 2, w: 200, h: 200, dpi: [100, 100], rgba: undefined }], 'sizes and dpi before any decode');
  const pages = await decoded(heads);
  assert.deepEqual(pages.map(({ n, w, h, dpi, rgba }) => ({ n, w, h, dpi, len: rgba.length })),
    [{ n: 1, w: 300, h: 150, dpi: [150, 150], len: 300 * 150 * 4 }, { n: 2, w: 200, h: 200, dpi: [100, 100], len: 200 * 200 * 4 }]);
  for (const [k, p] of pages.entries()) for (const [x, y] of [[0, 0], [5, 7], [123, 77], [p.w - 1, p.h - 1]]) {
    const v = TWO_PAGES[k].pixel(x, y);
    assert.deepEqual(gray(p, x, y), [v, v, v, 255], `page ${k + 1} pixel ${x},${y}`);
  }
});

test('TODO 138: a G4 page without dpi tags is 96 dpi and white', async () => {
  const bytes = readFileSync('fixtures/g4-no-dpi.tif');
  assert.deepEqual([...bytes], [...makeTiff(G4_PAGE)]);
  const [p] = await decoded(readTiff(bytes));
  assert.deepEqual([p.n, p.w, p.h, p.dpi], [1, 96, 48, [96, 96]]);
  assert.deepEqual(gray(p, 50, 30), [255, 255, 255, 255]);
});

test('TODO 138: a page that cannot be decoded is reported with its number, the others still decode; cm units', async () => {
  const pages = await decoded(readTiff(makeTiff([
    { w: 4, h: 2, pixel: () => 9, compression: 34712 },
    { w: 254, h: 127, pixel: () => 77, dpi: [100, 100], unit: 3 },
  ])));
  assert.deepEqual(pages[0], { n: 1, error: 'compression 34712 not supported' });
  assert.deepEqual([pages[1].n, pages[1].w, pages[1].dpi, gray(pages[1], 3, 3)], [2, 254, [254, 254], [77, 77, 77, 255]]);
  assert.throws(() => readTiff(new TextEncoder().encode('not a tiff at all')), /not a TIFF file/);
});

test('TODO 138: a resolution of Infinity, NaN, 0 or a negative number uses the 96 dpi fallback (lowsD55c)', () => {
  assert.deepEqual(tiffDpi({ t282: [Infinity], t283: [NaN] }), [96, 96]);
  assert.deepEqual(tiffDpi({ t282: [-Infinity], t283: [0] }), [96, 96]);
  assert.deepEqual(tiffDpi({ t282: [150], t283: [-5] }), [150, 96], 'a good axis is kept');
});
