// perf.js — pure helpers for big drawings (TODO 55): which items a view can skip, and how to reuse the last painted bitmap while the view moves.

/** True when box b = [x0, y0, x1, y1], grown by pad, is wholly outside the view vr = [x0, y0, x1, y1] (same units). */
export const outsideView = (b, pad, vr) => b[2] + pad < vr[0] || b[0] - pad > vr[2] || b[3] + pad < vr[1] || b[1] - pad > vr[3];

/** True when the box, grown by pad, is under `min` px each way at k pixels per unit: 0.4 px for every paint, QUICK_PX for the quick paint right after a layer toggle (TODO 328b). */
export const subPixel = (b, pad, k, min = 0.4) => (b[2] - b[0] + 2 * pad) * k < min && (b[3] - b[1] + 2 * pad) * k < min;
export const QUICK_PX = 1;

/** True when a point is under 0.5 device px from the last drawn point; zero disables skipping. */
export const skipPoint = (dx, dy, pxPerUnit) => pxPerUnit > 0 && Math.hypot(dx, dy) * pxPerUnit < 0.5;

/** Largest singular value of the set transform: bounds device-pixel stretch even under shear. */
export function maxScale([a, b, c, d]) {
  const t = a * a + b * b + c * c + d * d, det = a * d - b * c;
  return Math.sqrt((t + Math.sqrt(Math.max(0, t * t - 4 * det * det))) / 2);
}

/** A full paint is heavy when it took over 25 ms of script (30 fps) or drew over 15 000 items (the raster cost shows later, not in script time):
 *  then moving the view reuses its bitmap until the view settles. */
export const heavy = (ms, drawn) => ms > 25 || drawn > 15000;

// Chunked work (TODO 316): a generator yields its progress (0..1) whenever due() says its time slice is used up.
// drain runs one to the end in a single call (the old synchronous behaviour); runChunks lets the page breathe between slices.
export const drain = (gen) => { let s; while (!(s = gen.next()).done); return s.value; };
export function slice(ms = 30) {
  let t = performance.now();
  return () => { const n = performance.now(); if (n - t < ms) return false; t = n; return true; };
}
/** The progress of `gen` squeezed into [a, b]; returns what gen returns. */
export function* scaled(gen, a, b) {
  for (;;) { const s = gen.next(); if (s.done) return s.value; yield a + (b - a) * s.value; }
}
/** Runs a generator one slice per timer tick; stops (undefined) as soon as alive() is false. onProgress gets each yielded fraction. */
export async function runChunks(gen, { onProgress, alive = () => true } = {}) {
  for (;;) {
    const s = gen.next();
    if (s.done) return s.value;
    if (!alive()) return undefined;
    onProgress?.(s.value);
    await new Promise((r) => setTimeout(r));
  }
}

/** Equal flat base-paint keys keep the same picture. */
export const sameBase = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Where the bitmap painted at view `a` lands in view `b` ({ ox, oy, scale }: sheet mm at the canvas' top-left, px per mm).
 * Returns { dx, dy, r }: shift in css px and the size ratio, so the bitmap is drawn at (dx, dy) with its size times r.
 */
export function snapPlace(a, b) {
  return { dx: (a.ox - b.ox) * b.scale, dy: (a.oy - b.oy) * b.scale, r: b.scale / a.scale };
}

/**
 * A bitmap of a w x h canvas holding a picture whose box is `box` ([x0, y0, x1, y1] px, null = unknown), drawn again shifted by (dx, dy) px:
 * true when every pixel that shows on the canvas after the shift was inside the canvas before it (nothing the bitmap lacks slides into view).
 */
export function blitCovers(box, dx, dy, w, h) {
  if (!dx && !dy) return true;
  if (!box) return false;
  const [x0, y0, x1, y1] = [Math.max(box[0], -dx), Math.max(box[1], -dy), Math.min(box[2], w - dx), Math.min(box[3], h - dy)];
  return x0 >= x1 || y0 >= y1 || (x0 >= 0 && y0 >= 0 && x1 <= w && y1 <= h);
}

/**
 * A w x h bitmap moved by whole device px (dx, dy) (TODO 324a, pan end): the rectangles [x0, y0, x1, y1] it no longer covers, none twice
 * (the full-width band on the side it moved away from, then the rest of the height); null when it moved by a whole canvas or more (nothing is left to reuse).
 */
export function panStrips(dx, dy, w, h) {
  if (Math.abs(dx) >= w || Math.abs(dy) >= h) return null;
  const out = [], y0 = Math.max(0, dy), y1 = Math.min(h, h + dy);
  if (dy) out.push(dy > 0 ? [0, 0, w, dy] : [0, h + dy, w, h]);
  if (dx) out.push(dx > 0 ? [0, y0, dx, y1] : [w + dx, y0, w, y1]);
  return out;
}

/** The bitmap can stand in at another canvas size, as long as the view has not zoomed far from it. */
export function snapUsable(snap, want) {
  if (!snap) return false;
  const r = want.view.scale / snap.view.scale;
  return r > 0.1 && r < 20;
}
