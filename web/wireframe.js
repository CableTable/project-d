// Screen-only paint mode; the flattened drawing and output geometry stay untouched.
export function paintMode(item, wireframe = false) {
  if (wireframe && item.ops) return 'stroke';
  if (item.k === 'p') return item.fill ? 'fill' : 'stroke';
  return { h: 'hatch', w: 'mask', t: 'text', n: 'point' }[item.k];
}
