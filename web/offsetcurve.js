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
/** Where segment p-q crosses segment r-s, or null. */
const meet = (p, q, r, s) => {
  const u = sub(q, p), v = sub(s, r), w = sub(r, p), den = u[0] * v[1] - u[1] * v[0];
  const t = (w[0] * v[1] - w[1] * v[0]) / den, k = (w[0] * u[1] - w[1] * u[0]) / den;
  return den && t >= 0 && t <= 1 && k >= 0 && k <= 1 ? [p[0] + t * u[0], p[1] + t * u[1]] : null;
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

const JUMP = 0.1;                       // radians: a tangent turn this sudden is a corner
const angle = (a, b) => Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], dot(a, b)));
const cache = {};                       // the last offset worked out, so a preview that repeats it costs nothing
export const offsetStats = { builds: 0 };

/** Drop as many samples as a `tol` chord error allows (0.008, or 0.001 of a small curve's size); the sampling budget is another tol / 8. */
function simplify(pts, tol) {
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1;) {
    let end = i + 1;
    for (let j = end + 1; j < pts.length; j++) {
      let ok = true;
      for (let k = i + 1; k < j; k++) if (distance(pts[k], pts[i], pts[j]) > tol) { ok = false; break; }
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
  const n = sh.closed ? pts.length : pts.length - 1;
  let evaluate = evaluator(ent, sh);
  // A closed, nonperiodic spline also has the closing chord drawn by curveShape.
  if (evaluate && sh.closed && !sh.q && length(sub(evaluate(0), evaluate(1))) > 1e-9) evaluate = null;
  if (n < 1) return { error: 'The object has no offset path' };
  let best = Infinity, near = 0, fraction = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], v = sub(b, a), f = Math.max(0, Math.min(1, dot(sub(at, a), v) / (dot(v, v) || 1)));
    const miss = distance(at, a, b);
    if (miss < best) { best = miss; near = i; fraction = f; }
  }
  // Refine the nearest chord's parameter so Through measures to the curve itself.
  let u = (near + fraction) / n, p = pts[near], tangent = sub(pts[(near + 1) % pts.length], p);
  const box = [0, 1].map((k) => Math.max(...sh.pts.map((p) => p[k])) - Math.min(...sh.pts.map((p) => p[k])));
  const diag = Math.hypot(...box), tol = Math.min(0.008, 0.0008 * diag), budget = tol / 8;
  // Direction of travel at u inside the stretch [lo, hi]: one-sided at either end (a corner's two sides differ), wider steps where the curve stalls.
  const tangentAt = (u, lo = 0, hi = 1) => {
    for (let h = 1e-5, wide = false; ; h *= 4, wide = true) {
      const ahead = u - h < lo && u + 2 * h <= 1, behind = !ahead && u + h > hi, p = evaluate(u);
      const q = ahead ? evaluate(u + h) : behind ? evaluate(u - h) : null;
      let v;
      if (!q) v = sub(evaluate(u + h), evaluate(u - h));
      else if (wide) v = ahead ? sub(q, p) : sub(p, q);          // a three-point step can point backwards where the curve stalls
      else { const r = evaluate(u + (ahead ? 2 : -2) * h); v = p.map((c, i) => (ahead ? -3 : 3) * c + (ahead ? 4 : -4) * q[i] + (ahead ? -1 : 1) * r[i]); }
      if (length(v) > 1e-9 * diag || h > 0.02) return unit(v);
    }
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
  const trace = () => {
    let out;
    if (evaluate) {
      let folded = false, unresolved = false;
      const sample = (u, lo, hi) => {
        const p = evaluate(u), t = tangentAt(u, lo, hi);
        if (sh.q) {
          const q = sh.q, a = q.t0 + (q.t1 - q.t0) * u, v = q.m.map((m, i) => -m * Math.sin(a) + q.n[i] * Math.cos(a));
          if (dd * (q.m[0] * q.n[1] - q.m[1] * q.n[0]) >= length(v) ** 3 * (1 - 1e-9)) folded = true;
        }
        return [p[0] - dd * t[1], p[1] + dd * t[0]];
      };
      // A spline can have corners (the tangent jumps): offset each smooth stretch on its own, then join the stretches.
      const back = (u) => tangentAt(u, 0, u), fwd = (u) => tangentAt(u, u, 1), corners = [];
      const find = (a, b) => {      // bisect to the jump between back(a) and fwd(b), or null when the turn is smooth
        while (b - a > 1e-9 && angle(back(a), fwd(b)) > JUMP) {
          const m = (a + b) / 2, l = angle(back(a), fwd(m)), r = angle(back(m), fwd(b));
          if (Math.max(l, r) <= JUMP) return null;
          if (l >= r) b = m; else a = m;
        }
        return angle(back(a), fwd(b)) > JUMP ? (a + b) / 2 : null;
      };
      if (!sh.q) for (let i = 0; i < n; i++) {
        const c = angle(back(i / n), fwd((i + 1) / n)) > JUMP ? find(i / n, (i + 1) / n) : null;
        // A corner where the curve stalls (a repeated control point) reads as several jumps within 1e-6 of its size: keep the first.
        if (c !== null && c > 1e-6 && c < 1 - 1e-6 && (!corners.length || length(sub(evaluate(c), evaluate(corners.at(-1)))) > 1e-6 * diag)) corners.push(c);
      }
      const seam = sh.closed && !sh.q && angle(back(1), fwd(0)) > JUMP, cuts = [0, ...corners, 1], chains = [];
      for (let j = 0; j + 1 < cuts.length && !folded && !unresolved; j++) {
        const lo = cuts[j], hi = cuts[j + 1], S = (u) => sample(u, lo, hi), chain = [S(lo)];
        const add = (a, b, pa, pb, depth) => {
          const us = [a + (b - a) / 4, (a + b) / 2, b - (b - a) / 4], ps = us.map(S);
          const run = [pa, ...ps, pb], source = [a, ...us, b].map(evaluate);
          for (let k = 1; k < run.length; k++) {
            const along = sub(source[k], source[k - 1]);      // a stalled stretch (a corner's repeated control point) has no direction to fold against
            if (length(along) > 1e-9 * diag && dot(sub(run[k], run[k - 1]), along) <= 0) folded = true;
          }
          if (ps.some((p) => distance(p, pa, pb) > budget)) {
            if (depth === 16) { unresolved = true; return; }
            add(a, us[1], pa, ps[1], depth + 1); add(us[1], b, ps[1], pb, depth + 1);
          } else chain.push(pb);
        };
        const marks = [lo, ...Array.from({ length: n - 1 }, (_, i) => (i + 1) / n).filter((u) => u > lo + 1e-9 && u < hi - 1e-9), hi];
        for (let k = 0; k + 1 < marks.length && !folded && !unresolved; k++) add(marks[k], marks[k + 1], S(marks[k]), S(marks[k + 1]), 0);
        chains.push(chain);
      }
      if (folded) return gone;
      if (unresolved) return { error: 'The offset could not be worked out' };
      const joins = Array.from({ length: chains.length - 1 }, (_, k) => [k, k + 1]), arcs = [];
      if (seam) joins.push([chains.length - 1, 0]);
      for (const [a, b] of joins) {
        const tA = tangentAt(cuts[a + 1], cuts[a], cuts[a + 1]), tB = tangentAt(cuts[b], cuts[b], cuts[b + 1]), turn = tA[0] * tB[1] - tA[1] * tB[0];
        if (dd * turn < 0) {         // outside: the offsets leave a gap; close it with a round about the corner
          const C = evaluate(cuts[a + 1]), th = Math.atan2(turn, dot(tA, tB));
          const parts = Math.max(1, Math.ceil(Math.abs(th) / (2 * Math.acos(Math.max(0, 1 - budget / Math.abs(dd))) || 1e-3)));
          arcs[a] = Array.from({ length: parts - 1 }, (_, s) => {
            const g = th * (s + 1) / parts, c = Math.cos(g), z = Math.sin(g);
            return [C[0] + dd * (-tA[1] * c - tA[0] * z), C[1] + dd * (tA[0] * c - tA[1] * z)];
          });
        } else {                     // inside: the two offsets cross; keep each up to the crossing
          const A = chains[a], B = chains[b];
          let hit = null;
          for (let i = A.length - 2; i >= 0 && !hit; i--) {
            for (let j = 0; j < (A === B ? i : B.length - 1) && !hit; j++) { const X = meet(A[i], A[i + 1], B[j], B[j + 1]); if (X) hit = { i, j, X }; }
          }
          if (!hit) return gone;
          if (A === B) chains[a] = [hit.X, ...A.slice(hit.j + 1, hit.i + 1), hit.X];
          else { chains[a] = [...A.slice(0, hit.i + 1), hit.X]; chains[b] = [hit.X, ...B.slice(hit.j + 1)]; }
        }
      }
      out = [];
      chains.forEach((c, k) => out.push(...(k && !arcs[k - 1] ? c.slice(1) : c), ...(arcs[k] ?? [])));
      if (sh.closed && length(sub(out.at(-1), out[0])) > 1e-12) out.push(out[0]);
    } else {
      // Fit-only and nonperiodic closed SPLINEs draw as chords here: intersect adjacent normal offsets.
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
    out = simplify(out, tol);
    if (out.reduce((sum, p, i) => sum + (i ? length(sub(p, out[i - 1])) : 0), 0) < tol) return gone;       // an offset of exactly the shorter leg clips to nothing
    if (sh.closed) out.pop();
    return { out };
  };
  const key = [ent.type, ent.r.c.join(), ent.r.v.join(), dd].join('|');
  if (cache.key !== key) { cache.key = key; cache.res = trace(); offsetStats.builds++; }
  const { out, error } = cache.res;
  if (error) return { error };
  return { ent: entity('SPLINE', [[70, sh.closed ? 1 : 0], [71, 3], [72, 0], [73, 0], [74, out.length],
    ...out.flatMap((p) => [[11, p[0]], [21, p[1]], [31, 0]])], ent) };
}
