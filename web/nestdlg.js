// nestdlg.js — the Auto-nest dialog (mock-up R10, option B): the parts and how many, the rotations, a preview of the packed sheet
// that is NOT on the sheet until Apply, Run again with other settings, left-overs (and "next sheet"). The packing itself is nest.js
// (pure) run by nestrun.js (a worker); this file is the UI. Part names come from files, so they go in as text, via h().
import { h } from './dom.js';
import { startNest } from './nestrun.js';
import { ROTATIONS, MAX_PIECES, polyAt } from './nest.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
};
const fmt = (v) => String(Math.round(v * 10) / 10);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const ROT_LABELS = [['none', '0° only'], ['flip', '0° + 180°'], ['all', 'Every 90°']];
const KINDS = 4;

/**
 * cfg: { layName, sheetW, sheetH, area: { x, y, w, h } (usable, y up), grips: { top, right, bottom, left }, gap,
 *        parts: [{ id, name, w, h, thumb, count, outline() → [[x, y], …] }], fixed: [[[x, y], …]] (parts already on the sheet, sheet mm),
 *        autoRun, onApply(result, counts), onNextSheet(result, left), note(text) }
 * settings (kept for the session): { rotations }.
 */
const kept = { rotations: 'all' };

export function openNest(cfg) {
  if (document.querySelector('.nestdlg')) return;
  const counts = {};
  for (const p of cfg.parts) counts[p.id] = p.count;
  let phase = 'idle', result = null, progress = { done: 0, total: 0, placements: [] }, run = null, t0 = 0, clock = 0;
  const polys = new Map();
  const polyOf = (id) => { if (!polys.has(id)) polys.set(id, cfg.parts.find((p) => p.id === id).outline()); return polys.get(id); };
  const kindOf = (id) => cfg.parts.findIndex((p) => p.id === id) % KINDS + 1;
  const prevFocus = document.activeElement;

  const close = () => {
    if (run) { run.stop(); run = null; }
    clearInterval(clock);
    document.removeEventListener('keydown', onKey, true);
    back.remove();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

  // ---- left: the parts and how many
  const rows = cfg.parts.map((p, i) => {
    const input = h('input', { class: 'cnt mono', type: 'text', inputmode: 'numeric', value: String(counts[p.id]), 'aria-label': `How many ${p.name}`, 'data-testid': `nest-count-${i}` });
    const set = (n) => { counts[p.id] = Math.max(0, Math.min(MAX_PIECES, n | 0)); sync(); };
    input.addEventListener('change', () => set(parseInt(input.value, 10) || 0));
    input.addEventListener('focus', () => input.select());
    const minus = h('button', { class: 'ib', type: 'button', 'aria-label': `One fewer ${p.name}`, 'data-testid': `nest-minus-${i}`, onclick: () => set(counts[p.id] - 1) }, '−');
    const plus = h('button', { class: 'ib', type: 'button', 'aria-label': `One more ${p.name}`, 'data-testid': `nest-plus-${i}`, onclick: () => set(counts[p.id] + 1) }, '+');
    const row = h('div', { class: 'nrow', 'data-testid': `nest-row-${i}` },
      h('span', { class: 'nth' }, p.thumb ? h('img', { src: p.thumb, alt: '' }) : null),
      h('span', { class: 'ntx' }, h('span', { class: 'nnm', title: p.name }, p.name), h('span', { class: 'lbl mono' }, `${fmt(p.w)} × ${fmt(p.h)}`)),
      h('span', { class: 'stp' }, minus, input, plus));
    return { p, input, row, minus, plus };
  });
  const totals = h('span', { class: 'lbl', 'data-testid': 'nest-totals' });
  const setAll = h('button', { class: 'btn sm', type: 'button', 'data-testid': 'nest-all1', onclick: () => { for (const p of cfg.parts) counts[p.id] = 1; sync(); } }, 'Set all to 1');
  const rotBtns = ROT_LABELS.map(([key, text]) => {
    const b = h('button', { class: 'seg' + (kept.rotations === key ? ' on' : ''), type: 'button', 'aria-pressed': kept.rotations === key ? 'true' : 'false', 'data-testid': `nest-rot-${key}`,
      onclick: () => { kept.rotations = key; rotBtns.forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); }); } }, text);
    return b;
  });
  const left = h('div', { class: 'pd-left' },
    h('div', { class: 'lbl' }, 'Packs the parts by their real outline, bottom-left first.'),
    h('div', { class: 'lbl sub' }, 'Parts and how many · from the Parts library'),
    cfg.parts.length ? h('div', { class: 'nlist', 'data-testid': 'nest-list' }, rows.map((r) => r.row))
      : h('div', { class: 'lbl', 'data-testid': 'nest-empty' }, 'There are no parts yet. Add a drawing to the Parts library first.'),
    h('div', { class: 'pd-row' }, totals, h('span', { style: 'flex:1' }), setAll),
    h('div', { class: 'lbl sub' }, 'Rotations'),
    h('div', { class: 'mode', role: 'group', 'aria-label': 'Rotations' }, rotBtns),
    h('div', { class: 'pd-row' }, h('span', null, 'Gap between parts'), h('span', { style: 'flex:1' }), h('span', { class: 'mono', 'data-testid': 'nest-gap' }, `${fmt(cfg.gap)} mm`)),
    h('div', { class: 'lbl' }, 'From the layout\'s Gap X / Y. Change it on the Layout panel.'));

  // ---- right: the preview, the legend, the result
  const preLabel = h('div', { class: 'lbl sub', 'data-testid': 'nest-prelabel' });
  const pvwrap = h('div', { class: 'pvwrap', 'data-testid': 'nest-preview' });
  const legend = h('div', { class: 'legend' });
  const resBox = h('div', { class: 'nres', 'data-testid': 'nest-result', hidden: true });
  const right = h('div', { class: 'pd-right' }, preLabel, pvwrap, legend, resBox);

  // ---- footer
  const foot = h('div', { class: 'pd-footer' });
  const cancel = h('button', { class: 'btn', type: 'button', 'data-testid': 'nest-cancel', onclick: close }, 'Cancel');
  const runBtn = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'nest-run', onclick: () => start() }, 'Run');
  const again = h('button', { class: 'btn', type: 'button', 'data-testid': 'nest-again', onclick: () => start() }, 'Run again');
  const stop = h('button', { class: 'btn danger', type: 'button', 'data-testid': 'nest-stop', onclick: () => { if (run) run.stop(); } }, 'Stop');
  const apply = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'nest-apply', onclick: () => { const r = result; close(); cfg.onApply(r, { ...counts }); } }, 'Apply');
  const stat = h('span', { class: 'mono', 'data-testid': 'nest-status' });
  const bar = h('div', { class: 'pbar', role: 'progressbar', 'aria-label': 'Auto-nest progress', 'aria-valuemin': '0', 'aria-valuemax': '100', style: 'flex:1;max-width:320px' }, h('i', { style: 'width:0%' }));

  const dlg = h('div', { class: 'pdlg nestdlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Auto-nest', 'data-testid': 'nest-dialog', 'data-state': 'idle' },
    h('div', { class: 'pd-head' }, h('h1', null, 'Auto-nest'),
      h('span', { class: 'lbl', 'data-testid': 'nest-sub' }, `${cfg.layName} · sheet ${fmt(cfg.sheetW)} × ${fmt(cfg.sheetH)} mm · gripper ${fmt(cfg.grips.bottom)} mm · gap ${fmt(cfg.gap)} mm`),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'ib', type: 'button', 'aria-label': 'Close', onclick: close }, '×')),
    h('div', { class: 'pd-body' }, left, right), foot);
  const back = h('div', { class: 'pdlg-back' }, dlg);

  const total = () => cfg.parts.reduce((s, p) => s + counts[p.id], 0);
  const usedParts = () => cfg.parts.filter((p) => counts[p.id] > 0).length;

  /** The sheet, the grippers, what is already on it, and the packed parts (kept in the preview only). */
  function paintPreview(placements) {
    const W = cfg.sheetW, H = cfg.sheetH, g = cfg.grips, kids = [sv('rect', { x: 0, y: 0, width: W, height: H, fill: 'var(--sheet)', stroke: 'var(--line)', 'vector-effect': 'non-scaling-stroke' })];
    const band = (x, y, w, hh) => { if (w > 0 && hh > 0) kids.push(sv('rect', { x, y, width: w, height: hh, fill: 'var(--sel)' })); };
    band(0, 0, W, g.bottom); band(0, H - g.top, W, g.top); band(0, 0, g.left, H); band(W - g.right, 0, g.right, H);
    const dash = { fill: 'none', stroke: 'var(--accent)', 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke', opacity: .7 };
    if (g.bottom > 0) kids.push(sv('line', { x1: 0, y1: g.bottom, x2: W, y2: g.bottom, ...dash }));
    if (g.top > 0) kids.push(sv('line', { x1: 0, y1: H - g.top, x2: W, y2: H - g.top, ...dash }));
    if (g.left > 0) kids.push(sv('line', { x1: g.left, y1: 0, x2: g.left, y2: H, ...dash }));
    if (g.right > 0) kids.push(sv('line', { x1: W - g.right, y1: 0, x2: W - g.right, y2: H, ...dash }));
    const pts = (poly) => poly.map(([x, y]) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`).join(' ');
    for (const f of cfg.fixed) kids.push(sv('polygon', { points: pts(f), fill: 'var(--muted)', 'fill-opacity': .25, stroke: 'var(--muted)', 'stroke-width': 1.3, 'vector-effect': 'non-scaling-stroke' }));
    for (const pl of placements) {
      const k = kindOf(pl.partId);
      kids.push(sv('polygon', { points: pts(polyAt(polyOf(pl.partId), pl.rot, pl.x, pl.y)), fill: `var(--t${k})`, 'fill-opacity': .28, stroke: `var(--t${k})`, 'stroke-width': 1.3, 'vector-effect': 'non-scaling-stroke', 'data-testid': 'nest-piece' }));
    }
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'Preview of the nested sheet', 'data-testid': 'nest-svg', 'data-placed': placements.length },
      sv('g', { transform: `translate(0 ${H}) scale(1 -1)` }, kids));
    if (g.bottom > 0) svg.append(sv('text', { x: 6, y: H - g.bottom / 2 + 4, 'font-size': Math.max(6, Math.min(14, g.bottom * 0.5)), fill: 'var(--muted)' }, `GRIPPER ${fmt(g.bottom)}`));
    pvwrap.replaceChildren(svg);
  }

  function paintLegend() {
    legend.replaceChildren(...cfg.parts.filter((p) => counts[p.id] > 0).map((p) => h('span', null, h('i', { style: `background:var(--t${kindOf(p.id)})` }), p.name)));
  }

  function paintResult() {
    if (!result) { resBox.hidden = true; return; }
    resBox.hidden = false;
    const left = cfg.parts.filter((p) => result.left[p.id] > 0), leftN = left.reduce((s, p) => s + result.left[p.id], 0);
    const ok = leftN === 0;
    resBox.classList.toggle('all', ok);
    const kids = [h('div', { class: 'pd-row' }, h('strong', { 'data-testid': 'nest-placed' }, `${result.placed} of ${result.total} placed${result.stopped ? ' (stopped)' : ''}`),
      h('span', { class: 'chip', 'data-testid': 'nest-pct' }, `${Math.round(result.usedPct)} % of the sheet used`))];
    if (ok) kids.push(h('div', { class: 'lbl', 'data-testid': 'nest-left' }, 'Everything fits on this sheet.'));
    else {
      kids.push(h('div', { class: 'lbl', 'data-testid': 'nest-left' }, `Left over (${leftN}): `, left.flatMap((p, i) => [i ? ', ' : '', h('b', null, `${result.left[p.id]} × ${p.name}`)]),
        result.stopped ? '. You stopped the run.' : '. They do not fit this sheet.'));
      kids.push(h('button', { class: 'btn sm', type: 'button', style: 'width:100%', 'data-testid': 'nest-next', title: 'Applies this nest here, then opens a new layout tab (same sheet, grippers and gap) with the left-overs, ready to nest', onclick: () => {
        const r = result, lf = { ...r.left }; close(); cfg.onNextSheet(r, lf);
      } }, 'Nest the left-overs on the next sheet'));
    }
    resBox.replaceChildren(...kids);
  }

  function paintFooter() {
    const running = phase === 'run';
    dlg.dataset.state = phase;
    dlg.classList.toggle('running', running);
    for (const r of rows) { r.input.disabled = running; r.minus.disabled = running; r.plus.disabled = running; }
    setAll.disabled = running; rotBtns.forEach((b) => { b.disabled = running; });
    preLabel.textContent = running ? 'Preview · placing…' : 'Preview · not applied yet';
    const canApply = phase === 'done' && result && result.placed > 0;
    apply.disabled = !canApply;
    if (running) {
      const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
      stat.textContent = `Placing ${progress.done} of ${progress.total}…  ${((Date.now() - t0) / 1000).toFixed(1)} s`;
      bar.firstChild.style.width = pct + '%'; bar.setAttribute('aria-valuenow', String(pct));
      foot.replaceChildren(stat, bar, h('span', { style: 'flex:1' }), stop, apply);
    } else if (phase === 'done') {
      foot.replaceChildren(h('span', { class: 'lbl' }, 'Apply puts the parts on the sheet as one undo step, "Auto-nest".'), h('span', { style: 'flex:1' }), cancel, again, apply);
    } else {
      foot.replaceChildren(h('span', { class: 'lbl' }, total() ? 'Run packs the parts into a preview. The sheet is not changed until Apply.' : 'Set how many of each part, then Run.'), h('span', { style: 'flex:1' }), cancel, runBtn);
    }
    runBtn.disabled = !total();
    again.disabled = !total();
  }

  /** Counts changed: the totals, the legend, and the Run button follow. */
  function sync() {
    for (const r of rows) { r.input.value = String(counts[r.p.id]); r.row.classList.toggle('dim', !counts[r.p.id]); }
    totals.textContent = `${plural(total(), 'piece', 'pieces')} from ${plural(usedParts(), 'part', 'parts')}`;
    paintLegend(); paintFooter();
  }

  function start() {
    const items = cfg.parts.filter((p) => counts[p.id] > 0).map((p) => ({ id: p.id, count: counts[p.id], poly: polyOf(p.id) }));
    if (!items.length) return;
    phase = 'run'; result = null; progress = { done: 0, total: items.reduce((s, i) => s + i.count, 0), placements: [] }; t0 = Date.now();
    paintResult(); paintPreview([]); paintFooter();
    clearInterval(clock); clock = setInterval(() => { if (phase === 'run') paintFooter(); }, 200);
    const job = { area: cfg.area, gap: cfg.gap, rotations: kept.rotations in ROTATIONS ? kept.rotations : 'all', items, fixed: cfg.fixed };
    let lastDraw = 0;
    const me = run = startNest(job, (s) => {
      if (run !== me) return;
      progress = s;
      const now = performance.now();
      if (now - lastDraw > 120) { lastDraw = now; paintPreview(s.placements); }
      paintFooter();
    });
    me.done.then((r) => {
      if (run !== me) return;
      run = null; clearInterval(clock);
      result = r; phase = 'done';
      paintPreview(r.placements); paintResult(); paintFooter();
      dlg.dataset.ms = String(r.ms);
    });
  }

  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  sync(); paintPreview([]); paintResult();
  (runBtn.disabled ? cancel : runBtn).focus();
  if (cfg.autoRun) start();
}
