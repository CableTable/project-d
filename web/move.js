// Move and Copy's typed coordinates and direct distance, in mm. No DOM.
import { parseInput, typedPoint, directDistance } from './draw.js';

export function movePrompt(kind, stage, mode) {
  if (stage === 'pick') return 'Select objects (click or drag a box), then Enter:';
  if (stage === 'mode') return `Enter a copy mode option [Single/Multiple] <${mode}>:`;
  if (stage === 'displacement') return 'Specify displacement <0,0>:';
  if (stage === 'p1') return `Specify base point or [Displacement${kind === 'copy' ? '/mOde' : ''}] <Displacement>:`;
  return 'Specify second point or <use first point as displacement>:';
}

/** Bare target pairs stay displacement from base; explicit relative points use the last pick. */
export function movePoint(text, base = null, cursor = null, last = base) {
  const p = parseInput(text);
  let q = null;
  if (p.kind === 'xy' && !p.rel && !p.abs && base) q = typedPoint({ ...p, rel: true }, base);
  else if (p.kind === 'len' && p.v > 0) q = directDistance(base, cursor, p.v);
  else q = typedPoint(p, last);
  return q && q.every(Number.isFinite) ? q : null;
}
