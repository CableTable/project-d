// batch-folder.js — "A folder at once", shared by Save as PDF and Export…: the settings object, the folder picker + .dxf / .dwg / .cdr ticks +
// Subfolders too + file list, Save to, and a name that never replaces a file. File names go in through h() / textContent only.
import { h, fill } from './dom.js';
import { freeName } from './pdf-export.js';

export const joinPath = (dir, name) => String(dir).replace(/[\\/]+$/, '') + (String(dir).includes('\\') ? '\\' : '/') + name;
const errText = (e) => (e && e.message ? e.message : String(e));
const TYPES = { dxf: 'DXF', dwg: 'DWG', cdr: 'CorelDRAW' };

/** One dialog's batch settings: the folder, the ticks, Save to (same | choose, with the folder once picked) and the scanned files (`all`). */
export const newBatch = () => ({ folder: '', dxf: true, dwg: true, cdr: true, sub: false, saveTo: 'same', saveDir: null, all: [] });

/** Where a batch writes: null = next to each file, a folder (asked once, kept in B.saveDir), false = the folder picker was cancelled. */
export async function batchOutDir(B, t, inApp) {
  if (B.saveTo !== 'choose' || !inApp) return null;
  if (!B.saveDir) {
    const picked = await t.dialog.open({ directory: true, multiple: false });
    const d = Array.isArray(picked) ? picked[0] : picked;
    if (!d) return false;
    B.saveDir = String(d);
  }
  return B.saveDir;
}

/** The path of a new file `<base>.<ext>` in `dir` (null: a bare name, the browser's download): not a name used in this run (`used`, case-insensitive), not one already on disk (`exists(path)`). Adds it to `used`. */
export async function outPath(dir, base, ext, used, exists) {
  const at = (nm) => (dir == null ? nm : joinPath(dir, nm));
  const want = at(await freeName(base, async (nm) => used.has(at(nm).toLowerCase()) || await exists(at(nm)), ext));
  used.add(want.toLowerCase());
  return want;
}

/**
 * The picker: { B (newBatch + anything), t (__TAURI__), inApp, note(text), prefix (test ids), empty (text when no file is listed),
 * unsupported(type) → why a .dxf / .dwg / .cdr cannot be done ('' = it can; the entry is then listed but not tickable),
 * onChange() (after a scan; redraws the dialog, the list included), onTick() (an extension or Subfolders tick; default: redraw the list) }
 * Entries: { name, rel, type, na, include, status: { kind, text, pct }, path + dir (in the app) | file (the browser) }.
 * → { folderRow, extRow, list, saveTo, renderList, scanFolder }
 */
export function batchFolder({ B, t, inApp, note, prefix, empty, unsupported, onChange, onTick }) {
  const id = (s) => prefix + '-' + s;
  const entryOf = (name, rel, extra) => {
    const type = (name.match(/\.(dxf|dwg|cdr)$/i) || [])[1].toLowerCase(), why = unsupported(type);
    return { name, rel, type, na: !!why, include: !why, status: why ? { kind: 'na', text: why } : { kind: 'waiting', text: 'Waiting' }, ...extra };
  };
  const folder = h('input', { class: 'fld', value: B.folder, placeholder: 'Choose a folder with Browse…', 'aria-label': 'Folder', 'data-testid': id('folder') });
  folder.addEventListener('change', async () => { B.folder = folder.value.trim(); if (inApp && B.folder) await scanFolder(B.folder); });
  const dirInput = h('input', { type: 'file', hidden: true, multiple: true, accept: '.dxf,.dwg,.cdr', 'data-testid': id('dirpicker') });
  dirInput.addEventListener('change', () => fromFiles([...dirInput.files]));
  const tick = onTick || (() => renderList());
  const ext = (key, text) => {
    const i = h('input', { type: 'checkbox', checked: B[key], 'data-testid': id('ext-' + key) });
    i.addEventListener('change', () => { B[key] = i.checked; tick(); });
    return h('label', { class: 'pd-row' }, i, ' ' + text);
  };
  const subs = h('input', { type: 'checkbox', checked: B.sub, 'data-testid': id('sub') });
  subs.addEventListener('change', async () => { B.sub = subs.checked; if (inApp && B.folder) await scanFolder(B.folder); else tick(); });
  const list = h('div', { class: 'pd-list', 'data-testid': id('list') });
  const saveTo = h('select', { class: 'fld', 'data-testid': id('batch-save') }, [['same', 'Same folder as each file'], ['choose', 'Choose a folder…']].map(([v, text]) => h('option', { value: v }, text)));
  saveTo.value = B.saveTo; saveTo.addEventListener('change', () => { B.saveTo = saveTo.value; B.saveDir = null; });
  const folderRow = h('div', { style: 'display:flex;gap:8px;align-items:flex-end' },
    h('label', { class: 'lbl pd-fl', style: 'flex:1' }, 'Folder', folder),
    h('button', { class: 'btn', type: 'button', 'data-testid': id('browse'), onclick: browse }, 'Browse…'), dirInput);
  const extRow = h('div', { class: 'row', style: 'display:flex;gap:18px;align-items:center' }, ext('dxf', '.dxf'), ext('dwg', '.dwg'), ext('cdr', '.cdr'),
    h('label', { class: 'pd-row' }, subs, ' Subfolders too'));

  async function scan(dir, rel, depth) {
    const out = [];
    for (const e of await t.fs.readDir(dir)) {
      if (e.isDirectory) { if (B.sub && depth < 8) out.push(...await scan(joinPath(dir, e.name), rel + e.name + '/', depth + 1)); }
      else if (/\.(dxf|dwg|cdr)$/i.test(e.name)) out.push(entryOf(e.name, rel + e.name, { path: joinPath(dir, e.name), dir }));
      if (out.length > 500) break;
    }
    return out;
  }
  async function scanFolder(dir) {
    try { B.all = (await scan(dir, '', 0)).sort((x, y) => x.rel.localeCompare(y.rel)); B.folder = dir; folder.value = dir; } catch (e) { B.all = []; note('Folder: ' + errText(e)); }
    onChange();
  }
  function fromFiles(files) {
    const picked = files.filter((f) => /\.(dxf|dwg|cdr)$/i.test(f.name)).map((f) => ({ f, rel: f.webkitRelativePath || f.name }))
      .filter((x) => B.sub || x.rel.split('/').length <= 2);
    B.all = picked.map((x) => entryOf(x.f.name, x.rel, { file: x.f })).sort((x, y) => x.rel.localeCompare(y.rel));
    const first = files[0] && files[0].webkitRelativePath;
    B.folder = first ? first.split('/')[0] : '';
    folder.value = B.folder;
    onChange();
  }
  async function browse() {
    if (!inApp || !t.dialog.open) { dirInput.value = ''; dirInput.click(); return; }
    try {
      const picked = await t.dialog.open({ directory: true, multiple: false });
      const dir = Array.isArray(picked) ? picked[0] : picked;
      if (dir) await scanFolder(String(dir));
    } catch (e) { note('Browse failed: ' + errText(e)); }
  }
  function renderList() {
    const shown = B.all.filter((e) => B[e.type]);
    const row = (cells, extra) => h('div', { class: 'pd-grid' + (extra || '') }, cells);
    fill(list,
      row([h('span'), h('span', null, 'File'), h('span', null, 'Type'), h('span', null, 'Status')], ' head'),
      shown.length ? shown.map((e) => {
        const box = h('input', { type: 'checkbox', checked: e.include, disabled: !!e.na, 'aria-label': 'Include ' + e.rel, 'data-testid': id('include') });
        box.addEventListener('change', () => { e.include = box.checked; e.status = box.checked ? { kind: 'waiting', text: 'Waiting' } : { kind: 'skipped', text: 'Skipped' }; onChange(); });
        const s = e.status;
        const status = s.kind === 'progress'
          ? h('div', { class: 'pd-prog' }, h('div', { role: 'progressbar', 'aria-label': 'Converting ' + e.name, 'aria-valuenow': s.pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { style: `width:${s.pct}%` })), h('span', { class: 'lbl mono' }, s.pct + '%'))
          : h('span', { class: s.kind === 'done' ? 'pd-ok' : s.kind === 'fail' ? 'pd-bad' : 'lbl', 'data-testid': id('status') }, s.text);
        return row([box, h('span', { style: e.include ? '' : 'color:var(--muted)', title: e.rel }, e.rel), h('span', { class: 'lbl' }, TYPES[e.type]), status], s.kind === 'progress' ? ' active' : '');
      }) : h('div', { class: 'pd-empty lbl' }, empty));
  }
  return { folderRow, extRow, list, saveTo, renderList, scanFolder };
}
