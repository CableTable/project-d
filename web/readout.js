// Colour readout (TODO 148d): the pure parts. What colour is under the cursor, and how it is written out.
import { ACI, parseHex, rgbHex, rgbCmyk } from './colour.js';
import { hitItem } from './edit.js';
import { boundary, closedOutline, containsPoint } from './fill.js';
import { partIndex, toPart } from './layoutsnap.js';

/** The true colour of the drawing item at (x, y) in the index's units, [r, g, b], as the page paints it (ByLayer, ByBlock and a block's own colours already resolved), with no theme darkening;
 *  ACI 7 (white on the page) reads as black, as the colour picker opens it. null when nothing is there, or only a filled outline's box is. */
export function colourAtItem(ed, x, y, tol) {
  const i = hitItem(ed, x, y, tol), it = i < 0 ? null : ed.items[i];
  if (!it) return null;
  const e = it.attachedFill && ed.raw.entities[it.e];
  if (e && closedOutline(e) && !containsPoint(boundary(e), [x, y])) return null;     // an area is hit by its box; a fill is only where the outline holds the point
  return parseHex(it.css === ACI[7] ? '#000000' : it.css);
}

/** The same for a layout: (x, y) in sheet mm (y up), `placed` the shown placed parts; the part painted last (on top) wins. */
export function colourAtLayout(parts, placed, x, y, tol) {
  const rank = Object.keys(parts);
  let best = null, top = -1;
  for (const pl of placed) {
    const part = parts[pl.partId], r = rank.indexOf(pl.partId);
    if (!part?.fl || r < top) continue;
    const rgb = colourAtItem(partIndex(part), ...toPart(part, pl, x, y), tol / (part.factor || 1));
    if (rgb) { best = rgb; top = r; }
  }
  return best;
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
