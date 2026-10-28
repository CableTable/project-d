// Snap types use the same keys as the drawing index and marker names.
export const SNAP_NAME = { end: 'end', mid: 'middle', centre: 'centre', geometric: 'geometric centre', node: 'point', quadrant: 'quadrant', intersection: 'intersection', extension: 'extension', insertion: 'insertion', perpendicular: 'perpendicular', tangent: 'tangent', near: 'nearest', apparent: 'apparent intersection', parallel: 'parallel' };
export const DEFAULT_TYPES = Object.freeze(Object.fromEntries(Object.keys(SNAP_NAME).map((k) => [k, true])));

/** Stored settings are optional and untrusted; missing or invalid ticks default to on. */
export function snapTypes(saved) {
  return Object.fromEntries(Object.keys(SNAP_NAME).map((k) => [k, typeof saved?.[k] === 'boolean' ? saved[k] : true]));
}

/** The foot of the perpendicular from `from` onto the segment a→b, on the segment itself only (not its extension); null for a zero-length segment. */
export function perpFoot(from, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  if (!(l2 > 0)) return null;
  const t = ((from[0] - a[0]) * dx + (from[1] - a[1]) * dy) / l2;
  return t < 0 || t > 1 ? null : [a[0] + t * dx, a[1] + t * dy];
}

const RANK = Object.fromEntries(['end', 'centre', 'node', 'mid', 'intersection', 'quadrant', 'perpendicular', 'tangent', 'geometric', 'insertion', 'extension', 'parallel', 'apparent', 'near'].map((k, i) => [k, i]));

/** Stable Tab order, with duplicate points of the same type removed (polyline joints, block contents). */
export function orderCandidates(candidates, types = DEFAULT_TYPES, x = 0, y = 0) {
  return candidates.filter((p) => types[p.kind] !== false).sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.x - b.x || a.y - b.y)
    .filter((p, i, all) => !i || p.kind !== all[i - 1].kind || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > 1e-9)
    .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y) || RANK[a.kind] - RANK[b.kind] || a.x - b.x || a.y - b.y);
}

/** Exact tangents from an external point to a circular piece, clipped to its finite sweep. */
export function tangentPoints(from, arc) {
  if (!from || arc.t !== 'a' || !(arc.r > 0)) return [];
  const dx = from[0] - arc.cx, dy = from[1] - arc.cy, d = Math.hypot(dx, dy);
  if (d <= arc.r) return [];
  const a = Math.atan2(dy, dx), delta = Math.acos(arc.r / d), tau = 2 * Math.PI;
  return [a - delta, a + delta].filter((t) => {
    const rel = ((t - arc.s) % tau + tau) % tau;
    return arc.full || rel <= arc.sw + 1e-10 || rel >= tau - 1e-10;
  }).map((t) => ({ x: arc.cx + arc.r * Math.cos(t), y: arc.cy + arc.r * Math.sin(t), kind: 'tangent' }));
}

/** Project onto an acquired straight edge's extension or a parallel through the last picked point. */
export function lineSnaps(piece, p, from) {
  if (!piece || piece.t !== 's' || piece.curve) return [];
  const dx = piece.x2 - piece.x1, dy = piece.y2 - piece.y1, l2 = dx * dx + dy * dy;
  if (!(l2 > 0)) return [];
  const project = (a) => { const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; return [a[0] + t * dx, a[1] + t * dy, t]; };
  const q = project([piece.x1, piece.y1]), out = [];
  if (q[2] < 0 || q[2] > 1) out.push({ x: q[0], y: q[1], kind: 'extension' });
  if (from) { const r = project(from); if (Math.hypot(r[0] - from[0], r[1] - from[1]) > 1e-9) out.push({ x: r[0], y: r[1], kind: 'parallel' }); }
  return out;
}

/** Area centroid of a simple straight polygon; refuse degenerate or self-crossing outlines. */
export function polygonCentre(points) {
  points = points.filter((p, i) => !i || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  if (points.length > 1 && points.at(-1)[0] === points[0][0] && points.at(-1)[1] === points[0][1]) points.pop();
  if (points.length < 3) return null;
  const [ox, oy] = points[0];
  points = points.map(([x, y]) => [x - ox, y - oy]);
  let area = 0, x = 0, y = 0;
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      if (Math.max(a[0], b[0]) >= Math.min(c[0], d[0]) && Math.max(c[0], d[0]) >= Math.min(a[0], b[0]) && Math.max(a[1], b[1]) >= Math.min(c[1], d[1]) && Math.max(c[1], d[1]) >= Math.min(a[1], b[1]) && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0) return null;
    }
    const v = a[0] * b[1] - b[0] * a[1]; area += v; x += (a[0] + b[0]) * v; y += (a[1] + b[1]) * v;
  }
  return Math.abs(area) > 1e-12 ? [ox + x / (3 * area), oy + y / (3 * area)] : null;
}

export function pathCentre(ops) {
  const points = [];
  for (let i = 0; i < ops.length; i += 3) {
    if (ops[i] === 9) {
      if (points.length > 1 && points.at(-1)[0] === points[0][0] && points.at(-1)[1] === points[0][1]) points.pop();
      return i === ops.length - 1 && points.length <= 200 ? polygonCentre(points) : null;
    }
    if (ops[i] !== (i ? 1 : 0)) return null;
    points.push([ops[i + 1], ops[i + 2]]);
    // shortcut: the simplicity check is quadratic; support larger geometric-centre polygons when it is indexed.
    if (points.length > 201) return null;
  }
  return null;
}
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
