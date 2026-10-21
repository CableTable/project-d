// balloons.js — inspection balloons (TODO 29, mock-ups R9a and R9c), pure (no DOM): balloons.test.mjs.
//
// A set is immutable: { items, next, seq }. An item is { id, n, sheet, tip: [x, y], c: [x, y], dim, tp, tm, note } in mm on the
// sheet (y up): the arrow's tip on the feature, the circle's centre c, the number n (the next one goes up by itself), the sheet
// (page) it is on, and the table's typed cells. Items stay in placement order; the table sorts them for showing.
//
//   add(set, { tip, c, sheet }) · update(set, id, patch) · remove(set, id) · setNext(set, n) · renumber(set)
//   geometry(item, r)            → { line, arrow } the leader from the circle's edge and the arrowhead (triangle), or null parts
//   bodyAt / gripAt              → hit tests in mm
//   encode(set, meta) / decode(text)   the <name>.pdballoons.json sidecar, the read JSON checked
//   rows(set, sheet) · csv(rows, { bom }) · nearestText(texts, p, tol) · sidecarName / sidecarPath
import { arrowHead } from './edit.js';
import { LH } from './text.js';

export const KIND = 'project-d-balloons';
export const EMPTY = Object.freeze({ items: Object.freeze([]), next: 1, seq: 1 });
const MAX_ITEMS = 5000, MAX_TEXT = 200, MAX_NO = 999999, MAX_SHEET = 9999;

const pt = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v));
const str = (v) => (typeof v === 'string' ? v.slice(0, MAX_TEXT) : '');
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/** A typed number: a whole number from 1, or null. */
export const parseNo = (text) => (/^\s*\d{1,6}\s*$/.test(String(text)) && +text >= 1 ? +text : null);

/** A balloon at c with its arrow on tip; it takes the next number, and the next goes up by one. */
export function add(set, { tip, c, sheet = 1 }) {
  const it = { id: set.seq, n: set.next, sheet, tip: [tip[0], tip[1]], c: [c[0], c[1]], dim: '', tp: '', tm: '', note: '' };
  return { items: [...set.items, it], next: set.next + 1, seq: set.seq + 1 };
}

/** The item with its fields changed (n, tip, c, dim, tp, tm, note); the set is unchanged when there is no such item. */
export function update(set, id, patch) {
  if (!set.items.some((it) => it.id === id)) return set;
  return { ...set, items: set.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) };
}

/** Without that balloon; the others keep their numbers. Taking away the last one placed gives its number back to the count. */
export function remove(set, id) {
  const it = set.items.find((x) => x.id === id);
  if (!it) return set;
  return { ...set, items: set.items.filter((x) => x.id !== id), next: it.n === set.next - 1 ? it.n : set.next };
}

/** The count carries on from n (a whole number from 1), or null. */
export function setNext(set, n) {
  const v = typeof n === 'number' ? n : parseNo(n);
  return Number.isInteger(v) && v >= 1 && v <= MAX_NO ? { ...set, next: v } : null;
}

/** 1…n in sheet order, then in placement order; the count carries on after the last. */
export function renumber(set) {
  const order = set.items.map((it, i) => [it, i]).sort((a, b) => a[0].sheet - b[0].sheet || a[1] - b[1]);
  const no = new Map(order.map(([it], k) => [it.id, k + 1]));
  return { ...set, items: set.items.map((it) => ({ ...it, n: no.get(it.id) })), next: set.items.length + 1 };
}

/** The table's rows (all sheets, or one): sheet, then number, then placement. */
export function rows(set, sheet = null) {
  return set.items.map((it, i) => [it, i]).filter(([it]) => sheet == null || it.sheet === sheet)
    .sort((a, b) => a[0].sheet - b[0].sheet || a[0].n - b[0].n || a[1] - b[1]).map(([it]) => it);
}

// ---- drawing the balloon: the leader runs from the circle's edge to the tip, the arrowhead on the tip ----
/** { line: [x1, y1, x2, y2] | null, arrow: [tip, p, q] | null } for a circle of radius r (mm). */
export function geometry(it, r) {
  const dx = it.tip[0] - it.c[0], dy = it.tip[1] - it.c[1], d = Math.hypot(dx, dy);
  if (!(d > r * 1.05)) return { line: null, arrow: null };                    // the tip is inside the circle: no leader
  const ux = dx / d, uy = dy / d, a = Math.min(r * 0.8, (d - r) * 0.6);
  return { line: [it.c[0] + ux * r, it.c[1] + uy * r, it.tip[0], it.tip[1]], arrow: arrowHead(it.tip, ux, uy, a, a * 0.3) };
}

const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** 'c' (the circle's centre grip) or 'tip' when p is within tol of that grip, else null. The tip wins when both are near. */
export function gripAt(it, p, tol) {
  if (near(p, it.tip) <= tol) return 'tip';
  return near(p, it.c) <= tol ? 'c' : null;
}
/** Is p on the balloon: in its circle, or within tol of its leader? */
export function bodyAt(it, p, r, tol) {
  if (near(p, it.c) <= r + tol) return true;
  const { line } = geometry(it, r);
  if (!line) return false;
  const [x1, y1, x2, y2] = line, vx = x2 - x1, vy = y2 - y1, t = Math.max(0, Math.min(1, ((p[0] - x1) * vx + (p[1] - y1) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(p[0] - x1 - t * vx, p[1] - y1 - t * vy) <= tol;
}

// ---- the sidecar: <name>.pdballoons.json next to the file (a PDF is never rewritten) ----
/** "scan-0142.pdf" → "scan-0142.pdballoons.json" (a path keeps its folder). */
export const sidecarPath = (path) => String(path).replace(/([^\\/])\.(?:dxf|pdf|png|jpe?g)$/i, '$1') + '.pdballoons.json';
export const sidecarName = (name) => sidecarPath(String(name).split(/[\\/]/).pop());
export const isSidecar = (name) => /\.pdballoons\.json$/i.test(name);

export function encode(set, meta = {}) {
  return JSON.stringify({ kind: KIND, v: 1, source: str(meta.source), pages: meta.pages || 1, next: set.next,
    items: set.items.map(({ n, sheet, tip, c, dim, tp, tm, note }) => ({ n, sheet, tip, c, dim, tp, tm, note })) }, null, 1) + '\n';
}

/** { set, dropped } from a sidecar's text, every field checked (a bad item is dropped, not trusted), or { error }. */
export function decode(text) {
  let o;
  try { o = JSON.parse(text); } catch { return { error: 'not a balloons file (not JSON)' }; }
  if (!o || typeof o !== 'object' || o.kind !== KIND || o.v !== 1 || !Array.isArray(o.items)) return { error: 'not a Project D balloons file' };
  const items = [];
  let dropped = 0;
  for (const x of o.items.slice(0, MAX_ITEMS)) {
    const n = x && int(x.n, 0, MAX_NO), sheet = x && int(x.sheet, 1, MAX_SHEET);
    if (!x || n == null || sheet == null || !pt(x.tip) || !pt(x.c)) { dropped++; continue; }
    items.push({ id: items.length + 1, n, sheet, tip: [x.tip[0], x.tip[1]], c: [x.c[0], x.c[1]], dim: str(x.dim), tp: str(x.tp), tm: str(x.tm), note: str(x.note) });
  }
  dropped += Math.max(0, o.items.length - MAX_ITEMS);
  const top = items.reduce((m, it) => Math.max(m, it.n), 0), next = int(o.next, 1, MAX_NO) || top + 1;
  return { set: { items, next, seq: items.length + 1 }, dropped };
}

// ---- the table as CSV (also what Excel is given) ----
const HEAD = ['No.', 'Dimension', 'Tol +', 'Tol -', 'Sheet', 'Note'];
// a cell that starts with = or @ would be a formula in Excel: it gets a ' in front
const cell = (v) => { let s = String(v); if (/^[=@]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
/** CSV text for these rows. bom: a UTF-8 byte order mark, so Excel reads Ø and ± right. */
export function csv(list, { bom = false } = {}) {
  const lines = [HEAD, ...list.map((it) => [it.n, it.dim, it.tp, it.tm, it.sheet, it.note])].map((r) => r.map(cell).join(','));
  return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}

// ---- Pick from text: the text under the arrow ----
/**
 * The nearest text (models as text.js decodes them: x, y, h, lines, angle, ha) to p, within tol of its box, or null: { str, dist }.
 * The box is the text's height tall and about 0.75 heights a character wide, turned with the text.
 * shortcut: the width is a guess from the character count, not the font's real advance; upgrade when a pick lands on the wrong neighbour.
 */
export function nearestText(texts, p, tol) {
  let best = null;
  for (const t of texts) {
    const w = Math.max(...t.lines.map((l) => l.length)) * 0.75 * t.h, a = (t.angle || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const dx = p[0] - t.x, dy = p[1] - t.y, u = dx * c + dy * s, v = -dx * s + dy * c;          // p in the text's own frame
    const x0 = -(t.ha || 0) * w / 2, ex = Math.max(x0 - u, u - (x0 + w), 0), ey = Math.max(-(0.2 + (t.lines.length - 1) * LH) * t.h - v, v - t.h, 0);   // later lines hang below the first baseline
    const dist = Math.hypot(ex, ey);
    if (dist <= tol && (!best || dist < best.dist)) best = { str: t.lines.join(' '), dist };
  }
  return best;
}
