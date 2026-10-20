// textoutline.js — Text to outlines (TODO 53), pure (no DOM, no font loading): textoutline.test.mjs.
//
// A text item of the flattened drawing (drawing.js: k 't') + a font (anything with opentype.js's getPath / getAdvanceWidth) becomes closed
// polylines at the place, height, angle, width factor and alignment render.js draws it with. Letters with holes give one polyline per
// contour (outer and holes); a cutter or an even-odd fill reads them as the letter.
//
//   fontFiles(font, bold)             → the file names to try in C:\Windows\Fonts, best first (font: 'Standard' | 'Arial' | 'Mono')
//   flattenCommands(cmds, tol)        → [[ [x, y] … ]] the closed contours of an opentype.js path, curves cut into pieces within tol
//   lineLayout(it, width)             → [{ text, x, y }] each line's start and baseline in the text's own frame (y up), drawing units
//   textPolys(it, font, tol)          → [[ [x, y] … ]] the outlines in drawing units, absolute
//   outlineEntities(items, raw, fontOf, tol) → { ents, texts, done } LWPOLYLINEs on the text's layer / colour / line style
import { CAP } from './drawing.js';
import { lwpoly } from './dxf-write.js';

/** Windows font files for each of the app's three fonts (render.js's FONT_FAMILY: Segoe UI, Arial, Cascadia Mono / Consolas), regular then bold. */
const FILES = {
  Standard: [['segoeui.ttf'], ['segoeuib.ttf']],
  Arial: [['arial.ttf'], ['arialbd.ttf']],
  Mono: [['CascadiaMono.ttf', 'consola.ttf', 'cour.ttf'], ['CascadiaMonoBold.ttf', 'consolab.ttf', 'courbd.ttf']],
};
export const fontFiles = (font, bold) => (FILES[font] || FILES.Standard)[bold ? 1 : 0];

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

/** The outlines of one text item in drawing units: font.getPath(text, x, y, size) is y-down, so y is turned; then mirrored, widened, turned, moved. */
export function textPolys(it, font, tol) {
  const size = it.h / CAP, c = Math.cos(it.rot), s = Math.sin(it.rot), sx = it.wf * it.mx, sy = it.my;
  const polys = [];
  for (const l of lineLayout(it, (t) => font.getAdvanceWidth(t, size))) {
    if (!l.text.trim()) continue;
    for (const poly of flattenCommands(font.getPath(l.text, 0, 0, size).commands, tol)) {
      polys.push(poly.map(([gx, gy]) => {
        const X = sx * (l.x + gx), Y = sy * (l.y - gy);
        return [r5(it.x + X * c - Y * s), r5(it.y + X * s + Y * c)];
      }));
    }
  }
  return polys;
}

/**
 * The outline entities for text items: items are flatten()'s k 't' items, raw the drawing's entities (the item's `e` indexes it; only a
 * TEXT or MTEXT at the top level counts), fontOf(it) → the font object, tol in drawing units. → { ents, texts (made into outlines),
 * done (the entity indexes) }
 */
export function outlineEntities(items, raw, fontOf, tol) {
  const ents = [], done = new Set();
  for (const it of items) {
    const e = raw[it.e];
    if (it.k !== 't' || !e || (e.type !== 'TEXT' && e.type !== 'MTEXT')) continue;
    const polys = textPolys(it, fontOf(it), tol);
    if (polys.length) done.add(it.e);                      // a blank text has no outlines: it stays
    for (const p of polys) ents.push(lwpoly(p, { closed: true, layer: e.layer, lt: e.lt, aci: e.aci, tc: e.tc, lw: e.lw, lts: e.lts, hidden: e.hidden, ps: e.ps }));
  }
  return { ents, texts: done.size, done };
}
