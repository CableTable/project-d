/** A typed percentage at 96 dpi, clamped to the canvas zoom limits (floor: px per mm, see zoomFloor in app.js); null means invalid. */
export function zoomScale(text, floor = 0.05) {
  const value = text.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(value)) return null;
  const percent = Number(value.replace('%', ''));
  return percent > 0 ? Math.min(1000, Math.max(floor, percent / 100 * (96 / 25.4))) : null;
}

/** The zoom label: whole % from 1% up, 2 significant digits below it (never "0%"). 100% = 3.78 px per mm. */
export function zoomLabel(scale) {
  const pct = scale / (96 / 25.4) * 100;
  if (pct >= 1) return Math.round(pct) + '%';
  const s = pct.toFixed(1 - Math.floor(Math.log10(pct)));
  return s.replace(/\.?0+$/, '') + '%';
}
