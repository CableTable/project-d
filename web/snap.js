// Snap types use the same keys as the drawing index and marker names.
export const SNAP_NAME = { end: 'end', mid: 'middle', centre: 'centre', node: 'point', near: 'nearest', intersection: 'intersection', quadrant: 'quadrant' };
export const DEFAULT_TYPES = Object.freeze(Object.fromEntries(Object.keys(SNAP_NAME).map((k) => [k, true])));

/** Stored settings are optional and untrusted; missing or invalid ticks default to on. */
export function snapTypes(saved) {
  return Object.fromEntries(Object.keys(SNAP_NAME).map((k) => [k, typeof saved?.[k] === 'boolean' ? saved[k] : true]));
}

const RANK = { end: 0, centre: 1, node: 2, mid: 3, intersection: 4, quadrant: 5, near: 6 };
/** Keep the closest enabled candidate in tolerance; every feature beats nearest. Ends win an exact tie. */
export function preferSnap(best, candidate, x, y, tol, types = DEFAULT_TYPES) {
  if (!candidate || types[candidate.kind] === false) return best;
  const d = Math.hypot(candidate.x - x, candidate.y - y);
  if (d > tol) return best;
  if (!best) return candidate;
  if ((candidate.kind === 'near') !== (best.kind === 'near')) return best.kind === 'near' ? candidate : best;
  const bd = Math.hypot(best.x - x, best.y - y);
  return d < bd - 1e-12 || (Math.abs(d - bd) <= 1e-12 && RANK[candidate.kind] < RANK[best.kind]) ? candidate : best;
}
