// Batch PDFs use each saved layout's sheet settings; plain drawings have no grippers.
import { layoutFromRaw } from './layoutdoc.js';
import { drawingBoxMm, startHidden, unitFactor } from './doc.js';

export function batchPdfSource({ doc, result: fl }, sheet) {
  const lay = layoutFromRaw(doc), factor = unitFactor(fl.units), box = drawingBoxMm(fl, factor);
  const src = { fl, factor, off: startHidden(fl), sheetW: Math.max(sheet.w, box ? Math.ceil(box[2]) : 0), sheetH: Math.max(sheet.h, box ? Math.ceil(box[3]) : 0), hide: [] };
  if (lay) {
    const { sheetW, sheetH, gripTop, gripRight, gripBottom, gripLeft } = lay.s;
    Object.assign(src, { sheetW, sheetH, grippers: { gripTop, gripRight, gripBottom, gripLeft }, hide: ['Sheet', 'Marks'] });
  }
  return src;
}
