// text.js — the Text tool's model, pure (no DOM): text.test.mjs.
//
// A text as the app edits it: { type: 'TEXT' | 'MTEXT' (what it was read as), x, y (the anchor: the baseline of the first line, at the left,
// centre or right of it by `ha`), h (the capitals' height, in the drawing's units), lines: [string], angle (degrees, anticlockwise),
// ha (0 left, 1 centre, 2 right), font ('Standard' | 'Arial' | 'Mono'), styleName (the file's own style name), bold }.
//
//   decode(entity)               → the model of a TEXT or MTEXT entity (dxf-write.js shape), or null for anything else
//   encode(model, o)             → the entity it saves as: one line without bold is a TEXT, two or more lines or bold an MTEXT (bold as a
//                                  font code); o: { layer, aci, tc, lt, lw } (the entity's common properties)
//   textBox(model, w100, pad)    → { corners: [BL, BR, TR, TL], w, hgt } the box round the text (w100(line): the line's width in a 100 px font)
//   scaleByCorner(model, box, i, p) → { h, x, y }: the text scaled about the corner opposite corner i so that corner follows p
import { entity, text as textEnt } from './dxf-write.js';
import { plainText, fontOfStyle } from './drawing.js';

export { fontOfStyle };
export const FONTS = [{ id: 'Standard', label: 'Standard' }, { id: 'Arial', label: 'Arial-like' }, { id: 'Mono', label: 'Mono' }];
export const ALIGNS = [{ id: 0, name: 'left', label: 'Align left' }, { id: 1, name: 'centre', label: 'Align centre' }, { id: 2, name: 'right', label: 'Align right' }];
export const LH = 5 / 3;                      // the line pitch of several lines, in heights (as drawing.js draws MTEXT)
const CAPS = 0.7;                             // a font's capitals are about this much of its size
const DEG = Math.PI / 180;
/** The font family an MTEXT font code names for each of ours. */
const FAMILY = { Standard: 'Arial', Arial: 'Arial', Mono: 'Courier New' };

const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const first = (r, code) => { const k = r.c.indexOf(code); return k < 0 ? undefined : r.v[k]; };

/** The model of a TEXT or MTEXT entity; null for other types. */
export function decode(e) {
  if (!e || !e.r || (e.type !== 'TEXT' && e.type !== 'MTEXT')) return null;
  const r = e.r, h = num(first(r, 40));
  if (!(h > 0)) return null;
  const styleName = String(first(r, 7) == null ? 'Standard' : first(r, 7)).trim() || 'Standard';
  const base = { type: e.type, h, styleName, font: fontOfStyle(styleName), bold: false };
  if (e.type === 'TEXT') {
    const ha = Math.min(2, Math.max(0, parseInt(first(r, 72), 10) || 0)), al = ha !== 0 && first(r, 11) != null;
    return { ...base, x: num(al ? first(r, 11) : first(r, 10)), y: num(al ? first(r, 21) : first(r, 20)), lines: [plainText(first(r, 1) || '', false).join(' ')], angle: num(first(r, 50)), ha };
  }
  let s = '';
  for (let k = 0; k < r.c.length; k++) if (r.c[k] === 3 || r.c[k] === 1) s += r.v[k];
  const ap = Math.min(Math.max(parseInt(first(r, 71), 10) || 1, 1), 9) - 1, ha = ap % 3, row = Math.floor(ap / 3);
  const lines = plainText(s, true), n = lines.length;
  let angle = num(first(r, 50));
  if (first(r, 11) != null && (num(first(r, 11)) || num(first(r, 21)))) angle = Math.atan2(num(first(r, 21)), num(first(r, 11))) / DEG;
  // the insertion point is at the top, middle or bottom of the block: back to the first line's baseline (dy along the text's own up)
  const tall = (n - 1) * LH * h + h, dy = row === 0 ? -h : row === 1 ? tall / 2 - h : (n - 1) * LH * h;
  const c = Math.cos(angle * DEG), sn = Math.sin(angle * DEG);
  return { ...base, x: num(first(r, 10)) - dy * sn, y: num(first(r, 20)) + dy * c, lines, angle, ha, bold: /\\f[^;]*\|b1/.test(s) };
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
/** The entity a model saves as. One line, not bold: TEXT (code 72 and the alignment point for centre / right). Otherwise MTEXT, attached at the top. */
export function encode(m, o = {}) {
  const lines = m.lines.length ? m.lines : [''], style = m.styleName || m.font || 'Standard';
  const c = Math.cos(m.angle * DEG), sn = Math.sin(m.angle * DEG);
  if (lines.length === 1 && !m.bold) {
    const e = textEnt(m.x, m.y, m.h, lines[0], { ...o, rot: m.angle || 0 });
    const r = e.r;
    r.c.push(7); r.v.push(style);
    if (m.ha) { r.c.push(72, 11, 21, 31); r.v.push(String(m.ha), String(m.x), String(m.y), '0'); }
    return e;
  }
  // MTEXT: the top-left of the block is h above the first baseline (turned by the angle)
  const ix = m.x - sn * m.h, iy = m.y + c * m.h;
  let s = lines.map(esc).join('\\P');
  if (m.bold) s = `{\\f${FAMILY[m.font] || 'Arial'}|b1|i0|c0|p34;${s}}`;
  const pairs = [[10, ix], [20, iy], [30, 0], [40, m.h], [71, 1 + m.ha]];
  for (let k = 0; k < s.length - 250; k += 250) pairs.push([3, s.slice(k, k + 250)]);
  pairs.push([1, s.length > 250 ? s.slice(Math.floor((s.length - 1) / 250) * 250) : s], [7, style]);
  if (m.angle) pairs.push([50, m.angle]);
  return entity('MTEXT', pairs, o);
}

/** The box round a text (padded by pad × height), in the drawing's units: corners bottom-left, bottom-right, top-right, top-left. */
export function textBox(m, w100, pad = 0.2) {
  const size = m.h / CAPS, widest = Math.max(0, ...m.lines.map((l) => w100(l) * size / 100)), n = Math.max(1, m.lines.length);
  const left = -widest * m.ha / 2 - pad * m.h, right = left + widest + 2 * pad * m.h;
  const top = m.h + pad * m.h, bottom = -((n - 1) * LH * m.h + 0.25 * m.h) - pad * m.h;
  const c = Math.cos(m.angle * DEG), s = Math.sin(m.angle * DEG), at = (x, y) => [m.x + x * c - y * s, m.y + x * s + y * c];
  return { corners: [at(left, bottom), at(right, bottom), at(right, top), at(left, top)], w: right - left, hgt: top - bottom };
}

/**
 * The text scaled about the corner opposite corner i of its box, so that corner follows p (the pointer): the new height and anchor.
 * The scale is how far p has got along the diagonal; it is kept at 0.05 or more.
 */
export function scaleByCorner(m, box, i, p) {
  const opp = box.corners[(i + 2) % 4], cor = box.corners[i];
  const dx = cor[0] - opp[0], dy = cor[1] - opp[1], len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return { h: m.h, x: m.x, y: m.y };
  const k = Math.max(0.05, ((p[0] - opp[0]) * dx + (p[1] - opp[1]) * dy) / len2);
  return { h: m.h * k, x: opp[0] + (m.x - opp[0]) * k, y: opp[1] + (m.y - opp[1]) * k };
}

/** The text of the editor box → its lines: trailing empty lines go; null when nothing is left. */
export function linesOf(value) {
  const lines = String(value).replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.length && lines.some((l) => l.trim()) ? lines : null;
}

/** "TEXT" or "MTEXT", for the tag above a selected text. */
export const kindOf = (m) => (m.lines.length > 1 || m.bold ? 'MTEXT' : 'TEXT');
