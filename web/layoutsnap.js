// Layout Measure snaps in sheet mm, y up; reuse each part's drawing snap index.
import { placedMat } from './apply.js';
import { mapply } from './drawing.js';
import { makeIndex, snapPick } from './edit.js';
import { DEFAULT_TYPES, preferSnap } from './snap.js';

const indexes = new WeakMap();

export function layoutSnap(parts, placed, W, H, x, y, tol, types = DEFAULT_TYPES) {
  let best = null;
  const consider = (qx, qy, kind) => { best = preferSnap(best, { x: qx, y: qy, kind }, x, y, tol, types); };
  for (const p of placed) {
    const part = parts[p.partId];
    if (!part?.fl) continue;
    let ed = indexes.get(part);
    if (!ed) { ed = makeIndex(part.raw, part.fl, part.off); indexes.set(part, ed); }
    // placedMat uses y down; query the part in its own units, then turn its snap back to y up.
    const M = placedMat(part, p, 0), [a, b, c, d, e, f] = M, det = a * d - b * c;
    const dx = x - e, dy = -y - f;
    const sn = snapPick(ed, (d * dx - c * dy) / det, (a * dy - b * dx) / det, tol / (part.factor || 1), true, -1, types);
    if (sn) { const q = mapply(M, sn.x, sn.y); consider(q[0], -q[1], sn.kind); }
  }
  for (const [qx, qy] of [[0, 0], [W, 0], [W, H], [0, H]]) consider(qx, qy, 'end');
  for (const [qx, qy] of [[W / 2, 0], [W, H / 2], [W / 2, H], [0, H / 2]]) consider(qx, qy, 'mid');
  const cx = Math.max(0, Math.min(W, x)), cy = Math.max(0, Math.min(H, y));
  for (const [qx, qy] of [[cx, 0], [cx, H], [0, cy], [W, cy]]) consider(qx, qy, 'near');
  return best;
}
