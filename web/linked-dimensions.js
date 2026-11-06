// Exact matches (vertices; a circle's centre and radius; a line through an angle's vertex), inferred only for edits that keep the shape: grip drag, Move and Scale.
import { flatten, pickIndex, mapply, mscale } from './drawing.js';
import { dimOfEntity, buildDim, replaceDimension, lineOf, dimLabel, DIM_LAYER } from './edit.js';
import { overrideText, measuredText } from './dimension-text.js';
import { dragGrip } from './grips.js';

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

// A dimension read back from a file is off its shape by the DXF's 6 decimals (shape points rounded, the dimension block rebuilt through arithmetic): matching is this loose, in drawing units; moving is judged exactly.
const LINK_TOL = 2e-6, LINK_ANGLE = 1e-7;
const fits = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= LINK_TOL;
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
      shared: stationary.some(([q, ps]) => ps === paper && fits(q, p)),
      match: moves.find(([from, , ps]) => ps === paper && fits(from, p)),
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
  const hit = ctx.arcs.filter(([f, , ps]) => ps === paper && fits(f.c, c) && Math.abs(f.r - R) <= LINK_TOL);
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
  const { factor } = ctx, v = mapply(m, ...dim.params.v), picks = [];
  for (const a of [dim.params.a0, dim.params.a1]) {
    const w = [m[0] * Math.cos(a * DEG) + m[2] * Math.sin(a * DEG), m[1] * Math.cos(a * DEG) + m[3] * Math.sin(a * DEG)], u = [w[0] / Math.hypot(...w), w[1] / Math.hypot(...w)];   // through the insert's matrix: a mirror turns the other way
    const hit = ctx.segs.filter(([f, , ps]) => {
      const d = [f[2] - f[0], f[3] - f[1]], len = Math.hypot(...d);
      return ps === paper && Math.abs(d[0] * u[1] - d[1] * u[0]) / len <= LINK_ANGLE &&
        Math.abs((v[0] - f[0]) * d[1] - (v[1] - f[1]) * d[0]) / len <= LINK_TOL;
    });
    if (hit.length !== 1) return false;       // shortcut: collinear pieces are ambiguous, the dimension stays; upgrade if polylines with collinear sides must follow
    const [f, t] = hit[0], sign = Math.sign((f[2] - f[0]) * u[0] + (f[3] - f[1]) * u[1]);
    picks.push({ hit: hit[0], d: [(t[2] - t[0]) * sign, (t[3] - t[1]) * sign], t });
  }
  if (picks[0].hit === picks[1].hit || !picks.some((q) => segMoved(q.hit, factor))) return false;
  const [{ t: l1, d: d1 }, { t: l2, d: d2 }] = picks, cross = d1[0] * d2[1] - d1[1] * d2[0];
  if (!(Math.abs(cross) > 1e-9 * Math.hypot(...d1) * Math.hypot(...d2))) return false;
  const s = ((l2[0] - l1[0]) * d2[1] - (l2[1] - l1[1]) * d2[0]) / cross, flat = [nm[0], nm[1], nm[2], nm[3], 0, 0];
  const ang = (d) => { const q = local(flat, d); return (((Math.atan2(q[1], q[0]) / DEG) % 360) + 360) % 360; };
  params.v = local(nm, [l1[0] + d1[0] * s, l1[1] + d1[1] * s]); params.a0 = ang(d1); params.a1 = ang(d2);
  // The arc runs anticlockwise from a0 to a1; if the lines' turn in the insert's frame changed sense, the lines were reflected, so the ends swap and it measures what it did.
  if (cross * (nm[0] * nm[3] - nm[1] * nm[2]) * Math.sin((dim.params.a1 - dim.params.a0) * DEG) < -1e-12) [params.a0, params.a1] = [params.a1, params.a0];
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

/** TODO 76a: a typed length ("150", "150,5", "7.5\"" for an inch dimension) → the number, or null when the text is anything else. A sign is read, so "-5" can be refused. */
export function typedLength(text, units = 'mm') {
  const m = /^(-?(?:\d+[.,]?\d*|[.,]\d+))(")?$/.exec(String(text).trim());
  return !m || (m[2] && units !== 'inch') ? null : parseFloat(m[1].replace(',', '.'));
}

/** The one LINE whose two ends are the two points of an aligned or h / v dimension at entity `e` (our own PD_DIM only; none, or stacked duplicates → null).
 * → { i, A (the line end at the dimension's first point), B (at its second), id (the grip of B: 'a' | 'b'), dim, m (the dimension's matrix), zeroExtent (linear extent below LINK_TOL) } */
export function linkedLine(raw, e) {
  const hit = dimensionLine(raw, e);
  return hit.reason ? null : hit;
}

function dimensionLine(raw, e) {
  const dim = dimOfEntity(raw, e), m = dim && (dim.kind === 'aligned' || (dim.kind === 'linear' && ['h', 'v'].includes(dim.params.axis))) && dimMatrix(raw, e);
  if (!m) return { reason: 'kind' };
  const p = mapply(m, ...dim.params.a), q = mapply(m, ...dim.params.b), ps = !!raw.entities[e].ps, hits = [];
  raw.entities.forEach((ent, i) => {
    const l = lineOf(ent);
    if (!l || !!ent.ps !== ps) return;
    const s = [l[0], l[1]], t = [l[2], l[3]];
    if (fits(s, p) && fits(t, q)) hits.push({ i, A: s, B: t, id: 'b' });
    else if (fits(t, p) && fits(s, q)) hits.push({ i, A: t, B: s, id: 'a' });
  });
  if (hits.length !== 1) return { reason: hits.length ? 'multiple' : 'none' };
  const hit = hits[0], axis = dim.params.axis === 'h' ? 0 : 1;
  const zeroExtent = dim.kind === 'linear' && Math.abs(local(m, hit.B)[axis] - local(m, hit.A)[axis]) < LINK_TOL;
  return { ...hit, dim, m, zeroExtent };
}

/** Plain number entry: existing overrides stay text; the shown value is no change even without a LINE. */
export function dimensionEntry(raw, e, typed) {
  const dim = dimOfEntity(raw, e), n = dim && !overrideText(dim.params.override) ? typedLength(typed, dim.params.units) : null;
  if (n == null) return null;
  const link = dimensionLine(raw, e);
  if (link.reason === 'kind') return link;
  const shown = measuredText(raw.blocks[dim.name].entities);
  if (link.reason ? n === typedLength(shown, dim.params.units) : dimLabel(n * (dim.params.units === 'inch' ? 25.4 : 1), dim.dp, dim.params.units) === shown) return { unchanged: true };
  return link.reason ? link : { n, link };
}

/** The LINE at `e` with the end at the dimension's second point moved until the dimension reads `shown`: along the line for aligned, only the measured local coordinate for h / v (shown units: inches for an inch dimension, times the factor otherwise).
 * → { i, line (the new entity), built (the dimension rebuilt from it) } or null (no single LINE, shown not above 0, or no change). */
export function driveLine(raw, e, shown, factor = 1) {
  const hit = linkedLine(raw, e);
  if (!hit || hit.zeroExtent) return null;
  const len = shown * (hit.dim.params.units === 'inch' ? 25.4 : 1) / (factor || 1), { A, B } = hit, d = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  let to;
  if (hit.dim.kind === 'linear') {
    const a = local(hit.m, A), b = local(hit.m, B), axis = hit.dim.params.axis === 'h' ? 0 : 1;
    b[axis] = a[axis] + Math.sign(b[axis] - a[axis]) * len;
    to = mapply(hit.m, ...b);
  } else to = [A[0] + (B[0] - A[0]) / d * len, A[1] + (B[1] - A[1]) / d * len];
  const line = dragGrip(raw.entities[hit.i], hit.id, to)?.ent;
  const built = line && buildDim(hit.dim.kind, { ...hit.dim.params, b: local(hit.m, to) }, factor, hit.dim.name, hit.dim.dp);
  return built ? { i: hit.i, line, built } : null;
}

/** TODO 76a: `raw`'s { entities, blocks } after the dimension at `e` drives its LINE: the LINE moved, the dimension rebuilt from it directly, the other dimensions on the line followed. Null as driveLine. */
export function driveDimension(raw, e, shown, factor = 1) {
  const hit = driveLine(raw, e, shown, factor);
  if (!hit) return null;
  const moved = followDimensions(raw, { entities: raw.entities.map((x, i) => (i === hit.i ? hit.line : x)), blocks: raw.blocks }, factor);
  return replaceDimension(moved, hit.built);       // directly: followDimensions skips a dimension whose moved end another line shares
}
