// props.js — the Properties section's model, pure (no DOM): props.test.mjs.   (TODO 24 / 25; mock-up R5b, Option B)
//
// What a selection has in common (layer, colour, line type), its geometry fields (length, radius, centre, text height …), and the edits:
// all on entity records (dxf-write.js shape: { type, layer, aci, tc, lt, …, r: { c: [codes], v: [values] } }) in the drawing's own units, y up.
// `factor` turns drawing units into mm; geometry fields and outline widths use mm.
//
//   summarize(ents)                  → { n, kind, chip, layer, colour, lt }: a value is null when the entities differ ("*varies*")
//   fieldsOf(ents, factor)           → [{ key, label, value (mm / degrees, null = varies), editable, unit, group }] (only when all are one type)
//   setField(ent, key, value, factor) → the changed record, or null when that is not possible (a zero length, an arc that would go round twice)
//   withLayer / withColour / withLineType (ent, key)  → the changed record
//   matchProps(src, dst)             → dst with src's layer, colour and line type
//   similar(entities, ref, by, layers) → the indices of every entity like ref: by 'layer' | 'colour' | 'type'
import { lwVertices, hasGrips } from './grips.js';
import { sweepOf } from './draw.js';
import * as TX from './text.js';
import { rgbHex, keyRgb } from './colour.js';

const DEG = Math.PI / 180;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const at = (r, code, which = 0) => { let n = -1; for (let k = 0; k < r.c.length; k++) if (r.c[k] === code && ++n === which) return k; return -1; };
const get = (r, code) => { const k = at(r, code); return k < 0 ? null : num(r.v[k]); };
const text = (n) => String(+Number(n).toPrecision(15));
function withValues(ent, edits) {
  const c = ent.r.c.slice(), v = ent.r.v.slice();
  for (const [code, val] of edits) { const k = c.indexOf(code); if (k >= 0) v[k] = text(val); else { c.push(code); v.push(text(val)); } }
  return { ...ent, r: { ...ent.r, c, v } };
}

export const TYPE_NAMES = { LINE: 'Line', CIRCLE: 'Circle', ARC: 'Arc', LWPOLYLINE: 'Polyline', POLYLINE: 'Polyline', ELLIPSE: 'Ellipse', SPLINE: 'Spline', TEXT: 'Text', MTEXT: 'MText', INSERT: 'Block', HATCH: 'Hatch', POINT: 'Point', SOLID: 'Solid', DIMENSION: 'Dimension', LEADER: 'Leader' };
export const typeName = (ent) => TYPE_NAMES[ent.type] || ent.type.charAt(0) + ent.type.slice(1).toLowerCase();

// ---------------------------------------------------------------- colour and line type

/** The colours offered (the board's five); anything else in a file shows as itself. */
export const COLOURS = [{ key: 'bylayer', label: 'ByLayer' }, { key: 'aci:1', label: 'Red' }, { key: 'aci:5', label: 'Blue' }, { key: 'aci:3', label: 'Green' }, { key: 'aci:7', label: 'Black' }];
export const LINETYPES = [{ key: 'BYLAYER', label: 'ByLayer' }, { key: 'CONTINUOUS', label: 'Continuous' }, { key: 'DASHED', label: 'DASHED' }, { key: 'DOT', label: 'DOT' }, { key: 'CENTER', label: 'Center' }];

/** The colour setting of an entity as a key: 'bylayer', 'byblock', 'aci:N' or 'tc:N'. */
export function colourKey(ent) {
  if (ent.tc != null) return 'tc:' + ent.tc;
  const a = ent.aci;
  if (a == null || a === 256 || a === 257) return 'bylayer';
  if (a === 0) return 'byblock';
  return 'aci:' + Math.abs(a);
}
export const colourLabel = (key) => (COLOURS.find((c) => c.key === key) || { label: key === 'byblock' ? 'ByBlock' : rgbHex(keyRgb(key)).toUpperCase() }).label;
/** Both colour dropdowns keep the current colour separate from the picker action. */
export function colourOptions(current) {
  const options = COLOURS.map((c) => [c.key, c.label]);
  if (current != null && !options.some(([key]) => key === current)) options.push([current, colourLabel(current)]);
  return [...options, ['custom', 'Colour picker…']];
}
/** The colour an entity is drawn in, as a key: ByLayer resolves through its layer. */
export function effectiveColour(ent, layers = {}) {
  const k = colourKey(ent);
  if (k !== 'bylayer') return k;
  const l = layers[ent.layer];
  return l ? (l.tc != null ? 'tc:' + l.tc : 'aci:' + (Math.abs(l.aci) || 7)) : 'aci:7';
}
export const ltKey = (ent) => { const n = String(ent.lt == null ? '' : ent.lt).trim().toUpperCase(); return n === '' ? 'BYLAYER' : n; };
export const ltLabel = (key) => (LINETYPES.find((l) => l.key === key) || { label: key.charAt(0) + key.slice(1).toLowerCase() }).label;

export const withLayer = (ent, layer) => ({ ...ent, layer });
export const withColour = (ent, key) => {
  if (key === 'bylayer') return { ...ent, aci: 256, tc: null };
  if (key === 'byblock') return { ...ent, aci: 0, tc: null };
  if (key.startsWith('aci:')) return { ...ent, aci: +key.slice(4), tc: null };
  return { ...ent, tc: +key.slice(3) };
};
export const withLineType = (ent, key) => ({ ...ent, lt: key === 'BYLAYER' ? null : key });

export const WIDTHS = ['ByLayer', 'Hairline', 0.10, 0.25, 0.50, 1.00, 2.00];
/** Outline setting in mm; null for a polyline with varying vertex widths. */
export function widthKey(ent, factor = 1) {
  if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
    const cw = get(ent.r, ent.type === 'LWPOLYLINE' ? 43 : 40);
    if (cw > 0 && (ent.type === 'LWPOLYLINE' || cw === get(ent.r, 41))) return cw * factor;
    const widths = [ent.r, ...(ent.kids || [])].flatMap((r) => r.c.flatMap((c, i) => c === 40 || c === 41 ? [num(r.v[i])] : []));
    if (widths.some((w) => w > 0)) return null;
  }
  const lw = ent.lw ?? -1;
  return lw === -1 ? 'ByLayer' : lw === -2 ? 'ByBlock' : lw === -3 ? 'Default' : lw === 5 || lw === 0 ? 'Hairline' : lw / 100;
}
/** Numeric mm widths become DXF hundredths of mm, or a polyline's width in drawing units. */
export function withWidth(ent, value, factor = 1) {
  if (value !== 'ByLayer' && value !== 'Hairline' && !(typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 327.67)) return null;
  const poly = ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE';
  const lw = value === 'ByLayer' ? -1 : value === 'Hairline' ? 5 : poly ? -1 : Math.max(1, Math.round(value * 100));
  if (!poly) return { ...ent, lw };
  const clear = (r) => {
    const keep = r.c.map((c, i) => c !== 40 && c !== 41 && c !== 43 ? i : -1).filter((i) => i >= 0);
    return { ...r, c: keep.map((i) => r.c[i]), v: keep.map((i) => r.v[i]) };
  };
  let next = { ...ent, lw, r: clear(ent.r), kids: ent.kids?.map(clear) };
  if (typeof value === 'number') next = withValues(next, ent.type === 'LWPOLYLINE' ? [[43, value / factor]] : [[40, value / factor], [41, value / factor]]);
  return next;
}
/** Match properties: dst takes src's layer, colour and line type (nothing else). */
export const matchProps = (src, dst) => ({ ...dst, layer: src.layer, aci: src.aci, tc: src.tc, lt: src.lt });
const sameProps = (a, b) => a.layer === b.layer && a.aci === b.aci && a.tc === b.tc && a.lt === b.lt;
export const matchChanges = (src, dst) => !sameProps(src, dst);

// ---------------------------------------------------------------- what a selection has in common

const common = (list) => (list.every((x) => x === list[0]) ? list[0] : null);
/** { n, kind (the type when all are one, else null), chip (its words), layer, colour, lt }; a common value is null when they differ. */
export function summarize(ents) {
  const n = ents.length;
  if (!n) return { n: 0, kind: null, chip: '', layer: null, colour: null, lt: null };
  const kind = common(ents.map((e) => e.type));
  const chip = kind ? (n === 1 ? typeName(ents[0]) : `${typeName(ents[0])} × ${n}`) : `${n} shapes`;
  return { n, kind, chip, layer: common(ents.map((e) => e.layer)), colour: common(ents.map(colourKey)), lt: common(ents.map(ltKey)) };
}

// ---------------------------------------------------------------- geometry

function polyMetrics(r) {
  const vs = lwVertices(r), closed = ((get(r, 70) ?? 0) & 1) === 1, m = vs.length;
  let len = 0, area = 0;
  for (let i = 0; i < (closed ? m : m - 1); i++) {
    const a = vs[i], b = vs[(i + 1) % m], c = Math.hypot(b.x - a.x, b.y - a.y);
    area += (a.x * b.y - b.x * a.y) / 2;
    if (a.b && c > 0) {
      const th = 4 * Math.atan(Math.abs(a.b)), rad = c / (2 * Math.sin(th / 2));      // a bulge's circular segment adds to (+) or takes from (−) the polygon
      len += rad * th;
      area += Math.sign(a.b) * (rad * rad * (th - Math.sin(th))) / 2;
    } else len += c;
  }
  return { len, area: closed ? Math.abs(area) : null, n: m, closed };
}
const arcOf = (r) => { const rad = get(r, 40) ?? 0, a0 = get(r, 50) ?? 0, a1 = get(r, 51) ?? 0, sw = sweepOf(a0, a1); return { rad, a0, a1, sw, cx: get(r, 10) ?? 0, cy: get(r, 20) ?? 0 }; };

/**
 * The geometry fields all of these entities (one type) have, in mm: [{ key, label, unit, group, editable, value }]. value is null when they
 * differ. Mirrored shapes and kinds without fields give none.
 */
export function fieldsOf(ents, factor = 1) {
  if (!ents.length) return [];
  const type = ents[0].type;
  if (!ents.every((e) => e.type === type)) return [];
  const f = factor, F = (key, label, fn, editable = true, unit = 'mm', group = null) => ({ key, label, unit, group, editable, fn });
  let defs = [];
  if (type === 'LINE' && ents.every(hasGrips)) {
    const g = (e) => { const r = e.r; return { a: [get(r, 10) ?? 0, get(r, 20) ?? 0], b: [get(r, 11) ?? 0, get(r, 21) ?? 0] }; };
    defs = [F('length', 'Length', (e) => { const { a, b } = g(e); return Math.hypot(b[0] - a[0], b[1] - a[1]) * f; }),
      F('angle', 'Angle', (e) => { const { a, b } = g(e); return ((Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG) + 360) % 360; }, false, '°'),
      F('startX', 'Start', (e) => g(e).a[0] * f, false, 'mm', 'start'), F('startY', 'Start', (e) => g(e).a[1] * f, false, 'mm', 'start'),
      F('endX', 'End', (e) => g(e).b[0] * f, false, 'mm', 'end'), F('endY', 'End', (e) => g(e).b[1] * f, false, 'mm', 'end')];
  } else if (type === 'CIRCLE' && ents.every(hasGrips)) {
    defs = [F('radius', 'Radius', (e) => (get(e.r, 40) ?? 0) * f), F('diameter', 'Diameter', (e) => 2 * (get(e.r, 40) ?? 0) * f),
      F('centreX', 'Centre', (e) => (get(e.r, 10) ?? 0) * f, true, 'mm', 'centre'), F('centreY', 'Centre', (e) => (get(e.r, 20) ?? 0) * f, true, 'mm', 'centre')];
  } else if (type === 'ARC' && ents.every(hasGrips)) {
    const P = (e, which) => { const a = arcOf(e.r), t = (which ? a.a1 : a.a0) * DEG; return [a.cx + a.rad * Math.cos(t), a.cy + a.rad * Math.sin(t)]; };
    defs = [F('radius', 'Radius', (e) => arcOf(e.r).rad * f), F('length', 'Length', (e) => { const a = arcOf(e.r); return a.rad * a.sw * DEG * f; }),
      F('sweep', 'Sweep', (e) => arcOf(e.r).sw, false, '°'),
      F('centreX', 'Centre', (e) => arcOf(e.r).cx * f, true, 'mm', 'centre'), F('centreY', 'Centre', (e) => arcOf(e.r).cy * f, true, 'mm', 'centre'),
      F('startX', 'Start', (e) => P(e, 0)[0] * f, false, 'mm', 'start'), F('startY', 'Start', (e) => P(e, 0)[1] * f, false, 'mm', 'start'),
      F('endX', 'End', (e) => P(e, 1)[0] * f, false, 'mm', 'end'), F('endY', 'End', (e) => P(e, 1)[1] * f, false, 'mm', 'end')];
  } else if (type === 'LWPOLYLINE' && ents.every(hasGrips)) {
    defs = [F('length', 'Length', (e) => polyMetrics(e.r).len * f, false)];
    if (ents.every((e) => polyMetrics(e.r).closed)) defs.push(F('area', 'Area', (e) => polyMetrics(e.r).area * f * f, false, 'mm²'));
    defs.push(F('vertices', 'Vertices', (e) => polyMetrics(e.r).n, false, ''));
  } else if (type === 'TEXT' || type === 'MTEXT') {
    if (!ents.every((e) => TX.decode(e))) return [];
    defs = [F('textH', 'Text height', (e) => TX.decode(e).h * f), F('textAngle', 'Angle', (e) => ((TX.decode(e).angle % 360) + 360) % 360, true, '°')];
  }
  return defs.map(({ fn, ...d }) => {
    const vals = ents.map(fn);
    return { ...d, value: vals.every((v) => Math.abs(v - vals[0]) < 1e-9 * Math.max(1, Math.abs(vals[0]))) ? vals[0] : null };
  });
}

/** The entity with field `key` set to `value` (mm, or degrees for an angle); null when that cannot be done. */
export function setField(ent, key, value, factor = 1) {
  if (!Number.isFinite(value)) return null;
  const f = factor, r = ent.r, u = value / f;
  if (ent.type === 'LINE') {
    if (key !== 'length' || !(value > 0)) return null;
    const a = [get(r, 10) ?? 0, get(r, 20) ?? 0], b = [get(r, 11) ?? 0, get(r, 21) ?? 0], cur = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(cur > 0)) return null;
    return withValues(ent, [[11, a[0] + (b[0] - a[0]) / cur * u], [21, a[1] + (b[1] - a[1]) / cur * u]]);
  }
  if (ent.type === 'CIRCLE') {
    if (key === 'radius' && value > 0) return withValues(ent, [[40, u]]);
    if (key === 'diameter' && value > 0) return withValues(ent, [[40, u / 2]]);
    if (key === 'centreX') return withValues(ent, [[10, u]]);
    if (key === 'centreY') return withValues(ent, [[20, u]]);
    return null;
  }
  if (ent.type === 'ARC') {
    const a = arcOf(r);
    if (key === 'radius' && value > 0) return withValues(ent, [[40, u]]);
    if (key === 'length') {
      const sw = u / a.rad / DEG;                             // the radius stays; the sweep follows
      if (!(sw > 0) || sw > 360 + 1e-9) return null;
      return withValues(ent, [[51, ((a.a0 + Math.min(sw, 360)) % 360 + 360) % 360]]);
    }
    if (key === 'centreX') return withValues(ent, [[10, u]]);
    if (key === 'centreY') return withValues(ent, [[20, u]]);
    return null;
  }
  if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
    const m = TX.decode(ent);
    if (!m) return null;
    const keep = { layer: ent.layer, lt: ent.lt, aci: ent.aci, tc: ent.tc, lw: ent.lw, lts: ent.lts, hidden: ent.hidden, ps: ent.ps };
    if (key === 'textH' && value > 0) return TX.encode({ ...m, h: u }, keep);
    if (key === 'textAngle') return TX.encode({ ...m, angle: value }, keep);
  }
  return null;
}

// ---------------------------------------------------------------- Select similar

/** The indices of every entity in `entities` like `ref` (itself included): the same layer, the same drawn colour, or the same type. */
export function similar(entities, ref, by, layers = {}, skipLayer = null) {
  const out = [];
  const want = by === 'layer' ? ref.layer : by === 'colour' ? effectiveColour(ref, layers) : ref.type;
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (skipLayer != null && e.layer === skipLayer) continue;
    const have = by === 'layer' ? e.layer : by === 'colour' ? effectiveColour(e, layers) : e.type;
    if (have === want) out.push(i);
  }
  return out;
}
