// The DXF writer, pure: no DOM, no files — dxf-write.test.mjs. It writes what drawing.js readDxf gives (one document
// shape for geometry read from a file and geometry the app makes), as an ASCII DXF R2000 (AC1015).
//
//   writeDxf(doc, opts) → string, CRLF lines.   opts: { escapeUnicode: true writes non-ASCII as \U+XXXX (R2000's own way); extents: [x0, y0, x1, y1] of model space, when the caller has them (flatten is slow on a big file) }
//   unwritable(doc) → [{ type, count }]: what writeDxf leaves out (warn before overwriting a file)
//   writeDxfWithReport(doc, opts) → { text, tables, skipped }: the same file and counts for the caller's Save note
//   Export opts: units ('mm', 'in', 'unitless'), scale (> 0), precision (0–8); transforms a deep copy.
//
// The document (drawing.js): { header: { $NAME: string | [x, y] }, layers: { NAME: { aci, tc, off, frozen, lt, lw } },
//   ltypes: { NAME: { pattern: [dash, gap, …] } }, blocks: { NAME: { base: [x, y], xref, entities } }, entities, groups (groups.js) }
// An entity: { type, layer, lt, aci, tc, lw, lts, hidden, ps, flip, r: { type, c: [codes], v: [values] }, kids }
//   Its common properties (layer, colour, line type, weight, scale, hidden, sheet) are the fields; r holds the rest as
//   group-code pairs. kids: a POLYLINE's VERTEX records or an INSERT's ATTRIB records (each { type, c, v }).
// Source handles, owners and reactors are not kept: the writer makes its own, including GROUP membership.
// Extension dictionaries and xdata are not kept.

import { flatten } from './drawing.js';
import { nearestAci, unpack420 } from './colour.js';
import { fillHatch, fillHoles } from './fill.js';
import { remap } from './groups.js';
import { scaleRecord, SPEC, relabel, DIM_BLOCK, readDim, dimGeom } from './edit.js';
import { measuredText, readOverride, textRecord, overrideRecord, dimensionText, measureOverride } from './dimension-text.js';

const SUPPORTED = new Set(['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'ELLIPSE', 'SPLINE', 'POINT', 'TEXT', 'MTEXT',
  'INSERT', 'ATTDEF', 'HATCH', 'SOLID', 'TRACE', '3DFACE', 'DIMENSION', 'LEADER']);

// ---------------------------------------------------------------- numbers and values

/** A number as DXF text: up to precision decimals (default 6), no exponent, no "-0". */
export function fmt(n, precision = 6) {
  n = +n;
  if (!Number.isFinite(n)) return '0';
  let s = n.toFixed(precision);
  if (/e/i.test(s)) s = BigInt(Math.round(n)).toString();
  else if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
const intText = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? String(n) : String(v).trim(); };
const line1 = (s, esc) => {
  s = String(s).replace(/[\r\n]+/g, ' ');
  return esc ? s.replace(/[^\u0000-\u007f]/g, (ch) => '\\U+' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')) : s;
};

const isDouble = (c) => (c >= 10 && c <= 59) || (c >= 110 && c <= 149) || (c >= 210 && c <= 239) || (c >= 460 && c <= 469) || (c >= 1010 && c <= 1059);
const isInt = (c) => (c >= 60 && c <= 99) || (c >= 160 && c <= 179) || (c >= 270 && c <= 299) || (c >= 370 && c <= 389) || (c >= 400 && c <= 409) ||
  (c >= 420 && c <= 459) || (c >= 1060 && c <= 1071);
/** A value as the file wants it for its group code. */
function value(c, v, esc, precision = 6) {
  if (isDouble(c)) { const n = +v; return Number.isFinite(n) && String(v).trim() !== '' ? fmt(n, precision) : String(v).trim(); }
  if (isInt(c)) return intText(v);
  return line1(v, esc);
}

// ---------------------------------------------------------------- building entities (the shape readDxf gives)

const props = (o = {}) => ({ layer: o.layer ?? '0', lt: o.lt ?? null, aci: o.aci ?? 256, tc: o.tc ?? null, lw: o.lw ?? -1,
  lts: o.lts ?? 1, hidden: !!o.hidden, ps: !!o.ps, flip: false, ...(o.fill ? { fill: o.fill } : {}) });

/** An entity from its type, its pairs [[code, value], …] and its common properties { layer, aci, tc, lt, lw, lts, ps, hidden }. */
export function entity(type, pairs, o = {}) {
  const p = props(o), all = [[8, p.layer], ...pairs];
  return { type, ...p, r: { type, c: all.map((x) => x[0]), v: all.map((x) => String(x[1])) }, kids: undefined };
}
const P2 = (x, y) => [[10, x], [20, y]];

export const line = (x1, y1, x2, y2, o) => entity('LINE', [...P2(x1, y1), [30, 0], [11, x2], [21, y2], [31, 0]], o);
export const point = (x, y, o) => entity('POINT', [...P2(x, y), [30, 0]], o);
export const circle = (cx, cy, r, o) => entity('CIRCLE', [...P2(cx, cy), [30, 0], [40, r]], o);
/** An arc, anticlockwise from a0 to a1 (degrees). */
export const arc = (cx, cy, r, a0, a1, o) => entity('ARC', [...P2(cx, cy), [30, 0], [40, r], [50, a0], [51, a1]], o);
/** An ellipse: centre, the major axis' end (relative to the centre), minor / major ratio, start and end parameters (radians). */
export const ellipse = (cx, cy, mx, my, ratio, a0 = 0, a1 = Math.PI * 2, o) =>
  entity('ELLIPSE', [...P2(cx, cy), [30, 0], [11, mx], [21, my], [31, 0], [40, ratio], [41, a0], [42, a1]], o);
/** A light polyline from points [x, y] or [x, y, bulge]; o.closed, o.width (constant) too. */
export function lwpoly(pts, o = {}) {
  const flag = o.closed ? 1 : 0, pairs = [[90, pts.length], [70, flag]];
  if (o.width) pairs.push([43, o.width]);
  for (const p of pts) { pairs.push([10, p[0]], [20, p[1]]); if (p[2]) pairs.push([42, p[2]]); }
  return entity('LWPOLYLINE', pairs, o);
}
export const rect = (x, y, w, h, o) => lwpoly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], { ...o, closed: true });
const BULGE = Math.tan(Math.PI / 8);
/** A rectangle with rounded corners (r is limited to half the shorter side). */
export function roundRect(x, y, w, h, r, o) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return rect(x, y, w, h, o);
  // straight sides, then an arc (bulge on the vertex it starts at) at each corner, anticlockwise
  return lwpoly([[x + r, y], [x + w - r, y, BULGE], [x + w, y + r], [x + w, y + h - r, BULGE], [x + w - r, y + h], [x + r, y + h, BULGE],
    [x, y + h - r], [x, y + r, BULGE]], { ...o, closed: true });
}
export function text(x, y, height, str, o = {}) {
  const pairs = [...P2(x, y), [30, 0], [40, height], [1, str]];
  if (o.rot) pairs.push([50, o.rot]);
  return entity('TEXT', pairs, o);
}
export function mtext(x, y, height, str, o = {}) {
  const pairs = [...P2(x, y), [30, 0], [40, height], [71, o.attach ?? 1], [1, str]];
  if (o.rot) pairs.push([50, o.rot]);
  return entity('MTEXT', pairs, o);
}
/** A block reference; o: sx, sy, rot (degrees), cols, rows, dx, dy (array spacing). */
export function insert(name, x, y, o = {}) {
  const pairs = [[2, name], ...P2(x, y), [30, 0]];
  if (o.sx != null || o.sy != null) pairs.push([41, o.sx ?? 1], [42, o.sy ?? 1], [43, 1]);
  if (o.rot) pairs.push([50, o.rot]);
  if ((o.cols || 1) > 1 || (o.rows || 1) > 1) pairs.push([70, o.cols || 1], [71, o.rows || 1], [44, o.dx || 0], [45, o.dy || 0]);
  return entity('INSERT', pairs, o);
}

/** A new empty document in these units (4 = mm). */
export function newDoc(units = 4) {
  return { header: { $ACADVER: 'AC1015', $INSUNITS: String(units) }, layers: { 0: layerDef() }, ltypes: {}, blocks: {}, entities: [], groups: [] };
}
const layerDef = (o = {}) => ({ aci: o.aci ?? 7, tc: o.tc ?? null, off: !!o.off, frozen: !!o.frozen, lt: o.lt ?? 'CONTINUOUS', lw: o.lw ?? -3, handle: '' });
/** Adds (or replaces) a layer: o = { aci, tc, lt, lw, off, frozen }. */
export function addLayer(doc, name, o) { doc.layers[name] = layerDef(o); return doc.layers[name]; }
/** Adds a block; entities are put on layer 0 unless they say otherwise. */
export function addBlock(doc, name, entities, base = [0, 0]) {
  doc.blocks[name] = { base: [base[0], base[1]], xref: false, entities: entities.slice() };
  return doc.blocks[name];
}
/** Adds entities to model space (or the sheet with ps: true on each). */
export function addEntities(doc, ...ents) { doc.entities = doc.entities.concat(...ents); return doc; }   // not push(...list): a big PDF gives 100 000+ pieces, too many arguments

// ---------------------------------------------------------------- what can't be carried

/** What writeDxf leaves out: [{ type, count }], most first. */
export function unwritable(doc) {
  return prepareSave(doc, false).skipped;
}

/** The same conversion and loss note for Save and the Parts library. */
export function saveReportNote({ tables, skipped, unreadLabels = [] }) {
  const changes = [];
  if (tables) changes.push(tables === 1 ? '1 table saved as a block (AutoCAD sees it as a block, not a table)' : `${tables} tables saved as blocks (AutoCAD sees them as blocks, not tables)`);
  const dropped = skipped.reduce((sum, b) => sum + b.count, 0);
  if (dropped) changes.push(`${dropped} ${dropped === 1 ? 'object' : 'objects'} not saved: ` + skipped.map((b) => b.type + ' x' + b.count).join(', '));
  if (unreadLabels.length) changes.push('Dimension labels kept unchanged (could not read): ' + unreadLabels.join(', '));
  return changes.length ? '. ' + changes.join('; ') : '';
}

/** Convert tables only in the saved copy, and count unsupported objects where they are filtered out. */
function prepareSave(doc, includeFills = true) {
  const sourceBlocks = doc.blocks || {}, renamed = new Map(), taken = new Set(Object.keys(sourceBlocks).map((n) => n.toLowerCase()));
  const field = (e, c, fallback = '') => e.r.v[e.r.c.indexOf(c)]?.trim() ?? fallback;
  let next = 1, tables = 0;
  const findTables = (list) => {
    for (const e of list || []) {
      if (e.type !== 'ACAD_TABLE') continue;
      const name = field(e, 2), block = sourceBlocks[name];
      if (!block || block.xref || renamed.has(name)) continue;
      while (taken.has(`pd_table_${next}`)) next++;
      const normal = `PD_TABLE_${next++}`;
      taken.add(normal.toLowerCase()); renamed.set(name, normal);
    }
  };
  findTables(doc.entities);
  for (const b of Object.values(sourceBlocks)) if (!b.xref) findTables(b.entities);
  const n = new Map(), add = (t) => n.set(t, (n.get(t) || 0) + 1);
  const saved = (list, indexes) => {
    const result = [], holes = includeFills ? fillHoles(list || []) : new Map();
    for (const [i, source] of (list || []).entries()) {
      let e = source;
      const name = ['ACAD_TABLE', 'INSERT', 'DIMENSION'].includes(e.type) ? field(e, 2) : '', normal = renamed.get(name);
      if (e.type === 'ACAD_TABLE' && normal) {
        const rot = Math.atan2(+field(e, 21, '0'), +field(e, 11, '1')) * 180 / Math.PI;
        e = insert(normal, +field(e, 10, '0'), +field(e, 20, '0'), { ...e, rot });
        tables++;
      } else if (!SUPPORTED.has(e.type)) { add(e.type); continue; }
      else if (normal && (e.type === 'INSERT' || e.type === 'DIMENSION')) {
        const v = e.r.v.slice(); v[e.r.c.indexOf(2)] = normal;
        e = { ...e, r: { ...e.r, v } };
      }
      const hatch = includeFills && fillHatch(e, holes.get(e));
      const start = result.length;
      if (hatch) result.push(hatch);
      result.push(hatch ? { ...e, fill: undefined } : e); // The saved HATCH already carries the fill; extents need only its geometry.
      if (indexes) indexes.set(i, hatch ? [start, start + 1] : [start]);
    }
    return result;
  };
  const indexes = doc.groups?.length ? new Map() : null, entities = saved(doc.entities, indexes), blocks = {};
  for (const [name, b] of Object.entries(sourceBlocks)) {
    if (b.xref) add('XREF');
    blocks[renamed.get(name) || name] = { ...b, entities: b.xref ? [] : saved(b.entities) };
  }
  const skipped = [...n].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : 1));
  return { doc: { ...doc, entities, blocks, groups: indexes ? remap(doc.groups, indexes) : [] }, tables, skipped };
}

// ---------------------------------------------------------------- one entity's pairs

const COMMON = new Set([8, 6, 62, 48, 60, 67, 370, 420, 440, 284, 410]);
const isHandleCode = (c) => c === 5 || c === 105 || (c >= 320 && c <= 369) || (c >= 390 && c <= 399) || c === 480 || c === 481;
// the subclass markers a file without them (R12) needs: [marker, codes it holds (null: the rest)]
const SUB = {
  LINE: [['AcDbLine']], POINT: [['AcDbPoint']], CIRCLE: [['AcDbCircle']], LWPOLYLINE: [['AcDbPolyline']],
  ARC: [['AcDbCircle', null], ['AcDbArc', [50, 51]]], ELLIPSE: [['AcDbEllipse']], SPLINE: [['AcDbSpline']],
  TEXT: [['AcDbText', null], ['AcDbText', [73]]], MTEXT: [['AcDbMText']], INSERT: [['AcDbBlockReference']], HATCH: [['AcDbHatch']],
  SOLID: [['AcDbTrace']], TRACE: [['AcDbTrace']], '3DFACE': [['AcDbFace']], LEADER: [['AcDbLeader']],
  ATTDEF: [['AcDbText', null], ['AcDbAttributeDefinition', [2, 3, 70, 73, 74]]],
  ATTRIB: [['AcDbText', null], ['AcDbAttribute', [2, 70, 73, 74]]]
};
const DIMSUB = { 0: ['AcDbAlignedDimension', 'AcDbRotatedDimension'], 1: ['AcDbAlignedDimension'], 2: ['AcDbAngular2LineDimension'],
  3: ['AcDbDiametricDimension'], 4: ['AcDbRadialDimension'], 5: ['AcDb3PointAngularDimension'], 6: ['AcDbOrdinateDimension'] };
const DIMBASE = new Set([2, 10, 11, 12, 70, 71, 72, 73, 74, 41, 42, 1, 53, 51, 3, 210]);

/** The common properties out of a raw record's own pairs (for VERTEX / ATTRIB, which have no entity fields). */
function propsOf(r) {
  const p = props();
  let own = true;
  for (let k = 0; k < r.c.length; k++) {
    const c = r.c[k], v = r.v[k];
    if (c === 100) { if (v.trim() !== 'AcDbEntity') own = false; continue; }
    if (!own) continue;
    if (c === 8) p.layer = v.trim(); else if (c === 6) p.lt = v.trim(); else if (c === 62) p.aci = +v || 0;
    else if (c === 420) p.tc = +v; else if (c === 370) p.lw = +v; else if (c === 48) p.lts = +v || 1;
    else if (c === 60) p.hidden = +v === 1; else if (c === 67) p.ps = +v === 1;
  }
  return p;
}

/** The type-specific pairs of a record, handles and extras dropped, subclass markers made sure of. */
function specific(r, parentFlags) {
  const hasMarkers = r.c.includes(100);
  let inEnt = hasMarkers, skipGroup = false;
  const out = [];
  for (let k = 0; k < r.c.length; k++) {
    const c = r.c[k], v = r.v[k];
    if (c === 102) { skipGroup = !/^\s*\}/.test(v); continue; }          // { … } groups: reactors, extension dictionary
    if (skipGroup) continue;
    if (c === 100) { inEnt = v.trim() === 'AcDbEntity'; if (!inEnt) out.push([c, v]); continue; }
    if (c >= 1000 || isHandleCode(c)) continue;                          // xdata, handles
    if (inEnt) continue;                                                 // AcDbEntity's own: the fields speak for it
    if (!hasMarkers && COMMON.has(c)) continue;
    if (r.type === 'HATCH' && c === 97) { out.push([c, '0']); continue; } // its source objects' handles are gone
    out.push([c, v]);
  }
  let markers = null;
  if (!hasMarkers) {
    if (r.type === 'DIMENSION') {
      const t = (parseInt((out.find((p) => p[0] === 70) || [0, '0'])[1], 10) || 0) & 7;
      const inBase = (c) => DIMBASE.has(c >= 10 && c <= 39 ? 10 + (c % 10) : c);
      const a = out.filter((p) => inBase(p[0])), b = out.filter((p) => !inBase(p[0]));
      const m = DIMSUB[t] || DIMSUB[0];
      return [[100, 'AcDbDimension'], ...a, [100, m[0]], ...b, ...(m[1] ? [[100, m[1]]] : [])];
    }
    if (r.type === 'POLYLINE' || r.type === 'VERTEX') markers = polyMarkers(r.type, parentFlags ?? (out.find((p) => p[0] === 70) || [0, '0'])[1]);
    else markers = SUB[r.type] && SUB[r.type].map(([m, codes]) => [m, codes]);
    if (markers && SUB[r.type]) {
      const taken = new Set(markers.flatMap((m) => m[1] || []));
      const res = [];
      markers.forEach(([m, codes], i) => {
        const part = codes ? out.filter((p) => codes.includes(p[0])) : out.filter((p) => !taken.has(p[0]));
        if (i === 0 || part.length) res.push([100, m], ...part);
      });
      return res;
    }
    if (markers) return [...markers.map((m) => [100, m]), ...out];
  }
  return out;
}
function polyMarkers(type, flags) {
  const f = parseInt(flags, 10) || 0;
  if (type === 'POLYLINE') return [f & 64 ? 'AcDbPolyFaceMesh' : f & 16 ? 'AcDbPolygonMesh' : f & 8 ? 'AcDb3dPolyline' : 'AcDb2dPolyline'];
  return ['AcDbVertex', f & 64 ? 'AcDbPolyFaceMeshVertex' : f & 32 ? 'AcDb3dPolylineVertex' : 'AcDb2dVertex'];
}

/** A table record's own pairs (name, handles, markers, xdata and { } groups left out). */
function recPairs(r) {
  const out = [];
  let skipGroup = false;
  for (let k = 0; k < r.c.length; k++) {
    const c = r.c[k], v = r.v[k];
    if (c === 102) { skipGroup = !/^\s*\}/.test(v); continue; }
    if (skipGroup || c === 2 || c === 100 || c >= 1000 || isHandleCode(c)) continue;
    out.push([c, v]);
  }
  return out;
}
const ciGet = (o, n) => o && o[Object.keys(o).find((k) => k.toLowerCase() === n.toLowerCase())];

// ---------------------------------------------------------------- the writer

const HDR = [ // [name, kind, code]: what the header carries when the document has it
  ['$LTSCALE', 'd', 40], ['$CELTSCALE', 'd', 40], ['$PSLTSCALE', 'i', 70], ['$MEASUREMENT', 'i', 70], ['$LUNITS', 'i', 70], ['$LUPREC', 'i', 70],
  ['$AUNITS', 'i', 70], ['$AUPREC', 'i', 70], ['$ANGBASE', 'd', 50], ['$ANGDIR', 'i', 70], ['$PDMODE', 'i', 70], ['$PDSIZE', 'd', 40],
  ['$ATTMODE', 'i', 70], ['$TEXTSIZE', 'd', 40], ['$FILLMODE', 'i', 70], ['$DIMASZ', 'd', 40], ['$DIMSCALE', 'd', 40], ['$DIMTXT', 'd', 40], ['$DIMEXO', 'd', 40],
  ['$DIMEXE', 'd', 40], ['$DIMGAP', 'd', 40], ['$DIMDEC', 'i', 70], ['$DIMLUNIT', 'i', 70], ['$DIMTAD', 'i', 70]];
/** The font file each of the app's text styles points at (Mono is Courier New; other style names keep Arial). */
const FONT_FILES = { Standard: 'txt', Arial: 'arial.ttf', Mono: 'cour.ttf' };
const STD_LT = { DASHED: [0.5, -0.25], HIDDEN: [0.25, -0.125], CENTER: [1.25, -0.25, 0.25, -0.25], PHANTOM: [1.25, -0.25, 0.25, -0.25, 0.25, -0.25],
  DASHDOT: [0.5, -0.25, 0, -0.25], DOT: [0, -0.25] };

export function writeDxf(doc, opts = {}) {
  return writeDxfWithReport(doc, opts).text;
}

export function writeDxfWithReport(doc, opts = {}) {
  const { units, scale = 1, precision = 6 } = opts;
  if (units !== undefined && !['mm', 'in', 'unitless'].includes(units)) throw new Error('Units must be mm or in (unitless drawings do not convert)');
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Scale must be a number above 0');
  if (!Number.isInteger(precision) || precision < 0 || precision > 8) throw new Error('Precision must be a whole number from 0 to 8');
  const source = +doc.header?.$INSUNITS || 0, mm = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
  const unitChange = !!units && units !== 'unitless' && !!source && source !== (units === 'in' ? 1 : 4);
  if (units === 'unitless' && source !== 0) throw new Error('This drawing has units');
  const factor = (unitChange ? mm[source] / (units === 'in' ? 25.4 : 1) : 1) * scale;
  if (!Number.isFinite(factor) || factor <= 0) throw new Error('Cannot convert these drawing units or scale');
  // Only export options need a deep copy; ordinary Save keeps its existing fast path.
  if (units !== undefined || opts.scale !== undefined || opts.precision !== undefined) doc = structuredClone(doc);
  const prepared = prepareSave(doc);
  const unreadLabels = new Set();
  doc = prepared.doc;
  if (factor !== 1 || unitChange) {
    const dimensions = new Map();
    const one = (e) => {
      const transform = (r) => {
        const scaled = scaleRecord(r.type, r, factor, [0, 0], true) || r;
        if (r.type === 'DIMENSION' && [2, 5].includes((+r.v[r.c.indexOf(70)] || 0) & 7)) {
          const k = r.c.indexOf(42); if (k >= 0) scaled.v[k] = r.v[k];
        }
        if (scaled.v.some((v, i) => v !== r.v[i] && !Number.isFinite(+v))) throw new Error('Export scale result is too large');
        return scaled;
      };
      return { ...e, r: transform(e.r), kids: e.kids?.map(transform) };
    };
    if (factor !== 1) {
      doc.entities = doc.entities.map(one);
      delete doc.blocks.PD_LAYOUT;
      for (const b of Object.values(doc.blocks)) {
        b.base = b.base?.map((n) => n * factor);
        b.entities = b.entities.map(one);
      }
    }
    for (const e of [...doc.entities, ...Object.values(doc.blocks).flatMap((b) => b.entities)]) {
      if (e.type === 'DIMENSION') dimensions.set(e.r.v[e.r.c.indexOf(2)]?.trim(), e);
    }
    for (const [name, b] of Object.entries(doc.blocks)) if (DIM_BLOCK.test(name) || dimensions.has(name)) {
      const target = unitChange ? { units, scale } : null;
      if (unitChange) {
        const dim = readDim(name, b), native = dimensions.get(name);
        const value = dim ? dimGeom(dim.kind, dim.params, 1)?.mm : +native?.r.v[native.r.c.indexOf(42)];
        if (Number.isFinite(value)) target.value = value;
      }
      b.entities = relabel(b.entities, factor, target, (label) => unreadLabels.add(label));
      const dim = readDim(name, b), measured = measuredText(b.entities), override = readOverride(b.entities);
      if (dim) {
        const dp = (/\.(\d+)/.exec(measured)?.[1] || '').length;
        const next = measureOverride(dim.params.a, dim.params.b, 1, dp, override);
        if (next !== override) {
          const record = textRecord(b.entities);
          b.entities = b.entities.map((e) => e === record ? overrideRecord(next, measured) : e.type === 'TEXT'
            ? { ...e, r: { ...e.r, v: e.r.v.map((v, i) => e.r.c[i] === 1 ? dimensionText(measured, next) : v) } } : e);
          const native = dimensions.get(name);
          if (native) native.r.v = native.r.v.map((v, i) => native.r.c[i] === 1 ? next : v);
        }
      }
    }
    for (const key of ['$DIMTXT', '$DIMASZ', '$DIMEXE', '$DIMEXO', '$DIMGAP', '$LTSCALE', '$PDSIZE', '$TEXTSIZE']) {
      const n = +doc.header?.[key];
      if (Number.isFinite(n) && (key !== '$PDSIZE' || n > 0) && doc.header[key] != null) doc.header[key] = String(n * factor);
    }
    for (const key of ['$LIMMIN', '$LIMMAX', '$INSBASE']) if (Array.isArray(doc.header?.[key])) doc.header[key] = doc.header[key].map((n) => n * factor);
    for (const style of Object.values(doc.dimstyles || {})) {
      style.v = style.v.map((v, i) => {
        const c = style.c[i];
        if ([41, 42, 43, 44, 45, 46, 47, 48, 49, 140, 141, 142, 147, 148].includes(c)) return String(+v * factor);
        if (unitChange && c === 144) return '1';
        if (unitChange && c === 3) return v.replace(/<>\s*(?:"|mm|in)?$/, units === 'in' ? '<>"' : '<>');
        return v;
      });
    }
  }
  if (unitChange) {
    doc.header.$INSUNITS = units === 'in' ? '1' : '4';
    doc.header.$MEASUREMENT = units === 'in' ? '0' : '1';
  }
  const ext = factor !== 1 && opts.extents ? opts.extents.map((n) => n * factor) : opts.extents;
  return { text: writePreparedDxf(doc, { ...opts, extents: ext }), tables: prepared.tables, skipped: prepared.skipped,
    ...(unreadLabels.size ? { unreadLabels: [...unreadLabels] } : {}) };
}

function writePreparedDxf(doc, opts) {
  const esc = !!opts.escapeUnicode;
  const precision = opts.precision ?? 6;
  const colourFallbacks = new Map();
  const fallbackAci = (tc) => {
    if (!colourFallbacks.has(tc)) colourFallbacks.set(tc, nearestAci(unpack420(tc)));
    return colourFallbacks.get(tc);
  };
  let hnext = 0x20;
  const handle = () => (hnext++).toString(16).toUpperCase();
  const H = { BLOCK_RECORD: '1', LAYER: '2', STYLE: '3', LTYPE: '5', VIEW: '6', UCS: '7', VPORT: '8', APPID: '9', DIMSTYLE: 'A', ROOT: 'C' };
  const out = (a) => ({ a, p(c, v, dp = c >= 10 && c <= 38 ? precision : 6) { a.push(String(c).padStart(3) + '\r\n' + value(c, v, esc, dp)); return this; }, s(c, v) { a.push(String(c).padStart(3) + '\r\n' + line1(v, esc)); return this; } });
  const record = (o, pairs, type) => {
    let stage = 'head', flags = 0, edge = 0;
    const spec = SPEC[type], points = [...(spec?.pts || []), ...(spec?.vec || [])];
    const angular = type === 'DIMENSION' && [2, 5].includes((+pairs.find(([c]) => c === 70)?.[1] || 0) & 7);
    for (const [c, v] of pairs) {
      let length = c >= 10 && c <= 38 && points.includes(10 + c % 10) || (spec?.len || []).includes(c) || (spec?.z || []).includes(c);
      if (angular && c === 42) length = false;
      if (type === 'HATCH') {
        if (c === 91) stage = 'paths'; else if (c === 75) stage = 'pattern'; else if (c === 98) stage = 'seed';
        if (stage === 'paths') { if (c === 92) flags = +v; else if (c === 72 && !(flags & 2)) edge = +v; }
        length = c >= 10 && c <= 38 || stage === 'paths' && edge === 2 && c === 40 || stage === 'pattern' && [43, 44, 45, 46, 47, 49].includes(c);
      }
      if (c === 100) o.s(c, v); else o.p(c, v, length ? precision : 6);
    }
  };

  // what the entities refer to, so the tables hold it
  const blocks = { ...(doc.blocks || {}) };
  for (const n of ['*Model_Space', '*Paper_Space']) if (!Object.keys(blocks).some((k) => k.toLowerCase() === n.toLowerCase())) blocks[n] = { base: [0, 0], entities: [] };
  const layerNames = new Set(['0', ...Object.keys(doc.layers || {})]);
  const ltNames = new Map(Object.entries(doc.ltypes || {}).map(([k, v]) => [k.toUpperCase(), v.pattern || []]));
  const styles = new Set(Object.keys(doc.styles || {})), dimstyles = new Set(Object.keys(doc.dimstyles || {}));
  const lower = new Map();                                       // set → its names in lower case, so a lookup is one Map get, not a copy of the whole set
  const addName = (set, n) => {                                  // names ignore case
    let l = lower.get(set);
    if (!l) lower.set(set, l = new Set([...set].map((k) => k.toLowerCase())));
    const k = n.toLowerCase();
    if (!l.has(k)) { l.add(k); set.add(n); }
  };
  addName(styles, 'Standard'); addName(dimstyles, 'Standard');
  for (const lt of Object.values(doc.ltypes || {})) for (const el of lt.elems || []) if (el.style) addName(styles, el.style);
  const refLt = (n) => { n = (n || '').trim().toUpperCase(); if (n && !['BYLAYER', 'BYBLOCK', 'CONTINUOUS'].includes(n) && !ltNames.has(n)) ltNames.set(n, STD_LT[n] || []); };
  const scanRec = (r, p) => {
    addName(layerNames, p.layer); refLt(p.lt);
    for (let k = 0; k < r.c.length; k++) {
      if (r.c[k] === 7 && r.v[k].trim()) addName(styles, r.v[k].trim());
      if (r.c[k] === 3 && r.type === 'DIMENSION' && r.v[k].trim()) addName(dimstyles, r.v[k].trim());
    }
  };
  const scan = (list) => {
    for (const e of list || []) {
      scanRec(e.r, { ...props(), ...e });
      for (const kid of e.kids || []) scanRec(kid, propsOf(kid));
    }
  };
  scan(doc.entities);
  for (const b of Object.values(blocks)) if (!b.xref) scan(b.entities);
  for (const l of Object.values(doc.layers || {})) refLt(l.lt);

  // handles for the block records first: entities name their owner
  const rec = new Map();
  for (const name of Object.keys(blocks)) rec.set(name, handle());
  const styleRec = new Map([...styles].map((n) => [n.toLowerCase(), handle()]));   // up front: a complex line type points at its text style
  const find = (n) => [...rec.keys()].find((k) => k.toLowerCase() === n.toLowerCase());
  const modelRec = rec.get(find('*Model_Space')), paperRec = rec.get(find('*Paper_Space'));

  // a group keeps the name it was read with; an unnamed or repeated one gets the next free *A<n>
  const taken = new Set(), kept = (doc.groups || []).map((g) => !!g.name && !taken.has(g.name.toUpperCase()) && !!taken.add(g.name.toUpperCase()));
  let n = 0;
  const drawingGroups = (doc.groups || []).map((g, i) => {
    let name = g.name;
    if (!kept[i]) { do n++; while (taken.has('*A' + n)); name = '*A' + n; taken.add(name); }
    return { ...g, name, unnamed: kept[i] ? g.unnamed !== false : true, handle: handle() };
  }), memberOf = new Map();
  for (const g of drawingGroups) for (const i of g.members) {
    if (!memberOf.has(i)) memberOf.set(i, []);
    memberOf.get(i).push(g.handle);
  }

  // entities
  const ent = (o, e, owner, reactors = []) => {
    const isEnt = !!e.r, r = isEnt ? e.r : e, p = isEnt ? { ...props(), ...e } : propsOf(e);
    const h = handle();
    o.s(0, r.type).p(5, h);
    if (reactors.length) {
      o.s(102, '{ACAD_REACTORS');
      for (const group of reactors) o.p(330, group);
      o.s(102, '}');
    }
    o.p(330, owner).s(100, 'AcDbEntity');
    if (p.ps) o.p(67, 1);
    o.s(8, p.layer);
    if (p.lt) o.s(6, p.lt);
    if (p.tc != null) o.p(62, fallbackAci(p.tc));
    else if (p.aci !== 256 && p.aci != null) o.p(62, p.aci);
    if (p.lw !== -1 && p.lw != null) o.p(370, p.lw);
    if (p.lts !== 1 && p.lts != null) o.p(48, p.lts);
    if (p.hidden) o.p(60, 1);
    if (p.tc != null) o.p(420, p.tc);
    const kids = r.type === 'INSERT' || r.type === 'POLYLINE' ? (e.kids || []) : [];
    let spec = specific(r, null);
    if (r.type === 'INSERT') { spec = spec.filter((q) => q[0] !== 66); if (kids.length) spec = insertAfterMarker(spec, [66, '1']); }
    if (r.type === 'POLYLINE') { spec = spec.filter((q) => q[0] !== 66); spec = insertAfterMarker(spec, [66, '1']); }
    record(o, spec, r.type);
    if (r.type === 'POLYLINE' || kids.length) {
      const flags = r.type === 'POLYLINE' ? (r.c.indexOf(70) >= 0 ? r.v[r.c.indexOf(70)] : '0') : null;
      for (const kid of kids) kidRec(o, kid, h, flags);
      o.s(0, 'SEQEND').p(5, handle()).p(330, owner).s(100, 'AcDbEntity');
      if (p.ps) o.p(67, 1);
      o.s(8, p.layer);
    }
    return h;
  };
  const insertAfterMarker = (spec, pair) => (spec.length && spec[0][0] === 100 ? [spec[0], pair, ...spec.slice(1)] : [pair, ...spec]);
  const kidRec = (o, kid, owner, flags) => {
    const p = propsOf(kid);
    o.s(0, kid.type).p(5, handle()).p(330, owner).s(100, 'AcDbEntity');
    if (p.ps) o.p(67, 1);
    o.s(8, p.layer);
    if (p.lt) o.s(6, p.lt);
    if (p.tc != null) o.p(62, fallbackAci(p.tc));
    else if (p.aci !== 256) o.p(62, p.aci);
    if (p.lw !== -1) o.p(370, p.lw);
    if (p.tc != null) o.p(420, p.tc);
    record(o, specific(kid, flags), kid.type);
  };

  // BLOCKS
  const blocksSec = [];
  { const o = out(blocksSec); o.s(0, 'SECTION').s(2, 'BLOCKS');
    for (const [name, b] of Object.entries(blocks)) {
      const owner = rec.get(name), items = b.entities;
      const special = /^\*(model|paper)_space/i.test(name);
      const flags = (/^\*[UDTAX]/i.test(name) ? 1 : 0) | (items.some((e) => e.type === 'ATTDEF') ? 2 : 0);
      o.s(0, 'BLOCK').p(5, handle()).p(330, owner).s(100, 'AcDbEntity').s(8, '0').s(100, 'AcDbBlockBegin').s(2, name).p(70, special ? 0 : flags)
        .p(10, b.base?.[0] || 0).p(20, b.base?.[1] || 0).p(30, 0).s(3, name).s(1, '');
      for (const e of items) ent(o, e, owner);
      o.s(0, 'ENDBLK').p(5, handle()).p(330, owner).s(100, 'AcDbEntity').s(8, '0').s(100, 'AcDbBlockEnd');
    }
    o.s(0, 'ENDSEC'); }

  // ENTITIES
  const entSec = [], entityHandles = [];
  { const o = out(entSec); o.s(0, 'SECTION').s(2, 'ENTITIES');
    for (const [i, e] of doc.entities.entries()) entityHandles.push(ent(o, e, e.ps ? paperRec : modelRec, memberOf.get(i)));
    o.s(0, 'ENDSEC'); }

  // TABLES
  const plotStyles = handle(), normalPlotStyle = handle();
  const tabSec = [];
  { const o = out(tabSec);
    o.s(0, 'SECTION').s(2, 'TABLES');
    const table = (name, count, body, extra) => {
      o.s(0, 'TABLE').s(2, name).p(5, H[name]).p(330, 0).s(100, 'AcDbSymbolTable').p(70, count);
      if (extra) extra();
      body(); o.s(0, 'ENDTAB');
    };
    const rhead = (type, name, sub, table2, h = handle()) => o.s(0, type).p(type === 'DIMSTYLE' ? 105 : 5, h).p(330, H[table2]).s(100, 'AcDbSymbolTableRecord').s(100, sub).s(2, name);
    table('VPORT', 1, () => {
      rhead('VPORT', '*Active', 'AcDbViewportTableRecord', 'VPORT');
      o.p(70, 0).p(10, 0).p(20, 0).p(11, 1).p(21, 1).p(12, 0).p(22, 0).p(13, 0).p(23, 0).p(14, 10).p(24, 10).p(15, 10).p(25, 10)
        .p(16, 0).p(26, 0).p(36, 1).p(17, 0).p(27, 0).p(37, 0).p(40, 100).p(41, 1.5).p(42, 50).p(43, 0).p(44, 0).p(50, 0).p(51, 0)
        .p(71, 0).p(72, 100).p(73, 1).p(74, 3).p(75, 0).p(76, 0).p(77, 0).p(78, 0);
    });
    const lts = ['BYBLOCK', 'BYLAYER', 'CONTINUOUS'];
    table('LTYPE', lts.length + ltNames.size - [...ltNames.keys()].filter((k) => lts.includes(k)).length, () => {
      const desc = { BYBLOCK: '', BYLAYER: '', CONTINUOUS: 'Solid line' };
      const nice = { BYBLOCK: 'ByBlock', BYLAYER: 'ByLayer', CONTINUOUS: 'Continuous' };
      for (const n of lts) { rhead('LTYPE', nice[n], 'AcDbLinetypeTableRecord', 'LTYPE'); o.p(70, 0).s(3, desc[n]).p(72, 65).p(73, 0).p(40, 0); }
      for (const [n, pat] of ltNames) {
        if (lts.includes(n)) continue;
        rhead('LTYPE', n, 'AcDbLinetypeTableRecord', 'LTYPE');
        o.p(70, 0).s(3, '').p(72, 65).p(73, pat.length).p(40, pat.reduce((s, x) => s + Math.abs(x), 0));
        const elems = (doc.ltypes || {})[n]?.elems || [];
        pat.forEach((d, i) => {
          const el = elems[i] || {}, fl = el.flags || 0;
          o.p(49, d).p(74, fl);
          if (!fl) return;
          const sh = styleRec.get((el.style || '').toLowerCase());
          o.p(75, el.shape || 0);
          if (sh) o.p(340, sh);
          o.p(46, el.scale ?? 1).p(50, el.rot || 0).p(44, el.x || 0).p(45, el.y || 0);
          if (fl & 2) o.s(9, el.text || '');
        });
      }
    });
    table('LAYER', layerNames.size, () => {
      for (const name of layerNames) {
        const l = doc.layers?.[name] || layerDef(), aci = l.tc != null ? fallbackAci(l.tc) : l.aci || 7;
        rhead('LAYER', name, 'AcDbLayerTableRecord', 'LAYER');
        o.p(70, ((l.flags || 0) & 6) | (l.frozen ? 1 : 0)).p(62, l.off ? -aci : aci);
        if (l.tc != null) o.p(420, l.tc);
        o.s(6, l.lt || 'CONTINUOUS');
        if (l.plot === false) o.p(290, 0);                                      // "No plot": helper lines must not print or cut
        // AutoCAD needs 390 to resolve to the Normal placeholder in ACAD_PLOTSTYLENAME (TODO 166).
        o.p(370, l.lw ?? -3).s(390, normalPlotStyle);
      }
    });
    table('STYLE', styles.size, () => {
      for (const n of styles) {
        rhead('STYLE', n, 'AcDbTextStyleTableRecord', 'STYLE', styleRec.get(n.toLowerCase()));
        const kept = ciGet(doc.styles, n);
        if (kept) { for (const [c, v] of recPairs(kept)) o.p(c, v); continue; }
        o.p(70, 0).p(40, 0).p(41, 1).p(50, 0).p(71, 0).p(42, 2.5).s(3, FONT_FILES[n] || 'arial.ttf').s(4, '');
      }
    });
    table('VIEW', 0, () => {});
    table('UCS', 0, () => {});
    table('APPID', 1, () => { rhead('APPID', 'ACAD', 'AcDbRegAppTableRecord', 'APPID'); o.p(70, 0); });
    table('DIMSTYLE', dimstyles.size, () => {
      for (const n of dimstyles) { rhead('DIMSTYLE', n, 'AcDbDimStyleTableRecord', 'DIMSTYLE');
        const kept = ciGet(doc.dimstyles, n);
        if (kept) for (const [c, v] of recPairs(kept)) o.p(c, v); else o.p(70, 0);
      }
    }, () => o.s(100, 'AcDbDimStyleTable'));
    table('BLOCK_RECORD', rec.size, () => {
      for (const [name, h] of rec) { o.s(0, 'BLOCK_RECORD').p(5, h).p(330, H.BLOCK_RECORD).s(100, 'AcDbSymbolTableRecord').s(100, 'AcDbBlockTableRecord').s(2, name).p(340, 0); }
    });
    o.s(0, 'ENDSEC'); }

  // OBJECTS: the root dictionary, its group and plot style dictionaries, and the Normal placeholder
  const objSec = [];
  { const o = out(objSec), groups = handle();
    o.s(0, 'SECTION').s(2, 'OBJECTS');
    o.s(0, 'DICTIONARY').p(5, H.ROOT).p(330, 0).s(100, 'AcDbDictionary').p(281, 1)
      .s(3, 'ACAD_GROUP').p(350, groups).s(3, 'ACAD_PLOTSTYLENAME').p(350, plotStyles);
    o.s(0, 'DICTIONARY').p(5, groups).p(330, H.ROOT).s(100, 'AcDbDictionary').p(281, 1);
    for (const g of drawingGroups) o.s(3, g.name).p(350, g.handle);
    for (const g of drawingGroups) {
      o.s(0, 'GROUP').p(5, g.handle).s(102, '{ACAD_REACTORS').p(330, groups).s(102, '}').p(330, groups)
        .s(100, 'AcDbGroup').s(300, g.description || '').p(70, g.unnamed ? 1 : 0).p(71, g.selectable === false ? 0 : 1);
      for (const i of g.members) o.p(340, entityHandles[i]);
    }
    o.s(0, 'ACDBDICTIONARYWDFLT').p(5, plotStyles).s(102, '{ACAD_REACTORS').p(330, H.ROOT).s(102, '}').p(330, H.ROOT)
      .s(100, 'AcDbDictionary').p(281, 1).s(3, 'Normal').p(350, normalPlotStyle).s(100, 'AcDbDictionaryWithDefault').p(340, normalPlotStyle);
    o.s(0, 'ACDBPLACEHOLDER').p(5, normalPlotStyle).s(102, '{ACAD_REACTORS').p(330, plotStyles).s(102, '}').p(330, plotStyles);
    o.s(0, 'ENDSEC'); }

  // HEADER (last: it holds the handle seed and the extents)
  const head = [];
  { const o = out(head), hd = doc.header || {};
    o.s(0, 'SECTION').s(2, 'HEADER');
    o.s(9, '$ACADVER').s(1, 'AC1015');
    o.s(9, '$HANDSEED').s(5, hnext.toString(16).toUpperCase());
    const ext = opts.extents && opts.extents.every(Number.isFinite) ? opts.extents : extents(doc);
    const pt = (name, x, y, z) => o.s(9, name).p(10, x).p(20, y).p(30, z);
    pt('$EXTMIN', ext ? ext[0] : 1e20, ext ? ext[1] : 1e20, ext ? 0 : 1e20);
    pt('$EXTMAX', ext ? ext[2] : -1e20, ext ? ext[3] : -1e20, ext ? 0 : -1e20);
    for (const k of ['$LIMMIN', '$LIMMAX']) if (Array.isArray(hd[k])) o.s(9, k).p(10, hd[k][0]).p(20, hd[k][1]);
    if (Array.isArray(hd.$INSBASE)) pt('$INSBASE', hd.$INSBASE[0], hd.$INSBASE[1], 0);
    for (const [k, kind, c] of HDR) if (hd[k] != null && !Array.isArray(hd[k]) && String(hd[k]).trim() !== '') { o.s(9, k); o.a.push(String(c).padStart(3) + '\r\n' + (kind === 'i' ? intText(hd[k]) : fmt(hd[k], ['$LTSCALE', '$CELTSCALE', '$DIMSCALE', '$ANGBASE'].includes(k) ? 6 : precision))); }
    o.s(9, '$INSUNITS').p(70, hd.$INSUNITS != null && !Array.isArray(hd.$INSUNITS) && String(hd.$INSUNITS).trim() !== '' ? hd.$INSUNITS : 4);
    if (hd.$DWGCODEPAGE) o.s(9, '$DWGCODEPAGE').s(3, hd.$DWGCODEPAGE);
    if (hd.$CLAYER && layerNames.has(String(hd.$CLAYER).trim())) o.s(9, '$CLAYER').s(8, String(hd.$CLAYER).trim());
    o.s(0, 'ENDSEC'); }

  return [...head, ...tabSec, ...blocksSec, ...entSec, ...objSec, '  0\r\nEOF'].join('\r\n') + '\r\n';
}

/** The model-space extents [x0, y0, x1, y1] of what is drawn, or null. */
function extents(doc) {
  try {
    const b = flatten(doc).boxes.model;
    return b && b.every(Number.isFinite) ? b : null;
  } catch { return null; }
}
