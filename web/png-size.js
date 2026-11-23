// png-size.js — pure: Export's PNG size for a page in mm at a DPI, with the canvas cap (TODO 109c2) — png-size.test.mjs.
export const PNG_MAX_SIDE = 16384, PNG_MAX_PIXELS = 268e6;

/** wMm × hMm at dpi → { w, h, dpi, capped } in px. Over the side or pixel cap: the largest whole dpi that fits (capped = true), each side at least 1 px. */
export function pngSize(wMm, hMm, dpi) {
  const px = (d) => [Math.max(1, Math.round(wMm / 25.4 * d)), Math.max(1, Math.round(hMm / 25.4 * d))];
  const fits = (d) => { const [w, h] = px(d); return w <= PNG_MAX_SIDE && h <= PNG_MAX_SIDE && w * h <= PNG_MAX_PIXELS; };
  if (fits(dpi)) return { w: px(dpi)[0], h: px(dpi)[1], dpi, capped: false };
  let lo = 1, hi = dpi;                                   // fits(lo) is assumed true: the largest d in [lo, hi) that fits, by bisection (fits only gets harder as d grows)
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid; }
  const [w, h] = px(lo);
  return { w, h, dpi: lo, capped: true };
}
