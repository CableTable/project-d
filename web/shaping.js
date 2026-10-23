// shaping.js — Shaping like CorelDRAW (TODO 122): boolean operations on closed outlines, pure (no DOM, no files): shaping.test.mjs.
//
// An outline is a closed loop of points [x, y] (edit.js outlineLoops flattens arcs and circles). Loops nested inside each other (even-odd) are one
// shape with holes, so a washer is one operand, not two. A result is a list of closed rings: a shape with holes is several rings, which the caller draws
// as closed polylines. The boolean maths is the vendored polygon-clipping (MIT, web/vendor/polygon-clipping).
//
//   operandsOf(loops)            → [{ poly: [outer, ...holes], loops: [loop indexes], area }]   the shapes the loops make
//   shape(op, loops, target)     → { rings, area, operands } | { error }   op: a key of OPS; target: the loop index Trim cuts (-1 = the largest shape)
//   OPS                          → { weld, trim, intersect }   { label, run(polys, target) } (a new operation is one more entry)
import pc from './vendor/polygon-clipping/polygon-clipping.js';

const ringArea = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(s) / 2; };
// a loop is inside another only when nothing of it sticks out (shared edges count as inside), so a bar across a U's top is not the U's hole
const within = (a, b) => pc.difference([a], [b]).length === 0;

export function operandsOf(loops) {
  const pts = loops.map((l) => l.pts || l), a = pts.map(ringArea);
  const boxes = pts.map((r) => r.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]));
  const boxIn = (i, j) => boxes[i][0] >= boxes[j][0] && boxes[i][1] >= boxes[j][1] && boxes[i][2] <= boxes[j][2] && boxes[i][3] <= boxes[j][3];
  // the loops that hold loop i, smallest first: its depth is how many there are, its parent the smallest
  const holders = pts.map((r, i) => pts.map((_, j) => j).filter((j) => j !== i && a[j] > a[i] && boxIn(i, j) && within(r, pts[j])).sort((x, y) => a[x] - a[y]));
  const out = new Map();
  pts.forEach((r, i) => { if (holders[i].length % 2 === 0) out.set(i, { poly: [r], loops: [i], area: a[i] }); });
  pts.forEach((r, i) => { if (holders[i].length % 2) { const o = out.get(holders[i][0]); o.poly.push(r); o.loops.push(i); o.area -= a[i]; } });
  return [...out.values()];
}

export const OPS = {
  weld: { label: 'Weld', run: (polys) => pc.union(polys[0], ...polys.slice(1)) },
  trim: { label: 'Trim', run: (polys, t) => pc.difference(polys[t], ...polys.filter((_, i) => i !== t)) },
  intersect: { label: 'Intersect', run: (polys) => pc.intersection(polys[0], ...polys.slice(1)) },
};

export function shape(op, loops, target = -1) {
  const o = OPS[op];
  if (!o) return { error: 'Unknown shaping operation: ' + op };
  try { return run(o, loops, target); } catch { return { error: 'Shaping failed on these outlines, nothing changed' }; }   // polygon-clipping can throw on degenerate input
}

function run(o, loops, target) {
  const operands = operandsOf(loops);
  if (operands.length < 2) return { error: `${o.label} needs at least 2 closed outlines` + (loops.length > 1 ? ' (outlines inside another one count as its holes)' : ''), operands };
  let t = operands.findIndex((x) => x.loops.includes(target));
  if (t < 0) t = operands.reduce((best, x, i) => (x.area > operands[best].area ? i : best), 0);
  const multi = o.run(operands.map((x) => x.poly), t), rings = [];
  let area = 0;
  for (const poly of multi) {
    poly.forEach((r, k) => {
      const ring = r.slice(0, -1);                                  // pc closes each ring by repeating its first point
      if (ring.length < 3) return;
      rings.push(ring);
      area += k ? -ringArea(ring) : ringArea(ring);
    });
  }
  return { rings, area, operands, target: t };
}
