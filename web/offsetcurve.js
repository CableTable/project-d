// Ellipse / spline offsets as degree-3 fit-only splines; pure: offsetcurve.test.mjs.
import { curveShape } from './extend.js';
import { nurbsAt, nurbsOk } from './drawing.js';
import { entity } from './dxf-write.js';
import { get } from './grips.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const length = (a) => Math.hypot(...a);
const unit = (a) => { const n = length(a); return n ? a.map((v) => v / n) : [0, 0]; };
const distance = (p, a, b) => {
  const v = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), v) / (dot(v, v) || 1)));
  return length(sub(p, a.map((v, i) => v + t * (b[i] - v))));
};
const gone = { error: 'The offset is more than the shape can take: nothing is left' };

/** The exact source behind curveShape's samples, when it has a parametric curve. */
function evaluator(ent, sh) {
  if (sh.q) {
    const q = sh.q;
    return (u) => {
      const t = q.t0 + (q.t1 - q.t0) * u;
      return q.c.map((v, i) => v + q.m[i] * Math.cos(t) + q.n[i] * Math.sin(t));
    };
  }
  const cp = [], knots = [], w = [], r = ent.r, deg = get(r, 71) ?? 3;
  r.c.forEach((c, i) => {
    if (c === 10) cp.push([+r.v[i], r.c[i + 1] === 20 ? +r.v[i + 1] : 0]);
    else if (c === 40) knots.push(+r.v[i]); else if (c === 41) w.push(+r.v[i]);
  });
  return nurbsOk(cp, knots, deg) ? (u) => nurbsAt(cp, knots, deg, w.length === cp.length ? w : null, knots[deg] + u * (knots[cp.length] - knots[deg])) : null;
}

/** Drop as many samples as a 0.008 chord error allows; the sampling budget is another 0.001. */
function simplify(pts) {
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1;) {
    let end = i + 1;
    for (let j = end + 1; j < pts.length; j++) {
      let ok = true;
      for (let k = i + 1; k < j; k++) if (distance(pts[k], pts[i], pts[j]) > 0.008) { ok = false; break; }
      if (!ok) break;
      end = j;
    }
    out.push(pts[end]); i = end;
  }
  return out;
}

export function offsetCurve(ent, d, at) {
  const sh = curveShape(ent);
  if (!sh || sh.pts.some((p) => !p.every(Number.isFinite))) return { error: 'The object has no offset path' };
  let pts = sh.pts.slice();
  if (sh.closed && length(sub(pts[0], pts.at(-1))) < 1e-9) pts.pop();
  const n = sh.closed ? pts.length : pts.length - 1, evaluate = evaluator(ent, sh);
  if (n < 1) return { error: 'The object has no offset path' };
  let best = Infinity, near = 0, fraction = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], v = sub(b, a), f = Math.max(0, Math.min(1, dot(sub(at, a), v) / (dot(v, v) || 1)));
    const miss = distance(at, a, b);
    if (miss < best) { best = miss; near = i; fraction = f; }
  }
  // Refine the nearest chord's parameter so Through measures to the curve itself.
  let u = (near + fraction) / n, p = pts[near], tangent = sub(pts[(near + 1) % pts.length], p);
  const tangentAt = (u) => {
    const h = 1e-5;
    if (u < h) return unit(evaluate(u).map((v, i) => -3 * v + 4 * evaluate(u + h)[i] - evaluate(u + 2 * h)[i]));
    if (u > 1 - h) return unit(evaluate(u).map((v, i) => 3 * v - 4 * evaluate(u - h)[i] + evaluate(u - 2 * h)[i]));
    return unit(sub(evaluate(u + h), evaluate(u - h)));
  };
  if (evaluate) {
    let lo = near / n, hi = (near + 1) / n;
    for (let k = 0; k < 48; k++) {
      const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
      if (length(sub(at, evaluate(a))) < length(sub(at, evaluate(b)))) hi = b; else lo = a;
    }
    u = (lo + hi) / 2; p = evaluate(u); tangent = tangentAt(u); best = length(sub(at, p));
  }
  if (d === null) {
    if (best < 1e-9) return { error: 'The through point is on the object' };
    d = best;
  }
  if (!(d > 0) || !Number.isFinite(d)) return { error: 'The offset distance must be more than 0' };
  const dd = (tangent[0] * (at[1] - p[1]) - tangent[1] * (at[0] - p[0]) < 0 ? -1 : 1) * d;
  let out;
  if (evaluate) {
    let folded = false, unresolved = false;
    const sample = (u) => {
      const p = evaluate(u), t = tangentAt(u);
      if (sh.q) {
        const q = sh.q, a = q.t0 + (q.t1 - q.t0) * u, v = q.m.map((m, i) => -m * Math.sin(a) + q.n[i] * Math.cos(a));
        if (dd * (q.m[0] * q.n[1] - q.m[1] * q.n[0]) >= length(v) ** 3 * (1 - 1e-9)) folded = true;
      }
      return [p[0] - dd * t[1], p[1] + dd * t[0]];
    };
    out = [sample(0)];
    const add = (a, b, pa, pb, depth) => {
      const us = [a + (b - a) / 4, (a + b) / 2, b - (b - a) / 4], ps = us.map(sample);
      const chain = [pa, ...ps, pb], source = [a, ...us, b].map(evaluate);
      for (let k = 1; k < chain.length; k++) if (dot(sub(chain[k], chain[k - 1]), sub(source[k], source[k - 1])) <= 0) folded = true;
      if (ps.some((p) => distance(p, pa, pb) > 0.001)) {
        if (depth === 16) { unresolved = true; return; }
        add(a, us[1], pa, ps[1], depth + 1); add(us[1], b, ps[1], pb, depth + 1);
      } else out.push(pb);
    };
    for (let i = 0; i < n && !folded && !unresolved; i++) add(i / n, (i + 1) / n, sample(i / n), sample((i + 1) / n), 0);
    if (folded) return gone;
    if (unresolved) return { error: 'The offset could not be worked out' };
  } else {
    // Fit-only SPLINEs draw as chords here: intersect their adjacent normal offsets.
    const directions = Array.from({ length: n }, (_, i) => unit(sub(pts[(i + 1) % pts.length], pts[i])));
    out = pts.map((p, i) => {
      const a = directions[(i + n - 1) % n], b = directions[i % n];
      const t = !sh.closed && i === 0 ? b : !sh.closed && i === n ? a : unit([a[0] + b[0], a[1] + b[1]]);
      const scale = dd / (dot(t, !sh.closed && i === n ? a : b) || 1e-15);
      return [p[0] - scale * t[1], p[1] + scale * t[0]];
    });
    for (let i = 0; i < n; i++) if (dot(sub(out[(i + 1) % out.length], out[i]), directions[i]) <= 0) return gone;
    if (sh.closed) out.push(out[0]);
  }
  out = simplify(out);
  if (sh.closed) out.pop();
  return { ent: entity('SPLINE', [[70, sh.closed ? 1 : 0], [71, 3], [72, 0], [73, 0], [74, out.length],
    ...out.flatMap((p) => [[11, p[0]], [21, p[1]], [31, 0]])], ent) };
}
