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
export function dynamicInput(a, b, dp) {
  const fixed = (v) => { const s = v.toFixed(dp); return +s === 0 ? (0).toFixed(dp) : s; };
  return {
    length: fixed(dist(a, b)) + ' mm',
    angle: fixed(+angleOf(a, b).toFixed(dp) % 360) + '°',
    dx: fixed(b[0] - a[0]) + ' mm',
    dy: fixed(b[1] - a[1]) + ' mm',
  };
}

// ---------------------------------------------------------------- typed input

const NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)';
const RE_PT = new RegExp(`^([@#]?)\\s*(${NUM})\\s*,\\s*(${NUM})$`);
const RE_POLAR = new RegExp(`^([@#]?)\\s*(${NUM})\\s*<\\s*(${NUM})$`);
const RE_NUM = new RegExp(`^(${NUM})$`);

/**
 * What was typed → { kind: 'enter' } | { kind: 'xy', rel, x, y } | { kind: 'polar', rel, len, ang } | { kind: 'len', v } | { kind: 'word', w } | { kind: 'bad' }.
 * "x,y" or "#x,y" is absolute, "@dx,dy" relative to the last point; "len<ang" (also with #) is polar from the origin, "@len<ang" from the last point; a bare
 * number is a length (direct distance entry); letters are an option word (lower case).
 */
export function parseInput(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return { kind: 'enter' };
  let m = RE_PT.exec(t);
  if (m) return { kind: 'xy', rel: m[1] === '@', x: +m[2], y: +m[3] };
  m = RE_POLAR.exec(t);
  if (m) return { kind: 'polar', rel: m[1] === '@', len: +m[2], ang: +m[3] };
  m = RE_NUM.exec(t);
  if (m) return { kind: 'len', v: +m[1] };
  if (/^[a-z]+(\s+[-+.\d]+)?$/i.test(t)) return { kind: 'word', w: t.toLowerCase() };
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

/** A new tool. cfg: { radius } is the rounded rectangle's corner radius (kept between uses by the app). */
export function createTool(kind, cfg = {}) {
  if (!KINDS.includes(kind)) throw new Error('unknown tool ' + kind);
  const radius = cfg.radius > 0 ? cfg.radius : 5;
  const T = { kind, pts: [], trail: [], last: null, hover: null, dia: false, radius, stage: kind === 'rrect' ? 'radius' : 'pts', back: null, msg: null };
  return T;
}

const done = (made, msg = null) => ({ made, msg });
const say = (msg) => ({ made: null, msg });

/** The point the rubber band starts from (for Shift / ORTHO and direct distance), or null. */
export function toolRef(T) {
  if (T.stage === 'radius') return null;
  return T.pts.length ? T.pts[T.pts.length - 1] : null;
}
/** How many points are placed (0 = nothing in progress). */
export const toolBusy = (T) => T.pts.length > 0;

function reset(T) { T.pts = []; T.trail = []; T.hover = null; T.dia = false; }

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
function addPoint(T, p) {
  const result = placePoint(T, p);
  if (!result.msg) T.last = p.slice(0, 2);
  return result;
}

function placePoint(T, p) {
  p = [p[0], p[1]];
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
    if (n < 2) {
      if (n && dist(T.pts[n - 1], p) < 1e-9) return say('That is the same point: pick another');
      T.pts.push(p);
      return say(null);
    }
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

/** A click (already snapped to a point of the drawing, or free). */
export function toolClick(T, p) {
  if (T.stage === 'radius') T.stage = 'pts';                          // clicking the first corner keeps the remembered radius
  T.hover = [p[0], p[1]];
  return addPoint(T, p);
}

/** The pointer moved (a snapped point): the rubber band follows. */
export function toolHover(T, p) { T.hover = p ? [p[0], p[1]] : null; }

/** Enter / Esc / right-click. A polyline ends and keeps what it has; a line ends (its segments are already made); the rest cancel the shape in progress. */
export function toolFinish(T) {
  if (T.stage === 'radius') { T.stage = 'pts'; return say(`Corner radius ${n2(T.radius)} mm`); }
  if (T.kind === 'line') { reset(T); return say(null); }
  if (T.kind === 'polyline') return T.pts.length ? finishChain(T, false) : say(null);
  if (T.pts.length) { reset(T); return say('Cancelled'); }
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
  if (!T.pts.length) return say('Nothing to undo');
  if (T.kind === 'line' && T.trail.length) return { made: null, msg: null, undoSeg: true };         // the app undoes the segment's step
  T.pts.pop();
  T.last = T.pts.at(-1) || null;
  return say(null);
}

/** What was typed in the command line. */
export function toolType(T, text) {
  const inp = parseInput(text), k = T.kind;
  if (inp.kind === 'bad') return say(`I do not understand "${String(text).trim()}". Type x,y or @dx,dy, a length, or a word from the prompt`);
  if (T.stage === 'radius') {                                         // the rounded rectangle's corner radius first
    if (inp.kind === 'enter') { T.stage = 'pts'; return say(`Corner radius ${n2(T.radius)} mm`); }
    if (inp.kind === 'len' && inp.v >= 0) { T.radius = inp.v; T.stage = 'pts'; return say(`Corner radius ${n2(T.radius)} mm`); }
    return say('Type the corner radius in mm (0 or more), or press Enter to keep ' + n2(T.radius));
  }
  if (inp.kind === 'enter') return toolFinish(T);
  const ref = toolRef(T);
  if (inp.kind === 'word') {
    const [w, arg] = inp.w.split(/\s+/);
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
    if (k === 'circle' && (w === 'd' || w === 'diameter')) { T.dia = true; if (arg != null && +arg > 0 && T.pts.length) return circleOf(T, +arg / 2); return say(null); }
    if (k === 'circle' && (w === 'r' || w === 'radius')) { T.dia = false; if (arg != null && +arg > 0 && T.pts.length) return circleOf(T, +arg); return say(null); }
    if (k === 'rrect' && (w === 'r' || w === 'radius')) {
      if (arg != null && +arg >= 0) { T.radius = +arg; return say(`Corner radius ${n2(T.radius)} mm`); }
      T.stage = 'radius'; return say(null);
    }
    return say(`"${w}" is not an option here`);
  }
  // a point or a length
  if (!T.pts.length) {
    const p = typedPoint(inp, T.last);
    if (!p) return say(k === 'circle' || k === 'ellipse' ? 'Type the centre as x,y' : 'Type the first point as x,y (or click it)');
    return addPoint(T, p);
  }
  if (k === 'rect' || k === 'rrect') {                                // the second corner: W,H (also @W,H), the way it points from the first
    const p = typedPoint(inp.kind === 'xy' ? { ...inp, rel: true } : inp, T.pts[0]);
    if (p) return addPoint(T, p);
    return say('Type the size as W,H (or @W,H)');
  }
  if (k === 'circle') {
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
    if (P.length === 1) { out.shapes.push({ t: 'line', a: P[0], b: H }); return out; }
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
  if (T.stage === 'radius') return { status: st(`Corner radius ${n2(T.radius)} mm · layer ${layer}`), prompt: `Corner radius <${n2(T.radius)}>:` };
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
  if (k === 'circle') {
    if (!n) return { status: st(`layer ${layer}`), prompt: 'Specify centre (x,y):' };
    return { status: st(`centre ${n2(T.pts[0][0])}, ${n2(T.pts[0][1])}`), prompt: T.dia ? 'Diameter [Radius]:' : 'Radius [Diameter]:' };
  }
  if (k === 'ellipse') {
    if (!n) return { status: st(`layer ${layer}`), prompt: 'Specify centre (x,y):' };
    if (n === 1) return { status: st(`centre ${n2(T.pts[0][0])}, ${n2(T.pts[0][1])}`), prompt: 'End of axis 1 (a point, or a length the way the line points):' };
    return { status: st(`axis 1 ${n2(dist(T.pts[0], T.pts[1]))} mm`), prompt: 'Other half-axis (a point, or its length):' };
  }
  // arc
  if (!n) return { status: st(`3 points · layer ${layer}`), prompt: 'Specify start point (x,y):' };
  if (n === 1) return { status: st('start ' + n2(T.pts[0][0]) + ', ' + n2(T.pts[0][1])), prompt: 'Specify second point on the arc:' };
  return { status: st('start and second point set'), prompt: 'Specify end point:' };
}


/** The words a tool understands in the command line (so a typed "c" in Circle is not taken for the Circle command). */
export function toolWords(T) {
  const k = T.kind;
  if (T.stage === 'radius') return new Set();
  if (k === 'line' || k === 'polyline') return new Set(['c', 'close', 'u', 'undo']);
  if (k === 'circle') return new Set(['d', 'diameter', 'r', 'radius', 'u', 'undo']);
  if (k === 'rrect') return new Set(['r', 'radius', 'u', 'undo']);
  return new Set(['u', 'undo']);
}

/** Does Shift / ORTHO keep the next point straight along X or Y from the last one here? (lines, polylines and an ellipse's first axis) */
export function orthoApplies(T) {
  return T.kind === 'line' || T.kind === 'polyline' || (T.kind === 'ellipse' && T.pts.length === 1);
}
