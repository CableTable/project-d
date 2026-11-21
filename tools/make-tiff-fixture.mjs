// TODO 138: makes fixtures/two-pages-lzw.tif (2 LZW pages, 150 and 100 dpi) and fixtures/g4-no-dpi.tif (1 CCITT G4 page, no dpi tags).
//   node tools/make-tiff-fixture.mjs      (makeTiff is also imported by tiff.test.mjs; the TIFF writer is Project V's tools/tiff-fixture.mjs)
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** TIFF LZW (MSB first, 9-12 bit codes, early change, a Clear code first and when the table is full). */
export function lzw(raw) {
  const out = [];
  let acc = 0, nb = 0, width = 9, dict = new Map(), next = 258;
  const put = (code) => { acc = (acc << width) | code; nb += width; while (nb >= 8) { out.push((acc >>> (nb - 8)) & 255); nb -= 8; } acc &= (1 << nb) - 1; };
  put(256);
  let prefix = raw[0];
  for (let i = 1; i < raw.length; i++) {
    const k = prefix * 256 + raw[i];
    if (dict.has(k)) { prefix = dict.get(k); continue; }
    put(prefix);
    dict.set(k, next++);
    if (next === 4094) { put(256); dict = new Map(); next = 258; width = 9; }
    else if (next === 1 << width) width++; // libtiff: the decoder, one entry behind, widens at 2^n - 1
    prefix = raw[i];
  }
  put(prefix);
  if (++next === 1 << width) width++; // as libtiff: the last code counts an entry before EOI
  put(257);
  if (nb) out.push((acc << (8 - nb)) & 255);
  return Uint8Array.from(out);
}

/** CCITT G4 strip of an all-white page: each row is one V0 code ("1") against the white row above. */
const g4White = (w, h) => { const out = new Uint8Array(Math.ceil(h / 8)); for (let r = 0; r < h; r++) out[r >> 3] |= 0x80 >> (r & 7); return out; };

/** pages: [{ w, h, pixel(x, y) -> 0-255 gray, lzw, compression, dpi: [x, y], unit }] or { w, h, g4: true } -> little-endian TIFF bytes, one strip per page.
 *  `compression` only sets the tag, the strip stays raw (a page the reader must refuse). */
export function makeTiff(pages) {
  const parts = pages.map((p) => {
    if (p.g4) return { p, strip: g4White(p.w, p.h), tags: [[258, 3, [1]], [259, 3, [4]], [262, 3, [0]], [277, 3, [1]]] };
    const raw = new Uint8Array(p.w * p.h);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) raw[y * p.w + x] = p.pixel(x, y);
    return { p, strip: p.lzw ? lzw(raw) : raw, tags: [[258, 3, [8]], [259, 3, [p.compression ?? (p.lzw ? 5 : 1)]], [262, 3, [1]], [277, 3, [1]]] };
  });
  const buf = new Uint8Array(8 + parts.reduce((n, { strip }) => n + 400 + strip.length, 0)), dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49, 42, 0]);
  let at = 8, link = 4;
  for (const { p, strip, tags: own } of parts) {
    const tags = [[256, 4, [p.w]], [257, 4, [p.h]], ...own, [273, 4, [0]], [278, 4, [p.h]], [279, 4, [strip.length]]];
    if (p.dpi) tags.push([282, 5, [p.dpi[0]]], [283, 5, [p.dpi[1]]], [296, 3, [p.unit ?? 2]]);
    tags.sort((a, b) => a[0] - b[0]);
    dv.setUint32(link, at, true);
    let extra = at + 2 + tags.length * 12 + 4, stripAt = 0;
    dv.setUint16(at, tags.length, true);
    tags.forEach(([tag, type, values], k) => {
      const e = at + 2 + k * 12, size = { 3: 2, 4: 4, 5: 8 }[type];
      dv.setUint16(e, tag, true);
      dv.setUint16(e + 2, type, true);
      dv.setUint32(e + 4, values.length, true);
      let v = e + 8;
      if (size * values.length > 4) { dv.setUint32(v, extra, true); v = extra; extra += size * values.length; }
      values.forEach((x, j) => {
        if (type === 3) dv.setUint16(v + 2 * j, x, true);
        else if (type === 4) dv.setUint32(v + 4 * j, x, true);
        else { dv.setUint32(v + 8 * j, x, true); dv.setUint32(v + 8 * j + 4, 1, true); }
      });
      if (tag === 273) stripAt = v;
    });
    link = at + 2 + tags.length * 12;
    dv.setUint32(stripAt, extra, true);
    buf.set(strip, extra);
    at = extra + strip.length;
    at += at & 1;
  }
  return buf.slice(0, at);
}

/** The fixture pages: page 1 a 2 x 1 in gradient with a black frame at 150 dpi, page 2 a 2 x 2 in pattern at 100 dpi (different heights: top edges align). */
export const TWO_PAGES = [
  { w: 300, h: 150, dpi: [150, 150], lzw: true, pixel: (x, y) => (x < 4 || y < 4 || x >= 296 || y >= 146 ? 0 : (x + y) & 255) },
  { w: 200, h: 200, dpi: [100, 100], lzw: true, pixel: (x, y) => (((x >> 4) ^ (y >> 4)) & 1 ? 40 : 230) },
];
export const G4_PAGE = [{ w: 96, h: 48, g4: true }];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync('fixtures/two-pages-lzw.tif', makeTiff(TWO_PAGES));
  writeFileSync('fixtures/g4-no-dpi.tif', makeTiff(G4_PAGE));
}
