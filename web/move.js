// Move and Copy's typed coordinates and direct distance, in mm. No DOM.
import { parseInput, typedPoint, directDistance } from './draw.js';

/** s (Copy only): { count: the remembered Array count, arr: { fit } while Array waits for its point, placed: a copy is already down }. */
export function movePrompt(kind, stage, mode, displacement = [0, 0], s = {}) {
  if (stage === 'count') return `Enter number of items to array <${s.count}>:`;
  if (stage === 'pick') return kind === 'stretch' ? 'Select objects:' : 'Select objects (click or drag a box), then Enter:';
  if (stage === 'mode') return `Enter a copy mode option [Single/Multiple] <${mode}>:`;
  if (stage === 'displacement') return kind === 'stretch' ? `Specify displacement <${displacement.map((v) => v.toFixed(4)).join(', ')}>:` : 'Specify displacement <0,0>:';
  if (stage === 'p1') return `Specify base point or [Displacement${kind === 'copy' ? '/mOde' : ''}] <Displacement>:`;
  if (kind !== 'copy') return 'Specify second point or <use first point as displacement>:';
  if (s.arr) return s.arr.fit ? 'Specify second point or [Array]:' : 'Specify second point or [Fit]:';
  return s.placed ? 'Specify second point or [Array/Exit/Undo] <Exit>:' : 'Specify second point or [Array] <use first point as displacement>:';
}

export const ARRAY_MAX = 1000;
/** Copy Array's "number of items" (the original counts): { n } for a whole number 2..1000, else { error }. */
export function parseArrayCount(text) {
  const t = String(text).trim();
  if (!/^\d+$/.test(t)) return { error: 'Requires an integer value of 2 or more' };
  const n = Number(t);
  return n < 2 ? { error: 'Requires an integer value of 2 or more' } : n > ARRAY_MAX ? { error: `At most ${ARRAY_MAX} items` } : { n };
}
/** The n - 1 copies of Copy Array: the point is the spacing to the first copy, or (fit) the last copy with the rest spaced evenly. */
export function arrayOffsets(dx, dy, n, fit = false) {
  const k = fit ? 1 / (n - 1) : 1;
  return Array.from({ length: n - 1 }, (_, i) => ({ dx: dx * k * (i + 1), dy: dy * k * (i + 1) }));
}

/** Bare target pairs stay displacement from base; explicit relative points use the last pick. */
export function movePoint(text, base = null, cursor = null, last = base, unit = 'mm') {
  const p = parseInput(text, unit);
  let q = null;
  if (p.kind === 'xy' && !p.rel && !p.abs && base) q = typedPoint({ ...p, rel: true }, base);
  else if (p.kind === 'len' && p.v > 0) q = directDistance(base, cursor, p.v);
  else q = typedPoint(p, last);
  return q && q.every(Number.isFinite) ? q : null;
}
