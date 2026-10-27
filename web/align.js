// Alignment guides: sheet mm, y up; span is the target's extent along the line. See align.test.mjs.
import { gripOf } from './layout.js';
import { snapBoxToGuides } from './guides.js';

/** Sheet edges / centres and the inner edges of nonzero gripper margins. */
export function sheetAlignmentLines(o) {
  const W = o.sheetW, H = o.sheetH;
  const lines = [
    ...[0, W / 2, W].map((mm) => ({ axis: 'x', mm, span: [0, H] })),
    ...[0, H / 2, H].map((mm) => ({ axis: 'y', mm, span: [0, W] })),
  ];
  const left = gripOf(o, 'left'), right = gripOf(o, 'right'), bottom = gripOf(o, 'bottom'), top = gripOf(o, 'top');
  if (left) lines.push({ axis: 'x', mm: left, span: [bottom, H - top] });
  if (right) lines.push({ axis: 'x', mm: W - right, span: [bottom, H - top] });
  if (bottom) lines.push({ axis: 'y', mm: bottom, span: [left, W - right] });
  if (top) lines.push({ axis: 'y', mm: H - top, span: [left, W - right] });
  return lines;
}

/** Nearest per axis; Guidelines precede Alignment guides so a Guideline wins a tie. */
export function snapBoxToAlignment(box, lines, guidelines, tol, options) {
  return snapBoxToGuides(box, [...guidelines, ...lines], tol, options);
}

/** Finite Alignment guide segments across the moved box and target; Guidelines draw separately. */
export function alignmentSegments(box, hits) {
  return hits.filter((hit) => hit.span).map(({ axis, mm, span }) => axis === 'x'
    ? [mm, Math.min(box[1], span[0]), mm, Math.max(box[3], span[1])]
    : [Math.min(box[0], span[0]), mm, Math.max(box[2], span[1]), mm]);
}
