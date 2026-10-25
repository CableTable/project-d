// Bounds shared by canvas previews and the SVG preview layer, in canvas CSS pixels.
import { mapply, mmul, unionBox } from './drawing.js';
import { placement, spaceOf } from './doc.js';

export function screenBox(box, matrix) {
  if (!box) return null;
  let bounds = null;
  for (const [x, y] of [[box[0], box[1]], [box[0], box[3]], [box[2], box[1]], [box[2], box[3]]]) {
    const [px, py] = mapply(matrix, x, y);
    bounds = unionBox(bounds, [px, py, px, py]);
  }
  return bounds;
}

export function drawingPreviewBox(o) {
  const box = o.fl.boxes[spaceOf(o.fl) ? 'paper' : 'model'];
  const view = [o.scale, 0, 0, o.scale, -o.ox * o.scale, -o.oy * o.scale];
  return (o.slots || [placement(o.factor, o.sheetH)]).reduce((bounds, matrix) => unionBox(bounds, screenBox(box, mmul(view, matrix))), null);
}
