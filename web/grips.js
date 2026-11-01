// grips.js — the grips of a selected shape, pure (no DOM): grips.test.mjs.
//
// A selected LINE, ARC, CIRCLE or LWPOLYLINE shows small squares to drag; so do TEXT, MTEXT, INSERT, HATCH (a grip that moves it whole) and ELLIPSE (155e4). Everything here works on the entity record (dxf-write.js shape:
// { type, layer, …, r: { c: [codes], v: [values] } }) in the drawing's own units, y up; `factor` turns units into mm for what is shown.
//
//   gripsOf(ent, attMode)        → [{ id, kind: 'end' | 'mid' | 'centre' | 'quad' | 'vertex' | 'edge' | 'insert' | 'tri', x, y }]
//                                  164a: an MTEXT also has width 'w', height 'h' and both 'wh' (kind 'tri', tri = the triangle's screen angle in degrees); a block insert one 'a<n>' per visible attribute (kid n)
//   dragGrip(ent, id, to, shift) → { ent: the changed record, label } or null (nothing sensible: the point is the same, three points in a line)
//   optionsOf(ent, id)           → 163a Grip options: ['Stretch', 'Lengthen'] / ['Stretch', 'Radius'] / []; lengthen, setRadius, dragOption, typedOption do them
//                                  163b polylines: vertex Stretch / Insert vertex / Remove vertex, segment mid Stretch / Insert vertex / Convert to Arc | Line (insertVertex, removeVertex, convertToArc, convertToLine)
//                                  164b1 a hatch's centre: Stretch / Origin Point / Hatch Angle / Hatch Scale (hatchOrigin, hatchAngle, hatchScale)
//                                  164b2 a hatch with 71 = 0 also has 'v<path>_<n>' vertex and 'e<path>_<n>' segment-mid grips on each line / arc boundary path, with the polyline lists (hatchPaths, putPath)
//   refPoint(ent, id)          → the point the rubber band starts from (the fixed end of a line, the centre of a circle, else the grip itself)
//   shapeOf(ent, factor)         → the shape in mm as draw.js svgPath draws it
//   (a leader, leader.js, is passed in as { type: 'LEADER', model } and has a grip at each of its points)
//   readoutOf(ent, id, next, factor) → "331.06 mm · 25.02°", "Move ΔX 10.00 ΔY 40.00", "R 25.00" …
//   MAX_SELECTED                 → grips are off when more entities than this are selected
//   capGrips(list)               → the list, or [] when it exceeds MAX_GRIPS handles
//
// Where the app drives grips (app.js; grep the name):
//   gripDoc (Drawings, Layouts): the doc grips work on: a drawing tab, or a layout's selected objects as a drawing (layObjSelDoc); else null.
//   gripOn (Drawings, Layouts): do grips show (Select tool, 1..MAX_SELECTED selected, no text edit); gripDoc() must be that doc.
//   gripList (Drawings, Layouts): every grip of the selection via gripsOf (a leader via ldrPseudo), cached; skips locked and dimension objects.
//   gripAt (Drawings, Layouts):hit-test the nearest grip under the pointer.
//   gripDown (Drawings, Layouts):start a grip run, or put down a hot grip.
//   gripPick (Drawings, Layouts): the point under the pointer: the snaps (0.01 mm grid when free), then Shift / ORTHO along X or Y from the base.
//   gripAim (Drawings, Layouts):update the drag preview (dragGrip / dragOption, or gripStretchHots) at the picked point.
//   gripMove (Drawings, Layouts): after 4 px of drag, aim at the picked point and repaint.
//   gripUp (Drawings, Layouts): end of a drag puts the grip down (gripPut); a plain click makes it hot; a Shift click toggles it hot.
//   gripPut (Drawings, Layouts): a click or release at the pointer: a base point, a Reference point, or the pick itself (Ctrl = a copy).
//   gripOptionCycle (Drawings, Layouts):Ctrl cycles options that take a point.
//   gripCommit (Drawings, Layouts): apply the edit with one Undo step (a layout through layGripCommit).
//   cmpDown (Compare): leave source grips to the shared grip handler.
//   layObjSelDoc (Layouts): map selected objects into the objects' drawing.
//   layGripCommit (Layouts): replace layout objects with one Undo step.
//   gripStretchHots (Drawings, Layouts): with several hot grips every one moves by the base → pick vector; the only caller of stretchHots.
//   stretchHots (here): normalize hot grips so each vertex stretches once.
import { arcThrough3, sweepOf, angleOf, dist, n2 } from './draw.js';
import { moveEntities } from './edit.js';          // a move-type grip moves the whole object the way the Move command does (155e4)
import { bulgeOf3 } from './contour.js';             // 163b: the bulge of the arc through a pointer
import { mtextBox } from './drawing.js';             // 164a: an MTEXT's box

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
export const movesWhole = (ent, id) => !!MOVES[ent.type] && (ent.type !== 'ELLIPSE' || id === 'c') && !(id[0] === 'a' && ent.type === 'INSERT') && !(ent.type === 'MTEXT' && id !== 'i') && !(ent.type === 'HATCH' && id !== 'c');       // 164a: an MTEXT's size grips and a block's attribute grips change one part only; 164b2: so do a hatch's boundary grips
/** 164a: is this a kind drawn without an outline (text, hatch, block, ellipse), shown moved or redrawn as a whole while a grip is dragged? */
export const noOutline = (ent) => !!MOVES[ent.type];
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

/** 164a: an MTEXT record's box (drawing.js mtextBox) with its insertion point p and at(x, y): a point of the box frame in the drawing, as { x, y }; null when it draws nothing. */
function mtextFrame(r) {
  const b = mtextBox(r);
  if (!b) return null;
  const p = [get(r, 10) ?? 0, get(r, 20) ?? 0], c = Math.cos(b.rot), s = Math.sin(b.rot);
  return { ...b, p, c, s, at: (x, y) => ({ x: p[0] + x * c - y * s, y: p[1] + x * s + y * c }) };
}
/** 164a: the attribute of a block insert, grips for: its point (the alignment point when justified, as drawing.js draws it) or null when it has none (not visible, position locked, turned). */
function attribPoint(k, attMode) {
  if (k.type !== 'ATTRIB' || attMode === 0 || !upright(k) || get(k, 60) === 1 || (attMode !== 2 && ((get(k, 70) ?? 0) & 1))) return null;
  if (get(k, 280, 1) === 1) return null;       // position locked: ATTRIB's 2nd group 280 (group 70 has only bits 1 / 2 / 4 / 8)
  const ha = get(k, 72) ?? 0, justified = ha !== 3 && ha !== 5 && ((ha || (get(k, 74) ?? 0)) && at(k, 11) >= 0);
  return justified ? [get(k, 11), get(k, 21) ?? 0] : [get(k, 10) ?? 0, get(k, 20) ?? 0];
}
const attribGrips = (ent, attMode) => (ent.kids || []).flatMap((k, i) => { const q = attribPoint(k, attMode); return q ? [{ id: 'a' + i, kind: 'insert', x: q[0], y: q[1] }] : []; });

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
  if (r.noRect || !((get(r, 70) ?? 0) & 1) || vs.length !== 4 || vs.some((v) => v.b)) return null;
  const sides = vs.map((v, i) => [vs[(i + 1) % 4].x - v.x, vs[(i + 1) % 4].y - v.y]);
  const lengths = sides.map((s) => Math.hypot(...s));
  if (lengths.some((n) => n <= 1e-9)) return null;
  return sides.every((s, i) => {
    const j = (i + 1) % 4, t = sides[j];
    return Math.abs(s[0] * t[0] + s[1] * t[1]) <= 1e-9 * lengths[i] * lengths[j];
  }) ? vs : null;
}

/** The grips of an entity: [{ id, kind, x, y }] (empty when it has none). */
export function gripsOf(ent, attMode = 1) {
  if (!gripped(ent)) return [];
  if (ent.type === 'LEADER') return ent.model.pts.map((p, i) => ({ id: 'v' + i, kind: 'vertex', x: p[0], y: p[1] }));
  const r = ent.r;
  if (MOVES[ent.type]) {
    if (ent.type === 'HATCH') { const c = hatchCentre(r); return [{ id: 'c', kind: 'centre', x: c[0], y: c[1] }, ...boundaryGrips(r)]; }
    if (ent.type === 'ELLIPSE') {
      const q = ellipseOf(r), at1 = (t) => [q.c[0] + q.m[0] * Math.cos(t) + q.n[0] * Math.sin(t), q.c[1] + q.m[1] * Math.cos(t) + q.n[1] * Math.sin(t)];
      const ends = [['m0', q.m, 1], ['m1', q.m, -1], ['n0', q.n, 1], ['n1', q.n, -1]].map(([id, v, s]) => ({ id, kind: 'quad', x: q.c[0] + s * v[0], y: q.c[1] + s * v[1] }));
      const arcEnds = q.arc ? [['s', q.t0], ['t', q.t1]].map(([id, t]) => ({ id, kind: 'end', x: at1(t)[0], y: at1(t)[1] })) : [];
      return [{ id: 'c', kind: 'centre', x: q.c[0], y: q.c[1] }, ...ends, ...arcEnds];
    }
    const p = { id: 'i', kind: 'insert', x: get(r, 10) ?? 0, y: get(r, 20) ?? 0 };
    if (ent.type === 'INSERT') return [p, ...attribGrips(ent, attMode)];
    if (ent.type === 'MTEXT') {       // 164a: AutoCAD's width (top right), height (bottom left) and both (bottom right) triangles at the box corners, turned with the text
      const b = mtextFrame(r);
      return b ? [p, ...[['w', b.left + b.W, b.top, 0], ['h', b.left, b.bottom, 90], ['wh', b.left + b.W, b.bottom, 45]].map(([id, x, y, tri]) => ({ id, kind: 'tri', tri: tri - b.rot / DEG, ...b.at(x, y) }))] : [p];       // tri: the screen angle (y down), so a text turned by +a turns it by -a
    }
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
  const vs = lwVertices(r), vertices = vs.map((v, i) => ({ id: 'v' + i, kind: 'vertex', x: v.x, y: v.y })), rect = !!rectangleVertices(r);
  // 163b: a mid grip on every segment (the closing one too); an arc segment's is the top of its arc (chord middle + bulge * (dy, -dx) / 2); a rectangle's resize its side
  const edges = Array.from({ length: segmentCount(r, vs.length) }, (_, j) => {
    const a = vs[j], b = vs[(j + 1) % vs.length];
    return { id: 'e' + j, kind: 'edge', x: (a.x + b.x) / 2 + a.b * (b.y - a.y) / 2, y: (a.y + b.y) / 2 - a.b * (b.x - a.x) / 2, ...(rect ? { rect: true } : {}) };
  });
  return vertices.concat(edges);
}
/** How many segments a polyline of n vertices has (segment j runs from vertex j to j + 1; a closed one has the closing one too); 0 under 2 vertices. */
const segmentCount = (r, n) => (n < 2 ? 0 : (get(r, 70) ?? 0) & 1 ? n : n - 1);

const find = (ent, id) => gripsOf(ent, 2).find((g) => g.id === id) || null;       // 2: every attribute, shown or not (the id is the same either way)

/** Does a Stretch with these hot grips (a Set of ids) move the object whole? Its middle (line) or centre is hot, or every defining grip is (edge grips are derived). */
export function wholeHot(ent, ids) {
  const all = gripsOf(ent), centre = ent.type === 'LINE' ? 'm' : 'c';
  return all.length > 0 && (ids.has(centre) || all.every((x) => x.id === centre || x.kind === 'edge' || ids.has(x.id)));
}

/**
 * 163b: the hot grips [{ id, x, y }] of one object, as a Stretch moves them: a polyline's line-segment mid becomes its two vertices and an arc-segment mid
 * is dropped when one of its ends is hot, so every vertex moves once whatever the hot order (the mid is derived from the vertices).
 */
export function stretchHots(ent, hots) {
  if (ent.type === 'HATCH') {       // 164b2: each boundary path's hot grips go through the polyline rule (as a closed polyline), the ids mapped back
    const by = new Map(), out = hots.filter((x) => !PATH_ID.test(x.id));
    for (const x of hots) { const m = PATH_ID.exec(x.id); if (m) by.set(+m[2], [...(by.get(+m[2]) || []), { ...x, id: m[1] + m[3] }]); }
    for (const [p, list] of by) for (const x of stretchHots(virtOf(hatchPaths(ent.r)[p]), list)) out.push({ ...x, id: x.id[0] + p + '_' + x.id.slice(1) });
    return out;
  }
  if (ent.type !== 'LWPOLYLINE') return hots;
  const all = new Map(gripsOf(ent).map((x) => [x.id, x])), vs = lwVertices(ent.r), moving = new Set(hots.map((x) => x.id)), out = new Map();
  const endsOf = (x) => { const j = +x.id.slice(1); return ['v' + j, 'v' + ((j + 1) % vs.length)]; };
  const plain = (x) => all.get(x.id)?.kind !== 'edge' || all.get(x.id).rect;       // not a segment mid we expand or drop
  for (const x of hots) if (!plain(x) && !vs[+x.id.slice(1)].b) endsOf(x).forEach((id) => moving.add(id));       // every end of a hot line-segment mid, whatever the order
  for (const x of hots) {
    if (plain(x)) out.set(x.id, x);
    else if (!vs[+x.id.slice(1)].b) endsOf(x).forEach((id) => out.set(id, out.get(id) || hots.find((y) => y.id === id) || all.get(id)));
    else if (!endsOf(x).some((id) => moving.has(id))) out.set(x.id, x);
  }
  return [...out.values()];
}

/** The entity moved whole by (dx, dy), drawing units (a leader through its points, the rest the way the Move command does). */
export function translate(ent, dx, dy) {
  if (ent.type === 'LEADER') return { ...ent, model: { ...ent.model, pts: ent.model.pts.map((p) => [p[0] + dx, p[1] + dy]) } };
  if (ent.type === 'HATCH') { const c = find(ent, 'c'); return dragGrip(ent, 'c', [c.x + dx, c.y + dy])?.ent || ent; }       // 164b1: the same path as a lone centre-grip Stretch (ends the association)
  return moveEntities({ entities: [ent], blocks: {} }, new Set([0]), dx, dy).entities[0];
}

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
    const swap = len < minor, big = swap ? { m: [-m[1] * minor / len, m[0] * minor / len], ratio: len / minor } : { m, ratio: minor / len };
    const edits = [[at(r, 11), big.m[0]], [at(r, 21), big.m[1]], [at(r, 40), big.ratio]];
    if (swap && q.arc) edits.push([at(r, 41), (q.t0 - Math.PI / 2 + TAU) % TAU], [at(r, 42), (q.t1 - Math.PI / 2 + TAU) % TAU]);       // the parameters are measured from the major axis, which turned a quarter: the arc stays where it was
    return { ent: withValues(ent, edits), label: 'Ellipse axis' };
  };
  if (id === 'm0' || id === 'm1') return axes(id === 'm0' ? d : [-d[0], -d[1]], b);
  if (id === 'n0' || id === 'n1') return axes(q.m, Math.abs((-d[0] * q.m[1] + d[1] * q.m[0]) / a));
  const t = Math.atan2((d[0] * q.n[0] + d[1] * q.n[1]) / (b * b), (d[0] * q.m[0] + d[1] * q.m[1]) / (a * a));
  return { ent: withValues(ent, [[at(r, id === 's' ? 41 : 42), (t + TAU) % TAU]]), label: 'Ellipse arc' };
}

/** 164a: an attribute's grip dragged: only that ATTRIB moves (its point and, when justified, its alignment point) by the same step; the block and the other attributes stay. */
function dragAttribute(ent, id, g, to) {
  const dx = to[0] - g.x, dy = to[1] - g.y, i = +id.slice(1), k = ent.kids[i];
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return null;
  const edits = [[10, dx], [20, dy], [11, dx], [21, dy]].filter(([code]) => at(k, code) >= 0).map(([code, d]) => [at(k, code), get(k, code) + d]);
  return { ent: { ...ent, kids: ent.kids.map((q, j) => (j === i ? withValues({ r: q }, edits).r : q)) }, label: 'Stretch' };
}
/** The record with the value of group `code` set; a missing one is added right after group `after`. */
function setGroup(ent, code, value, after) {
  const k = at(ent.r, code);
  if (k >= 0) return withValues(ent, [[k, value]]);
  const c = ent.r.c.slice(), v = ent.r.v.slice(), j = at(ent.r, after) + 1;
  c.splice(j, 0, code); v.splice(j, 0, text(value));
  return { ...ent, r: { ...ent.r, c, v } };
}
/**
 * 164a: an MTEXT's width (41), height (46) or both grip dragged to `to`. The edge opposite the grip stays where it is (the insertion point slides for a centre or
 * right attachment); the width never goes below two text heights (drawing.js: narrower than a word does not wrap); the height never below the text's.
 */
function dragMtext(ent, id, to) {
  const b = mtextFrame(ent.r), d = [to[0] - b.p[0], to[1] - b.p[1]], lx = d[0] * b.c + d[1] * b.s, ly = -d[0] * b.s + d[1] * b.c;
  let cur = ent;
  if (id !== 'h') {
    const W = Math.max(lx - b.left, 2 * b.h), slide = b.left + W * b.ha / 2;
    cur = setGroup(cur, 41, W, 40);
    if (Math.abs(slide) > 1e-12) cur = withValues(cur, [[at(cur.r, 10), b.p[0] + slide * b.c], [at(cur.r, 20), b.p[1] + slide * b.s]]);
  }
  if (id !== 'w') { const n = mtextFrame(cur.r); cur = setGroup(cur, 46, Math.max(n.top - ly, n.textH), at(cur.r, 41) >= 0 ? 41 : 40); }
  const a = mtextBox(cur.r);
  return Math.abs(a.W - b.W) < 1e-12 && Math.abs(a.boxH - b.boxH) < 1e-12 ? null : { ent: cur, label: 'Stretch MTEXT' };
}
/** 164a: the unit direction a typed distance on this grip counts along (it grows the box): an MTEXT's width grip to the right, its height grip down; null for any other. */
export function axisOf(ent, id) {
  const b = ent.type === 'MTEXT' && (id === 'w' || id === 'h') && mtextFrame(ent.r);
  return b ? (id === 'w' ? [b.c, b.s] : [b.s, -b.c]) : null;
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
  const r = ent.r, T = ent.type, q = pathGrip(ent, id);
  if (q) return pathBack(ent, q, dragGrip(q.poly, q.vid, to, shift));       // 164b2: a hatch boundary vertex / mid: the path as a polyline
  if (movesWhole(ent, id)) {
    if (dist([g.x, g.y], to) < 1e-12) return null;
    const moved = moveEntities({ entities: [ent], blocks: {} }, new Set([0]), to[0] - g.x, to[1] - g.y).entities[0];
    return { ent: T === 'HATCH' && get(r, 71) === 1 ? withValues(moved, [[at(moved.r, 71), 0]]) : moved, label: 'Move ' + MOVES[T] };       // 164b1: Stretching an associative hatch ends the association
  }
  if (T === 'ELLIPSE') return dragEllipse(ent, id, g, to);
  if (T === 'INSERT') return dragAttribute(ent, id, g, to);
  if (T === 'MTEXT') return dragMtext(ent, id, to);
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
  if (g.kind === 'edge' && !g.rect) {       // 163b: a segment's mid grip: a line segment moves with both ends, an arc segment bends through the pointer, its ends stay
    const vs = lwVertices(r), a = vs[+id.slice(1)], b = vs[(+id.slice(1) + 1) % vs.length];
    if (dist([g.x, g.y], to) < 1e-12) return null;
    if (a.b) { const bulge = bulgeThrough(a, b, to); return bulge && Math.abs(bulge - a.b) > 1e-12 ? { ent: withValues(ent, [[a.kb, bulge]]), label: 'Arc bulge' } : null; }
    const dx = to[0] - g.x, dy = to[1] - g.y;
    return { ent: withValues(ent, [[a.kx, a.x + dx], [a.ky, a.y + dy], [b.kx, b.x + dx], [b.ky, b.y + dy]]), label: 'Stretch polyline' };
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

/** 163a Grip options: what the list on a grip offers (first = Stretch, the plain grip run); [] when the grip has no list (line middle, circle, arc centre ...). */
export function optionsOf(ent, id) {
  if (isHatch(ent) && id === 'c' && find(ent, id)) return ['Stretch', 'Origin Point', 'Hatch Angle', 'Hatch Scale'];       // 164b1: solid and gradient too
  const q = pathGrip(ent, id);
  if (q) return find(ent, id) ? optionsOf(q.poly, q.vid) : [];       // 164b2: a hatch boundary grip offers its polyline's list
  if (!ent || !ent.r || !hasGrips(ent)) return [];
  if ((ent.type === 'LINE' || ent.type === 'ARC') && (id === 'a' || id === 'b')) return ['Stretch', 'Lengthen'];
  if (ent.type === 'LWPOLYLINE' && find(ent, id)) {       // 163b: a vertex Stretch / Insert vertex / Remove vertex; a segment mid Stretch / Insert vertex / Convert to Arc (a line) or Line (an arc)
    const vs = lwVertices(ent.r), i = +id.slice(1);
    if (id[0] === 'v') return ['Stretch', 'Insert vertex', ...(vs.length - 1 >= minVertices(ent.r) ? ['Remove vertex'] : [])];
    return ['Stretch', 'Insert vertex', vs[i].b ? 'Convert to Line' : 'Convert to Arc'];
  }
  return ent.type === 'ARC' && id === 'm' ? ['Stretch', 'Radius'] : [];
}
const minVertices = (r) => ((get(r, 70) ?? 0) & 1 ? 3 : 2);       // fewer would leave no segment (open) or no area (closed)
/** Options that apply the moment they are picked (no point to ask for, and Ctrl skips them). */
export const IMMEDIATE = new Set(['Remove vertex', 'Convert to Line']);
/** Is grip `id` a rectangle's side (it resizes the rectangle) rather than a polyline segment's middle? */
export const isRectEdge = (ent, id) => !!find(ent, id)?.rect;
/** AutoCAD's prompt of an option (as tested 2027): the arc asks for "end point of arc". */
export const optionPrompt = (ent, name) => ({
  Radius: 'Specify radius:', 'Insert vertex': 'Specify new vertex point:', 'Convert to Arc': 'Specify midpoint of arc segment:',
  'Remove vertex': 'Pick to remove vertex:', 'Convert to Line': 'Pick to convert to line segment:',
  'Origin Point': 'Specify origin point:', 'Hatch Angle': 'Specify hatch angle:', 'Hatch Scale': 'Specify hatch scale:',
}[name] || (ent.type === 'ARC' ? 'Specify end point of arc:' : 'Specify end point:'));

// ---- 163b polyline edits: pure, each returns { ent, label } or null (refused, nothing to do) ----
/** The record split into its header and one group per vertex (10, 20, 40, 41, 42, 91 belong to a vertex; copies, so they can be changed). */
function splitPoly(r) {
  const head = { c: [], v: [] }, vs = [];
  for (let k = 0; k < r.c.length; k++) {
    const c = r.c[k];
    if (c === 10) { if (!vs.length) head.at = head.c.length; vs.push({ c: [], v: [] }); }       // head.at: where the vertices sit among the other groups
    const t = vs.length && [10, 20, 40, 41, 42, 91].includes(c) ? vs[vs.length - 1] : head;
    t.c.push(c); t.v.push(r.v[k]);
  }
  return { head, vs };
}
/** The entity with these vertex groups (and the vertex count in code 90). */
function joinPoly(ent, head, vs) {
  const c = head.c.slice(), v = head.v.slice(), k = c.indexOf(90);
  if (k >= 0) v[k] = String(vs.length);
  const pos = head.at ?? c.length;       // the vertices go back where they were (a code 210 after them stays after them)
  c.splice(pos, 0, ...vs.flatMap((x) => x.c)); v.splice(pos, 0, ...vs.flatMap((x) => x.v));
  return { ...ent, r: { ...ent.r, c, v } };
}
function setBulge(group, b) {
  const k = group.c.indexOf(42);
  if (k >= 0) group.v[k] = text(b); else if (b) { group.c.push(42); group.v.push(text(b)); }
}
/** The bulge of the arc from vertex a to vertex b through the point p (0 when p is on the chord's line). */
const bulgeThrough = (a, b, p) => bulgeOf3([a.x, a.y], p, [b.x, b.y]);
const segmentOK = (ent, j) => ent && ent.type === 'LWPOLYLINE' && hasGrips(ent) && Number.isInteger(j) && j >= 0 && j < segmentCount(ent.r, lwVertices(ent.r).length);

/** Insert vertex: a new vertex at `to` after vertex `after` (a vertex grip), or into segment `after` (a segment grip): the same place. The split segment's halves are straight. Refused on a neighbour's spot. */
export function insertVertex(ent, after, to) {
  if (!ent || ent.type !== 'LWPOLYLINE' || !hasGrips(ent) || !to || !to.every(Number.isFinite)) return null;
  const ps = lwVertices(ent.r), n = ps.length;
  if (!Number.isInteger(after) || after < 0 || after >= n) return null;
  const next = (get(ent.r, 70) ?? 0) & 1 || after < n - 1 ? ps[(after + 1) % n] : null;
  if ([ps[after], next].some((p) => p && dist([p.x, p.y], to) < 1e-9)) return null;
  const { head, vs } = splitPoly(ent.r), fresh = { c: vs[after].c.slice(), v: vs[after].v.slice() };
  const id = fresh.c.indexOf(91); if (id >= 0) { fresh.c.splice(id, 1); fresh.v.splice(id, 1); }       // a copied vertex ID would be a second one
  fresh.v[fresh.c.indexOf(10)] = text(to[0]); fresh.v[fresh.c.indexOf(20)] = text(to[1]);
  setBulge(fresh, 0); setBulge(vs[after], 0);
  vs.splice(after + 1, 0, fresh);
  return { ent: joinPoly(ent, head, vs), label: 'Insert vertex' };
}
/** Remove vertex i; the segment that joins its neighbours is straight. Refused when fewer than 2 (open) or 3 (closed) vertices would be left. */
export function removeVertex(ent, i) {
  if (!ent || ent.type !== 'LWPOLYLINE' || !hasGrips(ent)) return null;
  const n = lwVertices(ent.r).length;
  if (!Number.isInteger(i) || i < 0 || i >= n || n - 1 < minVertices(ent.r)) return null;
  const { head, vs } = splitPoly(ent.r), prev = (get(ent.r, 70) ?? 0) & 1 ? (i + n - 1) % n : i - 1;
  if (prev >= 0) setBulge(vs[prev], 0);
  vs.splice(i, 1);
  return { ent: joinPoly(ent, head, vs), label: 'Remove vertex' };
}
/** Convert to Line: segment j straight (refused when it is a line already). */
export function convertToLine(ent, j) {
  if (!segmentOK(ent, j) || !lwVertices(ent.r)[j].b) return null;
  const { head, vs } = splitPoly(ent.r);
  setBulge(vs[j], 0);
  return { ent: joinPoly(ent, head, vs), label: 'Convert to Line' };
}
/** Convert to Arc: segment j becomes the arc through the point `to`; refused for a point on the chord's line (no arc). */
export function convertToArc(ent, j, to) {
  if (!segmentOK(ent, j) || !to || !to.every(Number.isFinite)) return null;
  const ps = lwVertices(ent.r), bulge = bulgeThrough(ps[j], ps[(j + 1) % ps.length], to);
  if (!bulge || !Number.isFinite(bulge)) return null;
  const { head, vs } = splitPoly(ent.r);
  setBulge(vs[j], bulge);
  return { ent: joinPoly(ent, head, vs), label: 'Convert to Arc' };
}
/** An option that applies at once (IMMEDIATE): the grip's own vertex or segment. */
export function applyOption(ent, id, name) {
  const q = pathGrip(ent, id);       // 164b2: a hatch boundary grip works on its path as a polyline
  return q ? pathBack(ent, q, applyOption(q.poly, q.vid, name)) : applyPlain(ent, id, name);
}
const applyPlain = (ent, id, name) => (name === 'Remove vertex' ? removeVertex(ent, +id.slice(1)) : name === 'Convert to Line' ? convertToLine(ent, +id.slice(1)) : null);
const wrap360 = (t) => ((t % 360) + 360) % 360;
/**
 * Lengthen: a line's end grip moved along the line's own direction, or an arc's end along the arc. `how`: { to } the pointer ([x, y]), { add } a typed
 * distance ADDED to the line, { deg } a typed arc-end angle (degrees; the start grip mirrors it, AutoCAD). A new line length of 0 or less (the pointer
 * behind the fixed end) is refused (null), as is an arc whose ends would meet; an unchanged shape is null too.
 */
export function lengthen(ent, id, how) {
  if (!optionsOf(ent, id).includes('Lengthen')) return null;
  const r = ent.r;
  if (ent.type === 'LINE') {
    const ends = { a: [get(r, 10) ?? 0, get(r, 20) ?? 0], b: [get(r, 11) ?? 0, get(r, 21) ?? 0] }, fixed = ends[id === 'a' ? 'b' : 'a'], moving = ends[id], len = dist(fixed, moving);
    if (!(len > 1e-9)) return null;
    const u = [(moving[0] - fixed[0]) / len, (moving[1] - fixed[1]) / len], now = how.add != null ? len + how.add : (how.to[0] - fixed[0]) * u[0] + (how.to[1] - fixed[1]) * u[1];
    if (!Number.isFinite(now) || !(now > 1e-9) || Math.abs(now - len) < 1e-12) return null;
    const p = [fixed[0] + u[0] * now, fixed[1] + u[1] * now];
    return { ent: withValues(ent, id === 'a' ? [[at(r, 10), p[0]], [at(r, 20), p[1]]] : [[at(r, 11), p[0]], [at(r, 21), p[1]]]), label: 'Lengthen' };
  }
  const a = arcOf(r), deg = how.deg != null ? (id === 'a' ? -how.deg : how.deg) : angleOf(a.c, how.to), v = wrap360(deg), other = id === 'a' ? a.a1 : a.a0;
  if (!Number.isFinite(v) || Math.abs(v - wrap360(id === 'a' ? a.a0 : a.a1)) < 1e-9 || Math.abs(wrap360(v - other)) < 1e-9 || 360 - Math.abs(wrap360(v - other)) < 1e-9) return null;
  return { ent: withValues(ent, [[at(r, id === 'a' ? 50 : 51), v]]), label: 'Lengthen' };
}
/** Radius: the arc's middle grip sets the radius (the centre and the end angles stay, so the ends move radially); null when it is 0, negative or the same. */
export function setRadius(ent, rad) {
  if (!optionsOf(ent, 'm').includes('Radius') || !Number.isFinite(rad) || !(rad > 1e-9) || Math.abs(rad - (get(ent.r, 40) ?? 0)) < 1e-12) return null;
  return { ent: withValues(ent, [[at(ent.r, 40), rad]]), label: 'Radius' };
}

// ---- 164b1 HATCH centre Grip options: the pattern is stored already turned and scaled (53 angle, 43/44 base, 45/46 offset, 49 dashes per line; 52 / 41 the totals) ----
/** The indices of a HATCH's pattern lines: [{ a, bx, by, ox, oy, d: [dash indices] }] (-1 for a group the line lacks). */
function patternOf(r) {
  const out = [], k78 = at(r, 78);
  if (k78 < 0) return out;
  for (let k = k78 + 1; k < r.c.length && r.c[k] === 53;) {
    const q = { a: k++, bx: -1, by: -1, ox: -1, oy: -1, d: [] };
    for (; k < r.c.length && [43, 44, 45, 46, 79, 49].includes(r.c[k]); k++) { if (r.c[k] === 49) q.d.push(k); else { const f = { 43: 'bx', 44: 'by', 45: 'ox', 46: 'oy' }[r.c[k]]; if (f) q[f] = k; } }
    out.push(q);
  }
  return out;
}
/** The record with group `code` (52 or 41) set; a missing one goes in before 77 / 78 / 98 (AutoCAD's order: 76, 52, 41, 77, 78), else at the end. */
function setHeadGroup(ent, code, value) {
  const k = at(ent.r, code);
  if (k >= 0) return withValues(ent, [[k, value]]);
  const c = ent.r.c.slice(), v = ent.r.v.slice(), at0 = [77, 78, 98].map((x) => c.indexOf(x)).find((x) => x >= 0) ?? c.length;
  c.splice(at0, 0, code); v.splice(at0, 0, text(value));
  return { ...ent, r: { ...ent.r, c, v } };
}
/** Every pattern line through fn({ a, b: [x, y], o: [x, y], d: [dashes] }) → the same shape; `origin` is the first line's base. Returns the record with the new numbers. */
function mapPattern(ent, fn) {
  const r = ent.r, L = patternOf(r), val = (k) => (k >= 0 ? num(r.v[k]) : 0), edits = [];
  const first = L.length ? [val(L[0].bx), val(L[0].by)] : [0, 0];
  for (const q of L) {
    const n = fn({ a: val(q.a), b: [val(q.bx), val(q.by)], o: [val(q.ox), val(q.oy)], d: q.d.map(val) }, first);
    edits.push([q.a, n.a]);
    [[q.bx, n.b[0]], [q.by, n.b[1]], [q.ox, n.o[0]], [q.oy, n.o[1]]].forEach(([k, x]) => k >= 0 && edits.push([k, x]));
    q.d.forEach((k, i) => edits.push([k, n.d[i]]));
  }
  return withValues(ent, edits);
}
const isHatch = (ent) => !!ent && ent.type === 'HATCH' && !!ent.r && upright(ent.r);
/** Hatch Angle: the new TOTAL angle (degrees, typed or the direction centre → pointer); every pattern line turns by the change about the pattern origin. Null when unchanged. */
export function hatchAngle(ent, deg) {
  if (!isHatch(ent) || !Number.isFinite(deg)) return null;
  const old = get(ent.r, 52) ?? 0, to = wrap360(deg), t = (to - old) * DEG, c = Math.cos(t), s = Math.sin(t);
  if (Math.abs(wrap360(to - old + 180) - 180) < 1e-9) return null;
  const turn = (p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  const next = mapPattern(ent, (q, o) => { const b = turn([q.b[0] - o[0], q.b[1] - o[1]]); return { a: q.a + to - old, b: [o[0] + b[0], o[1] + b[1]], o: turn(q.o), d: q.d }; });
  return { ent: setHeadGroup(next, 52, to), label: 'Hatch Angle' };
}
/** Hatch Scale: the new TOTAL scale (typed, or the distance centre → pointer in drawing units); base, offset and dashes of every line scale by new / old about the pattern origin. Refused at 0 or less, or unchanged. */
export function hatchScale(ent, to) {
  if (!isHatch(ent) || !Number.isFinite(to) || !(to > 1e-9)) return null;
  const old = get(ent.r, 41) ?? 1, f = to / (old > 0 ? old : 1);
  if (Math.abs(to - old) < 1e-12) return null;
  const next = mapPattern(ent, (q, o) => ({ a: q.a, b: [o[0] + (q.b[0] - o[0]) * f, o[1] + (q.b[1] - o[1]) * f], o: [q.o[0] * f, q.o[1] * f], d: q.d.map((x) => x * f) }));
  return { ent: setHeadGroup(next, 41, to), label: 'Hatch Scale' };
}
/** Origin Point: every line's base moves by (point - the first line's base) so the pattern passes through the point. Null when the hatch has no pattern lines (solid) or the origin is there already. */
export function hatchOrigin(ent, to) {
  if (!isHatch(ent) || !to || !to.every(Number.isFinite)) return null;
  const L = patternOf(ent.r);
  if (!L.length || L[0].bx < 0 || L[0].by < 0) return null;
  const dx = to[0] - num(ent.r.v[L[0].bx]), dy = to[1] - num(ent.r.v[L[0].by]);
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return null;
  return { ent: mapPattern(ent, (q) => ({ ...q, b: [q.b[0] + dx, q.b[1] + dy] })), label: 'Origin Point' };
}
// ---- 164b2 HATCH boundary grips (group 71 = 0): a path of lines / arcs becomes a closed polyline (vertices + bulges), is edited by the 163b functions and written back ----
const PATH_ID = /^([ve])(\d+)_(\d+)$/;       // 'v2_5' / 'e2_5': vertex / segment mid 5 of boundary path 2 ('c' is the centre)
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-6 * Math.max(1, Math.abs(b[0]), Math.abs(b[1]));
const wrapTau = (t) => ((t % TAU) + TAU) % TAU;
/**
 * A HATCH's boundary paths in file order: [{ ok, poly, closed, pts: [{ x, y, b }], from, to }]. pts = the vertices with the bulge of the segment to the next one; ok = made only of
 * lines and arcs, joined end to start (polyline path, or edge path of line / arc edges); from .. to = the record's groups to rewrite. Arcs follow drawing.js hatch() (cw: angles negated).
 */
function hatchPaths(r) {
  const c = r.c, v = r.v, n = c.length, out = [];
  let k = c.indexOf(91);
  if (k < 0) return out;
  const loops = num(v[k++]);
  for (let q = 0; q < loops; q++) {
    while (k < n && c[k] !== 92) k++;
    if (k >= n) break;
    const P = { ok: false, poly: !!(num(v[k]) & 2), closed: 1, pts: [], from: ++k, to: k };
    out.push(P);
    if (P.poly) {
      let bulge = false, cnt = 0;
      while (k < n && c[k] !== 10 && c[k] !== 92) { if (c[k] === 72) bulge = num(v[k]) === 1; else if (c[k] === 73) P.closed = num(v[k]); else if (c[k] === 93) cnt = num(v[k]); k++; }
      for (let i = 0; i < cnt && c[k] === 10 && c[k + 1] === 20; i++) { P.pts.push({ x: num(v[k]), y: num(v[k + 1]), b: 0 }); k += 2; if (bulge && c[k] === 42) P.pts[i].b = num(v[k++]); }
      P.to = k; P.ok = cnt >= 2 && P.pts.length === cnt;
      continue;
    }
    while (k < n && c[k] !== 93 && c[k] !== 92) k++;
    if (c[k] !== 93) continue;
    const cnt = num(v[k++]);
    let ok = cnt >= 2, prev = null;
    for (let i = 0; i < cnt && ok; i++) {
      const t = c[k] === 72 ? num(v[k++]) : 0, want = t === 1 ? [10, 20, 11, 21] : t === 2 ? [10, 20, 40, 50, 51] : null;       // anything else (ellipse, spline): no grips
      if (!want || want.some((code, j) => c[k + j] !== code)) { ok = false; break; }
      const f = want.map((_, j) => num(v[k + j])); k += want.length;
      let a = [f[0], f[1]], b = [f[2], f[3]], bu = 0;
      if (t === 2) {
        const ccw = c[k] === 73 ? num(v[k++]) !== 0 : true, a0 = (ccw ? f[3] : -f[3]) * DEG, a1 = (ccw ? f[4] : -f[4]) * DEG, sweep = ccw ? wrapTau(a1 - a0) : -wrapTau(a0 - a1);
        if (!sweepOK(sweep)) { ok = false; break; }       // a full circle: not a segment
        a = [f[0] + f[2] * Math.cos(a0), f[1] + f[2] * Math.sin(a0)]; b = [f[0] + f[2] * Math.cos(a1), f[1] + f[2] * Math.sin(a1)]; bu = Math.tan(sweep / 4);
      }
      if (prev && !near(prev, a)) ok = false;
      prev = b; P.pts.push({ x: a[0], y: a[1], b: bu });
      if (i === cnt - 1 && !near(b, [P.pts[0].x, P.pts[0].y])) ok = false;
    }
    P.ok = ok; P.to = k;
  }
  return out;
}
/** A path as an LWPOLYLINE record (closed; noRect: a square boundary is not a rectangle to resize). */
const virtOf = (P) => ({ type: 'LWPOLYLINE', r: { noRect: true, c: [70, 90, ...P.pts.flatMap(() => [10, 20, 42])], v: ['1', String(P.pts.length), ...P.pts.flatMap((p) => [text(p.x), text(p.y), text(p.b)])] } });
/** The hatch with path P rewritten from the polyline `poly`: a polyline path keeps its kind (bulges only when one is curved); an edge path becomes lines (72 = 1) and arcs (72 = 2 centre, radius, angles, 73 ccw), group 93 counts them. */
function putPath(ent, P, poly) {
  const vs = lwVertices(poly.r), n = vs.length, curved = vs.some((x) => Math.abs(x.b) > 1e-12), g = [];
  if (P.poly) {
    g.push([72, +curved], [73, P.closed], [93, n]);
    for (const x of vs) g.push([10, text(x.x)], [20, text(x.y)], ...(curved ? [[42, text(x.b)]] : []));
  } else {
    g.push([93, n]);
    vs.forEach((a, j) => {
      const b = vs[(j + 1) % n];
      if (Math.abs(a.b) <= 1e-12) { g.push([72, 1], [10, text(a.x)], [20, text(a.y)], [11, text(b.x)], [21, text(b.y)]); return; }
      const d = Math.hypot(b.x - a.x, b.y - a.y), off = d / 2 * (1 - a.b * a.b) / (2 * a.b), cx = (a.x + b.x) / 2 - (b.y - a.y) / d * off, cy = (a.y + b.y) / 2 + (b.x - a.x) / d * off;
      const ccw = a.b > 0, t0 = Math.atan2(a.y - cy, a.x - cx) / DEG, t1 = Math.atan2(b.y - cy, b.x - cx) / DEG;
      g.push([72, 2], [10, text(cx)], [20, text(cy)], [40, text(Math.hypot(a.x - cx, a.y - cy))], [50, text(wrap360(ccw ? t0 : -t0))], [51, text(wrap360(ccw ? t1 : -t1))], [73, +ccw]);
    });
  }
  const c = ent.r.c.slice(), v = ent.r.v.slice();
  c.splice(P.from, P.to - P.from, ...g.map((x) => x[0])); v.splice(P.from, P.to - P.from, ...g.map((x) => String(x[1])));
  return { ...ent, r: { ...ent.r, c, v } };
}
/** Boundary grip `id` of a hatch as { P, poly: its path as a polyline, vid: the polyline's grip id }, or null (not a boundary grip, or its path has an ellipse / spline edge). */
function pathGrip(ent, id) {
  const m = ent && ent.type === 'HATCH' && PATH_ID.exec(id), P = m && hatchPaths(ent.r)[+m[2]];
  return P && P.ok ? { P, poly: virtOf(P), vid: m[1] + m[3] } : null;
}
/** The result of a polyline edit `res` ({ ent, label } or null) written back into the hatch. */
const pathBack = (ent, q, res) => res && { ...res, ent: putPath(ent, q.P, res.ent) };
/** The boundary grips of a non-associative hatch (71 = 0), ids 'v<path>_<n>' / 'e<path>_<n>'; none for 71 = 1 or missing. */
const boundaryGrips = (r) => (get(r, 71) === 0 ? hatchPaths(r).flatMap((P, p) => (P.ok ? gripsOf(virtOf(P)).map((x) => ({ id: x.id[0] + p + '_' + x.id.slice(1), kind: x.kind, x: x.x, y: x.y })) : [])) : []);
/** The option `name` with the pointer at `to` (drawing units). */
export const dragOption = (ent, id, name, to) => {
  const q = pathGrip(ent, id);
  if (q) return pathBack(ent, q, dragOption(q.poly, q.vid, name, to));
  if (isHatch(ent)) { const c = find(ent, 'c'); return name === 'Origin Point' ? hatchOrigin(ent, to) : name === 'Hatch Angle' ? hatchAngle(ent, angleOf([c.x, c.y], to)) : hatchScale(ent, dist([c.x, c.y], to)); }
  return name === 'Radius' ? setRadius(ent, dist(arcOf(ent.r).c, to)) : name === 'Insert vertex' ? insertVertex(ent, +id.slice(1), to) : name === 'Convert to Arc' ? convertToArc(ent, +id.slice(1), to) : lengthen(ent, id, { to });
};
/** The option `name` with a typed number: Radius the radius, Lengthen on a line the distance added (both drawing units), on an arc the end angle in degrees; a hatch's Angle (degrees) and Scale are totals. */
export const typedOption = (ent, id, name, v) => (name === 'Radius' ? setRadius(ent, v) : name === 'Hatch Angle' ? hatchAngle(ent, v) : name === 'Hatch Scale' ? hatchScale(ent, v) : lengthen(ent, id, ent.type === 'ARC' ? { deg: v } : { add: v }));

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
  if (ent.type === 'MTEXT' && id !== 'i') { const b = mtextBox(next.r); return id === 'w' ? `Width ${n2(b.W * f)} mm` : id === 'h' ? `Height ${n2(b.boxH * f)} mm` : `Width ${n2(b.W * f)} · Height ${n2(b.boxH * f)} mm`; }
  const m = ent.type === 'HATCH' && PATH_ID.exec(id);       // 164b2: a boundary grip reads as its path's polyline does
  if (m) return readoutOf(virtOf(hatchPaths(ent.r)[+m[2]]), m[1] + m[3], virtOf(hatchPaths(next.r)[+m[2]]), f);
  if (ent.type === 'HATCH') {       // 164b1: an option's result; Stretch (the centre moved) reads as a Move
    const a = get(next.r, 52) ?? 0, s = get(next.r, 41) ?? 1, p = patternOf(next.r)[0], b = p && p.bx >= 0 && p.by >= 0 ? [num(next.r.v[p.bx]), num(next.r.v[p.by])] : null;
    if (a !== (get(ent.r, 52) ?? 0)) return `Angle ${n2(a)}°`;
    if (s !== (get(ent.r, 41) ?? 1)) return `Scale ${n2(s)}`;
    if (Math.hypot(find(next, id).x - g.x, find(next, id).y - g.y) < 1e-12 && b) return `Origin X ${n2(b[0] * f)} · Y ${n2(b[1] * f)}`;
  }
  if (ent.type === 'LWPOLYLINE' && lwVertices(next.r).length !== lwVertices(ent.r).length) return `${lwVertices(next.r).length} vertices`;       // Insert / Remove vertex
  if (ent.type === 'LWPOLYLINE' || ent.type === 'LEADER') { const n = find(next, id); return `X ${n2(n.x * f)} · Y ${n2(n.y * f)}`; }
  const n = find(next, id);
  return `Move ΔX ${n2((n.x - g.x) * f)} ΔY ${n2((n.y - g.y) * f)}`;
}

/** The name of the command line's word for dragging this grip. */
export const commandOf = (ent, id) => (movesWhole(ent, id) ? 'MOVE' : ent.type === 'LINE' ? (id === 'm' ? 'MOVE' : 'STRETCH') : ent.type === 'CIRCLE' ? (id === 'c' ? 'MOVE' : 'STRETCH') : ent.type === 'ARC' ? (id === 'c' ? 'MOVE' : 'STRETCH') : 'STRETCH');
