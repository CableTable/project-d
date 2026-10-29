// Explode, pure: one level of polylines or block members, in drawing units.
import { bulgeArc, mmul, mapply } from './drawing.js';
import { lwVertices, get } from './grips.js';
import { entity, line, arc, circle, ellipse, lwpoly, insert, mtext } from './dxf-write.js';
import { DIM_BLOCK, usedBlocks } from './edit.js';
import { textRecord } from './dimension-text.js';

const DEG = Math.PI / 180, TAU = 2 * Math.PI, ID = [1, 0, 0, 1, 0, 0];
const val = (e, c, fallback = 0) => get(e.r, c) ?? fallback;
const field = (e, c) => e.r.v[e.r.c.indexOf(c)]?.trim();
const angle = (r) => ((r / DEG % 360) + 360) % 360;
const det = (m) => m[0] * m[3] - m[1] * m[2];
const vector = (m, x, y) => [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
const similar = (m) => Math.abs(m[0] ** 2 + m[1] ** 2 - m[2] ** 2 - m[3] ** 2) < 1e-10 * Math.max(...m.slice(0, 4).map((v) => v * v)) && orthogonal(m);
const orthogonal = (m) => Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-10 * Math.hypot(m[0], m[1]) * Math.hypot(m[2], m[3]);

const fromRecord = (r) => entity(r.type, r.c.map((c, i) => [c, r.v[i]]), {
  layer: r.v[r.c.indexOf(8)]?.trim(), lt: r.v[r.c.indexOf(6)]?.trim(), aci: get(r, 62), tc: get(r, 420),
  lw: get(r, 370), lts: get(r, 48), hidden: get(r, 60) === 1, ps: get(r, 67) === 1,
});

function vertices(e) {
  if (e.type === 'LWPOLYLINE') return lwVertices(e.r).map((p) => [p.x, p.y, p.b]);
  if (val(e, 70) & (16 | 64)) throw new Error('polygon meshes stay intact');
  return (e.kids || []).filter((r) => r.type === 'VERTEX').map((r) => [get(r, 10) ?? 0, get(r, 20) ?? 0, get(r, 42) ?? 0]);
}

/** LINEs and anticlockwise ARCs, including the last-to-first segment of a closed polyline. */
export function explodePolyline(e) {
  if (!['LWPOLYLINE', 'POLYLINE'].includes(e.type)) return null;
  if (val(e, 210) || val(e, 220) || e.type === 'POLYLINE' && (val(e, 70) & 8)) throw new Error('tilted polylines stay intact');
  const pts = vertices(e), out = [], closed = val(e, 70) & 1, src = { ...e, fill: null };   // the pieces are open lines and arcs: no fill
  const m =e.flip ? [-1, 0, 0, 1, 0, 0] : ID;
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const a = p[2] ? bulgeArc(p, q, p[2]) : null;
    if (a) {
      const [x, y] = mapply(m, a[0], a[1]), flip = !!a[5] !== !!e.flip;
      const t = (v) => angle(Math.atan2(Math.sin(v), Math.cos(v) * m[0]));
      out.push(arc(x, y, a[2], t(a[flip ? 4 : 3]), t(a[flip ? 3 : 4]), src));
    } else {
      out.push(line(...mapply(m, p[0], p[1]), ...mapply(m, q[0], q[1]), src));
    }
  }
  return out;
}

/** A circle/ellipse basis under any nonsingular affine transform; no curve sampling. */
function conic(c, u, v, a0, a1, full, m, o) {
  c = mapply(m, ...c); u = vector(m, ...u); v = vector(m, ...v);
  const xx = u[0] ** 2 + v[0] ** 2, yy = u[1] ** 2 + v[1] ** 2, xy = u[0] * u[1] + v[0] * v[1];
  const theta = .5 * Math.atan2(2 * xy, xx - yy), axis = [Math.cos(theta), Math.sin(theta)];
  const major = Math.hypot(u[0] * axis[0] + u[1] * axis[1], v[0] * axis[0] + v[1] * axis[1]);
  const minor = Math.abs(u[0] * v[1] - u[1] * v[0]) / major;
  if (!(major > 0 && minor > 0) || !Number.isFinite(major + minor)) throw new Error('degenerate curve stays intact');
  const param = (t) => {
    const x = u[0] * Math.cos(t) + v[0] * Math.sin(t), y = u[1] * Math.cos(t) + v[1] * Math.sin(t);
    return Math.atan2((-x * axis[1] + y * axis[0]) / minor, (x * axis[0] + y * axis[1]) / major);
  };
  let start = param(a0), end = param(a1);
  if (u[0] * v[1] - u[1] * v[0] < 0) [start, end] = [end, start];
  if (full) { start = 0; end = TAU; }
  if (Math.abs(major - minor) < 1e-10 * major) {
    return full ? circle(...c, major, o) : arc(...c, major, angle(start + theta), angle(end + theta), o);
  }
  return ellipse(...c, axis[0] * major, axis[1] * major, minor / major, start, end, o);
}

function placement(e, base = [0, 0], col = 0, row = 0) {
  const t = val(e, 50) * DEG, c = Math.cos(t), s = Math.sin(t), sx = val(e, 41, 1), sy = val(e, 42, 1);
  return mmul([c, s, -s, c, val(e, 10), val(e, 20)], [sx, 0, 0, sy, col * val(e, 44) - base[0] * sx, row * val(e, 45) - base[1] * sy]);
}

function inherited(e, parent, layers) {
  const o = { ...e, layer: e.layer === '0' ? parent.layer : e.layer, ps: parent.ps };
  if (e.aci === 0 && e.tc == null) {
    const colour = parent.aci === 256 || parent.aci == null ? layers[parent.layer] : parent;
    o.aci = colour?.aci ?? 7; o.tc = parent.tc ?? colour?.tc ?? null;
  }
  if (e.lt?.toUpperCase() === 'BYBLOCK') o.lt = parent.lt && parent.lt.toUpperCase() !== 'BYLAYER' ? parent.lt : layers[parent.layer]?.lt;
  if (e.lw === -2) o.lw = parent.lw === -1 ? layers[parent.layer]?.lw ?? -3 : parent.lw;
  return o;
}

/** Returns { entities, blocks }; throws before editing if a member cannot be transformed safely. */
export function explodeInsert(e, raw) {
  if (e.type !== 'INSERT') return null;
  const blocks = { ...raw.blocks };
  function transform(e, m, depth = 0) {
    if (depth > 10) throw new Error('nested block limit reached');
    if (val(e, 210) || val(e, 220)) throw new Error('tilted members stay intact');
    if (e.flip) m = mmul(m, [-1, 0, 0, 1, 0, 0]);
    if (!m.every(Number.isFinite) || Math.abs(det(m)) < 1e-15) throw new Error('invalid block scale');
    const p = (c) => mapply(m, val(e, c), val(e, c + 10));
    if (e.type === 'INSERT') {
      const name = field(e, 2), block = blocks[name];
      if (!block || block.xref) throw new Error('missing block or external reference');
      const combined = mmul(m, placement(e)), at = p(10);
      if (orthogonal(combined) && val(e, 70, 1) === 1 && val(e, 71, 1) === 1) {
        const sx = Math.hypot(combined[0], combined[1]);
        const made = insert(name, ...at, { ...e, sx, sy: det(combined) / sx, rot: angle(Math.atan2(combined[1], combined[0])) });
        made.kids = e.kids?.map((r) => transform(fromRecord(r), m, depth)[0].r);
        return [made];
      }
      // A rotated inner INSERT under a stretch can shear: bake its basis into a private definition, keeping one INSERT.
      let n = 1; while (blocks['PD_EXPLODE_' + n]) n++;
      const madeName = 'PD_EXPLODE_' + n;
      blocks[madeName] = { base: [0, 0], xref: false, entities: [] };
      const local = m.slice(); local[4] -= at[0]; local[5] -= at[1];
      blocks[madeName].entities = members(e, local, depth + 1, false);
      return [insert(madeName, ...at, e)];
    }
    if (['CIRCLE', 'ARC', 'ELLIPSE'].includes(e.type)) {
      const ell = e.type === 'ELLIPSE', r = val(e, 40), u = ell ? [val(e, 11), val(e, 21)] : [r, 0];
      const sign = ell && val(e, 230, 1) < 0 ? -1 : 1;
      const v = ell ? [-u[1] * r * sign, u[0] * r * sign] : [0, r];
      return [conic([val(e, 10), val(e, 20)], u, v, ell ? val(e, 41) : val(e, 50) * DEG,
        ell ? val(e, 42, TAU) : val(e, 51, 360) * DEG, e.type === 'CIRCLE' || ell && Math.abs(val(e, 42, TAU) - val(e, 41)) >= TAU - 1e-10, m, e)];
    }
    if (['LWPOLYLINE', 'POLYLINE'].includes(e.type)) {
      const pts = vertices(e);
      if (pts.some((p) => p[2]) && !similar(m)) return explodePolyline({ ...e, flip: false }).flatMap((piece) => transform(piece, m, depth));
      const scale = Math.hypot(m[0], m[1]);
      return [lwpoly(pts.map((v) => [...mapply(m, v[0], v[1]), v[2] * Math.sign(det(m))]), { ...e, closed: !!(val(e, 70) & 1), width: val(e, 43) * scale })];
    }
    const pts = { LINE: [10, 11], POINT: [10], SOLID: [10, 11, 12, 13], TRACE: [10, 11, 12, 13], '3DFACE': [10, 11, 12, 13], SPLINE: [10, 11], TEXT: [10, 11], ATTRIB: [10, 11], ATTDEF: [10, 11], MTEXT: [10] }[e.type];
    // shortcut: unsupported members keep their INSERT intact; add exact transforms when these kinds need Explode.
    if (!pts) throw new Error(e.type + ' members stay intact');
    const pairs = e.r.c.map((c, i) => [c, e.r.v[i]]).filter(([c]) => ![5, 8, 330, 210, 220, 230].includes(c));
    for (let i = 0; i < pairs.length; i++) {
      const c = pairs[i][0];
      if (!pts.includes(c)) continue;
      const yi = pairs.findIndex(([code], k) => k > i && code === c + 10);
      const q = mapply(m, +pairs[i][1], yi < 0 ? 0 : +pairs[yi][1]);
      pairs[i][1] = q[0]; if (yi < 0) pairs.push([c + 10, q[1]]); else pairs[yi][1] = q[1];
    }
    const set = (c, v) => { const i = pairs.findIndex(([code]) => code === c); if (i < 0) pairs.push([c, v]); else pairs[i][1] = v; };
    if (['TEXT', 'ATTRIB', 'ATTDEF', 'MTEXT'].includes(e.type)) {
      if (e.type === 'MTEXT' && !similar(m)) throw new Error('stretched MTEXT stays intact');
      const t = e.type === 'MTEXT' && field(e, 11) != null ? Math.atan2(val(e, 21), val(e, 11)) : val(e, 50) * DEG;
      const u = vector(m, Math.cos(t), Math.sin(t)), v = vector(m, -Math.sin(t), Math.cos(t));
      const sx = Math.hypot(...u), sy = Math.abs(det(m)) / sx;
      set(50, angle(Math.atan2(u[1], u[0]))); set(40, val(e, 40) * sy);
      if (e.type === 'MTEXT') {
        if (det(m) < 0) throw new Error('mirrored MTEXT stays intact');
        set(41, val(e, 41) * sx);
        if (field(e, 11) != null) { set(11, u[0] / sx); set(21, u[1] / sx); }
      }
      else {
        const oblique = Math.tan(val(e, 51) * DEG), dot = (u[0] * v[0] + u[1] * v[1]) / sx;
        set(41, val(e, 41, 1) * sx / sy); set(51, Math.atan((dot + sx * oblique) / (det(m) / sx)) / DEG);
        set(71, val(e, 71) ^ (det(m) < 0 ? 4 : 0));
      }
    }
    if (e.type === 'SPLINE') for (const c of [12, 13]) {
      if (field(e, c) != null) { const v = vector(m, val(e, c), val(e, c + 10)); set(c, v[0]); set(c + 10, v[1]); }
    }
    return [entity(e.type, pairs, e)];
  }
  function members(e, parent, depth, inherit = true) {
    const block = blocks[field(e, 2)];
    if (!block || block.xref) throw new Error('missing block or external reference');
    const out = [], cols = val(e, 70, 1), rows = val(e, 71, 1);
    if (![cols, rows].every((n) => Number.isInteger(n) && n > 0 && n <= 100)) throw new Error('invalid block array');
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const m = mmul(parent, placement(e, block.base, col, row));
      for (const child of block.entities) out.push(...transform(inherit ? inherited(child, e, raw.layers) : child, m, depth));
    }
    for (const r of e.kids || []) {
      if ((get(r, 70) ?? 0) & 1) continue;                     // a hidden attribute stays hidden: drop it, as the drawing does
      const keep = r.c.map((c, i) => i).filter((i) => r.c[i] !== 70 && r.c[i] !== 73);       // ATTRIB's flags and field length mean nothing on a TEXT
      const attr = fromRecord({ ...r, type: 'TEXT', c: keep.map((i) => (r.c[i] === 74 ? 73 : r.c[i])), v: keep.map((i) => r.v[i]) });       // ATTRIB's vertical alignment is 74, TEXT's is 73
      if (attr.hidden) continue;
      out.push(...transform(attr, parent, depth));
    }
    return out;
  }
  const parent = e.flip ? [-1, 0, 0, 1, 0, 0] : ID;
  if (val(e, 210) || val(e, 220)) throw new Error('tilted inserts stay intact');
  return { entities: members(e, parent, 0), blocks };
}

/** Is this entity the INSERT of a PD_DIM block that `blocks` holds? */
export const isDimInsert = (e, blocks) => e.type === 'INSERT' && DIM_BLOCK.test(field(e, 2) || '') && !!blocks[field(e, 2)];

/** A dimension as plain pieces: its lines, arcs and SOLID arrowheads, and its text as one MTEXT (the TEXT already shows the override with `<>` filled in). No PD_DIM_TEXT attdef is left. */
export function explodeDimension(e, raw) {
  const name = field(e, 2), block = raw.blocks[name], att = textRecord(block.entities), keep = block.entities.filter((c) => c !== att && c.type !== 'POINT');
  const pieces = explodeInsert(e, { ...raw, blocks: { ...raw.blocks, [name]: { ...block, entities: keep } } }).entities;
  // TEXT 72 = 1 (centre) with 73 = 1 / 2 / 3 (bottom / middle / top) is MTEXT attachment 8 / 5 / 2
  return pieces.map((p) => {
    if (p.type !== 'TEXT') return p;
    let rot = val(p, 50), attach = { 3: 2, 2: 5 }[val(p, 73)] ?? 8;
    if (val(p, 71) & 6) {       // mirrored: dimension text still reads left to right, so turn it half a turn
      let turned = false;
      rot = ((rot % 360) + 360) % 360;
      if (rot > 90 && rot <= 270) { rot -= 180; turned = true; } else if (rot > 270) rot -= 360;
      // top and bottom swap when the text is upside down (71 & 4) XOR it was turned: the turn undoes the flip, so it keeps its side of the line
      if (!!(val(p, 71) & 4) !== turned) attach = { 2: 8, 8: 2 }[attach] ?? attach;
    }
    return mtext(val(p, 11, val(p, 10)), val(p, 21, val(p, 20)), val(p, 40), field(p, 1).replace(/[\\{}]/g, '\\$&'), { ...p, attach, rot });
  });
}

/** Replace only explodable selected entities, preserving draw order and returning the new selection. */
export function explodeSelection(raw, selection, locked = new Set()) {
  let blocks = raw.blocks, exploded = 0, skipped = 0;
  const entities = [], selected = new Set(), errors = [], dims = new Set();
  raw.entities.forEach((e, i) => {
    let pieces;
    if (selection.has(i)) {
      if (locked.has(e.layer)) skipped++;
      else try {
        if (isDimInsert(e, blocks)) { pieces = explodeDimension(e, { ...raw, blocks }); dims.add(field(e, 2)); }
        else if (e.type === 'INSERT') { const r = explodeInsert(e, { ...raw, blocks }); pieces = r.entities; if (pieces.length) blocks = r.blocks; }
        else pieces = explodePolyline(e);
      } catch (err) { errors.push(err.message); }
    }
    if (pieces?.length) {
      exploded++;
      for (const piece of pieces) { selected.add(entities.length); entities.push(piece); }
    } else entities.push(e);
  });
  const used = usedBlocks(blocks, entities);
  if ([...dims].some((n) => !used.has(n))) { blocks = { ...blocks }; for (const n of dims) if (!used.has(n)) delete blocks[n]; }       // a dimension's block nothing else uses goes with it, as on Delete
  return { entities, blocks, selected, exploded, skipped, errors: [...new Set(errors)] };
}
