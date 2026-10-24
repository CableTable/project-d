// Move's typed coordinates and direct distance, in mm. No DOM.
import { parseInput } from './draw.js';

/** A base point is absolute; a target pair is displacement from base. A distance follows cursor. */
export function movePoint(text, base = null, cursor = null) {
  const p = parseInput(text);
  let q = null;
  if (p.kind === 'xy' && !p.rel) q = base ? [base[0] + p.x, base[1] + p.y] : [p.x, p.y];
  else if (base && cursor && p.kind === 'len' && p.v > 0) {
    const dx = cursor[0] - base[0], dy = cursor[1] - base[1], len = Math.hypot(dx, dy);
    if (len > 0) q = [base[0] + dx / len * p.v, base[1] + dy / len * p.v];
  }
  return q && q.every(Number.isFinite) ? q : null;
}
