// compare.js — Compare two drawings, pure (no DOM): compare.test.mjs.   (TODO 41; mock-up R5d, Option B)
//
// A drawing becomes outlines (polylines in mm, y up); the second one is moved onto the first (Line up: bottom-left, centres, or by hand);
// then every place where an outline of one lies further than the tolerance from every outline of the other is a difference. The samples
// that differ are joined into "differences" (a numbered place, with how far off it is at the worst point).
//
//   polylines(fl, factor, off)        → { polys: [Float64Array [x0, y0, x1, y1 …]], box } from drawing.js flatten() (arcs sampled to 0.01 mm)
//   boxOf(polys)                      → [x0, y0, x1, y1] or null
//   lineUp(boxA, boxB, mode, manual)  → [dx, dy]: what to add to B's points so it sits on A ('bl' | 'centre' | 'manual')
//   compare(polysA, polysB, tol, opts) → { diffs: [{ n, x, y, mm, box, samples, side }], truncated, samples }
//        x, y: the worst point; mm: how far off it is there; side: 'A' (only the first has it), 'B' or 'AB'; opts.offsetB: [dx, dy]
import { mapply, mscale, arcSweep } from './drawing.js';
import { spaceOf, itemVisible } from './doc.js';

export const COLOURS = [
  { id: 'red', label: 'Red', css: '#c62828', dark: '#ff7b7b' },
  { id: 'blue', label: 'Blue', css: '#0a5fc2', dark: '#6db0ff' },
  { id: 'green', label: 'Green', css: '#1a7f37', dark: '#3fb950' },
  { id: 'orange', label: 'Orange', css: '#c25100', dark: '#f0894a' },
  { id: 'purple', label: 'Purple', css: '#7e3fc9', dark: '#b388f0' },
];
export const DEFAULT_TOL = 0.1;
export const MAX_TOL = 5;
const SAG = 0.01;                    // an arc is drawn within this many mm of true
const MAX_SAMPLES = 300000;          // samples along the outlines, per drawing
const MAX_FAR = 60000;               // differing samples kept
const MAX_DIFFS = 500;

/** The outlines of a flattened drawing (drawing.js flatten) in mm, y up: lines, polylines, arcs, circles, ellipses; not text, fills or points. */
export function polylines(fl, factor = 1, off = new Set()) {
  const polys = [], space = spaceOf(fl);
  for (const it of fl.items) {
    if (it.k !== 'p' || it.fill || (it.ps ? 1 : 0) !== space || !itemVisible(it, off)) continue;
    const m = fl.mats[it.m], sc = mscale(m) * factor, ops = it.ops;
    let cur = null;
    const flush = () => { if (cur && cur.length >= 4) polys.push(Float64Array.from(cur)); cur = null; };
    const P = (x, y) => { const q = mapply(m, x, y); return [q[0] * factor, q[1] * factor]; };
    let start = null;
    for (let k = 0; k < ops.length;) {
      const op = ops[k];
      if (op === 0) { flush(); const q = P(ops[k + 1], ops[k + 2]); cur = [q[0], q[1]]; start = q; k += 3; }
      else if (op === 1) { const q = P(ops[k + 1], ops[k + 2]); if (!cur) { cur = [q[0], q[1]]; start = q; } else cur.push(q[0], q[1]); k += 3; }
      else if (op === 2) {
        const [cx, cy, r, a0, a1, cw] = ops.slice(k + 1, k + 7), [s0, sw] = arcSweep(a0, a1, cw === 1), rmm = r * sc;
        const step = rmm > SAG ? Math.max(Math.PI / 180, Math.min(Math.PI / 4, 2 * Math.acos(1 - SAG / rmm))) : Math.PI / 4, n = Math.max(1, Math.ceil(sw / step));
        for (let j = 0; j <= n; j++) {
          const a = s0 + sw * j / n, q = P(cx + r * Math.cos(a), cy + r * Math.sin(a));
          if (!cur) { cur = [q[0], q[1]]; start = q; } else if (j > 0 || Math.hypot(q[0] - cur[cur.length - 2], q[1] - cur[cur.length - 1]) > 1e-9) cur.push(q[0], q[1]);
        }
        k += 7;
      } else { if (cur && start) cur.push(start[0], start[1]); flush(); start = null; k++; }
    }
    flush();
  }
  return { polys, box: boxOf(polys) };
}

export function boxOf(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (let i = 0; i < p.length; i += 2) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1]; }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

/** What to add to the second drawing's points to put it on the first: its bottom-left corner on the first's, or its centre on the first's. */
export function lineUp(a, b, mode, manual = [0, 0]) {
  if (mode === 'manual' || !a || !b) return [manual[0] || 0, manual[1] || 0];
  if (mode === 'centre') return [(a[0] + a[2]) / 2 - (b[0] + b[2]) / 2, (a[1] + a[3]) / 2 - (b[1] + b[3]) / 2];
  return [a[0] - b[0], a[1] - b[1]];
}

// ---------------------------------------------------------------- segments and a grid to find the nearest one

function segmentsOf(polys, dx, dy) {
  let n = 0;
  for (const p of polys) n += Math.max(0, p.length / 2 - 1);
  const s = new Float64Array(n * 4);
  let k = 0;
  for (const p of polys) for (let i = 0; i + 3 < p.length; i += 2) { s[k++] = p[i] + dx; s[k++] = p[i + 1] + dy; s[k++] = p[i + 2] + dx; s[k++] = p[i + 3] + dy; }
  return s;
}
const segDist = (px, py, s, k) => {
  const ax = s[k], ay = s[k + 1], bx = s[k + 2], by = s[k + 3], vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
  let t = l2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
};
function makeGrid(segs, box, c) {
  const cols = Math.max(1, Math.ceil((box[2] - box[0]) / c) + 1), rows = Math.max(1, Math.ceil((box[3] - box[1]) / c) + 1), cells = new Map();
  const add = (i, j, k) => { const key = j * cols + i; const l = cells.get(key); if (l) l.push(k); else cells.set(key, [k]); };
  for (let k = 0; k < segs.length; k += 4) {
    const i0 = Math.floor((Math.min(segs[k], segs[k + 2]) - box[0]) / c), i1 = Math.floor((Math.max(segs[k], segs[k + 2]) - box[0]) / c);
    const j0 = Math.floor((Math.min(segs[k + 1], segs[k + 3]) - box[1]) / c), j1 = Math.floor((Math.max(segs[k + 1], segs[k + 3]) - box[1]) / c);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) add(i, j, k);
  }
  return { segs, cells, cols, rows, c, x0: box[0], y0: box[1] };
}
const MAX_RING = 60;                 // how many cells out a search goes (a very far feature is reported as at least that far)
/** How far (x, y) is from the nearest segment of the grid (at least (MAX_RING + 1) cells when none is that near); Infinity when the drawing has no segments. */
function nearest(g, x, y) {
  if (!g.segs.length) return Infinity;
  const ci = Math.floor((x - g.x0) / g.c), cj = Math.floor((y - g.y0) / g.c), maxR = Math.min(MAX_RING, Math.max(g.cols, g.rows) + Math.max(Math.abs(ci), Math.abs(cj)) + 2);
  let best = Infinity;
  for (let r = 0; r <= maxR; r++) {
    for (let j = cj - r; j <= cj + r; j++) {
      const edge = j === cj - r || j === cj + r;
      for (let i = ci - r; i <= ci + r; i += edge || r === 0 ? 1 : 2 * r) {
        if (i < 0 || j < 0 || i >= g.cols || j >= g.rows) continue;
        const l = g.cells.get(j * g.cols + i);
        if (!l) continue;
        for (const k of l) { const d = segDist(x, y, g.segs, k); if (d < best) best = d; }
      }
    }
    if (best <= r * g.c) break;
  }
  return best === Infinity ? (maxR + 1) * g.c : best;           // nothing within the rings searched: at least this far
}

// ---------------------------------------------------------------- the differences

/** Joins points that lie within `link` of each other into groups. Points [x, y, d, side]; → [[index…]]. */
function groups(pts, link) {
  const parent = pts.map((_, i) => i), find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const cells = new Map();
  pts.forEach((p, i) => {
    const ci = Math.floor(p[0] / link), cj = Math.floor(p[1] / link);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const l = cells.get((cj + dj) + ',' + (ci + di));
      if (l) for (const o of l) if (Math.hypot(pts[o][0] - p[0], pts[o][1] - p[1]) <= link) { const a = find(i), b = find(o); if (a !== b) parent[a] = b; }
    }
    const key = cj + ',' + ci;
    const l = cells.get(key);
    if (l) l.push(i); else cells.set(key, [i]);
  });
  const out = new Map();
  pts.forEach((_, i) => { const r = find(i), l = out.get(r); if (l) l.push(i); else out.set(r, [i]); });
  return [...out.values()];
}

/**
 * The differences between two sets of outlines (mm): wherever an outline of one is more than `tol` mm from every outline of the other.
 * B is first moved by opts.offsetB. A difference is a group of such points close together, numbered from the left.
 */
export function compare(polysA, polysB, tol = DEFAULT_TOL, opts = {}) {
  const [dx, dy] = opts.offsetB || [0, 0];
  const sa = segmentsOf(polysA, 0, 0), sb = segmentsOf(polysB, dx, dy);
  const out = { diffs: [], truncated: false, samples: 0 };
  if (!sa.length && !sb.length) return out;
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of [sa, sb]) for (let k = 0; k < s.length; k += 2) { if (s[k] < box[0]) box[0] = s[k]; if (s[k] > box[2]) box[2] = s[k]; if (s[k + 1] < box[1]) box[1] = s[k + 1]; if (s[k + 1] > box[3]) box[3] = s[k + 1]; }
  let total = 0;
  for (const s of [sa, sb]) for (let k = 0; k < s.length; k += 4) total += Math.hypot(s[k + 2] - s[k], s[k + 3] - s[k + 1]);
  const step = Math.max(Math.min(Math.max(tol, 0.1), 2), total / MAX_SAMPLES), c = Math.max(tol * 4, Math.hypot(box[2] - box[0], box[3] - box[1]) / 200, 0.5);
  const ga = makeGrid(sa, box, c), gb = makeGrid(sb, box, c), far = [];
  const sweep = (segs, other, side) => {
    for (let k = 0; k < segs.length && far.length < MAX_FAR; k += 4) {
      const len = Math.hypot(segs[k + 2] - segs[k], segs[k + 3] - segs[k + 1]), n = Math.max(1, Math.ceil(len / step));
      for (let j = 0; j <= n; j++) {
        if (j === n && k + 4 < segs.length && segs[k + 2] === segs[k + 4] && segs[k + 3] === segs[k + 5]) continue;      // the next segment starts here
        const t = j / n, x = segs[k] + (segs[k + 2] - segs[k]) * t, y = segs[k + 1] + (segs[k + 3] - segs[k + 1]) * t;
        out.samples++;
        const d = nearest(other, x, y);
        if (d > tol) { far.push([x, y, d, side]); if (far.length >= MAX_FAR) { out.truncated = true; break; } }
      }
    }
  };
  sweep(sa, gb, 'A');
  sweep(sb, ga, 'B');
  const link = Math.max(1, 3 * step);
  const list = groups(far, link).map((g) => {
    let worst = g[0], x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, hasA = false, hasB = false;
    for (const i of g) {
      const p = far[i];
      if (p[2] > far[worst][2]) worst = i;
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      if (p[3] === 'A') hasA = true; else hasB = true;
    }
    const w = far[worst];
    return { x: w[0], y: w[1], mm: w[2], box: [x0, y0, x1, y1], samples: g.length, side: hasA && hasB ? 'AB' : hasA ? 'A' : 'B' };
  });
  if (list.length > MAX_DIFFS) out.truncated = true;
  list.sort((p, q) => p.x - q.x || p.y - q.y);
  out.diffs = list.slice(0, MAX_DIFFS).map((d, i) => ({ n: i + 1, ...d }));
  return out;
}
