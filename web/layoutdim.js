// layoutdim.js — pure: a dimension on a layout (TODO 156b2c1) — layoutdim.test.mjs.
//
// A dimension on a layout is a layout object (layoutdoc.js) whose one entity is the INSERT of a PD_DIM block at 0,0, with the block
// (lines, arrowheads, text, all in sheet mm) in part.raw.blocks. Move / Rotate / Scale / Mirror change its placement like any object's;
// bakeDim() then puts that placement into the block's own points (a rotate turns the text, a scale re-labels it, a mirror keeps it
// readable), which is what the file and every other command see: a settled dimension is always at the identity placement.
import { mapply } from './drawing.js';
import { DIM_BLOCK, relabel } from './edit.js';

const DEG = Math.PI / 180;
const field = (r, c) => { const k = r.c.indexOf(c); return k < 0 ? NaN : +r.v[k]; };
const norm = (deg) => ((deg % 360) + 360) % 360;
const text = (v) => String(+v.toPrecision(15));

/** The name of the block a dimension object holds, or ''. */
export const dimName = (part) => {
  const e = part && part.obj && part.raw.entities.length === 1 ? part.raw.entities[0] : null;
  return e && e.type === 'INSERT' ? String(e.r.v[e.r.c.indexOf(2)] ?? '').trim() : '';
};
/** Is this layout object a dimension (an INSERT of a PD_DIM block that the part holds)? */
export const isDimPart = (part) => { const n = dimName(part); return !!n && DIM_BLOCK.test(n) && !!part.raw.blocks && !!part.raw.blocks[n]; };

/** The matrix [a, b, c, d, e, f] (x' = a x + c y + e) from a part's own sheet mm to the sheet for a placement (apply.js placedBox's maths). */
export function placeMatrix(part, p) {
  const th = (p.rot || 0) * DEG, co = Math.cos(th), si = Math.sin(th), k = p.sc || 1, sx = (p.mirrorX ? -1 : 1) * k, sy = (p.mirrorY ? -1 : 1) * k, [b0, b1] = part.box;
  const a = co * sx, b = si * sx, c = -si * sy, d = co * sy;
  return [a, b, c, d, p.x - a * b0 - c * b1, p.y - b * b0 - d * b1];
}
/** Is the placement the identity (the part lies where it is drawn)? */
export const isSettled = (part, p) => !p.rot && (p.sc || 1) === 1 && !p.mirrorX && !p.mirrorY && Math.abs(p.x - part.box[0]) < 1e-9 && Math.abs(p.y - part.box[1]) < 1e-9;

/** A block with the placement p baked in: every point mapped, arcs turned (or swapped under a mirror), text turned (parallel to its line, upright) and scaled, the label re-measured. */
export function bakeBlock(block, part, p) {
  const M = placeMatrix(part, p), k = p.sc || 1, flip = !!p.mirrorX !== !!p.mirrorY;
  const dir = (deg) => { const t = deg * DEG, x = M[0] * Math.cos(t) + M[2] * Math.sin(t), y = M[1] * Math.cos(t) + M[3] * Math.sin(t); return Math.atan2(y, x) / DEG; };
  let ents = block.entities.map((e) => {
    const edit = {}, has = (c) => e.r.c.includes(c);
    for (const [cx, cy] of [[10, 20], [11, 21], [12, 22], [13, 23]]) if (has(cx) && has(cy)) { const q = mapply(M, field(e.r, cx), field(e.r, cy)); edit[cx] = q[0]; edit[cy] = q[1]; }
    if (e.type === 'ARC') {
      let s = dir(field(e.r, 50)), t = dir(field(e.r, 51));
      if (flip) [s, t] = [t, s];
      edit[40] = field(e.r, 40) * k; edit[50] = norm(s); edit[51] = norm(t);
    }
    if (e.type === 'TEXT') {       // stays parallel to its line (its angle goes through the same map as the line's direction) and reads upright
      edit[40] = field(e.r, 40) * k;
      const a0 = has(50) ? field(e.r, 50) : 0, va = has(73) ? field(e.r, 73) : 0, up = (d) => [-Math.sin(d * DEG), Math.cos(d * DEG)];
      let a = norm(dir(a0));
      if (a > 90 + 1e-6 && a <= 270 + 1e-6) a = norm(a - 180);
      if (va === 1 || va === 3) {   // the text keeps to its own side of the line: bottom-aligned (1) when it now reads away from the line, top-aligned (3) when towards it
        const [ux, uy] = up(a0), s = va === 1 ? 1 : -1, [vx, vy] = up(a);
        edit[73] = s * (vx * (M[0] * ux + M[2] * uy) + vy * (M[1] * ux + M[3] * uy)) > 0 ? 1 : 3;
      }
      if (has(50) || a > 1e-9 && a < 360 - 1e-9) edit[50] = a;
    }
    const c = e.r.c.slice(), v = e.r.v.slice();
    for (const [code, val] of Object.entries(edit)) { let i = c.indexOf(+code); if (i < 0) { i = c.length; c.push(+code); } v[i] = text(val); }
    return { ...e, r: { ...e.r, c, v } };
  });
  if (k !== 1) ents = relabel(ents, k);
  return { ...block, base: [0, 0], entities: ents };
}

/** The block name tag after a turn: a horizontal / vertical Linear dimension turned a quarter turn swaps, any other turn makes it Aligned (no tag). */
export function turnedTag(tag, rot) {
  if (tag !== 'H' && tag !== 'V') return tag;
  const r = norm(rot || 0);
  if (Math.abs(r) < 1e-9 || Math.abs(r - 180) < 1e-9) return tag;
  return Math.abs(r - 90) < 1e-9 || Math.abs(r - 270) < 1e-9 ? (tag === 'H' ? 'V' : 'H') : '';
}
/** The first free PD_DIM_<tag>n among the names in `taken` (a Set). */
export function freeBlockName(taken, tag = '') {
  let n = 1;
  while (taken.has(`PD_DIM_${tag}${n}`) || taken.has(`pd_dim_${tag}${n}`.toLowerCase())) n++;   // block names ignore case (apply.js mergePart); settleDims stores them lower-case
  return `PD_DIM_${tag}${n}`;
}
/** The tag letter ('' | H | V | R | D | A) of a PD_DIM block name. */
export const tagOf = (name) => (/^PD_DIM_([RDAHV]?)\d+$/.exec(name) || [, ''])[1];
