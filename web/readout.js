// Colour readout (TODO 148d): the pure parts. What colour is under the cursor, and how it is written out.
import { keyRgb, rgbHex, rgbCmyk } from './colour.js';
import { effectiveColour } from './props.js';

/** The true colour of an object, [r, g, b], with no theme darkening: its fill when the cursor is inside the outline and off the line, else the line colour (ByLayer through its layer, ByBlock as ACI 7). */
export function colourUnder(ent, layers, onLine) {
  if (!onLine && ent.fill) return keyRgb(ent.fill);
  const key = effectiveColour(ent, layers);
  return keyRgb(key === 'byblock' ? 'aci:7' : key);
}

/** The numbers the box shows. CMYK is the colour picker's formula, whole percents. */
export const readoutValues = (rgb) => ({ rgb, cmyk: rgbCmyk(rgb).map(Math.round), hex: rgbHex(rgb).toUpperCase() });

/** A computed CSS colour ("rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)", "rgb(1 2 3 / 50%)") as [r, g, b]; null for none, transparent or fully clear. */
export function cssRgb(css) {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(css || '');
  if (!m) return null;
  const alpha = m[4] == null ? 1 : m[5] ? m[4] / 100 : +m[4];
  return alpha > 0 ? [m[1], m[2], m[3]].map((n) => Math.round(+n)) : null;
}
