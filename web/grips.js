// grips.js — the grips of a selected shape, pure (no DOM): grips.test.mjs.
//
// A selected LINE, ARC, CIRCLE or LWPOLYLINE shows small squares to drag; so do TEXT, MTEXT, INSERT, HATCH (a grip that moves it whole) and ELLIPSE (155e4). Everything here works on the entity record (dxf-write.js shape:
// { type, layer, …, r: { c: [codes], v: [values] } }) in the drawing's own units, y up; `factor` turns units into mm for what is shown.
//
//   gripsOf(ent)                 → [{ id, kind: 'end' | 'mid' | 'centre' | 'quad' | 'vertex' | 'edge', x, y }]
//   dragGrip(ent, id, to, shift) → { ent: the changed record, label } or null (nothing sensible: the point is the same, three points in a line)
//   refPoint(ent, id)            → the point the rubber band starts from (the fixed end of a line, the centre of a circle, else the grip itself)
//   shapeOf(ent, factor)         → the shape in mm as draw.js svgPath draws it
//   (a leader, leader.js, is passed in as { type: 'LEADER', model } and has a grip at each of its points)
//   readoutOf(ent, id, next, factor) → "331.06 mm · 25.02°", "Move ΔX 10.00 ΔY 40.00", "R 25.00" …
//   MAX_SELECTED                 → grips are off when more entities than this are selected
//   capGrips(list)               → the list, or [] when it exceeds MAX_GRIPS handles
import { arcThrough3, sweepOf, angleOf, dist, n2 } from './draw.js';
import { moveEntities } from './edit.js';          // a move-type grip moves the whole object the way the Move command does (155e4)

export const MAX_SELECTED = 200;
export const GRIP_SIZE = 5;                 // 155r: GRIPSIZE 5, AutoCAD's half side: the square is 2 * 5 + 1 px
export const gripSide = (n = GRIP_SIZE) => 2 * n + 1;
export const MAX_GRIPS = 5000;    // shortcut: hide all grips above 5000 handles; use a virtualized overlay if denser editing is needed
/** The grips to show: all of them, or none when there are too many handles. */
export const capGrips = (list) => (list.length > MAX_GRIPS ? [] : list);
const DEG = Math.PI / 180;
const TYPES = new Set(['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE']);

export const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const at = (r, code, which = 0) => { let n = -1; for (let k = 0; k < r.c.length; k++) if (r.c[k] === code && ++n === which) return k; return -1; };
export const get = (r, code, which = 0) => { const k = at(r, code, which); return k < 0 ? null : num(r.v[k]); };
const text = (n) => String(+Number(n).toPrecision(15));
/** The record with these [index, value] pairs changed (the arrays are copied; the rest is shared). */
export function withValues(ent, edits) {
  const v = ent.r.v.slice();
  for (const [k, val] of edits) v[k] = text(val);
  return { ...ent, r: { ...ent.r, v } };
}

/** Is the record drawn in the world frame? (A mirrored or tilted one has its numbers in its own turned frame.) */
function upright(r) {
  const k = at(r, 210);
  return !(k >= 0 && (num(r.v[k]) !== 0 || num(r.v[k + 1]) !== 0 || num(r.v[k + 2]) < 0));
}
/** Does this entity have curve grips (a line, arc, circle, polyline or leader)? Trim, Extend, Offset, Mirror and Properties ask this: text, hatch, ellipse and blocks are not in it. */
export function hasGrips(ent) {
  if (ent && ent.type === 'LEADER' && ent.model) return true;
  return !!ent && !!ent.r && TYPES.has(ent.type) && upright(ent.r);
}
/** 155e4: the kinds whose grip moves the whole object (an ellipse only by its centre); the word is for the undo step. */
const MOVES = { TEXT: 'text', MTEXT: 'text', INSERT: 'block', HATCH: 'hatch', ELLIPSE: 'ellipse' };
export const movesWhole = (ent, id) => !!MOVES[ent.type] && (ent.type !== 'ELLIPSE' || id === 'c');
const TAU = 2 * Math.PI;
const sweepOK = (s) => { const w = ((s % TAU) + TAU) % TAU; return w > 1e-5 && TAU - w > 1e-5; };       // a real arc, not the full 0 .. 2π (the writer saves 6.283185)
/** The numbers of an ELLIPSE: centre c, major half-axis m, minor half-axis n (m turned 90° and scaled by the ratio), start / end parameter. */
function ellipseOf(r) {
  const c = [get(r, 10) ?? 0, get(r, 20) ?? 0], m = [get(r, 11) ?? 0, get(r, 21) ?? 0], ratio = get(r, 40) ?? 1;
  return { c, m, n: [-m[1] * ratio, m[0] * ratio], ratio, t0: get(r, 41) ?? 0, t1: get(r, 42) ?? TAU, arc: at(r, 41) >= 0 && at(r, 42) >= 0 && sweepOK((get(r, 42) - get(r, 41))) };
}
/** Centre of a HATCH's extents (boundary points; an arc, circle or ellipse edge counts as its full radius round its centre), or null. shortcut: not the exact arc extents, upgrade if a centre must be exact. */
function hatchCentre(r) {
  let stage = 'head', flags = 0, edge = 0, x = 0, cx = 0, cy = 0, mx = 0;
  const xs = [], ys = [], put = (px, py, rad = 0) => { xs.push(px - rad, px + rad); ys.push(py - rad, py + rad); };
  for (let k = 0; k < r.c.length; k++) {
    const c = r.c[k], v = num(r.v[k]);
    if (c === 91 && stage === 'head') stage = 'paths';
    else if (c === 75 && stage === 'paths') stage = 'pattern';
    else if (stage !== 'paths') continue;
    else if (c === 92) { flags = v; edge = 0; }
    else if (c === 72 && !(flags & 2)) edge = v;
    else if (c === 10 || (c === 11 && edge !== 3)) x = v;
    else if (c === 20 || (c === 21 && edge !== 3)) { if (c === 20) { cx = x; cy = v; } if (edge !== 2 && edge !== 3) put(x, v); }
    else if (c === 40 && edge === 2) put(cx, cy, v);
    else if (c === 11) mx = v;
    else if (c === 21 && edge === 3) put(cx, cy, Math.hypot(mx, v));
  }
  return xs.length ? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] : null;
}

/** Can this entity show grips of any kind? */
const gripped = (ent) => hasGrips(ent) || (!!ent && !!ent.r && !!MOVES[ent.type] && upright(ent.r) && (ent.type !== 'HATCH' || !!hatchCentre(ent.r)));

export function lwVertices(r) {
  const vs = [];
  for (let k = 0; k < r.c.length; k++) {
    if (r.c[k] === 10) vs.push({ kx: k, ky: -1, kb: -1 });
    else if (r.c[k] === 20 && vs.length && vs[vs.length - 1].ky < 0) vs[vs.length - 1].ky = k;
    else if (r.c[k] === 42 && vs.length) vs[vs.length - 1].kb = k;
    else if (r.c[k] === 40 && vs.length) vs[vs.length - 1].ws = num(r.v[k]);
    else if (r.c[k] === 41 && vs.length) vs[vs.length - 1].we = num(r.v[k]);
  }
  return vs.filter((v) => v.ky >= 0).map((v) => ({ ...v, x: num(r.v[v.kx]), y: num(r.v[v.ky]), b: v.kb >= 0 ? num(r.v[v.kb]) : 0 }));
}
function arcOf(r) {
  const c = [get(r, 10) ?? 0, get(r, 20) ?? 0], rad = get(r, 40) ?? 0, a0 = get(r, 50) ?? 0, a1 = get(r, 51) ?? 0;
  const sw = sweepOf(a0, a1), at0 = (t) => [c[0] + rad * Math.cos(t * DEG), c[1] + rad * Math.sin(t * DEG)];
  return { c, r: rad, a0, a1, sweep: sw, s: at0(a0), e: at0(a1), m: at0(a0 + sw / 2) };
}

/** Four straight, nonzero sides meeting at right angles, in either winding and any rotation. */
function rectangleVertices(r) {
  const vs = lwVertices(r);
  if (!((get(r, 70) ?? 0) & 1) || vs.length !== 4 || vs.some((v) => v.b)) return null;
  const sides = vs.map((v, i) => [vs[(i + 1) % 4].x - v.x, vs[(i + 1) % 4].y - v.y]);
  const lengths = sides.map((s) => Math.hypot(...s));
  if (lengths.some((n) => n <= 1e-9)) return null;
  return sides.every((s, i) => {
    const j = (i + 1) % 4, t = sides[j];
    return Math.abs(s[0] * t[0] + s[1] * t[1]) <= 1e-9 * lengths[i] * lengths[j];
  }) ? vs : null;
}

/** The grips of an entity: [{ id, kind, x, y }] (empty when it has none). */
export function gripsOf(ent) {
  if (!gripped(ent)) return [];
  if (ent.type === 'LEADER') return ent.model.pts.map((p, i) => ({ id: 'v' + i, kind: 'vertex', x: p[0], y: p[1] }));
  const r = ent.r;
  if (MOVES[ent.type]) {
    if (ent.type === 'HATCH') { const c = hatchCentre(r); return [{ id: 'c', kind: 'centre', x: c[0], y: c[1] }]; }
    if (ent.type === 'ELLIPSE') {
      const q = ellipseOf(r), at1 = (t) => [q.c[0] + q.m[0] * Math.cos(t) + q.n[0] * Math.sin(t), q.c[1] + q.m[1] * Math.cos(t) + q.n[1] * Math.sin(t)];
      const ends = [['m0', q.m, 1], ['m1', q.m, -1], ['n0', q.n, 1], ['n1', q.n, -1]].map(([id, v, s]) => ({ id, kind: 'quad', x: q.c[0] + s * v[0], y: q.c[1] + s * v[1] }));
      const arcEnds = q.arc ? [['s', q.t0], ['t', q.t1]].map(([id, t]) => ({ id, kind: 'end', x: at1(t)[0], y: at1(t)[1] })) : [];
      return [{ id: 'c', kind: 'centre', x: q.c[0], y: q.c[1] }, ...ends, ...arcEnds];
    }
    const p = { id: 'i', kind: 'insert', x: get(r, 10) ?? 0, y: get(r, 20) ?? 0 };
    return ent.type === 'TEXT' && ((get(r, 72) ?? 0) || (get(r, 73) ?? 0)) ? [p, { id: 'a', kind: 'insert', x: get(r, 11) ?? 0, y: get(r, 21) ?? 0 }] : [p];       // a justified text has a second grip at its alignment point
  }
  if (ent.type === 'LINE') {
    const a = [get(r, 10) ?? 0, get(r, 20) ?? 0], b = [get(r, 11) ?? 0, get(r, 21) ?? 0];
    return [{ id: 'a', kind: 'end', x: a[0], y: a[1] }, { id: 'm', kind: 'mid', x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }, { id: 'b', kind: 'end', x: b[0], y: b[1] }];
  }
  if (ent.type === 'CIRCLE') {
    const c = [get(r, 10) ?? 0, get(r, 20) ?? 0], rad = get(r, 40) ?? 0;
    return [{ id: 'c', kind: 'centre', x: c[0], y: c[1] }, ...[0, 1, 2, 3].map((i) => ({ id: 'q' + i, kind: 'quad', x: c[0] + rad * Math.cos(i * Math.PI / 2), y: c[1] + rad * Math.sin(i * Math.PI / 2) }))];
  }
  if (ent.type === 'ARC') {
    const a = arcOf(r);
    return [{ id: 'a', kind: 'end', x: a.s[0], y: a.s[1] }, { id: 'm', kind: 'mid', x: a.m[0], y: a.m[1] }, { id: 'b', kind: 'end', x: a.e[0], y: a.e[1] }, { id: 'c', kind: 'centre', x: a.c[0], y: a.c[1] }];
  }
  const vertices = lwVertices(r).map((v, i) => ({ id: 'v' + i, kind: 'vertex', x: v.x, y: v.y }));
  const rect = rectangleVertices(r);
  return rect ? vertices.concat(rect.map((v, i) => ({ id: 'e' + i, kind: 'edge', x: (v.x + rect[(i + 1) % 4].x) / 2, y: (v.y + rect[(i + 1) % 4].y) / 2 }))) : vertices;
}

const find = (ent, id) => gripsOf(ent).find((g) => g.id === id) || null;

/** Where the rubber band starts: a line's other end, a circle's centre; any other grip stretches from where it was. */
export function refPoint(ent, id) {
  const g = find(ent, id);
  if (!g) return null;
  if (ent.type === 'LEADER') { const p = ent.model.pts, o = p[+id.slice(1) ? +id.slice(1) - 1 : 1]; return [o[0], o[1]]; }       // the neighbouring point
  if (ent.type === 'LINE' && (id === 'a' || id === 'b')) { const o = find(ent, id === 'a' ? 'b' : 'a'); return [o.x, o.y]; }
  if ((ent.type === 'CIRCLE' && id.startsWith('q')) || (ent.type === 'ELLIPSE' && id !== 'c')) { const c = find(ent, 'c'); return [c.x, c.y]; }
  return [g.x, g.y];
}

/**
 * An ellipse's axis or arc-end grip dragged to `to` (the centre grip moves it whole: movesWhole). A major end sets the major half-axis to centre → pointer
 * (length and angle), the minor length stays; a minor end sets the minor length to the pointer's distance across the major axis; when the new major would be
 * shorter than the minor the two swap (the major always stays the longer). An arc end sets that end's parameter to the pointer's.
 */
function dragEllipse(ent, id, g, to) {
  if (dist([g.x, g.y], to) < 1e-12) return null;
  const r = ent.r, q = ellipseOf(r), a = Math.hypot(q.m[0], q.m[1]), b = a * q.ratio, d = [to[0] - q.c[0], to[1] - q.c[1]];
  const axes = (m, minor) => {
    const len = Math.hypot(m[0], m[1]);
    if (!(len > 1e-9) || !(minor > 1e-9)) return null;
    const big = len >= minor ? { m, ratio: minor / len } : { m: [-m[1] * minor / len, m[0] * minor / len], ratio: len / minor };
    return { ent: withValues(ent, [[at(r, 11), big.m[0]], [at(r, 21), big.m[1]], [at(r, 40), big.ratio]]), label: 'Ellipse axis' };
  };
  if (id === 'm0' || id === 'm1') return axes(id === 'm0' ? d : [-d[0], -d[1]], b);
  if (id === 'n0' || id === 'n1') return axes(q.m, Math.abs((-d[0] * q.m[1] + d[1] * q.m[0]) / a));
  const t = Math.atan2((d[0] * q.n[0] + d[1] * q.n[1]) / (b * b), (d[0] * q.m[0] + d[1] * q.m[1]) / (a * a));
  return { ent: withValues(ent, [[at(r, id === 's' ? 41 : 42), (t + TAU) % TAU]]), label: 'Ellipse arc' };
}

/**
 * The entity with grip `id` dragged to `to` ([x, y], drawing units), and the name of that undo step; null when it comes to nothing
 * (the same point, or three points in a line for an arc). A line's end moves that end; its middle moves it whole. A circle's centre moves it,
 * a quadrant sets the radius. An arc's ends and middle re-fit the arc through three points (its middle is the bulge); its centre moves it.
 * A polyline vertex moves that vertex (the bulges stay).
 */
export function dragGrip(ent, id, to, shift = false) {
  const g = find(ent, id);
  if (!g || !to || !Number.isFinite(to[0]) || !Number.isFinite(to[1])) return null;
  if (ent.type === 'LEADER') {
    const i = +id.slice(1), p = ent.model.pts;
    if (p.some((q, k) => k !== i && dist(q, to) < 1e-9) || dist(p[i], to) < 1e-12) return null;                  // no two points on one another
    return { ent: { ...ent, model: { ...ent.model, pts: p.map((q, k) => (k === i ? [to[0], to[1]] : q)) } }, label: 'Stretch leader' };
  }
  const r = ent.r, T = ent.type;
  if (movesWhole(ent, id)) {
    if (dist([g.x, g.y], to) < 1e-12) return null;
    return { ent: moveEntities({ entities: [ent], blocks: {} }, new Set([0]), to[0] - g.x, to[1] - g.y).entities[0], label: 'Move ' + MOVES[T] };
  }
  if (T === 'ELLIPSE') return dragEllipse(ent, id, g, to);
  if (T === 'LINE') {
    const [k10, k20, k11, k21] = [at(r, 10), at(r, 20), at(r, 11), at(r, 21)];
    if (id === 'm') {
      const dx = to[0] - g.x, dy = to[1] - g.y;
      if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return null;
      return { ent: withValues(ent, [[k10, num(r.v[k10]) + dx], [k20, num(r.v[k20]) + dy], [k11, num(r.v[k11]) + dx], [k21, num(r.v[k21]) + dy]]), label: 'Move line' };
    }
    const o = find(ent, id === 'a' ? 'b' : 'a');
    if (dist([o.x, o.y], to) < 1e-9 || dist([g.x, g.y], to) < 1e-12) return null;
    return { ent: withValues(ent, id === 'a' ? [[k10, to[0]], [k20, to[1]]] : [[k11, to[0]], [k21, to[1]]]), label: 'Stretch line' };
  }
  if (T === 'CIRCLE') {
    if (id === 'c') {
      if (dist([g.x, g.y], to) < 1e-12) return null;
      return { ent: withValues(ent, [[at(r, 10), to[0]], [at(r, 20), to[1]]]), label: 'Move circle' };
    }
    const c = find(ent, 'c'), rad = dist([c.x, c.y], to);
    if (!(rad > 1e-9) || Math.abs(rad - (get(r, 40) ?? 0)) < 1e-12) return null;
    return { ent: withValues(ent, [[at(r, 40), rad]]), label: 'Circle radius' };
  }
  if (T === 'ARC') {
    const a = arcOf(r);
    if (id === 'c') {
      if (dist([g.x, g.y], to) < 1e-12) return null;
      return { ent: withValues(ent, [[at(r, 10), to[0]], [at(r, 20), to[1]]]), label: 'Move arc' };
    }
    const p = { a: [to, a.m, a.e], m: [a.s, to, a.e], b: [a.s, a.m, to] }[id];
    if (!p || dist([g.x, g.y], to) < 1e-12) return null;
    const f = arcThrough3(p[0], p[1], p[2]);
    if (!f) return null;
    return { ent: withValues(ent, [[at(r, 10), f.c[0]], [at(r, 20), f.c[1]], [at(r, 40), f.r], [at(r, 50), f.a0], [at(r, 51), f.a1]]), label: id === 'm' ? 'Arc bulge' : 'Stretch arc' };
  }
  if (g.kind === 'edge') {
    const vs = rectangleVertices(r), i = +id.slice(1), j = (i + 1) % 4;
    const a = vs[(i + 2) % 4], b = vs[(i + 3) % 4], ox = (a.x + b.x) / 2, oy = (a.y + b.y) / 2;
    const span = Math.hypot(g.x - ox, g.y - oy), nx = (g.x - ox) / span, ny = (g.y - oy) / span;
    const delta = (to[0] - g.x) * nx + (to[1] - g.y) * ny, size = span + delta;
    if (size <= 1e-9 || Math.abs(delta) < 1e-12) return null;
    const ratio = shift ? size / span : 1;
    const edits = vs.flatMap((v, k) => {
      const along = (v.x - ox) * -ny + (v.y - oy) * nx;
      const move = k === i || k === j ? delta : 0;
      return [[v.kx, v.x + nx * move - ny * along * (ratio - 1)], [v.ky, v.y + ny * move + nx * along * (ratio - 1)]];
    });
    return { ent: withValues(ent, edits), label: 'Resize rectangle' };
  }
  const vs = lwVertices(r), v = vs[+id.slice(1)];
  if (!v || dist([v.x, v.y], to) < 1e-12) return null;
  return { ent: withValues(ent, [[v.kx, to[0]], [v.ky, to[1]]]), label: 'Stretch polyline' };
}

/** The shape (mm) of an entity, as draw.js svgPath wants it: { t: 'line' | 'circle' | 'arc' | 'poly', … }; null for other types. */
export function shapeOf(ent, factor = 1) {
  if (ent && ent.type === 'LEADER') return { t: 'poly', pts: ent.model.pts.map((p) => [p[0] * factor, p[1] * factor]), closed: false };
  if (!ent || !ent.r) return null;
  const r = ent.r, f = factor, P = (x, y) => [x * f, y * f];
  if (ent.type === 'LINE') return { t: 'line', a: P(get(r, 10) ?? 0, get(r, 20) ?? 0), b: P(get(r, 11) ?? 0, get(r, 21) ?? 0) };
  if (ent.type === 'CIRCLE') return { t: 'circle', c: P(get(r, 10) ?? 0, get(r, 20) ?? 0), r: (get(r, 40) ?? 0) * f };
  if (ent.type === 'ARC') { const a = arcOf(r); return { t: 'arc', c: P(a.c[0], a.c[1]), r: a.r * f, a0: a.a0, a1: a.a1 }; }
  if (ent.type === 'LWPOLYLINE') {
    const flags = get(r, 70) ?? 0;
    return { t: 'poly', pts: lwVertices(r).map((v) => (v.ws != null || v.we != null ? [v.x * f, v.y * f, v.b, (v.ws ?? 0) * f, (v.we ?? 0) * f] : v.b ? [v.x * f, v.y * f, v.b] : [v.x * f, v.y * f])), closed: (flags & 1) === 1 };
  }
  return null;
}

/** What the readout beside the pointer says while grip `id` of `ent` is dragged to produce `next` (the changed entity); factor: mm per unit. */
export function readoutOf(ent, id, next, factor = 1) {
  const g = find(ent, id), f = factor;
  if (!g || !next) return '';
  if (ent.type === 'LINE' && id !== 'm') { const n = shapeOf(next, f); return `${n2(dist(n.a, n.b))} mm · ${n2(angleOf(n.a, n.b))}°`; }
  if (ent.type === 'CIRCLE' && id.startsWith('q')) return `R ${n2(shapeOf(next, f).r)}`;
  if (ent.type === 'ARC' && (id === 'a' || id === 'b' || id === 'm')) { const n = shapeOf(next, f); return `R ${n2(n.r)} · ${n2(sweepOf(n.a0, n.a1))}°`; }
  if (ent.type === 'ELLIPSE' && id !== 'c') { const q = ellipseOf(next.r), a = Math.hypot(...q.m) * f; return `Major ${n2(2 * a)} · Minor ${n2(2 * a * q.ratio)} mm`; }
  if (ent.type === 'LWPOLYLINE' || ent.type === 'LEADER') { const n = find(next, id); return `X ${n2(n.x * f)} · Y ${n2(n.y * f)}`; }
  const n = find(next, id);
  return `Move ΔX ${n2((n.x - g.x) * f)} ΔY ${n2((n.y - g.y) * f)}`;
}

/** The name of the command line's word for dragging this grip. */
export const commandOf = (ent, id) => (movesWhole(ent, id) ? 'MOVE' : ent.type === 'LINE' ? (id === 'm' ? 'MOVE' : 'STRETCH') : ent.type === 'CIRCLE' ? (id === 'c' ? 'MOVE' : 'STRETCH') : ent.type === 'ARC' ? (id === 'c' ? 'MOVE' : 'STRETCH') : 'STRETCH');
