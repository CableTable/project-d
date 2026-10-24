// Exact matches (vertices; a circle's centre and radius; a line through an angle's vertex), inferred only for edits that keep the shape: grip drag, Move and Scale.
import { flatten, pickIndex, mapply, mscale } from './drawing.js';
import { dimOfEntity, buildDim, replaceDimension, DIM_LAYER } from './edit.js';

const DEG = Math.PI / 180;
/** Per entity (its index in `entities`): its vertices, arcs ({ c, r }) and straight pieces ([x1, y1, x2, y2]), in drawing order. */
function parts(raw, entities) {
  const fl = flatten({ ...raw, entities }), byEnt = new Map();
  const of = (i) => {
    const e = fl.items[i].e;
    if (!byEnt.has(e)) byEnt.set(e, { pts: [], arcs: [], segs: [] });
    return byEnt.get(e);
  };
  for (const paper of [false, true]) {
    const ix = pickIndex(fl, paper);
    for (const p of ix.snaps) if (p.kind === 'end' || p.kind === 'node') of(p.it).pts.push([p.x, p.y]);
    for (const q of ix.pieces) {
      if (q.t === 'a') of(q.it).arcs.push({ c: [q.cx, q.cy], r: q.r });
      else if (q.t === 's') of(q.it).segs.push([q.x1, q.y1, q.x2, q.y2]);
    }
  }
  return byEnt;
}

const near = (a, b, factor) => Math.hypot(a[0] - b[0], a[1] - b[1]) * factor <= 1e-9;
const arcMoved = ([f, t], factor) => !near(f.c, t.c, factor) || Math.abs(f.r - t.r) * factor > 1e-9;
const segMoved = ([f, t], factor) => f.some((v, i) => Math.abs(v - t[i]) * factor > 1e-9);
function dimMatrix(raw, e) {
  const fl = flatten({ ...raw, entities: [{ ...raw.entities[e], hidden: false }] });
  return fl.items.length ? fl.mats[fl.items[0].m] : null;
}
function local(m, p) {
  const x = p[0] - m[4], y = p[1] - m[5], det = m[0] * m[3] - m[1] * m[2];
  return [(m[3] * x - m[2] * y) / det, (m[0] * y - m[1] * x) / det];
}

// Each follower sets the moved parameters on `params` and returns true, or returns false (the dimension stays).
// ctx: { factor, moves (vertices [from, to, paper]), stationary ([point, paper]), arcs, segs ([from, to, paper], moved or not) }.

/** Aligned and linear: an end on a moved vertex goes with it; a vertex a moved and a stayed shape share goes with the shape holding the other end. */
function followPoints(dim, params, m, nm, paper, ctx) {
  const { factor, moves, stationary } = ctx, end = {};
  let moved = false;
  for (const key of ['a', 'b']) {
    const p = mapply(m, ...dim.params[key]);
    end[key] = {
      shared: stationary.some(([q, ps]) => ps === paper && near(q, p, factor)),
      match: moves.find(([from, , ps]) => ps === paper && near(from, p, factor)),
    };
  }
  for (const [key, other] of [['a', 'b'], ['b', 'a']]) {
    const { shared, match } = end[key];
    // A point a moved and a stayed shape share goes with the shape holding the other end; if that is unclear, it stays.
    if (match && (!shared || (end[other].match && !end[other].shared))) { params[key] = local(nm, match[1]); moved = true; }
  }
  return moved;
}

/** Radius and diameter: the one circle or arc with this centre and radius; a pointer / the two ends keep their direction from the centre. */
function followCircle(dim, params, m, nm, paper, ctx) {
  const { factor } = ctx, radius = dim.kind === 'radius';
  let c, R, a, b;
  if (radius) { c = mapply(m, ...dim.params.c); R = dim.params.r * mscale(m); }
  else {
    a = mapply(m, ...dim.params.a); b = mapply(m, ...dim.params.b);
    c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; R = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
  }
  // shortcut: two stacked circles with the same centre and radius are ambiguous, so the dimension stays; upgrade if duplicates must follow
  const hit = ctx.arcs.filter(([f, , ps]) => ps === paper && near(f.c, c, factor) && Math.abs(f.r - R) * factor <= 1e-9);
  if (hit.length !== 1 || !arcMoved(hit[0], factor)) return false;
  const [f, t] = hit[0], k = t.r / f.r;
  if (radius) {
    const p = mapply(m, ...dim.params.p);
    params.c = local(nm, t.c); params.r = t.r / mscale(nm);
    params.p = local(nm, [t.c[0] + (p[0] - c[0]) * k, t.c[1] + (p[1] - c[1]) * k]);
  } else {
    const ux = (b[0] - a[0]) / (2 * R), uy = (b[1] - a[1]) / (2 * R);
    params.a = local(nm, [t.c[0] - ux * t.r, t.c[1] - uy * t.r]); params.b = local(nm, [t.c[0] + ux * t.r, t.c[1] + uy * t.r]);
  }
  return true;
}

/** Angle: the one straight piece along each ray, through the vertex; the vertex and the rays follow those pieces. */
function followAngle(dim, params, m, nm, paper, ctx) {
  const { factor } = ctx, rot = Math.atan2(m[1], m[0]), v = mapply(m, ...dim.params.v), picks = [];
  for (const a of [dim.params.a0, dim.params.a1]) {
    const u = [Math.cos(a * DEG + rot), Math.sin(a * DEG + rot)];
    const hit = ctx.segs.filter(([f, , ps]) => {
      const d = [f[2] - f[0], f[3] - f[1]], len = Math.hypot(...d);
      return ps === paper && Math.abs(d[0] * u[1] - d[1] * u[0]) / len <= 1e-9 &&
        Math.abs((v[0] - f[0]) * d[1] - (v[1] - f[1]) * d[0]) / len * factor <= 1e-7;
    });
    if (hit.length !== 1) return false;       // shortcut: collinear pieces are ambiguous, the dimension stays; upgrade if polylines with collinear sides must follow
    const [f, t] = hit[0], sign = Math.sign((f[2] - f[0]) * u[0] + (f[3] - f[1]) * u[1]);
    picks.push({ hit: hit[0], d: [(t[2] - t[0]) * sign, (t[3] - t[1]) * sign], t });
  }
  if (picks[0].hit === picks[1].hit || !picks.some((q) => segMoved(q.hit, factor))) return false;
  const [{ t: l1, d: d1 }, { t: l2, d: d2 }] = picks, cross = d1[0] * d2[1] - d1[1] * d2[0];
  if (!(Math.abs(cross) > 1e-9 * Math.hypot(...d1) * Math.hypot(...d2))) return false;
  const s = ((l2[0] - l1[0]) * d2[1] - (l2[1] - l1[1]) * d2[0]) / cross, rot2 = Math.atan2(nm[1], nm[0]);
  const ang = (d) => ((((Math.atan2(d[1], d[0]) - rot2) / DEG) % 360) + 360) % 360;
  params.v = local(nm, [l1[0] + (l1[2] - l1[0]) * s, l1[1] + (l1[3] - l1[1]) * s]); params.a0 = ang(d1); params.a1 = ang(d2);
  return true;
}

const FOLLOW = { aligned: followPoints, linear: followPoints, radius: followCircle, diameter: followCircle, angle: followAngle };

/** Rebuild linked dimensions in the same state as a shape edit. Never call for replacement or deletion. */
export function followDimensions(raw, next, factor = 1) {
  const dims = raw.entities.map((_, i) => [i, dimOfEntity(raw, i)]).filter(([, d]) => d && FOLLOW[d.kind]);
  if (!dims.length) return next;
  const shapes = raw.entities.map((_, i) => i).filter((i) => {
    const e = raw.entities[i];
    return e.layer !== DIM_LAYER && e.type !== 'DIMENSION' &&
      !(e.type === 'INSERT' && /^PD_(DIM|LDR)_/.test(e.r.v[e.r.c.indexOf(2)]));
  });
  const changed = shapes.filter((i) => raw.entities[i] !== next.entities[i]);
  if (!changed.length) return next;
  const before = parts(raw, changed.map((i) => raw.entities[i])), afterRaw = { ...raw, ...next };
  const after = parts(afterRaw, changed.map((i) => next.entities[i])), moves = [], arcs = [], segs = [];
  for (const [e, was] of before) {
    const now = after.get(e), ps = !!raw.entities[changed[e]].ps;
    if (!now) continue;
    if (now.pts.length === was.pts.length) was.pts.forEach((p, i) => { if (!near(p, now.pts[i], factor)) moves.push([p, now.pts[i], ps]); });
    if (now.arcs.length === was.arcs.length) was.arcs.forEach((p, i) => arcs.push([p, now.arcs[i], ps]));
    if (now.segs.length === was.segs.length) was.segs.forEach((p, i) => segs.push([p, now.segs[i], ps]));
  }
  if (!moves.length && !arcs.some((x) => arcMoved(x, factor)) && !segs.some((x) => segMoved(x, factor))) return next;
  const unchanged = shapes.filter((i) => raw.entities[i] === next.entities[i]).map((i) => raw.entities[i]);
  const stationary = [];
  for (const [e, was] of parts(raw, unchanged)) {
    const ps = !!unchanged[e].ps;
    stationary.push(...was.pts.map((p) => [p, ps]));
    arcs.push(...was.arcs.map((p) => [p, p, ps]));
    segs.push(...was.segs.map((p) => [p, p, ps]));
  }
  const ctx = { factor, moves, stationary, arcs, segs };
  let result = next;
  for (const [e, dim] of dims) {
    const m = dimMatrix(raw, e), nextMatrix = dimMatrix(afterRaw, e), current = dimOfEntity(afterRaw, e);
    if (!m || !nextMatrix || !current) continue;
    const params = { ...current.params };
    if (!FOLLOW[dim.kind](dim, params, m, nextMatrix, !!raw.entities[e].ps, ctx)) continue;
    const built = buildDim(dim.kind, params, factor, dim.name, dim.dp);
    if (built) result = { ...result, ...replaceDimension(result, built) };
  }
  return result;
}
