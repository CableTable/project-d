// render.js — draws a flattened drawing (drawing.js) on a <canvas> laid over the sheet.
// Ported from Project R's viewer: strokes batched by colour/width/dash, text, hatches, ACI 7 flipped for the sheet.
import { mmul, mscale, mapply, opsBox, CAP, fontOfStyle, strokeWidth } from './drawing.js';
import { placement, shownItems, itemVisible, spaceOf } from './doc.js';
import { paintMode } from './wireframe.js';

const SHEETS = { light: { bg: '#ffffff', fg: '#1b1d22' }, dark: { bg: '#18181b', fg: '#e8e8ec' } };
const TEXT_FONT = '100px "Segoe UI", Roboto, system-ui, sans-serif';
/** The canvas font of a text item: its style's font (Standard, Arial-like or Mono), bold when its MTEXT font code says so. */
export const FONT_FAMILY = { Standard: '"Segoe UI", Roboto, system-ui, sans-serif', Arial: 'Arial, "Liberation Sans", Helvetica, sans-serif', Mono: '"Cascadia Mono", Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace' };
export const fontOf = (it) => (it.bold ? 'bold ' : '') + '100px ' + FONT_FAMILY[fontOfStyle(it.st)];
const lum = (css) => { const n = parseInt(css.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const darken = (css, f) => '#' + [16, 8, 0].map((s) => Math.round(((parseInt(css.slice(1), 16) >> s) & 255) * f).toString(16).padStart(2, '0')).join('');

/** A line colour as it shows on the sheet: white goes dark on the light sheet, black goes light on the dark one. */
export const DIM_LIGHT = '#0f766e', DIM_DARK = '#5eead4';   // the theme's dimension colour (--dim); a new Dimensions layer is DIM_LIGHT
export function ink(css, dark) {
  if (dark && css === DIM_LIGHT) return DIM_DARK;
  const l = lum(css);
  if (!dark) return l > 0.8 ? SHEETS.light.fg : l > 0.55 ? darken(css, 0.6) : css;
  if (l >= 0.2) return css;
  const n = parseInt(css.slice(1), 16), ch = [n >> 16, (n >> 8) & 255, n & 255];
  if (Math.max(...ch) - Math.min(...ch) < 40) return SHEETS.dark.fg;
  return '#' + ch.map((c) => Math.round(c + (255 - c) * 0.45).toString(16).padStart(2, '0')).join('');
}

function trace(c, ops) {
  for (let i = 0; i < ops.length;) {
    const op = ops[i];
    if (op === 0) { c.moveTo(ops[i + 1], ops[i + 2]); i += 3; } else if (op === 1) { c.lineTo(ops[i + 1], ops[i + 2]); i += 3; }
    else if (op === 2) { c.arc(ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], ops[i + 5], ops[i + 6] === 1); i += 7; } else { c.closePath(); i++; }
  }
}

/**
 * Paints into `canvas` (already sized to w*dpr by h*dpr).
 * o: { keep (do not clear first: paint another drawing on top), fl, off, factor, sheetH, ox, oy, scale (px per sheet mm), w, h (css px), dpr, dark,
 *       tint (one css colour to draw everything in: a part off the sheet),
 *       bg (the background picture: bitmap, w, h, mm, x, y, visible), hl (items drawn again in `accent`: the selection), marks ([x, y] points in drawing units: Set length's picks), dim (a dimension being placed or moved: edit.js dimGeometry), accent (css colour), gaps ([x, y] drawing units: a ring each), markCol (css colour of the rings) }
 */
export function paintDrawing(canvas, o) {
  const { fl, off, factor, sheetH, ox, oy, scale, w, h, dpr, dark } = o;
  const c = canvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (!o.keep) c.clearRect(0, 0, canvas.width, canvas.height);
  if (!o.wireframe && o.bg && o.bg.visible && o.bg.bitmap) {
    const b = o.bg, k = scale * dpr;                                  // the background, dimmed, under the drawing (mm, y up)
    c.setTransform(k, 0, 0, k, -ox * k, -oy * k);
    c.globalAlpha = 0.4;
    c.drawImage(b.bitmap, b.x, sheetH - b.y - b.h * b.mm, b.w * b.mm, b.h * b.mm);
    c.globalAlpha = 1;
  }
  if (!fl) return;
  const k0 = scale * dpr, V = [k0, 0, 0, k0, -ox * k0, -oy * k0];
  const k = k0 * factor;                                   // pixels in one drawing unit
  c.lineJoin = 'round'; c.lineCap = 'round';
  const col = o.tint ? () => o.tint : (css) => ink(css, dark);
  const sheetBg = dark ? SHEETS.dark.bg : SHEETS.light.bg;
  if (o.slots) {
    // Layout: the drawing once per slot (drawing units → sheet mm), any slot in view; no per-item culling
    const box = fl.boxes && fl.boxes[spaceOf(fl) ? 'paper' : 'model'];
    const view = [ox, oy, ox + w / scale, oy + h / scale];
    for (const M of o.slots) {
      if (box) {
        const xs = [mapply(M, box[0], box[1]), mapply(M, box[2], box[3]), mapply(M, box[0], box[3]), mapply(M, box[2], box[1])];       // all four corners: a turned slot
        const X = xs.map((p) => p[0]), Y = xs.map((p) => p[1]);
        if (Math.max(...X) < view[0] || Math.min(...X) > view[2] || Math.max(...Y) < view[1] || Math.min(...Y) > view[3]) continue;
      }
      paintItems(c, fl, off, mmul(V, M), k, null, dpr, col, sheetBg, null, factor, o.wireframe);
    }
    return;
  }
  // drawing units → canvas pixels: the placement, then the view
  const T = mmul(V, placement(factor, sheetH));
  const xs = [ox / factor, (ox + w / scale) / factor];
  const ys = [(sheetH - oy - h / scale) / factor, (sheetH - oy) / factor];
  const vr = [Math.min(...xs), ys[0], Math.max(...xs), ys[1]];
  paintItems(c, fl, off, T, k, vr, dpr, col, sheetBg, o.hide, factor, o.wireframe);
  if (o.hl && o.hl.length) highlight(c, o.hl, fl.mats, T, k, dpr, o.accent || '#4f46e5', o.wireframe);
  if (o.dim) drawDimPreview(c, o.dim, T, dpr, o.dimCol || DIM_LIGHT);
  if (o.marks && o.marks.length) drawMarks(c, o.marks, T, dpr, o.accent || '#4f46e5');
  if (o.gaps && o.gaps.length) drawGaps(c, o.gaps, T, dpr, o.markCol || '#c2410c');
  if (o.contour && o.contour.length) drawContour(c, o.contour, T, dpr, o.contourCol || '#00ff00', o.contourDash || []);
}

/** Contour's preview: the chosen colour and style, translucent until Apply. */
function drawContour(c, loops, T, dpr, col, dash) {
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

/** The shown items through T (drawing units → canvas pixels), k pixels per unit; vr culls to the view (drawing units), or null. */
function paintItems(c, fl, off, T, k, vr, dpr, col, sheetBg, hide, factor, wireframe) {
  const mats = fl.mats;
  let cur = -1, kk = k, open = false, pc = null, pw = 0, pd = null;
  const flush = () => { if (open) { if (wireframe) wireStroke(c, dpr); else c.stroke(); } open = false; };
  for (const it of shownItems(fl)) {
    const b = it.b;
    const pad = it.k === 'p' && !it.fill ? strokeWidth(it, factor, mscale(mats[it.m])) / factor / 2 : 0;
    if (vr && (b[2] + pad < vr[0] || b[0] - pad > vr[2] || b[3] + pad < vr[1] || b[1] - pad > vr[3])) continue;
    if (it.k !== 'n' && (b[2] - b[0] + 2 * pad) * k < 0.4 && (b[3] - b[1] + 2 * pad) * k < 0.4) continue;       // under half a pixel
    if (!itemVisible(it, off)) continue;
    if (hide && hide.has(it.e)) continue;                                  // an entity being dragged by a grip is drawn by the overlay
    if (it.m !== cur) { flush(); cur = it.m; const M = mats[cur]; c.setTransform(...mmul(T, M)); kk = k * mscale(M) || k; }
    const mode = paintMode(it, wireframe);
    if (mode === 'stroke') {
      const lw = wireframe ? dpr / kk : Math.max(strokeWidth(it, factor, kk / k) * k / factor, 1.2 * dpr) / kk;
      const dash = wireframe ? null : it.dash && it.dash.reduce((a, x) => a + x, 0) * kk > 4 * dpr ? it.dash : it.dpx ? it.dpx : null;
      const css = col(it.css);
      if (!open || css !== pc || lw !== pw || dash !== pd) {
        flush();
        c.strokeStyle = css; c.lineWidth = lw; c.setLineDash(dash === it.dpx && dash ? dash.map((x) => x * dpr / kk) : dash || []);
        c.beginPath(); open = true; pc = css; pw = lw; pd = dash;
      }
      trace(c, it.ops);
      continue;
    }
    flush();
    if (mode === 'fill') { c.beginPath(); trace(c, it.ops); c.globalAlpha = it.a == null ? 1 : it.a; c.fillStyle = col(it.css); c.fill('evenodd'); c.globalAlpha = 1; }
    else if (mode === 'mask') { c.beginPath(); trace(c, it.ops); c.fillStyle = sheetBg; c.fill(); }
    else if (mode === 'point') {
      c.beginPath(); c.arc(it.x, it.y, 1.8 * dpr / kk, 0, Math.PI * 2);
      if (wireframe) { c.strokeStyle = col(it.css); c.setLineDash([]); wireStroke(c, dpr); }
      else { c.fillStyle = col(it.css); c.fill(); }
    }
    else if (mode === 'text') drawText(c, it, kk, dpr, col, wireframe);
    else if (mode === 'hatch') drawHatch(c, it, kk, dpr, col);
  }
  flush();
}

/** The selection: a thin accent centre line over the object's true-width stroke. */
function highlight(c, items, mats, T, k, dpr, accent, wireframe) {
  c.strokeStyle = accent; c.fillStyle = accent; c.setLineDash([]);
  let cur = -1, kk = k;
  for (const it of items) {
    if (it.m !== cur) { cur = it.m; const M = mats[cur]; c.setTransform(...mmul(T, M)); kk = k * mscale(M) || k; }
    c.lineWidth = 2.6 * dpr / kk;
    c.beginPath();
    if (it.k === 'p' || (wireframe && it.ops)) { trace(c, it.ops); if (it.fill && !wireframe) c.fill('evenodd'); else c.stroke(); } else c.strokeRect(it.b[0], it.b[1], it.b[2] - it.b[0], it.b[3] - it.b[1]);
  }
}

/** The dimension being placed or moved (edit.js dimGeometry, drawing units): its lines, arrowheads and text, in the dimension colour. */
function drawDimPreview(c, g, T, dpr, accent) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.strokeStyle = accent; c.fillStyle = accent; c.lineWidth = 1.4 * dpr; c.setLineDash([]);
  const P = (x, y) => mapply(T, x, y);
  c.beginPath();
  for (const l of g.lines) { const a = P(l[0], l[1]), b = P(l[2], l[3]); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
  for (const [cx, cy, r, a0, a1] of g.arcs || []) {                    // an angle's arc, as short straight pieces (any view turn is handled by P)
    const sw = (((a1 - a0) % 360) + 360) % 360, n = Math.max(8, Math.ceil(sw / 4));
    for (let i = 0; i <= n; i++) { const t = (a0 + sw * i / n) * Math.PI / 180, q = P(cx + r * Math.cos(t), cy + r * Math.sin(t)); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }
  }
  c.stroke();
  for (const tri of g.arrows) { c.beginPath(); tri.forEach((q, i) => { const m = P(q[0], q[1]); if (i) c.lineTo(m[0], m[1]); else c.moveTo(m[0], m[1]); }); c.closePath(); c.fill(); }
  const t = g.text;
  if (!t) return;                                                     // a leader being drawn has no note yet
  const k = Math.hypot(T[0], T[1]), at = P(t.x, t.y), px = t.h * k;
  if (px < 3 * dpr) return;
  c.save();
  c.translate(at[0], at[1]); c.rotate(-t.rot * Math.PI / 180);
  c.font = `${px / CAP}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = t.va === 2 ? 'middle' : 'alphabetic';
  c.fillText(t.label, 0, 0);
  c.restore();
}

/** Set length's / Measure's points: a ring and a cross at each, a line between two; the point under the cursor gets the shape of its snap. */
const SNAP_NAME = { end: 'end', centre: 'centre', mid: 'middle', node: 'point', near: 'nearest' };
function drawMarks(c, pts, T, dpr, accent) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.strokeStyle = accent; c.fillStyle = accent; c.lineWidth = 1.6 * dpr; c.setLineDash([]);
  const placed = pts.filter((p) => !p[3]).map(([x, y]) => mapply(T, x, y));
  if (placed.length > 1) { c.beginPath(); c.setLineDash([6 * dpr, 4 * dpr]); c.moveTo(placed[0][0], placed[0][1]); c.lineTo(placed[1][0], placed[1][1]); c.stroke(); c.setLineDash([]); }
  const r = 7 * dpr;
  for (const [x, y] of placed) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.moveTo(x - r * 1.6, y); c.lineTo(x + r * 1.6, y); c.moveTo(x, y - r * 1.6); c.lineTo(x, y + r * 1.6); c.stroke(); }
  for (const p of pts.filter((q) => q[3])) {
    const [x, y] = mapply(T, p[0], p[1]), k = p[2], h = 5 * dpr;
    c.beginPath();
    if (k === 'end') c.rect(x - h, y - h, 2 * h, 2 * h);
    else if (k === 'centre') c.arc(x, y, h, 0, Math.PI * 2);
    else if (k === 'mid') { c.moveTo(x, y - h); c.lineTo(x + h, y + h); c.lineTo(x - h, y + h); c.closePath(); }
    else if (k === 'node') { c.moveTo(x - h, y); c.lineTo(x, y - h); c.lineTo(x + h, y); c.lineTo(x, y + h); c.closePath(); }
    else if (k === 'near') { c.moveTo(x - h, y - h); c.lineTo(x + h, y - h); c.lineTo(x - h, y + h); c.lineTo(x + h, y + h); c.closePath(); }       // AutoCAD's hourglass
    else { c.moveTo(x - h, y); c.lineTo(x + h, y); c.moveTo(x, y - h); c.lineTo(x, y + h); }
    c.stroke();
    if (k) { c.font = `${11 * dpr}px system-ui, sans-serif`; c.textBaseline = 'middle'; c.fillText(SNAP_NAME[k] || k, x + h + 4 * dpr, y - h - 2 * dpr); }
  }
}

/** TEXT and MTEXT: a 100 px font scaled so its capitals are the text's height. */
function drawText(c, it, kk, dpr, col, wireframe) {
  if (it.h * kk < 3 * dpr) return;
  const U = 100 * CAP / it.h;
  c.save();
  c.translate(it.x, it.y); c.rotate(it.rot); c.scale(it.wf * it.mx / U, -it.my / U);
  c.fillStyle = col(it.css); c.font = it.st || it.bold ? fontOf(it) : TEXT_FONT;
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
function drawHatch(c, it, kk, dpr, colOf) {
  const lb = it.lb || (it.lb = opsBox(it.ops));
  if (!lb) return;
  const col = colOf(it.css), corners = [[lb[0], lb[1]], [lb[2], lb[1]], [lb[2], lb[3]], [lb[0], lb[3]]];
  let tint = !it.fam.length;
  c.save();
  c.beginPath(); trace(c, it.ops); c.clip('evenodd');
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
      c.moveTo(px + dx * s0, py + dy * s0); c.lineTo(px + dx * s1, py + dy * s1);
      if (dashed) c.stroke();
    }
    if (!dashed) c.stroke();
  }
  if (tint) { c.globalAlpha = 0.3; c.fillStyle = col; c.fillRect(lb[0], lb[1], lb[2] - lb[0], lb[3] - lb[1]); }
  c.restore();
}
