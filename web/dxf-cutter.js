// dxf-cutter.js — the cutter-safe copy of a drawing (TODO 52, mock-up R14 option B), pure: tests in dxf-cutter.test.mjs.
//
//   cutterDoc(doc, tol) → { doc, left, other }
//     doc:   a document in writeDxf's shape holding LINE, ARC and LWPOLYLINE only (the header, layers and line types are kept).
//     left:  how many text / fill objects were left out (TEXT, MTEXT, attributes, HATCH, SOLID, TRACE, DIMENSION, leaders, WIPEOUT).
//     other: how many other objects had no place in it (POINT, 3DFACE, meshes, xrefs, a block missing from the file).
//   Blocks (INSERT) are exploded first. A circle becomes two arcs. An ellipse or spline, and any arc that a stretched block makes
//   elliptical, becomes a polyline whose vertices are at most `tol` (drawing units, > 0) from the true curve. Polyline widths are dropped.

import { mmul, mapply, nurbsAt, nurbsOk } from './drawing.js';
import { line, arc, lwpoly } from './dxf-write.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180, FLIP = [-1, 0, 0, 1, 0, 0], MAX_DEPTH = 14;
const LEFT = new Set(['TEXT', 'MTEXT', 'HATCH', 'SOLID', 'TRACE', 'DIMENSION', 'LEADER', 'MULTILEADER', 'MLEADER', 'WIPEOUT']);
const QUIET = new Set(['ATTDEF', 'SEQEND', 'ENDBLK', 'VIEWPORT']);        // nothing a cutter would have drawn

const num = (v, d = 0) => { const n = v == null ? NaN : +v; return Number.isFinite(n) ? n : d; };
const firsts = (r) => { const f = {}; for (let k = 0; k < r.c.length; k++) if (!(r.c[k] in f)) f[r.c[k]] = r.v[k]; return f; };
const deg360 = (rad) => (((rad / DEG) % 360) + 360) % 360;

/** The distance from p to the segment a–b. */
function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const u = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
}

/** Points along fn(t) for t from t0 to t1, split until no checked point of the curve is more than tol from its chord (half of it, as margin). */
function sample(fn, t0, t1, tol, pieces = 1) {
  const pts = [fn(t0)];
  const rec = (a, pa, b, pb, depth) => {
    if (depth < MAX_DEPTH && [0.5, 0.25, 0.75].some((u) => distSeg(fn(a + (b - a) * u), pa, pb) > tol / 2)) {
      const tm = (a + b) / 2, pm = fn(tm);
      rec(a, pa, tm, pm, depth + 1); rec(tm, pm, b, pb, depth + 1);
    } else pts.push(pb);
  };
  let pa = pts[0];
  for (let i = 1; i <= pieces; i++) {
    const a = t0 + (t1 - t0) * (i - 1) / pieces, b = t0 + (t1 - t0) * i / pieces, pb = fn(b);
    rec(a, pa, b, pb, 0);
    pa = pb;
  }
  return pts;
}

/** A matrix that keeps circles round (rotation, mirror, one scale): its scale, else 0. */
function similar(m) {
  const a = m[0] * m[0] + m[1] * m[1], b = m[2] * m[2] + m[3] * m[3];
  return Math.abs(a - b) <= 1e-9 * Math.max(a, b) && Math.abs(m[0] * m[2] + m[1] * m[3]) <= 1e-9 * Math.max(a, b) ? Math.sqrt(a) : 0;
}
const mirrored = (m) => m[0] * m[3] - m[1] * m[2] < 0;

export function cutterDoc(doc, tol) {
  if (!(tol > 0) || !Number.isFinite(tol)) throw new RangeError('The curve tolerance must be a number above 0');
  const out = [], count = { left: 0, other: 0 };

  /** An open or closed polyline of world points. */
  const poly = (pts, closed, o) => { if (pts.length >= 2) out.push(lwpoly(pts, { ...o, closed })); };

  /** A polyline's vertices [x, y, bulge] under m: bulges stay while circles stay round, else they are flattened. */
  function polyline(pts, closed, m, o) {
    if (pts.length < 2) return;
    if (similar(m)) {
      const flip = mirrored(m) ? -1 : 1;
      poly(pts.map((p) => [...mapply(m, p[0], p[1]), p[2] * flip]), closed, o);
      return;
    }
    const w = [], n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      w.push(mapply(m, p[0], p[1]));
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (p[2] && len) {
        const sweep = 4 * Math.atan(p[2]), r = len / 2 / Math.sin(Math.abs(sweep) / 2), off = Math.sign(p[2]) * r * Math.cos(sweep / 2);
        const cx = (p[0] + q[0]) / 2 - (q[1] - p[1]) / len * off, cy = (p[1] + q[1]) / 2 + (q[0] - p[0]) / len * off;
        const a0 = Math.atan2(p[1] - cy, p[0] - cx);
        w.push(...sample((u) => mapply(m, cx + r * Math.cos(a0 + u), cy + r * Math.sin(a0 + u)), 0, sweep, tol, Math.ceil(Math.abs(sweep) / (Math.PI / 2))).slice(1, -1));
      }
    }
    if (!closed) w.push(mapply(m, pts[pts.length - 1][0], pts[pts.length - 1][1]));
    poly(w, closed, o);
  }

  /** A circle or arc (radians, anticlockwise from a0 over sweep) under m. */
  function round(cx, cy, r, a0, sweep, m, o) {
    const full = sweep >= TAU - 1e-9, s = similar(m);
    if (s) {
      const c = mapply(m, cx, cy), R = r * s;
      if (full) { out.push(arc(c[0], c[1], R, 0, 180, o), arc(c[0], c[1], R, 180, 360, o)); return; }
      const p = mapply(m, cx + r * Math.cos(a0), cy + r * Math.sin(a0)), q = mapply(m, cx + r * Math.cos(a0 + sweep), cy + r * Math.sin(a0 + sweep));
      let s0 = Math.atan2(p[1] - c[1], p[0] - c[0]), s1 = Math.atan2(q[1] - c[1], q[0] - c[0]);
      if (mirrored(m)) [s0, s1] = [s1, s0];                              // a mirror turns the arc round: it still runs anticlockwise
      out.push(arc(c[0], c[1], R, deg360(s0), deg360(s1), o));
      return;
    }
    const pts = sample((u) => mapply(m, cx + r * Math.cos(u), cy + r * Math.sin(u)), a0, a0 + sweep, tol, Math.max(1, Math.ceil(sweep / (Math.PI / 2))));
    poly(full ? pts.slice(0, -1) : pts, full, o);
  }

  function walk(ents, M, ctx, depth) {
    for (const e of ents || []) {
      if (e.fill) count.left++;
      if (e.hidden) continue;
      const byBlock = e.aci === 0 && ctx.aci != null;
      const o = { layer: e.layer === '0' && ctx.layer != null ? ctx.layer : e.layer, aci: byBlock ? ctx.aci : e.aci, tc: byBlock ? ctx.tc : e.tc, ps: !!(ctx.ps || e.ps) };
      const m = e.flip ? mmul(M, FLIP) : M, r = e.r, f = firsts(r);
      switch (e.type) {
        case 'LINE': out.push(line(...mapply(m, num(f[10]), num(f[20])), ...mapply(m, num(f[11]), num(f[21])), o)); break;
        case 'CIRCLE': if (num(f[40]) > 0) round(num(f[10]), num(f[20]), num(f[40]), 0, TAU, m, o); break;
        case 'ARC': {
          const a0 = num(f[50]) * DEG;
          let a1 = num(f[51], 360) * DEG; if (a1 <= a0) a1 += TAU;
          if (num(f[40]) > 0) round(num(f[10]), num(f[20]), num(f[40]), a0, a1 - a0, m, o);
          break;
        }
        case 'ELLIPSE': {
          const cx = num(f[10]), cy = num(f[20]), mx = num(f[11]), my = num(f[21]), ratio = num(f[40], 1);
          let nz = 1; for (let k = 0; k < r.c.length; k++) if (r.c[k] === 230) nz = num(r.v[k], 1);
          const nx = nz < 0 ? my * ratio : -my * ratio, ny = nz < 0 ? -mx * ratio : mx * ratio;
          const t0 = num(f[41], 0); let t1 = num(f[42], TAU); if (t1 <= t0) t1 += TAU;
          const pts = sample((t) => mapply(m, cx + mx * Math.cos(t) + nx * Math.sin(t), cy + my * Math.cos(t) + ny * Math.sin(t)), t0, t1, tol, Math.max(1, Math.ceil((t1 - t0) / (Math.PI / 2))));
          const full = t1 - t0 > TAU - 1e-6;
          poly(full ? pts.slice(0, -1) : pts, full, o);
          break;
        }
        case 'LWPOLYLINE': {
          const pts = []; let cur = null;
          for (let k = 0; k < r.c.length; k++) {
            const c = r.c[k], v = r.v[k];
            if (c === 10) { cur = [num(v), 0, 0]; pts.push(cur); } else if (!cur) continue;
            else if (c === 20) cur[1] = num(v); else if (c === 42) cur[2] = num(v);
          }
          polyline(pts, (num(f[70]) & 1) === 1, m, o);
          break;
        }
        case 'POLYLINE': {
          const flags = num(f[70]);
          if (flags & 80) { count.other++; break; }                      // a 3-D mesh or a polyface
          const pts = (e.kids || []).map(firsts).filter((g) => !(num(g[70]) & 16)).map((g) => [num(g[10]), num(g[20]), flags & 8 ? 0 : num(g[42])]);
          polyline(pts, (flags & 1) === 1, m, o);
          break;
        }
        case 'SPLINE': {
          const cp = [], fit = [], knots = [], w = [];
          for (let k = 0; k < r.c.length; k++) {
            const c = r.c[k];
            if (c === 10) cp.push([num(r.v[k]), r.c[k + 1] === 20 ? num(r.v[k + 1]) : 0]);
            else if (c === 11) fit.push([num(r.v[k]), r.c[k + 1] === 21 ? num(r.v[k + 1]) : 0]);
            else if (c === 40) knots.push(num(r.v[k]));
            else if (c === 41) w.push(num(r.v[k]));
          }
          const deg = num(f[71], 3);
          if (nurbsOk(cp, knots, deg)) {
            const wt = w.length === cp.length ? w : null, n = cp.length;
            const cuts = [...new Set(knots.slice(deg, n + 1))];            // each piece between two knots is one polynomial
            const fn = (t) => mapply(m, ...nurbsAt(cp, knots, deg, wt, t));
            const pts = [fn(cuts[0])];
            for (let i = 1; i < cuts.length; i++) pts.push(...sample(fn, cuts[i - 1], cuts[i], tol, 2).slice(1));
            poly(pts, false, o);
          } else {                                                       // no usable knots: the fit points (or control polygon) as they are
            const pts = fit.length > 1 ? fit : cp;
            poly(pts.map((p) => mapply(m, p[0], p[1])), false, o);
          }
          break;
        }
        case 'INSERT': {
          const blk = (doc.blocks || {})[(f[2] || '').trim()];
          if (!blk || blk.xref || depth >= 10) { count.other++; break; }
          const at = [num(f[10]), num(f[20])], rot = num(f[50]) * DEG, sx = num(f[41], 1) || 1, sy = num(f[42], 1) || 1;
          const cols = Math.min(Math.max(num(f[70], 1), 1), 100), rows = Math.min(Math.max(num(f[71], 1), 1), 100);
          const c = Math.cos(rot), s = Math.sin(rot), inner = { layer: o.layer, aci: o.aci, tc: o.tc, ps: o.ps };
          for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
            let mm = mmul(m, [1, 0, 0, 1, at[0], at[1]]);
            mm = mmul(mm, [c, s, -s, c, 0, 0]);
            mm = mmul(mm, [1, 0, 0, 1, col * num(f[44]), row * num(f[45])]);
            mm = mmul(mm, [sx, 0, 0, sy, -blk.base[0] * sx, -blk.base[1] * sy]);
            walk(blk.entities, mm, inner, depth + 1);
          }
          count.left += (e.kids || []).filter((a) => !(num(firsts(a)[70]) & 1)).length;   // its visible attributes are text
          break;
        }
        default:
          if (LEFT.has(e.type)) count.left++; else if (!QUIET.has(e.type)) count.other++;
      }
    }
  }
  walk(doc.entities, [1, 0, 0, 1, 0, 0], { layer: null, aci: null, tc: null, ps: false }, 0);
  return { doc: { header: doc.header, layers: doc.layers, ltypes: doc.ltypes || {}, blocks: {}, entities: out }, left: count.left, other: count.other };
}
