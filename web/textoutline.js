// textoutline.js — Text to outlines (TODO 53), pure (no DOM, no font loading): textoutline.test.mjs.
//
// A text item of the flattened drawing (drawing.js: k 't') + an opentype.js font becomes closed
// polylines at the place, height, angle, width factor and alignment render.js draws it with. Letters with holes give one polyline per
// contour (outer and holes); a cutter or an even-odd fill reads them as the letter.
//
//   fontFiles(font, bold)             → the file names to try in C:\Windows\Fonts, best first (font: 'Standard' | 'Arial' | 'Mono')
//   flattenCommands(cmds, tol)        → [[ [x, y] … ]] the closed contours of an opentype.js path, curves cut into pieces within tol
//   lineLayout(it, width)             → [{ text, x, y }] each line's start and baseline in the text's own frame (y up), drawing units
//   textPolys(it, font, tol)          → [[ [x, y] … ]] the outlines in drawing units, absolute
//   parseMtext(source, h)            → { runs, notes } scoped inline formatting, with paragraph breaks in the run text
//   outlineItem(it, entity)          → the item with its original MTEXT runs and wrap width
//   mtextLayout(it, fontOf)          → lines of positioned runs, in the text's own frame (y up)
//   outlineEntities(items, raw, fontOf, tol) → { ents, texts, done, missing, notes } LWPOLYLINEs on the text's layer / colour / line style
import { CAP, plainText } from './drawing.js';
import { lwpoly } from './dxf-write.js';

/** Windows font files for each of the app's three fonts (render.js's FONT_FAMILY: Segoe UI, Arial, Cascadia Mono / Consolas), regular then bold. */
const FILES = {
  Standard: [['segoeui.ttf'], ['segoeuib.ttf']],
  Arial: [['arial.ttf'], ['arialbd.ttf']],
  Mono: [['CascadiaMono.ttf', 'consola.ttf', 'cour.ttf'], ['CascadiaMonoBold.ttf', 'consolab.ttf', 'courbd.ttf']],
};
export const fontFiles = (font, bold) => (FILES[font] || FILES.Standard)[bold ? 1 : 0];

/** Missing characters with Unicode labels, capped for the result message. */
export function missingGlyphsLabel(chars) {
  const labels = chars.slice(0, 10).map((ch) => `${ch} (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`);
  if (chars.length > 10) labels.push(`+${chars.length - 10} more`);
  return labels.join(', ');
}

const sameRun = (a, b) => a.h === b.h && a.wf === b.wf && a.oblique === b.oblique && a.bold === b.bold;
const addRun = (runs, run) => {
  const last = runs[runs.length - 1];
  if (last && sameRun(last, run)) last.text += run.text;
  else runs.push({ ...run });
};

/** MTEXT formatting into scoped runs; unsupported formatting is consumed, never outlined as letters. */
export function parseMtext(source, h) {
  const s = String(source).replace(/\r\n?/g, '\n').replace(/%%(?:[a-z%]|\d{3})/gi, (m) => plainText(m, false)[0]);
  const runs = [], notes = new Set(), stack = [];
  let style = { h, wf: 1, oblique: 0, bold: false };
  const put = (text) => { if (text) addRun(runs, { ...style, text }); };
  for (let i = 0; i < s.length;) {
    const ch = s[i++];
    if (ch === '{') { stack.push({ ...style }); continue; }
    if (ch === '}') { if (stack.length) style = stack.pop(); continue; }
    if (ch !== '\\') { put(ch); continue; }
    const code = s[i++];
    if (code === undefined) break;
    if ('\\{}'.includes(code)) { put(code); continue; }
    if (code === 'P' || code === 'N') { put('\n'); continue; }
    if (code === '~') { put('\u00a0'); continue; }
    if (code === 'U' && /^\+[\da-f]{4}/i.test(s.slice(i))) { put(String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16))); i += 5; continue; }
    if ('LlOo'.includes(code)) { notes.add('Underline / overline skipped'); continue; }
    if ('KkX'.includes(code)) continue;
    const param = /^[^\\{};\n]*;/.exec(s.slice(i));
    const value = param ? param[0].slice(0, -1) : '';
    if (param) i += param[0].length;
    if (code === 'A' || code === 'p') continue;
    const n = Number(value.replace(/x$/i, ''));
    if (code === 'H' && n > 0 && Number.isFinite(n)) {
      const next = /x$/i.test(value) ? style.h * n : n;
      if (Number.isFinite(next)) style = { ...style, h: next };
    } else if (code === 'W' && n > 0 && Number.isFinite(n)) style = { ...style, wf: n };
    else if (code === 'Q' && Number.isFinite(n) && Math.abs(n) < 90) style = { ...style, oblique: n };
    else if (code === 'f' || code === 'F') style = { ...style, bold: /\|b1(?:\||$)/i.test(value) };
    else if (code === 'C' || code === 'c') notes.add('Inline colours ignored');
    else if (code === 'S') { put(value.replace(/ *[\^/#] */g, '/').replace(/ /g, '\u00a0')); notes.add('Stacked fractions drawn as a/b'); }
    else notes.add('Unknown MTEXT codes stripped');
  }
  return { runs, notes: [...notes] };
}

/** Recover the original MTEXT codes and box width, before the display's plain-text approximation. */
export function outlineItem(it, e) {
  if (e.type !== 'MTEXT') return it;
  const { c, v } = e.r;
  const source = c.flatMap((code, i) => code === 1 || code === 3 ? [v[i]] : []).join('');
  const wrap = Number(v[c.indexOf(41)]);
  return { ...it, ...parseMtext(source, it.h), wrap: Number.isFinite(wrap) ? wrap : 0 };
}

/** Word wrap across run boundaries; NBSP keeps a word together, and explicit breaks keep empty lines. */
export function mtextLayout(it, fontOf) {
  const tokens = [], lines = [];
  const measure = (runs) => runs.reduce((sum, r) => sum + fontOf({ ...it, ...r }).getAdvanceWidth(r.text, r.h / CAP) * r.wf, 0);
  for (const run of it.runs) for (const text of run.text.match(/\n|[ \t]+|[^ \t\n]+/g) || []) {
    const kind = text === '\n' ? 'break' : /^[ \t]/.test(text) ? 'space' : 'word', last = tokens[tokens.length - 1];
    if (kind !== 'break' && last && last.kind === kind) addRun(last.runs, { ...run, text });
    else tokens.push({ kind, runs: [{ ...run, text }] });
  }
  let runs = [], spaces = [], width = 0;
  const end = () => { lines.push({ runs, width, h: runs.length ? Math.max(...runs.map((r) => r.h)) : it.h }); runs = []; spaces = []; width = 0; };
  for (const token of tokens) {
    if (token.kind === 'break') { end(); continue; }
    if (token.kind === 'space') { spaces.push(...token.runs); continue; }
    const w = measure(token.runs), gap = measure(spaces);
    // shortcut: words wider than the box stay whole, add character wrapping if such files need it.
    if (runs.length && it.wrap > 0 && width + gap + w > it.wrap) end();
    else { for (const r of spaces) addRun(runs, r); width += gap; }
    for (const r of token.runs) addRun(runs, r);
    width += w; spaces = [];
  }
  end();
  const above = Math.max(...lines.map((l, i) => l.h - i * it.lh)), total = above + (lines.length - 1) * it.lh;
  const top = it.va === 'middle' ? total / 2 : it.va === 'bottom' ? total : 0;
  return lines.map((line, i) => {
    let x = -line.width * it.ha / 2;
    const placed = line.runs.map((r) => { const out = { ...r, x }; x += measure([r]); return out; });
    return { ...line, runs: placed, y: top - above - i * it.lh };
  });
}

const MAX_PIECES = 64;
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const area2 = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);

/** Pieces for a Bézier within tol: the second differences bound its curvature (quadratic |P0−2P1+P2|/4n², cubic 0.75·max/n²). */
const pieces = (m, tol, k) => Math.min(MAX_PIECES, Math.max(1, Math.ceil(Math.sqrt(k * m / tol))));

/** The closed contours of an opentype.js path's commands (M L Q C Z), curves flattened to within tol; each contour without its repeated first point. */
export function flattenCommands(cmds, tol) {
  const out = [];
  let cur = null, p = [0, 0];
  const end = () => {
    if (cur && cur.length > 1 && cur[0][0] === cur[cur.length - 1][0] && cur[0][1] === cur[cur.length - 1][1]) cur.pop();
    if (cur && cur.length >= 3 && Math.abs(area2(cur)) > 1e-12) out.push(cur);
    cur = null;
  };
  for (const c of cmds) {
    if (c.type === 'M') { end(); cur = [[c.x, c.y]]; p = [c.x, c.y]; }
    else if (!cur) continue;
    else if (c.type === 'L') { cur.push([c.x, c.y]); p = [c.x, c.y]; }
    else if (c.type === 'Q') {
      const n = pieces(Math.hypot(p[0] - 2 * c.x1 + c.x, p[1] - 2 * c.y1 + c.y), tol, 0.25);
      for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; cur.push([u * u * p[0] + 2 * u * t * c.x1 + t * t * c.x, u * u * p[1] + 2 * u * t * c.y1 + t * t * c.y]); }
      p = [c.x, c.y];
    } else if (c.type === 'C') {
      const m = Math.max(Math.hypot(p[0] - 2 * c.x1 + c.x2, p[1] - 2 * c.y1 + c.y2), Math.hypot(c.x1 - 2 * c.x2 + c.x, c.y1 - 2 * c.y2 + c.y)), n = pieces(m, tol, 0.75);
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
        cur.push([a * p[0] + b * c.x1 + d * c.x2 + e * c.x, a * p[1] + b * c.y1 + d * c.y2 + e * c.y]);
      }
      p = [c.x, c.y];
    } else if (c.type === 'Z') end();
  }
  end();
  return out;
}

/**
 * Where each line of the item starts (x, from the item's anchor along its own direction) and its baseline (y, up), in drawing units, as
 * render.js's drawText puts them: width(text) is a line's advance width at the item's font size (h / CAP). A multi-line MTEXT with a wrap width
 * breaks at spaces, as the screen does.
 */
export function lineLayout(it, width) {
  const h = it.h;
  let lines = it.lines;
  if (it.multi && it.wrap > 0) {
    const max = it.wrap / it.wf * 1.02, out = [];
    for (const line of it.lines) {
      let now = '';
      for (const word of line.split(' ')) {
        const next = now ? now + ' ' + word : word;
        if (now && width(next) > max) { out.push(now); now = word; } else now = next;
      }
      out.push(now);
    }
    lines = out;
  }
  const at = (text, down) => ({ text, x: -width(text) * it.ha / 2, y: -down });      // the canvas is y-down, the drawing y-up
  if (it.multi) {
    const lh = it.lh, total = (lines.length - 1) * lh + h, top = it.va === 'top' ? 0 : it.va === 'middle' ? -total / 2 : -total;
    return lines.map((l, i) => at(l, top + h + i * lh));
  }
  const down = { alphabetic: 0, bottom: -0.3 * h, middle: h / 2, top: h }[it.va] || 0;
  return [at(lines.join(' '), down)];
}

/** Glyph paths (including components) are y-down: turn y, then mirror, widen, rotate and move. Missing glyphs keep their advance only. */
export function textPolys(it, font, tol, missing = new Set()) {
  if (font.charToGlyphIndex('⌀') === 0) it = { ...it, lines: it.lines.map((line) => line.replace(/⌀/g, 'Ø')) };
  const size = it.h / CAP, c = Math.cos(it.rot), s = Math.sin(it.rot), sx = it.wf * it.mx, sy = it.my;
  const shear = Math.tan((it.oblique || 0) * Math.PI / 180);
  const polys = [];
  for (const l of lineLayout(it, (t) => font.getAdvanceWidth(t, size))) {
    for (const ch of l.text) if (!font.charToGlyphIndex(ch)) missing.add(ch);
    // Keep opentype's shaping, kerning and advances; index 0 is the .notdef box, never a cut path.
    font.forEachGlyph(l.text, 0, 0, size, {}, (glyph, x, y, fontSize, options) => {
      if (!glyph.index) return;
      for (const poly of flattenCommands(glyph.getPath(x, y, fontSize, options, font).commands, tol)) {
        polys.push(poly.map(([gx, gy]) => {
          const X = sx * (l.x + gx - shear * gy), Y = sy * (l.y - gy);
          return [r5(it.x + X * c - Y * s), r5(it.y + X * s + Y * c)];
        }));
      }
    });
  }
  return polys;
}

/**
 * The outline entities for text items: items are flatten()'s k 't' items, raw the drawing's entities (the item's `e` indexes it; only a
 * TEXT or MTEXT at the top level counts), fontOf(it) → the font object, tol in drawing units. → { ents, texts (made into outlines),
 * done (the entity indexes), missing (unique characters absent from their font) }
 */
export function outlineEntities(items, raw, fontOf, tol) {
  const ents = [], done = new Set(), missing = new Set(), notes = new Set();
  for (const item of items) {
    const it = item.runs ? item : outlineItem(item, raw[item.e] || {});
    const e = raw[it.e];
    if (it.k !== 't' || !e || (e.type !== 'TEXT' && e.type !== 'MTEXT')) continue;
    for (const note of it.notes || []) notes.add(note);
    const c = Math.cos(it.rot), s = Math.sin(it.rot);
    const runs = e.type === 'MTEXT' ? mtextLayout(it, fontOf).flatMap((l) => l.runs.map((r) => ({ ...it, ...r, multi: false, ha: 0, va: 'alphabetic', lines: [r.text],
      x: it.x + r.x * c - l.y * s, y: it.y + r.x * s + l.y * c }))) : [it];
    const polys = runs.flatMap((r) => textPolys(r, fontOf(r), tol, missing));
    if (polys.length) done.add(it.e);                      // a blank text has no outlines: it stays
    for (const p of polys) ents.push(lwpoly(p, { closed: true, layer: e.layer, lt: e.lt, aci: e.aci, tc: e.tc, lw: e.lw, lts: e.lts, hidden: e.hidden, ps: e.ps }));
  }
  return { ents, texts: done.size, done, missing: [...missing], notes: [...notes] };
}
