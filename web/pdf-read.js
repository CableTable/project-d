// pdf-read.js — a vector PDF as a drawing, and a PDF page as a picture. The conversion is pure (pdf.js's operator list and
// text content in, a DXF document in dxf-write.js's shape out) — pdf-read.test.mjs. pdf.js itself is vendored in
// vendor/pdfjs/ (tools/vendor.mjs) and only loaded when a PDF is opened.
//
//   readPdf(bytes, { page, pdfjs })   → { doc, paths, texts, pictures, stencils, pages, page, mm: [w, h] }   (the drawing, in mm; pictures are IMAGE entities)
//   renderPdfPage(bytes, { page, dpi }) → { canvas, w, h, mmPerPx, pages }              (the page as a picture)
//   renderPdfPages(bytes, { onPage }) → { canvas, w, h, mmPerPx, dpi, pages }          (every page side by side on one picture; pageLayout is the pure placement)
//   pdfToDoc({ ops, text, view, rotate }, OPS) → { doc, paths, texts }                  (the pure part; rotate: the page's /Rotate)
import { newDoc, addLayer, arc, lwpoly, text, entity } from './dxf-write.js';
import { toRgba, encodePng } from './pictures.js';
import { rgbKey, rgbHex, cmykRgb } from './colour.js';
import { fillHoles, edgeDist } from './fill.js';

/** mm in one PDF point. */
export const PT = 25.4 / 72;
const PICTURES = 'PDF pictures';                      // one layer for all the pictures, so one switch hides them
const CAP = 0.7;                                      // a text's capitals are about 0.7 of its font size

const textKey = (s) => s.normalize('NFKC').replace(/\s/g, '');

/** pdf.js extracts searchable text even when Tr is 3 (invisible) or 7 (clip only). */
function paintedText(items, glyphs) {
  if (!glyphs.length) return items;
  if (glyphs.every((g) => !g.paint)) return [];
  const source = glyphs.map((g) => g.char).join('');
  let cursor = 0;
  return items.flatMap((it) => {
    const key = textKey(it.str || ''), at = source.indexOf(key, cursor);
    // shortcut: uncorrelated bidi text stays intact; use positioned glyph matching when a mixed-mode bidi PDF needs it.
    if (!key || at < 0) return [it];
    cursor = at + key.length;
    const part = glyphs.slice(at, cursor);
    if (part.every((g) => g.paint && g.layer === part[0].layer && g.position === part[0].position)) return [{ ...it, layer: part[0].layer, position: part[0].position }];
    if (part.every((g) => !g.paint)) return [];
    // A single extracted item can span Tr changes: split it at the original glyph advances.
    const chars = it.str.normalize('NFKC').split(''), runs = [], widths = [0];
    for (const g of part) widths.push(widths.at(-1) + g.width);
    const total = widths.at(-1), fraction = (n) => total > 0 ? widths[n] / total : n / part.length;
    let n = 0, start = 0, first = 0, paint = part[0].paint, layer = part[0].layer, position = part[0].position;
    const emit = (end) => {
      if (!paint) return;
      const transform = it.transform.slice(), shift = (it.width || 0) * fraction(first), norm = Math.hypot(transform[0], transform[1]) || 1;
      transform[4] += shift * transform[0] / norm; transform[5] += shift * transform[1] / norm;
      runs.push({ ...it, layer, position, str: chars.slice(start, end).join(''), transform, width: (it.width || 0) * (fraction(n) - fraction(first)) });
    };
    for (let i = 0; i < chars.length; i++) {
      if (!textKey(chars[i])) continue;
      if (part[n].paint !== paint || part[n].layer !== layer || part[n].position !== position) {
        emit(i); start = i; first = n; paint = part[n].paint; layer = part[n].layer; position = part[n].position;
      }
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
 * in mm with the page's bottom-left at 0,0. Contiguous straight and short-polyline curve pieces of one painted path join
 * within 1e-6 mm; stroke-only circular Béziers stay ARCs. Fills close subpaths, flatten curves within 0.01 mm and keep
 * their colour on the outline. Outline colours get first-seen #RRGGBB layers, entities ByLayer; TEXT uses its fill colour.
 * paths counts emitted entities (one polyline = 1); text is TEXT at its place and size.
 * rotate: the page's /Rotate (clockwise degrees), so a portrait plotter page with /Rotate 90 comes out landscape, as it is shown.
 * images: Map from a paintImageXObject's name (a paintInlineImageXObject's data object) → { w, h, px (PNG data URL) }; each painted one is an IMAGE
 * on layer "PDF pictures" (pictures counts them); 1-colour stencil masks are not shown (stencils counts them).
 * OPS: pdf.js's operator numbers.
 */
export function pdfToDoc({ ops, text: items = [], view = [0, 0, 0, 0], rotate = 0, images = new Map() }, OPS) {
  const doc = newDoc(4), ents = [];
  doc.layers = {};
  const layerFor = (rgb) => {
    const name = rgbHex(rgb).toUpperCase();
    if (!doc.layers[name]) {
      const key = rgbKey(rgb);
      addLayer(doc, name, key.startsWith('tc:') ? { tc: +key.slice(3) } : { aci: +key.slice(4) });
    }
    return name;
  };
  const ox = view[0], oy = view[1], rot90 = ((Math.round(rotate / 90) % 4) + 4) % 4;
  const W = (view[2] - view[0]) * PT, H = (view[3] - view[1]) * PT;
  const P = (x, y, m) => {
    const px = ((m[0] * x + m[2] * y + m[4]) - ox) * PT, py = ((m[1] * x + m[3] * y + m[5]) - oy) * PT;
    return rot90 === 0 ? [px, py] : rot90 === 1 ? [py, W - px] : rot90 === 2 ? [W - px, H - py] : [H - py, px];
  };
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [], glyphs = [];
  let textMode = 0;
  let strokeColour = [0, 0, 0], fillColour = [0, 0, 0];
  let path = [];                                       // pieces of the path being built, already in mm
  let last = null, sub = null;                         // the current point and the sub-path's start, mm (kept across ops)
  let paths = 0, stencils = 0;
  const pics = [];
  const pieces = (list, filled, stroked) => {
    const first = ents.length, style = { layer: layerFor(stroked ? strokeColour : fillColour), ...(filled ? { fill: rgbKey(fillColour) } : {}) };
    let cur = null, start = null;
    let chain = [];
    const flush = (closed = filled) => {
      if (closed && chain.length > 2 && Math.hypot(chain.at(-1)[0] - chain[0][0], chain.at(-1)[1] - chain[0][1]) <= 1e-6) chain.pop(); // a repeated start would be a zero-length side
      if (chain.length > 1) { ents.push(lwpoly(chain, { ...style, closed })); paths++; }
      chain = [];
    };
    const join = (pts) => {
      if (chain.length && Math.hypot(chain.at(-1)[0] - pts[0][0], chain.at(-1)[1] - pts[0][1]) > 1e-6) flush();
      if (!chain.length) chain.push(pts[0]);
      for (let i = 1; i < pts.length; i++) chain.push(pts[i]);
    };
    for (const it of list) {
      if (it.k === 'm') {
        if (chain.length && (filled || Math.hypot(chain.at(-1)[0] - it.p[0], chain.at(-1)[1] - it.p[1]) > 1e-6)) flush();
        cur = start = it.p; continue;
      }
      if (it.k === 'h') {
        if (cur && start) {
          const closed = chain.length > 0 && Math.hypot(chain[0][0] - start[0], chain[0][1] - start[1]) <= 1e-6;
          if (!closed && Math.hypot(cur[0] - start[0], cur[1] - start[1]) > 1e-9) join([cur, start]);
          flush(filled || closed);
        }
        cur = start; continue;
      }
      if (it.k === 'r') { flush(); ents.push(lwpoly(it.pts, { ...style, closed: true })); paths++; cur = start = it.pts[0]; continue; }
      if (!cur) { cur = start = it.k === 'l' ? it.p : it.p3; continue; }
      if (it.k === 'l') {
        if (Math.hypot(it.p[0] - cur[0], it.p[1] - cur[1]) > 1e-9) join([cur, it.p]);
        cur = it.p;
      } else if (it.k === 'c') {
        const a = bezierArc(cur, it.p1, it.p2, it.p3);
        // shortcut: arcs break the chain, join them as lwpoly bulges (dxf-write.js:74) once flatten draws bulges in a test
        if (!filled && a && a.a0 !== a.a1) { flush(); ents.push(arc(a.cx, a.cy, a.r, a.a0, a.a1, style)); paths++; }
        else if (filled) {
          const pts = [cur], mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          const flatten = (p0, p1, p2, p3) => {
            if (Math.max(edgeDist(p1, [p0, p3]), edgeDist(p2, [p0, p3])) <= 0.01) { pts.push(p3); return; }
            const a = mid(p0, p1), b = mid(p1, p2), c = mid(p2, p3), d = mid(a, b), e = mid(b, c), f = mid(d, e);
            flatten(p0, a, d, f); flatten(f, e, c, p3);
          };
          flatten(cur, it.p1, it.p2, it.p3); join(pts);
        }
        else {
          const len = Math.hypot(it.p1[0] - cur[0], it.p1[1] - cur[1]) + Math.hypot(it.p2[0] - it.p1[0], it.p2[1] - it.p1[1]) + Math.hypot(it.p3[0] - it.p2[0], it.p3[1] - it.p2[1]);
          const n = Math.max(4, Math.min(64, Math.ceil(len / 0.5))), pts = [cur];
          for (let i = 1; i < n; i++) pts.push(bez(cur, it.p1, it.p2, it.p3, i / n));
          pts.push(it.p3);
          join(pts);
        }
        cur = it.p3;
      }
    }
    flush();
    if (filled) {
      // fillHoles cuts nested outlines, but an inner fill would paint the hole back in.
      const holes = fillHoles(ents.slice(first)), depth = new Map();
      for (const inner of holes.values()) for (const e of inner) depth.set(e, (depth.get(e) || 0) + 1);
      for (const [e, n] of depth) if (n % 2) delete e.fill;
    }
  };
  const { fnArray, argsArray } = ops;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], a = argsArray[i];
    if (fn === OPS.save) stack.push([ctm, textMode, strokeColour, fillColour]);
    else if (fn === OPS.restore) { if (stack.length) [ctm, textMode, strokeColour, fillColour] = stack.pop(); }
    else if (fn === OPS.transform) ctm = mul(a, ctm);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push([ctm, textMode, strokeColour, fillColour]); if (a && a[0]) ctm = mul(a[0], ctm); }
    else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) [ctm, textMode, strokeColour, fillColour] = stack.pop(); }
    // pdf.js normalizes RGB ops to byte channels (Uint8ClampedArray), including g/G, k/K and sc/scn.
    else if (fn === OPS.setStrokeRGBColor) strokeColour = Array.from(a);
    else if (fn === OPS.setFillRGBColor) fillColour = Array.from(a);
    else if ([OPS.setStrokeGray, OPS.setFillGray, OPS.setStrokeCMYKColor, OPS.setFillCMYKColor,
      OPS.setStrokeColor, OPS.setFillColor, OPS.setStrokeColorN, OPS.setFillColorN].includes(fn) && a && [1, 3, 4].includes(a.length) && Array.from(a).every(Number.isFinite)) {
      const rgb = a.length === 4 ? cmykRgb(Array.from(a, (n) => n * 100)) : (a.length === 1 ? [a[0], a[0], a[0]] : Array.from(a)).map((n) => Math.round(255 * Math.max(0, Math.min(1, n))));
      if ([OPS.setStrokeGray, OPS.setStrokeCMYKColor, OPS.setStrokeColor, OPS.setStrokeColorN].includes(fn)) strokeColour = rgb;
      else fillColour = rgb;
    }
    else if (fn === OPS.setTextRenderingMode) textMode = a[0];
    else if (fn === OPS.showText) {
      for (const g of a[0]) {
        if (typeof g === 'number') { if (glyphs.length) glyphs.at(-1).width -= g; continue; }
        const s = textKey(g.unicode || '');
        if (!s) { if (glyphs.length) glyphs.at(-1).width += g.width || 0; continue; }
        const paint = (textMode & 3) !== 3, layer = paint ? layerFor(fillColour) : null;
        for (let j = 0; j < s.length; j++) glyphs.push({ char: s[j], paint, layer, position: ents.length, width: (g.width || 0) / s.length });
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
      const filled = fn !== OPS.stroke && fn !== OPS.closeStroke, stroked = fn !== OPS.fill && fn !== OPS.eoFill;
      if (path.length) pieces(path, filled, stroked);
      path = []; last = sub = null;
    } else if (fn === OPS.endPath) { path = []; last = sub = null; }            // a clip, or nothing
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const img = images.get(a[0]);                                              // shortcut: the clip is ignored as for lines, a clipped picture shows whole
      if (!img) continue;
      if (!doc.layers[PICTURES]) addLayer(doc, PICTURES, { aci: 7 });
      const o = P(0, 0, ctm), x = P(1, 0, ctm), y = P(0, 1, ctm);               // the unit square: u, v are one pixel's sides (DXF), group 13 the size in pixels
      const pic = entity('IMAGE', [[10, o[0]], [20, o[1]], [30, 0], [11, (x[0] - o[0]) / img.w], [21, (x[1] - o[1]) / img.w], [31, 0], [12, (y[0] - o[0]) / img.h], [22, (y[1] - o[1]) / img.h], [32, 0], [13, img.w], [23, img.h]], { layer: PICTURES });
      pic.r.px = img.px; pics.push(pic);
    } else if (fn === OPS.paintImageMaskXObject || fn === OPS.paintImageMaskXObjectGroup || fn === OPS.paintImageMaskXObjectRepeat) stencils++;
  }
  let texts = 0;
  const textAt = new Map();
  for (const it of paintedText(items, glyphs)) {
    const s = String(it.str || '').replace(/\s+$/, '');
    if (!s.trim() || !it.transform) continue;
    const t = it.transform, size = Math.hypot(t[2], t[3]) || it.height || 0;
    if (!(size > 0)) continue;
    const rot = Math.atan2(t[1], t[0]) * 180 / Math.PI, [x, y] = P(0, 0, [1, 0, 0, 1, t[4], t[5]]);
    const r = rot - rot90 * 90;
    const position = it.position ?? ents.length;
    if (!textAt.has(position)) textAt.set(position, []);
    textAt.get(position).push(text(x, y, size * PT * CAP, s, { layer: it.layer || layerFor([0, 0, 0]), rot: Math.abs(r) < 1e-6 ? 0 : r }));
    texts++;
  }
  for (let i = 0; i <= ents.length; i++) {
    for (const e of textAt.get(i) || []) doc.entities.push(e);
    if (i < ents.length) doc.entities.push(ents[i]);
  }
  doc.entities.unshift(...pics);                       // under every line and text (render.js also paints pictures first)
  return { doc, paths, texts, pictures: pics.length, stencils };
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
  // no OffscreenCanvas / ImageDecoder: the pictures then come as plain pixels (data, kind), not a bitmap
  const pdf = await lib.getDocument({ data, verbosity: 0, isOffscreenCanvasSupported: false, isImageDecoderSupported: false }).promise;
  try {
    const n = Math.min(Math.max(1, page), pdf.numPages), pg = await pdf.getPage(n);
    const [ops, tc] = await Promise.all([pg.getOperatorList(), pg.getTextContent()]);
    const images = new Map();
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], a = ops.argsArray[i];
      if (fn !== lib.OPS.paintImageXObject && fn !== lib.OPS.paintInlineImageXObject) continue;
      if (images.has(a[0])) continue;
      const store = typeof a[0] === 'string' && a[0].startsWith('g_') ? pg.commonObjs : pg.objs;
      let data = a[0];
      if (typeof data === 'string') data = await new Promise((done) => {                // a packed (Flate) picture can still be on its way when the list is ready: wait for it, but not for ever
        const give = setTimeout(() => done(null), 10000);
        try { store.get(data, (d) => { clearTimeout(give); done(d); }); } catch { clearTimeout(give); done(null); }
      });
      const px = toRgba(data || {});
      if (px) images.set(a[0], { w: px.w, h: px.h, px: await encodePng(px.w, px.h, px.rgba) });
    }
    const r = pdfToDoc({ ops, text: tc.items, view: pg.view, rotate: pg.rotate, images }, lib.OPS), w = (pg.view[2] - pg.view[0]) * PT, h = (pg.view[3] - pg.view[1]) * PT;
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

/** Where every page goes on one picture: left to right, `gapMm` apart, top edges aligned, each at its own size, one mm per px. `sizes` are [w, h] in PDF points (as shown, rotation included).
 *  dpi = min(maxDpi, the largest that keeps a side <= maxSide px and the area <= maxArea px). → { dpi, mmPerPx, W, H, cells: [{ x, y, w, h }] } (pixels). */
export function pageLayout(sizes, { maxDpi = 150, gapMm = 10, maxSide = 16384, maxArea = 64e6 } = {}) {
  const at = (dpi) => {
    const gap = Math.round(gapMm / 25.4 * dpi), cells = [];
    let x = 0;
    for (const [w, h] of sizes) { const c = { x, y: 0, w: Math.ceil(w * dpi / 72), h: Math.ceil(h * dpi / 72) }; cells.push(c); x += c.w + gap; }
    return { dpi, mmPerPx: 25.4 / dpi, W: x - gap, H: Math.max(...cells.map((c) => c.h)), cells };
  };
  const fits = (l) => l.W <= maxSide && l.H <= maxSide && l.W * l.H <= maxArea;
  let dpi = maxDpi, lay = at(dpi);
  if (fits(lay)) return lay;
  dpi = Math.max(1, Math.floor(dpi * Math.min(maxSide / lay.W, maxSide / lay.H, Math.sqrt(maxArea / (lay.W * lay.H)))));   // the size is linear in dpi: jump close to it, then settle past the rounding
  while (dpi > 1 && !fits(at(dpi))) dpi--;
  while (dpi < maxDpi && fits(at(dpi + 1))) dpi++;
  return at(dpi);
}

/** Every page of a PDF on ONE canvas (pageLayout; 10 mm between pages), one page at a time, the PDF opened once. `onPage(k, n)` runs before page k of n is drawn.
 *  → { canvas, w, h, mmPerPx, dpi, pages }. Browser only. */
export async function renderPdfPages(bytes, { onPage = () => {}, ...opts } = {}) {
  const lib = await loadPdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  try {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) pages.push(await pdf.getPage(n));
    const lay = pageLayout(pages.map((pg) => { const v = pg.getViewport({ scale: 1 }); return [v.width, v.height]; }), opts);
    const canvas = document.createElement('canvas');
    canvas.width = lay.W; canvas.height = lay.H;
    const out = canvas.getContext('2d');
    for (const [i, pg] of pages.entries()) {
      onPage(i + 1, pages.length);
      const cell = lay.cells[i], part = document.createElement('canvas');
      part.width = cell.w; part.height = cell.h;
      const c = part.getContext('2d');
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, cell.w, cell.h);
      await pg.render({ canvasContext: c, viewport: pg.getViewport({ scale: lay.dpi / 72 }) }).promise;
      out.drawImage(part, cell.x, cell.y);
      part.width = part.height = 0; pg.cleanup();                                   // the page's canvas is freed at once
    }
    return { canvas, w: lay.W, h: lay.H, mmPerPx: lay.mmPerPx, dpi: lay.dpi, pages: pages.length };
  } finally { try { await pdf.destroy(); } catch { /* already gone */ } }
}

/** Does the file look like a PDF? */
export const isPdf = (bytes) => { const u = ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes); return u.length > 4 && u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46; };
