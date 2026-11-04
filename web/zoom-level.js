/** A typed percentage at 96 dpi, clamped to the canvas zoom limits; null means invalid. */
export function zoomScale(text) {
  const value = text.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(value)) return null;
  return Math.min(1000, Math.max(0.05, Number(value.replace('%', '')) / 100 * (96 / 25.4)));
}
