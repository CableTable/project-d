// autodim.js — pure: the Automatic dimension (DIM): which dimension a pick gives and how the pointer shapes it — autodim.test.mjs.
//
//   targetOf(ent, p)         → what a pick at p dimensions: { type: 'line', l } (a LINE or a polyline segment), { type: 'arc' | 'circle', c, r }, or null
//   autoDraft(target, at)    → { kind, params } for edit.js dimGeom with the pointer at `at`, or null
//   ghostAt(target, p, off)  → where the faint hover preview puts its pointer (a line's dimension line `off` beside the line)
import { circleOf, segmentOf, linearAxis, dimOffsetAt, diameterEnds } from './edit.js';

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

export function autoDraft(target, at) {
  if (!target || !at) return null;
  if (target.type === 'line') {
    const a = [target.l[0], target.l[1]], b = [target.l[2], target.l[3]], axis = lineAxis(target.l, at);
    return { kind: axis ? 'linear' : 'aligned', params: { a, b, ...(axis && { axis }), offset: dimOffsetAt(a, b, at, axis) } };
  }
  if (target.type === 'arc') return { kind: 'radius', params: { c: target.c, r: target.r, p: at } };
  const ends = diameterEnds(target.c, target.r, at);
  return ends && { kind: 'diameter', params: { ...ends, offset: 0 } };
}

export function ghostAt(target, p, off) {
  if (target.type !== 'line') return p;
  const [x1, y1, x2, y2] = target.l, len = Math.hypot(x2 - x1, y2 - y1);
  return [p[0] - (y2 - y1) / len * off, p[1] + (x2 - x1) / len * off];
}
