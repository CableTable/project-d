// autodim.js — pure: the Automatic dimension (DIM): which dimension a pick gives and how the pointer shapes it — autodim.test.mjs.
//
//   targetOf(ent, p)         → what a pick at p dimensions: { type: 'line', l } (a LINE or a polyline segment), { type: 'arc' | 'circle', c, r }, or null
//   autoDraft(target, at, as) → { kind, params } for edit.js dimGeom with the pointer at `at` (as: 'radius' | 'diameter' for an arc / circle), or null
//   stageOf / optionsOf / promptOf / optionOf / back / secondLine → the prompt, its options (Text, Undo, Diameter / Radius), Undo's step back and the two-line angle test
//   ghostAt(target, p, off)  → where the faint hover preview puts its pointer (a line's dimension line `off` beside the line)
import { circleOf, segmentOf, linearAxis, dimOffsetAt, diameterEnds, angleBetween } from './edit.js';

export function targetOf(ent, p) {
  const l = segmentOf(ent, p);
  if (l) return { type: 'line', l };
  const k = circleOf(ent);
  return k && { type: ent && ent.type === 'ARC' ? 'arc' : 'circle', ...k };
}

/** 'h' / 'v' when the dimension of line l with the pointer at p is horizontal / vertical, null for aligned: beside the line (between its ends' perpendiculars) it follows the line, beyond an end it is horizontal above or below it and vertical to its side. */
export function lineAxis(l, p) {
  const dx = l[2] - l[0], dy = l[3] - l[1], len = Math.hypot(dx, dy);
  if (Math.abs(dy) < 1e-9 * len) return 'h';
  if (Math.abs(dx) < 1e-9 * len) return 'v';
  const t = ((p[0] - l[0]) * dx + (p[1] - l[1]) * dy) / len;
  return t >= 0 && t <= len ? null : linearAxis([l[0], l[1]], [l[2], l[3]], p);
}

/** 'radius' or 'diameter' for an arc / circle pick: what the R / D option chose, else an arc gives a radius and a circle a diameter. */
export const asOf = (obj, as) => as || (obj.type === 'arc' ? 'radius' : 'diameter');

export function autoDraft(target, at, as) {
  if (!target || !at) return null;
  if (target.type === 'line') {
    const a = [target.l[0], target.l[1]], b = [target.l[2], target.l[3]], axis = lineAxis(target.l, at);
    return { kind: axis ? 'linear' : 'aligned', params: { a, b, ...(axis && { axis }), offset: dimOffsetAt(a, b, at, axis) } };
  }
  if (asOf(target, as) === 'radius') return { kind: 'radius', params: { c: target.c, r: target.r, p: at } };
  const ends = diameterEnds(target.c, target.r, at);
  return ends && { kind: 'diameter', params: { ...ends, offset: 0 } };
}

/** What DIM waits for, from its picks { obj, lines, pts }: 'first' | 'second' (points mode: the second origin) | 'points' (points mode: the location) | 'line' | 'arc' | 'circle' | 'angle'. */
export const stageOf = ({ obj, lines, pts }) => lines.length === 2 ? 'angle' : obj ? obj.type : pts.length === 2 ? 'points' : pts.length === 1 ? 'second' : 'first';

/** The option words of the prompt at this stage (s: the picks plus `as`), in prompt order. */
export function optionsOf(s) {
  const st = stageOf(s);
  if (st === 'first' || st === 'second') return ['Undo'];
  return [...(st === 'arc' || st === 'circle' ? [asOf(s.obj, s.as) === 'radius' ? 'Diameter' : 'Radius'] : []), 'Text', 'Undo'];
}

const LEAD = { first: 'Select a line, arc or circle, or specify first extension line origin', second: 'Specify second extension line origin or', points: 'Specify dimension line location or',
  line: 'Specify dimension line location or second line for angle', angle: 'Specify angular dimension location or' };
export function promptOf(s) {
  const st = stageOf(s);
  return `${st === 'arc' || st === 'circle' ? `Specify ${asOf(s.obj, s.as)} dimension location or` : LEAD[st]} [${optionsOf(s).join('/')}]:`;
}

/** The option a typed letter or word names at this stage ('Text', 'Undo', 'Diameter', 'Radius'), else null. */
export function optionOf(s, text) {
  const t = String(text).trim().toLowerCase();
  return t ? optionsOf(s).find((w) => w.toLowerCase() === t || w[0].toLowerCase() === t) || null : null;
}

/** The picks one step back (Undo inside a dimension), or null at the first prompt (there Undo takes back the last dimension). */
export function back({ obj, lines, pts }) {
  if (lines.length === 2) return { obj, lines: [], pts };
  return obj || pts.length ? { obj: null, lines: [], pts: obj ? [] : pts.slice(0, -1) } : null;
}

/** The line l of target when it is a second line for an angle with the picked line `first` (a target); null for anything else, and for a parallel (or the same) line. */
export function secondLine(first, target) {
  if (!first || first.type !== 'line' || !target || target.type !== 'line') return null;
  return angleBetween(first.l, target.l, [0, 0]) ? target.l : null;
}

export function ghostAt(target, p, off) {
  if (target.type !== 'line') return p;
  const [x1, y1, x2, y2] = target.l, len = Math.hypot(x2 - x1, y2 - y1);
  return [p[0] - (y2 - y1) / len * off, p[1] + (x2 - x1) / len * off];
}
