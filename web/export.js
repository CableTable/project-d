// export.js — the "PDF / Print" dialog (mock-up "PDF export"): This layout (page, film, pages, marks, live preview) and
// A folder at once. The pages themselves are planned and drawn by pdf-export.js (pure); this file is the UI, saving and
// printing. Settings are kept for the session (this object), never in a file. Text from a file goes in as text, via h().
import { h, fill } from './dom.js';
import { planPdf, freePdfName, DEFAULT_OPTIONS, tileGrid, checkFit, scaleText, PAPERS, PART_BORDER } from './pdf-export.js';
import { drawingBoxMm, startHidden, unitFactor } from './doc.js';

const layoutSettings = {
  ...DEFAULT_OPTIONS, tab: 'one', pageIdx: 0, dir: null,
  batch: { folder: '', dxf: true, dwg: true, cdr: true, sub: false, mode: 'same', saveTo: 'same', saveDir: null, all: [], busy: false },
};

/** The Part screen's own settings: one page, as drawn (no mirror, no marks, no separations), fitted to A4 unless changed. */
const partSettings = { ...DEFAULT_OPTIONS, mirror: false, separate: false, crop: false, reg: false, strip: false, tab: 'one', pageIdx: 0, dir: null, batch: layoutSettings.batch };

const baseName = (n) => String(n).replace(/\.[^.\\/]*$/, '');
const joinPath = (dir, name) => String(dir).replace(/[\\/]+$/, '') + (String(dir).includes('\\') ? '\\' : '/') + name;
const dirOf = (path) => String(path).replace(/[\\/][^\\/]*$/, '');
const today = () => { const d = new Date(); return [d.getDate(), d.getMonth() + 1].map((n) => String(n).padStart(2, '0')).join('-') + '-' + d.getFullYear(); };
const errText = (e) => (e && e.message ? e.message : String(e));
const TYPES = { dxf: 'DXF', dwg: 'DWG', cdr: 'CorelDRAW' };

/** Browser fallback: the bytes go to the Downloads folder. */
function downloadBytes(name, bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------------------------------------------------------------- the preview: the page's own drawing commands on a canvas

/** Replays a pdf-write Page on a canvas: mm, y up, black as the film colour, white paper. */
export function paintPage(canvas, page, box, colours) {
  const dpr = window.devicePixelRatio || 1, W = Math.max(1, box.width), Hh = Math.max(1, box.height);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hh * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = Hh + 'px';
  const c = canvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height);
  const pad = 14, k = Math.min((W - 2 * pad) / page.w, (Hh - 2 * pad) / page.h);
  if (!(k > 0)) return;
  const ox = (W - page.w * k) / 2, oy = (Hh - page.h * k) / 2;
  const V = [dpr * k, 0, 0, -dpr * k, dpr * ox, dpr * (oy + page.h * k)];
  const css = (rgb) => (rgb[0] + rgb[1] + rgb[2] === 0 ? colours.film : `rgb(${rgb.map((v) => Math.round(v * 255)).join(',')})`);
  c.setTransform(...V);
  c.fillStyle = colours.paper; c.fillRect(0, 0, page.w, page.h);
  c.strokeStyle = colours.line; c.lineWidth = 1 / k; c.strokeRect(0, 0, page.w, page.h);
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath();
  let st = { stroke: colours.film, fill: colours.film, width: 0.25, dash: [] };
  const stack = [];
  const apply = () => { c.strokeStyle = st.stroke; c.fillStyle = st.fill; c.lineWidth = Math.max(st.width, 0.9 / k); c.setLineDash(st.dash); };
  c.save(); c.beginPath(); c.rect(0, 0, page.w, page.h); c.clip(); c.beginPath();      // nothing outside the page
  for (const cmd of page.cmds) {
    switch (cmd[0]) {
      case 'q': stack.push({ ...st }); c.save(); break;
      case 'Q': if (stack.length) st = stack.pop(); c.restore(); break;
      case 'RG': st.stroke = css(cmd.slice(1)); break;
      case 'rg': st.fill = css(cmd.slice(1)); break;
      case 'w': st.width = cmd[1]; break;
      case 'd': st.dash = cmd[1]; break;
      case 'm': c.moveTo(cmd[1], cmd[2]); break;
      case 'l': c.lineTo(cmd[1], cmd[2]); break;
      case 'c': c.bezierCurveTo(...cmd.slice(1)); break;
      case 'h': c.closePath(); break;
      case 'S': apply(); c.stroke(); c.beginPath(); break;
      case 'f': case 'f*': apply(); c.fill(cmd[0] === 'f*' ? 'evenodd' : 'nonzero'); c.beginPath(); break;
      case 'W': case 'W*': c.clip(cmd[0] === 'W*' ? 'evenodd' : 'nonzero'); c.beginPath(); break;
      case 'T': {
        c.save(); apply();
        c.transform(...cmd[1]); c.scale(0.01, -0.01);
        c.font = '100px Helvetica, Arial, "Liberation Sans", sans-serif'; c.textBaseline = 'alphabetic';
        c.fillText(cmd[2], 0, 0);
        c.restore();
        break;
      }
      default: break;
    }
  }
  c.restore();
}

// ---------------------------------------------------------------- the dialog

/**
 * host: { source() → { name, fl, factor, off, sheetW, sheetH, hide } | null, sheet() → { w, h },
 *         readDrawing(bytes) → { ok, result, doc, sorry, error }, note(text) }
 */
export function openExport(host) {
  if (document.querySelector('.pdlg-back')) return;
  const src = host.source();
  if (!src) { host.note('Nothing to export: open a drawing first'); return; }
  const date = today();
  const part = !!src.part, settings = part ? partSettings : layoutSettings;        // Part: the drawing and its dimensions alone, three ways
  const srcFull = { ...src, date, name: baseName(src.name) };
  const t = window.__TAURI__;
  const inApp = !!(t && t.dialog && t.dialog.save && t.fs && t.fs.writeFile);
  const ref = {};
  let plan = null, busy = false, observer = null;

  const close = () => {
    if (observer) observer.disconnect();
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  const prevFocus = document.activeElement;
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

  // Mirror and Negative are for film: greyed on a check print, and then they do not apply (they come back as they were)
  const opts = () => ({
    page: settings.page, tilePaper: settings.tilePaper, checkPaper: settings.checkPaper, mirror: settings.mirror && settings.page !== 'check', negative: settings.negative && settings.page !== 'check',
    black: settings.black, separate: settings.separate, crop: settings.crop, reg: settings.reg, strip: settings.strip,
  });

  // ---- little builders
  const sel = (options, value, onchange, attrs) => {
    const s = h('select', { class: 'fld', ...attrs }, options.map(([v, text]) => h('option', { value: v }, text)));
    s.value = value; s.addEventListener('change', () => onchange(s.value));
    return s;
  };
  const check = (key, text, testid) => {
    const i = h('input', { type: 'checkbox', checked: settings[key], 'data-testid': testid });
    i.addEventListener('change', () => { settings[key] = i.checked; refresh(); });
    ref[key] = i;
    return h('label', { class: 'pd-row' }, i, ' ', text);
  };
  const radio = (value, testid, ...kids) => {
    const i = h('input', { type: 'radio', name: 'pdf-page', value, checked: settings.page === value, 'data-testid': testid });
    i.addEventListener('change', () => { if (i.checked) { settings.page = value; settings.pageIdx = 0; refresh(); } });
    ref['page_' + value] = i;
    return h('label', { class: 'pd-row' }, i, ' ', ...kids);
  };
  const fieldset = (legend, ...kids) => h('fieldset', { class: 'pd-set' }, h('legend', { class: 'sec' }, legend), ...kids);
  const pickPage = (value) => { settings.page = value; settings.pageIdx = 0; ref['page_' + value].checked = true; refresh(); };

  // ---- This layout
  ref.sheetLbl = h('span', { class: 'lbl mono', 'data-testid': 'pdf-sheet-size' });
  ref.tileLbl = h('span', { class: 'lbl mono', 'data-testid': 'pdf-tile-count' });
  ref.checkLbl = h('span', { class: 'lbl mono', 'data-testid': 'pdf-scale' });
  ref.tilePaper = sel([['A3', 'A3'], ['A4', 'A4']], settings.tilePaper, (v) => { settings.tilePaper = v; pickPage('tile'); }, { style: 'width:70px', 'data-testid': 'pdf-tile-paper', 'aria-label': 'Tile paper size' });
  ref.checkPaper = sel(part ? [['A4', 'A4'], ['A3', 'A3'], ['A0', 'A0']] : [['A4', 'A4'], ['A3', 'A3']], settings.checkPaper, (v) => { settings.checkPaper = v; pickPage('check'); }, { style: 'width:70px', 'data-testid': 'pdf-check-paper', 'aria-label': 'Check print paper size' });
  ref.pagesNote = h('div', { class: 'lbl', style: 'padding-left:22px', 'data-testid': 'pdf-pages-note' });
  ref.pagesNote2 = h('div', { class: 'lbl', style: 'padding-left:22px' });
  ref.preLabel = h('div', { class: 'lbl', 'data-testid': 'pdf-preview-label' });
  ref.pageBtns = h('div', { class: 'pd-pagebtns', 'data-testid': 'pdf-page-buttons' });
  ref.canvas = h('canvas', { role: 'img', 'data-testid': 'pdf-preview' });
  ref.prevBox = h('div', { class: 'pd-prev' }, ref.canvas);

  const left = h('div', { class: 'pd-left' },
    fieldset('Page',
      radio('sheet', 'pdf-page-sheet', part ? 'Page cut to the part, 1:1 ' : 'Sheet size, 1:1 ', ref.sheetLbl),
      radio('tile', 'pdf-page-tile', 'Tile 1:1 on ', ref.tilePaper, ' pages ', ref.tileLbl),
      radio('check', 'pdf-page-check', part ? 'Scaled to fit one ' : 'Check print, fit to ', ref.checkPaper, part ? ' page ' : ' with title block ', ref.checkLbl)),
    fieldset('Film',
      check('mirror', 'Mirror (emulsion down)', 'pdf-mirror'),
      check('negative', 'Negative', 'pdf-negative'),
      check('black', 'All colours print black', 'pdf-black'),
      ref.filmNote = h('div', { class: 'lbl', style: 'padding-left:22px' })),
    ...(part ? [] : [fieldset('Pages',
      check('separate', 'One page per print colour (layer)', 'pdf-separate'),
      ref.pagesNote, ref.pagesNote2)]),
    fieldset(part ? 'Label' : 'Marks',
      ...(part ? [] : [check('crop', 'Crop marks', 'pdf-crop'), check('reg', 'Registration marks', 'pdf-reg')]),
      check('strip', 'Job strip: file, date, colour', 'pdf-strip')));
  const right = h('div', { class: 'pd-right' }, ref.preLabel, ref.prevBox, ref.pageBtns);
  const oneBody = h('div', { class: 'pd-body' }, left, right);

  // ---- A folder at once
  const B = settings.batch;
  ref.folder = h('input', { class: 'fld', value: B.folder, placeholder: inApp ? 'Choose a folder with Browse…' : 'Choose a folder with Browse…', 'aria-label': 'Folder', 'data-testid': 'pdf-folder' });
  ref.folder.addEventListener('change', async () => { B.folder = ref.folder.value.trim(); if (inApp && B.folder) await scanFolder(B.folder); });
  ref.dirInput = h('input', { type: 'file', hidden: true, multiple: true, accept: '.dxf,.dwg,.cdr', 'data-testid': 'pdf-dirpicker' });
  ref.dirInput.addEventListener('change', () => fromFiles([...ref.dirInput.files]));
  const ext = (key, text) => {
    const i = h('input', { type: 'checkbox', checked: B[key], 'data-testid': 'pdf-ext-' + key });
    i.addEventListener('change', () => { B[key] = i.checked; renderList(); });
    return h('label', { class: 'pd-row' }, i, ' ' + text);
  };
  const subs = h('input', { type: 'checkbox', checked: B.sub, 'data-testid': 'pdf-sub' });
  subs.addEventListener('change', async () => { B.sub = subs.checked; if (inApp && B.folder) await scanFolder(B.folder); else renderList(); });
  ref.list = h('div', { class: 'pd-list', 'data-testid': 'pdf-list' });
  ref.mode = sel([['same', 'Same as “This layout”'], ['check', 'Check print, A4 fit'], ['plain', 'Sheet size 1:1, no film options']], B.mode, (v) => { B.mode = v; }, { 'data-testid': 'pdf-batch-mode' });
  ref.saveTo = sel([['same', 'Same folder as each file'], ['choose', 'Choose a folder…']], B.saveTo, (v) => { B.saveTo = v; B.saveDir = null; }, { 'data-testid': 'pdf-batch-save' });
  const batchBody = h('div', { class: 'pd-batch' },
    h('div', { style: 'display:flex;gap:8px;align-items:flex-end' },
      h('label', { class: 'lbl pd-fl', style: 'flex:1' }, 'Folder', ref.folder),
      h('button', { class: 'btn', type: 'button', 'data-testid': 'pdf-browse', onclick: browse }, 'Browse…'), ref.dirInput),
    h('div', { class: 'row', style: 'display:flex;gap:18px;align-items:center' }, ext('dxf', '.dxf'), ext('dwg', '.dwg'), ext('cdr', '.cdr'),
      h('label', { class: 'pd-row' }, subs, ' Subfolders too')),
    ref.list,
    h('div', { class: 'pd-two' },
      h('label', { class: 'lbl pd-fl' }, 'Settings', ref.mode),
      h('label', { class: 'lbl pd-fl' }, 'Save PDFs to', ref.saveTo)));

  // ---- the frame: title, tabs, body, footer
  const tabBtn = (id, text, testid) => {
    const b = h('button', { class: 'pd-tab', role: 'tab', type: 'button', 'data-testid': testid }, text);
    b.addEventListener('click', () => { settings.tab = id; refresh(); });
    return b;
  };
  ref.tabOne = tabBtn('one', part ? 'This part' : 'This layout', 'pdf-tab-one');
  ref.tabBatch = tabBtn('batch', 'A folder at once', 'pdf-tab-batch');
  if (part) { ref.tabBatch.hidden = true; settings.tab = 'one'; }
  ref.foot = h('span', { class: 'lbl mono pd-foot', 'data-testid': 'pdf-foot' });
  ref.print = h('button', { class: 'btn', type: 'button', 'data-testid': 'pdf-print', onclick: () => run(true) }, 'Print…');
  ref.go = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'pdf-go', onclick: () => run(false) }, 'Save PDF');
  const dlg = h('div', { class: 'pdlg', role: 'dialog', 'aria-label': 'PDF export', 'aria-modal': 'true', 'data-testid': 'pdf-dialog' },
    h('div', { class: 'pd-head' }, h('h1', null, 'PDF / Print'),
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Close', style: 'margin-left:auto;width:32px;padding:0;justify-content:center', 'data-testid': 'pdf-close', onclick: close }, '×')),
    h('div', { class: 'pd-tabs', role: 'tablist' }, ref.tabOne, ref.tabBatch),
    oneBody, batchBody,
    h('div', { class: 'pd-footer' }, ref.foot,
      h('button', { class: 'btn', type: 'button', style: 'margin-left:auto', 'data-testid': 'pdf-cancel', onclick: close }, 'Cancel'), ref.print, ref.go));
  const back = h('div', { class: 'pdlg-back', 'data-testid': 'pdf-back' }, dlg);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);

  // ---- keeping the dialog true to the settings
  const fileName = () => baseName(src.name) + '.pdf';
  const pageName = (p) => `${p.n}${p.layer ? ' · ' + p.layer : ''}${p.tile ? ` · tile ${p.tile.n}/${p.tile.of}` : ''}`;

  function refresh() {
    const one = settings.tab === 'one';
    ref.tabOne.classList.toggle('on', one); ref.tabBatch.classList.toggle('on', !one);
    ref.tabOne.setAttribute('aria-selected', String(one)); ref.tabBatch.setAttribute('aria-selected', String(!one));
    oneBody.hidden = !one; batchBody.hidden = one;
    const nB = B.all.filter((e) => e.include && e.type === 'dxf' && B[e.type]).length;
    ref.print.disabled = busy || !one;
    ref.print.title = one ? 'Saves the PDF, then open it to print' : 'Print works on one layout';
    ref.go.disabled = busy || (!one && !nB);
    if (!one) {
      ref.go.textContent = nB === 1 ? 'Convert 1 file' : `Convert ${nB} files`;
      const shown = B.all.filter((e) => B[e.type]);
      ref.foot.textContent = `${shown.length} files · ${shown.filter((e) => e.status.kind === 'done').length} done`;
      ref.foot.classList.remove('bad');
      renderList();
      return;
    }
    ref.go.textContent = 'Save PDF';
    const o = opts(), check = o.page === 'check';
    plan = planPdf(srcFull, o);
    if (settings.pageIdx >= plan.count) settings.pageIdx = plan.count - 1;
    if (settings.pageIdx < 0) settings.pageIdx = 0;
    const W = src.sheetW, Hh = src.sheetH;
    // a part's page is the part plus a border all round: say the part's own size and the border, not the page's
    ref.sheetLbl.textContent = part ? `${Number((W - 2 * PART_BORDER).toFixed(1))} × ${Number((Hh - 2 * PART_BORDER).toFixed(1))} + ${PART_BORDER} mm border` : `${Number(W.toFixed(1))} × ${Number(Hh.toFixed(1))}`;
    ref.sheetLbl.title = part ? 'The part plus a 10 mm border' : '';
    const [tw, th] = PAPERS[settings.tilePaper], a = tileGrid(W, Hh, tw, th), b = tileGrid(W, Hh, th, tw);
    const g = b.cols * b.rows < a.cols * a.rows ? b : a;
    ref.tileLbl.textContent = `${g.cols} × ${g.rows} tiles`;
    const [cw, ch] = PAPERS[settings.checkPaper], f1 = checkFit(W, Hh, cw, ch), f2 = checkFit(W, Hh, ch, cw);
    ref.checkLbl.textContent = (part ? 'not 1:1 · scale ' : 'scale ') + scaleText(Math.max(f1.s, f2.s));
    ref.checkLbl.hidden = !check;                                   // the scale belongs to the Scaled / Check print option only
    for (const k of ['mirror', 'negative']) { ref[k].disabled = check; ref[k].checked = !check && settings[k]; }
    ref.filmNote.textContent = check ? (part ? 'Mirror and negative are for film, not a scaled print' : 'Mirror and negative are for film, not a check print') : '';
    const names = [...new Set(plan.pages.map((p) => p.layer || 'All layers'))];
    const shownNames = names.length > 5 ? [...names.slice(0, 5), `+${names.length - 5} more`] : names;
    ref.pagesNote.textContent = `${shownNames.join(' · ')} = ${plan.count} ${plan.count === 1 ? 'page' : 'pages'}`;
    ref.pagesNote2.textContent = '';
    const p = plan.pages[settings.pageIdx];
    ref.preLabel.textContent = `Preview · page ${p.n} of ${plan.count} · ${p.layer || 'All layers'}${p.tile ? ` · tile ${p.tile.n}/${p.tile.of}` : ''}`;
    ref.canvas.setAttribute('aria-label', `Page ${p.n} preview: ${p.layer || 'all layers'}${o.mirror && !check ? ', mirrored' : ''}${o.negative && !check ? ', negative' : ''}, ${o.black ? 'in black' : 'in colour'}`);
    const shownBtns = plan.pages.slice(0, 60);
    fill(ref.pageBtns, shownBtns.map((q, i) => {
      const btn = h('button', { class: 'btn' + (i === settings.pageIdx ? ' on' : ''), type: 'button', 'data-testid': 'pdf-pagebtn' }, pageName(q));
      btn.addEventListener('click', () => { settings.pageIdx = i; refresh(); });
      return btn;
    }), plan.count > 60 ? h('span', { class: 'lbl' }, `+${plan.count - 60} more`) : null);
    const dir = settings.dir ? settings.dir.replace(/[\\/]+$/, '') + (settings.dir.includes('\\') ? '\\' : '/') : '';
    ref.foot.textContent = dir + fileName();
    ref.foot.classList.remove('bad');
    paint();
  }

  function paint() {
    if (!plan || settings.tab !== 'one') return;
    const r = ref.prevBox.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const cs = getComputedStyle(document.documentElement);
    paintPage(ref.canvas, plan.build(settings.pageIdx), r, { paper: cs.getPropertyValue('--pdpaper').trim() || '#ffffff', film: cs.getPropertyValue('--film').trim() || '#111111', line: cs.getPropertyValue('--line').trim() || '#999999' });
  }

  // ---- saving and printing: This layout
  async function saveOne(print) {
    const bytes = plan.bytes(), name = fileName();
    if (inApp) {
      let path = await t.dialog.save({ defaultPath: settings.dir ? joinPath(settings.dir, name) : name, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (!path) return null;
      path = String(path);
      if (!/\.pdf$/i.test(path)) path += '.pdf';
      await t.fs.writeFile(path, bytes);
      settings.dir = dirOf(path);
      return { path, name: path.split(/[\\/]/).pop(), bytes };
    }
    if (print) {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const w = window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      if (!w) downloadBytes(name, bytes);
    } else downloadBytes(name, bytes);
    return { path: null, name, bytes };
  }

  // ---- A folder at once
  const entryOf = (name, rel, extra) => {
    const type = (name.match(/\.(dxf|dwg|cdr)$/i) || [])[1].toLowerCase();
    const na = type !== 'dxf';
    return { name, rel, type, include: !na, status: na ? { kind: 'na', text: (type === 'dwg' ? 'DWG' : 'CorelDRAW') + ': not built yet' } : { kind: 'waiting', text: 'Waiting' }, ...extra };
  };
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
    try { B.all = (await scan(dir, '', 0)).sort((x, y) => x.rel.localeCompare(y.rel)); B.folder = dir; ref.folder.value = dir; } catch (e) { B.all = []; host.note('Folder: ' + errText(e)); }
    refresh();
  }
  function fromFiles(files) {
    const list = files.filter((f) => /\.(dxf|dwg|cdr)$/i.test(f.name)).map((f) => ({ f, rel: f.webkitRelativePath || f.name }))
      .filter((x) => B.sub || x.rel.split('/').length <= 2);
    B.all = list.map((x) => entryOf(x.f.name, x.rel, { file: x.f })).sort((x, y) => x.rel.localeCompare(y.rel));
    const first = files[0] && files[0].webkitRelativePath;
    B.folder = first ? first.split('/')[0] : '';
    ref.folder.value = B.folder;
    refresh();
  }
  async function browse() {
    if (!inApp || !t.dialog.open) { ref.dirInput.value = ''; ref.dirInput.click(); return; }
    try {
      const picked = await t.dialog.open({ directory: true, multiple: false });
      const dir = Array.isArray(picked) ? picked[0] : picked;
      if (dir) await scanFolder(String(dir));
    } catch (e) { host.note('Browse failed: ' + errText(e)); }
  }
  function renderList() {
    const shown = B.all.filter((e) => B[e.type]);
    const row = (cells, extra) => h('div', { class: 'pd-grid' + (extra || '') }, cells);
    fill(ref.list,
      row([h('span'), h('span', null, 'File'), h('span', null, 'Type'), h('span', null, 'Status')], ' head'),
      shown.length ? shown.map((e) => {
        const box = h('input', { type: 'checkbox', checked: e.include, disabled: e.type !== 'dxf', 'aria-label': 'Include ' + e.rel, 'data-testid': 'pdf-include' });
        box.addEventListener('change', () => { e.include = box.checked; e.status = box.checked ? { kind: 'waiting', text: 'Waiting' } : { kind: 'skipped', text: 'Skipped' }; refresh(); });
        const s = e.status;
        const status = s.kind === 'progress'
          ? h('div', { class: 'pd-prog' }, h('div', { role: 'progressbar', 'aria-label': 'Converting ' + e.name, 'aria-valuenow': s.pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { style: `width:${s.pct}%` })), h('span', { class: 'lbl mono' }, s.pct + '%'))
          : h('span', { class: s.kind === 'done' ? 'pd-ok' : s.kind === 'fail' ? 'pd-bad' : 'lbl', 'data-testid': 'pdf-status' }, s.text);
        return row([box, h('span', { style: e.include ? '' : 'color:var(--muted)', title: e.rel }, e.rel), h('span', { class: 'lbl' }, TYPES[e.type]), status], s.kind === 'progress' ? ' active' : '');
      }) : h('div', { class: 'pd-empty lbl' }, inApp ? 'No drawings here yet. Browse to a folder.' : 'No drawings yet. Browse to a folder (the PDFs go to Downloads).'));
  }

  function batchOptions() {
    const cur = opts();
    if (B.mode === 'check') return { ...cur, page: 'check', checkPaper: 'A4', separate: false, mirror: false, negative: false };
    if (B.mode === 'plain') return { ...cur, page: 'sheet', mirror: false, negative: false, black: false, separate: false };
    return cur;
  }
  async function convertAll() {
    const todo = B.all.filter((e) => e.include && e.type === 'dxf' && B[e.type]);
    let outDir = null;
    if (B.saveTo === 'choose' && inApp) {
      if (!B.saveDir) {
        const picked = await t.dialog.open({ directory: true, multiple: false });
        const d = Array.isArray(picked) ? picked[0] : picked;
        if (!d) return;
        B.saveDir = String(d);
      }
      outDir = B.saveDir;
    }
    const o = batchOptions(), sheet = host.sheet(), used = new Set();
    let ok = 0;
    for (const e of todo) {
      const set = (pct, text, kind = 'progress') => { e.status = { kind, pct, text }; renderList(); };
      try {
        set(10);
        let buf;
        if (e.file) buf = await e.file.arrayBuffer();
        else { const u = await t.fs.readFile(e.path); buf = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); }
        set(30);
        const r = await host.readDrawing(buf);
        if (!r.ok) { set(0, (r.sorry || r.error || 'Could not read this drawing'), 'fail'); continue; }
        const fl = r.result;
        if (!fl.items.length) { set(0, 'Skipped: empty drawing', 'skipped'); continue; }
        set(55);
        const factor = unitFactor(fl.units), box = drawingBoxMm(fl, factor);
        const sheetW = Math.max(sheet.w, box ? Math.ceil(box[2]) : 0), sheetH = Math.max(sheet.h, box ? Math.ceil(box[3]) : 0);
        const p = planPdf({ fl, factor, off: startHidden(fl), sheetW, sheetH, name: baseName(e.name), date, hide: [] }, o);
        const bytes = p.bytes();
        set(80);
        let out = baseName(e.name) + '.pdf';
        if (e.path) {
          const dir = outDir || e.dir;
          // not a name used in this run, and not a file already on disk (a customer's bracket.pdf next to bracket.dxf)
          const want = joinPath(dir, await freePdfName(baseName(out), async (nm) => { const p = joinPath(dir, nm); return used.has(p.toLowerCase()) || await t.fs.exists(p); }));
          used.add(want.toLowerCase());
          await t.fs.writeFile(want, bytes);
          out = want;
        } else downloadBytes(out, bytes);
        ok++;
        set(100, `Done · ${p.count} ${p.count === 1 ? 'page' : 'pages'}`, 'done');
      } catch (err) { set(0, 'Failed: ' + errText(err), 'fail'); }
    }
    host.note(`PDF: ${ok} of ${todo.length} files converted`);
  }

  async function run(print) {
    if (busy) return;
    busy = true; refresh();
    try {
      if (settings.tab === 'batch') { await convertAll(); return; }
      const r = await saveOne(print);
      if (!r) return;
      const pages = plan.count + (plan.count === 1 ? ' page' : ' pages');
      if (print) host.note(r.path ? `Saved ${r.path} (${pages}). Open it and press Ctrl+P to print` : `${r.name} opened for printing (${pages})`);
      else host.note(`Saved ${r.path || r.name} (${pages})`);
      close();
    } catch (err) {
      ref.foot.textContent = 'PDF failed: ' + errText(err); ref.foot.classList.add('bad');
      host.note('PDF failed: ' + errText(err));
    } finally { busy = false; if (document.body.contains(back)) { const bad = ref.foot.classList.contains('bad'), txt = ref.foot.textContent; refresh(); if (bad) { ref.foot.textContent = txt; ref.foot.classList.add('bad'); } } }
  }

  document.body.append(back);
  refresh();
  if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(() => paint()); observer.observe(ref.prevBox); }
  const first = ref['page_' + settings.page];
  if (first) first.focus();
}
