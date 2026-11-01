// Pattern families clipped by an even-odd scanline; circular edges stay exact.
import { hatchPattern, arcSweep } from './drawing.js';
import { get } from './grips.js';
import { line } from './dxf-write.js';

const LIMIT = 100000;

/** Boundary edges in a family's frame, split at circular extrema for the half-open crossing rule. */
function edgesOf(ops, a) {
  const c = Math.cos(a), s = Math.sin(a), frame = (x, y) => [x * c + y * s, -x * s + y * c], edges = [];
  let first, last;
  const straight = (p) => { if (last) edges.push({ p: last, q: p }); last = p; };
  for (let i = 0; i < ops.length;) {
    const op = ops[i++];
    if (op === 0 || op === 1) {
      const p = frame(ops[i++], ops[i++]);
      if (op === 0) first = last = p; else straight(p);
    } else if (op === 9) straight(first);
    else if (op === 2) {
      const [cx, cy] = frame(ops[i], ops[i + 1]), r = ops[i + 2], [start, sweep] = arcSweep(ops[i + 3], ops[i + 4], ops[i + 5]);
      const lo = start - a, hi = lo + sweep, cuts = [lo];
      for (let t = Math.floor((lo - Math.PI / 2) / Math.PI) + 1; Math.PI / 2 + t * Math.PI < hi; t++) cuts.push(Math.PI / 2 + t * Math.PI);
      cuts.push(hi);
      for (let j = 1; j < cuts.length; j++) {
        edges.push({ p: [cx + r * Math.cos(cuts[j - 1]), cy + r * Math.sin(cuts[j - 1])], q: [cx + r * Math.cos(cuts[j]), cy + r * Math.sin(cuts[j])], cx, cy, r, side: Math.sign(Math.cos((cuts[j - 1] + cuts[j]) / 2)) });
      }
      const end = (ops[i + 5] ? start : start + sweep) - a;
      last = [cx + r * Math.cos(end), cy + r * Math.sin(end)];
      i += 6;
    }
  }
  return edges;
}

/** Plain LINEs, or a refusal before the caller edits anything. No boundary entity is changed. */
export function explodeHatch(e) {
  if (get(e.r, 70) === 1 || get(e.r, 450) === 1) throw new Error('Cannot explode HATCH');
  const hatch = hatchPattern(e), segments = [];
  if (!hatch?.fam?.length) throw new Error('Cannot explode HATCH');
  let count = 0, steps = 0;
  for (const f of hatch.fam) {
    const c = Math.cos(f.a), s = Math.sin(f.a), edges = edgesOf(hatch.ops, f.a);
    const base = -f.bx * s + f.by * c, spacing = -f.ox * s + f.oy * c;
    if (!Number.isFinite(spacing) || Math.abs(spacing) < 1e-15) throw new Error('Cannot explode HATCH');
    let min = Infinity, max = -Infinity;
    for (const edge of edges) for (const p of [edge.p, edge.q]) { min = Math.min(min, (p[1] - base) / spacing); max = Math.max(max, (p[1] - base) / spacing); }
    const emit = (x0, x1, y) => {
      if (x1 - x0 <= 1e-9) return;
      count++;
      if (count > 1000000) throw new Error('Hatch too dense to explode (more than 1,000,000 lines)');
      if (count <= LIMIT) segments.push([(x0 * c - y * s) * (e.flip ? -1 : 1), x0 * s + y * c, (x1 * c - y * s) * (e.flip ? -1 : 1), x1 * s + y * c]);
    };
    const period = f.d.reduce((n, d) => n + Math.abs(d), 0);
    for (let n = Math.ceil(min); n <= Math.floor(max); n++) {
      const y = base + n * spacing, hits = [];
      for (const edge of edges) {
        const { p, q } = edge;
        if ((p[1] > y) === (q[1] > y)) continue;
        hits.push(edge.r ? edge.cx + edge.side * Math.sqrt(Math.max(0, edge.r ** 2 - (y - edge.cy) ** 2)) : p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
      }
      hits.sort((a, b) => a - b);
      const origin = (f.bx + n * f.ox) * c + (f.by + n * f.oy) * s;
      for (let j = 1; j < hits.length; j += 2) {
        const lo = hits[j - 1], hi = hits[j];
        if (!period) { emit(lo, hi, y); continue; }
        for (let t = Math.floor((lo - origin) / period); origin + t * period < hi; t++) {
          let x = origin + t * period;
          for (const d of f.d) {
            if (++steps > 1000000) throw new Error('Hatch pattern too fine to explode');
            if (d >= 0) emit(Math.max(lo, x), Math.min(hi, x + (d || 1e-8)), y);
            x += Math.abs(d);
          }
        }
      }
    }
  }
  if (count > LIMIT) throw new Error(`Hatch too dense to explode (${count} lines)`);
  return segments.map((p) => line(...p, { ...e, fill: null }));
}
