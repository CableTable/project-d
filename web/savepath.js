// savepath.js — a path from the Save dialog with its extension: the dialog only asked about replacing the name it was given,
// so when the extension is added afterwards ("x" → "x.pdf") and that file exists, ask here. savepath.test.mjs
//
//   withExt(t, path, ext) → the path, or null when the person says no (t: window.__TAURI__)

/** Suggest the source folder; a name alone lets the native dialog keep its last-used folder, as Save As does. */
export function saveDefault(name, sourcePath) {
  return sourcePath ? sourcePath.replace(/[^\\/]*$/, () => name) : name;
}

/** `path` ending in .ext. Added the ending and the file is there already: ask before it is replaced. */
export async function withExt(t, path, ext) {
  path = String(path);
  if (path.toLowerCase().endsWith('.' + ext.toLowerCase())) return path;
  path += '.' + ext;
  let there = false;
  try { there = !!(t.fs && t.fs.exists && await t.fs.exists(path)); } catch { /* cannot tell: write as before */ }
  if (!there) return path;
  const name = path.split(/[\\/]/).pop();
  if (!(t.dialog && t.dialog.ask)) return null;                    // no way to ask: do not replace it
  let yes = false;
  try { yes = await t.dialog.ask(`${name} already exists. Replace it?`, { title: 'Project D', kind: 'warning', okLabel: 'Replace', cancelLabel: 'Cancel' }); } catch { /* no */ }
  return yes ? path : null;
}
