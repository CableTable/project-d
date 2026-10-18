// pdf-write.js — pure: our own PDF 1.4 writer (no dependencies, no DOM) — pdf-write.test.mjs.
//
// A Page is a list of drawing commands in millimetres, y up, 0,0 at the page's bottom-left. They are the PDF's own
// operators (m l c h S f f* W q Q RG rg w d and one text command), so the same list is written as the page's content
// stream (writePdf) and replayed on a canvas for the dialog's preview (export.js). Text is the standard Helvetica
// (WinAnsi), so nothing is embedded. Nothing in the file depends on the time: the same input is the same bytes.

/** Points in one millimetre: the page size is written as mm × this, so 1000 mm is 2834.646 pt. */
export const MM = 72 / 25.4;

/** A number for a content stream: rounded, never NaN or an exponent. */
export function num(n, d = 4) {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) > 1e9) n = Math.sign(n) * 1e9;
  const k = 10 ** d;
  return String((Math.round(n * k) / k) || 0);
}

// ---------------------------------------------------------------- text: Helvetica, WinAnsi

// Helvetica's advance widths (1/1000 em) for the characters 32–126
const W32 = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

// Windows-1252's 0x80–0x9F, by Unicode
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x2c6: 0x88, 0x2030: 0x89,
  0x160: 0x8a, 0x2039: 0x8b, 0x152: 0x8c, 0x17d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96,
  0x2014: 0x97, 0x2dc: 0x98, 0x2122: 0x99, 0x161: 0x9a, 0x203a: 0x9b, 0x153: 0x9c, 0x17e: 0x9e, 0x178: 0x9f };
// what the font does not have, said another way
const SAY = { 0x2300: 'Ø', 0x2205: 'Ø', 0x3a9: 'Ohm', 0x2126: 'Ohm', 0x3bc: 'µ', 0x2264: '<=', 0x2265: '>=', 0x2032: "'", 0x2033: '"', 0x2212: '-',
  0x2010: '-', 0x2011: '-', 0x2012: '-', 0x2015: '-', 0x2192: '->', 0x2190: '<-', 0x2248: '~', 0x2260: '!=', 0x394: 'Delta', 0x3c0: 'pi', 0xa0: ' ' };

/** Unicode text → a string of WinAnsi codes (each char 0–255); what the font lacks is said another way or becomes "?". */
export function winAnsi(text) {
  let out = '';
  for (const ch of String(text == null ? '' : text)) {
    const cp = ch.codePointAt(0);
    if (cp === 9) out += ' ';
    else if (cp < 32 || cp === 127) out += ' ';
    else if (cp < 127 || (cp >= 0xa1 && cp <= 0xff)) out += ch;
    else if (CP1252[cp]) out += String.fromCharCode(CP1252[cp]);
    else if (SAY[cp]) out += winAnsi(SAY[cp]);
    else if (cp >= 0x300 && cp <= 0x36f) continue;                         // a combining accent on its own: drop it
    else {
      const base = ch.normalize('NFD')[0];                                 // "ā" → "a"
      out += base && base !== ch && base.codePointAt(0) < 256 ? base : '?';
    }
  }
  return out;
}

/** The width of WinAnsi text in ems (multiply by the font size). */
export function textWidthEm(coded) {
  let w = 0;
  for (let i = 0; i < coded.length; i++) {
    const c = coded.charCodeAt(i);
    w += c >= 32 && c <= 126 ? W32[c - 32] : 556;
  }
  return w / 1000;
}

/** WinAnsi text as a PDF string literal: ( ) \ escaped, every other non-printing byte as \ddd, so the file stays ASCII. */
export function pdfString(coded) {
  let s = '(';
  for (let i = 0; i < coded.length; i++) {
    const c = coded.charCodeAt(i), ch = coded[i];
    if (ch === '(' || ch === ')' || ch === '\\') s += '\\' + ch;
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += ch;
  }
  return s + ')';
}

// ---------------------------------------------------------------- a page

export class Page {
  /** w, h in mm. */
  constructor(w, h) {
    this.w = w; this.h = h; this.cmds = [];
    this.st = { stroke: '', fill: '', width: NaN, dash: '' };
    this.stack = [];
  }
  save() { this.cmds.push(['q']); this.stack.push({ ...this.st }); }
  restore() { this.cmds.push(['Q']); if (this.stack.length) this.st = this.stack.pop(); }
  /** [r, g, b] 0–1. */
  strokeColor(c) { const k = c.join(); if (this.st.stroke !== k) { this.cmds.push(['RG', ...c]); this.st.stroke = k; } }
  fillColor(c) { const k = c.join(); if (this.st.fill !== k) { this.cmds.push(['rg', ...c]); this.st.fill = k; } }
  /** mm. */
  lineWidth(w) { if (this.st.width !== w) { this.cmds.push(['w', w]); this.st.width = w; } }
  /** A dash list in mm (on, off, …); empty or all zero = solid. */
  dash(list) {
    const a = (list || []).filter((x) => Number.isFinite(x) && x >= 0);
    const k = a.some((x) => x > 0) ? a.join() : '';
    if (this.st.dash !== k) { this.cmds.push(['d', k ? a : []]); this.st.dash = k; }
  }
  moveTo(x, y) { this.cmds.push(['m', x, y]); }
  lineTo(x, y) { this.cmds.push(['l', x, y]); }
  curveTo(x1, y1, x2, y2, x, y) { this.cmds.push(['c', x1, y1, x2, y2, x, y]); }
  close() { this.cmds.push(['h']); }
  /** An axis-aligned rectangle as a path. */
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.close(); }
  stroke() { this.cmds.push(['S']); }
  fill(evenOdd = false) { this.cmds.push([evenOdd ? 'f*' : 'f']); }
  /** The path just built becomes the clip, until restore(). */
  clip(evenOdd = false) { this.cmds.push([evenOdd ? 'W*' : 'W']); }
  /** WinAnsi text (see winAnsi) with a text matrix [a b c d e f]: glyph space is one em, so it carries the size. */
  text(tm, coded) { if (coded) this.cmds.push(['T', tm, coded]); }
}

/** A page's content stream. */
export function contentStream(page) {
  const n = num;
  const out = [`${num(MM, 6)} 0 0 ${num(MM, 6)} 0 0 cm`, '1 J 1 j'];
  for (const c of page.cmds) {
    switch (c[0]) {
      case 'q': case 'Q': case 'h': case 'S': case 'f': case 'f*': out.push(c[0]); break;
      case 'W': case 'W*': out.push(c[0] + ' n'); break;
      case 'RG': case 'rg': out.push(`${n(c[1], 3)} ${n(c[2], 3)} ${n(c[3], 3)} ${c[0]}`); break;
      case 'w': out.push(`${n(c[1], 4)} w`); break;
      case 'd': out.push(`[${c[1].map((x) => n(x, 4)).join(' ')}] 0 d`); break;
      case 'm': case 'l': out.push(`${n(c[1], 3)} ${n(c[2], 3)} ${c[0]}`); break;
      case 'c': out.push(`${c.slice(1).map((x) => n(x, 3)).join(' ')} c`); break;
      case 'T': out.push(`BT /F1 1 Tf ${c[1].map((x, i) => n(x, i < 4 ? 6 : 3)).join(' ')} Tm ${pdfString(c[2])} Tj ET`); break;
      default: break;
    }
  }
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------- the file

/**
 * pages: [Page]. meta: { title }. Returns the file's bytes (Uint8Array). Objects: 1 catalog, 2 page tree, 3 font, 4 info,
 * then a page and its content for each page.
 */
export function writePdf(pages, meta = {}) {
  const objs = [];
  const kids = pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push(`<< /Title ${pdfString(winAnsi(meta.title || 'Project D'))} /Producer ${pdfString('Project D')} >>`);
  pages.forEach((p, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.w * MM, 3)} ${num(p.h * MM, 3)}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${6 + 2 * i} 0 R >>`);
    const body = contentStream(p);
    objs.push(`<< /Length ${body.length} >>\nstream\n${body}endstream`);
  });
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const at = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const a of at) out += `${String(a).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return bytes;
}
