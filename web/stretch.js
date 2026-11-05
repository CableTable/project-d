// Crossing-box Stretch, pure (drawing units); the hot-grip editor shares the same drag loop.
import * as GR from './grips.js';
import { lwpoly } from './dxf-write.js';

/** Stretch one object's hot grips; label and part also drive the grip editor's preview. */
export function stretchGrips(ent, hots, dx, dy, shift = false, whole = GR.wholeHot(ent, new Set(hots.map((x) => x.id)))) {
  let cur = ent, label = null, part = false;
  // Move all hot points together: a first drag could otherwise land on the next point's old spot.
  if (whole) { if (dx || dy) cur = GR.translate(ent, dx, dy); label = 'Move'; }
  else {
    for (const x of GR.stretchHots(ent, hots)) {
      const r = GR.dragGrip(cur, x.id, [x.x + dx, x.y + dy], shift);
      if (r) { cur = r.ent; label = label || r.label; }
    }
    if ((ent.type === 'MTEXT' || ent.type === 'INSERT' || ent.type === 'HATCH') && hots.some((x) => !GR.movesWhole(ent, x.id))) part = true;
  }
  return { ent: cur, label, part };
}

/** Types without visible vertex grips use a temporary polyline; only coordinates are written back. */
function vertexAdapter(ent) {
  const points = [];
  const scan = (r, codes, kid = null) => {
    for (let k = 0; k < r.c.length; k++) {
      const code = r.c[k];
      if (!codes.includes(code)) continue;
      let ky = k + 1;
      while (ky < r.c.length && r.c[ky] !== code + 10 && !codes.includes(r.c[ky])) ky++;
      if (r.c[ky] === code + 10) points.push({ r, kx: k, ky, kid });
    }
  };
  if (ent.type === 'POLYLINE') {
    if ((GR.get(ent.r, 70) ?? 0) & (16 | 32 | 64)) return null;
    (ent.kids || []).forEach((r, i) => { if (r.type === 'VERTEX') scan(r, [10], i); });
  } else if (ent.type === 'SPLINE') scan(ent.r, [10, 11]);
  // shortcut: native dimension graphics live in document blocks; rebuild those when the command applies these definition points.
  else if (ent.type === 'DIMENSION') scan(ent.r, [10, 11, 12, 13, 14, 15, 16]);
  else if (ent.type === 'LEADER' && !ent.model) scan(ent.r, [10]);
  else return null;
  const poly = lwpoly(points.map(({ r, kx, ky }) => [GR.num(r.v[kx]), GR.num(r.v[ky])]));
  return { poly, restore: (changed) => {
    let r = ent.r, kids = ent.kids;
    GR.lwVertices(changed.r).forEach((p, i) => {
      const src = points[i];
      if (p.x === GR.num(src.r.v[src.kx]) && p.y === GR.num(src.r.v[src.ky])) return;
      if (src.kid == null) r = GR.withValues({ r }, [[src.kx, p.x], [src.ky, p.y]]).r;
      else {
        if (kids === ent.kids) kids = kids.slice();
        kids[src.kid] = GR.withValues({ r: kids[src.kid] }, [[src.kx, p.x], [src.ky, p.y]]).r;
      }
    });
    return { ...ent, r, ...(kids ? { kids } : {}) };
  } };
}

const WHOLE = new Set(['CIRCLE', 'ELLIPSE', 'TEXT', 'MTEXT', 'INSERT', 'POINT', 'IMAGE']);
function definingGrips(ent) {
  if (WHOLE.has(ent.type)) {
    if (!ent.r) return [];
    return [{ id: 'c', x: GR.get(ent.r, 10) ?? 0, y: GR.get(ent.r, 20) ?? 0 }];
  }
  return GR.gripsOf(ent).filter((g) => g.kind === 'end' || g.kind === 'vertex');
}

/** Points in any box are hot; picked indices move whole. Counts are changed objects, never points. */
export function stretchEntities(entities, boxes, dx, dy, picked = new Set()) {
  if (![dx, dy].every(Number.isFinite)) throw new Error('Stretch needs finite distances');
  const next = new Map();
  let moved = 0, stretched = 0;
  if (!dx && !dy) return { next, moved, stretched };
  const inside = (p) => boxes.some((b) => p.x >= Math.min(b.x0, b.x1) && p.x <= Math.max(b.x0, b.x1)
    && p.y >= Math.min(b.y0, b.y1) && p.y <= Math.max(b.y0, b.y1));
  entities.forEach((ent, i) => {
    const adapter = vertexAdapter(ent), source = adapter?.poly || ent;
    const all = definingGrips(source), hots = all.filter(inside);
    const whole = picked.has(i) || all.length > 0 && hots.length === all.length;
    if (!whole && !hots.length) return;
    const target = whole && !(ent.type === 'LEADER' && adapter) ? ent : source;
    const result = stretchGrips(target, hots, dx, dy, false, whole);
    if (result.ent === target) return;
    next.set(i, adapter && target === source ? adapter.restore(result.ent) : result.ent);
    if (whole) moved++; else stretched++;
  });
  return { next, moved, stretched };
}
