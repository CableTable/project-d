import { ACI } from './colour.js';
import { restoreDimensionInserts } from './dimension-text.js';
import { closedOutline, linkFills, fillCss, fillHoles, fillOps } from './fill.js';
// The drawing viewer's reader (.dxf), pure: no DOM, no canvas — drawing.test.mjs. dxf-worker.js runs it off the
// page's thread, viewers.js draws what it gives, and Measure asks pickAt / describe2d / measure2d (geom.js words them).
//
//   flatten(readDxf(decodeDxf(bytes))) → { units, layers, items, mats, vports, boxes, left, truncated }
//   an item, in drawing order: { k, m, L, ps, css, lw, dash | dpx, b, … }
//     k   'p' a path (stroked, or filled with fill: 1) · 'h' a patterned hatch · 't' text · 'w' a wipeout · 'n' a point
//     m   its matrix, mats[m] (a block's placement; 0 is none) · L its layers (its own, then the blocks' it sits in)
//     e   the index of the top-level entity it was drawn from (a block's contents: the INSERT's)
//     ps  on the sheet (paper space) · css its colour · lw its weight (1/100 mm)
//     dash a line type in its own units (on, off, on, off …) · dpx one in screen pixels · b its box [x0, y0, x1, y1]
//   a path's ops: 0 x y (move) · 1 x y (line) · 2 cx cy r a0 a1 cw (arc; cw 1 = clockwise) · 9 (close)

import { fontForStyle } from './fontsub.js';
import { pathCentre } from './snap.js';
export { fontOfStyle } from './fontsub.js';

export class DrawingError extends Error {}

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const MAX_ITEMS = 400000, MAX_MATS = 400000;
export const UNITS = { 1: 'in', 2: 'ft', 3: 'mi', 4: 'mm', 5: 'cm', 6: 'm', 7: 'km', 8: 'µin', 9: 'mil', 10: 'yd', 14: 'dm' };

// ---------------------------------------------------------------- the file's text

/** The file's bytes as text: UTF-8 (2007 on), else the drawing's own code page. */
export function decodeDxf(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (new TextDecoder('latin1').decode(u8.subarray(0, 18)) === 'AutoCAD Binary DXF') {
    throw new DrawingError('This is a binary DXF. Save it as an ASCII DXF to see it here.');
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch {
    const head = new TextDecoder('latin1').decode(u8.subarray(0, 40000));
    const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_(\d+)/i.exec(head);
    try { return new TextDecoder('windows-' + (cp ? cp[1] : '1252')).decode(u8); } catch { return new TextDecoder('windows-1252').decode(u8); }
  }
}

/** The file's sections: header, layers, line types, blocks, entities. */
export function readDxf(text) {
  const raw = String(text).split(/\r\n|\r|\n/), C = [], V = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const c = parseInt(raw[i], 10);
    if (Number.isNaN(c)) {
      if (!raw[i].trim()) { i -= 1; continue; }                // a stray blank line
      throw new DrawingError('Couldn\'t read this drawing.');
    }
    C.push(c); V.push(raw[i + 1].replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));   // the writer encodes it again
  }
  if (!C.length) throw new DrawingError('This drawing is empty.');
  const doc = { header: {}, layers: {}, ltypes: {}, blocks: {}, entities: [] };
  for (let i = 0; i < C.length; i++) {
    if (!(C[i] === 0 && V[i].trim() === 'SECTION' && C[i + 1] === 2)) continue;
    const name = V[i + 1].trim();
    let end = i + 2;
    while (end < C.length && !(C[end] === 0 && V[end].trim() === 'ENDSEC')) end++;
    if (name === 'HEADER') header(doc, C, V, i + 2, end);
    else if (name === 'TABLES') tables(doc, records(C, V, i + 2, end));
    else if (name === 'BLOCKS') blocks(doc, records(C, V, i + 2, end));
    else if (name === 'ENTITIES') doc.entities = entities(records(C, V, i + 2, end));
    i = end;
  }
  return linkFills(restoreDimensionInserts(doc));
}

function header(doc, C, V, from, to) {
  let name = null;
  for (let i = from; i < to; i++) {
    if (C[i] === 9) { name = V[i].trim(); continue; }
    if (!name || name in doc.header) continue;
    doc.header[name] = C[i] === 10 ? [+V[i], C[i + 1] === 20 ? +V[i + 1] : 0] : V[i].trim();
  }
}

/** The pairs between `from` and `to`, cut at each code 0: [{ type, c: codes, v: values }] */
function records(C, V, from, to) {
  const out = [];
  for (let i = from; i < to;) {
    if (C[i] !== 0) { i++; continue; }
    let j = i + 1;
    while (j < to && C[j] !== 0) j++;
    out.push({ type: V[i].trim(), c: C.slice(i + 1, j), v: V.slice(i + 1, j) });
    i = j;
  }
  return out;
}

/** The first value of each code. */
function firsts(r) {
  const f = {};
  for (let k = 0; k < r.c.length; k++) if (!(r.c[k] in f)) f[r.c[k]] = r.v[k];
  return f;
}
const num = (v, d = 0) => { const n = v == null ? NaN : +v; return Number.isFinite(n) ? n : d; };

function tables(doc, recs) {
  const styleOf = {};                                   // STYLE handle → name, for the text of a complex line type
  for (const r of recs) {
    const f = firsts(r);
    // STYLE and DIMSTYLE records are kept as they are (name → { c, v }): the writer puts them back
    if (r.type === 'STYLE' && f[2] != null) { (doc.styles ||= {})[f[2].trim()] = { c: r.c, v: r.v }; if (f[5]) styleOf[f[5].trim().toUpperCase()] = f[2].trim(); }
    else if (r.type === 'DIMSTYLE' && f[2] != null) (doc.dimstyles ||= {})[f[2].trim()] = { c: r.c, v: r.v };
  }
  for (const r of recs) {
    const f = firsts(r);
    if (r.type === 'LAYER' && f[2] != null) {
      const aci = num(f[62], 7);
      doc.layers[f[2].trim()] = { aci: Math.abs(aci) || 7, tc: f[420] != null ? num(f[420]) : null, off: aci < 0,
        frozen: (num(f[70]) & 1) === 1, flags: num(f[70]) & 6, lt: (f[6] || 'CONTINUOUS').trim(), lw: num(f[370], -3), plot: num(f[290], 1) !== 0, handle: (f[5] || '').trim().toUpperCase() };
    } else if (r.type === 'LTYPE' && f[2] != null) {
      const pattern = [], elems = [];
      for (let k = 0; k < r.c.length; k++) {
        const c = r.c[k], v = r.v[k], el = elems[elems.length - 1];
        if (c === 49) { pattern.push(num(v)); elems.push({ flags: 0 }); } else if (!el) continue;
        else if (c === 74) el.flags = num(v); else if (c === 75) el.shape = num(v); else if (c === 340) el.style = styleOf[v.trim().toUpperCase()];
        else if (c === 46) el.scale = num(v); else if (c === 50) el.rot = num(v); else if (c === 44) el.x = num(v); else if (c === 45) el.y = num(v); else if (c === 9) el.text = v;
      }
      doc.ltypes[f[2].trim().toUpperCase()] = elems.some((e) => e.flags) ? { pattern, elems } : { pattern };   // elems: text / shape elements
    }
  }
}

function blocks(doc, recs) {
  for (let k = 0; k < recs.length; k++) {
    if (recs[k].type !== 'BLOCK') continue;
    const f = firsts(recs[k]);
    let j = k + 1;
    while (j < recs.length && recs[j].type !== 'ENDBLK') j++;
    const name = (f[2] || f[3] || '').trim();
    if (name) doc.blocks[name] = { base: [num(f[10]), num(f[20])], xref: (num(f[70]) & 4) === 4, entities: entities(recs.slice(k + 1, j)) };
    k = j;
  }
}

/** Records into entities: a POLYLINE takes its VERTEXes, an INSERT its ATTRIBs. */
function entities(recs) {
  const out = [];
  for (let k = 0; k < recs.length; k++) {
    const r = recs[k];
    if (r.type === 'POLYLINE' || r.type === 'INSERT') {
      const kid = r.type === 'POLYLINE' ? 'VERTEX' : 'ATTRIB', kids = [];
      while (recs[k + 1] && recs[k + 1].type === kid) kids.push(recs[++k]);
      if (recs[k + 1] && recs[k + 1].type === 'SEQEND') k++;
      out.push(entity(r, kids));
    } else if (r.type !== 'VERTEX' && r.type !== 'SEQEND' && r.type !== 'ATTRIB') out.push(entity(r));
  }
  return out;
}

const OCS = new Set(['CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'TEXT', 'ATTRIB', 'INSERT', 'SOLID', 'TRACE', 'HATCH']);

/** An entity's own properties (layer, colour, line type, weight…) and its raw pairs. */
function entity(r, kids) {
  const e = { type: r.type, layer: '0', lt: null, aci: 256, tc: null, lw: -1, lts: 1, hidden: false, ps: false, flip: false, r, kids };
  let own = true, nx = 0, ny = 0, nz = 1;
  for (let k = 0; k < r.c.length; k++) {
    const c = r.c[k], v = r.v[k];
    if (c === 210) nx = num(v); else if (c === 220) ny = num(v); else if (c === 230) nz = num(v, 1);
    if (c === 100) { if (v.trim() !== 'AcDbEntity') own = false; continue; }
    if (!own) continue;
    switch (c) {
      case 8: e.layer = v.trim(); break;
      case 6: e.lt = v.trim(); break;
      case 62: e.aci = num(v, 256); break;
      case 420: e.tc = num(v); break;
      case 370: e.lw = num(v, -1); break;
      case 48: e.lts = num(v, 1) || 1; break;
      case 60: e.hidden = num(v) === 1; break;
      case 67: e.ps = num(v) === 1; break;
    }
  }
  // drawn from below (a mirrored part): its x runs the other way
  e.flip = OCS.has(r.type) && nz < 0 && Math.abs(nx) < 1e-6 && Math.abs(ny) < 1e-6;
  return e;
}

// ---------------------------------------------------------------- 2-D matrices [a, b, c, d, e, f] (canvas order)

export const IDENT = [1, 0, 0, 1, 0, 0];
export const mmul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
export const mapply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const mscale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
const FLIP = [-1, 0, 0, 1, 0, 0];

// ---------------------------------------------------------------- colours and line types

export { ACI } from './colour.js';
const rgbCss = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');

/** A line type's elements (+ dash, − gap, 0 dot) as a canvas dash list: on, off, on, off… */
export function dashArray(pattern) {
  const out = [];
  for (const v of pattern || []) {
    const on = v >= 0, len = Math.abs(v);
    if (out.length % 2 === (on ? 0 : 1)) out.push(len);
    else if (out.length) out[out.length - 1] += len;
    else out.push(0, len);
  }
  if (out.length % 2) out.push(0);
  return out.some((x) => x > 0) && out.some((x, i) => i % 2 && x > 0) ? out : null;
}

/** Screen-pixel dashes for a line type named but not defined in the file. */
function namedDash(name) {
  if (/CENT|CENTER/.test(name)) return [14, 3, 3, 3];
  if (/HIDDEN|DASH|PHANTOM/.test(name)) return [6, 4];
  if (/DOT/.test(name)) return [1.5, 4];
  return null;
}

// ---------------------------------------------------------------- curves

/** True when cp / knots / deg describe a curve nurbs() can evaluate (else it falls back to the fit points or control polygon). */
export const nurbsOk = (cp, knots, deg) => cp.length > deg && knots.length === cp.length + deg + 1 && knots[cp.length] > knots[deg];

/** One point of a NURBS curve at parameter t (de Boor, rational when weights w, one per control point, are given). */
export function nurbsAt(cp, knots, deg, w, t) {
  const n = cp.length;
  let s = deg;
  while (s < n - 1 && t >= knots[s + 1]) s++;
  const d = [];
  for (let j = 0; j <= deg; j++) { const p = cp[j + s - deg], q = w ? w[j + s - deg] : 1; d.push([p[0] * q, p[1] * q, q]); }
  for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
    const den = knots[j + 1 + s - r] - knots[j + s - deg], al = den ? (t - knots[j + s - deg]) / den : 0;
    d[j] = [0, 1, 2].map((k) => (1 - al) * d[j - 1][k] + al * d[j][k]);
  }
  return [d[deg][0] / (d[deg][2] || 1), d[deg][1] / (d[deg][2] || 1)];
}

/** Points on a NURBS curve (de Boor, rational when weights are given); else its fit points or control polygon. */
export function nurbs(cp, knots, deg, weights, fit) {
  const n = cp.length;
  if (nurbsOk(cp, knots, deg)) {
    const w = weights && weights.length === n ? weights : null, out = [], steps = Math.min(Math.max(n * 12, 48), 2000);
    for (let i = 0; i <= steps; i++) out.push(nurbsAt(cp, knots, deg, w, knots[deg] + (knots[n] - knots[deg]) * i / steps));
    return out;
  }
  return fit && fit.length > 1 ? fit : cp;
}

/** The arc a polyline's bulge makes from p to q (tan of a quarter of its angle; + counter-clockwise), as op 2's numbers. */
export function bulgeArc(p, q, bulge) {
  const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
  if (!len) return null;
  const sag = Math.abs(bulge) * len / 2, r = (len * len / 4 + sag * sag) / (2 * sag), off = Math.sign(bulge) * (r - sag);
  const cx = (p[0] + q[0]) / 2 - dy / len * off, cy = (p[1] + q[1]) / 2 + dx / len * off;
  return [cx, cy, r, Math.atan2(p[1] - cy, p[0] - cx), Math.atan2(q[1] - cy, q[0] - cx), bulge < 0 ? 1 : 0];
}

/** An arc's counter-clockwise start and sweep (0, 2π]. */
export function arcSweep(a0, a1, cw) {
  let sw = cw ? a0 - a1 : a1 - a0;
  sw = ((sw % TAU) + TAU) % TAU;
  if (sw < 1e-9) sw = TAU;
  return cw ? [a1, sw] : [a0, sw];
}

/** Polyline points [x, y, bulge] into ops. */
export function polyOps(ops, pts, closed) {
  if (!pts.length) return;
  ops.push(0, pts[0][0], pts[0][1]);
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const a = p[2] ? bulgeArc(p, q, p[2]) : null;
    if (a) ops.push(2, ...a); else ops.push(1, q[0], q[1]);
  }
  if (closed) ops.push(9);
}
const lineOps = (pts, closed) => { const ops = []; polyOps(ops, pts.map((p) => [p[0], p[1], 0]), closed); return ops; };

/** The box of a path's ops (arcs to their extremes), padded by half a width. */
export function opsBox(ops, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (let i = 0; i < ops.length;) {
    const op = ops[i];
    if (op === 0 || op === 1) { add(ops[i + 1], ops[i + 2]); i += 3; } else if (op === 2) {
      const [cx, cy, r, a0, a1, cw] = ops.slice(i + 1, i + 7), [s, sw] = arcSweep(a0, a1, cw);
      add(cx + r * Math.cos(s), cy + r * Math.sin(s)); add(cx + r * Math.cos(s + sw), cy + r * Math.sin(s + sw));
      for (let q = Math.ceil(s / (Math.PI / 2)) * Math.PI / 2; q < s + sw; q += Math.PI / 2) add(cx + r * Math.cos(q), cy + r * Math.sin(q));
      i += 7;
    } else i++;
  }
  return Number.isFinite(x0) ? [x0 - pad, y0 - pad, x1 + pad, y1 + pad] : null;
}
function worldBox(m, b) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]) {
    const [u, v] = mapply(m, x, y);
    x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v);
  }
  return [x0, y0, x1, y1];
}
export const unionBox = (a, b) => !a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

// ---------------------------------------------------------------- text

/** MTEXT / TEXT codes (%%c, \P, {\fArial;…}, \H1.2;) made into plain lines. */
export function plainText(s, multi) {
  let t = String(s == null ? '' : s)
    .replace(/%%[cC]/g, '⌀').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%')
    .replace(/%%(\d{3})/g, (_, d) => String.fromCharCode(+d))
    .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, x) => String.fromCharCode(parseInt(x, 16)));
  if (multi) {
    t = t.replace(/\\\\/g, '\u0001').replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003')       // an escaped \ { } is a letter, not a code
      .replace(/\\P/g, '\n').replace(/\\~/g, ' ').replace(/\\S([^;^]*)[\^/#]([^;]*);/g, '$1/$2')
      .replace(/\\[fFCcHhWwQqTtAap][^;]*;/g, '').replace(/\\[LlOoKkNX]/g, '')
      .replace(/[{}]/g, '').replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}');
  }
  return t.split(/\r?\n/);
}

// Text sizes: a DXF height is the capitals' height; a font's capitals are about 0.7 of its size
export const CAP = 0.7;
const charW = 0.8;                        // a guess at a character's width, in heights (fonts differ)

// ---------------------------------------------------------------- flatten: what to draw

export function flatten(doc, hidden = new Set()) {
  const H = doc.header, units = UNITS[num(H.$INSUNITS)] || '';
  const ltscale = num(H.$LTSCALE, 1) || 1;
  const metric = num(H.$MEASUREMENT, -1) === 1 || ['mm', 'cm', 'm', 'dm', 'km'].includes(units);
  const arrowSize = (num(H.$DIMASZ, 0) || (metric ? 2.5 : 0.18)) * (num(H.$DIMSCALE, 1) || 1);
  const layers = [], layerAt = new Map(), byHandle = new Map();
  for (const [name, l] of Object.entries(doc.layers)) if (l.handle) byHandle.set(l.handle, name);
  const layerOf = (name) => {
    if (layerAt.has(name)) return layerAt.get(name);
    const l = doc.layers[name] || { aci: 7, tc: null, lt: 'CONTINUOUS', lw: -3 };
    layers.push({ name, css: l.tc != null ? rgbCss(l.tc) : ACI[l.aci] || '#ffffff', on: !(l.off || l.frozen), lt: (l.lt || '').toUpperCase(), lw: l.lw >= 0 ? l.lw : 25, n: 0 });
    layerAt.set(name, layers.length - 1);
    return layers.length - 1;
  };
  const mats = [IDENT], items = [], insertions = [], left = {}, vports = [];
  let truncated = false;
  const skip = (type) => { left[type] = (left[type] || 0) + 1; };

  const dashOf = (name, lts) => {
    if (!name || name === 'CONTINUOUS') return {};
    const t = doc.ltypes[name];
    const d = t && dashArray(t.pattern.map((x) => x * ltscale * lts));
    if (d) return t.contour ? { dash: d, dpx: namedDash(name) } : { dash: d }; // only app-created Contour linetypes keep a pixel fallback
    const px = namedDash(name);
    return px ? { dpx: px } : {};
  };

  const holesByList = new Map();
  function walk(ents, ctx, depth) {
    if (!holesByList.has(ents)) holesByList.set(ents, fillHoles(ents, hidden));
    const holes = holesByList.get(ents);
    for (let ei = 0; ei < ents.length; ei++) {
      const e = ents[ei];
      if (truncated) return;
      if (e.hidden) continue;
      const top = depth === 0 ? ei : ctx.ei;                  // the top-level entity this comes from (a block's contents: its INSERT)
      const own = e.layer === '0' && ctx.layer != null ? ctx.layer : layerOf(e.layer);
      const lay = layers[own];
      const L = ctx.L ? [own, ...ctx.L.filter((x) => x !== own)] : [own];
      const css = e.tc != null ? rgbCss(e.tc) : e.aci === 0 ? ctx.css || '#ffffff'
        : e.aci === 256 || e.aci === 257 || e.aci == null ? lay.css : ACI[Math.abs(e.aci)] || lay.css;
      const lw = e.lw === -2 ? ctx.lw ?? 25 : e.lw === -1 ? lay.lw : e.lw === -3 ? 25 : e.lw;
      const ltName = (e.lt || 'BYLAYER').toUpperCase();
      const lt = ltName === 'BYLAYER' ? lay.lt : ltName === 'BYBLOCK' ? ctx.lt || '' : ltName;
      let m = ctx.m;
      if (e.flip) { mats.push(mmul(mats[ctx.m], FLIP)); m = mats.length - 1; }
      const base = { m, L, e: top, ps: ctx.ps != null ? ctx.ps : e.ps ? 1 : 0, css, lw, ...dashOf(lt, e.lts) };
      const put = (it) => {
        if (items.length >= MAX_ITEMS) { truncated = true; return; }
        if (!it.b) return;
        if (it.k === 't') it.font = fontForStyle(doc.styles, it.st);
        it.b = worldBox(mats[it.m], it.b);
        items.push(it);
      };
      const path = (ops, extra) => {
        if (ops.length <= 3 && !(ops.length === 3 && extra?.fill)) return;
        put({ k: 'p', ...base, ops, ...extra, b: opsBox(ops, extra?.w ? extra.w / 2 : 0) });
      };
      const inner = (lt2) => ({ layer: own, L, css, lw, lt: lt2, ps: base.ps, ei: top });
      const r = e.r, f = firsts(r);
      if (e.fill && closedOutline(e)) {
        const ops = fillOps(e, holes.get(e));
        if (ops) put({ k: 'p', ...base, ops, fill: 1, attachedFill: true, exact: /^(tc:|aci:(?!7$))/.test(e.fill), css: fillCss(e.fill, lay.css, ctx.css), b: opsBox(ops) });
      }
      switch (e.type) {
        case 'LINE': path([0, num(f[10]), num(f[20]), 1, num(f[11]), num(f[21])]); break;
        case 'POINT': { const x = num(f[10]), y = num(f[20]); put({ k: 'n', ...base, x, y, b: [x, y, x, y] }); break; }
        case 'CIRCLE': { const cx = num(f[10]), cy = num(f[20]), rad = num(f[40]); if (rad > 0) path([0, cx + rad, cy, 2, cx, cy, rad, 0, TAU, 0]); break; }
        case 'ARC': {
          const cx = num(f[10]), cy = num(f[20]), rad = num(f[40]), a0 = num(f[50]) * DEG;
          let a1 = num(f[51], 360) * DEG; if (a1 <= a0) a1 += TAU;
          if (rad > 0) path([0, cx + rad * Math.cos(a0), cy + rad * Math.sin(a0), 2, cx, cy, rad, a0, a1, 0]);
          break;
        }
        case 'ELLIPSE': {
          const cx = num(f[10]), cy = num(f[20]), mx = num(f[11]), my = num(f[21]), ratio = num(f[40], 1);
          let nz = 1; for (let k = 0; k < r.c.length; k++) if (r.c[k] === 230) nz = num(r.v[k], 1);
          const nx = nz < 0 ? my * ratio : -my * ratio, ny = nz < 0 ? -mx * ratio : mx * ratio;
          const t0 = num(f[41], 0); let t1 = num(f[42], TAU); if (t1 <= t0) t1 += TAU;
          const steps = Math.max(8, Math.ceil(96 * (t1 - t0) / TAU)), ts = Array.from({ length: steps + 1 }, (_, i) => t0 + (t1 - t0) * i / steps);
          // Include exact extrema so the selection index cannot discard a box touching the curve between samples.
          for (const phase of [Math.atan2(nx, mx), Math.atan2(ny, my)]) for (let t = phase + Math.ceil((t0 - phase) / Math.PI) * Math.PI; t < t1; t += Math.PI) ts.push(t);
          const pts = ts.sort((a, b) => a - b).map((t) => [cx + mx * Math.cos(t) + nx * Math.sin(t), cy + my * Math.cos(t) + ny * Math.sin(t)]);
          const full = t1 - t0 > TAU - 1e-6;
          const quads = [];                                                // the 4 axis ends (inside a partial ellipse's sweep): quadrant snaps, as before it was flattened
          for (let k = Math.ceil((t0 - 1e-9) / (TAU / 4)); k * TAU / 4 <= (full ? t1 - 1e-6 : t1 + 1e-9); k++) { const t = k * TAU / 4; quads.push([cx + mx * Math.cos(t) + nx * Math.sin(t), cy + my * Math.cos(t) + ny * Math.sin(t)]); }
          path(lineOps(full ? pts.slice(0, -1) : pts, full), { ell: [cx, cy, quads, mx, my, nx, ny, t0, t1] });
          break;
        }
        case 'LWPOLYLINE': lwpoly(e, f, base, path, put); break;
        case 'POLYLINE': polyline(e, f, base, path); break;
        case 'SPLINE': {
          const cp = [], fit = [], knots = [], w = [];
          for (let k = 0; k < r.c.length; k++) {
            const c = r.c[k];
            if (c === 10) cp.push([num(r.v[k]), r.c[k + 1] === 20 ? num(r.v[k + 1]) : 0]);
            else if (c === 11) fit.push([num(r.v[k]), r.c[k + 1] === 21 ? num(r.v[k + 1]) : 0]);
            else if (c === 40) knots.push(num(r.v[k]));
            else if (c === 41) w.push(num(r.v[k]));
          }
          const pts = nurbs(cp, knots, num(f[71], 3), w, fit);
          if (pts.length > 1) path(lineOps(pts, closedOutline(e)), { spl: 1 });
          break;
        }
        case 'TEXT': text(base, f, false, put); break;
        case 'MTEXT': mtext(base, r, f, put); break;
        case 'SOLID': case 'TRACE': {
          const p = [10, 11, 12, 13].map((c) => f[c] == null ? null : [num(f[c]), num(f[c + 10])]);
          if (!p[3]) p[3] = p[2];
          if (p[0] && p[1] && p[2]) path([0, ...p[0], 1, ...p[1], 1, ...p[3], 1, ...p[2], 9], { fill: 1 });
          break;
        }
        case '3DFACE': {
          const p = [10, 11, 12, 13].map((c) => f[c] == null ? null : [num(f[c]), num(f[c + 10])]).filter(Boolean);
          if (p.length > 2) path(lineOps(p, true));
          break;
        }
        case 'INSERT': case 'ACAD_TABLE': {
          const blk = doc.blocks[(f[2] || '').trim()];
          if (!blk || blk.xref) { skip(blk ? 'XREF' : 'INSERT'); }
          else if (depth < 10) {
            const at = [num(f[10]), num(f[20])];
            const rot = e.type === 'ACAD_TABLE' ? Math.atan2(num(f[21]), num(f[11], 1)) : num(f[50]) * DEG;
            const sx = e.type === 'ACAD_TABLE' ? 1 : num(f[41], 1) || 1, sy = e.type === 'ACAD_TABLE' ? 1 : num(f[42], 1) || 1;
            const cols = Math.min(Math.max(num(f[70], 1), 1), 100), rows = Math.min(Math.max(num(f[71], 1), 1), 100);
            const c = Math.cos(rot), s = Math.sin(rot);
            for (let row = 0; row < rows && !truncated; row++) for (let col = 0; col < cols && !truncated; col++) {
              if (mats.length >= MAX_MATS) { truncated = true; break; }   // arrays of empty blocks draw nothing but still cost a matrix each
              let mm = mmul(mats[m], [1, 0, 0, 1, at[0], at[1]]);
              mm = mmul(mm, [c, s, -s, c, 0, 0]);
              mm = mmul(mm, [1, 0, 0, 1, col * num(f[44]), row * num(f[45])]);
              mm = mmul(mm, [sx, 0, 0, sy, -blk.base[0] * sx, -blk.base[1] * sy]);
              mats.push(mm);
              const start = items.length;
              walk(blk.entities, { m: mats.length - 1, ...inner(lt) }, depth + 1);
              insertions.push({ p: mapply(mm, ...blk.base), start, end: items.length });
            }
          }
          // the block's attributes (title-block fields): in the drawing's own place, not the block's
          for (const a of e.kids || []) {
            const ae = entity(a), af = firsts(a);
            if (ae.hidden || (num(af[70]) & 1)) continue;
            const aOwn = layerOf(ae.layer);
            const acss = ae.tc != null ? rgbCss(ae.tc) : ae.aci === 0 ? css : ae.aci === 256 ? layers[aOwn].css : ACI[Math.abs(ae.aci)] || css;
            let am = ctx.m; if (ae.flip) { mats.push(mmul(mats[ctx.m], FLIP)); am = mats.length - 1; }
            text({ ...base, m: am, L: ctx.L ? [aOwn, ...ctx.L] : [aOwn], css: acss }, af, true, put);
          }
          break;
        }
        case 'DIMENSION': {
          const blk = doc.blocks[(f[2] || '').trim()];
          if (blk && depth < 10) walk(blk.entities, { m, ...inner(lt) }, depth + 1);
          break;
        }
        case 'HATCH': hatch(e, base, put); break;
        case 'LEADER': {
          const pts = [];
          for (let k = 0; k < r.c.length; k++) if (r.c[k] === 10) pts.push([num(r.v[k]), r.c[k + 1] === 20 ? num(r.v[k + 1]) : 0]);
          if (pts.length > 1) {
            path(lineOps(pts, false));
            if (num(f[71], 1) !== 0) arrow(pts[1], pts[0], arrowSize, base, put);
          }
          break;
        }
        case 'MULTILEADER': case 'MLEADER': mleader(e, base, put, arrowSize); break;
        case 'WIPEOUT': {
          const ins = [num(f[10]), num(f[20])], u = [num(f[11]), num(f[21])], v = [num(f[12]), num(f[22])];
          let cl = [];
          for (let k = 0; k < r.c.length; k++) if (r.c[k] === 14) cl.push([num(r.v[k]), r.c[k + 1] === 24 ? num(r.v[k + 1]) : 0]);
          if (cl.length === 2) cl = [cl[0], [cl[1][0], cl[0][1]], cl[1], [cl[0][0], cl[1][1]]];
          if (cl.length < 3) cl = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
          const pts = cl.map(([x, y]) => [ins[0] + u[0] * (x + 0.5) + v[0] * (0.5 - y), ins[1] + u[1] * (x + 0.5) + v[1] * (0.5 - y)]);
          const ops = lineOps(pts, true);
          put({ k: 'w', ...base, ops, b: opsBox(ops) });
          break;
        }
        case 'VIEWPORT': {
          if (depth || !e.ps) break;
          const id = num(f[69], 2), status = f[68] == null ? 1 : num(f[68]);
          if (id === 1 || status === 0 || num(f[45]) <= 0) break;
          const frozen = [];
          for (let k = 0; k < r.c.length; k++) if (r.c[k] === 341) { const n = byHandle.get(r.v[k].trim().toUpperCase()); if (n) frozen.push(layerOf(n)); }
          vports.push({ cx: num(f[10]), cy: num(f[20]), w: num(f[40]), h: num(f[41]), vcx: num(f[12]), vcy: num(f[22]), vh: num(f[45]), tw: num(f[51]) * DEG, frozen });
          break;
        }
        case 'ATTDEF': case 'SEQEND': case 'ENDBLK': break;
        default: skip(e.type);
      }
    }
  }
  walk(doc.entities, { m: 0, L: null, layer: null, css: null, lw: null, lt: null, ps: null }, 0);
  for (const e of doc.entities) if (!e.hidden) layerOf(e.layer);       // past the draw limit the walk stops early: later layers still belong in the list (counts, Objects tree)

  const boxes = { model: null, paper: null };
  for (const it of items) if (it.L.every((l) => layers[l].on)) boxes[it.ps ? 'paper' : 'model'] = unionBox(boxes[it.ps ? 'paper' : 'model'], it.b);
  for (const v of vports) boxes.paper = unionBox(boxes.paper, [v.cx - v.w / 2, v.cy - v.h / 2, v.cx + v.w / 2, v.cy + v.h / 2]);
  for (const it of items) layers[it.L[0]].n++;
  for (const l of layers) delete l.lt;
  return { units, layers, items, insertions, mats, vports, boxes, left, truncated };
}

/** A filled arrowhead at `tip`, pointing away from `from`. */
function arrow(from, tip, size, base, put) {
  const dx = tip[0] - from[0], dy = tip[1] - from[1], l = Math.hypot(dx, dy);
  if (!l || !(size > 0)) return;
  const ux = dx / l, uy = dy / l, bx = tip[0] - ux * size, by = tip[1] - uy * size, w = size / 6;
  const ops = [0, tip[0], tip[1], 1, bx - uy * w, by + ux * w, 1, bx + uy * w, by - ux * w, 9];
  put({ k: 'p', ...base, dash: undefined, dpx: undefined, ops, fill: 1, b: opsBox(ops) });
}

/** Physical stroke in mm: polyline widths follow geometry; lineweight is already in 1/100 mm. */
export const strokeWidth = (it, factor = 1, scale = 1) => Math.max(it.w ? it.w * factor * scale : (it.lw || 0) / 100, 0.05);

function lwpoly(e, f, base, path, put) {
  const r = e.r, pts = [];
  let cur = null;
  for (let k = 0; k < r.c.length; k++) {
    const c = r.c[k], v = r.v[k];
    if (c === 10) { cur = [num(v), 0, 0, 0, 0]; pts.push(cur); } else if (!cur) continue;
    else if (c === 20) cur[1] = num(v); else if (c === 42) cur[2] = num(v); else if (c === 40) cur[3] = num(v); else if (c === 41) cur[4] = num(v);
  }
  const closed = (num(f[70]) & 1) === 1, cw = num(f[43]);
  if (pts.length < 2) return;
  const widths = pts.slice(0, closed ? pts.length : -1).flatMap((p) => [p[3], p[4]]);
  const even = widths.every((x) => x === widths[0]);
  if (cw > 0 || (even && widths[0] > 0)) { const ops = []; polyOps(ops, pts, closed); path(ops, { w: cw > 0 ? cw : widths[0] }); return; }
  if (even) { const ops = []; polyOps(ops, pts, closed); path(ops); return; }
  // widths that change along it (an arrow drawn as a polyline): each wide straight piece a filled quad
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], ops = [];
    if (!p[2] && (p[3] > 0 || p[4] > 0)) {
      const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, a = p[3] / 2, b = p[4] / 2;
      const quad = [0, p[0] + nx * a, p[1] + ny * a, 1, q[0] + nx * b, q[1] + ny * b, 1, q[0] - nx * b, q[1] - ny * b, 1, p[0] - nx * a, p[1] - ny * a, 9];
      put({ k: 'p', ...base, ops: quad, fill: 1, b: opsBox(quad) });
    } else { polyOps(ops, [p, q], false); path(ops, p[3] || p[4] ? { w: (p[3] + p[4]) / 2 } : undefined); }
  }
}

function polyline(e, f, base, path) {
  const flags = num(f[70]);
  const verts = (e.kids || []).map((k) => { const g = firsts(k); return { x: num(g[10]), y: num(g[20]), b: num(g[42]), fl: num(g[70]), i: [71, 72, 73, 74].map((c) => num(g[c])) }; });
  if (flags & 16) return;                                              // a 3-D mesh: not drawn
  if (flags & 64) {                                                    // a polyface: its faces' visible edges
    const at = verts.filter((v) => (v.fl & 128) && (v.fl & 64));
    const ops = [];
    for (const v of verts.filter((x) => (x.fl & 128) && !(x.fl & 64))) {
      const ids = v.i.filter((x) => x !== 0);
      ids.forEach((a, j) => {
        const b = ids[(j + 1) % ids.length], p = at[Math.abs(a) - 1], q = at[Math.abs(b) - 1];
        if (a > 0 && p && q) ops.push(0, p.x, p.y, 1, q.x, q.y);
      });
    }
    path(ops);
    return;
  }
  const pts = verts.filter((v) => !(v.fl & 16)).map((v) => [v.x, v.y, flags & 8 ? 0 : v.b]);
  if (pts.length < 2) return;
  const ops = [];
  polyOps(ops, pts, (flags & 1) === 1);
  path(ops, num(f[40]) > 0 && num(f[40]) === num(f[41]) ? { w: num(f[40]) } : undefined);
}

/** TEXT (and ATTRIB, whose vertical place is code 74). */
function text(base, f, attrib, put) {
  const h = num(f[40]), s = f[1];
  if (!(h > 0) || s == null) return;
  let ha = num(f[72]), va = num(attrib ? f[74] : f[73]);
  let p = [num(f[10]), num(f[20])], rot = num(f[50]) * DEG;
  if (ha === 3 || ha === 5) {                                          // aligned / fit: between its two points
    if (f[11] != null) rot = Math.atan2(num(f[21]) - p[1], num(f[11]) - p[0]);
    ha = 0; va = 0;
  } else if ((ha || va) && f[11] != null) p = [num(f[11]), num(f[21])];
  if (ha === 4) { ha = 1; va = 2; }
  const fl = num(f[71]), lines = plainText(s, false);
  const wf = num(f[41], 1) || 1;
  textItem(base, p, h, rot, lines, Math.min(ha, 2), ['alphabetic', 'bottom', 'middle', 'top'][va] || 'alphabetic', wf, fl, (it) => put({ ...it, st: f[7], insertion: p }));
}

function mtext(base, r, f, put) {
  let s = '';
  for (let k = 0; k < r.c.length; k++) if (r.c[k] === 3 || r.c[k] === 1) s += r.v[k];
  const h = num(f[40]);
  if (!(h > 0) || !s) return;
  const ap = Math.min(Math.max(num(f[71], 1), 1), 9) - 1;
  const rot = f[11] != null && (num(f[11]) || num(f[21])) ? Math.atan2(num(f[21]), num(f[11])) : num(f[50]) * DEG;
  const bold = /\\f[^;]*\|b1/.test(s);   // a bold font code: {\fArial|b1;...}
  textItem(base, [num(f[10]), num(f[20])], h, rot, plainText(s, true), ap % 3, ['top', 'middle', 'bottom'][Math.floor(ap / 3)], 1, 0, (it) => put({ ...it, st: f[7], bold, insertion: [num(f[10]), num(f[20])] }),
    { multi: 1, lh: h * 5 / 3 * (num(f[44], 1) || 1), wrap: num(f[41]) });
}

function textItem(base, p, h, rot, lines, ha, va, wf, fl, put, more) {
  if (more && more.wrap > 0 && more.wrap < h * 2) more = { ...more, wrap: 0 };   // a width too narrow for a word: no wrap
  const lh = more ? more.lh : h * 5 / 3, n = lines.length;
  const w = Math.max(...lines.map((l) => l.length)) * h * charW * wf, wrapW = more && more.wrap > 0 ? Math.min(w, more.wrap) : w;
  const tall = (n - 1) * lh + h;
  const x0 = -wrapW * ha / 2;
  const y0 = more ? (va === 'top' ? -tall : va === 'middle' ? -tall / 2 : 0) : va === 'top' ? -h : va === 'middle' ? -h / 2 : va === 'bottom' ? 0 : -h * 0.25;
  const words = lines.join(' ').split(/\s+/).length;
  const grow = more && more.wrap > 0 && w > more.wrap ? Math.min(Math.ceil(w / more.wrap), words) * lh : 0;      // wrapped lines go down
  const c = Math.cos(rot), s = Math.sin(rot), corners = [[x0, y0 - grow], [x0 + wrapW, y0 - grow], [x0 + wrapW, y0 + tall], [x0, y0 + tall]]
    .map(([x, y]) => [p[0] + x * c - y * s, p[1] + x * s + y * c]);
  const pad = h * 0.3, b0 = corners.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[0]), Math.max(a[3], q[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  const b = [b0[0] - pad, b0[1] - pad, b0[2] + pad, b0[3] + pad];
  put({ k: 't', ...base, dash: undefined, dpx: undefined, x: p[0], y: p[1], h, rot, lines, ha, va, wf, mx: fl & 2 ? -1 : 1, my: fl & 4 ? -1 : 1, ...more, b });
}

function hatch(e, base, put) {
  const c = e.r.c, v = e.r.v, n = c.length;
  let k = 0, solid = false;
  const take = (code) => (c[k] === code ? num(v[k++]) : undefined);
  while (k < n && c[k] !== 91) { if (c[k] === 70) solid = num(v[k]) === 1; k++; }
  if (k >= n) return;
  const loops = num(v[k++]), ops = [];
  for (let q = 0; q < loops && k < n; q++) {
    while (k < n && c[k] !== 92) k++;
    const type = num(v[k++]);
    if (type & 2) {
      let bulge = false, cnt = 0;                                      // a boundary is always closed
      while (k < n && c[k] !== 10) { if (c[k] === 72) bulge = num(v[k]) === 1; else if (c[k] === 93) cnt = num(v[k]); k++; }
      const pts = [];
      for (let i = 0; i < cnt && c[k] === 10; i++) { const x = take(10), y = take(20) || 0, b = bulge ? take(42) || 0 : 0; pts.push([x, y, b]); }
      polyOps(ops, pts, true);
    } else {
      while (k < n && c[k] !== 93) k++;
      const edges = num(v[k++]);
      let first = true;
      const to = (x, y) => { ops.push(first ? 0 : 1, x, y); first = false; };
      for (let i = 0; i < edges && k < n; i++) {
        while (k < n && c[k] !== 72) k++;
        const et = num(v[k++]);
        if (et === 1) { const x1 = take(10), y1 = take(20), x2 = take(11), y2 = take(21); to(x1, y1); ops.push(1, x2, y2); }
        else if (et === 2) {
          const cx = take(10), cy = take(20), rad = take(40), s = (take(50) || 0) * DEG, en = (take(51) || 0) * DEG, ccw = take(73) !== 0;
          const a0 = ccw ? s : -s, a1 = ccw ? en : -en;
          to(cx + rad * Math.cos(a0), cy + rad * Math.sin(a0)); ops.push(2, cx, cy, rad, a0, a1, ccw ? 0 : 1);
        } else if (et === 3) {
          const cx = take(10), cy = take(20), mx = take(11), my = take(21), ratio = take(40) || 1;
          const s = (take(50) || 0) * DEG, en = (take(51) || 0) * DEG, ccw = take(73) !== 0;
          let t0 = ccw ? s : -s, t1 = ccw ? en : -en;
          if (ccw && t1 <= t0) t1 += TAU; if (!ccw && t1 >= t0) t1 -= TAU;
          const steps = Math.max(8, Math.ceil(64 * Math.abs(t1 - t0) / TAU));
          for (let j = 0; j <= steps; j++) { const t = t0 + (t1 - t0) * j / steps; to(cx + mx * Math.cos(t) - my * ratio * Math.sin(t), cy + my * Math.cos(t) + mx * ratio * Math.sin(t)); }
        } else if (et === 4) {
          const deg = take(94) || 3, rational = take(73); take(74);
          const nk = take(95) || 0, nc = take(96) || 0, knots = [], cps = [], w = [], fit = [];
          for (let j = 0; j < nk && c[k] === 40; j++) knots.push(take(40));
          for (let j = 0; j < nc && c[k] === 10; j++) { cps.push([take(10), take(20) || 0]); if (rational && c[k] === 42) w.push(take(42)); }
          if (c[k] === 97) { const nf = take(97); for (let j = 0; j < nf && c[k] === 11; j++) fit.push([take(11), take(21) || 0]); }
          for (const p of nurbs(cps, knots, deg, w, fit)) to(p[0], p[1]);
        }
      }
      if (!first) ops.push(9);
    }
    if (c[k] === 97) { const src = num(v[k++]); for (let i = 0; i < src && c[k] === 330; i++) k++; }
  }
  let grad = false;
  for (let i = k; i < n; i++) if (c[i] === 450 && num(v[i]) === 1) grad = true;
  const b = opsBox(ops);
  if (!b) return;
  const base2 = { ...base, dash: undefined, dpx: undefined };
  if (solid || grad) { put({ k: 'p', ...base2, ops, fill: 1, a: grad ? 0.4 : 1, b }); return; }
  const fam = [];
  while (k < n && c[k] !== 78) k++;
  if (k < n) {
    const lines = num(v[k++]);
    for (let i = 0; i < lines && c[k] === 53; i++) {
      const a = take(53) * DEG, bx = take(43) || 0, by = take(44) || 0, ox = take(45) || 0, oy = take(46) || 0, nd = take(79) || 0, d = [];
      for (let j = 0; j < nd && c[k] === 49; j++) d.push(take(49));
      fam.push({ a, bx, by, ox, oy, dash: dashArray(d) });
    }
  }
  put({ k: 'h', ...base2, ops, fam, b });
}

/** The ops of a HATCH's boundary (all loops in one path), null when it draws nothing. */
export function hatchOps(e) {
  let ops = null;
  hatch(e, {}, (it) => { if (it.k === 'p') ops = it.ops; });
  return ops;
}

/** A multileader: its lines, arrows and text (the parts most drawings use). */
function mleader(e, base, put, arrowSize) {
  const c = e.r.c, v = e.r.v, stack = [];
  let text = '', tp = null, th = 0, dir = null, size = 0, landing = null, dog = null, dogLen = 0;
  const lines = [];
  let line = null;
  for (let k = 0; k < c.length; k++) {
    const s = v[k].trim();
    if (c[k] === 300 && s === 'CONTEXT_DATA{') { stack.push('ctx'); continue; }
    if (c[k] === 302 && s === 'LEADER{') { stack.push('leader'); continue; }
    if (c[k] === 304 && s === 'LEADER_LINE{') { stack.push('line'); line = []; lines.push({ pts: line, end: null }); continue; }
    if ((c[k] === 301 || c[k] === 303 || c[k] === 305) && s === '}') { const top = stack.pop(); if (top === 'line') { lines[lines.length - 1].end = landing; line = null; } continue; }
    const where = stack[stack.length - 1];
    const pt = () => [num(v[k]), c[k + 1] === c[k] + 10 ? num(v[k + 1]) : 0];
    if (where === 'line' && c[k] === 10) line.push(pt());
    else if (where === 'leader') { if (c[k] === 10) landing = pt(); else if (c[k] === 11) dog = pt(); else if (c[k] === 40) dogLen = num(v[k]); }
    else if (where === 'ctx') {
      if (c[k] === 304) text += v[k]; else if (c[k] === 12) tp = pt(); else if (c[k] === 41) th = num(v[k]);
      else if (c[k] === 13) dir = pt(); else if (c[k] === 140) size = num(v[k]);
    }
  }
  const sz = size > 0 ? size : arrowSize;
  for (const l of lines) {
    const pts = l.end ? [...l.pts, l.end] : l.pts;
    if (pts.length > 1) {
      const ops = lineOps(pts, false);
      put({ k: 'p', ...base, ops, b: opsBox(ops) });
      arrow(pts[1], pts[0], sz, base, put);
    }
  }
  if (landing && dog && dogLen > 0) {
    const ops = [0, landing[0], landing[1], 1, landing[0] + dog[0] * dogLen, landing[1] + dog[1] * dogLen];
    put({ k: 'p', ...base, ops, b: opsBox(ops) });
  }
  if (text && tp && th > 0) {
    const right = dog && dog[0] < 0;
    textItem(base, tp, th, dir ? Math.atan2(dir[1], dir[0]) : 0, plainText(text, true), right ? 2 : 0, 'top', 1, 0, put, { multi: 1, lh: th * 5 / 3, wrap: 0 });
  }
}

// ---------------------------------------------------------------- Measure: what's under a point

const similar = (m) => Math.abs(m[0] * m[0] + m[1] * m[1] - m[2] * m[2] - m[3] * m[3]) < 1e-9 * (m[0] * m[0] + m[1] * m[1] + 1e-30)
  && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-9 * (m[0] * m[0] + m[1] * m[1] + 1e-30);

/**
 * The pickable pieces of one space (the model, or the sheet): straight pieces, arcs, and snap points (ends,
 * middles, centres, points), in the drawing's own coordinates, on a grid for quick lookups.
 */
export function pickIndex(fl, paper, visible = () => true) {
  const pieces = [], snaps = [];
  for (const { p: [x, y], start, end } of fl.insertions || []) {
    for (let it = start; it < end; it++) if (!!fl.items[it].ps === !!paper && visible(it)) {
      snaps.push({ x, y, kind: 'insertion', it });
      break;
    }
  }
  fl.items.forEach((it, idx) => {
    if (!!it.ps !== !!paper) return;
    const m = fl.mats[it.m];
    if (it.insertion) { const [x, y] = mapply(m, ...it.insertion); snaps.push({ x, y, kind: 'insertion', it: idx }); }
    if (it.k === 'n') { const [x, y] = mapply(m, it.x, it.y); snaps.push({ x, y, kind: 'node', it: idx }); return; }
    if (it.k !== 'p' || it.fill) return;
    const ops = it.ops, sim = similar(m), sc = mscale(m), flipped = m[0] * m[3] - m[1] * m[2] < 0;
    if (!it.ell && !it.spl) {
      const centre = pathCentre(ops);
      if (centre) { const [x, y] = mapply(m, ...centre); snaps.push({ x, y, kind: 'geometric', it: idx }); }
    }
    const curve = !!(it.ell || it.spl), s0 = snaps.length;                 // an ellipse or spline is flattened: the joints of its pieces are no ends or middles (only its own ends are), Nearest finds the curve
    let cur = null, first = null, justMoved = false, closed = false;
    const seg = (a, b) => {
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-12) return;
      pieces.push({ t: 's', it: idx, x1: a[0], y1: a[1], x2: b[0], y2: b[1], curve });
      if (!curve) snaps.push({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, kind: 'mid', it: idx });
    };
    for (let i = 0; i < ops.length; justMoved = ops[i] === 0, i += ops[i] === 2 ? 7 : ops[i] === 9 ? 1 : 3) {
      const op = ops[i];
      if (op === 0) { cur = first = mapply(m, ops[i + 1], ops[i + 2]); snaps.push({ x: cur[0], y: cur[1], kind: 'end', it: idx }); }
      else if (op === 1) { const p = mapply(m, ops[i + 1], ops[i + 2]); if (cur) seg(cur, p); cur = p; if (!curve) snaps.push({ x: p[0], y: p[1], kind: 'end', it: idx }); }
      else if (op === 2) {
        const [cx, cy, r, a0, a1, cw] = ops.slice(i + 1, i + 7);
        const [s, sw] = arcSweep(a0, a1, cw), full = sw > TAU - 1e-6;
        if (full && justMoved) snaps.pop();                              // a circle's start is no end
        const ps = mapply(m, cx + r * Math.cos(a0), cy + r * Math.sin(a0)), pe = mapply(m, cx + r * Math.cos(a1), cy + r * Math.sin(a1));
        if (cur && Math.hypot(ps[0] - cur[0], ps[1] - cur[1]) > 1e-9 * (1 + r)) seg(cur, ps);
        if (sim) {
          const c = mapply(m, cx, cy), R = r * sc;
          const on = (t) => mapply(m, cx + r * Math.cos(t), cy + r * Math.sin(t));
          const pm = on(s + sw / 2), from = on(flipped ? s + sw : s);       // a mirror turns the arc round
          const ws = Math.atan2(from[1] - c[1], from[0] - c[0]);
          pieces.push({ t: 'a', it: idx, cx: c[0], cy: c[1], r: R, s: ws, sw, full });
          for (let j = 0; j < 4; j++) {
            const t = j * TAU / 4, rel = ((t - ws) % TAU + TAU) % TAU;
            if (full || rel <= sw + 1e-9 || rel >= TAU - 1e-9) snaps.push({ x: c[0] + R * Math.cos(t), y: c[1] + R * Math.sin(t), kind: 'quadrant', it: idx });
          }
          snaps.push({ x: c[0], y: c[1], kind: 'centre', it: idx });
          if (!full) { snaps.push({ x: pm[0], y: pm[1], kind: 'mid', it: idx }); snaps.push({ x: ps[0], y: ps[1], kind: 'end', it: idx }, { x: pe[0], y: pe[1], kind: 'end', it: idx }); }
        } else {                                                     // stretched by its block: an ellipse, in pieces
          const steps = Math.max(8, Math.ceil(48 * sw / TAU));
          let p = mapply(m, cx + r * Math.cos(s), cy + r * Math.sin(s));
          for (let j = 1; j <= steps; j++) { const t = s + sw * j / steps, q = mapply(m, cx + r * Math.cos(t), cy + r * Math.sin(t)); pieces.push({ t: 's', it: idx, x1: p[0], y1: p[1], x2: q[0], y2: q[1], curve: true }); p = q; }
          for (let j = Math.ceil((s - 1e-9) / (TAU / 4)); j * TAU / 4 <= s + sw + 1e-9; j++) {
            const t = j * TAU / 4, q = mapply(m, cx + r * Math.cos(t), cy + r * Math.sin(t));
            snaps.push({ x: q[0], y: q[1], kind: 'quadrant', it: idx });
          }
          const c = mapply(m, cx, cy); snaps.push({ x: c[0], y: c[1], kind: 'centre', it: idx });
        }
        cur = pe;
      } else { if (cur && first) seg(cur, first); cur = first; closed = true; }
    }
    if (curve) { if (closed) snaps.splice(s0, 1); else if (cur) snaps.push({ x: cur[0], y: cur[1], kind: 'end', it: idx }); }   // a closed curve has no end; an open one, its last point
    if (it.ell) {
      const c = mapply(m, it.ell[0], it.ell[1]); snaps.push({ x: c[0], y: c[1], kind: 'centre', it: idx });
      for (const q of it.ell[2]) { const p = mapply(m, q[0], q[1]); snaps.push({ x: p[0], y: p[1], kind: 'quadrant', it: idx }); }
    }
  });
  // the grid
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (a, b, c2, d) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c2); y1 = Math.max(y1, d); };
  const pbox = (p) => p.t === 's' ? [Math.min(p.x1, p.x2), Math.min(p.y1, p.y2), Math.max(p.x1, p.x2), Math.max(p.y1, p.y2)] : [p.cx - p.r, p.cy - p.r, p.cx + p.r, p.cy + p.r];
  for (const p of pieces) grow(...pbox(p));
  for (const s of snaps) grow(s.x, s.y, s.x, s.y);
  for (const it of fl.items) if (!!it.ps === !!paper) grow(...it.b);
  if (!Number.isFinite(x0)) return { pieces, snaps, G: 0 };
  const G = Math.min(512, Math.max(1, Math.ceil(Math.sqrt((pieces.length + snaps.length + fl.items.length) / 3))));
  const cell = Math.max(x1 - x0, y1 - y0, 1e-9) / G;
  const ix = { pieces, snaps, G, cell, x0, y0, pc: new Map(), sc: new Map(), wide: [] };
  const key = (i, j) => i * 4096 + j;
  const at = (x) => Math.min(G - 1, Math.max(0, Math.floor(x)));
  pieces.forEach((p, n) => {
    const [a, b, c2, d] = pbox(p);
    const i0 = at((a - x0) / cell), i1 = at((c2 - x0) / cell), j0 = at((b - y0) / cell), j1 = at((d - y0) / cell);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 256) { ix.wide.push(n); return; }
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const kk = key(i, j); if (!ix.pc.has(kk)) ix.pc.set(kk, []); ix.pc.get(kk).push(n); }
  });
  snaps.forEach((s, n) => { const kk = key(at((s.x - x0) / cell), at((s.y - y0) / cell)); if (!ix.sc.has(kk)) ix.sc.set(kk, []); ix.sc.get(kk).push(n); });
  return ix;
}

/** The nearest point on a piece to (x, y), and how far. */
function nearOn(p, x, y) {
  if (p.t === 's') {
    const dx = p.x2 - p.x1, dy = p.y2 - p.y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - p.x1) * dx + (y - p.y1) * dy) / l2)) : 0;
    const q = [p.x1 + dx * t, p.y1 + dy * t];
    return { q, d: Math.hypot(x - q[0], y - q[1]) };
  }
  const a = Math.atan2(y - p.cy, x - p.cx), rel = (((a - p.s) % TAU) + TAU) % TAU;
  if (p.full || rel <= p.sw) { const q = [p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a)]; return { q, d: Math.hypot(x - q[0], y - q[1]) }; }
  const e1 = [p.cx + p.r * Math.cos(p.s), p.cy + p.r * Math.sin(p.s)], e2 = [p.cx + p.r * Math.cos(p.s + p.sw), p.cy + p.r * Math.sin(p.s + p.sw)];
  const d1 = Math.hypot(x - e1[0], y - e1[1]), d2 = Math.hypot(x - e2[0], y - e2[1]);
  return d1 < d2 ? { q: e1, d: d1 } : { q: e2, d: d2 };
}

/** Visible pieces within the pick aperture, using the grid (including pieces spanning many cells). */
export function piecesNear(ix, x, y, tol, visible = () => true) {
  if (!ix.G) return [];
  const at = (v) => Math.min(ix.G - 1, Math.max(0, Math.floor(v)));
  const i0 = at((x - tol - ix.x0) / ix.cell), i1 = at((x + tol - ix.x0) / ix.cell), j0 = at((y - tol - ix.y0) / ix.cell), j1 = at((y + tol - ix.y0) / ix.cell);
  const seen = new Set(ix.wide), out = [];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const n of ix.pc.get(i * 4096 + j) || []) seen.add(n);
  for (const n of seen) {
    const ent = ix.pieces[n];
    if (!visible(ent.it)) continue;
    const { q, d } = nearOn(ent, x, y);
    if (d <= tol) out.push({ ent, near: q, d });
  }
  return out;
}

/**
 * What's under (x, y) within `tol`: a snap point (end, middle, centre, point) first, else the nearest line or
 * arc. visible(item index) says what's showing. → { point, snap: { x, y, kind } | null, ent: piece | null }
 */
export function pickAt(ix, x, y, tol, visible = () => true) {
  const out = { point: [x, y], snap: null, ent: null };
  if (!ix.G) return out;
  const at = (v) => Math.min(ix.G - 1, Math.max(0, Math.floor(v)));
  const i0 = at((x - tol - ix.x0) / ix.cell), i1 = at((x + tol - ix.x0) / ix.cell), j0 = at((y - tol - ix.y0) / ix.cell), j1 = at((y + tol - ix.y0) / ix.cell);
  let best = tol, seen = new Set();
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const n of ix.sc.get(i * 4096 + j) || []) {
    const s = ix.snaps[n], d = Math.hypot(s.x - x, s.y - y);
    if (d <= best && visible(s.it)) { best = d; out.snap = { x: s.x, y: s.y, kind: s.kind }; }
  }
  best = tol;
  const look = (n) => {
    if (seen.has(n)) return; seen.add(n);
    const p = ix.pieces[n];
    if (!visible(p.it)) return;
    const r = nearOn(p, x, y);
    if (r.d <= best) { best = r.d; out.ent = p; out.near = r.q; }
  };
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const n of ix.pc.get(i * 4096 + j) || []) look(n);
  for (const n of ix.wide) look(n);
  seen = null;
  if (out.snap) out.point = [out.snap.x, out.snap.y];
  else if (out.near) out.point = out.near;
  return out;
}

/** What one pick reads as: a circle's Ø, an arc's R, a line's length, or where a point is. */
export function describe2d(pick) {
  const e = pick.snap ? null : pick.ent;
  if (e && e.t === 'a') return e.full ? { kind: 'diameter', value: e.r * 2 } : { kind: 'radius', value: e.r };
  if (e && e.t === 's') return { kind: 'length', value: Math.hypot(e.x2 - e.x1, e.y2 - e.y1) };
  return { kind: 'at', x: pick.point[0], y: pick.point[1] };
}

const lineDist = (p, s) => {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l = Math.hypot(dx, dy) || 1;
  return Math.abs((p[0] - s.x1) * dy - (p[1] - s.y1) * dx) / l;
};

/**
 * What two picks measure: two lines — the gap (parallel) or the angle; a line and a hole — centre to line;
 * a line and a point — point to line; two holes or arcs — centre to centre; else point to point (x, y).
 * A hole or arc counts from its centre.
 */
export function measure2d(a, b) {
  const A = a.snap ? null : a.ent, B = b.snap ? null : b.ent;
  const at = (p, E) => E && E.t === 'a' ? [E.cx, E.cy] : p.point;
  const pa = at(a, A), pb = at(b, B);
  if (A && B && A.t === 's' && B.t === 's') {
    const u = Math.atan2(A.y2 - A.y1, A.x2 - A.x1), w = Math.atan2(B.y2 - B.y1, B.x2 - B.x1);
    let ang = Math.abs(u - w) % Math.PI; if (ang > Math.PI / 2) ang = Math.PI - ang;
    if (ang < 0.5 * DEG) return { kind: 'gap', value: lineDist([(B.x1 + B.x2) / 2, (B.y1 + B.y2) / 2], A) };
    return { kind: 'angle', value: ang / DEG };
  }
  const line = A && A.t === 's' ? A : B && B.t === 's' ? B : null;
  if (line) {
    const other = line === A ? { p: pb, E: B } : { p: pa, E: A };
    return { kind: other.E && other.E.t === 'a' ? 'centre-line' : 'point-line', value: lineDist(other.p, line) };
  }
  const dx = pb[0] - pa[0], dy = pb[1] - pa[1];
  if (A && B) return { kind: 'centres', value: Math.hypot(dx, dy), dx: Math.abs(dx), dy: Math.abs(dy) };
  return { kind: 'points', value: Math.hypot(dx, dy), dx: Math.abs(dx), dy: Math.abs(dy) };
}
