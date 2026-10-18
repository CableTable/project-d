// grips.js — the grips of a selected shape, pure (no DOM): grips.test.mjs.
//
// A selected LINE, ARC, CIRCLE or LWPOLYLINE shows small squares to drag. Everything here works on the entity record (dxf-write.js shape:
// { type, layer, …, r: { c: [codes], v: [values] } }) in the drawing's own units, y up; `factor` turns units into mm for what is shown.
//
//   gripsOf(ent)                 → [{ id, kind: 'end' | 'mid' | 'centre' | 'quad' | 'vertex', x, y }]
//   dragGrip(ent, id, to)        → { ent: the changed record, label } or null (nothing sensible: the point is the same, three points in a line)
//   refPoint(ent, id)            → the point the rubber band starts from (the fixed end of a line, the centre of a circle, else the grip itself)
//   shapeOf(ent, factor)         → the shape in mm as draw.js svgPath draws it
//   (a leader, leader.js, is passed in as { type: 'LEADER', model } and has a grip at each of its points)
//   readoutOf(ent, id, next, factor) → "331.06 mm · 25.02°", "Move ΔX 10.00 ΔY 40.00", "R 25.00" …
//   MAX_SELECTED                 → grips are off when more entities than this are selected
import { arcThrough3, sweepOf, angleOf, dist, n2 } from './draw.js';

export const MAX_SELECTED = 200;
export const MAX_GRIPS = 2000;
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

/** Does this entity have grips? (A mirrored one does not: its numbers are in its own turned frame.) */
export function hasGrips(ent) {
  if (ent && ent.type === 'LEADER' && ent.model) return true;
  if (!ent || !ent.r || !TYPES.has(ent.type)) return false;
  const k = at(ent.r, 210);
  if (k >= 0 && (num(ent.r.v[k]) !== 0 || num(ent.r.v[k + 1]) !== 0 || num(ent.r.v[k + 2]) < 0)) return false;
  return true;
}

export function lwVertices(r) {
  const vs = [];
  for (let k = 0; k < r.c.length; k++) {
    if (r.c[k] === 10) vs.push({ kx: k, ky: -1, kb: -1 });
    else if (r.c[k] === 20 && vs.length && vs[vs.length - 1].ky < 0) vs[vs.length - 1].ky = k;
    else if (r.c[k] === 42 && vs.length) vs[vs.length - 1].kb = k;
  }
  return vs.filter((v) => v.ky >= 0).map((v) => ({ ...v, x: num(r.v[v.kx]), y: num(r.v[v.ky]), b: v.kb >= 0 ? num(r.v[v.kb]) : 0 }));
}
function arcOf(r) {
  const c = [get(r, 10) ?? 0, get(r, 20) ?? 0], rad = get(r, 40) ?? 0, a0 = get(r, 50) ?? 0, a1 = get(r, 51) ?? 0;
  const sw = sweepOf(a0, a1), at0 = (t) => [c[0] + rad * Math.cos(t * DEG), c[1] + rad * Math.sin(t * DEG)];
  return { c, r: rad, a0, a1, sweep: sw, s: at0(a0), e: at0(a1), m: at0(a0 + sw / 2) };
}

/** The grips of an entity: [{ id, kind, x, y }] (empty when it has none). */
export function gripsOf(ent) {
  if (!hasGrips(ent)) return [];
  if (ent.type === 'LEADER') return ent.model.pts.map((p, i) => ({ id: 'v' + i, kind: 'vertex', x: p[0], y: p[1] }));
  const r = ent.r;
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
  return lwVertices(r).map((v, i) => ({ id: 'v' + i, kind: 'vertex', x: v.x, y: v.y }));
}

const find = (ent, id) => gripsOf(ent).find((g) => g.id === id) || null;

/** Where the rubber band starts: a line's other end, a circle's centre; any other grip stretches from where it was. */
export function refPoint(ent, id) {
  const g = find(ent, id);
  if (!g) return null;
  if (ent.type === 'LEADER') { const p = ent.model.pts, o = p[+id.slice(1) ? +id.slice(1) - 1 : 1]; return [o[0], o[1]]; }       // the neighbouring point
  if (ent.type === 'LINE' && (id === 'a' || id === 'b')) { const o = find(ent, id === 'a' ? 'b' : 'a'); return [o.x, o.y]; }
  if (ent.type === 'CIRCLE' && id.startsWith('q')) { const c = find(ent, 'c'); return [c.x, c.y]; }
  return [g.x, g.y];
}

/**
 * The entity with grip `id` dragged to `to` ([x, y], drawing units), and the name of that undo step; null when it comes to nothing
 * (the same point, or three points in a line for an arc). A line's end moves that end; its middle moves it whole. A circle's centre moves it,
 * a quadrant sets the radius. An arc's ends and middle re-fit the arc through three points (its middle is the bulge); its centre moves it.
 * A polyline vertex moves that vertex (the bulges stay).
 */
export function dragGrip(ent, id, to) {
  const g = find(ent, id);
  if (!g || !to || !Number.isFinite(to[0]) || !Number.isFinite(to[1])) return null;
  if (ent.type === 'LEADER') {
    const i = +id.slice(1), p = ent.model.pts;
    if (p.some((q, k) => k !== i && dist(q, to) < 1e-9) || dist(p[i], to) < 1e-12) return null;                  // no two points on one another
    return { ent: { ...ent, model: { ...ent.model, pts: p.map((q, k) => (k === i ? [to[0], to[1]] : q)) } }, label: 'Stretch leader' };
  }
  const r = ent.r, T = ent.type;
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
    return { t: 'poly', pts: lwVertices(r).map((v) => (v.b ? [v.x * f, v.y * f, v.b] : [v.x * f, v.y * f])), closed: (flags & 1) === 1 };
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
  if (ent.type === 'LWPOLYLINE' || ent.type === 'LEADER') { const n = find(next, id); return `X ${n2(n.x * f)} · Y ${n2(n.y * f)}`; }
  const n = find(next, id);
  return `Move ΔX ${n2((n.x - g.x) * f)} ΔY ${n2((n.y - g.y) * f)}`;
}

/** The name of the command line's word for dragging this grip. */
export const commandOf = (ent, id) => (ent.type === 'LINE' ? (id === 'm' ? 'MOVE' : 'STRETCH') : ent.type === 'CIRCLE' ? (id === 'c' ? 'MOVE' : 'STRETCH') : ent.type === 'ARC' ? (id === 'c' ? 'MOVE' : 'STRETCH') : 'STRETCH');
