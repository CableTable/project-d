// ALIGN's maths: one pair of points moves, two pairs also turn (and, if asked, scale) about the first destination point. No DOM.
import { moveEntities } from './edit.js';
import { rotateEntities } from './rotate.js';
import { scaleEntities } from './scale.js';

export const SAME_SRC = 'The two source points are the same: pick a different second source point';
export const SAME_DST = 'The two destination points are the same: pick a different second destination point';

/**
 * The move / turn / scale that takes source point 1 to destination 1 and the line source 1 → 2 onto destination 1 → 2.
 * → { dx, dy, angle (degrees, ccw), factor (1 unless `scale`), pivot (= dst1), src1 } or { error } when a pair of points coincides.
 */
export function alignTransform(src1, dst1, src2 = null, dst2 = null, scale = false) {
  const t = { dx: dst1[0] - src1[0], dy: dst1[1] - src1[1], angle: 0, factor: 1, pivot: dst1.slice(0, 2), src1: src1.slice(0, 2) };
  if (!src2 || !dst2) return t;
  const sx = src2[0] - src1[0], sy = src2[1] - src1[1], ex = dst2[0] - dst1[0], ey = dst2[1] - dst1[1], sl = Math.hypot(sx, sy), el = Math.hypot(ex, ey);
  if (sl < 1e-9) return { error: SAME_SRC };
  if (el < 1e-9) return { error: SAME_DST };
  t.angle = (Math.atan2(ey, ex) - Math.atan2(sy, sx)) * 180 / Math.PI;
  if (t.angle > 180) t.angle -= 360; else if (t.angle <= -180) t.angle += 360;
  if (scale) t.factor = el / sl;
  return t;
}

/** The same transform as a canvas matrix [a, b, c, d, e, f] (the preview of the drawing tab). */
export function alignMatrix(t) {
  const a = t.angle * Math.PI / 180, k = t.factor, c = k * Math.cos(a), s = k * Math.sin(a), [x, y] = t.src1;
  return [c, s, -s, c, t.pivot[0] - c * x + s * y, t.pivot[1] - s * x - c * y];
}

/** The selection moved, then turned and scaled about the first destination point: Move's, Rotate's and Scale's own entity code. */
export function alignEntities(raw, selection, t) {
  let next = moveEntities(raw, selection, t.dx, t.dy);
  if (t.angle) next = rotateEntities(next, selection, t.pivot, t.angle);
  if (t.factor !== 1) next = scaleEntities(next, selection, t.pivot, t.factor);
  return next;
}
