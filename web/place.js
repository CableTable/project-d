// place.js — pure: moving, turning, mirroring and copying a placed part (no DOM) — place.test.mjs.
//
// A placed part is apply.js's { partId, x, y, rot, mirrorX, mirrorY }: (x, y) is where the part's own lower-left corner lands on
// the sheet (mm, y up), rot is degrees anticlockwise, and a mirror flips the part about its own corner before it is turned.
// Every function takes the part ({ w, h } in mm) and a placement and returns a NEW placement; nothing is changed in place.
import { placedBox } from './apply.js';

/** A number rounded to 6 decimals (what a DXF keeps), never "-0". */
/** The grid a new part's position snaps to when it is added to a sheet (TODO 45), mm: whole mm (his pick, 2026-10-18). */
export const NEW_GRID = 1;
/** v on the grid (whole multiples of g), no -0. */
export const snapGrid = (v, g = NEW_GRID) => { const r = Math.round(v / g) * g; return r === 0 ? 0 : r; };
export const r6 = (v) => { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; };

/** An angle in degrees as 0 ≤ a < 360, rounded so 360 and 359.9999999 are both 0. */
export function normAngle(a) {
  let r = r6(((a % 360) + 360) % 360);
  if (r >= 360) r = 0;
  return r;
}

const rad = (d) => d * Math.PI / 180;

/** A point of the part's own box (u across, v up, mm) on the sheet. */
export function toSheet(pl, u, v) {
  const th = rad(pl.rot || 0), co = Math.cos(th), si = Math.sin(th);
  const p = u * (pl.mirrorX ? -1 : 1), q = v * (pl.mirrorY ? -1 : 1);
  return [pl.x + co * p - si * q, pl.y + si * p + co * q];
}

/** The part's four corners on the sheet, [[x, y] × 4]: its lower-left, lower-right, upper-right and upper-left as drawn before the turn. */
export const corners = (part, pl) => [[0, 0], [part.w, 0], [part.w, part.h], [0, part.h]].map(([u, v]) => toSheet(pl, u, v));

/** The middle of the part on the sheet. */
export const centreOf = (part, pl) => toSheet(pl, part.w / 2, part.h / 2);

/** The eight handle points of the part's outline: the four corners then the four mid-sides (bottom, right, top, left). */
export function handlePoints(part, pl) {
  const c = corners(part, pl), mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return [...c, mid(c[0], c[1]), mid(c[1], c[2]), mid(c[2], c[3]), mid(c[3], c[0])];
}

/** A pivot as a point: 'centre', 'bl' (the part's own lower-left corner, which turns with it) or 'custom' (the given [x, y]). */
export function pivotOf(part, pl, kind, custom) {
  if (kind === 'custom' && custom) return [custom[0], custom[1]];
  if (kind === 'bl') return [pl.x, pl.y];
  return centreOf(part, pl);
}

/** The part turned by `deg` (anticlockwise) about the sheet point `pivot`. */
export function rotateAbout(part, pl, pivot, deg) {
  const th = rad(deg), co = Math.cos(th), si = Math.sin(th), dx = pl.x - pivot[0], dy = pl.y - pivot[1];
  return { ...pl, x: r6(pivot[0] + co * dx - si * dy), y: r6(pivot[1] + si * dx + co * dy), rot: normAngle((pl.rot || 0) + deg) };
}

/** The part turned about `pivot` so that its angle is `deg`. */
export const setAngleAbout = (part, pl, pivot, deg) => rotateAbout(part, pl, pivot, normAngle(deg) - normAngle(pl.rot || 0));

/**
 * The part mirrored about the vertical ('x': left to right) or horizontal ('y': top to bottom) line through its own centre.
 * A mirror reverses the turn, so the angle becomes 360 − angle and the mirror flag is toggled.
 */
export function mirrorAbout(part, pl, axis) {
  const [cx, cy] = centreOf(part, pl);
  if (axis === 'x') return { ...pl, x: r6(2 * cx - pl.x), rot: normAngle(-(pl.rot || 0)), mirrorX: !pl.mirrorX };
  return { ...pl, y: r6(2 * cy - pl.y), rot: normAngle(-(pl.rot || 0)), mirrorY: !pl.mirrorY };
}

/**
 * The part mirrored about the vertical ('x') or horizontal ('y') line through the sheet point (cx, cy): for a selection of several
 * parts, the line through the middle of the whole selection. With the part's own centre as (cx, cy) it is mirrorAbout.
 */
export function mirrorAboutPoint(part, pl, axis, cx, cy) {
  const [mx, my] = centreOf(part, pl), m = mirrorAbout(part, pl, axis);
  return axis === 'x' ? translate(m, r6(2 * (cx - mx)), 0) : translate(m, 0, r6(2 * (cy - my)));
}

/** The part moved by (dx, dy) mm. */
export const translate = (pl, dx, dy) => ({ ...pl, x: r6(pl.x + dx), y: r6(pl.y + dy) });

/** The part moved so the lower-left of its box on the sheet (what the X and Y fields show) is at (x, y). */
export function moveBoxTo(part, pl, x, y) {
  const b = placedBox(part, pl);
  return translate(pl, x - b[0], y - b[1]);
}

/**
 * `count` copies in a row from the part, along X or Y, the gap between neighbours measured edge to edge (the box each covers on
 * the sheet), the first one a gap away from the part. A negative gap overlaps them.
 */
export function duplicateRow(part, pl, axis, gap, count) {
  // axis: 'x' (right), '-x' (left), 'y' (up) or '-y' (down)
  const along = axis.replace('-', ''), sign = axis[0] === '-' ? -1 : 1;
  const b = placedBox(part, pl), step = sign * ((along === 'y' ? b[3] - b[1] : b[2] - b[0]) + gap), out = [];
  for (let k = 1; k <= count; k++) out.push(along === 'y' ? translate(pl, 0, k * step) : translate(pl, k * step, 0));
  return out;
}

/** Where `count` copies of whatever fills `box` ([x0, y0, x1, y1]) go in a row: [[dx, dy]] per copy, the gap measured edge to edge. axis: 'x', '-x', 'y' or '-y'. */
export function rowOffsets(box, axis, gap, count) {
  const along = axis.replace('-', ''), sign = axis[0] === '-' ? -1 : 1;
  const step = sign * ((along === 'y' ? box[3] - box[1] : box[2] - box[0]) + gap), out = [];
  for (let k = 1; k <= count; k++) out.push(along === 'y' ? [0, r6(k * step)] : [r6(k * step), 0]);
  return out;
}

/** The step for an arrow key: ('left' | 'right' | 'up' | 'down', step mm, big = Shift → 10 ×) → [dx, dy]; up is +Y. */
export function nudgeVector(dir, step, big) {
  const d = step * (big ? 10 : 1);
  return { left: [-d, 0], right: [d, 0], up: [0, d], down: [0, -d] }[dir] || [0, 0];
}

/** An angle snapped to the nearest multiple of `step` degrees. */
export const snapAngle = (deg, step = 15) => normAngle(Math.round(deg / step) * step);

/** The direction of `pt` seen from `pivot`, degrees anticlockwise from +X (y up). */
export const angleOf = (pivot, pt) => Math.atan2(pt[1] - pivot[1], pt[0] - pivot[0]) * 180 / Math.PI;

/** The shortest turn from angle a to angle b, in (-180, 180]. */
export function turnBetween(a, b) {
  let d = ((b - a) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

/** Does the part's box leave the sheet (0,0 to W,H)? A hair of tolerance for rounding. */
export function offSheet(part, pl, W, H) {
  const b = placedBox(part, pl), t = 1e-6;
  return b[0] < -t || b[1] < -t || b[2] > W + t || b[3] > H + t;
}

/** A length typed in mm ("12", "12.5", "12,5", "-3"): the number, or null. */
export function parseMm(text) {
  const s = String(text).trim().replace(',', '.').replace(/\s*mm$/i, '');
  if (s === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** An angle typed in degrees ("30", "-15.5", "30°"): the number, or null. */
export const parseAngle = (text) => parseMm(String(text).trim().replace(/\s*(°|deg)$/i, ''));

/** Is this placement the same as that one (position, turn, mirror)? */
export const samePlacement = (a, b) => a.partId === b.partId && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 &&
  normAngle(a.rot || 0) === normAngle(b.rot || 0) && !!a.mirrorX === !!b.mirrorX && !!a.mirrorY === !!b.mirrorY;
