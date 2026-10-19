// nestshape.js — pure: the outline Auto-nest packs a part by (no DOM) — nest.test.mjs.
//
// A part's outline is its biggest closed loop of lines and arcs (what contour.js joins), in mm with the part's own lower-left corner at 0,0,
// y up. KNOWN LIMITS: a hole is not used (the outline is the outer loop only); a part with no closed loop, or whose biggest loop does not
// cover the part's extents (so there is more drawn outside it), gets the convex hull of everything it draws; text and dimensions are left out.
// Arcs are sampled every 4°. A part with nothing usable is its box.
import * as Ed from './edit.js';
import * as CT from './contour.js';
import { polyArea, polyBox } from './nest.js';

/** The convex hull of points ([[x, y], …]), anticlockwise, no repeated point. */
export function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]).filter((q, i, a) => !i || q[0] !== a[i - 1][0] || q[1] !== a[i - 1][1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Points with repeats and straight-through points taken out (an outline of thousands of tiny steps stays as many as it needs). */
function tidy(pts) {
  const out = [];
  for (const q of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-9) out.push(q); }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-9) out.pop();
  const keep = out.filter((q, i) => {
    const a = out[(i + out.length - 1) % out.length], b = out[(i + 1) % out.length];
    return Math.abs((q[0] - a[0]) * (b[1] - q[1]) - (q[1] - a[1]) * (b[0] - q[0])) > 1e-9;
  });
  return keep.length >= 3 ? keep : out;
}

/**
 * The part's outline: { poly, kind: 'outline' | 'hull' | 'box', holes } — poly in mm, its lower-left corner at 0,0 (the part's box), y up.
 * part: { raw, fl, off, factor, box, w, h } (layoutdoc.js makePart).
 */
export function outlineOf(part) {
  const f = part.factor || 1, [b0, b1] = part.box || [0, 0], box = () => ({ poly: [[0, 0], [part.w, 0], [part.w, part.h], [0, part.h]], kind: 'box', holes: 0 });
  const mm = (pts) => tidy(pts.map(([x, y]) => [(x - b0) * f, (y - b1) * f]));
  let segs = [];
  try {
    const ed = Ed.makeIndex(part.raw, part.fl, part.off || new Set()), ents = [];
    for (let e = 0; e < ed.byEnt.length; e++) if (ed.byEnt[e]) ents.push(e);
    segs = CT.segmentsFromItems(ed, ents, (e) => e.layer === Ed.DIM_LAYER || e.type === 'DIMENSION');
  } catch { return box(); }
  if (!segs.length) return box();
  const { loops } = CT.buildLoops(segs, 1e-3 / f);
  if (loops.length) {
    let big = loops[0], area = Math.abs(CT.loopArea(big));
    for (const l of loops) { const a = Math.abs(CT.loopArea(l)); if (a > area) { big = l; area = a; } }
    const poly = mm(CT.loopPoints(big, 4)), [x0, y0, x1, y1] = polyBox(poly), tol = Math.max(0.5, 0.01 * Math.max(part.w, part.h));
    if (poly.length >= 3 && polyArea(poly) > 0 && x1 - x0 >= part.w - tol && y1 - y0 >= part.h - tol) return { poly, kind: 'outline', holes: loops.length - 1 };
  }
  const pts = [];
  for (const s of segs) { for (const q of CT.loopPoints([s], 4)) pts.push(q); pts.push(s.p1); }
  const hl = hull(pts.map(([x, y]) => [(x - b0) * f, (y - b1) * f]));
  return hl.length >= 3 && polyArea(hl) > 0 ? { poly: hl, kind: 'hull', holes: 0 } : box();
}
