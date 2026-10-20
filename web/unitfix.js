// unitfix.js — the one-click unit fix (TODO 51; mock-up R14, option A): ×25.4 / ÷25.4 about the drawing origin (0,0).
// Pure: the factors, the sizes they would give, the texts. app.js scales with edit.js scaleAbout / bgUnitFixed.

export const UNIT_FIXES = { up: { s: 25.4, text: '×25.4' }, down: { s: 1 / 25.4, text: '÷25.4' } };

const two = (v) => Number(v).toFixed(2);

/** The size [w, h] mm that box [x0, y0, x1, y1] (mm) gives after a fix by s. */
export const unitFixSize = (box, s) => [(box[2] - box[0]) * s, (box[3] - box[1]) * s];

/** The background picture scaled by s about the origin: its size and its bottom-left corner. */
export const bgUnitFixed = (bg, s) => ({ ...bg, mm: bg.mm * s, x: bg.x * s, y: bg.y * s });

/** "Unit fix ×25.4 · 10.00 × 5.00 → 254.00 × 127.00 mm" (the command line), from the sizes before and after. */
export const unitFixLine = (fix, before, after) => `Unit fix ${fix.text} · ${two(before[0])} × ${two(before[1])} → ${two(after[0])} × ${two(after[1])} mm`;

/** The button's tooltip: what it is for, and the size one click would give. */
export function unitFixTip(fix, box) {
  if (!box) return `${fix.text}: nothing to scale`;
  const [w, h] = unitFixSize(box, fix.s);
  return `${fix.text} about 0,0, widths too (one undo step). Would give ${two(w)} × ${two(h)} mm`;
}
