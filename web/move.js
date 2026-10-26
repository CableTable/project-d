// Move and Copy's typed coordinates and direct distance, in mm. No DOM.
import { parseInput, typedPoint, directDistance } from './draw.js';

/** Bare target pairs stay displacement from base; explicit relative points use the last pick. */
export function movePoint(text, base = null, cursor = null, last = base) {
  const p = parseInput(text);
  let q = null;
  if (p.kind === 'xy' && !p.rel && base) q = typedPoint({ ...p, rel: true }, base);
  else if (p.kind === 'len' && p.v > 0) q = directDistance(base, cursor, p.v);
  else q = typedPoint(p, last);
  return q && q.every(Number.isFinite) ? q : null;
}
