/** A typed percentage at 96 dpi, clamped to the canvas zoom limits; null means invalid. */
export function zoomScale(text) {
  const value = text.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(value)) return null;
  const percent = Number(value.replace('%', ''));
  return percent > 0 ? Math.min(1000, Math.max(0.05, percent / 100 * (96 / 25.4))) : null;
}
