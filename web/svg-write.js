// svg-write.js — pure: a pdf-write Page (its cmds, as contentStream() reads them) → an SVG string (TODO 109c1) — svg-write.test.mjs.
//
// The Page is in mm, y up, 0,0 at the bottom-left; SVG is y down, so every y becomes height - y. unit 'in' writes the page in inches
// (width / height in inches, every number divided by 25.4): 1 SVG unit = 1 unit of the export. precision: decimals of coordinates
// (line widths, dashes and the text / picture matrices keep at least 4 so a small number does not round to 0).
import { num, CP1252 } from './pdf-write.js';

const BACK = Object.fromEntries(Object.entries(CP1252).map(([u, w]) => [w, +u]));      // WinAnsi 0x80–0x9F → Unicode
const hex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
/** XML text / attribute escape. */
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A page's WinAnsi text back to Unicode. */
const unicode = (coded) => Array.from(coded, (ch) => { const c = ch.charCodeAt(0); return String.fromCharCode(BACK[c] || c); }).join('');

/** page → the SVG file's text. { unit: 'mm' | 'in', precision: 0–8 }. */
export function pageToSvg(page, { unit = 'mm', precision = 6 } = {}) {
  const k = unit === 'in' ? 1 / 25.4 : 1, H = page.h, q = Math.max(precision, unit === 'in' ? 6 : 4);
  const X = (x) => num(x * k, precision), Y = (y) => num((H - y) * k, precision), Q = (v, d = q) => num(v * k, d);
  const out = [], defs = [];
  let path = [], st = { stroke: '#000000', fill: '#000000', width: 1, dash: '', cap: 'butt', join: 'miter' }, stack = [], closes = [0];
  const CAP = ['butt', 'round', 'square'], JOIN = ['miter', 'round', 'bevel'];
  const d = () => path.join(' ');
  for (const c of page.cmds) {
    switch (c[0]) {
      case 'q': stack.push({ ...st }); closes.push(0); break;
      case 'Q': if (stack.length) { st = stack.pop(); out.push('</g>'.repeat(closes.pop())); } break;
      case 'RG': st.stroke = hex(c.slice(1)); break;
      case 'rg': st.fill = hex(c.slice(1)); break;
      case 'w': st.width = c[1]; break;
      case 'J': st.cap = CAP[c[1]] || 'butt'; break;
      case 'j': st.join = JOIN[c[1]] || 'miter'; break;
      case 'd': st.dash = c[1].map((x) => Q(x)).join(' '); break;
      case 'm': path.push(`M${X(c[1])} ${Y(c[2])}`); break;
      case 'l': path.push(`L${X(c[1])} ${Y(c[2])}`); break;
      case 'c': path.push(`C${X(c[1])} ${Y(c[2])} ${X(c[3])} ${Y(c[4])} ${X(c[5])} ${Y(c[6])}`); break;
      case 'h': path.push('Z'); break;
      case 'S': if (path.length) out.push(`<path d="${d()}" fill="none" stroke="${st.stroke}" stroke-width="${Q(st.width)}"${st.cap !== 'butt' ? ` stroke-linecap="${st.cap}"` : ''}${st.join !== 'miter' ? ` stroke-linejoin="${st.join}"` : ''}${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`); path = []; break;
      case 'f': case 'f*': if (path.length) out.push(`<path d="${d()}" fill="${st.fill}"${c[0] === 'f*' ? ' fill-rule="evenodd"' : ''}/>`); path = []; break;
      case 'W': case 'W*': {
        if (path.length) {
          defs.push(`<clipPath id="c${defs.length}"><path d="${d()}"${c[0] === 'W*' ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
          out.push(`<g clip-path="url(#c${defs.length - 1})">`); closes[closes.length - 1]++;
        }
        path = []; break;
      }
      case 'T': {                                                          // glyph space is one em: the matrix carries the size; its y is flipped, so b and c change sign
        const [a, b, cc, dd, e, f] = c[1], m = [Q(a, 6), Q(-b, 6), Q(-cc, 6), Q(dd, 6), X(e), Y(f)].join(' ');
        out.push(`<text transform="matrix(${m})" fill="${st.fill}" font-family="Helvetica, Arial, sans-serif" font-size="1" xml:space="preserve">${esc(unicode(c[2]))}</text>`);
        break;
      }
      case 'I': {                                                          // the unit square, top row at y = 1 (page, y up) → at y = 0 (SVG, y down)
        const [a, b, cc, dd, e, f] = c[1], px = c[2]?.px;
        if (typeof px === 'string') out.push(`<image width="1" height="1" preserveAspectRatio="none" transform="matrix(${[Q(a, 6), Q(-b, 6), Q(-cc, 6), Q(dd, 6), X(cc + e), Y(dd + f)].join(' ')})" href="${esc(px)}"/>`);
        break;
      }
      default: break;
    }
  }
  const open = closes.reduce((a, n) => a + n, 0);
  if (open) out.push('</g>'.repeat(open));                                    // a Page that never restored: close what it opened
  const w = num(page.w * k, precision), h = num(page.h * k, precision);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}${unit}" height="${h}${unit}" viewBox="0 0 ${w} ${h}" stroke-miterlimit="10">\n` +
    (defs.length ? `<defs>${defs.join('')}</defs>\n` : '') + out.join('\n') + '\n</svg>\n';
}
