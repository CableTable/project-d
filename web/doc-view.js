// A tab's view is session-only; hidden tabs keep their drawing centre on resize.
export function restoreView(saved, { w, h }) {
  if (!saved) return { fitted: true };
  const { scale, ox, oy, fitted } = saved;
  return { scale, ox: ox + (saved.w - w) / (2 * scale), oy: oy + (saved.h - h) / (2 * scale), fitted };
}
