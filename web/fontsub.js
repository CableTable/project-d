// Shared font choices for drawing display, Text to outlines and the note on open; pure.
const FILES = {
  Standard: [['segoeui.ttf'], ['segoeuib.ttf']],
  Arial: [['arial.ttf'], ['arialbd.ttf']],
  Mono: [['CascadiaMono.ttf', 'consola.ttf', 'cour.ttf'], ['CascadiaMonoBold.ttf', 'consolab.ttf', 'courbd.ttf']],
};
export const fontFiles = (font, bold) => (FILES[font] || FILES.Standard)[bold ? 1 : 0];

/** Which of the app's three fonts a style without a font file stands for. */
export function fontOfStyle(name) {
  const n = String(name == null ? '' : name);
  return /mono|cour|consol|romanm/i.test(n) ? 'Mono' : /arial|helv|sans|calibri|verdana|tahoma/i.test(n) ? 'Arial' : 'Standard';
}

function styleFile(styles, name = 'Standard') {
  const key = Object.keys(styles || {}).find((n) => n.toLowerCase() === name.toLowerCase());
  const s = key && styles[key];
  return s ? (s.v[s.c.indexOf(3)] || '').trim() : '';
}
const fileFont = (file) => Object.keys(FILES).find((font) => FILES[font].flat().some((f) => f.toLowerCase() === file.split(/[\\/]/).pop().toLowerCase()));

/** Only the app's supported TTF faces can be used; SHX and other files use Arial. */
export function fontForStyle(styles, name) {
  const file = styleFile(styles, name);
  return file ? fileFont(file) || 'Arial' : fontOfStyle(name);
}

/** Used text items (including flattened block text) -> each unavailable font once, in file order. */
export function fontSubstitutions(styles, items) {
  const seen = new Set(), result = [];
  for (const it of items) {
    if (it.k !== 't') continue;
    const asked = styleFile(styles, it.st);
    if (!asked || fileFont(asked) || seen.has(asked.toLowerCase())) continue;
    seen.add(asked.toLowerCase());
    result.push({ asked, shown: 'Arial' });
  }
  return result;
}
