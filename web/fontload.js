// fontload.js — the font files Text to outlines reads (TODO 53). In the app: C:\Windows\Fonts, read only, through Tauri's fs (no admin); the file
// the text shows today (textoutline.js fontFiles). Where that cannot be read (a browser, a missing file): the bundled Liberation Sans (SIL OFL).
// opentype.js (web/vendor/opentype, MIT) is loaded when the first font is.
//   loadFont(font, bold) → { font (opentype.js), name (the family), fallback (true: Liberation Sans stood in), wanted (the family asked for) }
import { fontFiles } from './textoutline.js';

// shortcut: Windows is taken to be on C:, the app's drive-letter fs scope allows it; read %WINDIR% through Rust if a PC ever differs
const DIR = 'C:/Windows/Fonts/';
const WANTED = { Standard: 'Segoe UI', Arial: 'Arial', Mono: 'Cascadia Mono / Consolas' };
let ot = null;
const cache = new Map();

async function parse(bytes) {
  ot = ot || (await import('./vendor/opentype/opentype.js')).default;
  const u = new Uint8Array(bytes);
  return ot.parse(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength));
}
const family = (f) => (f.names && f.names.fontFamily && (f.names.fontFamily.en || Object.values(f.names.fontFamily)[0])) || 'font';

async function fromWindows(font, bold) {
  const t = window.__TAURI__;
  if (!t || !t.fs || !t.fs.readFile) return null;
  for (const file of fontFiles(font, bold)) {
    try { const f = await parse(await t.fs.readFile(DIR + file)); return { font: f, name: family(f), fallback: false }; } catch { /* not there: the next one */ }
  }
  return null;
}

export function loadFont(font, bold) {
  const key = font + (bold ? ':b' : '');
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const got = await fromWindows(font, bold);
      if (got) return { ...got, wanted: WANTED[font] || WANTED.Standard };
      const r = await fetch('vendor/fonts/LiberationSans-' + (bold ? 'Bold' : 'Regular') + '.ttf');
      if (!r.ok) throw new Error('no font could be read');
      return { font: await parse(await r.arrayBuffer()), name: 'Liberation Sans', fallback: true, wanted: WANTED[font] || WANTED.Standard };
    })().catch((e) => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}
