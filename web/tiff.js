// tiff.js — TODO 138: every page of a .tif / .tiff as RGBA + size + dpi, for a background picture (and so Trace bitmap).
// UTIF.js is vendored from Project V; the decode / inflate half of V's web/tiff-doc.js, the drawing is app.js importBackgroundTiff.
import UTIF from './vendor/utif/UTIF.js';

const DECODED = [1, 3, 4, 5, 6, 7, 8, 32773, 32809]; // compressions the vendored UTIF decodes (8 = Deflate: strips are inflated first, see inflateStrips)

/** Deflate (zlib) strips / tiles of an IFD inflated with the built-in DecompressionStream: Map(byte offset -> bytes) for UTIF.inflated (UTIF's decode is synchronous). */
async function inflateStrips(buf, ifd) {
  const offs = ifd.t273 || ifd.t324, lens = ifd.t279 || ifd.t325, out = new Map();
  for (let i = 0; i < offs.length; i++) {
    const stream = new Blob([new Uint8Array(buf, offs[i], lens[i])]).stream().pipeThrough(new DecompressionStream('deflate'));
    out.set(offs[i], new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return out;
}

/** [x, y] dpi from the resolution tags 282 / 283 (unit 296: inch or cm); no tag (or no unit): 96 dpi. */
export function tiffDpi(ifd) {
  const unit = ifd.t296?.[0] ?? 2;
  const dpi = (res) => (Number.isFinite(res) && res > 0 && unit !== 1 ? (unit === 3 ? res * 2.54 : res) : 96);
  return [dpi(ifd.t282?.[0]), dpi(ifd.t283?.[0])];
}

/** Reads the page headers of TIFF bytes, decoding nothing. → [{ n, w, h, dpi: [x, y], decode } | { n, error }], n from 1.
 *  decode() → the page's RGBA (Uint8ClampedArray), or throws; call it one page at a time and drop the RGBA once drawn (a 300 dpi A4 page is ~35 MB).
 *  An unsupported compression is reported by its error, not thrown; throws only when the bytes are no TIFF or hold no page. */
export function readTiff(bytes) {
  const u = ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
  const head = String.fromCharCode(...u.subarray(0, 4));
  if (head !== 'II*\0' && head !== 'MM\0*') throw new Error('not a TIFF file');
  const buf = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); // UTIF copies a typed array on every call, not a buffer
  const pages = UTIF.decode(buf).filter((ifd) => ifd.t256 && ifd.t257);
  if (!pages.length) throw new Error('no pages');
  return pages.map((ifd, i) => {
    if (ifd.t259?.[0] === 32946) ifd.t259 = [8]; // Adobe's code for the same zlib data
    const c = ifd.t259?.[0] ?? 1;
    if (!DECODED.includes(c)) return { n: i + 1, error: `compression ${c} not supported` };
    const decode = async () => {
      try {
        if (c === 8) UTIF.inflated = await inflateStrips(buf, ifd);
        UTIF.decodeImage(buf, ifd, pages);
        const rgba = UTIF.toRGBA8(ifd);
        return new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length);
      } finally {
        delete ifd.data; // the raw strips: only the returned RGBA is kept
        UTIF.inflated = new Map();
      }
    };
    return { n: i + 1, w: ifd.t256[0], h: ifd.t257[0], dpi: tiffDpi(ifd), decode };
  });
}
