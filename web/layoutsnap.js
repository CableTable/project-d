// Layout Measure snaps in sheet mm, y up; reuse each part's drawing snap index.
import { placedMat } from './apply.js';
import { mapply } from './drawing.js';
import { makeIndex, snapPick, snapObject, snapCandidates, snapReference } from './edit.js';
import { DEFAULT_TYPES, preferSnap, orderCandidates } from './snap.js';

const indexes = new WeakMap();

/** The part's pick index, built once. */
export function partIndex(part) {
  let ed = indexes.get(part);
  if (!ed) { ed = makeIndex(part.raw, part.fl, part.off); indexes.set(part, ed); }
  return ed;
}

/** A sheet point (mm, y up) in the part's own units, for the placement `pl`. placedMat uses y down, so the sheet y is negated. */
export function toPart(part, pl, x, y) {
  const [a, b, c, d, e, f] = placedMat(part, pl, 0), det = a * d - b * c;
  return [(d * (x - e) - c * (-y - f)) / det, (a * (-y - f) - b * (x - e)) / det];
}

export function layoutSnap(parts, placed, W, H, x, y, tol, types = DEFAULT_TYPES, from = null) {
  let best = null;
  const consider = (qx, qy, kind) => { best = preferSnap(best, { x: qx, y: qy, kind }, x, y, tol, types); };
  for (const p of placed) {
    const part = parts[p.partId];
    if (!part?.fl) continue;
    // query the part in its own units, then turn its snap back to y up.
    const M = placedMat(part, p, 0);
    const sn = snapPick(partIndex(part), ...toPart(part, p, x, y), tol / (part.factor || 1), true, -1, types, [], from && toPart(part, p, from[0], from[1]));
    if (sn) { const q = mapply(M, sn.x, sn.y); consider(q[0], -q[1], sn.kind); }
  }
  for (const [qx, qy] of [[0, 0], [W, 0], [W, H], [0, H]]) consider(qx, qy, 'end');
  for (const [qx, qy] of [[W / 2, 0], [W, H / 2], [W / 2, H], [0, H / 2]]) consider(qx, qy, 'mid');
  const cx = Math.max(0, Math.min(W, x)), cy = Math.max(0, Math.min(H, y));
  for (const [qx, qy] of [[cx, 0], [cx, H], [0, cy], [W, cy]]) consider(qx, qy, 'near');
  return best;
}

/** One placed object's candidates, transformed back into sheet millimetres. */
export function layoutCandidates(parts, placed, W, H, x, y, tol, types = DEFAULT_TYPES, from = null) {
  let best = null;
  for (const pl of placed) {
    const part = parts[pl.partId];
    if (!part?.fl) continue;
    const ed = partIndex(part), p = toPart(part, pl, x, y), localTol = tol / (part.factor || 1);
    const sn = snapPick(ed, ...p, localTol, true, -1, types, [], from && toPart(part, pl, ...from));
    if (!sn) continue;
    const M = placedMat(part, pl, 0), world = (q) => { const r = mapply(M, q.x, q.y); return { x: r[0], y: -r[1], kind: q.kind }; };
    const q = world(sn), d = Math.hypot(x - q.x, y - q.y);
    if (best && d >= best.distance) continue;
    const e = snapObject(ed, ...p, localTol, -1, types);
    if (e < 0) continue;
    best = { object: pl, e, distance: d, candidates: snapCandidates(ed, e, ...p, localTol, types, from && toPart(part, pl, ...from)).map(world) };
  }
  if (best) return best;
  const edges = [[[0, 0], [W, 0]], [[W, 0], [W, H]], [[0, H], [W, H]], [[0, 0], [0, H]]];
  for (let e = 0; e < edges.length; e++) {
    const [a, b] = edges[e], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    const q = { x: a[0] + t * dx, y: a[1] + t * dy, kind: 'near' }, d = Math.hypot(x - q.x, y - q.y);
    if (d > tol || best && d >= best.distance) continue;
    best = { object: 'sheet', e, distance: d, candidates: orderCandidates([{ x: a[0], y: a[1], kind: 'end' }, { x: b[0], y: b[1], kind: 'end' }, { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, kind: 'mid' }, q], types) };
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
    if (!best || d < best.d) best = { d, pl, part, piece: { t: 's', x1: a[0], y1: -a[1], x2: b[0], y2: -b[1] } };
  }
  return best;
}
