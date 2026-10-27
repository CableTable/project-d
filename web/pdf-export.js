// pdf-export.js — pure: plans the pages of a PDF from a flattened drawing and draws them (pdf-write.js's Page) — pdf-write.test.mjs.
//
// It works from the same flattened items the canvas draws (drawing.js flatten → render.js), honouring the tab's hidden
// layers, so what the preview shows is what is printed. Units are mm, y up, 0,0 at the sheet's bottom-left.
//   page 'sheet'  the page is the sheet, 1:1             'tile'   1:1 on A3 / A4 pages with an overlap and a label on each
//   page 'check'  the sheet fitted to A4 / A3 with a title block (a paper check, not film)
//   mirror (x flipped, emulsion down), negative (black page, white art), black (every colour prints black),
//   separate (one page per layer / print colour), crop / reg marks on every page, strip (file, date, colour).
import { Page, writePdf, winAnsi, textWidthEm } from './pdf-write.js';
import { mmul, mapply, mscale, arcSweep, opsBox, strokeWidth } from './drawing.js';
import { shownItems, itemVisible } from './doc.js';
import { markGeometry } from './layout.js';
import { addBlock, text as dxfText } from './dxf-write.js';

export const PAPERS = { A4: [297, 210], A3: [420, 297], A0: [1189, 841] };   // landscape, mm
export const PART_BORDER = 10;                                       // round a part on its own page, mm
export const TILE = { margin: 8, overlap: 10 };                      // unprinted edge (label goes there) and overlap, mm
export const CHECK = { margin: 10, block: 22 };                      // page edge and the title block's height, mm
export const DEFAULT_OPTIONS = {
  page: 'sheet', tilePaper: 'A3', checkPaper: 'A4',
  mirror: true, negative: false, black: true, separate: true, crop: false, reg: false, strip: true,
  titleBlock: { enabled: true },
};

export const TITLE_FIELDS = ['file', 'scale', 'size', 'date', 'footnote'];
export const TITLE_BLOCK = 'PD_PDF_TITLE';

/** Only typed strings are overrides; an empty string deliberately hides that field. */
export function cleanTitleBlock(value) {
  const out = { enabled: value?.enabled !== false };
  for (const key of TITLE_FIELDS) if (typeof value?.[key] === 'string') out[key] = value[key];
  return out;
}

/** Per-document PDF settings travel in an unused block, like the layout's metadata. */
export function withTitleBlock(raw, value) {
  if (!value) return raw;
  const doc = { ...raw, blocks: { ...raw.blocks } };
  const encoded = btoa(JSON.stringify(cleanTitleBlock(value)).replace(/[^\u0000-\u007f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
  const entities = [];
  for (let i = 0; i < encoded.length; i += 200) entities.push(dxfText(0, 0, 1, encoded.slice(i, i + 200)));
  addBlock(doc, TITLE_BLOCK, entities);
  return doc;
}

export function readTitleBlock(raw) {
  const block = raw.blocks?.[TITLE_BLOCK];
  if (!block) return undefined;
  try {
    const encoded = block.entities.filter((e) => e.type === 'TEXT' && e.r).map((e) => e.r.v[e.r.c.indexOf(1)] ?? '').join('');
    return cleanTitleBlock(JSON.parse(atob(encoded)));
  } catch { return undefined; }
}

const CAPH = 0.718;                                                  // Helvetica's capitals, in ems
const BLACK = [0, 0, 0], WHITE = [1, 1, 1];
const rgbOf = (css) => { const n = parseInt(String(css).slice(1, 7), 16) || 0; return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
/** A layer colour as it prints on white paper: white and near-white go dark. */
function printInk(css) {
  const c = rgbOf(css);
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] > 0.82 ? [0.1, 0.11, 0.13] : c;
}
const mix = (c, bg, a) => c.map((v, i) => v * a + bg[i] * (1 - a));
const trimNum = (n, d = 2) => String(Number(n.toFixed(d)));

// ---------------------------------------------------------------- the plan

/** The first of "base.pdf", "base (2).pdf", … that `taken(name)` (async) says is free: a batch never replaces a PDF that is already there. */
export async function freePdfName(base, taken) {
  let name = base + '.pdf', n = 2;
  while (await taken(name)) name = `${base} (${n++}).pdf`;
  return name;
}

/** Tiles of a sheet w × h on a paper pw × ph: the printable size and how many across and down. */
export function tileGrid(w, h, pw, ph) {
  const tw = pw - 2 * TILE.margin, th = ph - 2 * TILE.margin;
  const count = (len, t) => (len <= t + 1e-9 ? 1 : Math.ceil((len - TILE.overlap) / (t - TILE.overlap) - 1e-9));
  return { tw, th, cols: count(w, tw), rows: count(h, th) };
}

/** The scale a sheet w × h gets on a check-print page pw × ph, and where it sits (page mm). */
export function checkFit(w, h, pw, ph, titleBlock = true) {
  const block = titleBlock ? CHECK.block : 0;
  const aw = pw - 2 * CHECK.margin, ah = ph - 2 * CHECK.margin - block;
  const s = Math.min(aw / w, ah / h);
  return { s, ox: CHECK.margin + (aw - w * s) / 2, oy: CHECK.margin + block + (ah - h * s) / 2 };
}

/** "1 : 3.37" for a scale s (page mm per sheet mm); "2 : 1" when enlarged. */
export function scaleText(s) {
  return s >= 1 ? `${trimNum(s)} : 1` : `1 : ${trimNum(1 / s)}`;
}

/** Automatic facts stay live until that individual field is typed. The caller supplies today's date. */
export function titleBlockTexts(src, p, value) {
  return {
    file: src.name || 'drawing',
    scale: (src.part ? 'NOT 1:1 · scale ' : 'Scale ') + scaleText(p.scale),
    size: `${src.part ? 'Part' : 'Sheet'} ${trimNum(src.sheetW)} × ${trimNum(src.sheetH)} mm · ${p.layer == null ? 'ALL' : p.layer.toUpperCase()} · page ${p.n}/${p.of}`,
    date: src.date || '',
    footnote: src.part ? 'Fitted to one page: not 1:1, not to be used as film' : 'Check print: not to be used as film',
    ...Object.fromEntries(TITLE_FIELDS.filter((k) => typeof value?.[k] === 'string').map((k) => [k, value[k]])),
  };
}

/**
 * What the Part screen exports: the drawing alone (no sheet, no background: those are not in fl) with its dimensions, laid out on a
 * virtual sheet of the part's box plus a border, its corner at the border. src as planPdf takes it, with part: true. null if
 * nothing is shown. { fl, factor, off, hide, name, date } in; the same plus sheetW, sheetH, origin out.
 */
export function partSource(src, border = PART_BORDER) {
  const hide = new Set((src.hide || []).map((s) => s.toLowerCase()));
  let box = null;
  for (const it of shownItems(src.fl)) {
    if (!itemVisible(it, src.off || new Set()) || it.L.some((l) => hide.has(src.fl.layers[l].name.toLowerCase()))) continue;
    const b = it.b.map((v) => v * src.factor);
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
  }
  if (!box || !(box[2] > box[0]) || !(box[3] > box[1])) return null;
  return { ...src, part: true, sheetW: box[2] - box[0] + 2 * border, sheetH: box[3] - box[1] + 2 * border, origin: [box[0] - border, box[1] - border] };
}

/** The printed name of a colour page. */
const colourName = (g) => (g.index == null ? 'ALL' : g.name.toUpperCase());

/**
 * src: { fl, factor (mm per drawing unit), off (Set of hidden layer indexes), sheetW, sheetH, name (for the strip),
 *        date (text for the strip), hide (layer names that are not artwork, e.g. ['sheet', 'marks'] on a layout) }
 * Returns { options, pages: [{ n, of, w, h, layer, tile, scale }], count, build(i) → Page, bytes() → Uint8Array }.
 */
export function planPdf(src, opts) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  o.titleBlock = cleanTitleBlock(o.titleBlock);
  const { fl, off, sheetW: W, sheetH: H } = src;
  const org = src.origin || [0, 0];                                  // where the sheet's corner is, in drawing mm (a part's page: its corner less the border)
  const hide = new Set((src.hide || []).map((s) => s.toLowerCase()));
  const items = shownItems(fl).filter((it) => itemVisible(it, off || new Set()) && !it.L.some((l) => hide.has(fl.layers[l].name.toLowerCase())));
  let groups = [{ index: null, name: 'All', items }];
  if (o.separate) {
    const by = new Map();
    for (const it of items) { if (!by.has(it.L[0])) by.set(it.L[0], []); by.get(it.L[0]).push(it); }
    if (by.size) groups = [...by.keys()].sort((a, b) => a - b).map((index) => ({ index, name: fl.layers[index].name, items: by.get(index) }));
  }
  // what every page is laid out on
  let geos;
  if (o.page === 'tile') {
    const [lw, lh] = PAPERS[o.tilePaper] || PAPERS.A3;
    const a = tileGrid(W, H, lw, lh), b = tileGrid(W, H, lh, lw);
    const [pw, ph, g] = b.cols * b.rows < a.cols * a.rows ? [lh, lw, b] : [lw, lh, a];
    geos = [];
    const stepX = g.tw - TILE.overlap, stepY = g.th - TILE.overlap;
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      geos.push({ w: pw, h: ph, tile: { col: c + 1, row: r + 1, cols: g.cols, rows: g.rows, n: r * g.cols + c + 1, of: g.cols * g.rows, x0: c * stepX, y0: H - r * stepY - g.th, tw: g.tw, th: g.th } });
    }
  } else if (o.page === 'check') {
    const [lw, lh] = PAPERS[o.checkPaper] || PAPERS.A4;
    const a = checkFit(W, H, lw, lh, o.titleBlock.enabled), b = checkFit(W, H, lh, lw, o.titleBlock.enabled);
    const land = b.s > a.s * 1.0001 ? [lh, lw, b] : [lw, lh, a];
    geos = [{ w: land[0], h: land[1], scale: land[2] }];
  } else geos = [{ w: W, h: H }];
  const pages = [];
  for (const g of groups) for (const geo of geos) pages.push({ n: pages.length + 1, w: geo.w, h: geo.h, layer: g.index == null ? null : g.name, tile: geo.tile || null, scale: geo.scale ? geo.scale.s : null, _g: g, _geo: geo });
  pages.forEach((p) => { p.of = pages.length; });

  // the box of everything shown, in sheet mm: the marks go round it
  let box = null;
  for (const it of items) {
    const b = it.b.map((v, i) => v * src.factor - org[i % 2]);
    box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b;
  }
  const plan = {
    options: o, pages, count: pages.length, box,
    build: (i) => drawPage(src, o, plan, pages[i], box),
    bytes: () => writePdf(pages.map((_, i) => plan.build(i)), { title: src.name || 'Project D', subject: o.page === 'check' ? 'Scale ' + scaleText(pages[0].scale) : 'Scale 1 : 1' }),
  };
  return plan;
}

// ---------------------------------------------------------------- drawing a page

/** An arc as cubic Béziers (at most a quarter turn each), through matrix M; the caller has moved to its start. */
function arcTo(page, M, cx, cy, r, a0, sweep) {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9)), da = sweep / n, t = 4 / 3 * Math.tan(da / 4);
  for (let i = 0; i < n; i++) {
    const a = a0 + i * da, b = a + da, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    const p1 = mapply(M, cx + r * (ca - t * sa), cy + r * (sa + t * ca));
    const p2 = mapply(M, cx + r * (cb + t * sb), cy + r * (sb - t * cb));
    const p3 = mapply(M, cx + r * cb, cy + r * sb);
    page.curveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
  }
}

/** flatten's path ops (move, line, arc, close) through matrix M. */
function trace(page, ops, M) {
  let cur = null;
  for (let i = 0; i < ops.length;) {
    const op = ops[i];
    if (op === 0 || op === 1) {
      const p = mapply(M, ops[i + 1], ops[i + 2]);
      if (op === 0) page.moveTo(p[0], p[1]); else page.lineTo(p[0], p[1]);
      cur = [ops[i + 1], ops[i + 2]]; i += 3;
    } else if (op === 2) {
      const [cx, cy, r, a0, a1, cw] = ops.slice(i + 1, i + 7), sw = arcSweep(a0, a1, cw)[1];
      const sx = cx + r * Math.cos(a0), sy = cy + r * Math.sin(a0), p = mapply(M, sx, sy);
      if (!cur) page.moveTo(p[0], p[1]); else if (Math.hypot(sx - cur[0], sy - cur[1]) > 1e-9) page.lineTo(p[0], p[1]);
      arcTo(page, M, cx, cy, r, a0, cw ? -sw : sw);
      cur = [cx + r * Math.cos(cw ? a0 - sw : a0 + sw), cy + r * Math.sin(cw ? a0 - sw : a0 + sw)];
      i += 7;
    } else { page.close(); i++; }
  }
}

function circle(page, M, cx, cy, r) {
  const p = mapply(M, cx + r, cy);
  page.moveTo(p[0], p[1]);
  arcTo(page, M, cx, cy, r, 0, Math.PI * 2);
  page.close();
}

/** Text at (x, y) in page mm with the page-level matrix B (the mirror, or none). ha: 0 left, 1 centre, 2 right. */
function textAt(page, B, str, x, y, size, ha = 0) {
  const coded = winAnsi(str), w = textWidthEm(coded) * size;
  page.text(mmul(B, [size, 0, 0, size, x - w * ha / 2, y]), coded);
}

/** The text cut to a width, ending in "...". */
function fitText(str, size, maxW) {
  let s = winAnsi(str);
  if (textWidthEm(s) * size <= maxW) return s;
  while (s.length > 1 && textWidthEm(s + '...') * size > maxW) s = s.slice(0, -1);
  return s + '...';
}

function wrapLines(lines, max, size, wf) {
  const out = [];
  for (const line of lines) {
    let now = '';
    for (const word of line.split(' ')) {
      const next = now ? now + ' ' + word : word;
      if (now && textWidthEm(winAnsi(next)) * size * wf > max) { out.push(now); now = word; } else now = next;
    }
    out.push(now);
  }
  return out;
}

function drawText(page, it, M, ink) {
  const size = it.h / CAPH, c = Math.cos(it.rot), s = Math.sin(it.rot);
  const T = mmul(M, [c * it.wf * it.mx, s * it.wf * it.mx, -s * it.my, c * it.my, it.x, it.y]);
  if (it.h * mscale(M) < 0.15) return;
  page.fillColor(ink);
  const put = (line, yUp) => {
    const coded = winAnsi(line);
    if (!coded.trim()) return;
    const x0 = -textWidthEm(coded) * size * it.ha / 2;
    page.text(mmul(T, [size, 0, 0, size, x0, yUp]), coded);
  };
  if (it.multi) {
    const lines = it.wrap > 0 ? wrapLines(it.lines, it.wrap * 1.02, size, it.wf) : it.lines, n = lines.length;
    const total = (n - 1) * it.lh + it.h, top = it.va === 'top' ? 0 : it.va === 'middle' ? -total / 2 : -total;
    lines.forEach((l, i) => put(l, -(top + it.h + i * it.lh)));
  } else put(it.lines.join(' '), { alphabetic: 0, bottom: 0.3 * it.h, middle: -it.h / 2, top: -it.h }[it.va] || 0);
}

/** A patterned hatch: its lines clipped to its boundary; too fine to print apart, a tint. */
function drawHatch(page, it, M, ink, bg) {
  const lb = opsBox(it.ops);
  if (!lb) return;
  const sc = mscale(M), corners = [[lb[0], lb[1]], [lb[2], lb[1]], [lb[2], lb[3]], [lb[0], lb[3]]];
  let tint = !it.fam.length;
  page.save();
  trace(page, it.ops, M); page.clip(true);
  page.strokeColor(ink); page.lineWidth(0.15); page.dash([]);
  const lines = [];
  for (const f of it.fam) {
    const dx = Math.cos(f.a), dy = Math.sin(f.a), nx = -dy, ny = dx, sp = f.ox * nx + f.oy * ny;
    if (Math.abs(sp) * sc < 0.4) { tint = true; continue; }
    const across = corners.map(([x, y]) => ((x - f.bx) * nx + (y - f.by) * ny) / sp);
    const n0 = Math.floor(Math.min(...across)), n1 = Math.ceil(Math.max(...across));
    if (n1 - n0 > 4000) { tint = true; continue; }
    for (let n = n0; n <= n1; n++) {
      const px = f.bx + n * f.ox, py = f.by + n * f.oy;
      const along = corners.map(([x, y]) => (x - px) * dx + (y - py) * dy), s0 = Math.min(...along), s1 = Math.max(...along);
      lines.push([px + dx * s0, py + dy * s0, px + dx * s1, py + dy * s1]);
    }
  }
  for (const [x1, y1, x2, y2] of lines) { const a = mapply(M, x1, y1), b = mapply(M, x2, y2); page.moveTo(a[0], a[1]); page.lineTo(b[0], b[1]); }
  if (lines.length) page.stroke();
  if (tint) {
    page.fillColor(mix(ink, bg, 0.3));
    corners.forEach(([x, y], i) => { const p = mapply(M, x, y); if (i) page.lineTo(p[0], p[1]); else page.moveTo(p[0], p[1]); });
    page.close(); page.fill();
  }
  page.restore();
}

function drawPage(src, o, plan, p, artBox) {
  const { fl, factor: F, sheetW: W, sheetH: H } = src, org = src.origin || [0, 0];
  const g = p._g, geo = p._geo, check = o.page === 'check', tile = geo.tile;
  const neg = o.negative && !check, mirror = o.mirror && !check;
  const bg = neg ? BLACK : WHITE, markInk = neg ? WHITE : BLACK;
  const inkOf = (css, exact) => (neg ? WHITE : o.black ? BLACK : exact ? rgbOf(css) : printInk(css));
  const page = new Page(p.w, p.h);
  // sheet mm → page mm
  const flip = mirror ? [-1, 0, 0, 1, W, 0] : [1, 0, 0, 1, 0, 0];
  let B = [1, 0, 0, 1, 0, 0];                                                        // the page-level matrix, for labels
  let M0 = flip;
  if (tile) { M0 = mmul([1, 0, 0, 1, TILE.margin - tile.x0, TILE.margin - tile.y0], flip); }
  if (check) { const f = geo.scale; M0 = [f.s, 0, 0, f.s, f.ox, f.oy]; }
  if (!tile && !check && mirror) B = flip;                                           // a sheet-size page is mirrored whole
  const ws = mscale(M0);
  const minW = check ? 0.1 : 0.08;

  if (neg) { page.fillColor(BLACK); page.rect(0, 0, p.w, p.h); page.fill(); }
  if (tile) { page.save(); page.rect(TILE.margin, TILE.margin, tile.tw, tile.th); page.clip(); }

  if (check) {                                                                       // the sheet's own outline; nothing is drawn outside it
    page.strokeColor([0.35, 0.35, 0.35]); page.lineWidth(0.2); page.dash([]);
    const a = mapply(M0, 0, 0), b = mapply(M0, W, H);
    if (!src.part) { page.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); page.stroke(); }     // a part's page has no sheet outline
    page.save(); page.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); page.clip();
  }

  const fulls = new Map();
  const fullFor = (m) => { let M = fulls.get(m); if (!M) { M = mmul(M0, mmul([F, 0, 0, F, -org[0], -org[1]], fl.mats[m])); fulls.set(m, M); } return M; };
  page.lineWidth(0.25); page.dash([]);
  for (const it of g.items) {
    const M = fullFor(it.m), sc = mscale(M);
    if (it.k === 'p' && !it.fill) {
      const w = strokeWidth(it, F, mscale(fl.mats[it.m])) * ws;
      let dash = it.dash && it.dash.reduce((a, x) => a + x, 0) * sc >= 0.3 ? it.dash.map((x) => x * sc) : it.dpx ? it.dpx.map((x) => x * 0.3) : null;
      if (dash && dash.reduce((a, x) => a + x, 0) < 0.3) dash = null;
      page.strokeColor(inkOf(it.css)); page.lineWidth(w); page.dash(dash || []);
      trace(page, it.ops, M); page.stroke();
    } else if (it.k === 'p') {
      page.fillColor(it.a != null && it.a < 1 ? mix(inkOf(it.css, it.exact), bg, it.a) : inkOf(it.css, it.exact));
      trace(page, it.ops, M); page.fill(true);
    } else if (it.k === 'w') {
      page.fillColor(bg); trace(page, it.ops, M); page.fill(true);
    } else if (it.k === 'n') {
      page.fillColor(inkOf(it.css)); circle(page, M, it.x, it.y, 0.4 / (sc || 1)); page.fill();
    } else if (it.k === 't') drawText(page, it, M, inkOf(it.css));
    else if (it.k === 'h') drawHatch(page, it, M, inkOf(it.css), bg);
  }

  // crop and registration marks round the art, the same on every page so the colours register
  if ((o.crop || o.reg) && artBox) {
    const L = { count: 1, x0: artBox[0], y0: H - artBox[3], gridW: artBox[2] - artBox[0], gridH: artBox[3] - artBox[1] };
    const mk = markGeometry(L, { crop: o.crop, reg: o.reg });
    page.strokeColor(markInk); page.lineWidth(Math.max(0.25 * (check ? ws : 1), minW)); page.dash([]);
    const seg = ([x1, y1, x2, y2]) => { const a = mapply(M0, x1, H - y1), b = mapply(M0, x2, H - y2); page.moveTo(a[0], a[1]); page.lineTo(b[0], b[1]); };
    mk.crop.forEach(seg);
    for (const m of mk.reg) { circle(page, M0, m.cx, H - m.cy, m.r); m.cross.forEach(seg); }
    page.stroke();
  }
  if (tile || check) page.restore();

  // labels
  const colour = colourName(g), job = `${src.name || 'drawing'} · ${src.date || ''} · ${colour} · ${p.n}/${p.of}`;
  page.fillColor(markInk); page.strokeColor(markInk);
  if (tile) {
    page.lineWidth(0.1); page.dash([2, 2]); page.rect(TILE.margin, TILE.margin, tile.tw, tile.th); page.stroke(); page.dash([]);
    const label = `Tile ${tile.n}/${tile.of} · column ${tile.col} of ${tile.cols}, row ${tile.row} of ${tile.rows} · overlap ${TILE.overlap} mm` +
      (o.strip ? ` · ${job}` : ` · ${colour}`);
    page.fillColor(markInk);
    page.text([2.8, 0, 0, 2.8, TILE.margin, 2.6], fitText(label, 2.8, p.w - 2 * TILE.margin));
  } else if (check && o.titleBlock.enabled) {
    const m = CHECK.margin, x0 = m, x1 = p.w - m, y0 = m, y1 = m + CHECK.block, half = (x1 - x0) / 2;
    page.lineWidth(0.25); page.rect(x0, y0, x1 - x0, CHECK.block); page.stroke();
    const texts = titleBlockTexts(src, p, o.titleBlock);
    page.text([5, 0, 0, 5, x0 + 3, y1 - 8], fitText(texts.file, 5, half - 6));
    page.text([3.2, 0, 0, 3.2, x0 + 3, y1 - 14], fitText(texts.size, 3.2, half - 6));
    page.text([3, 0, 0, 3, x0 + 3, y0 + 3.5], fitText(texts.footnote, 3, half - 6));
    textAt(page, [1, 0, 0, 1, 0, 0], fitText(texts.scale, 5, half - 6), x1 - 3, y1 - 8, 5, 2);
    textAt(page, [1, 0, 0, 1, 0, 0], fitText(texts.date, 3.2, half - 6), x1 - 3, y1 - 14, 3.2, 2);
  } else if (!check && o.strip) {
    const size = Math.min(6, Math.max(2.5, Math.min(W, H) / 150));
    textAt(page, B, job, W - Math.min(10, W / 20), Math.min(6, H / 20), size, 2);
  }
  return page;
}
