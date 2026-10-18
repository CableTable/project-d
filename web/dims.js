// dims.js — dimension styles and the small maths around dimension parameters, pure (no DOM): dims.test.mjs.
//
// A style (Format → Dimension style…, mock-up R8b) is { arrow, textH, gap (mm), dp (0 to 4 decimals), units: 'mm' | 'inch', pos: 'above' | 'centre' }.
// Presets are named styles; "Standard" is always there and cannot be deleted. They live on this PC (the app keeps them in localStorage
// `pd-dimstyles`); a dimension in a drawing carries its own look in its block, so a saved drawing looks the same wherever it is opened.
//
//   STANDARD, checkStyle(fields)      → { style } from typed fields, or { error } naming the one that is wrong
//   cleanStyle(stored)                → a usable style from stored values (a bad field is the Standard's)
//   lookOf(style, factor)             → the look in drawing units for edit.js's dimension builders: { textH, arrow, gap, pos, units }
//   loadPresets(stored)               → { presets: { name: style }, cur } from what was stored (anything odd is dropped; Standard is always there)
//   withHeight(params, textH)         → the dimension's params with a new text height; its arrow and text gap keep their proportion to it
export const STANDARD = { arrow: 2.5, textH: 3.5, gap: 0.8, dp: 2, units: 'mm', pos: 'above' };
const BOX = { arrow: ['Arrow size', 0.1, 100], textH: ['Text height', 0.1, 100], gap: ['Gap', 0, 100] };

export function checkStyle(f) {
  const style = {};
  for (const [k, [name, lo, hi]] of Object.entries(BOX)) {
    const v = typeof f[k] === 'string' ? Number(f[k].trim().replace(',', '.')) : f[k];
    if (f[k] === '' || !Number.isFinite(v) || v < lo || v > hi) return { error: `${name}: a number from ${lo} to ${hi} mm` };
    style[k] = Math.round(v * 1000) / 1000;
  }
  const dp = Number(f.dp);
  if (!Number.isInteger(dp) || dp < 0 || dp > 4) return { error: 'Decimals: 0 to 4' };
  return { style: { ...style, dp, units: f.units === 'inch' ? 'inch' : 'mm', pos: f.pos === 'centre' ? 'centre' : 'above' } };
}
export const cleanStyle = (s) => checkStyle({ ...STANDARD, ...(s && typeof s === 'object' ? s : {}) }).style || { ...STANDARD };

export const lookOf = (style, factor = 1) => ({ textH: style.textH / factor, arrow: style.arrow / factor, gap: style.gap / factor, pos: style.pos, units: style.units });

export function loadPresets(stored) {
  const presets = { Standard: { ...STANDARD } }, src = stored && typeof stored === 'object' && stored.presets && typeof stored.presets === 'object' ? stored.presets : {};
  for (const [name, s] of Object.entries(src)) if (name.trim() && name.length <= 40) presets[name] = cleanStyle(s);
  return { presets, cur: stored && Object.hasOwn(presets, stored.cur) ? stored.cur : 'Standard' };
}

export function withHeight(p, textH) {
  const k = p.textH > 0 ? textH / p.textH : 0;
  return { ...p, textH, arrow: k && p.arrow > 0 ? p.arrow * k : undefined, gap: k && p.gap > 0 ? p.gap * k : undefined };
}
