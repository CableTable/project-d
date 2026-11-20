// draw.js — the drawing tools, pure (no DOM, no files): draw.test.mjs.
//
// Everything here works in mm, y up (the numbers he types and the status bar's X / Y). The app converts a picked point from drawing
// units to mm before it gives it to a tool, and a made shape back with toEntity().
//
//   createTool(kind, cfg)      → a tool: line, polyline, rect, rrect, circle, ellipse or arc (cfg: { radius } for rrect)
//   toolClick(T, p)            → a point picked (already snapped); toolHover(T, p) the rubber band follows the pointer
//   toolType(T, text)          → what was typed in the command line (Enter alone = ''): AutoCAD's own: "x,y", "@dx,dy", "@len<ang",
//                                 a length while the rubber band points the way, and the words Close, Undo, D, R
//   toolFinish(T)              → Enter / Esc / right-click: ends a line or polyline; cancels the others' shape in progress
//   toolPreview(T)             → { shapes, guides, readout, at } for the live preview
//   toolPrompt(T)              → { status, prompt } for the command line
//   Each action gives { made: [shape] | null, msg }: made shapes become ONE labelled undo step (LABELS[kind]).
//   A shape: { t: 'line', a, b } | { t: 'poly', pts: [[x, y, bulge]], closed } | { t: 'circle', c, r } | { t: 'arc', c, r, a0, a1 }
//            | { t: 'ellipse', c, m: [mx, my], ratio }     (arc angles in degrees, anticlockwise from +X, drawn from a0 to a1)
//   toEntity(shape, o, factor) → the DXF entity record (dxf-write.js); svgPath(shape, H) → an SVG path for the preview.
import { line, lwpoly, circle, arc, ellipse } from './dxf-write.js';
import { tangentCircle } from './tangent.js';

export const KINDS = ['line', 'polyline', 'rect', 'rrect', 'circle', 'ellipse', 'arc'];
export const LABELS = { line: 'Line', polyline: 'Polyline', rect: 'Rectangle', rrect: 'Rounded rectangle', circle: 'Circle', ellipse: 'Ellipse', arc: 'Arc' };
const DEG = 180 / Math.PI;

// ---------------------------------------------------------------- numbers

/** 2 decimals, no "-0". */
export const n2 = (v) => { const s = Number(v).toFixed(2); return /^-0\.00$/.test(s) ? '0.00' : s; };
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** The angle of a → b in degrees, anticlockwise from +X, 0 ≤ angle < 360. */
export function angleOf(a, b) {
  let t = Math.atan2(b[1] - a[1], b[0] - a[0]) * DEG;
  if (t < 0) t += 360;
  if (t >= 360 - 1e-9) t = 0;
  return Math.abs(b[0] - a[0]) < 1e-12 && Math.abs(b[1] - a[1]) < 1e-12 ? 0 : t;
}
const norm360 = (t) => { t %= 360; if (t < 0) t += 360; return t >= 360 - 1e-9 ? 0 : t; };

/** Dynamic input cursor fields: points in mm, Y up; fixed decimals, without negative zero or 360°. */
export function dynamicInput(a, b, dp, unit = 'mm') {
  const fixed = (v) => { const s = v.toFixed(dp); return +s === 0 ? (0).toFixed(dp) : s; };
  const length = (v) => formatLength(v, unit, fixed) + (unit === 'mm' ? ' mm' : '');
  return {
    length: length(dist(a, b)),
    angle: fixed(+angleOf(a, b).toFixed(dp) % 360) + '°',
    dx: length(b[0] - a[0]),
    dy: length(b[1] - a[1]),
  };
}

/** Screen pixels, Y down: dimension guides and the centres of their cursor fields. */
export function dynamicInputPlacement(a, b, { w, h }, boxes, kind = 'segment') {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (len < 40) return null;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const clamp = (p, size) => p.map((v, i) => Math.max(4 + size[i] / 2, Math.min(v, [w, h][i] - 4 - size[i] / 2)));
  if (kind === 'circle') return { length: clamp(mid, boxes.length), line: [a, b], extensions: [] };
  if (kind === 'rect' || kind === 'rrect') {
    const top = Math.min(a[1], b[1]), side = dx < 0 ? -1 : 1, x = b[0] + side * 24;
    const line = Math.abs(dx) >= 40 ? [[a[0], top - 24], [b[0], top - 24]] : null;
    const heightLine = Math.abs(dy) >= 40 ? [[x, a[1]], [x, b[1]]] : null;
    if (!line && !heightLine) return null;
    return {
      length: line && clamp([mid[0], top - 24], boxes.length),
      angle: heightLine && clamp([x, mid[1]], boxes.angle),
      line, heightLine,
      extensions: [
        ...(line ? [a[0], b[0]].map((x) => [[x, top], [x, top - 30]]) : []),
        ...(heightLine ? [a[1], b[1]].map((y) => [[b[0], y], [x + side * 6, y]]) : []),
      ],
    };
  }
  const normal = [dy / len, -dx / len];
  const inside = (p, size) => p[0] - size[0] / 2 >= 4 && p[0] + size[0] / 2 <= w - 4 && p[1] - size[1] / 2 >= 4 && p[1] + size[1] / 2 <= h - 4;
  const offset = (p, n) => [p[0] + normal[0] * n, p[1] + normal[1] * n];
  if (kind === 'tag') {                                      // Measure tag: its near edge 24 px off the line (the box reaches half its extent along the normal further), on the side with room
    const gap = 24 + (Math.abs(normal[0]) * boxes.length[0] + Math.abs(normal[1]) * boxes.length[1]) / 2;
    return { length: clamp(offset(mid, inside(offset(mid, gap), boxes.length) ? gap : -gap), boxes.length) };
  }
  const side =[a, b].every((p) => inside(offset(p, 24), [0, 0])) && inside(offset(mid, 24), boxes.length) ? 1 : -1;
  const radius = Math.max(30, Math.min(120, len * .4)), angle = angleOf([0, 0], [dx, -dy]) / DEG;
  const length = clamp(offset(mid, 24 * side), boxes.length);
  let at = clamp([a[0] + radius * Math.cos(angle / 2), a[1] - radius * Math.sin(angle / 2)], boxes.angle);
  const reach = [0, 1].map((i) => (boxes.length[i] + boxes.angle[i]) / 2 + 4), covers = (p) => [0, 1].every((i) => Math.abs(p[i] - length[i]) < reach[i] - 1e-9);
  if (covers(at)) {                                          // the Angle box moves the shortest way clear of the Length box (4 px gap), still on screen
    const moves = [0, 1].flatMap((i) => [-1, 1].map((s) => clamp(at.map((v, j) => j === i ? length[i] + s * reach[i] : v), boxes.angle)));
    at = moves.filter((p) => !covers(p)).sort((p, q) => Math.hypot(p[0] - at[0], p[1] - at[1]) - Math.hypot(q[0] - at[0], q[1] - at[1]))[0] || at;
  }
  return {
    length, angle: at,
    line: [offset(a, 24 * side), offset(b, 24 * side)],
    extensions: [[a, offset(a, 30 * side)], [b, offset(b, 30 * side)]],
    arc: { c: a, radius, angle, end: [a[0] + dx / len * radius, a[1] + dy / len * radius] },
  };
}

// ---------------------------------------------------------------- typed input

import { parse as parseLength, parseCoordinate, format as formatLength } from './units.js';
const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)';
const RE_PT = /^([@#]?)\s*([^,]+),\s*([^,]+)$/;
const RE_POLAR = new RegExp(`^([@#]?)\\s*(.+)\\s*<\\s*(${NUM})$`);

/**
 * What was typed → { kind: 'enter' } | { kind: 'xy', rel, abs, x, y } | { kind: 'polar', rel, abs, len, ang } | { kind: 'len', v } | { kind: 'word', w } | { kind: 'bad' }.
 * "x,y" or "#x,y" is absolute, "@dx,dy" relative to the last point; "len<ang" (also with #) is polar from the origin, "@len<ang" from the last point; a bare
 * number is a length (direct distance entry); letters are an option word (lower case).
 */
export function parseInput(text, unit = 'mm') {
  const t = String(text == null ? '' : text).trim();
  if (!t) return { kind: 'enter' };
  let m = RE_PT.exec(t);
  if (m) {
    const x = parseCoordinate(m[2], unit), y = parseCoordinate(m[3], unit);
    return x !== null && y !== null ? { kind: 'xy', rel: m[1] === '@', abs: m[1] === '#', x, y } : { kind: 'bad' };
  }
  if (t.includes(',')) return { kind: 'bad' };
  m = RE_POLAR.exec(t);
  if (m) {
    const len = parseCoordinate(m[2], unit);
    return len !== null && Number.isFinite(+m[3]) ? { kind: 'polar', rel: m[1] === '@', abs: m[1] === '#', len, ang: +m[3] } : { kind: 'bad' };
  }
  const v = parseLength(t, unit);
  if (v !== null) return { kind: 'len', v };
  if (/^[23]p$/i.test(t) || /^[a-z]+$/i.test(t) || /^[a-z]+\s+/i.test(t) && parseLength(t.replace(/^[a-z]+\s+/i, ''), unit) !== null) return { kind: 'word', w: t.toLowerCase() };
  return { kind: 'bad' };
}

/** A typed point (xy or polar) → [x, y] given the last point (null = the origin). */
export function typedPoint(inp, last) {
  const o = last || [0, 0];
  let p = null;
  if (inp.kind === 'xy') p = inp.rel ? [o[0] + inp.x, o[1] + inp.y] : [inp.x, inp.y];
  if (inp.kind === 'polar') {
    const dx = inp.len * Math.cos(inp.ang / DEG), dy = inp.len * Math.sin(inp.ang / DEG);
    p = inp.rel ? [o[0] + dx, o[1] + dy] : [dx, dy];
  }
  return p && p.every(Number.isFinite) ? p : null;
}

/** Direct distance entry: the point `len` from `from` on the way to `toward` (the rubber band's direction), or null when it points nowhere. */
export function directDistance(from, toward, len) {
  if (!from || !toward) return null;
  const d = dist(from, toward);
  if (d < 1e-9) return null;
  return [from[0] + (toward[0] - from[0]) / d * len, from[1] + (toward[1] - from[1]) / d * len];
}

// ---------------------------------------------------------------- geometry

/**
 * The arc through three points p1 → p2 → p3 (p2 on the arc): { c: [x, y], r, a0, a1 } drawn anticlockwise from a0 to a1 (degrees, 0 ≤ a < 360),
 * which may swap the ends when the points run clockwise. null when they lie in a line (or two are the same).
 */
export function arcThrough3(p1, p2, p3) {
  const ax = p1[0], ay = p1[1], bx = p2[0], by = p2[1], cx = p3[0], cy = p3[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const scale = Math.max(dist(p1, p2), dist(p2, p3), dist(p1, p3), 1e-12);
  if (Math.abs(d) < 1e-9 * scale * scale) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d, uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const c = [ux, uy], r = Math.hypot(ax - ux, ay - uy);
  const ccw = (bx - ax) * (cy - by) - (by - ay) * (cx - bx) > 0;      // the points go round the centre anticlockwise
  const s = ccw ? p1 : p3, e = ccw ? p3 : p1;
  return { c, r, a0: norm360(angleOf(c, s)), a1: norm360(angleOf(c, e)) };
}

/** The sweep of an arc a0 → a1 anticlockwise, in degrees (0, 360]. */
export const sweepOf = (a0, a1) => { const s = norm360(a1 - a0); return s < 1e-9 ? 360 : s; };

// The AutoCAD Arc modes (TODO 347, values checked in AutoCAD: acad-347.txt). Each gives { c, r, a0, a1 } (anticlockwise, degrees) or { why } (the refusal's reason).
// S = start, C = centre, E = end, A = included angle, L = chord length, D = start tangent direction, R = radius. A negative A, L or R gives the other arc (clockwise / the major arc).
const ARC_ONE = 'The start and the centre are the same point', ARC_DEG = 'The angle must be between 0 and 360 degrees, not 0';
const arcOf = (c, r, s, e) => ({ c, r, a0: norm360(angleOf(c, s)), a1: norm360(angleOf(c, e)) });
/** Start, Centre, End: the end point only sets the direction of the end from the centre. */
export function arcSCE(s, c, e) {
  const r = dist(c, s);
  if (r < 1e-9) return { why: ARC_ONE };
  if (dist(c, e) < 1e-9) return { why: 'The end point is on the centre: pick it away from there' };
  const a = arcOf(c, r, s, e);
  return sweepOf(a.a0, a.a1) > 359.999999 ? { why: 'The end point is in line with the start: pick another' } : a;
}
/** Start, Centre, Angle (included angle in degrees; negative = clockwise from the start). */
export function arcSCA(s, c, ang) {
  const r = dist(c, s);
  if (r < 1e-9) return { why: ARC_ONE };
  if (!(Math.abs(ang) > 1e-9 && Math.abs(ang) < 360 - 1e-9)) return { why: ARC_DEG };
  const a = norm360(angleOf(c, s));
  return ang > 0 ? { c, r, a0: a, a1: norm360(a + ang) } : { c, r, a0: norm360(a + ang), a1: a };
}
/** Start, Centre, chord Length (negative = the major arc). A chord longer than the diameter is refused. */
export function arcSCL(s, c, len) {
  const r = dist(c, s);
  if (r < 1e-9) return { why: ARC_ONE };
  if (Math.abs(len) < 1e-9) return { why: 'The chord length must not be 0' };
  if (Math.abs(len) > 2 * r + 1e-9) return { why: 'Chord longer than the diameter' };
  const t = 2 * Math.asin(Math.min(1, Math.abs(len) / (2 * r))) * DEG;
  return arcSCA(s, c, len > 0 ? t : 360 - t);
}
/** Centre, Start, End / Angle / Length: the same arcs, the points picked in the other order. */
export const arcCSE = (c, s, e) => arcSCE(s, c, e);
export const arcCSA = (c, s, ang) => arcSCA(s, c, ang);
export const arcCSL = (c, s, len) => arcSCL(s, c, len);
/** Start, End, Angle: a positive angle runs anticlockwise from the start to the end, a negative one clockwise. */
export function arcSEA(s, e, ang) {
  const d = dist(s, e);
  if (d < 1e-9) return { why: 'The start and the end are the same point' };
  if (!(Math.abs(ang) > 1e-9 && Math.abs(ang) < 360 - 1e-9)) return { why: ARC_DEG };
  const half = Math.abs(ang) / 2 / DEG, r = d / 2 / Math.sin(half), h = r * Math.cos(half) * Math.sign(ang);      // h: the centre's distance to the left of s → e (to the right when the arc is clockwise)
  const c = [(s[0] + e[0]) / 2 - (e[1] - s[1]) / d * h, (s[1] + e[1]) / 2 + (e[0] - s[0]) / d * h];
  return ang > 0 ? arcOf(c, r, s, e) : arcOf(c, r, e, s);
}
/** Start, End, Direction (degrees): the arc leaves the start along that direction. A direction pointing at the end is a straight line and refused. */
export function arcSED(s, e, dir) {
  if (dist(s, e) < 1e-9) return { why: 'The start and the end are the same point' };
  const n = [-Math.sin(dir / DEG), Math.cos(dir / DEG)], side = n[0] * (e[0] - s[0]) + n[1] * (e[1] - s[1]);
  if (Math.abs(side) < 1e-9 * dist(s, e)) return { why: 'The direction points at the end point: that is a straight line' };
  const k = dist(s, e) ** 2 / (2 * side), c = [s[0] + n[0] * k, s[1] + n[1] * k];
  return k > 0 ? arcOf(c, k, s, e) : arcOf(c, -k, e, s);
}
/** Start, End, Radius (negative = the major arc). A radius smaller than half the distance between the points is refused. */
export function arcSER(s, e, rad) {
  const d = dist(s, e), r = Math.abs(rad);
  if (d < 1e-9) return { why: 'The start and the end are the same point' };
  if (r < 1e-9 || d > 2 * r + 1e-9) return { why: 'Radius too small for these points' };
  const h = Math.sqrt(Math.max(0, r * r - d * d / 4)) * Math.sign(rad);
  return arcOf([(s[0] + e[0]) / 2 - (e[1] - s[1]) / d * h, (s[1] + e[1]) / 2 + (e[0] - s[0]) / d * h], r, s, e);
}
/**
 * Arc, Continue (347c): where an arc continues from the last shape drawn (a line, an arc, or a polyline's last segment): { s: its end, dir: the tangent there in degrees },
 * the new arc leaves s along dir (arcSED). null for anything else (a circle, an ellipse, nothing).
 */
export function arcContinue(sh) {
  if (!sh) return null;
  if (sh.t === 'line') return dist(sh.a, sh.b) < 1e-9 ? null : { s: sh.b, dir: angleOf(sh.a, sh.b) };
  if (sh.t === 'arc') return { s: [sh.c[0] + sh.r * Math.cos(sh.a1 / DEG), sh.c[1] + sh.r * Math.sin(sh.a1 / DEG)], dir: norm360(sh.a1 + 90) };       // drawn anticlockwise, so the tangent at its end is a quarter turn on
  if (sh.t !== 'poly' || sh.pts.length < 2) return null;
  const n = sh.pts.length, p = sh.closed ? sh.pts[n - 1] : sh.pts[n - 2], q = sh.closed ? sh.pts[0] : sh.pts[n - 1], bulge = p[2] || 0;      // a closed one ends with the segment back to its first point (its bulge is the last point's)
  if (dist(p, q) < 1e-9) return null;
  return { s: [q[0], q[1]], dir: norm360(angleOf(p, q) + 2 * Math.atan(bulge) * DEG) };      // a bulge of tan(θ/4) turns the chord by θ/2 at the end
}
/** Ctrl held (347b): the arc turned the other way, i.e. mirrored in the line u → v (the centre-to-start line of the centre modes, the chord of Start, End, Angle / Radius). */
export function arcMirror(a, u, v) {
  const d = dist(u, v), ux = (v[0] - u[0]) / d, uy = (v[1] - u[1]) / d, t = (a.c[0] - u[0]) * ux + (a.c[1] - u[1]) * uy, phi = Math.atan2(uy, ux) * DEG;
  return { ...a, c: [2 * (u[0] + t * ux) - a.c[0], 2 * (u[1] + t * uy) - a.c[1]], a0: norm360(2 * phi - a.a1), a1: norm360(2 * phi - a.a0) };
}

const BULGE = Math.tan(Math.PI / 8);
/**
 * A rectangle between two corners as polyline points [x, y, bulge]; r > 0 rounds the corners (r is held to half the shorter side).
 * Anticlockwise from the lower-left, so a bulge of tan(π/8) is a quarter circle.
 */
export function rectPts(a, b, r = 0) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  r = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  if (!(r > 1e-9)) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return [[x0 + r, y0], [x1 - r, y0, BULGE], [x1, y0 + r], [x1, y1 - r, BULGE], [x1 - r, y1], [x0 + r, y1, BULGE], [x0, y1 - r], [x0, y0 + r, BULGE]];
}

/**
 * An ellipse from its centre, the end of axis 1 and the other half-axis: { c, m: [mx, my] (the major half-axis, as DXF wants it), ratio (minor / major, ≤ 1) }.
 * When the second half-axis is the longer, it becomes the major one (turned a quarter round). null for a zero axis.
 */
export function ellipseParams(c, end1, half2) {
  const mx = end1[0] - c[0], my = end1[1] - c[1], a = Math.hypot(mx, my), b = Math.abs(half2);
  if (a < 1e-9 || b < 1e-9) return null;
  if (b <= a) return { c: [c[0], c[1]], m: [mx, my], ratio: b / a };
  return { c: [c[0], c[1]], m: [-my * b / a, mx * b / a], ratio: a / b };
}

// ---------------------------------------------------------------- shapes → entities and paths

const ff = (v) => +v.toFixed(6);
/** A made shape as the DXF entity it saves as. o: { layer, aci … } (dxf-write.js); factor: mm per drawing unit (points are in mm). */
export function toEntity(sh, o = {}, factor = 1) {
  const u = (v) => ff(v / factor);
  switch (sh.t) {
    case 'line': return line(u(sh.a[0]), u(sh.a[1]), u(sh.b[0]), u(sh.b[1]), o);
    case 'poly': return lwpoly(sh.pts.map((p) => (p[2] ? [u(p[0]), u(p[1]), ff(p[2])] : [u(p[0]), u(p[1])])), { ...o, closed: !!sh.closed });
    case 'circle': return circle(u(sh.c[0]), u(sh.c[1]), u(sh.r), o);
    case 'arc': return arc(u(sh.c[0]), u(sh.c[1]), u(sh.r), ff(sh.a0), ff(sh.a1), o);
    case 'ellipse': return ellipse(u(sh.c[0]), u(sh.c[1]), u(sh.m[0]), u(sh.m[1]), ff(sh.ratio), 0, Math.PI * 2, o);
    default: throw new Error('unknown shape ' + sh.t);
  }
}

const num = (v) => +Number(v).toFixed(3);
/** A shape as an SVG path in sheet coordinates (the sheet's y runs down: y → H − y). */
export function svgPath(sh, H) {
  const P = (p) => `${num(p[0])} ${num(H - p[1])}`;
  if (sh.t === 'line') return `M${P(sh.a)}L${P(sh.b)}`;
  if (sh.t === 'poly') {
    let d = `M${P(sh.pts[0])}`;
    const n = sh.pts.length, last = sh.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p = sh.pts[i], q = sh.pts[(i + 1) % n], b = p[2] || 0;
      if (Math.abs(b) > 1e-9) {
        const r = dist(p, q) * (1 + b * b) / (4 * Math.abs(b));
        d += `A${num(r)} ${num(r)} 0 ${Math.abs(b) > 1 ? 1 : 0} ${b > 0 ? 0 : 1} ${P(q)}`;
      } else d += `L${P(q)}`;
    }
    return d + (sh.closed ? 'Z' : '');
  }
  if (sh.t === 'circle') return `M${num(sh.c[0] - sh.r)} ${num(H - sh.c[1])}a${num(sh.r)} ${num(sh.r)} 0 1 0 ${num(2 * sh.r)} 0a${num(sh.r)} ${num(sh.r)} 0 1 0 ${num(-2 * sh.r)} 0Z`;
  if (sh.t === 'arc') {
    const at = (t) => [sh.c[0] + sh.r * Math.cos(t / DEG), sh.c[1] + sh.r * Math.sin(t / DEG)];
    return `M${P(at(sh.a0))}A${num(sh.r)} ${num(sh.r)} 0 ${sweepOf(sh.a0, sh.a1) > 180 ? 1 : 0} 0 ${P(at(sh.a1))}`;
  }
  if (sh.t === 'ellipse') {
    const a = Math.hypot(sh.m[0], sh.m[1]), b = a * sh.ratio, rot = Math.atan2(sh.m[1], sh.m[0]), cs = Math.cos(rot), sn = Math.sin(rot);
    const at = (x) => [sh.c[0] + x * cs, sh.c[1] + x * sn];
    return `M${P(at(a))}A${num(a)} ${num(b)} ${num(-rot * DEG)} 1 0 ${P(at(-a))}A${num(a)} ${num(b)} ${num(-rot * DEG)} 1 0 ${P(at(a))}Z`;
  }
  return '';
}

// ---------------------------------------------------------------- the tools

/** The Circle tool's modes (the flyout and the Draw menu list these): [mode, name, typed way in]. Tan, Tan, Tan has no typed way in (AutoCAD has none). */
export const CIRCLE_MODES = [['cr', 'Centre, Radius', 'C'], ['cd', 'Centre, Diameter', 'C D'], ['2p', '2-Point', 'C 2P'], ['3p', '3-Point', 'C 3P'], ['ttr', 'Tan, Tan, Radius', 'C T'], ['ttt', 'Tan, Tan, Tan', null]];
/** The Arc tool's modes in AutoCAD's order (TODO 347c; the flyout and the Draw menu list these): [mode, name, typed way in]. Only 3-Point is typed straight (A); the others are options typed after it. */
export const ARC_MODES = [['3p', '3-Point', 'A'], ['sce', 'Start, Centre, End', null], ['sca', 'Start, Centre, Angle', null], ['scl', 'Start, Centre, Length', null], ['sea', 'Start, End, Angle', null], ['sed', 'Start, End, Direction', null],
  ['ser', 'Start, End, Radius', null], ['cse', 'Centre, Start, End', null], ['csa', 'Centre, Start, Angle', null], ['csl', 'Centre, Start, Length', null], ['ct', 'Continue', null]];
// what a mode has typed for the user: [T.am once the first point (Centre, Start: none) is placed, T.ask once both points are]
const ARC_PRESET = { sce: ['sc'], sca: ['sc', 'a'], scl: ['sc', 'l'], sea: ['se', 'a'], sed: ['se', 'd'], ser: ['se', 'r'], cse: ['cs'], csa: ['cs', 'a'], csl: ['cs', 'l'] };
function arcPreset(T) {
  const p = T.kind === 'arc' && ARC_PRESET[T.mode];
  if (!p) return;
  T.am = p[0] === 'cs' || T.pts.length ? p[0] : null;
  T.ask = p[1] && T.pts.length > 1 ? p[1] : null;
}
const byPoints = (T) => T.kind === 'circle' && (T.mode === '2p' || T.mode === '3p');
/** Tan, Tan, Radius and Tan, Tan, Tan: the picks are objects (the app finds the object under each click and gives it to toolClick), not points. */
export const tangentMode = (T) => T.kind === 'circle' && (T.mode === 'ttr' || T.mode === 'ttt');
const TAN = 'Requires a TAN object-snap and selection of Circle, Arc, or Line.';
const radiusStage = (T) => T.mode === 'ttr' && T.pts.length === 2;        // Tan, Tan, Radius: both objects are picked, the radius is next

/** A new tool. cfg: { radius } is the rounded rectangle's corner radius (kept between uses by the app); { mode } the Circle's or Arc's mode (CIRCLE_MODES, default Centre, Radius; ARC_MODES, default 3-Point). T.cont (set by the app): the last shape drawn, for the Arc's Continue. */
export function createTool(kind, cfg = {}) {
  if (!KINDS.includes(kind)) throw new Error('unknown tool ' + kind);
  const radius = cfg.radius > 0 ? cfg.radius : 5;
  const modes = kind === 'arc' ? ARC_MODES : kind === 'circle' ? CIRCLE_MODES : [], mode = modes.some((m) => m[0] === cfg.mode) ? cfg.mode : kind === 'arc' ? '3p' : 'cr';
  const T = { kind, pts: [], objs: [], rbase: null, trail: [], last: null, hover: null, dia: mode === 'cd', mode, radius, stage: kind === 'rrect' ? 'radius' : 'pts', back: null, msg: null, am: null, ask: null, flip: false, cont: null, dir: 0 };
  arcPreset(T);
  return T;
}

// Arc, typed modes (347a, 347b): T.am = 'sc' (Start, Centre, …: pts [start, centre]) or 'cs' (Centre, Start, …: pts [centre, start]) once C is typed, 'se' (Start, End, …: pts [start, end]) once E is typed;
// T.ask = 'a' | 'l' (centre modes) or 'a' | 'd' | 'r' ('se') once that option is typed at the last prompt; T.flip = Ctrl is held (the arc turns the other way, set by toolClick / toolHover).
const arcCS = (T) => T.am === 'sc' ? [T.pts[1], T.pts[0]] : [T.pts[0], T.pts[1]];            // [centre, start]
const flipped = (T, a, u, v) => T.flip && !a.why ? arcMirror(a, u, v) : a;
const norm180 = (t) => { t = norm360(t); return t > 180 ? t - 360 : t; };
const ASK_ANGLE = { a: 1, d: 1 };                                    // the asks that take degrees (the others a length)
/** The arc of the A / L (centre modes) or A / D / R (Start, End) prompt for a value (degrees / mm) or the pointer. */
const arcAsked = (T, v) => {
  if (T.am === 'se') {
    const [s, e] = T.pts;
    return T.ask === 'd' ? arcSED(s, e, v + (T.flip ? 180 : 0)) : flipped(T, T.ask === 'a' ? arcSEA(s, e, v) : arcSER(s, e, v), s, e);       // Ctrl on D: the tangent runs the other way
  }
  const [c, s] = arcCS(T);
  return flipped(T, T.ask === 'a' ? arcSCA(s, c, v) : arcSCL(s, c, v), c, s);
};
/** The value a point stands for (the pointer, for the live preview and a click): Start, Centre: the angle from the start round the centre (anticlockwise), or the chord from the start; Start, End: the direction of the start tangent, the angle that makes (twice its turn from the chord) or the distance from the start. */
export function arcValueAt(T, p) {
  if (T.am === 'se') { const [s, e] = T.pts, dir = angleOf(s, p); return T.ask === 'd' ? dir : T.ask === 'a' ? 2 * norm180(angleOf(s, e) - dir) : dist(s, p); }
  const [c, s] = arcCS(T);
  return T.ask === 'a' ? norm360(angleOf(c, p) - angleOf(c, s)) : dist(s, p);
}
const arcEnd = (T, e) => { const [c, s] = arcCS(T), a = arcSCE(s, c, e); return T.flip && !a.why ? { ...a, a0: a.a1, a1: a.a0 } : a; };       // Ctrl: clockwise from the start to the pick, same centre
const ARC_ASK_WHY = { a: 'Requires valid numeric angle or second point.', d: 'Requires valid numeric angle or second point.', l: 'Requires numeric distance or second point.', r: 'Requires numeric distance or second point.' };
const OPT_REFUSED = '2D point or option keyword required.';
const ASK_NAME = { a: 'Angle', l: 'chord Length', d: 'Direction', r: 'Radius' };
const ASK_PROMPT = { a: 'Specify included angle', l: 'Specify length of chord', d: 'Specify tangent direction for the start point of arc', r: 'Specify radius of arc' };
const SE_CENTRE ='Type A, D or R: the arc is set by an angle, a direction or a radius here';
const arcMade = (T, a) => {
  if (a.why) return say(a.why);                                       // stays at the prompt with the points kept
  reset(T);
  return done([{ t: 'arc', c: a.c, r: a.r, a0: a.a0, a1: a.a1 }]);
};
/** A typed A / L (centre modes) or A / D / R (Start, End) at the Arc's last prompt (the value may follow it: "A -90"), C at the first two prompts, E at the second; anything else is not an option. */
function arcWord(T, w, arg, unit) {
  const n = T.pts.length, opt = (...names) => names.some((x) => x.startsWith(w));
  if (T.ask) return say(ARC_ASK_WHY[T.ask]);                          // a word where a number is needed
  if (!T.am && n < 2 && opt('center', 'centre')) { T.am = n ? 'sc' : 'cs'; T.mode = '3p'; return say(null); }       // a typed option leaves the mode the button started
  if (!T.am && n === 1 && opt('end')) { T.am = 'se'; T.mode = '3p'; return say(null); }
  const ask = T.am === 'se' ? n === 2 && ['angle', 'direction', 'radius'].find((x) => opt(x)) : T.am && n === 2 && ['angle', 'length'].find((x) => opt(x));
  if (ask) {
    T.ask = ask[0];
    if (!arg) return say(null);
    const v = ASK_ANGLE[T.ask] ? +arg : parseLength(arg, unit);
    return Number.isFinite(v) ? arcMade(T, arcAsked(T, v)) : say(ARC_ASK_WHY[T.ask]);
  }
  return say(OPT_REFUSED);
}

const done = (made, msg = null) => ({ made, msg });
const say = (msg) => ({ made: null, msg });

/** The point the rubber band starts from (for Shift / ORTHO and direct distance), or null. */
export function toolRef(T) {
  if (T.stage === 'radius') return null;
  return T.pts.length ? T.pts[T.pts.length - 1] : null;
}
/** How many points are placed (0 = nothing in progress). */
export const toolBusy = (T) => T.pts.length > 0 || !!T.am && !(T.kind === 'arc' && ARC_PRESET[T.mode]);       // a typed C in Arc is a command in progress before any point (a Centre, Start mode from the button waits for its first point like the others)

function reset(T) { T.pts = []; T.objs = []; T.rbase = null; T.trail = []; T.hover = null; T.dia = T.mode === 'cd'; T.am = null; T.ask = null; arcPreset(T); }

/** The polyline of what is picked, null when it has fewer than 2 points (a Line commits each segment as it is picked: see addPoint). */
function chain(T, closed) {
  const pts = T.pts.map((p) => [p[0], p[1]]);
  if (pts.length < 2) return null;
  return [{ t: 'poly', pts, closed: !!closed && pts.length > 2 }];
}

function finishChain(T, closed) {
  const made = chain(T, closed);
  reset(T);
  return made ? done(made) : say('A polyline needs two points');
}

/** A point picked or typed. */
function addPoint(T, p, obj) {
  const result = placePoint(T, p, obj);
  if (!result.msg) T.last = p.slice(0, 2);
  return result;
}

/** The circle of a Tan, Tan, Radius / Tan, Tan, Tan pick set: made, or "does not exist" and the command ends. A radius of 0 or less is refused and asked again. */
function tangentDone(T, r) {
  if (r != null && !(r > 1e-9)) { T.rbase = null; return say('Value must be positive and nonzero.'); }
  const c = tangentCircle(T.objs, T.pts, r);
  reset(T);
  return c ? done([{ t: 'circle', c: c.c, r: c.r }]) : { made: null, msg: 'Circle does not exist.', end: true };
}

/** A pick in a tangent mode: an object (obj: { t: 'l', a, b } | { t: 'c', c, r }, in mm) at the point p; after both objects of Tan, Tan, Radius, two points are the radius. */
function tangentClick(T, p, obj) {
  if (radiusStage(T)) {
    if (!T.rbase) { T.rbase = p; return say(null); }
    return tangentDone(T, dist(T.rbase, p));
  }
  if (!obj) return say(TAN);
  T.pts.push(p); T.objs.push(obj);
  return T.mode === 'ttt' && T.pts.length === 3 ? tangentDone(T, null) : say(null);
}

function placePoint(T, p, obj) {
  p = [p[0], p[1]];
  if (tangentMode(T)) return tangentClick(T, p, obj);
  const k = T.kind, n = T.pts.length;
  if (k === 'line' || k === 'polyline') {
    if (n && dist(T.pts[n - 1], p) < 1e-9) return say('That is the last point again: pick another');
    if (k === 'line' && n) { const seg = { t: 'line', a: T.pts[0], b: p }; T.trail.push(T.pts[0]); T.pts = [p]; return done([seg]); }     // each click after the first is a segment at once
    T.pts.push(p);
    return say(null);
  }
  if (k === 'rect' || k === 'rrect') {
    if (!n) { T.pts = [p]; return say(null); }
    if (Math.abs(p[0] - T.pts[0][0]) < 1e-9 || Math.abs(p[1] - T.pts[0][1]) < 1e-9) return say('The corners are in a line: pick the opposite corner');
    const made = [{ t: 'poly', pts: rectPts(T.pts[0], p, k === 'rrect' ? T.radius : 0), closed: true }];
    reset(T);
    return done(made);
  }
  if (byPoints(T)) {                                                  // 2P: the ends of a diameter; 3P: three points on the circle. A repeated point or a straight line is refused
    if (T.pts.some((q) => dist(q, p) < 1e-9)) return say('*Invalid*');
    if (n < (T.mode === '2p' ? 1 : 2)) { T.pts.push(p); return say(null); }
    const c = T.mode === '2p' ? { c: [(T.pts[0][0] + p[0]) / 2, (T.pts[0][1] + p[1]) / 2], r: dist(T.pts[0], p) / 2 } : arcThrough3(T.pts[0], T.pts[1], p);
    if (!c) return say('*Invalid*');
    const made = [{ t: 'circle', c: c.c, r: c.r }];
    reset(T);
    return done(made);
  }
  if (k === 'circle') {
    if (!n) { T.pts = [p]; return say(null); }
    const d = dist(T.pts[0], p);
    if (d < 1e-9) return say('The radius is zero: pick a point away from the centre');
    return circleOf(T, T.dia ? d / 2 : d);
  }
  if (k === 'ellipse') {
    if (!n) { T.pts = [p]; return say(null); }
    if (n === 1) {
      if (dist(T.pts[0], p) < 1e-9) return say('Axis 1 has no length: pick a point away from the centre');
      T.pts.push(p);
      return say(null);
    }
    return ellipseOf(T, dist(T.pts[0], p));
  }
  if (k === 'arc') {
    if (T.ask) return arcMade(T, arcAsked(T, arcValueAt(T, p)));        // a click at the A / L prompt: the pointer gives the value
    if (T.am === 'ct') return arcMade(T, arcSED(T.pts[0], p, T.dir));    // Continue: the start and the tangent are known, the end point is all it asks
    if (n < 2) {
      if (n && dist(T.pts[n - 1], p) < 1e-9) return say('That is the same point: pick another');
      T.pts.push(p);
      arcPreset(T);
      return say(null);
    }
    if (T.am === 'se') return say(SE_CENTRE);                           // the points are kept, the prompt stays
    if (T.am) return arcMade(T, arcEnd(T, p));
    const a = arcThrough3(T.pts[0], T.pts[1], p);
    if (!a) return say('The three points lie in a line: pick the end point off it');
    const made = [{ t: 'arc', c: a.c, r: a.r, a0: a.a0, a1: a.a1 }];
    reset(T);
    return done(made);
  }
  return say(null);
}

function circleOf(T, r) {
  if (!(r > 1e-9)) return say('The radius must be above 0');
  const made = [{ t: 'circle', c: T.pts[0], r }];
  reset(T);
  return done(made);
}
function ellipseOf(T, half2) {
  if (!(half2 > 1e-9)) return say('Axis 2 must be above 0');
  const e = ellipseParams(T.pts[0], T.pts[1], half2);
  if (!e) return say('The ellipse has no size');
  reset(T);
  return done([{ t: 'ellipse', ...e }]);
}

/** A click (already snapped to a point of the drawing, or free); obj: the line, circle or arc under it for a tangent pick (see tangentClick), null when there is none; flip: Ctrl is held (the Arc turns the other way). */
export function toolClick(T, p, obj = null, flip = false) {
  if (T.stage === 'radius') T.stage = 'pts';                          // clicking the first corner keeps the remembered radius
  T.hover = [p[0], p[1]]; T.flip = !!flip;
  return addPoint(T, p, obj);
}

/** The pointer moved (a snapped point): the rubber band follows. flip: Ctrl is held; left alone when not given (a Ctrl key press sets T.flip itself). */
export function toolHover(T, p, flip) { T.hover = p ? [p[0], p[1]] : null; if (flip !== undefined) T.flip = !!flip; }

/** Enter / Esc / right-click. A polyline ends and keeps what it has; a line ends (its segments are already made); the rest cancel the shape in progress. */
export function toolFinish(T) {
  if (T.stage === 'radius') { T.stage = 'pts'; return say(`Corner radius ${n2(T.radius)} mm`); }
  if (T.kind === 'line') { reset(T); return say(null); }
  if (T.kind === 'polyline') return T.pts.length ? finishChain(T, false) : say(null);
  if (T.pts.length || T.am) { reset(T); return say('Cancelled'); }
  if (T.kind === 'arc' && !T.am) {                                    // Enter at the first prompt: Continue from the last line or arc (T.cont, set by the app), no Ctrl flip
    const c = arcContinue(T.cont);
    if (!c) return say('No line or arc to continue.');
    T.am = 'ct'; T.pts = [c.s]; T.dir = c.dir;
    return say(null);
  }
  return say(null);
}

/**
 * Undo (Ctrl+Z, or U in the command line) while a Line has made segments: the app takes the last segment back and calls this, so the next
 * point starts from where that segment began. → 'seg' (a segment is gone), 'point' (only the first point was picked: it is dropped), or null.
 */
export function toolUndoSeg(T) {
  if (T.kind !== 'line' || !T.pts.length) return null;
  if (T.trail.length) { T.pts = [T.trail.pop()]; T.last = T.pts[0]; return 'seg'; }
  reset(T); T.last = null; return 'point';
}

/** Back to the point before (Undo / U): a polyline loses its last point, the others their last pick. */
function undoPoint(T) {
  if (ARC_PRESET[T.mode] && T.kind === 'arc' && T.pts.length) { T.pts.pop(); T.last = T.pts.at(-1) || null; arcPreset(T); return say(null); }       // a mode the button started goes back one point at a time
  if (T.ask) { T.ask = null; return say(null); }                     // Arc: back from the A / L prompt to the end point
  if (!T.pts.length && T.am && !ARC_PRESET[T.mode]) { T.am = null; return say(null); }       // Arc: back from a typed C at the first prompt
  if (!T.pts.length) return say('Nothing to undo');
  if (T.kind === 'line' && T.trail.length) return { made: null, msg: null, undoSeg: true };         // the app undoes the segment's step
  if (T.rbase) { T.rbase = null; return say(null); }                  // Tan, Tan, Radius: the radius' first point
  if (T.am === 'ct') { reset(T); return say(null); }                  // Arc: back from Continue's end point to the first prompt
  if ((T.am === 'sc' || T.am === 'se') && T.pts.length === 1) { T.am = null; return say(null); }      // Arc: back from the centre / end prompt to the second point prompt, where C and E are options
  T.pts.pop();
  T.objs.length = Math.min(T.objs.length, T.pts.length);
  T.last = T.pts.at(-1) || null;
  return say(null);
}

/** What was typed in the command line. */
export function toolType(T, text, unit = 'mm') {
  const inp = parseInput(text, unit), k = T.kind;
  if (inp.kind === 'bad') return say(`I do not understand "${String(text).trim()}". Type x,y or @dx,dy, a length, or a word from the prompt`);
  if (T.stage === 'radius') {                                         // the rounded rectangle's corner radius first
    if (inp.kind === 'enter') { T.stage = 'pts'; return say(`Corner radius ${n2(T.radius)} mm`); }
    if (inp.kind === 'len' && inp.v >= 0) { T.radius = inp.v; T.stage = 'pts'; return say(`Corner radius ${n2(T.radius)} mm`); }
    return say('Type the corner radius in mm (0 or more), or press Enter to keep ' + n2(T.radius));
  }
  if (inp.kind === 'enter') return toolFinish(T);
  const ref = toolRef(T);
  if (inp.kind === 'word') {
    const [w, ...rest] = inp.w.split(/\s+/), arg = rest.length ? parseLength(rest.join(' '), unit) : null;
    if ((k === 'line' || k === 'polyline') && (w === 'c' || w === 'close')) {
      if (k === 'line') {
        if (T.trail.length < 2) return say(`Close needs two segments; there ${T.trail.length === 1 ? 'is' : 'are'} ${T.trail.length}`);
        const made = [{ t: 'line', a: T.pts[0], b: T.trail[0] }];
        reset(T);
        return done(made);
      }
      if (T.pts.length < 3) return say(`Close needs three points; there ${T.pts.length === 1 ? 'is' : 'are'} ${T.pts.length}`);
      return finishChain(T, true);
    }
    if (w === 'u' || w === 'undo') return undoPoint(T);
    if (k === 'arc') return arcWord(T, w, rest.join(' '), unit);
    if (k === 'circle' && !T.pts.length && (w === '2p' || w === '3p')) { T.mode = w; return say(null); }        // CIRCLE's centre prompt: AutoCAD's 2P / 3P options
    if (k === 'circle' && !T.pts.length && (w === 'c' || w === 'circle')) { T.mode = 'cr'; T.dia = false; return say(null); }      // typed C is always Centre, Radius
    if (k === 'circle' && !T.pts.length && (w === 't' || w === 'ttr')) { T.mode = 'ttr'; T.dia = false; return say(null); }       // T / TTR: Tan, Tan, Radius (AutoCAD: T alone is enough)
    if (tangentMode(T)) return say(radiusStage(T) ? 'Specify the radius as a number, or pick two points' : TAN);
    if (byPoints(T) || k === 'circle' && !T.pts.length && !['d', 'diameter', 'r', 'radius'].includes(w)) return say('Point or option keyword required.');
    if (k === 'circle' && (w === 'd' || w === 'diameter')) { T.dia = true; if (arg != null && +arg > 0 && T.pts.length) return circleOf(T, +arg / 2); return say(null); }
    if (k === 'circle' && (w === 'r' || w === 'radius')) { T.dia = false; if (arg != null && +arg > 0 && T.pts.length) return circleOf(T, +arg); return say(null); }
    if (k === 'rrect' && (w === 'r' || w === 'radius')) {
      if (arg != null && +arg >= 0) { T.radius = +arg; return say(`Corner radius ${n2(T.radius)} mm`); }
      T.stage = 'radius'; return say(null);
    }
    return say(`"${w}" is not an option here`);
  }
  if (T.ask) { const v = ASK_ANGLE[T.ask] ? +String(text).trim() : inp.v; return inp.kind === 'len' && Number.isFinite(v) ? arcMade(T, arcAsked(T, v)) : say(ARC_ASK_WHY[T.ask]); }      // Arc's A / L prompt: a number (negative too); an angle is never a length in the drawing's unit
  // a point or a length
  if (!T.pts.length) {
    const p = typedPoint(inp, T.last);
    if (!p) return say(tangentMode(T) ? TAN : k === 'circle' && !byPoints(T) || k === 'ellipse' ? 'Type the centre as x,y' : 'Type the first point as x,y (or click it)');
    return addPoint(T, p);
  }
  if (tangentMode(T)) {                                               // objects are picked, not typed; Tan, Tan, Radius takes the radius as a length
    if (!radiusStage(T)) return say(TAN);
    if (inp.kind === 'len') return tangentDone(T, inp.v);
    const p = typedPoint(inp, T.rbase || T.pts[1]);
    return p ? addPoint(T, p) : say('Type the radius');
  }
  if (k === 'rect' || k === 'rrect') {                                // the second corner: W,H (also @W,H), or #x,y for an absolute corner
    const p = typedPoint(inp.kind === 'xy' ? { ...inp, rel: inp.rel || !inp.abs } : inp, T.pts[0]);
    if (p) return addPoint(T, p);
    return say('Type the size as W,H (or @W,H)');
  }
  if (k === 'circle' && !byPoints(T)) {
    if (inp.kind === 'len') return inp.v > 0 ? circleOf(T, T.dia ? inp.v / 2 : inp.v) : say('The radius must be above 0');
    const p = typedPoint(inp, T.pts[0]);
    return p ? addPoint(T, p) : say('Type a radius');
  }
  if (k === 'ellipse' && T.pts.length === 2 && inp.kind === 'len') return inp.v > 0 ? ellipseOf(T, inp.v) : say('Axis 2 must be above 0');
  if (inp.kind === 'len') {                                           // direct distance entry: a length the way the rubber band points
    if (!(inp.v > 0)) return say('The length must be above 0');
    const p = directDistance(ref, T.hover, inp.v);
    if (!p) return say('Move the pointer the way you want it to go, then type the length');
    return addPoint(T, p);
  }
  const p = typedPoint(inp, ref);
  return p ? addPoint(T, p) : say('Not understood');
}

// ---------------------------------------------------------------- preview and prompt

const lenAng = (a, b) => `${n2(dist(a, b))} mm · ${n2(angleOf(a, b))}°`;

/** { shapes, guides: [[a, b]] (dashed helper lines), readout, at } for the live preview; the rubber band needs a hover point. */
export function toolPreview(T) {
  const k = T.kind, H = T.hover, P = T.pts, out = { shapes: [], guides: [], readout: null, at: H };
  if (T.stage === 'radius') return out;
  if (k === 'line' || k === 'polyline') {
    const pts = H && P.length ? [...P, H] : P;
    if (pts.length >= 2) out.shapes.push({ t: 'poly', pts: pts.map((p) => [p[0], p[1]]), closed: false });
    if (H && P.length) { out.readout = lenAng(P[P.length - 1], H); out.at = H; }
    return out;
  }
  if (!P.length || !H) return out;
  if (k === 'rect' || k === 'rrect') {
    if (Math.abs(H[0] - P[0][0]) > 1e-9 && Math.abs(H[1] - P[0][1]) > 1e-9) out.shapes.push({ t: 'poly', pts: rectPts(P[0], H, k === 'rrect' ? T.radius : 0), closed: true });
    out.readout = `W ${n2(Math.abs(H[0] - P[0][0]))} × H ${n2(Math.abs(H[1] - P[0][1]))}` + (k === 'rrect' ? ` · R ${n2(T.radius)}` : '');
    return out;
  }
  if (tangentMode(T)) {                                               // only the radius' two points show a live circle
    if (!radiusStage(T) || !T.rbase) return out;
    const r = dist(T.rbase, H), c = r > 1e-9 && tangentCircle(T.objs, P, r);
    if (c) out.shapes.push({ t: 'circle', c: c.c, r: c.r });
    out.guides.push([T.rbase, H]); out.readout = `R ${n2(r)}`;
    return out;
  }
  if (byPoints(T)) {
    if (T.mode === '2p') {
      const d = dist(P[0], H);
      if (d > 1e-9) out.shapes.push({ t: 'circle', c: [(P[0][0] + H[0]) / 2, (P[0][1] + H[1]) / 2], r: d / 2 });
      out.guides.push([P[0], H]); out.readout = `Ø ${n2(d)}`;
      return out;
    }
    if (P.length === 1) { out.guides.push([P[0], H]); out.readout = `${n2(dist(P[0], H))} mm`; return out; }
    const a = arcThrough3(P[0], P[1], H);
    if (a) { out.shapes.push({ t: 'circle', c: a.c, r: a.r }); out.readout = `R ${n2(a.r)}`; }
    else out.shapes.push({ t: 'poly', pts: [P[0], P[1], H].map((p) => [p[0], p[1]]), closed: false });
    out.guides.push([P[0], P[1]]);
    return out;
  }
  if (k === 'circle') {
    const d = dist(P[0], H);
    if (d > 1e-9) out.shapes.push({ t: 'circle', c: P[0], r: T.dia ? d / 2 : d });
    out.guides.push([P[0], H]);
    out.readout = T.dia ? `Ø ${n2(d)}` : `R ${n2(d)}`;
    return out;
  }
  if (k === 'ellipse') {
    if (P.length === 1) { out.guides.push([P[0], H]); out.readout = `Axis 1 ${n2(dist(P[0], H))} mm · ${n2(angleOf(P[0], H))}°`; return out; }
    const e = ellipseParams(P[0], P[1], dist(P[0], H));
    if (e) out.shapes.push({ t: 'ellipse', ...e });
    out.guides.push([P[0], P[1]], [P[0], H]);
    out.readout = `Axis 1 ${n2(dist(P[0], P[1]))} · Axis 2 ${n2(dist(P[0], H))}`;
    return out;
  }
  if (k === 'arc') {
    if (T.am === 'ct') {
      const a = arcSED(P[0], H, T.dir);
      if (!a.why) { out.shapes.push({ t: 'arc', c: a.c, r: a.r, a0: a.a0, a1: a.a1 }); out.readout = `R ${n2(a.r)} · ${n2(sweepOf(a.a0, a.a1))}°`; }
      return out;
    }
    if (P.length === 1 && T.am === 'cs') { out.guides.push([P[0], H]); out.readout = `R ${n2(dist(P[0], H))}`; return out; }
    if (P.length === 1) { out.shapes.push({ t: 'line', a: P[0], b: H }); return out; }
    if (T.am) {                                                       // the typed modes: the end point, or the typed (else the pointer's) angle / chord / direction / radius
      const a = T.ask ? arcAsked(T, T.value ?? arcValueAt(T, H)) : T.am === 'se' ? { why: true } : arcEnd(T, H);
      if (!a.why) { out.shapes.push({ t: 'arc', c: a.c, r: a.r, a0: a.a0, a1: a.a1 }); out.readout = `R ${n2(a.r)} · ${n2(sweepOf(a.a0, a.a1))}°`; }
      out.guides.push(T.am === 'se' ? [P[0], P[1]] : arcCS(T));
      return out;
    }
    const a = arcThrough3(P[0], P[1], H);
    if (a) { out.shapes.push({ t: 'arc', c: a.c, r: a.r, a0: a.a0, a1: a.a1 }); out.readout = `R ${n2(a.r)} · ${n2(sweepOf(a.a0, a.a1))}°`; }
    else out.shapes.push({ t: 'poly', pts: [P[0], P[1], H].map((p) => [p[0], p[1]]), closed: false });
    out.guides.push([P[0], P[1]]);
    return out;
  }
  return out;
}

/** The command line: { status (the history line), prompt }. */
export function toolPrompt(T, layer = '0') {
  const k = T.kind, n = T.pts.length, head = LABELS[k].toUpperCase();
  const st = (extra) => `Command: ${head}   ${extra}`;
  if (T.stage === 'radius') return { status: st(`Corner radius ${n2(T.radius)} mm · layer ${layer}`), input: 'number', prompt: `Corner radius <${n2(T.radius)}>:` };
  if (k === 'line') {
    if (!n) return { status: st(`layer ${layer}`), prompt: 'Specify first point (x,y):' };
    const g = T.trail.length;
    return { status: st(`${g} segment${g === 1 ? '' : 's'} made · layer ${layer} · Enter ends`), prompt: `Next point or length [${g > 1 ? 'Close / ' : ''}Undo]:` };
  }
  if (k === 'polyline') {
    if (!n) return { status: st(`layer ${layer}`), prompt: 'Specify first point (x,y):' };
    return { status: st(`${n} point${n === 1 ? '' : 's'} · layer ${layer} · Enter ends`), prompt: `Next point or length [${n > 2 ? 'Close / ' : ''}Undo]:` };
  }
  if (k === 'rect' || k === 'rrect') {
    if (!n) return { status: st(`layer ${layer}` + (k === 'rrect' ? ` · R ${n2(T.radius)}` : '')), prompt: 'Specify first corner' + (k === 'rrect' ? ' [Radius]' : '') + ':' };
    return { status: st(`first corner ${n2(T.pts[0][0])}, ${n2(T.pts[0][1])}`), prompt: 'Other corner, or size W,H (also @W,H)' + (k === 'rrect' ? ' [Radius]' : '') + ':' };
  }
  if (tangentMode(T)) {
    const name = T.mode === 'ttr' ? 'Tan, Tan, Radius' : 'Tan, Tan, Tan';
    if (radiusStage(T)) return { status: st(`${name} · radius next · layer ${layer}`), input: T.rbase ? undefined : 'number', prompt: T.rbase ? 'Specify second point:' : 'Specify radius of circle:' };
    return { status: st(`${name} · ${n} of ${T.mode === 'ttr' ? 2 : 3} picked · layer ${layer}`), prompt: `Specify point on object for ${['first', 'second', 'third'][n]} tangent of circle:` };
  }
  if (byPoints(T)) {
    const two = T.mode === '2p', ord = ['first', 'second', 'third'][n];
    return { status: st(`${two ? '2-Point' : '3-Point'} · ${n} point${n === 1 ? '' : 's'} · layer ${layer}`), prompt: two ? `Specify ${ord} end point of circle's diameter (x,y):` : `Specify ${ord} point on circle (x,y):` };
  }
  if (k === 'circle') {
    if (!n) return { status: st(`layer ${layer}`), prompt: 'Specify centre (x,y) [3P/2P/Ttr (tan tan radius)/Diameter]:' };
    return { status: st(`centre ${n2(T.pts[0][0])}, ${n2(T.pts[0][1])}`), prompt: T.dia ? 'Diameter [Radius]:' : 'Radius [Diameter]:' };
  }
  if (k === 'ellipse') {
    if (!n) return { status: st(`layer ${layer}`), prompt: 'Specify centre (x,y):' };
    if (n === 1) return { status: st(`centre ${n2(T.pts[0][0])}, ${n2(T.pts[0][1])}`), prompt: 'End of axis 1 (a point, or a length the way the line points):' };
    return { status: st(`axis 1 ${n2(dist(T.pts[0], T.pts[1]))} mm`), prompt: 'Other half-axis (a point, or its length):' };
  }
  // arc
  if (T.am === 'ct') return { status: st(`Continue · layer ${layer}`), prompt: 'Specify end point of arc (x,y):' };
  if (T.am) {
    const name = { sc: 'Start, Centre', cs: 'Centre, Start', se: 'Start, End' }[T.am], ctrl = '(hold Ctrl to switch direction)';
    if (T.ask) return { status: st(`${name}, ${ASK_NAME[T.ask]} · layer ${layer}`), prompt: ASK_PROMPT[T.ask] + ` ${ctrl}:` };
    if (T.am === 'se') return n === 2 ? { status: st(`${name} · layer ${layer}`), prompt: `Type an option ${ctrl} [Angle/Direction/Radius]:` } : { status: st(`${name} · 1 point · layer ${layer}`), prompt: 'Specify end point of arc (x,y):' };
    if (n === 2) return { status: st(`${name} · layer ${layer}`), prompt: `Specify end point of arc ${ctrl} or [Angle/chord Length]:` };
    return { status: st(`${name} · ${n} point${n === 1 ? '' : 's'} · layer ${layer}`), prompt: `Specify ${T.am === 'cs' && n === 1 ? 'start' : 'centre'} point of arc (x,y):` };
  }
  if (!n) return { status: st(`3 points · layer ${layer}`), prompt: 'Specify start point (x,y) [Center]:' };
  if (n === 1) return { status: st('start ' + n2(T.pts[0][0]) + ', ' + n2(T.pts[0][1])), prompt: 'Specify second point on the arc [Center/End]:' };
  return { status: st('start and second point set'), prompt: 'Specify end point:' };
}


/** The words a tool understands in the command line (so a typed "c" in Circle is not taken for the Circle command). */
export function toolWords(T) {
  const k = T.kind;
  if (T.stage === 'radius') return new Set();
  if (k === 'line' || k === 'polyline') return new Set(['c', 'close', 'u', 'undo']);
  if (k === 'circle') return new Set(['d', 'diameter', 'r', 'radius', 'u', 'undo', '2p', '3p', 't', 'ttr']);
  if (k === 'rrect') return new Set(['r', 'radius', 'u', 'undo']);
  if (k === 'arc') return new Set(['u', 'undo', 'c', 'center', 'centre']);       // a typed C at the Arc's first prompt is its option, not the Circle command (A and L are only options once a C is typed: the tool is busy then)
  return new Set(['u', 'undo']);
}

/** Does Shift / ORTHO keep the next point straight along X or Y from the last one here? (lines, polylines and an ellipse's first axis) */
export function orthoApplies(T) {
  return T.kind === 'line' || T.kind === 'polyline' || (T.kind === 'ellipse' && T.pts.length === 1);
}
