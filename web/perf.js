// perf.js — pure helpers for big drawings (TODO 55): which items a view can skip, and how to reuse the last painted bitmap while the view moves.

/** True when box b = [x0, y0, x1, y1], grown by pad, is wholly outside the view vr = [x0, y0, x1, y1] (same units). */
export const outsideView = (b, pad, vr) => b[2] + pad < vr[0] || b[0] - pad > vr[2] || b[3] + pad < vr[1] || b[1] - pad > vr[3];

/** True when the box, grown by pad, is under half a pixel each way at k pixels per unit. */
export const subPixel = (b, pad, k) => (b[2] - b[0] + 2 * pad) * k < 0.4 && (b[3] - b[1] + 2 * pad) * k < 0.4;

/** A full paint is heavy when it took over 25 ms of script (30 fps) or drew over 15 000 items (the raster cost shows later, not in script time):
 *  then moving the view reuses its bitmap until the view settles. */
export const heavy = (ms, drawn) => ms > 25 || drawn > 15000;

/**
 * Where the bitmap painted at view `a` lands in view `b` ({ ox, oy, scale }: sheet mm at the canvas' top-left, px per mm).
 * Returns { dx, dy, r }: shift in css px and the size ratio, so the bitmap is drawn at (dx, dy) with its size times r.
 */
export function snapPlace(a, b) {
  return { dx: (a.ox - b.ox) * b.scale, dy: (a.oy - b.oy) * b.scale, r: b.scale / a.scale };
}

/** The bitmap `snap` ({ view, w, h } as painted) can stand in for a paint of `want` ({ view, w, h }): same canvas size, and not zoomed far from it. */
export function snapUsable(snap, want) {
  if (!snap || snap.w !== want.w || snap.h !== want.h) return false;
  const r = want.view.scale / snap.view.scale;
  return r > 0.1 && r < 20;
}
