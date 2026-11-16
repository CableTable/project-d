// pictures.js — the pixels of a PDF's embedded pictures (TODO 305a). An IMAGE entity keeps its pixels as a PNG data URL in r.px (never in
// r.c / r.v, so DXF Save cannot leak it). encodePng is pure (pictures.test.mjs); the rest needs a browser: drawing a picture on the canvas
// (pictureBitmap, preloadPictures) and reading it back as raw pixels for the PDF export (rawPixels).

const CRC = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

/** pdf.js's decoded image ({ width, height, data, kind }: 1 = 1-bit grey, 2 = RGB, 3 = RGBA) → { w, h, rgba }, or null when it holds no pixels. */
export function toRgba({ width: w, height: h, data, kind } = {}) {
  if (!(w > 0 && h > 0) || !data) return null;
  const out = new Uint8Array(w * h * 4);
  if (kind === 3 && data.length >= w * h * 4) out.set(data.subarray(0, w * h * 4));
  else if (kind === 2 && data.length >= w * h * 3) for (let i = 0, j = 0; i < w * h; i++, j += 3) out.set([data[j], data[j + 1], data[j + 2], 255], i * 4);
  else if (kind === 1 && data.length >= Math.ceil(w / 8) * h) {
    const row = Math.ceil(w / 8);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = data[y * row + (x >> 3)] >> (7 - (x & 7)) & 1 ? 255 : 0; out.set([v, v, v, 255], (y * w + x) * 4); }
  } else return null;
  return { w, h, rgba: out };
}

async function deflate(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}

/** RGBA pixels → a PNG data URL (RGB when nothing is transparent, RGBA when something is). */
export async function encodePng(w, h, rgba) {
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
  const n = opaque ? 3 : 4, raw = new Uint8Array((w * n + 1) * h);
  for (let y = 0; y < h; y++) {
    const at = y * (w * n + 1);                                                  // filter 0 (none) at the start of each row
    if (!opaque) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), at + 1);
    else for (let x = 0; x < w; x++) raw.set(rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 3), at + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const b = new Uint8Array(12 + data.length), v = new DataView(b.buffer);
    v.setUint32(0, data.length); for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(data, 8); v.setUint32(8 + data.length, crc32(b.subarray(4, 8 + data.length)));
    return b;
  };
  const head = new Uint8Array(13), hv = new DataView(head.buffer);
  hv.setUint32(0, w); hv.setUint32(4, h); head[8] = 8; head[9] = opaque ? 2 : 6;
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', head), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0; for (const p of parts) { png.set(p, at); at += p.length; }
  let s = ''; for (let i = 0; i < png.length; i += 0x8000) s += String.fromCharCode.apply(null, png.subarray(i, i + 0x8000));
  return 'data:image/png;base64,' + btoa(s);
}

/** Is this a PNG data URL (what r.px holds; a recovery record is data, not trusted)? */
export const isPng = (s) => typeof s === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s);

// ---------------------------------------------------------------- browser only

const decoded = new Map();                            // px → the loaded <img> (or the loading one)
function load(px) {
  let img = decoded.get(px);
  if (!img) { img = new Image(); img.src = px; decoded.set(px, img); }
  return img;
}
/** The loaded picture to draw, or null while it loads (preloadPictures runs where pictures come in, so a paint finds them ready). */
export function pictureBitmap(px) { const img = load(px); return img.complete && img.naturalWidth ? img : null; }
/** Loads the pictures of these items (k 'i') before they are painted. */
export async function preloadPictures(items) {
  await Promise.all([...new Set(items.filter((it) => it.k === 'i').map((it) => it.px))].map((px) => load(px).decode().catch(() => {})));
}
/** A picture as raw pixels for the PDF file: { w, h, rgb, a (null when nothing is transparent) }. */
export async function rawPixels(px) {
  const img = load(px); await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height), n = c.width * c.height, rgb = new Uint8Array(n * 3), a = new Uint8Array(n);
  let clear = false;
  for (let i = 0; i < n; i++) { rgb[i * 3] = data[i * 4]; rgb[i * 3 + 1] = data[i * 4 + 1]; rgb[i * 3 + 2] = data[i * 4 + 2]; a[i] = data[i * 4 + 3]; if (a[i] !== 255) clear = true; }
  return { w: c.width, h: c.height, rgb, a: clear ? a : null };
}
