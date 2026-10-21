// layout.js — pure step-and-repeat maths for a sheet (no DOM). All sizes in mm.
// The sheet origin is the top-left corner; y grows downward.

export const PRESETS = [
  { id: 'screen', label: 'Screen sheet 1000 × 700', w: 1000, h: 700 },
  { id: '700x500', label: '700 × 500', w: 700, h: 500 },
  { id: 'a4', label: 'A4 (297 × 210)', w: 297, h: 210 },
  { id: 'a3', label: 'A3 (420 × 297)', w: 420, h: 297 },
  { id: 'a2', label: 'A2 (594 × 420)', w: 594, h: 420 },
  { id: 'a1', label: 'A1 (841 × 594)', w: 841, h: 594 },
  { id: 'a0', label: 'A0 (1189 × 841)', w: 1189, h: 841 },
  { id: 'custom', label: 'Custom', w: null, h: null },
];

export const EDGES = ['top', 'right', 'bottom', 'left'];
/** The state keys of the four grippers (mm, 0 = none). */
export const GRIP_KEYS = { top: 'gripTop', right: 'gripRight', bottom: 'gripBottom', left: 'gripLeft' };

/** The preset id matching a size, or 'custom'. */
export function presetFor(w, h) {
  const p = PRESETS.find((q) => q.w === w && q.h === h);
  return p ? p.id : 'custom';
}

/** A gripper size from state: a number of mm, never negative. */
export const gripOf = (o, edge) => Math.max(0, Number(o[GRIP_KEYS[edge]]) || 0);

/** The area parts may use: each side keeps clear by its own gripper (no margin). */
export function usableArea(o) {
  const l = gripOf(o, 'left'), t = gripOf(o, 'top');
  return { x: l, y: t, w: o.sheetW - l - gripOf(o, 'right'), h: o.sheetH - t - gripOf(o, 'bottom') };
}

/** Extra gaps ([{ after, mm }], after = 1-based row / column the gap follows) as { after → mm }, last one wins, bad ones left out. */
function extraMap(list) {
  const m = new Map();
  for (const e of list || []) if (e && e.after >= 1 && e.mm > 0) m.set(Math.floor(e.after), +e.mm);
  return m;
}

/** The most items of `size` that fit in `avail` with `gap` between and the extras after item k (k < n) added. */
function fitCount(avail, size, gap, extra) {
  if (!(size > 0) || avail < size) return 0;
  let n = 1, used = size;
  for (;;) {
    const next = used + gap + (extra.get(n) || 0) + size;
    if (next > avail + 1e-9) return n;
    used = next; n++;
  }
}

function tryOrientation(area, pw, ph, gapX, gapY, ex, ey) {
  const cols = fitCount(area.w, pw, gapX, ex);
  const rows = fitCount(area.h, ph, gapY, ey);
  return cols > 0 && rows > 0 ? { cols, rows } : { cols: 0, rows: 0 };
}

/** Left (or top) edges of n items of `size`, `gap` apart plus the extras: [{ at, size }] and the whole length. */
function lay(n, size, gap, extra, start) {
  const at = [];
  let p = start;
  for (let i = 0; i < n; i++) { at.push(p); p += size + gap + (extra.get(i + 1) || 0); }
  return { at, len: n ? p - start - gap - (extra.get(n) || 0) : 0 };
}

/**
 * Fits copies of a partW × partH part on the sheet.
 * rotate: 'best' | '0' | '90'; align: 'centre' | 'topleft'.
 * fit: false → rows and columns are the typed o.rows and o.cols (at least 1), not worked out; 'best' then means 0°.
 *   The grid is centred (or top-left) on the usable area even if it does not fit; `fits` says whether it does.
 * extraRows / extraCols: [{ after, mm }] extra room after row `after` (counted from the top, 1 = the first row) or
 * after column `after` (from the left), on top of gapY / gapX. One that lies beyond the last row / column is ignored.
 * occupied: placed-part boxes [x0, y0, x1, y1], sheet mm, y down; Fit skips overlapping cells (touching edges are OK).
 * Returns the footprint (partW/partH already swapped when rotated) and the top-left of each copy, plus
 * rowGaps / colGaps: [{ after, at, size }] the strip between two rows / columns (sheet mm, with its extra).
 */
const MAX_LINE = 500, MAX_COUNT = 20000;
export function stepRepeat(o) {
  const { partW, partH, rotate = 'best', align = 'centre' } = o;
  const gapX = Math.max(0, o.gapX || 0), gapY = Math.max(0, o.gapY || 0);
  const area = usableArea(o);
  const ex = extraMap(o.extraCols), ey = extraMap(o.extraRows);
  const a0 = tryOrientation(area, partW, partH, gapX, gapY, ex, ey);
  const a90 = tryOrientation(area, partH, partW, gapX, gapY, ex, ey);
  const base0 = tryOrientation(area, partW, partH, gapX, gapY, new Map(), new Map()), base90 = tryOrientation(area, partH, partW, gapX, gapY, new Map(), new Map());
  const manual = o.fit === false;                                     // rows and columns typed by hand: the grid may not fit
  let rotated = false;
  if (String(rotate) === '90') rotated = true;
  else if (String(rotate) === 'best' && !manual) rotated = a90.cols * a90.rows > a0.cols * a0.rows;
  let { cols, rows } = rotated ? a90 : a0;
  if (manual) {
    const n = (v) => Math.max(1, Math.min(MAX_LINE, Math.floor(Number(v)) || 1));
    cols = n(o.cols); rows = n(o.rows);
    if (!(partW > 0 && partH > 0) || cols * rows > MAX_COUNT) { cols = 0; rows = 0; }
  }
  const pw = rotated ? partH : partW, ph = rotated ? partW : partH;
  const gridW = lay(cols, pw, gapX, ex, 0).len, gridH = lay(rows, ph, gapY, ey, 0).len;
  const x0 = align === 'topleft' ? area.x : area.x + (area.w - gridW) / 2;
  const y0 = align === 'topleft' ? area.y : area.y + (area.h - gridH) / 2;
  const xs = lay(cols, pw, gapX, ex, x0).at, ys = lay(rows, ph, gapY, ey, y0).at;
  const positions = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = xs[c], y = ys[r];
    if (!manual && (o.occupied || []).some((b) => x < b[2] - 1e-9 && x + pw > b[0] + 1e-9 && y < b[3] - 1e-9 && y + ph > b[1] + 1e-9)) continue;
    positions.push({ x, y });
  }
  const count = positions.length, skipped = cols * rows - count;
  const colGaps = xs.slice(0, -1).map((x, i) => ({ after: i + 1, at: x + pw, size: xs[i + 1] - x - pw }));
  const rowGaps = ys.slice(0, -1).map((y, i) => ({ after: i + 1, at: y + ph, size: ys[i + 1] - y - ph }));
  const base = manual ? { cols, rows } : rotated ? base90 : base0;
  const sheetArea = o.sheetW * o.sheetH;
  const usedPct = sheetArea > 0 ? (count * partW * partH) / sheetArea * 100 : 0;
  const fits = count > 0 && gridW <= area.w + 1e-9 && gridH <= area.h + 1e-9;      // always true when the grid was worked out
  return { cols, rows, baseCols: base.cols, baseRows: base.rows, count, skipped, rotated, partW: pw, partH: ph, x0, y0, gridW, gridH, usedPct, area, positions, colGaps, rowGaps, manual, fits };
}

/**
 * Crop and registration marks around the grid of a stepRepeat result, in sheet coordinates (y down).
 * { crop: [[x1, y1, x2, y2], …] corner ticks, reg: [{ cx, cy, r, cross: [[x1, y1, x2, y2], …] }] circles with a cross }.
 * Empty when nothing fits. One place for the SVG preview and the DXF the layout is written to.
 */
export function markGeometry(L, { crop = true, reg = true } = {}) {
  const out = { crop: [], reg: [] };
  if (!L.count) return out;
  const gx0 = L.x0, gy0 = L.y0, gx1 = L.x0 + L.gridW, gy1 = L.y0 + L.gridH;
  if (crop) {
    out.crop.push(
      [gx0 - 25, gy0, gx0 - 7, gy0], [gx0, gy0 - 25, gx0, gy0 - 7], [gx1 + 25, gy0, gx1 + 7, gy0], [gx1, gy0 - 25, gx1, gy0 - 7],
      [gx0 - 25, gy1, gx0 - 7, gy1], [gx0, gy1 + 25, gx0, gy1 + 7], [gx1 + 25, gy1, gx1 + 7, gy1], [gx1, gy1 + 25, gx1, gy1 + 7]);
  }
  if (reg) {
    const cx = (gx0 + gx1) / 2, cy = (gy0 + gy1) / 2;
    for (const [x, y] of [[cx, gy0 - 20], [cx, gy1 + 18], [gx0 - 28, cy], [gx1 + 28, cy]]) {
      out.reg.push({ cx: x, cy: y, r: 7, cross: [[x - 12, y, x + 12, y], [x, y - 12, x, y + 12]] });
    }
  }
  return out;
}
