// leader.js — leaders (TODO 28, mock-up R8c), pure (no DOM): leader.test.mjs.
//
// A leader is a note with an arrow: { pts: [tip, (bend,) end] (drawing units), lines: [string] (the note), textH, arrow }. The arrowhead is on the
// tip, pointing at what it points at; the note lands at the end, to the right when the last segment goes right (or straight up or down),
// else to the left. Like a kept dimension it is saved as one block, PD_LDR_n (the lines, a SOLID arrowhead and a TEXT or MTEXT), with one INSERT of
// it on the layer Dimensions, and is read back from the block itself.
//
//   geometry(m)               → { lines: [[x1, y1, x2, y2]], arrows: [triangle], side (1 right, -1 left), text (a text.js model) }
//   build(m, name)            → { name, block, insert } (as edit.js addDimension takes), or null (a note or a segment with nothing in it)
//   read(name, block)         → the model, or null; ofEntity(raw, e) → { name, model } for the INSERT at index e, or null
//   freeName(blocks)          → PD_LDR_1, 2 …
//   replace(raw, name, m)     → { entities, blocks } with that block rebuilt (the INSERT stays)
import { arrowHead, DIM_LAYER, LDR_BLOCK } from './edit.js';
import { line, insert, entity } from './dxf-write.js';
import * as TX from './text.js';

const g = (e, c) => +(e.r.v[e.r.c.indexOf(c)]);
const near0 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;

/** The side the note lands on for these points: 1 right, -1 left (the way the last segment goes; straight up or down: right). */
export const sideOf = (pts) => (pts.length > 1 && pts[pts.length - 1][0] < pts[pts.length - 2][0] - 1e-9 ? -1 : 1);

export function geometry(m) {
  const { pts, textH: th, arrow: ar } = m, n = pts.length;
  if (n < 2 || !(th > 0) || !(ar > 0) || pts.some((p, i) => i && near0(p, pts[i - 1]))) return null;
  const lines = pts.slice(1).map((q, i) => [pts[i][0], pts[i][1], q[0], q[1]]);
  const d = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), a = Math.min(ar, d * 0.5);
  const arrows = [arrowHead(pts[0], (pts[0][0] - pts[1][0]) / d, (pts[0][1] - pts[1][1]) / d, a, a * 0.18)];     // pointing at the tip, from the line
  const side = sideOf(pts), end = pts[n - 1];
  const text = { type: 'TEXT', x: end[0] + side * 0.4 * th, y: end[1] - 0.35 * th, h: th, lines: m.lines || [''], angle: 0, ha: side > 0 ? 0 : 2, font: 'Standard', styleName: 'Standard', bold: false };
  return { lines, arrows, side, text };
}

export function build(m, name) {
  const gm = geometry(m), nonEmpty = m.lines && m.lines.some((l) => l.trim());
  if (!gm || !nonEmpty) return null;
  const o = { layer: '0' }, solid = ([p, q, r]) => entity('SOLID', [[10, p[0]], [20, p[1]], [30, 0], [11, q[0]], [21, q[1]], [31, 0], [12, r[0]], [22, r[1]], [32, 0]], o);
  const ents = [...gm.lines.map((l) => line(...l, o)), ...gm.arrows.map(solid), TX.encode(gm.text, o)];
  return { name, block: { base: [0, 0], xref: false, entities: ents }, insert: insert(name, 0, 0, { layer: DIM_LAYER }) };
}

export function read(name, block) {
  if (!block || !LDR_BLOCK.test(name)) return null;
  const ents = block.entities || [], lines = ents.filter((e) => e.type === 'LINE'), sd = ents.find((e) => e.type === 'SOLID'), tx = ents.map(TX.decode).find(Boolean);
  if (!lines.length || !sd || !tx) return null;
  const pts = [[g(lines[0], 10), g(lines[0], 20)], ...lines.map((l) => [g(l, 11), g(l, 21)])];
  return { pts, lines: tx.lines, textH: tx.h, arrow: Math.hypot((g(sd, 11) + g(sd, 12)) / 2 - g(sd, 10), (g(sd, 21) + g(sd, 22)) / 2 - g(sd, 20)) };
}

export function ofEntity(raw, e) {
  const ent = raw.entities[e];
  if (!ent || ent.type !== 'INSERT') return null;
  const name = String(ent.r.v[ent.r.c.indexOf(2)] || '').trim(), model = read(name, raw.blocks[name]);
  return model ? { name, model } : null;
}

export function freeName(blocks) {
  let n = 1;
  while (blocks['PD_LDR_' + n]) n++;
  return 'PD_LDR_' + n;
}

export function replace(raw, name, m) {
  const b = build(m, name);
  return b ? { entities: raw.entities, blocks: { ...raw.blocks, [name]: b.block } } : null;
}
