// Batch PDFs size every file as max(batch sheet, drawing box) and hide nothing; a layout file only adds its four grippers.
import { layoutFromRaw, gridOf } from './layoutdoc.js';
import { drawingBoxMm, startHidden, unitFactor } from './doc.js';

/**
 * The gaps the check print dimensions, from the first grid's stepRepeat result L (its measured colGaps / rowGaps, so a turned part shows the real gap):
 * one per distinct size in each direction, 0 not drawn, each between two copies that exist (the first row / column that has both).
 * Sheet mm, y up: [{ dir: 'x' (across, between two columns) | 'y' (down, between two rows), from, to, at (the line's other coordinate), size }].
 */
export function labelGaps(L, sheetH) {
  if (!L || !L.count) return [];
  const copy = new Map(L.cells.map(([r, c], i) => [r + ',' + c, L.positions[i]])), out = [];
  for (const [dir, gaps, lines] of [['x', L.colGaps, L.rows], ['y', L.rowGaps, L.cols]]) {
    const seen = new Set();
    for (const g of gaps) {
      const size = Math.round(g.size * 1e6) / 1e6;
      if (!(size > 0) || seen.has(size)) continue;
      for (let k = 0; k < lines; k++) {
        const a = copy.get(dir === 'x' ? `${k},${g.after - 1}` : `${g.after - 1},${k}`), b = copy.get(dir === 'x' ? `${k},${g.after}` : `${g.after},${k}`);
        if (!a || !b) continue;
        seen.add(size);
        out.push(dir === 'x' ? { dir, from: g.at, to: g.at + g.size, at: sheetH - a.y - L.partH / 2, size } : { dir, from: sheetH - g.at - g.size, to: sheetH - g.at, at: a.x + L.partW / 2, size });
        break;
      }
    }
  }
  return out;
}

export function batchPdfSource({ doc, result: fl }, sheet) {
  const lay = layoutFromRaw(doc), factor = unitFactor(fl.units), box = drawingBoxMm(fl, factor);
  const src = { fl, factor, off: startHidden(fl), sheetW: Math.max(sheet.w, box ? Math.ceil(box[2]) : 0), sheetH: Math.max(sheet.h, box ? Math.ceil(box[3]) : 0), hide: [] };
  if (lay) {
    const { gripTop, gripRight, gripBottom, gripLeft } = lay.s;
    src.grippers = { gripTop, gripRight, gripBottom, gripLeft };
    src.gaps = labelGaps(gridOf(lay), lay.s.sheetH);
  }
  return src;
}
