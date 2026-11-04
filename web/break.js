// Break a finite path at projected points, in drawing units. Pure: break.test.mjs.
import { shapeOf, get } from './grips.js';
import { pathOf, closest, subSeg, shapeOfPiece, rebuilt } from './modify.js';

/** Pieces keep the source properties; document GROUP membership is remapped by the caller. */
export function breakEntity(entity, p1, p2) {
  if (!['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE'].includes(entity?.type)) return null;
  if (![p1, p2].every((p) => p?.length >= 2 && p.slice(0, 2).every(Number.isFinite))) return null;
  if (entity.type !== 'LINE' && (Math.abs(get(entity.r, 210) ?? 0) > 1e-9 || Math.abs(get(entity.r, 220) ?? 0) > 1e-9)) return null;
  const sh = shapeOf(entity), flip = entity.type !== 'LINE' && (get(entity.r, 230) ?? 1) < 0;
  if (flip) {
    if (sh.t === 'poly') sh.pts = sh.pts.map(([x, y, b = 0, ...w]) => [-x, y, -b, ...w]);
    else {
      sh.c = [-sh.c[0], sh.c[1]];
      if (sh.t === 'arc') [sh.a0, sh.a1] = [180 - sh.a1, 180 - sh.a0];
    }
  }
  if (sh.t === 'circle') {
    if (!(sh.r > 0)) return null;
    const angle = (p) => (Math.atan2(p[1] - sh.c[1], p[0] - sh.c[0]) * 180 / Math.PI + 360) % 360;
    return [rebuilt({ ...sh, t: 'arc', a0: angle(p2), a1: angle(p1) }, entity)];
  }
  const path = pathOf(sh);
  // pathOf omits the closing segment of a two-vertex closed polyline.
  if (sh.t === 'poly' && sh.closed && sh.pts.length === 2) {
    path.closed = true; path.segs.push({ a: sh.pts[1], b: sh.pts[0], bulge: sh.pts[1][2] || 0 });
  }
  const n = path.segs.length;
  if (!n || path.segs.some((s) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) < 1e-9)) return null;
  let a = closest(path, p1).u, b = closest(path, p2).u;
  if (!path.closed && a > b) [a, b] = [b, a];
  const ranges = path.closed ? [[b, a > b ? a : a + n]] : [[0, a], [b, n]];
  return ranges.flatMap(([lo, hi]) => {
    const segs = [];
    for (let k = Math.floor(lo); k < Math.ceil(hi); k++) {
      const f0 = Math.max(0, lo - k), f1 = Math.min(1, hi - k);
      if (f1 - f0 > 1e-9) segs.push(subSeg(path.segs[k % n], f0, f1));
    }
    const piece = shapeOfPiece(segs, path.type);
    return piece ? [rebuilt(piece, entity)] : [];
  });
}

/** A closed object needs two points; null lets the caller explain the refusal. */
export function breakAtPoint(entity, p) {
  if (entity?.type === 'CIRCLE' || entity?.type === 'LWPOLYLINE' && ((get(entity.r, 70) ?? 0) & 1)) return null;
  return breakEntity(entity, p, p);
}
