// tracedlg.js — the Trace bitmap dialog (mock-up R14, section 05): the picture on the left of the preview, the proposed outlines beside it,
// four controls (threshold, detail, smoothing, colour count), a layer name. Nothing is put on the drawing until "Trace into <layer>".
// The maths is trace.js (pure); imagetracerjs (web/vendor/imagetracer, a classic script) is loaded when the dialog first opens.
// The picture's name comes from a file, so it goes in as text, via h().
import { h } from './dom.js';
import * as T from './trace.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
};
const fmt = (v) => String(Math.round(v * 10) / 10);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const kept = { ...T.DEFAULTS };                                    // the settings stay for the session

let loading = null;
function loadTracer() {
  if (window.ImageTracer) return Promise.resolve(window.ImageTracer);
  if (!loading) {
    loading = new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = 'vendor/imagetracer/imagetracer.js';
      s.onload = () => ok(window.ImageTracer);
      s.onerror = () => { loading = null; no(new Error('the tracer did not load')); };
      document.head.append(s);
    });
  }
  return loading;
}

/**
 * cfg: { name, bitmap (the picture), w, h (its pixels), mmW, mmH (its true size), layer (default name), layerProblem(name) → '' or why not,
 *        onApply(polys, layer) (polys: closed outlines in mm from the picture's bottom-left, y up), note(text) }
 */
export function openTrace(cfg) {
  if (document.querySelector('.tracedlg')) return;
  const prevFocus = document.activeElement, fit = T.fitSize(cfg.w, cfg.h);
  let polys = [], phase = 'tracing', token = 0;

  const close = () => { token++; document.removeEventListener('keydown', onKey, true); back.remove(); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };

  // the picture at the size it is traced at (kept as pixels; each run makes a black and white copy of it when it has two colours)
  const work = h('canvas', { width: fit.w, height: fit.h });
  const wctx = work.getContext('2d', { willReadFrequently: true });
  wctx.drawImage(cfg.bitmap, 0, 0, fit.w, fit.h);
  const source = wctx.getImageData(0, 0, fit.w, fit.h);

  // ---- left: the controls
  const slider = (key, label, max, unit, id) => {
    const out = h('b', { 'data-testid': `trace-${id}-value` });
    const input = h('input', { type: 'range', min: '0', max: String(max), value: String(kept[key]), 'aria-label': label, 'data-testid': `trace-${id}` });
    const show = () => { out.textContent = `${input.value}${unit}`; };
    input.addEventListener('input', () => { kept[key] = Number(input.value); show(); stale(); });
    show();
    return { input, row: h('label', { class: 'slider' }, h('span', null, label, ' ', out), input) };
  };
  const threshold = slider('threshold', 'Threshold', 255, ' / 255', 'threshold');
  const detail = slider('detail', 'Detail', 100, '%', 'detail');
  const smoothing = slider('smoothing', 'Smoothing', 100, '%', 'smoothing');
  const colours = h('input', { class: 'fld', type: 'number', min: '2', max: String(T.MAX_COLOURS), step: '1', value: String(kept.colours), 'aria-label': 'Colour count', 'data-testid': 'trace-colours' });
  const thrNote = h('span', { class: 'lbl', 'data-testid': 'trace-threshold-note' });
  const layer = h('input', { class: 'fld', type: 'text', value: cfg.layer, maxlength: '255', spellcheck: 'false', 'aria-label': 'Trace into layer', 'data-testid': 'trace-layer' });
  const layerErr = h('div', { class: 'lbl bad', 'data-testid': 'trace-layer-error', hidden: true });
  colours.addEventListener('change', () => { colours.value = String(Math.round(Math.min(T.MAX_COLOURS, Math.max(2, Number(colours.value) || 2)))); kept.colours = Number(colours.value); stale(); });
  layer.addEventListener('input', () => paintFooter());

  const left = h('div', { class: 'pd-left' },
    h('div', { class: 'lbl sub' }, 'Trace mode'),
    h('div', { class: 'mode', role: 'group', 'aria-label': 'Trace mode' },
      h('button', { class: 'seg on', type: 'button', 'aria-pressed': 'true', 'data-testid': 'trace-mode-outline' }, 'Outline'),
      h('button', { class: 'seg', type: 'button', disabled: true, title: 'Centreline: coming later', 'data-testid': 'trace-mode-centreline' }, 'Centreline')),
    threshold.row, thrNote, detail.row, smoothing.row,
    h('label', { class: 'pd-fl' }, h('span', null, 'Colour count'), colours),
    h('div', { class: 'lbl' }, 'White and see-through areas are the paper: they are not traced.'),
    h('label', { class: 'pd-fl' }, h('span', null, 'Trace into layer'), layer), layerErr,
    h('div', { class: 'lbl', 'data-testid': 'trace-limit' },
      fit.k < 1 ? `This picture is ${cfg.w} × ${cfg.h} px: it is reduced to ${fit.w} × ${fit.h} px before tracing (the limit is ${T.MAX_PX} px on the long side).`
        : `Pictures over ${T.MAX_PX} px on the long side are reduced to ${T.MAX_PX} px before tracing.`));

  // ---- right: the picture and what would be made
  const orig = h('canvas', { width: fit.w, height: fit.h, role: 'img', 'aria-label': 'The picture to trace', 'data-testid': 'trace-original' });
  orig.getContext('2d').drawImage(cfg.bitmap, 0, 0, fit.w, fit.h);
  const pvwrap = h('div', { class: 'pvwrap', 'data-testid': 'trace-preview' });
  const stats = h('div', { class: 'lbl', 'data-testid': 'trace-stats' });
  const right = h('div', { class: 'pd-right' },
    h('div', { class: 'lbl sub' }, `${cfg.w} × ${cfg.h} px · ${fmt(cfg.mmW)} × ${fmt(cfg.mmH)} mm on the sheet`),
    h('div', { class: 'trace-pair' },
      h('figure', null, h('figcaption', { class: 'lbl' }, 'Original picture'), h('div', { class: 'pvwrap trace-orig' }, orig)),
      h('figure', null, h('figcaption', { class: 'lbl' }, 'Proposed outlines'), pvwrap)),
    stats,
    h('div', { class: 'lbl' }, 'The picture stays where it is. The outlines take its position and its size.'));

  // ---- footer
  const status = h('span', { class: 'lbl', 'data-testid': 'trace-status' });
  const cancel = h('button', { class: 'btn', type: 'button', 'data-testid': 'trace-cancel', onclick: close }, 'Cancel');
  const update = h('button', { class: 'btn', type: 'button', 'data-testid': 'trace-update', onclick: () => run() }, 'Update preview');
  const apply = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'trace-apply', onclick: () => {
    const name = layer.value.trim(), ps = polys;
    if (phase !== 'ready' || !ps.length || cfg.layerProblem(name)) return;
    close(); cfg.onApply(ps, name);
  } });
  const foot = h('div', { class: 'pd-footer' }, status, h('span', { style: 'flex:1' }), cancel, update, apply);

  const dlg = h('div', { class: 'pdlg tracedlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Trace bitmap', 'data-testid': 'trace-dialog', 'data-state': phase },
    h('div', { class: 'pd-head' }, h('h1', null, 'Trace bitmap'), h('span', { class: 'lbl', 'data-testid': 'trace-sub' }, cfg.name),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'ib', type: 'button', 'aria-label': 'Close', onclick: close }, '×')),
    h('div', { class: 'pd-body' }, left, right), foot);
  const back = h('div', { class: 'pdlg-back' }, dlg);

  const params = () => ({ threshold: kept.threshold, detail: kept.detail, smoothing: kept.smoothing, colours: kept.colours });
  const two = () => kept.colours === 2;

  function paintFooter() {
    const name = layer.value.trim(), why = cfg.layerProblem(name);
    dlg.dataset.state = phase; dlg.dataset.count = String(polys.length);
    layerErr.hidden = !why; layerErr.textContent = why;
    threshold.input.disabled = !two();
    thrNote.textContent = two() ? 'Threshold: darker than this is ink (two colours, black and white).' : 'Threshold works with 2 colours only. More colours are picked by the tracer.';
    apply.textContent = `Trace into ${name || 'a layer'}`;
    apply.disabled = phase !== 'ready' || !polys.length || !!why;
    update.disabled = phase === 'tracing';
    status.textContent = phase === 'tracing' ? 'Tracing…' : phase === 'stale' ? 'Settings changed: Update preview.' : phase === 'error' ? '' : !polys.length ? 'Nothing to trace with these settings.' : 'Trace puts the outlines on the layer as closed polylines (one undo step).';
  }
  function stale() { if (phase === 'ready' || phase === 'error') { phase = 'stale'; paintFooter(); } }

  function paintPreview(points) {
    if (!polys.length) { pvwrap.replaceChildren(h('div', { class: 'lbl', style: 'padding:12px' }, phase === 'error' ? '' : 'No outlines.')); stats.textContent = ''; return; }
    const d = polys.map((p) => 'M' + p.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L') + 'Z').join('');
    pvwrap.replaceChildren(sv('svg', { viewBox: `0 0 ${cfg.mmW} ${cfg.mmH}`, preserveAspectRatio: 'xMidYMid meet', role: 'img', 'aria-label': 'The proposed outlines', 'data-testid': 'trace-svg', 'data-paths': polys.length },
      sv('g', { transform: `translate(0 ${cfg.mmH}) scale(1 -1)` }, sv('path', { d, fill: 'var(--accent)', 'fill-opacity': .3, 'fill-rule': 'evenodd', stroke: 'var(--accent)', 'stroke-width': 1.3, 'vector-effect': 'non-scaling-stroke' }))));
    stats.textContent = `${plural(polys.length, 'outline', 'outlines')} · ${plural(points, 'point', 'points')}`;
  }

  /** Traces the picture with the controls as they are now (a little later, so "Tracing…" shows first). */
  function run() {
    const mine = ++token;
    phase = 'tracing'; polys = []; paintFooter();
    setTimeout(async () => {
      try {
        const tracer = await loadTracer();
        if (mine !== token) return;
        const p = params(), img = new ImageData(new Uint8ClampedArray(source.data), fit.w, fit.h);
        if (p.colours === 2) T.maskThreshold(img.data, p.threshold);
        const td = tracer.imagedataToTracedata(img, T.tracerOptions(p));
        polys = T.tracedataToPolys(td, cfg.mmW, cfg.mmH);
        phase = 'ready';
        paintPreview(polys.reduce((s, q) => s + q.length, 0));
      } catch (err) {
        if (mine !== token) return;
        phase = 'error'; polys = [];
        paintPreview(0); paintFooter();
        status.textContent = 'Could not trace this picture (' + (err && err.message ? err.message : err) + ')';
        return;
      }
      paintFooter();
    }, 30);
  }

  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  paintFooter();
  update.focus();
  run();
}
