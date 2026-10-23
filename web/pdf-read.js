// pdf-read.js — a vector PDF as a drawing, and a PDF page as a picture. The conversion is pure (pdf.js's operator list and
// text content in, a DXF document in dxf-write.js's shape out) — pdf-read.test.mjs. pdf.js itself is vendored in
// vendor/pdfjs/ (tools/vendor.mjs) and only loaded when a PDF is opened.
//
//   readPdf(bytes, { page, pdfjs })   → { doc, paths, texts, pages, page, mm: [w, h] }   (the drawing, in mm)
//   renderPdfPage(bytes, { page, dpi }) → { canvas, w, h, mmPerPx, pages }              (the page as a picture)
//   pdfToDoc({ ops, text, view, rotate }, OPS) → { doc, paths, texts }                  (the pure part; rotate: the page's /Rotate)
import { newDoc, addEntities, line, arc, lwpoly, text } from './dxf-write.js';

/** mm in one PDF point. */
export const PT = 25.4 / 72;
const CAP = 0.7;                                      // a text's capitals are about 0.7 of its font size

const textKey = (s) => s.normalize('NFKC').replace(/\s/g, '');

/** pdf.js extracts searchable text even when Tr is 3 (invisible) or 7 (clip only). */
function paintedText(items, glyphs) {
  if (!glyphs.length || glyphs.every((g) => g.paint)) return items;
  if (glyphs.every((g) => !g.paint)) return [];
  const source = glyphs.map((g) => g.char).join('');
  let cursor = 0;
  return items.flatMap((it) => {
    const key = textKey(it.str || ''), at = source.indexOf(key, cursor);
    // shortcut: uncorrelated bidi text stays intact; use positioned glyph matching when a mixed-mode bidi PDF needs it.
    if (!key || at < 0) return [it];
    cursor = at + key.length;
    const part = glyphs.slice(at, cursor);
    if (part.every((g) => g.paint)) return [it];
    if (part.every((g) => !g.paint)) return [];
    // A single extracted item can span Tr changes: split it at the original glyph advances.
    const chars = it.str.normalize('NFKC').split(''), runs = [], widths = [0];
    for (const g of part) widths.push(widths.at(-1) + g.width);
    const total = widths.at(-1), fraction = (n) => total > 0 ? widths[n] / total : n / part.length;
    let n = 0, start = 0, first = 0, paint = part[0].paint;
    const emit = (end) => {
      if (!paint) return;
      const transform = it.transform.slice(), shift = (it.width || 0) * fraction(first), norm = Math.hypot(transform[0], transform[1]) || 1;
      transform[4] += shift * transform[0] / norm; transform[5] += shift * transform[1] / norm;
      runs.push({ ...it, str: chars.slice(start, end).join(''), transform, width: (it.width || 0) * (fraction(n) - fraction(first)) });
    };
    for (let i = 0; i < chars.length; i++) {
      if (!textKey(chars[i])) continue;
      if (part[n].paint !== paint) { emit(i); start = i; first = n; paint = part[n].paint; }
      n++;
    }
    emit(chars.length);
    return runs;
  });
}

const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];

/** A cubic Bézier's point at t. */
const bez = (p0, p1, p2, p3, t) => {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
};

/** The circular arc a cubic Bézier is (to 0.2 % of its radius), as { cx, cy, r, a0, a1 } (degrees, anticlockwise), or null. */
export function bezierArc(p0, p1, p2, p3) {
  const m = bez(p0, p1, p2, p3, 0.5);
  const d = 2 * (p0[0] * (m[1] - p3[1]) + m[0] * (p3[1] - p0[1]) + p3[0] * (p0[1] - m[1]));
  if (Math.abs(d) < 1e-12) return null;
  const s0 = p0[0] * p0[0] + p0[1] * p0[1], s1 = m[0] * m[0] + m[1] * m[1], s2 = p3[0] * p3[0] + p3[1] * p3[1];
  const cx = (s0 * (m[1] - p3[1]) + s1 * (p3[1] - p0[1]) + s2 * (p0[1] - m[1])) / d;
  const cy = (s0 * (p3[0] - m[0]) + s1 * (p0[0] - p3[0]) + s2 * (m[0] - p0[0])) / d;
  const r = Math.hypot(p0[0] - cx, p0[1] - cy);
  if (!(r > 0) || r > 1e7) return null;
  for (const t of [0.25, 0.75]) { const q = bez(p0, p1, p2, p3, t); if (Math.abs(Math.hypot(q[0] - cx, q[1] - cy) - r) > 0.002 * r) return null; }
  const ang = (p) => Math.atan2(p[1] - cy, p[0] - cx) * 180 / Math.PI;
  const ccw = (m[0] - p0[0]) * (p3[1] - m[1]) - (m[1] - p0[1]) * (p3[0] - m[0]) > 0;
  const norm = (a) => ((a % 360) + 360) % 360;
  return ccw ? { cx, cy, r, a0: norm(ang(p0)), a1: norm(ang(p3)) } : { cx, cy, r, a0: norm(ang(p3)), a1: norm(ang(p0)) };
}

/**
 * pdf.js's operator list ({ fnArray, argsArray }), text items and the page's view [x0, y0, x1, y1] (points) → a drawing
 * in mm with the page's bottom-left at 0,0. Every stroked or filled path piece is a LINE, an ARC (a circular Bézier) or a
 * short polyline (any other curve); a rectangle is a closed polyline; text is TEXT at its place and size.
 * rotate: the page's /Rotate (clockwise degrees), so a portrait plotter page with /Rotate 90 comes out landscape, as it is shown.
 * OPS: pdf.js's operator numbers.
 */
export function pdfToDoc({ ops, text: items = [], view = [0, 0, 0, 0], rotate = 0 }, OPS) {
  const doc = newDoc(4), ents = [];
  const ox = view[0], oy = view[1], rot90 = ((Math.round(rotate / 90) % 4) + 4) % 4;
  const W = (view[2] - view[0]) * PT, H = (view[3] - view[1]) * PT;
  const P = (x, y, m) => {
    const px = ((m[0] * x + m[2] * y + m[4]) - ox) * PT, py = ((m[1] * x + m[3] * y + m[5]) - oy) * PT;
    return rot90 === 0 ? [px, py] : rot90 === 1 ? [py, W - px] : rot90 === 2 ? [W - px, H - py] : [H - py, px];
  };
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [], glyphs = [];
  let textMode = 0;
  let path = [];                                       // pieces of the path being built, already in mm
  let last = null, sub = null;                         // the current point and the sub-path's start, mm (kept across ops)
  let paths = 0;
  const pieces = (list) => {
    let cur = null, start = null;
    for (const it of list) {
      if (it.k === 'm') { cur = start = it.p; continue; }
      if (it.k === 'h') { if (cur && start && Math.hypot(cur[0] - start[0], cur[1] - start[1]) > 1e-9) { ents.push(line(cur[0], cur[1], start[0], start[1])); paths++; } cur = start; continue; }
      if (it.k === 'r') { ents.push(lwpoly(it.pts, { closed: true })); paths++; cur = start = it.pts[0]; continue; }
      if (!cur) { cur = start = it.k === 'l' ? it.p : it.p3; continue; }
      if (it.k === 'l') {
        if (Math.hypot(it.p[0] - cur[0], it.p[1] - cur[1]) > 1e-9) { ents.push(line(cur[0], cur[1], it.p[0], it.p[1])); paths++; }
        cur = it.p;
      } else if (it.k === 'c') {
        const a = bezierArc(cur, it.p1, it.p2, it.p3);
        if (a && a.a0 !== a.a1) ents.push(arc(a.cx, a.cy, a.r, a.a0, a.a1));
        else {
          const len = Math.hypot(it.p1[0] - cur[0], it.p1[1] - cur[1]) + Math.hypot(it.p2[0] - it.p1[0], it.p2[1] - it.p1[1]) + Math.hypot(it.p3[0] - it.p2[0], it.p3[1] - it.p2[1]);
          const n = Math.max(4, Math.min(64, Math.ceil(len / 0.5))), pts = [cur];
          for (let i = 1; i < n; i++) pts.push(bez(cur, it.p1, it.p2, it.p3, i / n));
          pts.push(it.p3);
          ents.push(lwpoly(pts));
        }
        paths++; cur = it.p3;
      }
    }
  };
  const { fnArray, argsArray } = ops;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], a = argsArray[i];
    if (fn === OPS.save) stack.push([ctm, textMode]);
    else if (fn === OPS.restore) { if (stack.length) [ctm, textMode] = stack.pop(); }
    else if (fn === OPS.transform) ctm = mul(a, ctm);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push([ctm, textMode]); if (a && a[0]) ctm = mul(a[0], ctm); }
    else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) [ctm, textMode] = stack.pop(); }
    else if (fn === OPS.setTextRenderingMode) textMode = a[0];
    else if (fn === OPS.showText) {
      for (const g of a[0]) {
        if (typeof g === 'number') { if (glyphs.length) glyphs.at(-1).width -= g; continue; }
        const s = textKey(g.unicode || '');
        if (!s) { if (glyphs.length) glyphs.at(-1).width += g.width || 0; continue; }
        for (let j = 0; j < s.length; j++) glyphs.push({ char: s[j], paint: (textMode & 3) !== 3, width: (g.width || 0) / s.length });
      }
    }
    else if (fn === OPS.constructPath) {
      const [codes, c] = a;
      let k = 0;
      for (const code of codes) {
        if (code === OPS.moveTo) { last = sub = P(c[k], c[k + 1], ctm); path.push({ k: 'm', p: last }); k += 2; }
        else if (code === OPS.lineTo) { last = P(c[k], c[k + 1], ctm); path.push({ k: 'l', p: last }); k += 2; }
        else if (code === OPS.curveTo) { const p1 = P(c[k], c[k + 1], ctm), p2 = P(c[k + 2], c[k + 3], ctm), p3 = P(c[k + 4], c[k + 5], ctm); path.push({ k: 'c', p1, p2, p3 }); last = p3; k += 6; }
        else if (code === OPS.curveTo2) { const p2 = P(c[k], c[k + 1], ctm), p3 = P(c[k + 2], c[k + 3], ctm); path.push({ k: 'c', p1: last || p2, p2, p3 }); last = p3; k += 4; }
        else if (code === OPS.curveTo3) { const p1 = P(c[k], c[k + 1], ctm), p3 = P(c[k + 2], c[k + 3], ctm); path.push({ k: 'c', p1, p2: p3, p3 }); last = p3; k += 4; }
        else if (code === OPS.closePath) { path.push({ k: 'h' }); last = sub; }
        else if (code === OPS.rectangle) {
          const x = c[k], y = c[k + 1], w = c[k + 2], h = c[k + 3];
          path.push({ k: 'r', pts: [P(x, y, ctm), P(x + w, y, ctm), P(x + w, y + h, ctm), P(x, y + h, ctm)] }); last = sub = path[path.length - 1].pts[0]; k += 4;
        }
      }
    } else if (fn === OPS.stroke || fn === OPS.closeStroke || fn === OPS.fill || fn === OPS.eoFill || fn === OPS.fillStroke || fn === OPS.eoFillStroke ||
      fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) {
      if (fn === OPS.closeStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) path.push({ k: 'h' });
      pieces(path); path = []; last = sub = null;
    } else if (fn === OPS.endPath) { path = []; last = sub = null; }            // a clip, or nothing
  }
  let texts = 0;
  for (const it of paintedText(items, glyphs)) {
    const s = String(it.str || '').replace(/\s+$/, '');
    if (!s.trim() || !it.transform) continue;
    const t = it.transform, size = Math.hypot(t[2], t[3]) || it.height || 0;
    if (!(size > 0)) continue;
    const rot = Math.atan2(t[1], t[0]) * 180 / Math.PI, [x, y] = P(0, 0, [1, 0, 0, 1, t[4], t[5]]);
    const r = rot - rot90 * 90;
    ents.push(text(x, y, size * PT * CAP, s, { rot: Math.abs(r) < 1e-6 ? 0 : r }));
    texts++;
  }
  addEntities(doc, ents);
  return { doc, paths, texts };
}

let pdfjsPromise = null;
/** pdf.js, from vendor/pdfjs/, with its worker. */
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('./vendor/pdfjs/pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    });
  }
  return pdfjsPromise;
}

/** A page of a PDF as a drawing (page 1 unless asked). pdfjs: an already loaded pdf.js (tests). */
export async function readPdf(bytes, { page = 1, pdfjs = null } = {}) {
  const lib = pdfjs || await loadPdfjs();
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pdf = await lib.getDocument({ data, verbosity: 0 }).promise;
  try {
    const n = Math.min(Math.max(1, page), pdf.numPages), pg = await pdf.getPage(n);
    const [ops, tc] = await Promise.all([pg.getOperatorList(), pg.getTextContent()]);
    const r = pdfToDoc({ ops, text: tc.items, view: pg.view, rotate: pg.rotate }, lib.OPS), w = (pg.view[2] - pg.view[0]) * PT, h = (pg.view[3] - pg.view[1]) * PT;
    return { ...r, pages: pdf.numPages, page: n, mm: Math.round(pg.rotate / 90) % 2 ? [h, w] : [w, h] };
  } finally { try { await pdf.destroy(); } catch { /* already gone */ } }
}

/** A page of a PDF drawn on a canvas at `dpi` (true size: mmPerPx = 25.4 / dpi). Browser only. */
export async function renderPdfPage(bytes, { page = 1, dpi = 150 } = {}) {
  const lib = await loadPdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  try {
    const n = Math.min(Math.max(1, page), pdf.numPages), pg = await pdf.getPage(n);
    const vp = pg.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const c = canvas.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, canvas.width, canvas.height);
    await pg.render({ canvasContext: c, viewport: vp }).promise;
    return { canvas, w: canvas.width, h: canvas.height, mmPerPx: 25.4 / dpi, pages: pdf.numPages, page: n };
  } finally { try { await pdf.destroy(); } catch { /* already gone */ } }
}

/** Does the file look like a PDF? */
export const isPdf = (bytes) => { const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); return u.length > 4 && u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46; };
