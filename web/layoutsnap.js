// Layout Measure snaps in sheet mm, y up; reuse each part's drawing snap index.
import { placedMat } from './apply.js';
import { mapply } from './drawing.js';
import { makeIndex, snapPick, snapObject, snapCandidates, snapReference } from './edit.js';
import { DEFAULT_TYPES, preferSnap, orderCandidates } from './snap.js';
import { nearestObject } from './tangent.js';
import { gripOf } from './layout.js';

const indexes = new WeakMap();
const placedIndexes = new WeakMap();

/** The part's pick index; copies with the same frame share sheet-axis extremes. */
export function partIndex(part, pl) {
  if (pl && (pl.rot || 0) % 90 !== 0) {
    const frame = placedMat(part, pl, 0), key = frame.slice(0, 4).join(',');
    let cached = placedIndexes.get(part);
    if (!cached) { cached = new Map(); placedIndexes.set(part, cached); }
    if (!cached.has(key)) cached.set(key, makeIndex(part.raw, part.fl, part.off, null, frame));
    return cached.get(key);
  }
  let ed = indexes.get(part);
  if (!ed) { ed = makeIndex(part.raw, part.fl, part.off); indexes.set(part, ed); }
  return ed;
}

/** A sheet point (mm, y up) in the part's own units, for the placement `pl`. placedMat uses y down, so the sheet y is negated. */
export function toPart(part, pl, x, y) {
  const [a, b, c, d, e, f] = placedMat(part, pl, 0), det = a * d - b * c;
  return [(d * (x - e) - c * (-y - f)) / det, (a * (-y - f) - b * (x - e)) / det];
}

export function placedSnap(parts, placed, x, y, tol, types = DEFAULT_TYPES, from = null) {
  let best = null;
  for (const p of placed) {
    const part = parts[p.partId];
    if (!part?.fl) continue;
    // query the part in its own units, then turn its snap back to y up.
    const M = placedMat(part, p, 0);
    const sn = snapPick(partIndex(part, types.extreme ? p : null), ...toPart(part, p, x, y), tol / (part.factor || 1), true, -1, types, [], from && toPart(part, p, from[0], from[1]));
    if (sn) { const q = mapply(M, sn.x, sn.y); best = preferSnap(best, { x: q[0], y: -q[1], kind: sn.kind }, x, y, tol, types); }
  }
  return best;
}

/** The gripper lines (the usable area's sides, TODO 348) in sheet mm, y up: [a, b, side] (a below / left of b) for each side of `s` (gripTop … gripLeft) with a gripper > 0. */
export function gripperLines(W, H, s) {
  if (!s) return [];
  const T = gripOf(s, 'top'), R = gripOf(s, 'right'), B = gripOf(s, 'bottom'), L = gripOf(s, 'left'), x1 = W - R, y1 = H - T, out = [];
  if (T > 0) out.push([[L, y1], [x1, y1], 'top']);
  if (R > 0) out.push([[x1, B], [x1, y1], 'right']);
  if (B > 0) out.push([[L, B], [x1, B], 'bottom']);
  if (L > 0) out.push([[L, B], [L, y1], 'left']);
  return out;
}

/** The nearest point of segment a-b to (x, y). */
function onSegment([ax, ay], [bx, by], x, y) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
  return [ax + t * dx, ay + t * dy];
}

export function layoutSnap(parts, placed, W, H, x, y, tol, types = DEFAULT_TYPES, from = null, grip = null) {
  let best = placedSnap(parts, placed, x, y, tol, types, from);
  const consider = (qx, qy, kind) => { best = preferSnap(best, { x: qx, y: qy, kind }, x, y, tol, types); };
  for (const [qx, qy] of [[0, 0], [W, 0], [W, H], [0, H]]) consider(qx, qy, 'end');
  for (const [qx, qy] of [[W / 2, 0], [W, H / 2], [W / 2, H], [0, H / 2]]) consider(qx, qy, 'mid');
  const cx = Math.max(0, Math.min(W, x)), cy = Math.max(0, Math.min(H, y));
  for (const [qx, qy] of [[cx, 0], [cx, H], [0, cy], [W, cy]]) consider(qx, qy, 'near');
  for (const [a, b] of gripperLines(W, H, grip)) {
    consider(...a, 'end'); consider(...b, 'end');
    consider((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 'mid');
    consider(...onSegment(a, b, x, y), 'near');
  }
  return best;
}

/** The outer edge of any placed part's real outline (ends, quadrants and extremes of what it draws, turned with it) nearest `v` on `axis` ('x' or 'y', sheet mm, y up) within tol, or null (TODO 348). */
export function partEdgeSnap(parts, placed, axis, v, tol) {
  let best = null;
  for (const pl of placed) {
    const part = parts[pl.partId];
    if (!part?.fl) continue;
    const ed = partIndex(part, pl), M = placedMat(part, pl, 0);
    let lo = Infinity, hi = -Infinity;
    for (const s of ed.ix.snaps) {
      if (ed.vis[s.it] !== 1 || (s.kind !== 'end' && s.kind !== 'quadrant' && s.kind !== 'extreme')) continue;
      const q = mapply(M, s.x, s.y), c = axis === 'x' ? q[0] : -q[1];
      if (c < lo) lo = c;
      if (c > hi) hi = c;
    }
    for (const c of [lo, hi]) if (Math.abs(c - v) <= tol && (best === null || Math.abs(c - v) < Math.abs(best - v))) best = c;
  }
  return best;
}

/** One placed object's candidates, transformed back into sheet millimetres. */
export function layoutCandidates(parts, placed, W, H, x, y, tol, types = DEFAULT_TYPES, from = null, candidates = true, grip = null) {
  let best = null;
  for (const pl of placed) {
    const part = parts[pl.partId];
    if (!part?.fl) continue;
    const ed = partIndex(part, types.extreme ? pl : null), p = toPart(part, pl, x, y), localTol = tol / (part.factor || 1);
    const sn = snapPick(ed, ...p, localTol, true, -1, types, [], from && toPart(part, pl, ...from));
    if (!sn) continue;
    const M = placedMat(part, pl, 0), world = (q) => { const r = mapply(M, q.x, q.y); return { x: r[0], y: -r[1], kind: q.kind }; };
    const q = world(sn), d = Math.hypot(x - q.x, y - q.y);
    if (best && d >= best.distance) continue;
    const e = snapObject(ed, ...p, localTol, -1, types);
    if (e < 0) continue;
    best = { object: pl, e, distance: d, candidates: candidates ? snapCandidates(ed, e, ...p, localTol, types, from && toPart(part, pl, ...from)).map(world) : [] };
  }
  if (best) return best;
  const edges = [[[0, 0], [W, 0]], [[W, 0], [W, H]], [[0, H], [W, H]], [[0, 0], [0, H]]], lines = gripperLines(W, H, grip);
  for (const [object, list] of [['sheet', edges], ['gripper', lines]]) for (let e = 0; e < list.length; e++) {
    const [a, b] = list[e], [nx, ny] = onSegment(a, b, x, y);
    const q = { x: nx, y: ny, kind: 'near' }, d = Math.hypot(x - q.x, y - q.y);
    if (d > tol || best && d >= best.distance) continue;
    best = { object, e, distance: d, candidates: candidates ? orderCandidates([{ x: a[0], y: a[1], kind: 'end' }, { x: b[0], y: b[1], kind: 'end' }, { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, kind: 'mid' }, q], types, x, y) : [] };
  }
  return best;
}

/** The line, circle or arc of a placed object under a sheet point, in sheet mm (a Circle's tangent pick, TODO 346b): the nearest one, or null. */
export function layoutTangentObject(parts, placed, x, y, tol) {
  let best = null;
  for (const pl of placed) {
    const part = parts[pl.partId];
    if (!part?.fl) continue;
    const ed = partIndex(part), M = placedMat(part, pl, 0), scale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
    const hit = nearestObject(ed.ix, (i) => ed.vis[i] === 1, ...toPart(part, pl, x, y), tol / (part.factor || 1), (q) => { const w = mapply(M, q[0], q[1]); return [w[0], -w[1]]; }, scale);
    if (hit && (!best || hit.d * scale < best.d)) best = { d: hit.d * scale, o: hit.o };
  }
  return best;
}

export function layoutReference(parts, placed, x, y, tol) {
  let best = null;
  for (const pl of placed) {
    const part = parts[pl.partId];
    if (!part?.fl) continue;
    const piece = snapReference(partIndex(part), ...toPart(part, pl, x, y), tol / (part.factor || 1));
    if (!piece) continue;
    const M = placedMat(part, pl, 0), a = mapply(M, piece.x1, piece.y1), b = mapply(M, piece.x2, piece.y2);
    const dx = b[0] - a[0], dy = a[1] - b[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y + a[1]) * dy) / l2)) : 0;
    const d = Math.hypot(x - a[0] - t * dx, y + a[1] - t * dy);
    if (!best || d < best.d) best = { d, pl, part, source: piece, piece: { t: 's', x1: a[0], y1: -a[1], x2: b[0], y2: -b[1] } };
  }
  return best;
}
