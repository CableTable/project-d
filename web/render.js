// render.js — draws a flattened drawing (drawing.js) on a <canvas> laid over the sheet.
// Ported from Project R's viewer: strokes batched by colour/width/dash, text, hatches, ACI 7 flipped for the sheet.
import { mmul, mscale, mapply, opsBox, CAP, fontOfStyle, strokeWidth } from './drawing.js';
import { placement, shownItems, itemVisible, spaceOf } from './doc.js';
import { paintMode } from './wireframe.js';
import { viewOrigin } from './view-origin.js';
import { drawingPreviewBox, overlayBox } from './preview.js';
import { outsideView, subPixel, skipPoint, maxScale } from './perf.js';
import { SNAP_NAME } from './snap.js';
import { pictureBitmap } from './pictures.js';

const SHEETS = { light: { bg: '#ffffff', fg: '#1b1d22' }, dark: { bg: '#000000', fg: '#e8e8ec' } };
/** The canvas font of a text item: its style's font (Standard, Arial-like or Mono), bold when its MTEXT font code says so. */
export const FONT_FAMILY = { Standard: '"Segoe UI", Roboto, system-ui, sans-serif', Arial: 'Arial, "Liberation Sans", Helvetica, sans-serif', Mono: '"Cascadia Mono", Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace' };
export const fontOf = (it) => (it.bold ? 'bold ' : '') + '100px ' + FONT_FAMILY[it.font || fontOfStyle(it.st)];
const lum = (css) => { const n = parseInt(css.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const darken = (css, f) => '#' + [16, 8, 0].map((s) => Math.round(((parseInt(css.slice(1), 16) >> s) & 255) * f).toString(16).padStart(2, '0')).join('');

/** A line colour as it shows on the sheet: white goes dark on the light sheet, black goes light on the dark one. */
export const DIM_LIGHT = '#0f766e', DIM_DARK = '#5eead4';   // the theme's dimension colour (--dim); a new Dimensions layer is DIM_LIGHT
const inkMemo = new Map();            // a drawing has a handful of colours but 100k items: work each out once
export function ink(css, dark) {
  const key = (dark ? 'd' : 'l') + css;
  let v = inkMemo.get(key);
  if (v === undefined) { v = inkOf(css, dark); inkMemo.set(key, v); }
  return v;
}
function inkOf(css, dark) {
  if (dark && css === DIM_LIGHT) return DIM_DARK;
  const l = lum(css);
  if (!dark) return l > 0.8 ? SHEETS.light.fg : l > 0.55 ? darken(css, 0.6) : css;
  if (l >= 0.2) return css;
  const n = parseInt(css.slice(1), 16), ch = [n >> 16, (n >> 8) & 255, n & 255];
  if (Math.max(...ch) - Math.min(...ch) < 40) return SHEETS.dark.fg;
  return '#' + ch.map((c) => Math.round(c + (255 - c) * 0.45).toString(16).padStart(2, '0')).join('');
}

function trace(c, ops, origin, pxPerUnit) {
  let x, y;
  for (let i = 0; i < ops.length;) {
    const op = ops[i];
    if (op === 0) { x = ops[i + 1]; y = ops[i + 2]; c.moveTo(x - origin[0], y - origin[1]); i += 3; }
    else if (op === 1) {
      const nx = ops[i + 1], ny = ops[i + 2];
      // Keep each run's end before a move, arc, close or the end of ops.
      if (ops[i + 3] !== 1 || !skipPoint(nx - x, ny - y, pxPerUnit)) {
        c.lineTo(nx - origin[0], ny - origin[1]); x = nx; y = ny;
      }
      i += 3;
    }
    else if (op === 2) { c.arc(ops[i + 1] - origin[0], ops[i + 2] - origin[1], ops[i + 3], ops[i + 4], ops[i + 5], ops[i + 6] === 1); x = y = undefined; i += 7; }
    else { c.closePath(); x = y = undefined; i++; }
  }
}

/**
 * Paints into `canvas` (already sized to w*dpr by h*dpr). Returns how many items the main drawing painted.
 * o: { strip (a layout slot's items are culled to the view: the strip of a pan end, TODO 324a), keep (do not clear first: paint another drawing on top), fl, off, factor, sheetH, ox, oy, scale (px per sheet mm), w, h (css px), dpr, dark,
 *       tint (one css colour to draw everything in: a part off the sheet), previewBounds (optional callback with the flattened preview's CSS-pixel box),
 *       bg (the background picture: bitmap, w, h, mm, x, y, visible), hl (items drawn again in `accent`: the selection), marks ([x, y] points in drawing units: Set length's picks), dim (a dimension being placed or moved: edit.js dimGeometry), accent (css colour), gaps ([x, y] drawing units: a ring each), markCol (css colour of the rings) }
 */
export function paintDrawing(canvas, o) {
  const { fl, off, factor, sheetH, ox, oy, scale, w, h, dpr, dark } = o;
  const c = canvas.getContext('2d');
  const over = o.part === 'over';                      // part 'base' stops after the drawing itself, part 'over' paints only the rest on a base kept on the canvas (TODO 258 / 259)
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (!o.keep && !over) c.clearRect(0, 0, canvas.width, canvas.height);
  if (!over && !o.wireframe && o.bg && o.bg.visible && o.bg.bitmap) {
    const b = o.bg, k = scale * dpr;                                  // the background, dimmed, under the drawing (mm, y up)
    c.save();
    c.setTransform(k, 0, 0, k, 0, 0);
    c.globalAlpha = 0.4;
    c.translate(b.x - ox, sheetH - b.y - oy); c.rotate(-(b.rot || 0) * Math.PI / 180);          // about the bottom-left corner; the canvas y runs down, so anticlockwise is minus
    c.drawImage(b.bitmap, 0, -b.h * b.mm, b.w * b.mm, b.h * b.mm);
    c.restore();
  }
  if (!fl) return;
  if (o.previewBounds && o.keep) o.previewBounds(drawingPreviewBox(o));       // a kept pass is a ghost: the whole flattened preview
  const k0 = scale * dpr, V = [k0, 0, 0, k0, -ox * k0, -oy * k0];
  const k = k0 * factor;                                   // pixels in one drawing unit
  c.lineJoin = 'miter'; c.lineCap = 'butt'; c.miterLimit = 10;
  const col = o.tint ? () => o.tint : (css, exact) => exact ? css : ink(css, dark);          // exact: a fill with its own colour keeps it
  const sheetBg = dark ? SHEETS.dark.bg : SHEETS.light.bg;
  if (o.slots) {
    let drawn = 0;
    // Layout: the drawing once per slot (drawing units → sheet mm), any slot in view; no per-item culling, except for o.strip (a strip of a pan end, TODO 324a: only what lies in it, as the drawing tab does)
    const box = fl.boxes && fl.boxes[spaceOf(fl) ? 'paper' : 'model'];
    const view = [ox, oy, ox + w / scale, oy + h / scale];
    for (const M of o.slots) {
      const det = M[0] * M[3] - M[1] * M[2];
      const back = det ? [[view[0], view[1]], [view[2], view[1]], [view[0], view[3]], [view[2], view[3]]].map(([X, Y]) => [(M[3] * (X - M[4]) - M[2] * (Y - M[5])) / det, (M[0] * (Y - M[5]) - M[1] * (X - M[4])) / det]) : null;
      const vr = o.strip && back && [Math.min(...back.map((p) => p[0])), Math.min(...back.map((p) => p[1])), Math.max(...back.map((p) => p[0])), Math.max(...back.map((p) => p[1]))];
      if (box) {
        const xs = [mapply(M, box[0], box[1]), mapply(M, box[2], box[3]), mapply(M, box[0], box[3]), mapply(M, box[2], box[1])];       // all four corners: a turned slot
        const X = xs.map((p) => p[0]), Y = xs.map((p) => p[1]);
        if (Math.max(...X) < view[0] || Math.min(...X) > view[2] || Math.max(...Y) < view[1] || Math.min(...Y) > view[3]) continue;
      }
      drawn += paintItems(c, fl, off, mmul(V, M), k, vr, dpr, col, sheetBg, null, factor, o.wireframe, o.minPx);
    }
    return drawn;
  }
  // drawing units → canvas pixels: the placement, then the view
  const T = mmul(V, placement(factor, sheetH));
  const xs = [ox / factor, (ox + w / scale) / factor];
  const ys = [(sheetH - oy - h / scale) / factor, (sheetH - oy) / factor];
  const vr = [Math.min(...xs), ys[0], Math.max(...xs), ys[1]];
  const drawn = over ? 0 : paintItems(c, fl, off, T, k, vr, dpr, col, sheetBg, o.hide, factor, o.wireframe, o.minPx);
  if (o.part === 'base') return drawn;
  if (o.hl && o.hl.length) highlight(c, o.hl, fl.mats, T, k, dpr, o.accent || '#4f46e5', o.wireframe);
  if (o.dim) drawDimPreview(c, o.dim, T, dpr, o.dimCol || DIM_LIGHT);
  if (o.marks && o.marks.length && !o.marksLast) drawMarks(c, o.marks, T, dpr, o.accent || '#4f46e5', o.snapCol);       // marksLast: the caller paints them with paintMarks after its previews (TODO 339)
  if (o.gaps && o.gaps.length) drawGaps(c, o.gaps, T, dpr, o.markCol || '#c2410c');
  if (o.contour && o.contour.length) drawContour(c, o.contour, T, dpr, o.contourCol || '#00ff00', o.contourDash || []);
  if (o.previewBounds && !o.keep) { const box = overlayBox(o, T, dpr); if (box) o.previewBounds(box); }
  return drawn;
}

/** The snap marker and its label painted again over everything already on the canvas (TODO 339); o is a paintDrawing option set (view, factor, marks, accent, snapCol). */
export function paintMarks(canvas, o) {
  if (!o.marks?.length) return;
  const k = o.scale * o.dpr, T = mmul([k, 0, 0, k, -o.ox * k, -o.oy * k], placement(o.factor, o.sheetH));
  drawMarks(canvas.getContext('2d'), o.marks, T, o.dpr, o.accent || '#4f46e5', o.snapCol);
}

/** Contour's preview: the chosen colour and style, translucent until Apply. */
export function drawContour(c, loops, T, dpr, col, dash) {
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.strokeStyle = col;
  c.globalAlpha = .65; c.lineWidth = 1.8 * dpr; c.setLineDash(dash.map((x) => x * dpr)); c.lineJoin = 'round';
  for (const pts of loops) {
    c.beginPath();
    pts.forEach((q, i) => { const [x, y] = mapply(T, q[0], q[1]); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.closePath(); c.stroke();
  }
  c.restore();
}

/** Tiny gaps (TODO 46): a small ring in the mark colour round each. */
function drawGaps(c, pts, T, dpr, col) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.strokeStyle = col; c.lineWidth = 2 * dpr; c.setLineDash([]);
  for (const [x, y] of pts) { const [px, py] = mapply(T, x, y); c.beginPath(); c.arc(px, py, 9 * dpr, 0, Math.PI * 2); c.stroke(); }
}

// Stroke the already transformed path in screen pixels, including stretched blocks.
function wireStroke(c, dpr) {
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.lineWidth = dpr; c.stroke(); c.restore();
}

/** The pictures (IMAGE items with pixels, TODO 305a), full opacity: the unit square, its top row at y = 1, through the item's q and matrix. */
function paintPictures(c, fl, off, T, vr, hide) {
  c.imageSmoothingQuality = 'high';
  for (const it of shownItems(fl)) {
    if (it.k !== 'i' || !itemVisible(it, off) || (hide && hide.has(it.e)) || (vr && outsideView(it.b, 0, vr))) continue;
    const img = pictureBitmap(it.px);
    if (!img) continue;                                                      // not loaded: preloadPictures runs where pictures come in, so this is rare
    const [ux, uy, vx, vy, ix, iy] = it.q;
    c.setTransform(...mmul(mmul(T, fl.mats[it.m]), [ux, uy, -vx, -vy, ix + vx, iy + vy]));
    c.drawImage(img, 0, 0, 1, 1);
  }
}

/** The shown items through T (drawing units → canvas pixels), k pixels per unit; vr culls to the view (drawing units), or null. */
function paintItems(c, fl, off, T, k, vr, dpr, col, sheetBg, hide, factor, wireframe, minPx) {
  const mats = fl.mats;
  let cur = -1, kk = k, pxPerUnit = 0, open = false, pc = null, pw = 0, pd = null, cap = null, join = null, origin = [0, 0], drawn = 0, run = 0;
  const flush = () => { if (open) { if (wireframe) wireStroke(c, dpr); else c.stroke(); } open = false; };
  if (!wireframe) paintPictures(c, fl, off, T, vr, hide);                   // under every line and text; Wireframe hides them like the background
  for (const it of shownItems(fl)) {
    if (it.k === 'i') continue;
    const b = it.b;
    const pad = it.k === 'p' && !it.fill ? strokeWidth(it, factor, mscale(mats[it.m])) / factor / 2 : 0;
    if (vr && outsideView(b, pad && Math.max(pad, 0.6 * dpr / k), vr)) continue;       // a stroke is drawn at least 1.2 px wide: its half reaches into the view (a band of a zoom end, TODO 324b)
    if (it.k !== 'n' && subPixel(b, pad, k, minPx)) continue;       // under 0.4 px (minPx: the quick paint's 1 px)
    if (!itemVisible(it, off)) continue;
    if (hide && hide.has(it.e)) continue;                                  // an entity being dragged by a grip is drawn by the overlay
    if (it.m !== cur) { flush(); cur = it.m; const M = mats[cur], V = mmul(T, M); origin = viewOrigin(V); c.setTransform(...V.slice(0, 4), ...mapply(V, ...origin)); kk = k * mscale(M) || k; pxPerUnit = maxScale(V); }
    drawn++;
    const mode = wireframe && it.attachedFill ? null : paintMode(it, wireframe);
    if (mode === 'stroke') {
      const lw = wireframe ? dpr / kk : Math.max(strokeWidth(it, factor, kk / k) * k / factor, 1.2 * dpr) / kk;
      const dash = wireframe ? null : it.dash && it.dash.reduce((a, x) => a + x, 0) * kk > 4 * dpr ? it.dash : it.dpx ? it.dpx : null;
      const css = col(it.css);
      const nextCap = it.cap || 'butt', nextJoin = it.join || 'miter';
      // shortcut: 5000 is a guess; one open path of 96k splines is the unverified cause of a blank laptop canvas (T87), retest with Untitled-1.dxf
      if (!open || css !== pc || lw !== pw || dash !== pd || nextCap !== cap || nextJoin !== join || ++run > 5000) {
        run = 1;
        flush();
        c.strokeStyle = css; c.lineWidth = lw; c.setLineDash(dash === it.dpx && dash ? dash.map((x) => x * dpr / kk) : dash || []);
        c.lineCap = cap = nextCap; c.lineJoin = join = nextJoin; c.miterLimit = 10;
        c.beginPath(); open = true; pc = css; pw = lw; pd = dash;
      }
      trace(c, it.ops, origin, dash ? 0 : pxPerUnit);
      continue;
    }
    flush();
    if (mode === 'fill') { c.beginPath(); trace(c, it.ops, origin, pxPerUnit); c.globalAlpha = it.a == null ? 1 : it.a; c.fillStyle = col(it.css, it.exact); c.fill('evenodd'); c.globalAlpha = 1; }
    else if (mode === 'mask') { c.beginPath(); trace(c, it.ops, origin, pxPerUnit); c.fillStyle = sheetBg; c.fill(); }
    else if (mode === 'point') {
      const [x, y] = mapply(mmul(T, mats[cur]), it.x, it.y), arm = 3 * dpr;
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.strokeStyle = col(it.css); c.lineWidth = dpr; c.setLineDash([]);
      c.beginPath(); c.moveTo(x - arm, y); c.lineTo(x + arm, y); c.moveTo(x, y - arm); c.lineTo(x, y + arm); c.stroke(); c.restore();
    }
    else if (mode === 'text') drawText(c, it, kk, dpr, col, wireframe, origin);
    else if (mode === 'hatch') drawHatch(c, it, kk, dpr, col, origin, pxPerUnit);
  }
  flush();
  return drawn;
}

/** The selection: a dashed accent centre line leaves the object's own colour and fill visible. */
function highlight(c, items, mats, T, k, dpr, accent, wireframe) {
  c.strokeStyle = accent;
  const runs = highlightRuns(items, mats, T, wireframe);
  for (const r of runs) {
    const M = mats[r.m], V = mmul(T, M), kk = k * mscale(M) || k, dashed = r.path && !runs.big;
    c.setTransform(...V.slice(0, 4), ...mapply(V, ...r.origin));
    c.lineWidth = (runs.big ? 1 : 2.6) * dpr / kk;
    c.lineCap = r.cap; c.lineJoin = r.join; c.miterLimit = 10;
    c.setLineDash(dashed ? [6 * dpr / kk, 6 * dpr / kk] : []);
    c.stroke(r.p);
  }
}

// The selection's paths, one Path2D per run, kept while the same items are repainted at the same zoom (a pan, a panel toggle): 150k items' canvas calls were 150 ms, TODO 329a.
const highlightCache = new WeakMap();
const HL_SOLID_ABOVE = 20000;     // selected path items: above this the overlay is solid and 1 px, a 2.6 px stroke of 150k tiny items rasterised in 180 ms and a 1 px one in 25 (dashing costs only ~15 of those 180)
const CAPS = ['butt', 'round', 'square'], JOINS = ['miter', 'round', 'bevel'];
const HL_RUN = 100;                     // items per Path2D: a run of 5000 took 400 ms to build at 150k (each call grows with the path), 100 took 50
function highlightRuns(items, mats, T, wireframe) {
  const key = `${T[0]},${T[1]},${T[2]},${T[3]},${wireframe}`, hit = highlightCache.get(items);
  if (hit && hit.key === key && hit.mats === mats && hit.ops.length === items.length && hit.ops.every((ops, i) => ops === items[i].ops)) return hit.runs;
  // One stroke per run of items with the same matrix and line style (not one per item: 150k selected items took 0.4 s, TODO 323b).
  // Each run's path is in item units from the run's first corner (not the view's origin), so a pan does not rebuild it; the zoom does (trace drops sub-pixel points).
  // The open run per matrix / style, so text boxes between the paths (every third item of a drawing with notes) do not each start a stroke: one colour and alpha, the order does not show.
  const runs = [], open = new Map(), px = []; let r = null, paths = 0;
  for (const it of items) {
    if (px[it.m] === undefined) px[it.m] = maxScale(mmul(T, mats[it.m]));
    const path = !!(it.k === 'p' || it.k === 'i' || (wireframe && it.ops)), nextCap = it.cap || 'butt', nextJoin = it.join || 'miter', styleKey = it.m * 18 + (path ? 1 : 0) + 2 * CAPS.indexOf(nextCap) + 6 * JOINS.indexOf(nextJoin);       // a number: a string key per item cost 80 ms at 150k
    r = open.get(styleKey);
    if (!r || (path && it.ops[0] > 2) || ++r.n > HL_RUN) {      // (ops starting with a line or a close: none today, kept apart)
      runs.push(r = { m: it.m, origin: [it.b[0], it.b[1]], path, cap: nextCap, join: nextJoin, n: 1, p: new Path2D() });
      open.set(styleKey, r);
    }
    const pxPerUnit = px[it.m];
    if (path) paths++;
    if (path && it.ops[0] === 2) r.p.moveTo(it.ops[1] + it.ops[3] * Math.cos(it.ops[4]) - r.origin[0], it.ops[2] + it.ops[3] * Math.sin(it.ops[4]) - r.origin[1]);       // an arc first in its ops would join the path before it: start its own subpath
    if (path) trace(r.p, it.ops, r.origin, pxPerUnit);
    else r.p.rect(it.b[0] - r.origin[0], it.b[1] - r.origin[1], it.b[2] - it.b[0], it.b[3] - it.b[1]);
  }
  runs.big = paths > HL_SOLID_ABOVE;
  highlightCache.set(items, { key, mats, ops: items.map((it) => it.ops), runs });
  return runs;
}

/** The dimension being placed or moved (edit.js dimGeometry, drawing units): its lines, arrowheads and text, in the dimension colour. */
export function drawDimPreview(c, g, T, dpr, accent) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.strokeStyle = accent; c.fillStyle = accent; c.lineWidth = 1.4 * dpr; c.setLineDash([]);
  c.lineCap = 'round'; c.lineJoin = 'round';           // as before 293a; set here, not left by the last paint (a kept base and a full paint must match)
  c.globalAlpha = g.ghost ? 0.5 : 1;                                   // Automatic dimension's hover preview is faint
  const P = (x, y) => mapply(T, x, y);
  c.beginPath();
  for (const l of g.lines) { const a = P(l[0], l[1]), b = P(l[2], l[3]); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
  for (const [cx, cy, r, a0, a1] of g.arcs || []) {                    // an angle's arc, as short straight pieces (any view turn is handled by P)
    const sw = (((a1 - a0) % 360) + 360) % 360, n = Math.max(8, Math.ceil(sw / 4));
    for (let i = 0; i <= n; i++) { const t = (a0 + sw * i / n) * Math.PI / 180, q = P(cx + r * Math.cos(t), cy + r * Math.sin(t)); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }
  }
  c.stroke();
  for (const tri of g.arrows) { c.beginPath(); tri.forEach((q, i) => { const m = P(q[0], q[1]); if (i) c.lineTo(m[0], m[1]); else c.moveTo(m[0], m[1]); }); c.closePath(); c.fill(); }
  const t = g.text, k = t && Math.hypot(T[0], T[1]), at = t && P(t.x, t.y), px = t && t.h * k;
  if (t && px >= 3 * dpr) {                                           // (a leader being drawn has no note yet)
    c.save();
    c.translate(at[0], at[1]); c.rotate(-t.rot * Math.PI / 180);
    c.font = `${px / CAP}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = t.va === 2 ? 'middle' : 'alphabetic';
    c.fillText(t.label, 0, 0);
    c.restore();
  }
  if (g.hot) {                                                         // the second line of an angle under the pointer: marked in full
    const a = P(g.hot[0], g.hot[1]), b = P(g.hot[2], g.hot[3]);
    c.globalAlpha = 1; c.lineWidth = 2.6 * dpr; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
  }
  c.globalAlpha = 1;
}

/** Set length's / Measure's points: a ring and a cross at each, a line between two; the point under the cursor gets the shape of its snap. */
export const SNAP_MARK_SIZE = 6;                   // 155p: AutoSnapMarkerSize 6, the half side in px like AutoCAD's
export function drawMarks(c, pts, T, dpr, accent, snapCol = '#00c000') {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.strokeStyle = accent; c.fillStyle = accent; c.lineWidth = 1.6 * dpr; c.setLineDash([]);
  c.lineCap = 'round'; c.lineJoin = 'round';
  const placed = pts.filter((p) => !p[3]).map(([x, y]) => mapply(T, x, y));
  if (placed.length > 1) { c.beginPath(); c.setLineDash([6 * dpr, 4 * dpr]); c.moveTo(placed[0][0], placed[0][1]); c.lineTo(placed[1][0], placed[1][1]); c.stroke(); c.setLineDash([]); }
  const r = 7 * dpr;
  for (const [x, y] of placed) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.moveTo(x - r * 1.6, y); c.lineTo(x + r * 1.6, y); c.moveTo(x, y - r * 1.6); c.lineTo(x, y + r * 1.6); c.stroke(); }
  for (const p of pts.filter((q) => q[3])) {
    const [x, y] = mapply(T, p[0], p[1]), k = p[2], h = SNAP_MARK_SIZE * dpr;
    c.beginPath();
    if (k === 'end') c.rect(x - h, y - h, 2 * h, 2 * h);
    else if (k === 'centre') c.arc(x, y, h, 0, Math.PI * 2);
    else if (k === 'extreme') { c.moveTo(x - h, y - h); c.lineTo(x + h, y - h); c.moveTo(x, y - h); c.lineTo(x, y + h); c.moveTo(x - h, y + h); c.lineTo(x + h, y + h); }
    else if (k === 'tangent') { c.arc(x, y, h, 0, Math.PI * 2); c.moveTo(x - h, y - h); c.lineTo(x + h, y - h); }
    else if (k === 'geometric') { c.moveTo(x - h, y + h); c.lineTo(x, y - h); c.lineTo(x + h, y + h); c.closePath(); c.moveTo(x - h, y); c.lineTo(x + h, y); }
    else if (k === 'insertion') { c.rect(x - h, y - h, 2 * h, 2 * h); c.moveTo(x - h, y); c.lineTo(x, y); c.lineTo(x, y + h); }
    else if (k === 'extension' || k === 'apparent') { c.moveTo(x - h, y - h); c.lineTo(x + h, y + h); c.moveTo(x - h, y + h); c.lineTo(x + h, y - h); if (k === 'apparent') c.rect(x - h, y - h, 2 * h, 2 * h); }
    else if (k === 'parallel') { c.moveTo(x - h, y + h); c.lineTo(x, y - h); c.moveTo(x, y + h); c.lineTo(x + h, y - h); }
    else if (k === 'mid') { c.moveTo(x, y - h); c.lineTo(x + h, y + h); c.lineTo(x - h, y + h); c.closePath(); }
    else if (k === 'node' || k === 'quadrant') { c.moveTo(x - h, y); c.lineTo(x, y - h); c.lineTo(x + h, y); c.lineTo(x, y + h); c.closePath(); }
    else if (k === 'intersection') { c.moveTo(x - h, y - h); c.lineTo(x + h, y + h); c.moveTo(x - h, y + h); c.lineTo(x + h, y - h); }
    else if (k === 'perpendicular') { c.moveTo(x - h, y - h); c.lineTo(x - h, y + h); c.lineTo(x + h, y + h); c.moveTo(x - h, y); c.lineTo(x, y); c.lineTo(x, y + h); }       // the right-angle symbol
    else if (k === 'near') { c.moveTo(x - h, y - h); c.lineTo(x + h, y - h); c.lineTo(x - h, y + h); c.lineTo(x + h, y + h); c.closePath(); }       // AutoCAD's hourglass
    else { c.moveTo(x - h, y); c.lineTo(x + h, y); c.moveTo(x, y - h); c.lineTo(x, y + h); }
    const halo = 1.6 * dpr;                                                        // unfilled green outlines need a dark edge on white (green alone is 2.46:1)
    c.strokeStyle = 'rgba(0, 0, 0, .55)'; c.lineWidth = halo + 2 * dpr; c.stroke();
    c.strokeStyle = snapCol; c.lineWidth = halo; c.stroke();
    if (k) {
      const name = SNAP_NAME[k] || k;
      c.font = `${11 * dpr}px system-ui, sans-serif`; c.textBaseline = 'middle'; c.lineJoin = 'round';
      c.fillStyle = 'rgba(255, 255, 255, .88)'; c.fillRect(x + h + 2 * dpr, y - h - 9 * dpr, c.measureText(name).width + 4 * dpr, 14 * dpr);       // a pale box so the label reads on a coloured line (TODO 339)
      c.strokeStyle = 'rgba(0, 0, 0, .55)'; c.lineWidth = 3 * dpr; c.strokeText(name, x + h + 4 * dpr, y - h - 2 * dpr);
      c.fillStyle = snapCol; c.fillText(name, x + h + 4 * dpr, y - h - 2 * dpr);
    }
  }
}

/** TEXT and MTEXT: a 100 px font scaled so its capitals are the text's height. */
function drawText(c, it, kk, dpr, col, wireframe, origin) {
  if (it.h * kk < 3 * dpr) return;
  const U = 100 * CAP / it.h;
  c.save();
  c.translate(it.x - origin[0], it.y - origin[1]); c.rotate(it.rot); c.scale(it.wf * it.mx / U, -it.my / U);
  c.fillStyle = col(it.css); c.font = fontOf(it);
  if (wireframe) { c.strokeStyle = col(it.css); c.lineWidth = dpr * U / kk; c.setLineDash([]); }
  const text = (str, x, y) => wireframe ? c.strokeText(str, x, y) : c.fillText(str, x, y);
  c.textAlign = ['left', 'center', 'right'][it.ha] || 'left'; c.textBaseline = 'alphabetic';
  const capU = 100 * CAP;
  if (it.multi) {
    const lines = it.wrap > 0 ? wrapped(c, it, U) : it.lines, lh = it.lh * U, total = (lines.length - 1) * lh + capU;
    const top = it.va === 'top' ? 0 : it.va === 'middle' ? -total / 2 : -total;
    lines.forEach((l, i) => text(l, 0, top + capU + i * lh));
  } else {
    const y = { alphabetic: 0, bottom: -0.3 * capU, middle: capU / 2, top: capU }[it.va] || 0;
    text(it.lines.join(' '), 0, y);
  }
  c.restore();
}

function wrapped(c, it, U) {
  if (it.cut) return it.cut;
  const max = it.wrap * U / it.wf * 1.02, out = [];
  for (const line of it.lines) {
    let now = '';
    for (const word of line.split(' ')) {
      const next = now ? now + ' ' + word : word;
      if (now && c.measureText(next).width > max) { out.push(now); now = word; } else now = next;
    }
    out.push(now);
  }
  it.cut = out;
  return out;
}

/** A patterned hatch: its families of lines, clipped to its boundary; too fine to see, a tint. */
function drawHatch(c, it, kk, dpr, colOf, origin, pxPerUnit) {
  const lb = it.lb || (it.lb = opsBox(it.ops));
  if (!lb) return;
  const col = colOf(it.css), corners = [[lb[0], lb[1]], [lb[2], lb[1]], [lb[2], lb[3]], [lb[0], lb[3]]];
  let tint = !it.fam.length;
  c.save();
  c.beginPath(); trace(c, it.ops, origin, pxPerUnit); c.clip('evenodd');
  c.lineCap = 'butt'; c.lineJoin = 'miter'; c.miterLimit = 10;
  c.strokeStyle = col; c.lineWidth = dpr / kk;
  for (const f of it.fam) {
    const dx = Math.cos(f.a), dy = Math.sin(f.a), nx = -dy, ny = dx, sp = f.ox * nx + f.oy * ny;
    if (Math.abs(sp) * kk < 3 * dpr) { tint = true; continue; }
    const across = corners.map(([x, y]) => ((x - f.bx) * nx + (y - f.by) * ny) / sp);
    const n0 = Math.floor(Math.min(...across)), n1 = Math.ceil(Math.max(...across));
    if (n1 - n0 > 4000) { tint = true; continue; }
    const len = f.dash ? f.dash.reduce((a, x) => a + x, 0) : 0, dashed = len * kk > 4 * dpr;
    c.setLineDash(dashed ? f.dash : []);
    if (!dashed) c.beginPath();
    for (let n = n0; n <= n1; n++) {
      const px = f.bx + n * f.ox, py = f.by + n * f.oy;
      const along = corners.map(([x, y]) => (x - px) * dx + (y - py) * dy), s0 = Math.min(...along), s1 = Math.max(...along);
      if (dashed) { c.beginPath(); c.lineDashOffset = ((s0 % len) + len) % len; }
      c.moveTo(px + dx * s0 - origin[0], py + dy * s0 - origin[1]); c.lineTo(px + dx * s1 - origin[0], py + dy * s1 - origin[1]);
      if (dashed) c.stroke();
    }
    if (!dashed) c.stroke();
  }
  if (tint) { c.globalAlpha = 0.3; c.fillStyle = col; c.fillRect(lb[0] - origin[0], lb[1] - origin[1], lb[2] - lb[0], lb[3] - lb[1]); }
  c.restore();
}
