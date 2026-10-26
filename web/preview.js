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

/** The CSS-pixel box of what paintDrawing draws over the drawing through T (drawing units → device pixels): a dimension, Set length / Measure marks, the contour. Null when there is none. */
export function overlayBox(o, T, dpr) {
  let bounds = null;
  const add = (x, y, pad = 0) => { const [px, py] = mapply(T, x, y); bounds = unionBox(bounds, [px / dpr - pad, py / dpr - pad, px / dpr + pad, py / dpr + pad]); };
  const g = o.dim;
  if (g) {
    for (const l of g.lines) { add(l[0], l[1]); add(l[2], l[3]); }
    for (const [cx, cy, r] of g.arcs || []) for (const [dx, dy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) add(cx + dx * r, cy + dy * r);
    for (const tri of g.arrows) for (const q of tri) add(q[0], q[1]);
    if (g.text) { const px = g.text.h * Math.hypot(T[0], T[1]) / dpr; add(g.text.x, g.text.y, Math.max(px, g.text.label.length * px * 0.3)); }
  }
  for (const m of o.marks || []) {
    add(m[0], m[1], 12);
    if (m[3] && m[2]) {
      const [px, py] = mapply(T, m[0], m[1]);
      bounds = unionBox(bounds, [px / dpr, py / dpr - 16, px / dpr + 80, py / dpr]);
    }
  }
  for (const loop of o.contour || []) for (const q of loop) add(q[0], q[1]);
  return bounds;
}
