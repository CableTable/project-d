// Project D — screen A: the sheet, step and repeat, layers. Layout maths is in layout.js (pure).
import { h } from './dom.js';
import * as CB from './cmdbar.js';
import { buildCmdUI } from './cmdui.js';
import * as SC from './shortcuts.js';
import { openShortcuts } from './shortcutdlg.js';
import { idbStore } from './idbstore.js';
import { PRESETS, presetFor, stepRepeat, GRIP_KEYS } from './layout.js';
import { unitFactor, convertedNote, startHidden, entityCount, layerCounts, drawingBoxMm, fitRect, cursorMm, fitsSheet, spaceOf, boxOnSheet, itemVisible, addRecent, closePrompt } from './doc.js';
import * as Ed from './edit.js';
import * as UF from './unitfix.js';
import * as CL from './cleanup.js';
import * as DM from './dims.js';
import * as LR from './leader.js';
import * as BAL from './balloons.js';
import { paintDrawing, ink, FONT_FAMILY } from './render.js';
import { flatten, unionBox, CAP, ACI } from './drawing.js';
import { writeDxf, unwritable, addLayer, newDoc } from './dxf-write.js';
import { cutterDoc } from './dxf-cutter.js';
import * as DR from './draw.js';
import * as TX from './text.js';
import * as GR from './grips.js';
import * as MD from './modify.js';
import * as PR from './props.js';
import { placedMat, placedBox, placement1 } from './apply.js';
import * as LD from './layoutdoc.js';
import * as PL from './place.js';
import * as A from './arrange.js';
import * as G from './guides.js';
import * as CT from './contour.js';
import * as OB from './objects.js';
import * as C from './compare.js';
import * as TK from './track.js';
import { loadParts, savePart, removePart } from './partstore.js';
import { withExt } from './savepath.js';
import * as RC from './recovery.js';
import { openExport } from './export.js';
import { openNest } from './nestdlg.js';
import { outlineOf } from './nestshape.js';
import { partSource } from './pdf-export.js';
import { readPdf, renderPdfPage, isPdf } from './pdf-read.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const shortcutStore = idbStore('project-d-shortcuts', 'settings', 'shortcuts');
let ownBindings = SC.bindings(), ownCommands = SC.commandsFor(ownBindings);
function showShortcuts() {
  ui.cmdUI.close();
  openShortcuts(ownBindings, async (draft) => {
    const overrides = SC.differences(draft);
    if (Object.keys(overrides).length) await shortcutStore.put({ id: 'own', overrides });
    else await shortcutStore.del('own');
    ownBindings = SC.bindings(draft); ownCommands = SC.commandsFor(ownBindings);
    note('Shortcuts saved: aliases + keys apply now');
  });
}

/** An SVG element: s('rect', { x: 1, class: 'a' }, children…). Text goes in as text. */
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

/** One of our own fixed icon strings → an <svg> (parsed, never innerHTML). */
function icon(inner, { size = 20, width = 1.6, cap, join, label, box = 24 } = {}) {
  const attrs = `xmlns="${SVGNS}" width="${size}" height="${size}" viewBox="0 0 ${box} ${box}" fill="none" stroke="currentColor" stroke-width="${width}"` +
    (cap ? ` stroke-linecap="${cap}"` : '') + (join ? ` stroke-linejoin="${join}"` : '') +
    (label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"');
  const doc = new DOMParser().parseFromString(`<svg ${attrs}>${inner}</svg>`, 'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}

// ---- tools (same order and icons as the mock-up) ----
const TOOLS = [
  { id: 'select', label: 'Select', title: 'Select (S)', join: 'round', svg: '<path d="M5 3l13 8-6 1.5L9 19z"/>' },
  { id: 'pan', label: 'Pan', title: 'Pan (middle mouse)', cap: 'round', svg: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>' },
  { sep: true },
  { id: 'line', label: 'Line', title: 'Line (L)', svg: '<path d="M6 18L18 6"/><circle cx="5" cy="19" r="1.8"/><circle cx="19" cy="5" r="1.8"/>' },
  { id: 'polyline', label: 'Polyline', title: 'Polyline (PL)', join: 'round', svg: '<path d="M3 18l5-9 5 6 7-10"/>' },
  { id: 'rect', label: 'Rectangle', title: 'Rectangle (R)', svg: '<rect x="3.5" y="6" width="17" height="12"/>' },
  { id: 'rrect', label: 'Rounded rectangle', title: 'Rounded rectangle', svg: '<rect x="3.5" y="6" width="17" height="12" rx="4"/>' },
  { id: 'circle', label: 'Circle', title: 'Circle (C)', svg: '<circle cx="12" cy="12" r="8"/>' },
  { id: 'ellipse', label: 'Ellipse', title: 'Ellipse (EL)', svg: '<ellipse cx="12" cy="12" rx="9" ry="6"/>' },
  { id: 'arc', label: 'Arc', title: 'Arc (A)', svg: '<path d="M4 17a8.5 8.5 0 0 1 16 0"/>' },
  { id: 'text', label: 'Text', title: 'Text (T)', cap: 'round', svg: '<path d="M5 6h14M12 6v13"/>' },
  { id: 'dimension', label: 'Dimension', title: 'Dimension (D)', cap: 'round', svg: '<path d="M4 8v10M20 8v10M4 13h16M4 13l3-2M4 13l3 2M20 13l-3-2M20 13l-3 2"/>' },
  { id: 'leader', label: 'Leader', title: 'Leader (LE)', cap: 'round', join: 'round', svg: '<path d="M5 19l3.2-6.5M5 19l6-3M8 12.5L12 8h8"/>' },
  { id: 'balloon', label: 'Balloon', title: 'Balloon (B)', cap: 'round', join: 'round', svg: '<circle cx="14.5" cy="9" r="6"/><path d="M13.3 7l1.4-1v6.2M10.2 13.4L4.5 20"/>' },
  { sep: true },
  { id: 'offset', label: 'Offset', title: 'Offset (O)', svg: '<rect x="3" y="3" width="18" height="18" rx="4"/><rect x="7.5" y="7.5" width="9" height="9" rx="1.5"/>' },
  { id: 'contour', label: 'Contour', title: 'Contour (CO)', svg: '<rect x="3" y="3" width="18" height="18" rx="5"/><rect x="6.5" y="6.5" width="11" height="11" rx="3"/><rect x="10" y="10" width="4" height="4" rx="1"/>' },
  { id: 'trim', label: 'Trim', title: 'Trim (TR)', cap: 'round', svg: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8.2 8.5L20 17M8.2 15.5L20 7"/>' },
  { id: 'mirror', label: 'Mirror', title: 'Mirror (MI)', join: 'round', svg: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7L3 17h6zM15 7l6 10h-6z"/>' },
  { sep: true },
  { id: 'step', label: 'Step and repeat', title: 'Step and repeat', svg: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>' },
  { id: 'nest', label: 'Auto-nest', title: 'Auto-nest mixed parts', svg: '<rect x="3" y="3" width="10" height="8" rx="1"/><circle cx="18" cy="7" r="3.5"/><rect x="3" y="14" width="6" height="7" rx="1"/><rect x="11.5" y="14" width="9.5" height="7" rx="1"/>' },
  { id: 'measure', label: 'Measure', title: 'Measure (M)', join: 'round', svg: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>' },
];
const BUILT = new Set(['select', 'pan', 'step', 'measure', 'dimension', 'leader', 'balloon', 'contour', 'text', 'offset', 'trim', 'mirror', 'nest', ...DR.KINDS]);
// the Dimension button's flyout (mock-up R8a, Option A): [type, name, typed command, icon (20 px box), the command line's name]
const DIM_TYPES = [
  ['aligned', 'Aligned', 'D', '<path d="M3 15L13 5M3 15l3-1M3 15l1-3M13 5l-3 1M13 5l1 3"/>', 'DIMALIGNED'],
  ['linear', 'Linear', 'DLI', '<path d="M3 13h14M3 13l3-2M3 13l3 2M17 13l-3-2M17 13l-3 2M3 6v9M17 6v9"/>', 'DIMLINEAR'],
  ['radius', 'Radius', 'DRA', '<circle cx="8" cy="11" r="6"/><path d="M8 11l7-7"/>', 'DIMRADIUS'],
  ['diameter', 'Diameter', 'DDI', '<circle cx="10" cy="10" r="6"/><path d="M5 15L15 5"/>', 'DIMDIAMETER'],
  ['angle', 'Angle', 'DAN', '<path d="M3 16h14M3 16L13 5M9 16a6 6 0 0 0-1.4-3.8"/>', 'DIMANGULAR'],
];
const dimTypeRow = (type) => DIM_TYPES.find((x) => x[0] === type) || DIM_TYPES[0];
const MOD_ALIAS = { o: 'offset', offset: 'offset', tr: 'trim', trim: 'trim', mi: 'mirror', mirror: 'mirror' };       // typed in the command line
const DIM_ALIAS = { dli: 'linear', dra: 'radius', ddi: 'diameter', dan: 'angle' };       // typed in the command line (D is Aligned)

const EYE = '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF = '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><path d="M4 4l16 16"/>';
const LOCK = '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';
// the Arrange, Group and Lock icons (from the R4a / R4b mock-ups)
const ICONS = {
  left: '<path d="M4 3v18"/><rect x="4" y="6" width="14" height="4"/><rect x="4" y="14" width="9" height="4"/>',
  centre: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4"/><rect x="8" y="14" width="8" height="4"/>',
  right: '<path d="M20 3v18"/><rect x="6" y="6" width="14" height="4"/><rect x="11" y="14" width="9" height="4"/>',
  top: '<path d="M3 4h18"/><rect x="6" y="4" width="4" height="14"/><rect x="14" y="4" width="4" height="9"/>',
  middle: '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14"/><rect x="14" y="8" width="4" height="8"/>',
  bottom: '<path d="M3 20h18"/><rect x="6" y="6" width="4" height="14"/><rect x="14" y="11" width="4" height="9"/>',
  horizontal: '<path d="M4 3v18M20 3v18"/><rect x="9.5" y="7" width="5" height="10"/>',
  vertical: '<path d="M3 4h18M3 20h18"/><rect x="7" y="9.5" width="10" height="5"/>',
  group: '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2"/><rect x="6" y="6" width="5" height="5"/><rect x="13" y="12" width="5" height="6"/>',
  ungroup: '<rect x="3" y="3" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/><path d="M14 7h6M17 4v6" stroke-dasharray="2 2"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
};

// ---- state ----
// The sheet and step-and-repeat settings (sheetW, sheetH, the four grippers, crop, reg, gapX, gapY, rotate, align, fit, rows,
// cols, extraRows, extraCols, gridPart: layoutdoc.js DEFAULTS) belong to the layout tab that is open: state.sheetW reads and
// writes that layout's own. A drawing tab has no sheet; it keeps the idle settings, only so a drawing has a frame (0,0 at the
// bottom-left of a 700 mm tall page) to be placed, picked and measured in.
const state = {
  gapSel: null,       // the extra gap being edited { axis: 'r' | 'c', after } (extra gaps [{ after, mm }]: rows from the top, columns from the left)
  tool: 'select', msg: null,             // (sel, below: the selected placed part of the open layout, an index into placedNow; picks: the whole selection when it is several)
  mode: 'select',                        // 'select' (size handles) or 'rotate' (turn arrows and the pivot) for the selected placed part
  pivot: { kind: 'centre', x: 0, y: 0 }, // the turn's pivot: 'centre', 'bl' (the part's own lower-left corner) or 'custom' (x, y: sheet mm, y up)
  rotCopy: false,                        // the command line's Copy: the next typed angle turns a copy
  contourCfg: null,                      // Contour's last values (loaded in init): { dir: 'inside' | 'outside', dist (mm), steps, corners: 'sharp' | 'rounded', live }
  rulers: true,                          // mm rulers along the top and left of the canvas (View → Rulers; remembered on this PC)
  guideDrag: null,                       // a guide being dragged out of a ruler or along the sheet: see gdrag
  nudge: 1, dupAxis: 'x', dupGap: 5, dupCount: 3, arrangeRel: 'selection',   // the arrow-key step (mm, remembered on this PC) and the Duplicate section's last values
  panel: 'main',                         // the right panel: 'main' (Layout / Drawing) or 'library' (Parts library)
  ptab: 'drawing',                       // the right panel's tab: 'drawing' (everything else) or 'objects' (the tree of the open file, mock-up R11a)
  hidden: { parts: false, marks: false, dims: false },
  docs: [], doc: 0,
  snap: true,                      // the SNAP toggle in the status bar (kept for the session)
  ortho: false,                    // the ORTHO toggle: a sticky Shift (picks kept straight along X or Y from the first point)
  polar: { on: true, inc: 15 }, otrack: true,   // the POLAR (increment in degrees) and OTRACK toggles, remembered on this PC (track.js, mock-up R7a)
  trk: { d: null, acq: [], res: null, cand: null, timer: 0 },   // tracking: the tab, the acquired points, the lock under the pointer, the snap point hovered on
  dp: 2,                           // decimal places in dimensions (status bar), remembered on this PC
  meas: null,                      // Measure in progress: { pts: [[x, y] drawing units], hover }
  dimStyles: { presets: {}, cur: 'Standard' },   // the dimension style presets (dims.js; Format → Dimension style…), remembered on this PC (pd-dimstyles); dsOpen: that dialog is open
  dimType: 'aligned',              // the Dimension button's type: aligned, linear, radius, diameter or angle (remembered on this PC)
  dim: null,                       // the Dimension tool in progress: { pts: [[x, y] drawing units], hover, cursor, obj (the circle or arc picked: { c, r }), lines (the lines picked) }
  ldr: null,                       // the Leader tool in progress: { pts: [[x, y] drawing units, up to 3], hover, cursor }
  bal: null,                       // the Balloon tool in progress: { tip: [x, y] mm (the arrow's end, once clicked) | null, hover: [x, y] mm | null }
  balSel: null, balDrag: null,     // the selected balloon's id; a balloon grip being dragged: { id, which ('c' or 'tip'), set (the changed set), moved }
  balDock: { h: 240, collapsed: false, sheet: 'all' },   // the balloons table docked above the command line: its height (px), collapsed, and the sheet it shows
  sidecars: new Map(),             // balloon files picked or dropped in a browser, waiting for their drawing: lower-case name → text
  dimDrag: null,                   // a selected dimension being dragged: { e, name, params, dp, start, offset, moved }
  gapMm: 0.01, gapShow: true,      // Tiny gaps (TODO 46): the tolerance in mm (remembered on this PC) and whether the gaps are marked on the drawing
  setlen: null,                    // Set length in progress: { pts: [[x, y] drawing units], hover, measured (mm) }
  mod: null, modDoc: null, offDist: 10,   // Offset / Trim / Mirror in progress (newMod), its tab, and the Offset distance in mm (remembered)
  draw: null, drawDoc: null,       // the drawing tool in progress (draw.js createTool), and the tab it works on
  drawCfg: { radius: 5 },          // the rounded rectangle's corner radius (mm), remembered on this PC
  drawHover: null,                 // where the pointer is for the drawing tool: [x, y (mm), snap kind]
  grip: null,                      // a grip being dragged: { d, e (the entity), id, ent, next (the changed entity), to, label, hot (click, then click), moved }
  sheetSel: null, sheetDrag: null,   // the layout whose sheet is selected (Sheet resize, TODO 23); a handle being dragged: { side, p0, W, H, newW, newH, hot, moved }
  propsOn: false, match: null,    // View → Properties (remembered on this PC); Match properties in progress: { d, src (the source's index) }
  text: { cfg: null, ed: null, drag: null },   // the Text tool: the next text's height (mm), font, alignment, bold, angle; the editor open (or null); a corner being dragged
};
// The selection on a layout: `sel` is the main selected placed part (an index into placedNow), `picks` the several selected, in the order they
// were picked (empty or one = just `sel`). Setting sel on its own selects that one part only.
let selIdx = 0, picksArr = [];
Object.defineProperty(state, 'sel', { enumerable: true, get: () => selIdx, set: (v) => { selIdx = v; picksArr = []; } });
Object.defineProperty(state, 'picks', { enumerable: true, get: () => picksArr, set: (v) => { picksArr = v; } });
const idleSettings = LD.newSettings();
const curLay = () => { const d = state.docs[state.doc]; return d && d.lay ? d.lay : null; };
for (const k of LD.SETTING_KEYS) Object.defineProperty(state, k, { enumerable: true, get: () => (curLay() ? curLay().s : idleSettings)[k], set: (v) => { (curLay() ? curLay().s : idleSettings)[k] = v; } });
/** A tab with nothing in it yet; its name is the first free "Drawing N". */
function emptyDoc() {
  const names = new Set(state.docs.map((d) => d.name));
  let n = 1;
  while (names.has('Drawing ' + n)) n++;
  let dirty = false;
  return {
    name: 'Drawing ' + n, path: null, empty: true,
    get dirty() { return dirty; },
    // Any edit or successful save permanently retires the untouched placeholder.
    set dirty(value) { dirty = value; this.empty = false; },
  };
}
state.docs.push(emptyDoc());
const view = { scale: 1, ox: -80, oy: -80, fitted: true };
let layout = null;                  // the step-and-repeat grid of the open layout (layout.js stepRepeat; count 0 = none)
let placedNow = [];                 // every placed part of the open layout (layoutdoc.js placedAll): grid copies, then loose ones
const ui = {};
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const note = (text) => { state.msg = text; renderCommand(); };
const fmt = (n) => Number(n).toFixed(2);
const partHid = (p) => { const d = curDoc(); return !!(d && d.hiddenParts && d.hiddenParts.has(p.partId)); };       // hidden in the Objects tab: not drawn, not hit, not selected
let cssCache = null;                // theme colours read from the page once per theme, not at every repaint
const cssVar = (name, fallback) => { const c = cssCache || (cssCache = new Map()); if (!c.has(name)) c.set(name, getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback); return c.get(name); };
const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ } };
const clampSel = () => { if (state.sel >= placedNow.length || (state.sel < 0 && placedNow.length)) state.sel = placedNow.length ? 0 : -1; };
/** The grid of the open layout: its step-and-repeat part laid out by the settings, or an empty grid (count 0). */
const gridNow = () => { const lay = curLay(); return (lay && LD.gridOf(lay)) || stepRepeat({ ...state, partW: 0, partH: 0 }); };
/** Something in the open layout was changed: it has unsaved changes now. */
function touch() { const d = curDoc(); if (d && d.lay && !d.dirty) { d.dirty = true; renderTabs(); } }

// ---- theme ----
function setTheme(mode) {
  const root = document.documentElement;
  cssCache = null;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode; else delete root.dataset.theme;
  try { localStorage.setItem('pd-theme', mode); } catch { /* storage may be blocked */ }
  if (ui.dcanvas && layout) { paintOverlay(); renderLayers(); }
  if (cmpDoc()) update(); // Compare colours and drawing tints are per theme
}
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
};

// ---- building the page ----
/** Marks a number field as refused (red edge, aria-invalid) until it is focused or typed in again. */
function flagInvalid(input, bad) {
  input.classList.toggle('invalid', !!bad);
  if (bad) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}
const clearInvalid = (input) => { input.addEventListener('focus', () => flagInvalid(input, false)); };
const MAX_SHEET = 100000;              // mm: a sheet side above this is refused (1e308 made invalid SVG)
function numField(label, key, opts = {}) {
  const input = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', value: String(state[key]), 'data-key': key });
  // a whole-number field (Rows, Columns) says why a typed value is refused instead of snapping back silently
  const refusal = () => {
    const raw = input.value.trim(), v = Number(raw);
    if (!opts.int) {                      // a sheet side, gripper or gap: kept within what the sheet can hold
      const hi = opts.cap ? opts.cap() : Infinity, lo = Math.max(opts.floor ? opts.floor() : 0, opts.min ?? 0);
      if (raw === '' || !Number.isFinite(v)) return `${label} must be a number in mm: ${lo} ${hi < Infinity ? 'to ' + hi : 'or more'}`;
      if (v > hi) return `${label} can be ${hi} mm at most`;
      if (v < lo) return `${label} must be ${lo} mm or more`;
      return '';
    }
    if (raw === '' || !Number.isFinite(v) || v < (opts.min ?? 0)) return `${label} must be ${opts.min ?? 0} or more${opts.max ? ` (up to ${opts.max})` : ''}`;
    if (opts.max && Math.floor(v) > opts.max) return `${label}: ${Math.floor(v)} will not fit on a sheet (${opts.max} at most)`;
    return '';
  };
  input.addEventListener('input', () => {
    const v = Number(input.value.trim());
    if (!curLay()) return;
    const why = refusal();
    flagInvalid(input, why && input.value.trim() !== '');
    if (why) { if (input.value.trim() !== '') note(why); return; }       // an empty field is only half typed: said when it is left
    if (input.value.trim() === '' || !Number.isFinite(v) || v < (opts.min ?? 0)) return;
    const sized = key === 'sheetW' || key === 'sheetH';
    pushLay(curDoc(), null, sized ? 'sheetsize' : 'set:' + key, sized ? 'Sheet size' : label);
    state[key] = opts.int ? Math.floor(v) : v;
    if (key === 'sheetW' || key === 'sheetH') ui.preset.value = presetFor(state.sheetW, state.sheetH);
    touch(); update();
  });
  input.addEventListener('change', () => {
    const why = curLay() ? refusal() : '';
    if ((key === 'sheetW' || key === 'sheetH') && curLay() && !Number.isInteger(state[key])) { const was = state[key]; state[key] = Math.round(was); touch(); update(); note(`Sheet ${key === 'sheetW' ? 'width' : 'height'} ${was} rounded to whole mm: ${state[key]}`); }
    input.value = String(state[key]); flagInvalid(input, why); if (why) note(why);
  });
  clearInvalid(input);
  ui[key] = input;
  return h('label', { class: 'field' }, label, input);
}

function select(options, value, onchange, attrs = {}) {
  const el = h('select', { class: 'fld', ...attrs }, options.map(([v, text]) => h('option', { value: v }, text)));
  el.value = value;
  el.addEventListener('change', () => onchange(el.value));
  return el;
}

/** W and H of the selected placed part: read-only, because a part is scaled with its drawing (Set length / Width / Height there), not on the layout. */
function propField(label, id, cls = '') {
  const input = h('input', { class: 'fld ' + cls, readonly: true, 'data-testid': id, title: 'Read-only: parts are scaled per drawing (Width / Height or Set length on the drawing tab), not on the layout', 'aria-label': label });
  ui[id] = input;
  return h('label', { class: 'lbl inline' }, label, input);
}

// ---- number fields of the selected placed part (top bar and right panel): shown from the part, applied on Enter or leaving the field ----
const placedFields = [];            // [{ input, show (→ text), enabled (→ bool) }]
/**
 * A text field kept in step with the selected placed part. apply(text) returns '' when it took the value, else what is wrong
 * (said in the command line); the field then shows the part's value again.
 */
function pfield(attrs, show, apply, enabled = () => true) {
  const input = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', ...attrs });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { input.value = show(); input.blur(); }
  });
  input.addEventListener('change', () => { const why = apply(input.value); input.value = show(); flagInvalid(input, why); if (why) note(why); });
  clearInvalid(input);
  placedFields.push({ input, show, enabled });
  return input;
}
const labelled = (text, input, cls = 'lbl inline') => h('label', { class: cls }, text, input);

/** The File menu's Recent files: numbered names, the full path as the tooltip (none in a browser, which gives no paths). */
function recentItems() {
  const t = window.__TAURI__;
  if (!t || !t.fs || !t.fs.readFile) return [];
  const list = recentList();
  if (!list.length) return [['Recent files: none yet', () => {}, null, () => false, null, true]];
  return list.map((p, i) => [`${i + 1}  ${p.split(/[\\/]/).pop()}`, () => openPath(p), null, null, p, i === 0]);
}

function buildMenus() {
  // an item: [text, action, shortcut hint (shown, and only a hint for a key that is really bound), enabled? (a function, asked when the menu opens)]
  const menus = {
    File: () => [['Open…', openFile], ['New layout', newLayoutTab], ['Save', () => save(false), 'Ctrl+S'], ['Save As…', () => save(true), 'Ctrl+Shift+S'], ['Export for cutter…', exportCutter], ['Compare two drawings…', cmpStart], ['Import background…', () => ui.bgPicker.click()], ['PDF / Print…', exportPdf],
      ...recentItems()],
    Edit: [['Undo', () => { const d = editable(); if (d) undo(d); else undoLay(); }, 'Ctrl+Z', () => { const d = editable(); return d ? d.hist.canUndo : !!curLay() && layHist(curDoc()).canUndo; }],
      ['Redo', () => { const d = editable(); if (d) redo(d); else redoLay(); }, 'Ctrl+Y', () => { const d = editable(); return d ? d.hist.canRedo : !!curLay() && layHist(curDoc()).canRedo; }],
      ['Undo history…', showHistory, null, () => !!historyOf(curDoc())],
      ['Select all', selectAll, 'Ctrl+A', () => !!editable() || !!curLay()],
      ['Delete', () => (curLay() ? deletePlaced() : deleteSelection()), 'Del', () => { const d = editable(); return d ? d.sel.size > 0 : !!selectedPlaced(); }]],
    View: () => {
      const lay = curLay(), tick = (on, text) => (on ? '✓ ' : '  ') + text;
      return [['Fit to window', fit, 'Ctrl+0'], [tick(state.propsOn, 'Properties'), toggleProps, 'Ctrl+1'], [tick(state.rulers, 'Rulers'), () => setRulers(!state.rulers)],
        [tick(!!lay && lay.s.guidesShow, 'Guides'), () => setGuidesShow(!curLay().s.guidesShow), null, () => !!curLay()],
        [tick(!!lay && lay.s.guidesLock, 'Lock guides'), () => setGuidesLock(!curLay().s.guidesLock), null, () => !!curLay()],
        ['Clear all guides', clearGuides, null, () => !!curLay() && curLay().s.guides.length > 0],
        ['Theme: follow system', () => setTheme('system'), null, null, null, true], ['Theme: light', () => setTheme('light')], ['Theme: dark', () => setTheme('dark')]];
    },
  };
  menus.Draw = [['Line', 'line', 'L'], ['Polyline', 'polyline', 'P'], ['Rectangle', 'rect', 'R'], ['Rounded rectangle', 'rrect', 'RR'], ['Circle', 'circle', 'C'],
    ['Ellipse', 'ellipse', 'E'], ['Arc', 'arc', 'A'], ['Text', 'text', 'T']].map(([text, id, key]) => [text, () => setTool(id), key, () => !curLay()]);
  menus.Modify = [['Offset', 'offset', 'O'], ['Trim', 'trim', 'TR'], ['Mirror', 'mirror', 'MI']].map(([text, id, key]) => [text, () => setTool(id), key, () => !curLay()]);
  menus.Format = [['Dimension style…', showDimStyle]];
  menus.Tools = [['Preflight…', showPreflight, 'Drawing checks'], ['Shortcuts…', showShortcuts, 'Aliases + keys']];
  menus.Layout = [['New layout', newLayoutTab], ['Add to layout', addToLayout], ['Parts library', () => showLibrary()], ['Extract part…', () => extractPart()],
    ['Duplicate part', duplicateOne, 'Ctrl+D', () => !!selectedPlaced()], ['Mirror X', () => mirrorSel('x'), null, () => !!selectedPlaced()], ['Mirror Y', () => mirrorSel('y'), null, () => !!selectedPlaced()],
    ['Group', groupSel, 'Ctrl+G', () => selIdxs().length > 1 && !wholeGroup()], ['Ungroup', ungroupSel, 'Ctrl+Shift+G', () => selItems().some((x) => x.p.g)],
    ['Lock', () => lockSel(true), null, () => selItems().some((x) => !x.p.lock)], ['Unlock', () => lockSel(false), null, () => selItems().some((x) => x.p.lock)]];
  const drop = h('div', { class: 'dropdown', hidden: true, role: 'menu' });
  ui.dropdown = drop;
  const close = () => { drop.hidden = true; ui.menuBtns.forEach((b) => b.classList.remove('open')); };
  ui.menuBtns = ['File', 'Edit', 'View', 'Draw', 'Modify', 'Format', 'Layout', 'Tools', 'Help'].map((name) => {
    const unbuilt = !menus[name];
    const b = h('button', { class: 'menu' + (unbuilt ? ' off' : ''), type: 'button', 'data-menu': name, title: unbuilt ? 'Not built yet' : null, 'aria-disabled': unbuilt ? 'true' : null }, name);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const was = b.classList.contains('open');
      close();
      if (was || unbuilt) return;
      const items = typeof menus[name] === 'function' ? menus[name]() : menus[name];
      drop.replaceChildren(...items.map(([text, fn, hint, enabled, title, sep]) => {
        const bound = CB.COMMANDS.find((c) => c.key === hint && hint);
        if (bound) hint = ownBindings[bound.name].key;
        const item = h('button', { type: 'button', role: 'menuitem', class: sep ? 'sep' : null, title: title || null, disabled: enabled ? !enabled() : false, 'aria-keyshortcuts': hint || null }, text, hint ? h('span', { class: 'hint', 'aria-hidden': 'true' }, hint) : null);
        item.addEventListener('click', () => { close(); fn(); });
        return item;
      }));
      drop.style.left = b.offsetLeft + 'px';
      drop.hidden = false;
      b.classList.add('open');
    });
    return b;
  });
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return h('div', { class: 'menubar' }, h('strong', null, 'Project D'), ui.menuBtns, drop);
}

function buildTabs() {
  ui.tabs = h('div', { class: 'tabs' });
  const modeBtns = [['2D drawing', true], ['3D viewer', false]].map(([text, on]) => {
    const b = h('button', { class: 'seg' + (on ? ' on' : ' off'), type: 'button', title: on ? null : 'Not built yet', 'aria-disabled': on ? null : 'true' }, text);
    if (!on) b.addEventListener('click', () => note('3D viewer: not built yet'));
    return b;
  });
  return h('div', { class: 'tabsrow' },
    ui.tabs, h('div', { class: 'spacer' }),
    h('div', { class: 'rowtools' },
      h('div', { class: 'mode', role: 'group', 'aria-label': 'Mode' }, modeBtns),
      h('button', { class: 'btn', type: 'button', 'data-testid': 'open', onclick: openFile }, 'Open'),
      h('button', { class: 'btn', type: 'button', 'data-testid': 'save', title: 'Save (Ctrl+S)', onclick: () => save(false) }, 'Save'),
      h('button', { class: 'btn primary', type: 'button', 'data-testid': 'pdf-open', onclick: exportPdf }, 'PDF / Print')));
}

/** What the view is fitted to: the drawing and the background together (mm, y up), or null. */
const viewBox = (d) => (d ? (d.bg ? unionBox(d.box, Ed.bgBox(d.bg)) : d.box) : null);
/** A drawing tab with something to look at: shown on its own (no sheet), to prepare parts from. */
const partView = (d) => !!(d && !d.lay && d.raw && viewBox(d));
/** A layout tab or a drawing tab: what the panels, the property bar and the tools show follows it. */
let wasLayout = null;
function applyKind() {
  const d = curDoc(), lay = !!(d && d.lay), lib = state.panel === 'library';
  ui.canvas.classList.toggle('part', !lay);
  for (const sec of [ui.sheetSec, ui.partsSec, ui.stepSec, ui.stepFoot, ui.gapSec]) sec.hidden = !lay || lib;
  ui.layersSec.hidden = lib || !!(d && d.cmp); ui.libSec.hidden = !lib;
  ui.propbar.hidden = !lay;
  ui.panelMain.textContent = lay ? 'Layout' : d && d.cmp ? 'Compare' : 'Drawing';
  ui.panelMain.classList.toggle('on', !lib); ui.panelLib.classList.toggle('on', lib);
  ui.panelMain.setAttribute('aria-pressed', String(!lib)); ui.panelLib.setAttribute('aria-pressed', String(lib));
  if (lay && (state.tool === 'measure' || state.tool === 'dimension' || state.tool === 'leader' || state.tool === 'balloon' || state.tool === 'contour' || DR.KINDS.includes(state.tool) || state.tool === 'text')) setTool('step');
  else if (!lay && state.tool === 'step') setTool('select');
  else if (lay && wasLayout === false && state.tool === 'select') setTool('step');
  wasLayout = lay;
}

const GRID_ICON = TOOLS.find((t) => t.id === 'step').svg;
function renderTabs() {
  ui.tabs.replaceChildren(
    ...state.docs.map((d, i) => {
      const x = h('span', { class: 'x', 'aria-label': 'Close ' + d.name, role: 'button' }, '×');
      x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(d); });
      const b = h('button', { class: 'dtab' + (i === state.doc ? ' on' : ''), type: 'button', 'data-kind': d.lay ? 'layout' : 'drawing' },
        d.lay && icon(GRID_ICON, { size: 14 }), h('span', { class: 'tname' }, d.name),
        d.dirty && h('span', { class: 'dot', title: 'Not saved yet' }, ' •'), x);
      b.addEventListener('click', () => { state.doc = i; showDoc(); });
      return b;
    }),
    h('button', { class: 'dtab', type: 'button', 'aria-label': 'New drawing', 'data-testid': 'new-tab', onclick: () => addTab(emptyDoc()) }, '+'),
    h('button', { class: 'dtab', type: 'button', 'aria-label': 'New layout', 'data-testid': 'new-layout', onclick: newLayoutTab }, '+ New layout'));
  const on = ui.tabs.querySelector('.dtab.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ---- closing the window with unsaved tabs: Save / Don't save / Cancel (the exe's close request, a browser's beforeunload; F5 and Ctrl+R are off in the exe) ----
const dirtyDocs = () => state.docs.filter((d) => d.dirty);
let closeAsk = null, closing = false;
/** The close prompt over the page → 'save' | 'discard' | 'cancel' (Esc and a click outside are Cancel). */
function askSaveChanges(dirty) {
  return new Promise((resolve) => {
    const words = closePrompt(dirty.map((d) => d.name));
    const done = (answer) => { document.removeEventListener('keydown', onKey, true); back.remove(); closeAsk = null; resolve(answer); };
    const btn = (label, answer, testid, cls = 'btn') => { const b = h('button', { class: cls, type: 'button', 'data-testid': testid }, label); b.addEventListener('click', () => done(answer)); return b; };
    const save = btn('Save', 'save', 'close-save', 'btn primary');
    const dlg = h('div', { class: 'pop-dialog', role: 'alertdialog', 'aria-label': words.title, 'data-testid': 'close-dialog' },
      h('strong', null, words.title),
      words.names.length ? h('div', { class: 'lbl' }, words.names.map((n) => h('div', null, n))) : null,
      h('span', { class: 'lbl' }, "Your changes are lost if you don't save them."),
      h('div', { class: 'row end' }, btn('Cancel', 'cancel', 'close-cancel'), btn("Don't save", 'discard', 'close-discard'), save));
    const back = h('div', { class: 'pop-back', 'data-testid': 'close-back' }, dlg);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('cancel'); } };
    back.addEventListener('pointerdown', (e) => { if (e.target === back) done('cancel'); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    closeAsk = back;
    save.focus();
  });
}
/** May the window close? Asks when a tab has unsaved changes; Save goes through the usual Save for each (a cancelled Save dialog keeps the window open). */
async function mayClose() {
  const dirty = dirtyDocs();
  if (!dirty.length) { await dropCopiesNow(state.docs); return true; }
  if (closeAsk || closing) return false;                             // already asking, or saving after a Save
  const answer = await askSaveChanges(dirty);
  if (answer === 'cancel') return false;
  if (answer === 'discard') { await dropCopiesNow(state.docs); return true; }   // a clean close: no recovery offer next start
  closing = true;
  try {
  for (const d of dirty) {
    const i = state.docs.indexOf(d);
    if (i < 0) continue;
    state.doc = i; showDoc();
    await save();
    if (d.dirty) return false;                                       // the Save dialog was cancelled, or Save failed (it said why)
  }
  } finally { closing = false; }
  await dropCopiesNow(state.docs);                                   // the window closes at once: wait for the deletes
  return true;
}
/** Wires the window's close (the exe) and a page unload (a browser) to mayClose. */
function guardClose() {
  const t = window.__TAURI__, w = t && t.window && t.window.getCurrentWindow ? t.window.getCurrentWindow() : null;
  if (w && w.onCloseRequested) w.onCloseRequested(async (event) => { event.preventDefault(); if (await mayClose()) await w.destroy(); });
  window.addEventListener('beforeunload', (e) => { if (dirtyDocs().length) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('keydown', (e) => {                      // in the exe a reload would drop every tab with no question
    const reload = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'r');
    if (reload && window.__TAURI__ && dirtyDocs().length) { e.preventDefault(); note('Reload is off while a drawing has unsaved changes. Save it first'); }
  }, true);
}

async function closeTab(d) {
  if (d.dirty && !(await confirmAsk(d.name + ' has changes that are not saved. Close it anyway?', 'Close without saving', 'warning', 'Keep it open'))) return;
  const i = state.docs.indexOf(d);
  if (i < 0) return;
  dropCopy(d);
  state.docs.splice(i, 1);
  if (!state.docs.length) { state.docs.push(emptyDoc()); view.fitted = true; }         // the fresh empty tab is fitted
  state.doc = Math.min(state.doc > i ? state.doc - 1 : state.doc, state.docs.length - 1);
  showDoc();
}

const curDoc = () => state.docs[state.doc];

/** The active tab changed: its drawing, layers and status, and Fit if the view is still fitted. */
function showDoc() {
  state.sel = -1;                         // the layout selection belongs to the tab it was made on (the setter clears the picks; clampSel picks part 0)
  state.gapSel = null; gapSig = ''; hideMenu();
  state.mode = 'select'; state.pivot = centrePivot(); state.rotCopy = false; pdrag = null;
  state.setlen = null; state.grip = null; trackClear(); if (state.mod && state.modDoc !== curDoc()) { state.mod = newMod(state.mod.kind); state.modDoc = curDoc(); } if (state.draw && state.drawDoc !== curDoc()) { state.draw = DR.createTool(state.draw.kind, state.drawCfg); state.drawDoc = curDoc(); state.drawHover = null; } state.meas = state.tool === 'measure' ? { pts: [], hover: null } : null; state.dim = state.tool === 'dimension' ? newDim() : null; state.ldr = state.tool === 'leader' ? newLdr() : null; state.bal = state.tool === 'balloon' ? { tip: null, hover: null } : null; state.balDrag = null; state.dimDrag = null; hideRubber();
  syncFields(); renderTabs(); applyKind(); update();
  if (view.fitted) fit(); else applyView();
}

/** Reads a .dxf off the page's thread (dxf-worker.js); on the page itself if no worker. */
function readInWorker(bytes) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker('dxf-worker.js', { type: 'module' }); } catch (e) { reject(e); return; }
    w.onmessage = (e) => { w.terminate(); resolve(e.data); };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'worker failed')); };
    w.postMessage({ bytes }, [bytes]);
  });
}
async function readDrawing(bytes) {
  try { return await readInWorker(bytes.slice(0)); } catch (err) {
    console.warn('DXF: no worker, reading on the page:', err);
    const D = await import('./drawing.js');
    try { const doc = D.readDxf(D.decodeDxf(bytes)); return { ok: true, result: D.flatten(doc), doc }; } catch (e) {
      return e instanceof D.DrawingError ? { ok: false, sorry: e.message } : { ok: false, error: String(e && e.message || e) };
    }
  }
}

/** What a tab holds for a drawing: the DXF document (to save and to copy as a part), what is drawn, its layers and size. */
function tabFields(raw, fl) {
  const factor = unitFactor(fl.units);
  return { raw, fl, factor, off: startHidden(fl), counts: layerCounts(raw, fl), entities: entityCount(raw, fl), conv: convertedNote(fl.units), box: drawingBoxMm(fl, factor) };
}

function addTab(d, replaceEmpty = true) {
  if (d.path) rememberRecent(d.path);
  if (d.raw) { d.hist = Ed.createHistory(); d.sel = new Set(); d.hl = []; d.ed = null; warm(d); }
  const cur = curDoc();
  if (replaceEmpty && cur && cur.empty && !cur.dirty && !d.empty) state.docs[state.doc] = d;      // an untouched empty tab is used up
  else { state.docs.push(d); state.doc = state.docs.length - 1; }
  view.fitted = true;
  showDoc();
}

const pathKey = (p) => String(p).replace(/\//g, '\\').toLowerCase();       // one file, however its slashes and capitals are written
/** Opens a file's bytes as a new tab (path: where it lives on disk, in the app). */
async function openBytes(name, buf, path = null) {
  // the same file already open (in the app, where files have paths): show its tab, never a second copy
  const same = path ? state.docs.findIndex((d) => d.path && pathKey(d.path) === pathKey(path)) : -1;
  if (same >= 0) {
    state.doc = same; showDoc(); rememberRecent(path);
    note(`${name} is already open: here is its tab` + (state.docs[same].dirty ? ' (with unsaved changes)' : ''));
    return;
  }
  if (/\.pdf$/i.test(name) || (!/\.dxf$/i.test(name) && buf.byteLength && isPdf(buf instanceof ArrayBuffer ? buf : buf.buffer))) { await openPdf(name, buf, path); return; }
  if (!/\.dxf$/i.test(name)) { note(/\.dwg$/i.test(name) ? 'DWG: not built yet (save it as DXF for now)' : name + ': Opens DXF or PDF; pictures go in as a background (Background…)'); return; }
  note('Reading ' + name + '…');
  const r = await readDrawing(buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if (!r.ok) { note(name + ': ' + (r.sorry || 'could not read this drawing' + (r.error ? ' (' + r.error + ')' : ''))); return; }
  const fl = r.result;
  if (!fl.items.length) { note(name + ': this drawing is empty'); return; }
  const lay = LD.layoutFromRaw(r.doc, name);
  if (lay) { openLayoutFile(lay, name, path); return; }              // one of our saved layouts: it opens as a layout tab
  const doc = { name, path, openPath: path, dirty: false, ...tabFields(r.doc, fl) };       // openPath: the file itself, which Save never writes over
  addTab(doc);
  note(`Opened ${name}: ${doc.entities} entities` + (doc.conv ? ', ' + doc.conv : '') +
    (fitsSheet(doc.box, state.sheetW, state.sheetH) ? '' : ' (larger than the sheet)'));
  await balLoad(doc, path, name);
}


/** A PDF as a drawing: its vector lines and arcs, its text; page 1, in mm. No vector lines: offer the page as a background picture instead. */
async function openPdf(name, buf, path = null) {
  note('Reading ' + name + '…');
  const bytes = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let r;
  try { r = await readPdf(new Uint8Array(bytes.slice(0))); } catch (err) { note(name + ': could not read this PDF (' + (err && err.message ? err.message : err) + ')'); return; }
  if (!r.paths) {
    const yes = await confirmAsk(name + ' has no vector lines, only a picture (or text). Use it as a background picture instead?', 'Use as background');
    if (yes) await importBackgroundPdf(name, bytes, true, path);
    else note(name + ': no vector lines to open');
    return;
  }
  const raw = r.doc, fl = flatten(raw);
  const base = name.replace(/\.[^.\\/]*$/, ''), dxfName = base + '.dxf';
  const doc = { name: dxfName, path: null, dirty: false, fromPdf: name, pdf: { name, bytes, pages: r.pages, page: r.page, orig: raw.entities, origBlocks: raw.blocks }, ...tabFields(raw, fl) };
  addTab(doc);
  note(`Opened ${name} as a drawing (page ${r.page} of ${r.pages}): ${raw.entities.length} entities, ${r.texts} texts, ${fmtSize(r.mm[0])} × ${fmtSize(r.mm[1])} mm. Not saved yet: Save writes ${dxfName}` + (fl.truncated ? '. Too big to show all of it' : ''));
  await balLoad(doc, path, name);
}
/** Asks a yes / no question (the native dialog in the app, confirm() in a browser). */
/** Asks a yes / no question (the native dialog in the app, confirm() in a browser). */
async function confirmAsk(text, okLabel, kind = 'info', cancelLabel = 'No') {
  const t = window.__TAURI__;
  if (t && t.dialog && t.dialog.ask) { try { return await t.dialog.ask(text, { title: 'Project D', kind, okLabel, cancelLabel }); } catch { return false; } }
  return window.confirm(text);
}

async function openFile() {
  const t = window.__TAURI__;
  if (!t || !t.dialog || !t.dialog.open) { ui.picker.value = ''; ui.picker.click(); return; }
  try {
    const picked = await t.dialog.open({ multiple: false, filters: [{ name: 'Drawings', extensions: ['dxf', 'dwg', 'pdf'] }] });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) return;
    const name = String(path).split(/[\\/]/).pop();
    if (!/\.(dxf|pdf)$/i.test(name)) { await openBytes(name, new ArrayBuffer(0)); return; }
    const bytes = await t.fs.readFile(path);
    await openBytes(name, bytes, String(path));
  } catch (err) {
    note('Open failed: ' + (err && err.message ? err.message : err));
  }
}

// ---- Recent files (in the app only: a browser gives no paths), kept in localStorage, newest first ----
function recentList() {
  try { const v = JSON.parse(localStorage.getItem('pd-recent') || '[]'); return Array.isArray(v) ? v.filter((p) => typeof p === 'string') : []; } catch { return []; }
}
function rememberRecent(path) {
  try { localStorage.setItem('pd-recent', JSON.stringify(addRecent(recentList(), String(path)))); } catch { /* storage may be blocked */ }
}
function forgetRecent(path) {
  try { localStorage.setItem('pd-recent', JSON.stringify(recentList().filter((p) => p !== path))); } catch { /* storage may be blocked */ }
}
/** Opens a file by its path (a Recent files entry); one that is gone comes off the list. */
async function openPath(path) {
  const t = window.__TAURI__, name = path.split(/[\\/]/).pop();
  if (!t || !t.fs || !t.fs.readFile) return;
  let bytes;
  try { bytes = await t.fs.readFile(path); } catch { forgetRecent(path); note(name + ': not found (moved or deleted), so it is off Recent files'); return; }
  await openBytes(name, bytes, path);
}

/** A file from the browser's own picker or a drop. */
async function openPicked(file) {
  try {
    if (BAL.isSidecar(file.name)) { balPicked(file.name, await file.text()); return; }
    await openBytes(file.name, await file.arrayBuffer());
  } catch (err) { note('Open failed: ' + (err && err.message ? err.message : err)); }
}

/** A pointer position on the page → the sheet in mm, y up (the open layout's sheet). */
function sheetAt(clientX, clientY) {
  const r = ui.canvas.getBoundingClientRect();
  return [view.ox + (clientX - r.left) / view.scale, state.sheetH - (view.oy + (clientY - r.top) / view.scale)];
}
const PART_TYPE = 'application/x-pd-part';
function attachDrop() {
  const over = (e) => {
    const types = e.dataTransfer ? [...e.dataTransfer.types] : [];
    if (types.includes('Files')) { e.preventDefault(); ui.canvas.classList.add('dropping'); }
    else if (types.includes(PART_TYPE)) {                                                    // a part from the library
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      const r = ui.canvas.getBoundingClientRect(), inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      ui.canvas.classList.toggle('dropping', inside);
      ui.dropHint.hidden = !inside || !curLay();
      if (inside && curLay()) {
        const [x, y] = sheetAt(e.clientX, e.clientY);
        ui.dropHint.textContent = `Drop to place at X ${fmt(x)} Y ${fmt(y)} mm`;
        ui.dropHint.style.left = Math.min(r.width - 230, e.clientX - r.left + 14) + 'px'; ui.dropHint.style.top = Math.max(4, e.clientY - r.top - 34) + 'px';
      }
    }
  };
  window.addEventListener('dragover', over);
  window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) { ui.canvas.classList.remove('dropping'); ui.dropHint.hidden = true; } });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer) return;
    ui.dropHint.hidden = true;
    const id = e.dataTransfer.getData(PART_TYPE);
    if (id) {
      e.preventDefault();
      ui.canvas.classList.remove('dropping');
      const rec = lib.items.find((r) => r.id === id), r = ui.canvas.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (rec && inside) addLibToSheet(rec, curLay() ? sheetAt(e.clientX, e.clientY) : undefined);
      return;
    }
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    ui.canvas.classList.remove('dropping');
    for (const f of balFirst([...e.dataTransfer.files])) await openPicked(f);
  });
}

/**
 * On a layout tab: the selected placed part with its place and turn on the sheet. X, Y (the lower-left of the part's box) and Angle are
 * typed; W and H are read-only. Mirror X / Mirror Y, and the Nudge step the arrow keys use.
 */
function buildPropbar() {
  ui.partName = h('span', { class: 'name', 'data-testid': 'placed-name' });
  ui.partKind = h('span', { class: 'lbl', 'data-testid': 'placed-kind' }, 'placed part');
  ui.partFrom = h('span', { class: 'lbl', 'data-testid': 'parts-from' });
  const xyTitle = (a) => `${a}: where the lower-left of the part's box is on the sheet, in mm (y up). Type a value and press Enter`;
  ui.px = pfield({ 'data-lockable': '1', 'data-testid': 'px', 'aria-label': 'X', title: xyTitle('X') }, () => showBox(0), (t) => setBoxPos('x', t));
  ui.py = pfield({ 'data-lockable': '1', 'data-testid': 'py', 'aria-label': 'Y', title: xyTitle('Y') }, () => showBox(1), (t) => setBoxPos('y', t));
  ui.pa = pfield({ 'data-lockable': '1', 'data-testid': 'pa', 'aria-label': 'Angle', title: 'Angle in degrees, anticlockwise. The part turns about its pivot (the centre unless you moved it). Type a value and press Enter' }, showAngle, setAngleText);
  ui.barNudge = pfield({ 'data-testid': 'nudge-step', 'aria-label': 'Nudge step in mm', title: 'How far an arrow key moves the part, in mm (Shift + arrow: 10 times this)' }, showNudge, setNudgeText);
  const mirror = (axis, id) => h('button', { class: 'btn sm', type: 'button', 'data-testid': id, title: axis === 'x' ? 'Mirror X: flip the part left to right about its centre' : 'Mirror Y: flip the part top to bottom about its centre', onclick: () => mirrorSel(axis) }, axis === 'x' ? 'Mirror X' : 'Mirror Y');
  const gbtn = (id, onclick) => { const b = h('button', { class: 'btn sm gbtn', type: 'button', 'data-testid': id, onclick }); ui[id] = b; return b; };
  ui.lockChip = h('span', { class: 'chip lockchip', hidden: true, 'data-testid': 'lock-chip' }, icon(ICONS.lock, { size: 12, width: 1.8, cap: 'round', join: 'round' }), 'Locked');
  ui.pfields = h('span', { class: 'pfields' }, labelled('X', ui.px), labelled('Y', ui.py), propField('W', 'pw'), propField('H', 'ph'), labelled('Angle', ui.pa),
    mirror('x', 'bar-mirror-x'), mirror('y', 'bar-mirror-y'), labelled('Nudge', ui.barNudge, 'lbl inline barnudge'),
    h('span', { class: 'vsep', 'aria-hidden': 'true' }), gbtn('bar-group', () => (wholeGroup() ? ungroupSel() : groupSel())), gbtn('bar-lock', () => lockSel(!selItems().every((x) => x.p.lock))));
  ui.partOrigin = h('span', { class: 'lbl origin', 'data-testid': 'sheet-origin' });
  return ui.propbar = h('div', { class: 'propbar', 'data-testid': 'propbar' }, ui.partName, ui.lockChip, ui.partKind, ui.pfields, ui.partFrom, ui.partOrigin, h('span', { class: 'lbl unit' }, 'mm'));
}
/** On a drawing tab with something selected: what it is, its size, Keep only and Extract part…. */
function buildSelbar() {
  const ro = (label, id) => { const input = h('input', { class: 'fld', readonly: true, 'data-testid': id, 'aria-label': label }); ui[id] = input; return h('label', { class: 'lbl inline' }, label, input); };
  ui.selName = h('span', { class: 'name', 'data-testid': 'sel-name' });
  ui.selLayer = h('span', { class: 'lbl', 'data-testid': 'sel-layer' });
  return ui.selbar = h('div', { class: 'propbar selbar', hidden: true, 'data-testid': 'selbar' },
    ui.selName, ui.selLayer, h('span', { class: 'lbl sizelbl', title: 'The size of what is selected (the panel on the right has the whole drawing)' }, 'Selection'), ro('W', 'sel-w'), ro('H', 'sel-h'),
    ui.selContour = h('span', { class: 'lbl ctlabel', hidden: true, 'data-testid': 'sel-contour' }),
    ui.selArea = h('span', { class: 'lbl area', 'data-testid': 'sel-area', title: 'Area of the closed outlines (holes taken off) and the length of every line and arc selected' }),
    ui.barKeep = h('button', { class: 'btn', type: 'button', 'data-testid': 'bar-keep', onclick: keepSelection }, 'Keep only'),
    ui.barExtract = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'bar-extract', onclick: extractPart }, 'Extract part…'),
    h('span', { class: 'lbl unit' }, 'mm'));
}

function buildRail() {
  ui.toolBtns = {};
  const items = TOOLS.map((t) => {
    if (t.sep) return h('div', { class: 'sep', 'aria-hidden': 'true' });
    const off = !BUILT.has(t.id);                                  // not built yet: greyed, with its name in the tooltip, and a click only says so
    const b = h('button', { class: 'tool' + (off ? ' off' : ''), type: 'button', 'aria-label': t.label, title: off ? t.label + ' · Not built yet' : t.title, 'aria-disabled': off ? 'true' : null, 'data-tool': t.id }, icon(t.svg, { cap: t.cap, join: t.join }));
    b.addEventListener('click', () => { if (off) note(t.label + ': not built yet'); else if (t.id === 'nest') openNestDialog(); else if (!b.dataset.held) setTool(t.id); delete b.dataset.held; });
    ui.toolBtns[t.id] = b;
    if (t.id === 'dimension') dimButton(b);
    return b;
  });
  return h('nav', { class: 'rail', 'aria-label': 'Tools' }, items);
}
/** The Dimension button: shows the type last used, with a corner triangle (or press and hold) that opens the flyout of types. */
function dimButton(b) {
  const open = () => {
    const r = b.getBoundingClientRect();
    popMenu(r.right + 4, r.top, DIM_TYPES.map(([type, name, cmd, svg]) => [name, () => setDimType(type), cmd, null, svg]));
  };
  let hold = 0;
  b.addEventListener('pointerdown', (e) => { if (e.button === 0) hold = setTimeout(() => { hold = 0; b.dataset.held = '1'; open(); }, 450); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { clearTimeout(hold); hold = 0; });
  b.addEventListener('click', (e) => { if (e.target.closest('.flyout')) { e.stopPropagation(); open(); } }, true);
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); open(); });
  paintDimButton();
}
function paintDimButton() {
  const b = ui.toolBtns.dimension, [, name, cmd, svg] = dimTypeRow(state.dimType), t = TOOLS.find((x) => x.id === 'dimension');
  b.replaceChildren(state.dimType === 'aligned' ? icon(t.svg, { cap: t.cap }) : icon(svg, { box: 20, cap: 'round', join: 'round' }), h('span', { class: 'flyout', 'data-testid': 'dim-flyout', title: 'Dimension types' }, icon('<path d="M7 0v7H0z" fill="currentColor" stroke="none"/>', { size: 7, box: 7 })));
  b.title = state.dimType === 'aligned' ? t.title : `Dimension · ${name} (${cmd})`;
  b.setAttribute('aria-label', 'Dimension');
}
/** A type picked in the flyout, or typed (DLI, DRA, DDI, DAN): remembered, and the Dimension tool starts with it. */
function setDimType(type) {
  state.dimType = type;
  try { localStorage.setItem('pd-dimtype', type); } catch { /* ignore */ }
  paintDimButton();
  setTool('dimension');
}

function setTool(id) {
  if (id === 'balloon' && !editable()) { note('Balloons work on a drawing tab (a PDF or a picture too): open one first'); return; }
  if (id === 'contour' && !editable()) { note('Contour works on a drawing tab: open a drawing and pick a closed outline'); return; }
  if (MOD_KINDS.includes(id) && !editable()) { note(TOOLS.find((x) => x.id === id).label + ' works on a drawing tab: open a drawing first'); return; }
  if (state.text.ed && id !== 'text') textCommit();
  state.text.drag = null; state.grip = null; trackClear();
  if (state.match && id !== 'select') state.match = null;
  const drawId = DR.KINDS.includes(id) || id === 'text';
  if (drawId && !drawTarget()) { note('Drawing tools work on a drawing tab'); return; }
  if (state.draw && DR.toolBusy(state.draw) && drawId) drawApply(DR.toolFinish(state.draw));      // a line or polyline in progress ends (and keeps what it has)
  if (id === 'step' && !curLay()) { note('Step and repeat is on a layout tab: New layout, or Add to layout'); return; }
  state.tool = id;
  for (const [k, b] of Object.entries(ui.toolBtns)) b.classList.toggle('on', k === id);
  ui.canvas.classList.toggle('pan', id === 'pan');

  const t = TOOLS.find((x) => x.id === id);
  if (ui.toolChip) ui.toolChip.textContent = 'Tool: ' + t.label;
  state.msg = BUILT.has(id) ? null : t.label + ': not built yet';
  if (id === 'pan') state.msg = 'Drag to pan';
  state.meas = id === 'measure' ? { pts: [], hover: null } : null;
  if (ui.textHint) ui.textHint.hidden = id !== 'text';
  state.draw = DR.KINDS.includes(id) ? DR.createTool(id, state.drawCfg) : null; state.drawDoc = state.draw ? curDoc() : null; state.drawHover = null;
  state.mod = MOD_KINDS.includes(id) ? newMod(id) : null; state.modDoc = state.mod ? curDoc() : null;
  if (state.mod) modStart(id);
  state.dim = id === 'dimension' ? newDim() : null; state.dimDrag = null; state.ldr = id === 'leader' ? newLdr() : null; state.bal = id === 'balloon' ? { tip: null, hover: null } : null; state.balDrag = null;
  if (id === 'dimension') state.msg = dimPrompt();
  if (id === 'balloon') state.msg = balPrompt();
  if (id === 'leader') state.msg = ldrPrompt();
  if (id === 'measure') state.msg = editable() ? 'Measure: click the first point (it snaps to ends and centres)' : 'Measure: open a drawing tab first';
  if (id === 'step') state.msg = curLay() ? null : 'Step and repeat is on a layout tab: New layout, or Add to layout';
  if (id === 'contour') { state.msg = null; placeContourPanel(); }
  if (id !== 'select' && id !== 'pan' && ui.cmdUI) ui.cmdUI.ran(id === 'rect' ? 'rectangle' : id);       // Space on the drawing repeats it
  renderCommand(); renderEdit(); paintOverlay();
}

function buildCanvas() {
  ui.svg = s('svg', { role: 'img', 'aria-label': 'Sheet with the parts laid out' });
  // the opened drawing: a canvas over the sheet, same view (applyView), drawn at true size
  ui.dcanvas = h('canvas', { class: 'drawing-layer', 'data-testid': 'drawing' });
  ui.picker = h('input', { type: 'file', accept: '.dxf,.pdf,.json', hidden: true, 'data-testid': 'picker', multiple: true });
  ui.picker.addEventListener('change', async () => { const files = [...ui.picker.files]; ui.picker.value = ''; for (const f of balFirst(files)) await openPicked(f); });   // emptied, so the same file can be picked again
  ui.bgPicker = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,.pdf', hidden: true, 'data-testid': 'bg-picker' });
  ui.bgPicker.addEventListener('change', async () => { const f = ui.bgPicker.files[0]; ui.bgPicker.value = ''; if (f) await importBackground(f); });
  ui.pct = h('span', { class: 'pct mono', 'data-testid': 'zoom' }, '100%');
  ui.fitBtn = h('button', { class: 'tog on', type: 'button', onclick: fit }, 'Fit');
  ui.rubber = h('div', { class: 'rubber', hidden: true, 'data-testid': 'rubber' });
  ui.dropHint = h('div', { class: 'pop drophint', hidden: true, 'data-testid': 'drop-hint' });
  ui.hintPill = h('div', { class: 'pop hintpill', hidden: true, 'data-testid': 'hint-pill' });
  ui.rulerTop = h('div', { class: 'ruler top', 'data-axis': 'top', 'data-testid': 'ruler-top', title: 'Drag down to make a horizontal guide' });
  ui.rulerLeft = h('div', { class: 'ruler left', 'data-axis': 'left', 'data-testid': 'ruler-left', title: 'Drag right to make a vertical guide' });
  ui.rulerCorner = h('div', { class: 'ruler corner', 'data-testid': 'ruler-corner' }, 'mm');
  ui.guideTip = h('div', { class: 'pop guidetip', hidden: true, 'data-testid': 'guide-tip' });
  ui.ovl = s('svg', { 'aria-hidden': 'true', 'data-testid': 'overlay' });
  ui.ovlWrap = h('div', { class: 'ovl' }, ui.ovl);
  ui.tip = h('div', { class: 'drawtip', hidden: true, 'data-testid': 'draw-tip' });
  ui.textHint = h('div', { class: 'pop texthint', hidden: true, 'data-testid': 'text-hint' }, 'Text tool (T): click to place · type · drag a corner to change the height');
  ui.matchHint = h('div', { class: 'pop hintpill matchpill', hidden: true, 'data-testid': 'match-hint' });
  ui.gripHint = h('div', { class: 'pop hintpill', hidden: true, 'data-testid': 'grip-hint' }, 'Grips: drag, or click one then click the new place · type x,y · Shift = straight · Esc cancels');
  ui.textArea = h('textarea', { class: 'texted-area', rows: 1, wrap: 'off', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Text', 'data-testid': 'text-editor' });
  ui.textHintEd = h('div', { class: 'texted-hint', 'data-testid': 'text-editor-hint' }, h('strong', null, 'Typing in place'), h('span', null, 'Enter = done · Shift+Enter = new line'));
  ui.textEd = h('div', { class: 'texted', hidden: true, 'data-testid': 'text-edit-box' }, ui.textArea, ui.textHintEd);
  ui.textArea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textCommit(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (state.text.ed && state.text.ed.ldr) textCancel(); else textCommit(); }       // a leader's note: Esc cancels
  });
  ui.textArea.addEventListener('input', placeTextEditor);
  ui.textArea.addEventListener('blur', () => { if (state.text.ed) textCommit(); });
  ui.canvas = h('div', { class: 'canvas', 'data-testid': 'canvas' }, ui.svg, ui.dcanvas, ui.ovlWrap, ui.tip, ui.textHint, ui.textEd, ui.rubber, ui.dropHint, ui.picker, ui.bgPicker, ui.rulerTop, ui.rulerLeft, ui.rulerCorner, ui.guideTip, ui.contourPanel = buildContourPanel(), ui.balPic, ui.balSheets,
    h('div', { class: 'canvas-notices' }, ui.cmdUI.fade, ui.gripHint, ui.matchHint, ui.hintPill), ui.cmdUI.drawer, ui.cmdUI.bar,
    h('div', { class: 'zoombox' },
      h('button', { class: 'tog', type: 'button', 'aria-label': 'Zoom out', onclick: () => zoomBy(1 / 1.25) }, '−'),
      ui.pct,
      h('button', { class: 'tog', type: 'button', 'aria-label': 'Zoom in', onclick: () => zoomBy(1.25) }, '+'),
      ui.fitBtn));
  attachCanvasEvents();
  ui.canvas.addEventListener('pointermove', (e) => ui.cmdUI.pointer(e.clientX, e.clientY));
  return ui.canvas;
}

function buildPanel() {
  ui.preset = select(PRESETS.map((p) => [p.id, p.label]), 'screen', (id) => {
    const p = PRESETS.find((q) => q.id === id);
    if (p && p.w && curLay()) {
      pushLay(curDoc(), laySnap(curLay() && curDoc().lay), 'sheetsize', 'Sheet size');
      state.sheetW = p.w; state.sheetH = p.h;
      ui.sheetW.value = String(p.w); ui.sheetH.value = String(p.h);
      touch(); update(true);
    }
  }, { 'data-testid': 'preset' });
  const check = (key, text) => {
    const c = h('input', { type: 'checkbox', checked: state[key], 'data-key': key });
    c.addEventListener('change', () => { if (!curLay()) return; pushLay(curDoc(), null, 'set:' + key, text); state[key] = c.checked; touch(); update(); });
    ui[key + 'Check'] = c;
    return h('label', null, c, ' ' + text);
  };

  ui.count = h('span', { class: 'big mono', 'data-testid': 'count' }, '0');
  ui.grid = h('span', { 'data-testid': 'grid' }, '');
  ui.pctSheet = h('span', { class: 'lbl of', 'data-testid': 'pct' }, '');
  ui.rotate = select([['best', 'Best fit'], ['0', '0°'], ['90', '90°']], state.rotate, (v) => { if (!curLay()) return; pushLay(curDoc(), null, 'set:rotate', 'Rotate'); state.rotate = v; touch(); update(); }, { 'data-testid': 'rotate' });
  ui.align = select([['centre', 'Centre'], ['topleft', 'Top-left']], state.align, (v) => { if (!curLay()) return; pushLay(curDoc(), null, 'set:align', 'Align'); state.align = v; touch(); update(); }, { 'data-testid': 'align' });
  ui.layerRows = h('div', { class: 'layers-rows', style: 'display:flex;flex-direction:column;gap:6px' });

  // Fit to sheet: on = rows and columns are worked out; off = typed by hand (the grid may not fit)
  ui.fit = h('input', { type: 'checkbox', role: 'switch', class: 'swin', 'data-testid': 'fit-switch', 'aria-label': 'Fit to sheet' });
  ui.fit.addEventListener('change', () => {
    if (!curLay()) return;
    if (!ui.fit.checked) { state.rows = Math.max(1, layout.rows || 1); state.cols = Math.max(1, layout.cols || 1); }     // typing starts from what was worked out
    pushLay(curDoc(), null, 'set:fit', 'Fit to sheet'); state.fit = ui.fit.checked; touch(); update();
  });
  ui.fitText = h('span', { class: 'lbl', 'data-testid': 'fit-state' }, 'On');
  ui.partSel = h('select', { class: 'fld', 'data-testid': 'part', 'aria-label': 'Part for step and repeat' });
  ui.partSel.addEventListener('change', () => pickGridPart(ui.partSel.value));
  const rowsF = numField('Rows', 'rows', { min: 1, int: true, max: 200 }), colsF = numField('Columns', 'cols', { min: 1, int: true, max: 200 });
  ui.fitNote = h('div', { class: 'lbl warn', 'data-testid': 'fit-note', hidden: true });
  ui.stepHint = h('div', { class: 'lbl', 'data-testid': 'step-hint' });

  ui.panelMain = h('button', { class: 'seg on', type: 'button', 'data-testid': 'panel-main', onclick: () => { state.panel = 'main'; applyKind(); update(); } }, 'Layout');
  ui.panelLib = h('button', { class: 'seg', type: 'button', 'data-testid': 'panel-library', onclick: () => showLibrary() }, 'Parts library');

  ui.tabDrawing = h('button', { class: 'ptab on', type: 'button', role: 'tab', 'aria-selected': 'true', 'data-testid': 'ptab-drawing', onclick: () => setPtab('drawing') }, 'Drawing');
  ui.tabObjects = h('button', { class: 'ptab', type: 'button', role: 'tab', 'aria-selected': 'false', 'data-testid': 'ptab-objects', onclick: () => setPtab('objects') }, 'Objects');
  return ui.panelEl = h('aside', { class: 'panel', 'aria-label': 'Properties', 'data-ptab': 'drawing' },
    h('div', { class: 'ptabs', role: 'tablist', 'aria-label': 'Panel tab' }, ui.tabDrawing, ui.tabObjects),
    h('div', { class: 'mode panelsw', role: 'group', 'aria-label': 'Panel' }, ui.panelMain, ui.panelLib),
    buildPlacedPanel(),
    ui.sheetSec = h('section', { 'data-testid': 'sheet-panel' },
      h('h2', { class: 'sec' }, 'Sheet'),
      h('label', { class: 'field' }, 'Preset', ui.preset),
      h('div', { class: 'grid2' }, numField('Width', 'sheetW', { min: 1, cap: () => MAX_SHEET, floor: () => Math.max(1, state.gripLeft + state.gripRight) }), numField('Height', 'sheetH', { min: 1, cap: () => MAX_SHEET, floor: () => Math.max(1, state.gripTop + state.gripBottom) })),
      ui.sheetSelBtn = h('button', { class: 'btn', type: 'button', 'data-testid': 'sheet-select', 'aria-pressed': 'false', title: 'Select the sheet: four handles to drag', onclick: () => selectSheet(!sheetSelOn()) }, 'Select sheet'),
      h('span', { class: 'lbl' }, 'Or click the sheet edge. Drag a side handle to resize.'),
      h('div', { class: 'lbl' }, 'Gripper per side, mm (0 = none)'),
      h('div', { class: 'grid4' }, numField('Top', GRIP_KEYS.top, { cap: () => state.sheetH - state.gripBottom }), numField('Right', GRIP_KEYS.right, { cap: () => state.sheetW - state.gripLeft }), numField('Bottom', GRIP_KEYS.bottom, { cap: () => state.sheetH - state.gripTop }), numField('Left', GRIP_KEYS.left, { cap: () => state.sheetW - state.gripRight })),
      h('div', { class: 'checks' }, check('crop', 'Crop marks'), check('reg', 'Reg marks'))),
    ui.guideSec = h('section', { 'data-testid': 'guides-panel' },
      h('h2', { class: 'sec' }, 'Guides'),
      ui.guideList = h('div', { class: 'guidelist', 'data-testid': 'guide-list' }),
      ui.guideEmpty = h('span', { class: 'lbl' }, 'None yet. Drag one out of a ruler, or add one here.'),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn sm', type: 'button', 'data-testid': 'guide-add-h', onclick: () => addGuide('y') }, '+ Horizontal'), h('button', { class: 'btn sm', type: 'button', 'data-testid': 'guide-add-v', onclick: () => addGuide('x') }, '+ Vertical')),
      h('label', { class: 'row swrow' }, h('span', null, 'Show guides'), ui.guidesShowSw = h('input', { type: 'checkbox', role: 'switch', class: 'swin', 'data-testid': 'guides-show', 'aria-label': 'Show guides', onchange: (e) => setGuidesShow(e.target.checked) })),
      h('label', { class: 'row swrow' }, h('span', null, 'Lock guides'), ui.guidesLockSw = h('input', { type: 'checkbox', role: 'switch', class: 'swin', 'data-testid': 'guides-lock', 'aria-label': 'Lock guides', onchange: (e) => setGuidesLock(e.target.checked) })),
      ui.guideClear = h('button', { class: 'btn sm', type: 'button', 'data-testid': 'guide-clear', onclick: clearGuides }, 'Clear all guides')),
    ui.rulerSec = h('section', { 'data-testid': 'rulers-panel' },
      h('h2', { class: 'sec' }, 'Rulers'),
      h('label', { class: 'row swrow' }, h('span', null, 'Show rulers'), ui.rulersSw = h('input', { type: 'checkbox', role: 'switch', class: 'swin', 'data-testid': 'rulers-show', 'aria-label': 'Show rulers', onchange: (e) => setRulers(e.target.checked) })),
      h('span', { class: 'lbl' }, "Millimetres. Zero is the sheet's bottom-left corner; Y counts up, like the X / Y in the status bar.")),
    buildDrawingSection(),
    buildCompareSection(),
    ui.partsSec = h('section', { 'data-testid': 'parts-panel' },
      h('h2', { class: 'sec' }, 'Parts on this layout'),
      ui.partRows = h('div', { class: 'partrows', 'data-testid': 'part-rows' }),
      h('button', { class: 'btn', type: 'button', 'data-testid': 'add-from-library', onclick: () => showLibrary() }, '+ Add from Parts library')),
    ui.stepSec = h('section', { class: 'stepbox', 'data-testid': 'step-panel' },
      h('h2', { class: 'sec' }, 'Step and repeat'),
      h('label', { class: 'row swrow' }, h('span', null, 'Fit to sheet'), h('span', { class: 'row' }, ui.fitText, ui.fit)),
      h('label', { class: 'field' }, 'Part', ui.partSel),
      h('div', { class: 'grid2' }, rowsF, colsF),
      h('div', { class: 'grid2' }, numField('Gap X', 'gapX'), numField('Gap Y', 'gapY'),
        h('label', { class: 'field' }, 'Rotate', ui.rotate), h('label', { class: 'field' }, 'Align', ui.align))),
    // the count line and Apply stay in view at the bottom of the panel (sticky), however far the panel is scrolled
    ui.stepFoot = h('div', { class: 'stepfoot', 'data-testid': 'step-foot' },
      h('div', { class: 'readout' }, ui.count, h('span', null, ui.grid), ui.pctSheet),
      ui.fitNote, ui.stepHint,
      h('div', { class: 'btnrow' },
        ui.applyBtn = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'apply', onclick: apply }, 'Apply'),
        h('button', { class: 'btn', type: 'button', title: 'Pack mixed parts by their real outline', 'data-testid': 'nest', onclick: () => openNestDialog() }, 'Auto-nest…'))),
    ui.gapSec = h('section', { 'data-testid': 'gap-panel' },
      h('h2', { class: 'sec' }, 'Extra gaps'),
      h('span', { class: 'lbl' }, 'Click a gap between two rows or columns.'),
      ui.gapList = h('div', { class: 'gaplist', 'data-testid': 'gap-list' })),
    buildLibrary(),
    ui.layersSec = h('section', { class: 'layers' },
      h('div', { class: 'layers-head' }, h('h2', { class: 'sec' }, 'Layers'),
        h('button', { class: 'tog', type: 'button', 'aria-label': 'Add layer', 'data-testid': 'layer-add', title: 'Add a layer (Layer1, Layer2…): it becomes the current layer, and you can name it and pick its colour', onclick: addLayerNow }, '+ Add')),
      ui.layerRows),
    buildObjects());
}

/**
 * The right panel's sections for the selected placed part, above the layout's own (they are only there while a part is selected):
 * Selected part, Rotate, Mirror, Duplicate and Nudge.
 */
function buildPlacedPanel() {
  const sec = (title, testid, ...kids) => h('section', { class: 'placedsec', 'data-testid': testid, hidden: true }, h('h2', { class: 'sec' }, title), ...kids);
  const xy = (a) => `${a}: where the lower-left of the part's box is on the sheet, in mm (y up)`;
  ui.ppName = h('strong', { class: 'ppname', 'data-testid': 'pp-name' });
  ui.ppSize = h('span', { class: 'lbl mono', 'data-testid': 'pp-size', title: 'Width × height of the box of the part on the sheet, in mm. Read-only: parts are scaled per drawing' });
  const fx = pfield({ 'data-lockable': '1', 'data-testid': 'pp-x', 'aria-label': 'X in mm', title: xy('X') }, () => showBox(0), (t) => setBoxPos('x', t));
  const fy = pfield({ 'data-lockable': '1', 'data-testid': 'pp-y', 'aria-label': 'Y in mm', title: xy('Y') }, () => showBox(1), (t) => setBoxPos('y', t));
  const fa = pfield({ 'data-lockable': '1', 'data-testid': 'rot-angle', 'aria-label': 'Angle in degrees' }, showAngle, setAngleText);
  ui.pivotSel = select([['centre', 'Centre'], ['bl', 'Bottom-left'], ['custom', 'Custom']], 'centre', setPivotKind, { 'data-testid': 'rot-pivot', 'aria-label': 'Pivot' });
  const custom = () => state.pivot.kind === 'custom';
  const px = pfield({ 'data-lockable': '1', 'data-testid': 'rot-px', 'aria-label': 'Pivot X in mm' }, () => { const s = selectedPlaced(); return s ? fmt(pivotPoint(s.part, s.p)[0]) : '—'; }, (t) => setPivotText('x', t), custom);
  const py = pfield({ 'data-lockable': '1', 'data-testid': 'rot-py', 'aria-label': 'Pivot Y in mm' }, () => { const s = selectedPlaced(); return s ? fmt(pivotPoint(s.part, s.p)[1]) : '—'; }, (t) => setPivotText('y', t), custom);
  const mirror = (axis) => h('button', { class: 'btn sm', type: 'button', 'data-testid': 'mirror-' + axis, title: axis === 'x' ? 'Flip the part left to right about its centre' : 'Flip the part top to bottom about its centre', onclick: () => mirrorSel(axis) }, axis === 'x' ? 'Mirror X' : 'Mirror Y');
  ui.dupAxisBtns = [['x', '→', 'Right (+X)'], ['-x', '←', 'Left (−X)'], ['y', '↑', 'Up (+Y)'], ['-y', '↓', 'Down (−Y)']].map(([a, arrow, label]) =>
    h('button', { class: 'seg', type: 'button', 'data-testid': 'dup-' + a.replace('-', 'neg'), 'data-axis': a, 'aria-label': label, title: label, onclick: () => { state.dupAxis = a; renderProps(); } }, arrow));
  const dgap = pfield({ 'data-testid': 'dup-gap', 'aria-label': 'Distance between copies in mm', title: 'Edge to edge: the space between one copy and the next' }, () => String(+state.dupGap.toFixed(3)), (t) => setDupText('dupGap', t));
  const dcount = pfield({ 'data-testid': 'dup-count', 'aria-label': 'Copies' }, () => String(state.dupCount), (t) => setDupText('dupCount', t));
  const nudge = pfield({ 'data-testid': 'nudge-step2', 'aria-label': 'Nudge step in mm' }, showNudge, setNudgeText);
  ui.ppLock = h('span', { class: 'chip lockchip', hidden: true, 'data-testid': 'pp-lock' }, icon(ICONS.lock, { size: 12, width: 1.8, cap: 'round', join: 'round' }), 'Locked');
  ui.members = h('ol', { class: 'members', 'data-testid': 'members', hidden: true });
  const ibtn = (kind, how, label) => h('button', { class: 'ib', type: 'button', 'data-testid': `${kind}-${how}`, 'aria-label': label, title: label, onclick: () => arrange(kind, how) }, icon(ICONS[how], { size: 18, cap: 'round', join: 'round' }));
  ui.relSel = select([['selection', 'Selection'], ['sheet', 'Sheet'], ['first', 'First selected']], state.arrangeRel, setArrangeRel, { 'data-testid': 'arrange-rel', 'aria-label': 'Relative to' });
  const gb = (id, text, ic, fn, title) => { const b = h('button', { class: 'btn sm', type: 'button', 'data-testid': id, title, onclick: fn }, icon(ICONS[ic], { size: 16, cap: 'round', join: 'round' }), text); ui[id] = b; return b; };
  ui.pivotRows = [labelled('Pivot', ui.pivotSel, 'field'), labelled('Pivot X (mm)', px, 'field'), labelled('Pivot Y (mm)', py, 'field')];
  ui.rotHelp = h('span', { class: 'lbl' }, 'Click the part again to turn it by hand; drag ◎ to move the pivot.');
  ui.placedSecs = [
    sec('Selected part', 'sec-part', h('div', { class: 'row between' }, h('span', { class: 'row' }, ui.ppName, ui.ppLock), ui.ppSize), ui.members, h('div', { class: 'grid2' }, labelled('X (mm)', fx, 'field'), labelled('Y (mm)', fy, 'field'))),
    sec('Arrange', 'sec-arrange',
      h('div', { class: 'row arrow' }, h('span', { class: 'lbl rowname' }, 'Align'), ...['left', 'centre', 'right', 'top', 'middle', 'bottom'].map((how) => ibtn('align', how, 'Align ' + how))),
      h('div', { class: 'row arrow' }, h('span', { class: 'lbl rowname' }, 'Distribute'), ibtn('distribute', 'horizontal', 'Distribute horizontally'), ibtn('distribute', 'vertical', 'Distribute vertically'), h('span', { class: 'lbl' }, 'equal gaps')),
      h('label', { class: 'lbl row' }, h('span', { class: 'rowname' }, 'Relative to'), ui.relSel)),
    sec('Group and lock', 'sec-group',
      h('div', { class: 'btnrow wrap' }, gb('grp-group', 'Group', 'group', groupSel, 'Group the selected parts (Ctrl+G)'), gb('grp-ungroup', 'Ungroup', 'ungroup', ungroupSel, 'Ungroup (Ctrl+Shift+G)'),
        gb('grp-lock', 'Lock', 'lock', () => lockSel(true), 'Lock: it cannot be moved, turned, mirrored or deleted'), gb('grp-unlock', 'Unlock', 'unlock', () => lockSel(false), 'Unlock')),
      ui.groupHelp = h('span', { class: 'lbl' }, 'Group Ctrl+G · Ungroup Ctrl+Shift+G. A group moves, turns and copies as one part.')),
    sec('Rotate', 'sec-rotate', h('div', { class: 'grid2' }, labelled('Angle (°)', fa, 'field'), ui.pivotRows[0]),
      h('div', { class: 'grid2' }, ui.pivotRows[1], ui.pivotRows[2]),
      ui.rotHelp),
    sec('Mirror', 'sec-mirror', h('div', { class: 'btnrow' }, mirror('x'), mirror('y')), h('span', { class: 'lbl' }, 'X flips left to right, Y top to bottom, about the centre of the part.')),
    sec('Duplicate', 'sec-duplicate',
      h('div', { class: 'row between' }, h('span', { class: 'lbl' }, 'Direction'), h('div', { class: 'mode', role: 'group', 'aria-label': 'Direction' }, ui.dupAxisBtns)),
      h('div', { class: 'grid2' }, labelled('Distance (mm)', dgap, 'field'), labelled('Copies', dcount, 'field')),
      h('span', { class: 'lbl' }, 'Distance is edge to edge. Copies off the sheet are still placed.'),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn sm primary', type: 'button', 'data-testid': 'dup-go', onclick: duplicateRow }, 'Duplicate'),
        h('button', { class: 'btn sm', type: 'button', 'data-testid': 'dup-one', title: 'One copy, 10 mm right and up (Ctrl+D). Drag it where it should go', onclick: duplicateOne }, 'Copy once'))),
    sec('Nudge', 'sec-nudge', h('div', { class: 'row between' }, labelled('Step (mm)', nudge, 'field'), h('span', { class: 'lbl' }, 'Arrow keys move the part by this step.'))),
  ];
  ui.secTitle = ui.placedSecs[0].querySelector('h2');
  return h('div', { class: 'contents' }, ui.placedSecs);
}

/** Puts the open layout's fields (size, grippers, marks, gaps, rotate, align, rows, columns) in step with the layout that is open. */
function syncFields() {
  for (const k of ['sheetW', 'sheetH', ...Object.values(GRIP_KEYS), 'gapX', 'gapY', 'rows', 'cols']) if (ui[k] && document.activeElement !== ui[k]) ui[k].value = String(state[k]);
  ui.cropCheck.checked = state.crop; ui.regCheck.checked = state.reg;
  ui.rotate.value = state.rotate; ui.align.value = state.align; ui.preset.value = presetFor(state.sheetW, state.sheetH);
}

// ---- layouts: a tab of their own, with their own sheet, parts and step and repeat ----
const baseName = (n) => n.replace(/\.[^.\\/]*$/, '');
/** The layout tab that Add to layout and Add to sheet put parts on: the open one, else the last one still open. */
function targetLayout() {
  const d = curDoc();
  if (d && d.lay) return d;
  for (let i = state.docs.length - 1; i >= 0; i--) if (state.docs[i].lay) return state.docs[i];
  return null;
}
function freshLayout(base) {
  const names = new Set(state.docs.map((d) => d.name));
  let name = base;
  for (let n = 2; names.has(name); n++) name = base + ' ' + n;
  return { name, path: null, dirty: false, lay: LD.newLayout(name) };
}
function newLayoutTab() {
  const names = new Set(state.docs.map((d) => d.name));
  let n = 1;
  while (names.has('Layout ' + n)) n++;
  state.panel = 'main';
  addTab(freshLayout('Layout ' + n), false);
  note('New layout: set the sheet, then add parts from the Parts library, or pick a part for step and repeat');
}
function openLayoutFile(lay, name, path) {
  lay.name = name;
  const doc = { name, path, openPath: path, dirty: false, lay, fromFile: true };
  state.panel = 'main';
  addTab(doc);
  const used = LD.placedAll(lay, LD.gridOf(lay)).length;
  note(`Opened ${name} as a layout: ${used} placed part${used === 1 ? '' : 's'}, ${Object.keys(lay.parts).length} part${Object.keys(lay.parts).length === 1 ? '' : 's'}, its sheet and settings as saved`);
  for (const p of Object.values(lay.parts)) libKeep(p, name);          // a part the library does not have yet is added to it
}
const SHIFT_HINT = 'Shift-drag keeps it straight';
/** Puts a loose copy of the part on the layout, centred on `at` ([x, y] sheet mm, y up) or near the sheet's centre; its index in lay.placed. */
function addPlaced(lay, part, at) {
  if (!lay.parts[part.id]) lay.parts[part.id] = part;
  const s = lay.s, sg = (v) => PL.snapGrid(v);                  // the part's position (its lower-left corner) snaps to whole mm (TODO 45)
  let cx, cy;
  if (at) { cx = at[0]; cy = at[1]; }
  else {
    // no place given (Add to sheet, Add to layout): the sheet's middle, then each new one 10 mm right and up from the last added,
    // never exactly on top of a copy already there, and kept on the sheet (it starts again at the middle when it would leave)
    const last = lay.placed[lay.placed.length - 1], lp = last && lay.parts[last.partId], lb = lp && placedBox(lp, last);
    const inside = (x, y) => sg(x - part.w / 2) >= 0 && sg(y - part.h / 2) >= 0 && sg(x - part.w / 2) + part.w <= s.sheetW && sg(y - part.h / 2) + part.h <= s.sheetH;
    const taken = (x, y) => lay.placed.some((p) => p.partId === part.id && Math.abs(p.x - sg(x - part.w / 2)) < 0.01 && Math.abs(p.y - sg(y - part.h / 2)) < 0.01);
    cx = lb ? (lb[0] + lb[2]) / 2 + 10 : s.sheetW / 2; cy = lb ? (lb[1] + lb[3]) / 2 + 10 : s.sheetH / 2;
    if (!inside(cx, cy)) { cx = s.sheetW / 2; cy = s.sheetH / 2; }
    for (let i = 0; i < 200 && taken(cx, cy); i++) { cx += 10; cy += 10; if (!inside(cx, cy)) { cx = s.sheetW / 2 - 5 * (i % 7); cy = s.sheetH / 2 + 5 * (i % 7); } }
  }
  lay.placed.push(placement1(part.id, sg(cx - part.w / 2), sg(cy - part.h / 2)));
  return lay.placed.length - 1;
}
/** Selects a loose placed part of the open layout (by its index in lay.placed) and shows it. */
function selectLoose(i) {
  state.sel = placedNow.findIndex((p) => p.src === 'loose' && p.i === i);
  state.mode = 'select'; state.pivot = centrePivot();
  renderProps(); renderLayers(); drawSheet(); paintOverlay();
}
/** Brings the layout tab forward (it may be another tab than the open one). */
function showLayoutTab(t, isNew) {
  if (isNew) { addTab(t, false); return; }
  const i = state.docs.indexOf(t);
  if (i !== state.doc) { state.doc = i; showDoc(); }
}

/** Add to layout: the whole open drawing (without its kept dimensions) as a part of a layout. The first part of a layout becomes its step-and-repeat grid, fit to the sheet; later ones are placed once. */
function addToLayout() {
  const d = editable();
  if (!d) { note('Add to layout: open a drawing first'); return; }
  const raw = LD.extractRaw(d.raw, null), part = raw && LD.makePart(uid(), baseName(d.name), raw, d.factor, d.name);
  if (!part) { note('Add to layout: this drawing has nothing with a size to lay out'); return; }
  state.panel = 'main';
  const existing = targetLayout(), t = existing || freshLayout(baseName(d.name) + ' layout'), lay = t.lay;
  const grid = !lay.s.gridPart && !lay.placed.length;
  if (!grid) pushLay(t, null, '', `Add ${part.name}`);          // the first part of a layout (its grid) is not an undo step
  lay.parts[part.id] = part;
  if (grid) lay.s.gridPart = part.id; else addPlaced(lay, part);
  t.dirty = true; renderTabs();
  showLayoutTab(t, !existing);
  update();
  if (!grid) selectLoose(lay.placed.length - 1);
  note(`${part.name} (${fmtSize(part.w)} × ${fmtSize(part.h)} mm) added to ${t.name}: ` + (grid ? `${layout.count} fit on the sheet` : 'placed on the sheet, on whole mm. ' + SHIFT_HINT));
}

/** Pick the part of the step-and-repeat grid: one of the layout's parts, or one from the library (it is added to the layout). */
function pickGridPart(v) {
  const lay = curLay();
  if (!lay) return;
  if (v.startsWith('lib:')) {
    const rec = lib.items.find((r) => r.id === v.slice(4)), part = rec && libPart(rec);
    if (!part) { note('This part could not be read'); update(); return; }
    pushLay(curDoc(), null, '', 'Pick the grid part');
    lay.parts[part.id] = { ...part }; lay.s.gridPart = part.id;
  } else { pushLay(curDoc(), null, '', 'Pick the grid part'); lay.s.gridPart = v || null; }
  touch(); update();
}

/** Apply: the grid's copies become separate placed parts (to place one by one); the grid is cleared, so another can be made. */
function apply() {
  const d = curDoc(), lay = d && d.lay;
  if (!lay) { note('Apply is on a layout tab: Add to layout, or New layout'); return; }
  if (!lay.s.gridPart) { note('Pick a part for step and repeat first'); return; }
  if (!layout.count) { note('Nothing fits on the sheet, so there is nothing to apply'); return; }
  const grid = placedNow.filter((p) => p.src === 'grid'), id = lay.s.gridPart;
  pushLay(d, null, '', 'Apply the grid');
  for (const p of grid) lay.placed.push(placement1(p.partId, p.x, p.y, p.rot));
  lay.s.gridPart = null;
  touch(); update();
  note(`${grid.length} copies of ${lay.parts[id].name} are now placed parts of their own. Pick a part in Step and repeat to make another grid`);
}

// ---- Auto-nest (nestdlg.js is the dialog, nest.js the packer): the preview is only applied by Apply, as one undo step ----
const nestThumbs = new Map();
/** Opens the Auto-nest dialog for the open layout. `counts` ({ partId: n }) sets how many of each (the left-overs of the sheet before); `autoRun` runs it at once. */
function openNestDialog(counts = null, autoRun = false) {
  const d = curDoc(), lay = d && d.lay;
  if (!lay) { note('Auto-nest is on a layout tab: Add to layout, or New layout'); return; }
  const s = lay.s, byId = new Map();
  for (const p of Object.values(lay.parts)) byId.set(p.id, { part: p, thumb: (lib.items.find((r) => r.id === p.id) || {}).thumb || '', inLayout: true });
  for (const rec of lib.items) if (!byId.has(rec.id)) { const part = libPart(rec); if (part) byId.set(rec.id, { part, thumb: rec.thumb || '', inLayout: false }); }
  const outlines = new Map(), outlineFor = (part) => { if (!outlines.has(part.id)) outlines.set(part.id, outlineOf(part).poly); return outlines.get(part.id); };
  const parts = [...byId.values()].map(({ part, thumb, inLayout }) => {
    if (!thumb) { if (!nestThumbs.has(part.id)) nestThumbs.set(part.id, thumbFor(part)); thumb = nestThumbs.get(part.id); }
    return { id: part.id, name: part.name, w: part.w, h: part.h, thumb, count: counts ? (counts[part.id] || 0) : (inLayout ? 1 : 0), outline: () => outlineFor(part) };
  });
  const fixed = LD.placedAll(lay, LD.gridOf(lay)).map((pl) => { const part = lay.parts[pl.partId]; return outlineFor(part).map(([u, v]) => PL.toSheet(pl, u, v)); });
  const area = { x: s.gripLeft, y: s.gripBottom, w: s.sheetW - s.gripLeft - s.gripRight, h: s.sheetH - s.gripTop - s.gripBottom };
  if (!(area.w > 0 && area.h > 0)) { note('Auto-nest: the grippers leave no room on the sheet'); return; }
  openNest({
    layName: d.name, sheetW: s.sheetW, sheetH: s.sheetH, area, grips: { top: s.gripTop, right: s.gripRight, bottom: s.gripBottom, left: s.gripLeft },
    gap: Math.max(s.gapX, s.gapY), parts, fixed, autoRun,
    onApply: (res) => applyNest(d, res),
    onNextSheet: (res, left) => nextSheet(d, res, left),
  });
}
/** The packed parts become placed parts of the layout: one undo step, "Auto-nest"; the new parts are selected. Returns how many. */
function applyNest(d, res) {
  const lay = d.lay, r6 = (v) => Math.round(v * 1e6) / 1e6;
  if (!res || !res.placed) return 0;
  pushLay(d, null, '', 'Auto-nest');
  const first = lay.placed.length;
  for (const pl of res.placements) {
    if (!lay.parts[pl.partId]) { const rec = lib.items.find((r) => r.id === pl.partId), part = rec && libPart(rec); if (!part) continue; lay.parts[pl.partId] = { ...part }; }
    lay.placed.push(placement1(pl.partId, r6(pl.x), r6(pl.y), pl.rot));
  }
  const n = lay.placed.length - first;
  selLooseMany = Array.from({ length: n }, (_, k) => first + k);
  touch(); update();
  note(`Auto-nest: ${n} part${n === 1 ? '' : 's'} placed, ${Math.round(res.usedPct)} % of the usable sheet used. Ctrl+Z takes them off again`);
  return n;
}
/** Applies the nest, then a new layout tab (same sheet, grippers and gap) opens the dialog with the left-overs ready to run. */
function nextSheet(d, res, left) {
  const lay = d.lay;
  applyNest(d, res);
  const t = freshLayout(baseName(d.name) + ' next sheet');
  t.lay.s = { ...lay.s, gridPart: null, guides: (lay.s.guides || []).map((g) => ({ ...g })), extraRows: lay.s.extraRows.map((e) => ({ ...e })), extraCols: lay.s.extraCols.map((e) => ({ ...e })) };
  for (const id of Object.keys(left)) if (left[id] > 0 && lay.parts[id]) t.lay.parts[id] = { ...lay.parts[id] };
  state.panel = 'main';
  addTab(t, false);
  note('Next sheet: the left-overs are ready to nest on a new layout');
  openNestDialog(left, true);
}

/** A part (and every copy of it) leaves the layout. */
function removeFromLayout(id) {
  const lay = curLay();
  if (!lay || !lay.parts[id]) return;
  const name = lay.parts[id].name;
  pushLay(curDoc(), null, '', `Take off ${name}`);
  lay.placed = lay.placed.filter((p) => p.partId !== id);
  if (lay.s.gridPart === id) lay.s.gridPart = null;
  delete lay.parts[id];
  touch(); update();
  note(`${name} taken off this layout`);
}

// ---- editing placed parts: move, turn, mirror, copy, nudge, delete (place.js is the maths) ----
// A layout keeps an undo history of its own (d.lhist): the loose placed parts, the grid's part and the parts, as they were before each
// change. A part of the step-and-repeat grid is not a placed part of its own, so the first change to one turns the whole grid into
// placed parts (as Apply does) and then changes that one.
let pdrag = null;                    // a drag on the sheet: { kind: 'move' | 'rotate' | 'pivot', … }
let selLooseMany = null;             // after the next update(): select the loose placed parts with these indexes in lay.placed (the last is the main one)
let lastPush = { key: '', t: 0, d: null };
const r2 = (v) => Math.round(v * 100) / 100;
const fmt1 = (v) => Number(v).toFixed(1);
const centrePivot = () => ({ kind: 'centre', x: 0, y: 0 });
const laySnap = (lay) => ({ sw: lay.s.sheetW, sh: lay.s.sheetH, s: structuredClone(lay.s), placed: lay.placed.map((p) => ({ ...p })), gridPart: lay.s.gridPart, parts: { ...lay.parts },
  lsel: lay === (curLay() || {}) ? selIdxs().map((i) => placedNow[i]).filter((p) => p.src === 'loose').map((p) => p.i) : [] });      // lsel: which loose parts were selected (undo brings the selection back)
const layHist = (d) => d.lhist || (d.lhist = Ed.createHistory());
/** Keeps the layout as it is now for undo; the same key within 0.8 s (arrow key held down) keeps only the first. */
function pushLay(d, snap, key = '', label) {
  const now = Date.now();
  if (key && lastPush.key === key && lastPush.d === d && now - lastPush.t < 800) { lastPush.t = now; return; }
  layHist(d).push(snap || laySnap(d.lay), label);
  lastPush = { key, t: now, d };
}
function layRestore(d, st, dirty = true) {
  const sameSet = d.lay.placed.length === st.placed.length && d.lay.s.gridPart === st.gridPart;      // a move, align or flag change: the same parts are still selected
  if (st.lsel && st.lsel.length) selLooseMany = st.lsel.slice();
  const sized = st.sw != null && (st.sw !== d.lay.s.sheetW || st.sh !== d.lay.s.sheetH);
  if (sized) { d.lay.s.sheetW = st.sw; d.lay.s.sheetH = st.sh; syncFields(); }
  d.lay.placed = st.placed; d.lay.parts = st.parts; Object.assign(d.lay.s, structuredClone(st.s));       // every setting (grippers, gaps, rows, marks, grid part, guides) comes back with the parts
  gapSig = ''; syncFields();                                           // the extra-gap rows hold the old gap objects: rebuilt
  state.mode = 'select'; state.pivot = centrePivot(); state.rotCopy = false; pdrag = null; lastPush = { key: '', t: 0, d: null }; if (!sameSet) picksArr = [];
  d.dirty = dirty; renderTabs(); update(sized && view.fitted);
}
function undoLay() {
  const d = curDoc();
  if (!d || !d.lay) return;
  const st = layHist(d).undo(laySnap(d.lay));
  if (!st) { note('Nothing to undo'); return; }
  layRestore(d, st); note('Undone');
}
function redoLay() {
  const d = curDoc();
  if (!d || !d.lay) return;
  const st = layHist(d).redo(laySnap(d.lay));
  if (!st) { note('Nothing to redo'); return; }
  layRestore(d, st); note('Redone');
}
/** The undo history of a tab: a drawing's, a layout's, or null. */
const historyOf = (d) => (!d ? null : d.lay ? layHist(d) : d.raw && d.fl && d.hist ? d.hist : null);
/** Edit → Undo history… (TODO 30): the steps of the open tab by name, oldest first, the current one marked; a click goes there (several undos, or redos, at once). */
function showHistory() {
  const d = curDoc(), hist = historyOf(d);
  if (!hist) { note('Undo history: open a drawing or a layout first'); return; }
  const { past, future } = hist.labels(), rows = ['Start', ...past, ...future], now = past.length;
  const finish = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const go = (r) => {
    finish();
    if (r === now) return;
    const lay = !!d.lay, cur = lay ? laySnap(d.lay) : snapshotOf(d);
    const st = r < now ? hist.undoMany(now - r, cur) : hist.redoMany(r - now, cur);
    if (!st) return;
    if (lay) layRestore(d, st); else restore(d, st);
    note(r < now ? `Went back ${now - r} step${now - r === 1 ? '' : 's'}, to ${rows[r] === 'Start' ? 'the start' : 'after ' + rows[r]}` : `Went forward ${r - now} step${r - now === 1 ? '' : 's'}, to after ${rows[r]}`);
  };
  const list = h('div', { class: 'histlist', 'data-testid': 'hist-list' }, rows.map((text, r) => {
    const b = h('button', { class: 'mi hrow' + (r === now ? ' now' : r > now ? ' later' : ''), type: 'button', 'data-testid': 'hist-row', 'aria-current': r === now ? 'step' : null },
      h('span', { class: 'hmark' }, r === now ? '●' : ''), h('span', null, text));
    b.addEventListener('click', () => go(r));
    return b;
  }));
  const close = h('button', { class: 'btn', type: 'button', 'data-testid': 'hist-close' }, 'Close');
  close.addEventListener('click', finish);
  const dlg = h('div', { class: 'pop-dialog', role: 'dialog', 'aria-label': 'Undo history', 'data-testid': 'hist-dialog' },
    h('strong', null, 'Undo history'), h('span', { class: 'lbl' }, 'Oldest first. Click a step to go back to it, or forward again. Grey steps are undone.'), list, h('div', { class: 'row end' }, close));
  const back = h('div', { class: 'pop-back', 'data-testid': 'hist-back' }, dlg);
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); } };
  back.addEventListener('pointerdown', (e) => { if (e.target === back) finish(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  list.scrollTop = list.scrollHeight;
  (list.querySelector('.now') || close).focus();
}
/** The selected placed parts of the open layout (indexes into placedNow, in the order they were picked): one, several, or none. */
function selIdxs() {
  const n = placedNow.length;
  if (picksArr.length > 1) { const ok = picksArr.filter((i) => i >= 0 && i < n); if (ok.length > 1) return ok; }
  return state.sel >= 0 && state.sel < n ? [state.sel] : [];
}
/** The selection as [{ i (index in placedNow), p (that entry), part }]. */
function selItems() {
  const lay = curLay();
  return lay ? selIdxs().map((i) => ({ i, p: placedNow[i], part: lay.parts[placedNow[i].partId] })).filter((x) => x.part) : [];
}
const multiSel = () => selIdxs().length > 1;
const boxOf = (x) => placedBox(x.part, x.p);
/** The box round the whole selection (sheet mm, y up), or null. */
function selBox() { const it = selItems(); return it.length ? A.unionBox(it.map(boxOf)) : null; }
/** The members (indexes into placedNow) of the group the part at index i belongs to; just [i] when it is in none. */
function groupIdxs(i) {
  const p = placedNow[i];
  return p && p.src === 'loose' && p.g ? placedNow.map((q, k) => (q.src === 'loose' && q.g === p.g ? k : -1)).filter((k) => k >= 0) : [i];
}
const groupSize = (g) => placedNow.filter((q) => q.src === 'loose' && q.g === g).length;
/** Is the selection exactly one whole group? */
const wholeGroup = () => A.isWholeGroup(selItems().map((x) => ({ g: x.p.g })), groupSize);
const LOCKED = 'Locked: Unlock to move it';
const newGroupId = () => 'g' + uid();
/** Select these placed parts (indexes into placedNow, in pick order); `main` (default the last) is the one the single-part fields follow. */
function selectMany(list, main) {
  const l = [...new Set(list)];
  if (!l.length) return;
  state.sel = main != null ? main : l[l.length - 1];
  picksArr = l.length > 1 ? l : [];
  state.mode = 'select'; state.pivot = centrePivot(); state.rotCopy = false;
}
/** A copy of a placement for a new part: not locked, and a group's copy is a group of its own (gmap: old group id → new one, one per copy). */
function fresh(pl, gmap) {
  const { lock, g, ...rest } = pl;
  return g ? { ...rest, g: gmap[g] || (gmap[g] = newGroupId()) } : rest;
}
/** A group left with one member is no group: its mark goes. */
function tidyGroups(lay) {
  const n = {};
  for (const p of lay.placed) if (p.g) n[p.g] = (n[p.g] || 0) + 1;
  lay.placed = lay.placed.map((p) => { if (p.g && n[p.g] < 2) { const { g, ...rest } = p; return rest; } return p; });
}
/** The selected placed part of the open layout (the main one when several are selected): { d, lay, p (its placedNow entry), part }, or null. */
function selectedPlaced() {
  const d = curDoc(), lay = d && d.lay, p = lay && state.sel >= 0 && placedNow[state.sel], part = p && lay.parts[p.partId];
  return part ? { d, lay, p, part } : null;
}
const placementOf = (p) => ({ ...placement1(p.partId, p.x, p.y, p.rot, p.mirrorX, p.mirrorY), ...(p.g ? { g: p.g } : {}), ...(p.lock ? { lock: true } : {}) });
/** The turn's pivot of the selected part as a sheet point (mm, y up). */
const pivotPoint = (part, pl) => PL.pivotOf(part, pl, state.pivot.kind, [state.pivot.x, state.pivot.y]);
const showBox = (i) => { if (multiSel()) { const b = selBox(); return b ? fmt(b[i]) : '—'; } const s = selectedPlaced(); return s ? fmt(placedBox(s.part, s.p)[i]) : '—'; };
const showAngle = () => { if (multiSel()) return '0°'; const s = selectedPlaced(); return s ? +Number(s.p.rot).toFixed(2) + '°' : '—'; };
const showNudge = () => fmt1(state.nudge);
/** What to add to a message: that the part is off the sheet (it is drawn in orange, and still placed). */
const offNote = (lay, part, pl) => (PL.offSheet(part, pl, lay.s.sheetW, lay.s.sheetH) ? `${part.name} is off the sheet (drawn in orange). It is still placed` : '');
const say = (...bits) => note(bits.filter(Boolean).join('. '));

/** A change in progress: the layout is kept for undo once, when the first thing changes (and thrown away if it is cancelled). */
function startGesture(d, label = 'Edit') { return { d, lay: d.lay, dirty: d.dirty, snap: null, loosened: false, key: '', label }; }
function gMark(g) { if (!g.snap) g.snap = laySnap(g.lay); }
function gCommit(g) { if (g.snap) pushLay(g.d, g.snap, g.key, g.label); touch(); }
/** The indexes in lay.placed of placedNow[sels]; a grid copy first turns the whole grid into placed parts (as Apply does), once. */
function gLooseMany(g, sels) {
  const ps = sels.map((i) => placedNow[i]);
  if (ps.some((p) => p.src !== 'loose')) {
    gMark(g);
    const grid = placedNow.filter((q) => q.src === 'grid'), base = g.lay.placed.length;
    for (const q of grid) g.lay.placed.push(placementOf(q));
    g.lay.s.gridPart = null; g.loosened = true;
    return ps.map((p) => (p.src === 'loose' ? p.i : base + p.i));
  }
  return ps.map((p) => p.i);
}
const gLoose = (g, sel) => gLooseMany(g, [sel])[0];
const loosenedNote = (g) => (g.loosened ? 'The step and repeat grid became separate placed parts' : '');

/**
 * Changes the selected placed parts: fn(part, placement, ctx) → the new placement (ctx: many, box (the box round the selection), cx, cy, k (this part's
 * place in the selection)). { copy: true } adds them as new placed parts and leaves the originals (not locked, a group's copy a group of its own).
 * A locked part is not changed (says so). Nothing happens (and nothing is kept for undo) when it comes out the same.
 * → { g, part, next, idx, idxs, lay, items, nexts, name, many } or null.
 */
function editSelected(fn, { copy = false, key = '', pick = false, label = 'Edit' } = {}) {
  const items = selItems();
  if (!items.length) return null;
  const d = curDoc(), lay = d.lay, many = items.length > 1;
  if (!copy && items.some((x) => x.p.lock)) { note(LOCKED); return null; }
  const curs = items.map((x) => placementOf(x.p)), box = A.unionBox(items.map(boxOf));
  const ctx = { many, box, cx: (box[0] + box[2]) / 2, cy: (box[1] + box[3]) / 2 };
  const nexts = items.map((x, k) => fn(x.part, curs[k], { ...ctx, k }));
  if (!copy && nexts.every((n, k) => PL.samePlacement(n, curs[k]))) return null;
  const name = many ? `${items.length} parts` : items[0].part.name;
  const g = startGesture(d, `${label} ${name}`);
  g.key = key;
  gMark(g);
  let idxs;
  if (copy) { const gm = {}; idxs = nexts.map((n) => { lay.placed.push(fresh(n, gm)); return lay.placed.length - 1; }); }
  else { idxs = gLooseMany(g, items.map((x) => x.i)); nexts.forEach((n, k) => { lay.placed[idxs[k]] = n; }); }
  gCommit(g);
  if (copy || pick) { state.mode = 'select'; state.pivot = centrePivot(); }
  selLooseMany = idxs; update();
  return { g, part: items[0].part, next: nexts[0], idx: idxs[0], idxs, lay, items, nexts, name, many };
}
/** Off-the-sheet wording for an edit's result: one part by name, several by count. */
function offNoteOf(r) {
  if (!r.many) return offNote(r.lay, r.part, r.next);
  const W = r.lay.s.sheetW, H = r.lay.s.sheetH;
  return offWords(r.items.filter((x, k) => PL.offSheet(x.part, r.nexts[k], W, H)).length, r.items.length);
}
const offWords = (n, total) => (n ? `${n} of the ${total} parts ${n === 1 ? 'is' : 'are'} off the sheet (drawn in orange). ${n === 1 ? 'It is' : 'They are'} still placed` : '');
const afterEdit = (r, text) => r && say(text, offNoteOf(r), loosenedNote(r.g));
const posText = (part, pl) => { const b = placedBox(part, pl); return `X ${fmt(b[0])} Y ${fmt(b[1])}`; };
/** Where an edit left the selection: the lower-left of its box. */
const resultPos = (r) => { const b = A.unionBox(r.items.map((x, k) => placedBox(x.part, r.nexts[k]))); return `X ${fmt(b[0])} Y ${fmt(b[1])}`; };
/** A custom pivot goes with the part when the part is moved. */
const carryPivot = (dx, dy) => { if (state.pivot.kind === 'custom') state.pivot = { kind: 'custom', x: PL.r6(state.pivot.x + dx), y: PL.r6(state.pivot.y + dy) }; };

/** X or Y typed: the lower-left of the part's box (or of the box round the selection) goes there. → '' or what is wrong. */
function setBoxPos(axis, text) {
  const v = PL.parseMm(text);
  if (v == null) return `${axis.toUpperCase()} must be a number in mm`;
  const b0 = selBox();
  if (!b0) return '';
  const dx = axis === 'x' ? v - b0[0] : 0, dy = axis === 'y' ? v - b0[1] : 0;
  const r = editSelected((part, pl) => PL.translate(pl, dx, dy), { label: 'Move' });
  if (r) { carryPivot(dx, dy); afterEdit(r, `${r.name} moved to ${resultPos(r)}`); }
  return '';
}
/** The Angle typed (top bar, Rotate section, command line): the part turns about its pivot to that angle; a selection of several turns by that angle about its middle. → '' or what is wrong. */
function setAngleText(text, copy = false) {
  const v = PL.parseAngle(text);
  if (v == null) return 'Angle must be a number in degrees';
  const r = editSelected((part, pl, c) => (c.many ? PL.rotateAbout(part, pl, [c.cx, c.cy], v) : PL.setAngleAbout(part, pl, pivotPoint(part, pl), v)), { copy, label: copy ? 'Copy and turn' : 'Turn' });
  if (r && r.many) afterEdit(r, `${r.name} ${copy ? 'copied and turned' : 'turned'} by ${+v.toFixed(2)}° about the middle of the selection`);
  else if (r) afterEdit(r, `${r.part.name} ${copy ? 'copied and turned' : 'turned'} to ${+r.next.rot.toFixed(2)}° about ${fmt(pivotPoint(r.part, r.next)[0])}, ${fmt(pivotPoint(r.part, r.next)[1])}`);
  return '';
}
function mirrorSel(axis) {
  const r = editSelected((part, pl, c) => (c.many ? PL.mirrorAboutPoint(part, pl, axis, c.cx, c.cy) : PL.mirrorAbout(part, pl, axis)), { label: 'Mirror ' + axis.toUpperCase() });
  if (r) afterEdit(r, `${r.name} mirrored ${axis === 'x' ? 'left to right (X)' : 'top to bottom (Y)'}`);
  else if (!selectedPlaced()) note('Mirror: select a placed part first');
}
function nudgeSel(dir, big) {
  const [dx, dy] = PL.nudgeVector(dir, state.nudge, big);
  const items = selItems();
  const r = items.length && editSelected((part, pl) => PL.translate(pl, dx, dy), { key: 'nudge:' + items.map((x) => x.p.src + x.p.i).join(','), label: 'Nudge' });
  if (r) { carryPivot(dx, dy); afterEdit(r, `${r.name} moved ${fmt(Math.hypot(dx, dy))} mm ${dir}: ${resultPos(r)}`); }
}
/** Delete: the selected placed parts go (a grid copy: the grid becomes placed parts first, the others stay). A locked part is not deleted. */
function deletePlaced() {
  const items = selItems();
  if (!items.length) { note('Delete: select a placed part first'); return; }
  if (items.some((x) => x.p.lock)) { note(LOCKED); return; }
  const d = curDoc(), name = items.length > 1 ? `${items.length} parts` : items[0].part.name;
  const g = startGesture(d, `Delete ${name}`);
  const idxs = gLooseMany(g, items.map((x) => x.i));
  gMark(g);
  [...idxs].sort((a, b) => b - a).forEach((i) => d.lay.placed.splice(i, 1));
  tidyGroups(d.lay);
  gCommit(g);
  state.mode = 'select'; state.pivot = centrePivot();
  update();
  say(`${name} deleted`, loosenedNote(g), 'Ctrl+Z brings ' + (items.length > 1 ? 'them' : 'it') + ' back');
}
/** Ctrl+D / Copy once: a copy 10 mm right and up (or left and down when that leaves the sheet), never exactly on another copy; the copy is selected. */
function duplicateOne() {
  const items = selItems();
  if (!items.length) { note('Duplicate: select a placed part first'); return; }
  const lay = curLay(), W = lay.s.sheetW, H = lay.s.sheetH;
  const clash = (x, q) => placedNow.some((o) => o.partId === x.p.partId && Math.abs(o.x - q.x) < 0.01 && Math.abs(o.y - q.y) < 0.01);
  const shifted = (dx, dy) => items.map((x) => PL.translate(placementOf(x.p), dx, dy));
  const anyOff = (qs) => qs.some((q, k) => PL.offSheet(items[k].part, q, W, H));
  const wasOff = anyOff(items.map((x) => placementOf(x.p)));
  let off = [10, 10];
  search: for (const sign of [1, -1]) {
    for (let k = 1; k <= 60; k++) {
      const qs = shifted(sign * 10 * k, sign * 10 * k);
      if (qs.some((q, j) => clash(items[j], q))) continue;
      if (sign === 1 && anyOff(qs) && !wasOff) break;
      off = [sign * 10 * k, sign * 10 * k];
      break search;
    }
  }
  const r = editSelected((part, pl) => PL.translate(pl, off[0], off[1]), { copy: true, label: 'Duplicate' });
  if (r) afterEdit(r, `${r.name} duplicated: the copy is at ${resultPos(r)}. Drag it where it should go`);
}
/** Duplicate: `count` copies in a row from the selected part (or the selection, as one box), along X or Y, `gap` mm apart edge to edge. Off the sheet they are still placed, with a warning. */
function duplicateRow() {
  const items = selItems();
  if (!items.length) { note('Duplicate: select a placed part first'); return; }
  const d = curDoc(), lay = d.lay, { dupAxis: axis, dupGap: gap, dupCount: count } = state;
  const offs = PL.rowOffsets(A.unionBox(items.map(boxOf)), axis, gap, count), name = items.length > 1 ? `${items.length} parts` : items[0].part.name;
  const g = startGesture(d, `Duplicate ×${count} ${name}`);
  gMark(g);
  // what is already on the sheet, to say when a copy lands on top of another part (by their boxes)
  const before = placedNow.map((p) => lay.parts[p.partId] && placedBox(lay.parts[p.partId], p)).filter(Boolean);
  const hits = (b) => before.some((o) => Math.min(b[2], o[2]) - Math.max(b[0], o[0]) > 0.01 && Math.min(b[3], o[3]) - Math.max(b[1], o[1]) > 0.01);
  let off = 0, over = 0;
  const last = [];
  offs.forEach(([dx, dy], k) => {
    const gm = {};
    let anyOff = false;
    last.length = 0;
    for (const x of items) {
      const q = PL.translate(placementOf(x.p), dx, dy);
      if (hits(placedBox(x.part, q))) over++;
      if (PL.offSheet(x.part, q, lay.s.sheetW, lay.s.sheetH)) anyOff = true;
      lay.placed.push(fresh(q, gm)); last.push(lay.placed.length - 1);
    }
    if (anyOff) off++;
  });
  gCommit(g);
  state.mode = 'select'; state.pivot = centrePivot();
  selLooseMany = last.slice(); update();
  say(`${count} ${count === 1 ? 'copy' : 'copies'} of ${name} ${{ x: 'to the right', '-x': 'to the left', y: 'upwards', '-y': 'downwards' }[axis]}, ${+gap.toFixed(3)} mm apart, edge to edge`,
    off ? `${off === count ? 'All' : off + ' of'} the ${count === 1 ? 'copy is' : 'copies are'} off the sheet (drawn in orange). ${off === 1 && count === 1 ? 'It is' : 'They are'} still placed` : '',
    over ? `${over === 1 ? '1 copy lands' : over + ' copies land'} on top of other parts` : '');
}
/** The Nudge step typed (top bar or Nudge section): mm above 0, kept on this PC. */
function setNudgeText(text) {
  const v = PL.parseMm(text);
  if (v == null || !(v > 0)) return 'The nudge step must be a number above 0 mm';
  state.nudge = v;
  try { localStorage.setItem('pd-nudge', String(v)); } catch { /* storage may be blocked */ }
  renderProps();
  note(`Nudge step ${fmt1(v)} mm: an arrow key moves the part by it, Shift + arrow by ${fmt1(v * 10)} mm`);
  return '';
}
function setDupText(key, text) {
  const v = PL.parseMm(text);
  if (key === 'dupCount') {
    if (v == null || !Number.isInteger(v) || v < 1 || v > 200) return 'Copies must be a whole number from 1 to 200';
    state.dupCount = v;
  } else {
    if (v == null || v < 0) return 'The distance between copies must be 0 or more (mm, edge to edge)';
    state.dupGap = v;
  }
  return '';
}
/** The Rotate section's pivot: Centre, Bottom-left or Custom (the point is then typed, or ◎ is dragged). */
function setPivotKind(kind) {
  const s = selectedPlaced();
  if (!s) return;
  const pt = pivotPoint(s.part, s.p);
  state.pivot = kind === 'custom' ? { kind, x: PL.r6(pt[0]), y: PL.r6(pt[1]) } : { kind, x: 0, y: 0 };
  renderProps(); drawTools(); renderCommand();
}
function setPivotText(axis, text) {
  const v = PL.parseMm(text);
  if (v == null) return `Pivot ${axis.toUpperCase()} must be a number in mm`;
  state.pivot = { kind: 'custom', x: axis === 'x' ? v : state.pivot.x, y: axis === 'y' ? v : state.pivot.y };
  renderProps(); drawTools(); renderCommand();
  return '';
}

// ---- Arrange (TODO 36): align and distribute the selected parts; a group is one object ----
/** Align (how: left, centre, right, top, middle, bottom) or distribute ('horizontal' / 'vertical': equal gaps) the selected parts, relative to the selection, the sheet or the first selected. */
function arrange(kind, how) {
  const items = selItems(), lay = curLay();
  if (items.length < 2) { note('Arrange: select two or more parts first (Shift-click, or drag a box round them)'); return; }
  if (items.some((x) => x.p.lock)) { note(LOCKED); return; }
  const rel = state.arrangeRel, sheet = [0, 0, lay.s.sheetW, lay.s.sheetH];
  const objs = A.objectsOf(items.map((x) => ({ g: x.p.g, box: boxOf(x) })));
  const boxes = objs.map((o) => o.box), relName = { selection: 'the selection', sheet: 'the sheet', first: 'the first selected' }[rel];
  let deltas, extra = '';
  if (kind === 'align') {
    if (objs.length < 2 && rel !== 'sheet') { note('Align: that is one object (a group). Pick Relative to: Sheet, or select another part'); return; }
    deltas = A.alignDeltas(boxes, how, rel, sheet, 0);
  } else {
    if (objs.length < 3) { note('Distribute needs three or more objects (a group counts as one)'); return; }
    const r = A.distributeDeltas(boxes, how === 'horizontal' ? 'x' : 'y', rel, sheet);
    deltas = r.deltas; extra = `, gaps of ${fmt(r.gap)} mm`;
  }
  const per = A.spreadToItems(objs, deltas, items.length);
  const r = editSelected((part, pl, c) => PL.translate(pl, per[c.k].dx, per[c.k].dy), { label: kind === 'align' ? 'Align ' + how : 'Distribute ' + how });
  if (!r) { note('Already ' + (kind === 'align' ? 'aligned' : 'evenly spaced') + ' (nothing moved)'); return; }
  afterEdit(r, kind === 'align' ? `${r.name} aligned ${how} to ${relName}` : `${r.name} distributed ${how}ly with equal gaps${extra} (${relName})`);
}
/** The Relative to select: Selection, Sheet or First selected (remembered for the session). */
function setArrangeRel(v) { state.arrangeRel = A.REL.includes(v) ? v : 'selection'; renderProps(); }

// ---- Group, Ungroup, Lock, Unlock (TODO 37) ----
/** Changes the flags (group, lock) of the selected parts, in one undo step: fn(placement) → the new placement. */
function editFlags(label, fn) {
  const items = selItems(), d = curDoc();
  if (!items.length) return null;
  const g = startGesture(d, label);
  gMark(g);
  const idxs = gLooseMany(g, items.map((x) => x.i));
  items.forEach((x, k) => { d.lay.placed[idxs[k]] = fn(placementOf(x.p)); });
  tidyGroups(d.lay);
  gCommit(g);
  selLooseMany = idxs; update();
  return { g, idxs, n: items.length };
}
function groupSel() {
  const items = selItems();
  if (items.length < 2) { note('Group: select two or more parts first (Shift-click, or drag a box round them)'); return; }
  if (wholeGroup()) { note('These parts are one group already (Ctrl+Shift+G ungroups)'); return; }
  const id = newGroupId();
  const r = editFlags(`Group ${items.length} parts`, (pl) => ({ ...pl, g: id }));
  say(`Grouped ${r.n} parts: a click on one selects the group, and it moves, turns and copies as one (Ctrl+Shift+G ungroups)`, loosenedNote(r.g));
}
function ungroupSel() {
  const items = selItems();
  if (!items.length) { note('Ungroup: select a group first'); return; }
  if (!items.some((x) => x.p.g)) { note('Ungroup: the selection holds no group'); return; }
  const n = items.filter((x) => x.p.g).length;
  const r = editFlags(`Ungroup ${n} parts`, (pl) => { const { g, ...rest } = pl; return rest; });
  say(`Ungrouped: ${n} parts are separate again, still selected`, loosenedNote(r.g));
}
function lockSel(on) {
  const items = selItems();
  if (!items.length) { note((on ? 'Lock' : 'Unlock') + ': select a placed part first'); return; }
  if (items.every((x) => !!x.p.lock === on)) { note(items.length > 1 ? `These parts are ${on ? 'locked' : 'unlocked'} already` : `${items[0].part.name} is ${on ? 'locked' : 'unlocked'} already`); return; }
  const name = items.length > 1 ? `${items.length} parts` : items[0].part.name;
  const r = editFlags(`${on ? 'Lock' : 'Unlock'} ${name}`, (pl) => { if (on) return { ...pl, lock: true }; const { lock, ...rest } = pl; return rest; });
  say(on ? `${name} locked: it cannot be moved, turned, mirrored or deleted until you unlock it` : `${name} unlocked`, loosenedNote(r.g));
}

/** A rubber band on the sheet of a layout ended: the parts (groups) fully inside are selected; Shift adds them to the selection. */
function layoutBoxSelect(r, e) {
  const lay = curLay();
  if (!lay) return;
  if (!r.moved) { if (selIdxs().length > 1 && !r.shift) { selectMany(groupIdxs(state.sel), state.sel); update(); note('Selection: just the main part'); } return; }
  const a = sheetAt(r.x, r.y), b = sheetAt(e.clientX, e.clientY), t = 1e-6;
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const seen = new Set(), hits = [];
  placedNow.forEach((p, i) => {
    if (seen.has(i) || partHid(p)) return;
    const grp = groupIdxs(i).filter((k) => !partHid(placedNow[k]));
    grp.forEach((k) => seen.add(k));
    const bx = A.unionBox(grp.map((k) => placedBox(lay.parts[placedNow[k].partId], placedNow[k])));
    if (bx[0] >= x0 - t && bx[2] <= x1 + t && bx[1] >= y0 - t && bx[3] <= y1 + t) hits.push(...grp);
  });
  if (!hits.length) { note('No part lies fully inside that box (a box selects what it holds completely)'); return; }
  const cur = r.shift ? selIdxs() : [];
  selectMany([...cur, ...hits.filter((k) => !cur.includes(k))]);
  update();
  const n = selIdxs().length;
  note(`${n} part${n === 1 ? '' : 's'} selected` + (n > 1 ? ' (the numbers show the order they were picked)' : ''));
}
/** Right-click on the sheet of a layout: on a part, the things to do with it. */
function layoutMenu(e) {
  const hit = e.target.closest && e.target.closest('[data-i]');
  if (hit) { const i = Number(hit.dataset.i); if (!selIdxs().includes(i)) { selectMany(groupIdxs(i), i); update(); } }
  const items = selItems();
  if (!items.length) return;
  const many = items.length > 1;
  popMenu(e.clientX, e.clientY, [['Duplicate', duplicateOne, 'Ctrl+D'], ['Mirror X', () => mirrorSel('x'), 'MX'], '-',
    ['Group', groupSel, 'Ctrl+G', many && !wholeGroup()], ['Ungroup', ungroupSel, 'Ctrl+Shift+G', items.some((x) => x.p.g)],
    ['Lock', () => lockSel(true), null, items.some((x) => !x.p.lock)], ['Unlock', () => lockSel(false), null, items.some((x) => x.p.lock)], '-', ['Delete', deletePlaced, 'Del']]);
}

// ---- Rulers and guides (TODO 38; mock-up R4c): mm rulers along the top and left of the canvas; guides are dragged out of them ----
const RULER = 22;                       // the width of a ruler, in screen px
let gdrag = null;                       // a guide being dragged: { axis, idx, isNew, x, y, moved, g (the undo step), orig, over (the pointer is on its ruler: it goes) }

/** The marks of both rulers, in mm from the sheet's bottom-left (y up), drawn again with every change of the view. */
function drawRulers() {
  if (!ui.rulerTop) return;
  const on = state.rulers;
  ui.rulerTop.hidden = ui.rulerLeft.hidden = ui.rulerCorner.hidden = !on;
  if (!on) return;
  const { w, h: ch } = canvasSize(), sc = view.scale, H = state.sheetH;
  const tx = G.rulerTicks(view.ox, view.ox + w / sc, sc), dx = [], lx = [];
  for (const k of tx.ticks) {
    const px = (k.v - view.ox) * sc;
    if (px < RULER) continue;
    dx.push(`M${px.toFixed(1)} ${RULER}v${k.major ? -14 : -6}`);
    if (k.major) lx.push(s('text', { x: (px + 3).toFixed(1), y: 10 }, G.tickLabel(k.v)));
  }
  ui.rulerTop.replaceChildren(s('svg', { width: Math.max(0, w - RULER), height: RULER, viewBox: `${RULER} 0 ${Math.max(0, w - RULER)} ${RULER}` }, s('path', { d: dx.join('') }), lx));
  const lo = H - (view.oy + ch / sc), hi = H - view.oy, ty = G.rulerTicks(lo, hi, sc), dy = [], ly = [];
  for (const k of ty.ticks) {
    const py = (H - k.v - view.oy) * sc;
    if (py < RULER) continue;
    dy.push(`M${RULER} ${py.toFixed(1)}h${k.major ? -14 : -6}`);
    if (k.major) ly.push(s('text', { x: 10, y: (py - 4).toFixed(1), transform: `rotate(-90 10 ${(py - 4).toFixed(1)})` }, G.tickLabel(k.v)));
  }
  ui.rulerLeft.replaceChildren(s('svg', { width: RULER, height: Math.max(0, ch - RULER), viewBox: `0 ${RULER} ${RULER} ${Math.max(0, ch - RULER)}` }, s('path', { d: dy.join('') }), ly));
}

/** The guides of the open layout as dashed lines across the whole view, each with its position beside it; hit lines to pick and drag them. */
function drawGuides() {
  const g = ui.gGuides, lay = curLay();
  if (!g) return;
  if (!lay || !lay.s.guidesShow || !lay.s.guides.length) { g.replaceChildren(); return; }
  const { w, h: ch } = canvasSize(), k = 1 / view.scale, H = state.sheetH, out = [];
  const x0 = view.ox, x1 = view.ox + w * k, y0 = view.oy, y1 = view.oy + ch * k;
  const snapped = (pdrag && pdrag.snapped) || [];
  lay.s.guides.forEach((gd, i) => {
    const hot = snapped.some((q) => q.axis === gd.axis && Math.abs(q.mm - gd.mm) < 1e-6);
    const going = gdrag && gdrag.idx === i && gdrag.over;
    const cls = 'guide' + (hot ? ' snapped' : '') + (going ? ' going' : '') + (gdrag && gdrag.idx === i && gdrag.moved ? ' drag' : '');
    const label = G.guideText(gd);
    if (gd.axis === 'x') {
      out.push(s('line', { class: cls, x1: gd.mm, x2: gd.mm, y1: y0, y2: y1 }),
        s('line', { class: 'guide-hit' + (lay.s.guidesLock ? ' locked' : ''), 'data-guide': i, 'data-axis': 'x', x1: gd.mm, x2: gd.mm, y1: y0, y2: y1 }),
        s('text', { class: 'guide-label', x: gd.mm + 6 * k, y: y0 + 40 * k, 'font-size': 13 * k }, label + (hot ? ' · snaps to guides' : '')));
    } else {
      const Y = H - gd.mm;
      out.push(s('line', { class: cls, x1: x0, x2: x1, y1: Y, y2: Y }),
        s('line', { class: 'guide-hit' + (lay.s.guidesLock ? ' locked' : ''), 'data-guide': i, 'data-axis': 'y', x1: x0, x2: x1, y1: Y, y2: Y }),
        s('text', { class: 'guide-label', x: x1 - 8 * k, y: Y - 6 * k, 'font-size': 13 * k, 'text-anchor': 'end' }, label + (hot ? ' · snaps to guides' : '')));
    }
  });
  g.replaceChildren(...out);
}

/** A part being dragged near a guide lands on it (the SNAP toggle also switches this off). → the move to use and the guides it landed on. */
function snapToGuides(p, dx, dy) {
  const lay = curLay();
  if (!lay || !state.snap || !lay.s.guidesShow || !lay.s.guides.length) return { dx, dy, hit: null };
  const u = A.unionBox(p.items.map((x) => placedBox(x.part, x.orig))), straight = !!p.straight;
  const sn = G.snapBoxToGuides([u[0] + dx, u[1] + dy, u[2] + dx, u[3] + dy], lay.s.guides, 6 / view.scale, { skipX: straight && dx === 0, skipY: straight && dy === 0 });
  return { dx: r2(dx + sn.dx), dy: r2(dy + sn.dy), hit: sn.hits.length ? sn.hits : null };
}

/** One change to the guides, kept for undo: fn() changes lay.s.guides. */
function editGuides(label, fn) {
  const d = curDoc(), lay = d && d.lay;
  if (!lay) return false;
  const g = startGesture(d, label);
  gMark(g);
  fn(lay.s.guides);
  gCommit(g);
  update();
  return true;
}
function addGuide(axis, mm) {
  const lay = curLay();
  if (!lay) { note('Guides belong to a layout tab'); return; }
  const at = G.freeSpot(lay.s.guides, axis, mm != null ? mm : Math.round(axis === 'y' ? lay.s.sheetH / 2 : lay.s.sheetW / 2));
  if (lay.s.guides.length >= G.MAX_GUIDES) { note(`A layout can have ${G.MAX_GUIDES} guides`); return; }
  editGuides('Add guide', (list) => { list.push({ axis, mm: at }); lay.s.guidesShow = true; });
  note(`${axis === 'y' ? 'Horizontal' : 'Vertical'} guide at ${G.guideText({ axis, mm: at })}: type its position in the Guides section, or drag it`);
  const rows = ui.guideList.querySelectorAll('input.fld');
  const inp = rows[rows.length - 1];
  if (inp) { inp.focus(); inp.select(); }
}
function deleteGuide(i) {
  const lay = curLay(), gd = lay && lay.s.guides[i];
  if (!gd) return;
  editGuides('Delete guide', (list) => { list.splice(i, 1); });
  note(`Guide ${G.guideText(gd)} deleted`);
}
function setGuidePos(i, text) {
  const lay = curLay(), gd = lay && lay.s.guides[i], v = PL.parseMm(text);
  if (!gd) return '';
  if (v == null) return `A guide's position must be a number in mm`;
  if (Math.abs(v - gd.mm) < 1e-9) return '';
  editGuides('Move guide', (list) => { list[i] = { ...gd, mm: PL.r6(v) }; });
  note(`Guide moved to ${G.guideText(lay.s.guides[i])}`);
  return '';
}
function clearGuides() {
  const lay = curLay();
  if (!lay || !lay.s.guides.length) { note('There are no guides to clear'); return; }
  const n = lay.s.guides.length;
  editGuides('Clear guides', (list) => { list.length = 0; });
  note(`${n} guide${n === 1 ? '' : 's'} cleared. Ctrl+Z brings ${n === 1 ? 'it' : 'them'} back`);
}
function setGuidesShow(on) {
  const lay = curLay();
  if (!lay) { note('Guides belong to a layout tab'); return; }
  lay.s.guidesShow = on; touch(); update();
  note(on ? 'Guides shown' : 'Guides hidden (they are still there, and saved)');
}
function setGuidesLock(on) {
  const lay = curLay();
  if (!lay) { note('Guides belong to a layout tab'); return; }
  lay.s.guidesLock = on; touch(); update();
  note(on ? 'Guides locked: they cannot be dragged' : 'Guides unlocked');
}
function setRulers(on) {
  state.rulers = on;
  try { localStorage.setItem('pd-rulers', on ? '1' : '0'); } catch { /* storage may be blocked */ }
  if (view.fitted) fit(); else { drawRulers(); }
  renderGuidePanel();
  note(on ? 'Rulers on: millimetres, 0,0 at the sheet\'s bottom-left, Y counts up' : 'Rulers off');
}

/** The Guides and Rulers sections of the right panel: a position field and a delete button per guide, add, Show, Lock, Clear all. */
function renderGuidePanel() {
  if (!ui.guideSec) return;
  const lay = curLay(), lib = state.panel === 'library';
  ui.guideSec.hidden = ui.rulerSec.hidden = !lay || lib;
  if (!lay || lib) return;
  const sig = lay.s.guides.map((q) => q.axis + q.mm).join(',');
  if (ui.guideSig !== sig || ui.guideLay !== lay) {
    ui.guideSig = sig; ui.guideLay = lay;
    ui.guideList.replaceChildren(...lay.s.guides.map((gd, i) => {
      const input = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', value: fmt(gd.mm), 'data-testid': 'guide-pos', 'aria-label': `${gd.axis.toUpperCase()} guide position in millimetres` });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } else if (e.key === 'Escape') { input.value = fmt(gd.mm); input.blur(); } });
      input.addEventListener('change', () => { const why = setGuidePos(i, input.value); if (why) { input.value = fmt(gd.mm); note(why); } });
      return h('div', { class: 'row guiderow', 'data-testid': 'guide-row', 'data-axis': gd.axis },
        h('span', { class: 'mono gax' }, gd.axis.toUpperCase()), input,
        h('button', { class: 'ib', type: 'button', 'data-testid': 'guide-del', 'aria-label': `Delete guide ${G.guideText(gd)}`, title: 'Delete this guide', onclick: () => deleteGuide(i) }, icon('<path d="M5 5l14 14M19 5L5 19"/>', { size: 14, width: 1.8, cap: 'round' })));
    }));
  }
  ui.guideEmpty.hidden = lay.s.guides.length > 0;
  ui.guidesShowSw.checked = lay.s.guidesShow; ui.guidesLockSw.checked = lay.s.guidesLock; ui.rulersSw.checked = state.rulers;
  ui.guideClear.disabled = !lay.s.guides.length;
}

/** Pointer down on a ruler (a new guide) or on a guide (move it): the drag follows the pointer until it is let go. */
function guideDown(e, axis, idx) {
  const lay = curLay();
  if (!lay) { note('Guides belong to a layout tab: open or make a layout first'); return; }
  if (lay.s.guidesLock) { note('Guides are locked: View → Lock guides, or the switch in the Guides section, unlocks them'); return; }
  gdrag = { axis, idx, isNew: idx == null, x: e.clientX, y: e.clientY, moved: false, g: null, orig: idx != null ? lay.s.guides[idx].mm : null, over: false };
}
function guideMove(e) {
  const p = gdrag, lay = curLay(), d = curDoc();
  if (!p || !lay) return;
  if (!p.moved) {
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 3) return;
    p.moved = true; p.g = startGesture(d, p.isNew ? 'Add guide' : 'Move guide'); gMark(p.g);
    if (p.isNew) { lay.s.guides.push({ axis: p.axis, mm: 0 }); p.idx = lay.s.guides.length - 1; lay.s.guidesShow = true; }
  }
  const r = ui.canvas.getBoundingClientRect();
  p.over = p.axis === 'y' ? e.clientY < r.top + RULER : e.clientX < r.left + RULER;           // back on its own ruler: it goes
  const here = sheetAt(e.clientX, e.clientY), gd = lay.s.guides[p.idx];
  gd.mm = r2(p.axis === 'x' ? here[0] : here[1]);
  state.guideDrag = p;
  ui.guideTip.hidden = false;
  ui.guideTip.textContent = p.over ? 'Release to delete' : G.guideText(gd);
  ui.guideTip.style.left = Math.min(e.clientX - r.left + 16, r.width - 110) + 'px'; ui.guideTip.style.top = Math.max(RULER + 4, e.clientY - r.top - 34) + 'px';
  drawGuides(); renderCommand();
}
function guideUp() {
  const p = gdrag, lay = curLay();
  gdrag = null; state.guideDrag = null; ui.guideTip.hidden = true;
  if (!p || !p.moved || !lay) return;
  const gd = lay.s.guides[p.idx];
  if (p.over) {
    lay.s.guides.splice(p.idx, 1);
    if (p.isNew) { drawGuides(); renderGuidePanel(); renderCommand(); note('No guide made: it was dropped back on the ruler'); return; }
    p.g.label = 'Delete guide'; gCommit(p.g); update(); note(`Guide ${G.guideText(gd)} deleted: dropped on the ruler`);
    return;
  }
  gCommit(p.g); update();
  note(`Guide ${G.guideText(gd)} ${p.isNew ? 'placed' : 'moved'}`);
}
/** Esc during a guide drag: the guide goes back (a new one is not made). */
function cancelGuideDrag() {
  const p = gdrag, lay = curLay();
  gdrag = null; state.guideDrag = null; ui.guideTip.hidden = true;
  if (p && p.moved && lay) { if (p.isNew) lay.s.guides.splice(p.idx, 1); else lay.s.guides[p.idx].mm = p.orig; }
  drawGuides(); renderGuidePanel(); note('Guide cancelled');
}
/** Right-click on a guide: Delete guide, Lock guides, Hide guides. */
function guideMenu(e, idx) {
  const lay = curLay();
  if (!lay || !lay.s.guides[idx]) return;
  popMenu(e.clientX, e.clientY, [['Delete guide', () => deleteGuide(idx), null, !lay.s.guidesLock], [lay.s.guidesLock ? 'Unlock guides' : 'Lock guides', () => setGuidesLock(!lay.s.guidesLock)], ['Hide guides', () => setGuidesShow(false)]]);
}

// the pointer on the sheet: press a part to select it, drag it to move it, press it again to turn it by hand
let updQueued = 0;
function queueUpdate() {
  if (updQueued) return;
  updQueued = requestAnimationFrame(() => { updQueued = 0; if (pdrag && pdrag.idxs) selLooseMany = pdrag.idxs; update(); });
}
function flushUpdate() { if (updQueued) { cancelAnimationFrame(updQueued); updQueued = 0; } }

/** A press on the sheet of a layout. → true when it was on a placed part, a turn arrow or the pivot. */
function placedDown(e) {
  const lay = curLay();
  let tgt = e.target;
  if (tgt && tgt.closest && tgt.closest('[data-guide]')) tgt = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !el.closest('[data-guide]')) || tgt;       // a locked guide does not catch the press: what is under it does
  if (!lay || !tgt || !tgt.closest) return false;
  const rotEl = tgt.closest('[data-rot]'), pivEl = tgt.closest('[data-pivot]'), hit = tgt.closest('[data-i]');
  const here = sheetAt(e.clientX, e.clientY);
  let s = selectedPlaced();
  if (s && rotEl) {
    const pivot = pivotPoint(s.part, s.p), a0 = PL.angleOf(pivot, here);
    if (s.p.lock) { note(LOCKED); return true; }
    pdrag = { kind: 'rotate', cx: e.clientX, cy: e.clientY, orig: placementOf(s.p), pivot, a0, last: a0, acc: 0, moved: false, g: null, idx: null };
    return true;
  }
  if (s && pivEl) { pdrag = { kind: 'pivot' }; return true; }
  if (hit) {
    const i = Number(hit.dataset.i), cur = selIdxs(), inSel = cur.includes(i);
    const add = e.shiftKey && !e.ctrlKey && !e.metaKey;            // Shift-click adds a part or takes it out (a Shift-drag still moves them straight)
    const grp = groupIdxs(i);
    let toggle = null, was = cur.length === 1 && cur[0] === i && grp.length === 1;
    if (add) {
      if (inSel) toggle = i;
      else { selectMany([...cur, ...grp.filter((k) => !cur.includes(k))], i); update(); }
    } else if (!inSel || !grp.every((k) => cur.includes(k))) { selectMany(grp, i); update(); }
    s = selectedPlaced();
    if (!s) return true;
    const items = selItems();
    pdrag = { kind: 'move', cx: e.clientX, cy: e.clientY, start: here, items: items.map((x) => ({ i: x.i, part: x.part, orig: placementOf(x.p) })), copy: e.ctrlKey || e.metaKey, wasSel: was && !add, add, toggle, hitI: i, moved: false, g: null, idx: null, idxs: null, pivot0: [state.pivot.x, state.pivot.y] };
    return true;
  }
  if (state.mode === 'rotate') { state.mode = 'select'; update(); }
  return false;
}
function placedMove(e) {
  const p = pdrag, lay = curLay(), s = selectedPlaced();
  if (!p || !lay || !s) return;
  const here = sheetAt(e.clientX, e.clientY);
  if (p.kind === 'pivot') {
    state.pivot = { kind: 'custom', x: r2(here[0]), y: r2(here[1]) };
    drawTools(); renderProps(); renderCommand();
    return;
  }
  if (p.kind === 'move') {
    if (!p.moved) {
      if (Math.hypot(e.clientX - p.cx, e.clientY - p.cy) <= 4) return;
      if (!p.copy && p.items.some((x) => x.orig.lock)) { pdrag = null; note(LOCKED); return; }
      const name = p.items.length > 1 ? `${p.items.length} parts` : s.part.name, gm = {};
      p.moved = true; p.g = startGesture(s.d, (p.copy ? 'Copy ' : 'Move ') + name); gMark(p.g);
      p.base = p.items.map((x) => (p.copy ? fresh(x.orig, gm) : x.orig));
      if (p.copy) p.idxs = p.base.map((b) => { lay.placed.push({ ...b }); return lay.placed.length - 1; });
      else { p.idxs = gLooseMany(p.g, p.items.map((x) => x.i)); p.ghosts = p.items.map((x) => ({ part: x.part, pl: x.orig })); }
      p.idx = p.idxs[0];
    }
    const to = e.shiftKey || state.ortho ? Ed.orthoLock(p.start, here) : here;           // Shift: straight along X or Y from where it was picked up
    let dx = r2(to[0] - p.start[0]), dy = r2(to[1] - p.start[1]);
    p.straight = !!(e.shiftKey || state.ortho);
    const sn = snapToGuides(p, dx, dy);
    dx = sn.dx; dy = sn.dy; p.snapped = sn.hit;
    p.items.forEach((x, k) => { lay.placed[p.idxs[k]] = PL.translate(p.base[k], dx, dy); });
    p.dx = dx; p.dy = dy;
    if (state.pivot.kind === 'custom') state.pivot = { kind: 'custom', x: PL.r6(p.pivot0[0] + dx), y: PL.r6(p.pivot0[1] + dy) };
    if (p.copy) { state.mode = 'select'; }
    selLooseMany = p.idxs; queueUpdate();
    return;
  }
  // turning by hand: the angle from the pivot to the pointer, added up so a drag can go round more than once
  const a = PL.angleOf(p.pivot, here);
  p.acc += PL.turnBetween(p.last, a); p.last = a;
  if (!p.moved) {
    if (Math.hypot(e.clientX - p.cx, e.clientY - p.cy) <= 3) return;
    p.moved = true; p.g = startGesture(s.d, 'Turn ' + s.part.name); gMark(p.g);
    p.idx = gLoose(p.g, state.sel); p.idxs = [p.idx]; p.ghost = p.orig;
  }
  let turn = p.acc;
  if (e.shiftKey) { turn = PL.snapAngle(p.orig.rot + p.acc) - p.orig.rot; turn += 360 * Math.round((p.acc - turn) / 360); }       // Shift: the angle lands on a multiple of 15°
  lay.placed[p.idx] = PL.rotateAbout(s.part, p.orig, p.pivot, turn);
  p.label = { text: fmt1(lay.placed[p.idx].rot) + '°' };
  selLooseMany = p.idxs; queueUpdate();
}
function placedUp() {
  const p = pdrag;
  pdrag = null;
  if (!p) return;
  flushUpdate();
  if (p.kind === 'pivot') { update(); return; }
  if (!p.moved) {
    if (p.kind !== 'move') return;
    if (p.toggle != null) {                                        // Shift-click on a selected part: out it goes (its whole group)
      const out = new Set(groupIdxs(p.toggle)), rest = selIdxs().filter((k) => !out.has(k));
      if (rest.length) { selectMany(rest); update(); note(`${rest.length} part${rest.length === 1 ? '' : 's'} selected`); }
      else note('A selection needs at least one part');
      return;
    }
    // a click on a part of a selection of several: just that part (its group); on the part that was already selected: turn arrows on; once more: back to the size handles
    if (p.add) return;                                             // Shift-click added it: that is all
    if (!p.copy && selIdxs().length > 1) { selectMany(groupIdxs(p.hitI), p.hitI); update(); return; }
    if (p.wasSel && !p.copy) {
      if (selectedPlaced().p.lock) { note(LOCKED); return; }
      state.mode = state.mode === 'rotate' ? 'select' : 'rotate'; state.pivot = centrePivot(); state.rotCopy = false;
      update();
      if (state.mode === 'select') note('Rotate done');
    }
    return;
  }
  gCommit(p.g);
  selLooseMany = p.idxs; update();
  const s = selectedPlaced();
  if (!s) return;
  const n = p.items ? p.items.length : 1, name = n > 1 ? `${n} parts` : s.part.name;
  if (p.kind === 'move') {
    const b = selBox();
    say(`${name} ${p.copy ? 'copied' : 'moved'} to X ${fmt(b[0])} Y ${fmt(b[1])}`, n > 1 ? offNoteMany() : offNote(s.lay, s.part, s.p), loosenedNote(p.g));
  } else say(`${s.part.name} turned to ${+Number(s.p.rot).toFixed(2)}°`, offNote(s.lay, s.part, s.p), loosenedNote(p.g));
}
/** Off-the-sheet wording for the selection of several (after a drag). */
function offNoteMany() {
  const items = selItems();
  return offWords(items.filter((x) => x.p.off).length, items.length);
}
/** Esc during a drag: the part goes back where it was. */
function cancelPlacedDrag() {
  const p = pdrag;
  pdrag = null;
  flushUpdate();
  if (p && p.moved && p.g && p.g.snap) { layRestore(p.g.d, p.g.snap, p.g.dirty); note('Cancelled'); } else update();
}

function renderStep() {
  const lay = curLay(), s = state, on = s.fit;
  const label = (p) => `${p.name} · ${fmtSize(p.w)} × ${fmtSize(p.h)}`;
  const own = lay ? Object.values(lay.parts) : [], rest = lay ? lib.items.filter((r) => !lay.parts[r.id]) : [];
  ui.partSel.replaceChildren(h('option', { value: '' }, lay && own.length + rest.length ? 'No grid' : 'No parts yet'),
    ...own.map((p) => h('option', { value: p.id }, label(p))),
    ...rest.map((r) => h('option', { value: 'lib:' + r.id }, `${r.name} · ${fmtSize(r.w)} × ${fmtSize(r.h)} (library)`)));
  ui.partSel.value = lay && s.gridPart && lay.parts[s.gridPart] ? s.gridPart : '';
  ui.partSel.disabled = !lay;
  ui.fit.checked = on; ui.fit.disabled = !lay;
  ui.fitText.textContent = on ? 'On' : 'Off';
  ui.rows.readOnly = ui.cols.readOnly = on;
  if (document.activeElement !== ui.rows) ui.rows.value = String(on ? layout.rows : s.rows);
  if (document.activeElement !== ui.cols) ui.cols.value = String(on ? layout.cols : s.cols);
  ui.count.textContent = String(layout.count);
  ui.grid.textContent = layout.count ? `${on ? 'fit' : 'placed'} · ${layout.cols} × ${layout.rows}` + (layout.rotated ? ' · 90°' : '') : '';
  ui.pctSheet.textContent = layout.count ? Math.round(layout.usedPct) + '% of sheet' : '';
  const bad = layout.count > 0 && !layout.fits;
  ui.fitNote.hidden = !bad;
  ui.fitNote.textContent = bad ? `Does not fit: the grid is ${fmtSize(layout.gridW)} × ${fmtSize(layout.gridH)} mm, the usable area ${fmtSize(layout.area.w)} × ${fmtSize(layout.area.h)} mm.` : '';
  ui.stepHint.textContent = !lay ? '' : !s.gridPart ? 'Pick a part to repeat over the sheet, or add parts from the Parts library.' : !layout.count && on ? 'The part is larger than the usable area.' : '';
  ui.stepFoot.classList.toggle('idle', !!lay && !s.gridPart);     // no grid part: just the hint, not a floating "0" and a greyed Apply
  ui.applyBtn.disabled = !lay || !layout.count;
  ui.applyBtn.title = !lay ? 'Apply is on a layout tab' : !s.gridPart ? 'Pick a part for step and repeat first' : '';
  ui.sheetSec.querySelectorAll('input[data-key]').forEach((el) => { el.disabled = !lay; });
}

function renderPartsList() {
  const lay = curLay();
  const uses = LD.usesOf(placedNow);
  ui.partRows.replaceChildren(...(lay ? Object.values(lay.parts) : []).map((p) =>
    h('div', { class: 'prow', 'data-part-id': p.id },
      h('span', { class: 'nm' }, p.name),
      h('span', { class: 'lbl mono', 'data-testid': 'part-size', title: 'Size in mm, and how many copies are on the layout' }, `${fmtSize(p.w)} × ${fmtSize(p.h)} · ${uses[p.id] || 0} ${(uses[p.id] || 0) === 1 ? 'copy' : 'copies'}`),
      h('button', { class: 'tog', type: 'button', 'aria-label': 'Take ' + p.name + ' off this layout', 'data-part-remove': p.id, onclick: () => removeFromLayout(p.id) }, '×'))));
  if (!lay) return;
  if (!Object.keys(lay.parts).length) ui.partRows.append(h('span', { class: 'lbl' }, 'None yet.'));
}

// ---- the Parts library: saved parts, inside the app (IndexedDB), each as its DXF text with a name, size and thumbnail ----
const lib = { items: [], q: '', failed: false };
const libCache = new Map();
/** A saved part as a part (drawing and all), or null if it cannot be read. */
function libPart(rec) {
  let p = libCache.get(rec.id);
  if (!p) { p = LD.partFromDxf(rec.id, rec.name, rec.dxf); if (p) { p.src = rec.source || ''; libCache.set(rec.id, p); } }
  return p;
}
async function libInit() {
  try { const saved = await loadParts(); lib.items = [...saved, ...lib.items.filter((r) => !saved.some((s) => s.id === r.id))]; } catch (err) { lib.failed = true; console.warn('Parts library: storage is not available:', err); }
  renderLibrary(); renderStep();
}
/** Saves a record: in the list at once, in storage as well. False if storage failed: the part then stays in the library until the app is closed. */
async function libAdd(rec) {
  const i = lib.items.findIndex((r) => r.id === rec.id);
  if (i >= 0) lib.items[i] = rec; else lib.items.push(rec);
  renderLibrary(); renderStep();
  try { await savePart(rec); return true; } catch (err) { console.warn('Parts library: could not save:', err); lib.failed = true; renderLibrary(); return false; }
}
const KEPT_ONLY_NOW = ' (this PC\'s storage is not available: it stays until the app is closed)';
/** A part of an opened layout the library does not have (by name) is added to it. */
function libKeep(part, source) {
  if (!part || lib.items.some((r) => r.id === part.id || r.name.toLowerCase() === part.name.toLowerCase())) return;
  try { libAdd({ id: part.id, name: part.name, w: part.w, h: part.h, dxf: LD.partToDxf(part), thumb: thumbFor(part), source, t: Date.now() }).catch(() => {}); } catch { /* the layout is open; the library is a convenience */ }
}

/** A small picture of the part for its card: black on white, as it prints. */
function thumbFor(part) {
  try {
    const W = 168, H = 108, P = 8, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const sc = Math.min((W - 2 * P) / part.w, (H - 2 * P) / part.h), f = part.factor || 1, [b0, b1] = part.box;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    paintDrawing(c, { keep: true, fl: part.fl, off: part.off || new Set(), factor: f, sheetH: part.h, ox: (part.w - W / sc) / 2, oy: (part.h - H / sc) / 2, scale: sc, w: W, h: H, dpr: 1, dark: false,
      slots: [[f, 0, 0, -f, -b0 * f, part.h + b1 * f]] });
    return c.toDataURL('image/png');
  } catch { return ''; }
}

function buildLibrary() {
  ui.libSearch = h('input', { class: 'fld', type: 'text', placeholder: 'Search by name', 'aria-label': 'Search parts by name', 'data-testid': 'lib-search', autocomplete: 'off' });
  ui.libSearch.addEventListener('input', () => { lib.q = ui.libSearch.value.trim().toLowerCase(); renderLibrary(); });
  ui.libList = h('div', { class: 'liblist', 'data-testid': 'lib-list' });
  ui.libFoot = h('span', { class: 'lbl', 'data-testid': 'lib-foot' });
  return ui.libSec = h('section', { class: 'libbox', 'data-testid': 'library', hidden: true },
    h('label', { class: 'field' }, 'Search', ui.libSearch), ui.libList, ui.libFoot);
}
function showLibrary() { state.panel = 'library'; applyKind(); renderLibrary(); renderProps(); }

function renderLibrary() {
  if (!ui.libList) return;
  const shown = lib.items.filter((r) => !lib.q || r.name.toLowerCase().includes(lib.q));
  ui.libList.replaceChildren(...shown.map((rec) => {
    const more = h('button', { class: 'tog', type: 'button', 'aria-label': 'Part menu for ' + rec.name, title: 'Rename, Export, Delete', 'data-testid': 'lib-menu' }, '⋯');
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = more.getBoundingClientRect();
      popMenu(r.left, r.bottom + 2, [['Add to sheet', () => addLibToSheet(rec)], ['Export .dxf…', () => exportPart(rec)], ['Rename…', () => renamePart(rec)], ['Delete from library', () => deletePart(rec)]]);
    });
    const card = h('div', { class: 'card', 'data-part-id': rec.id, 'data-name': rec.name, draggable: 'true', title: 'Drag onto the sheet, or press Add to sheet' },
      /^data:image\/png;base64,/.test(rec.thumb || '') ? h('img', { class: 'thumb', src: rec.thumb, alt: '', draggable: 'false' }) : h('div', { class: 'thumb none' }),
      h('strong', { class: 'cname' }, rec.name),
      h('span', { class: 'lbl mono', 'data-testid': 'lib-size' }, `${fmt(rec.w)} × ${fmt(rec.h)}`),
      h('span', { class: 'lbl' }, rec.source || ''),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', 'data-testid': 'lib-add', onclick: () => addLibToSheet(rec) }, 'Add to sheet'), more));
    card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-pd-part', rec.id); e.dataTransfer.setData('text/plain', rec.name); e.dataTransfer.effectAllowed = 'copy'; });
    return card;
  }));
  const n = lib.items.length;
  ui.libFoot.textContent = (lib.q ? `${shown.length} of ${n} parts` : `${n} part${n === 1 ? '' : 's'}`) + (lib.failed ? ' · storage is not available here, so parts last until the app is closed.' : ' · saved inside the app.') + ' Drag a card onto the sheet, or Add to sheet.';
  if (!n) ui.libList.append(h('span', { class: 'lbl' }, 'Nothing saved yet. Click an outline in a drawing and press Extract part….'));
  else if (!shown.length) ui.libList.append(h('span', { class: 'lbl', 'data-testid': 'lib-nomatch' }, `No part matches "${ui.libSearch.value.trim()}"`));
}

/** Add to sheet: a copy of a saved part on the layout (the open one, else the last one, else a new one), at `at` (sheet mm, y up) or near the middle. */
function addLibToSheet(rec, at) {
  const part = libPart(rec);
  if (!part) { note(`${rec.name}: this part could not be read`); return; }
  const existing = targetLayout(), t = existing || freshLayout('Layout 1'), lay = t.lay;
  pushLay(t, null, '', `Add ${part.name}`);
  const i = addPlaced(lay, { ...part }, at);
  t.dirty = true; renderTabs();
  showLayoutTab(t, !existing);
  update(); selectLoose(i);
  note(`${rec.name} (${fmt(rec.w)} × ${fmt(rec.h)} mm) added to ${t.name}, on whole mm. ${SHIFT_HINT}`);
}

async function renamePart(rec) {
  const name = await askName({ title: 'Rename part', value: rec.name, ok: 'Rename', validate: (v) => (lib.items.some((r) => r !== rec && r.name.toLowerCase() === v.toLowerCase()) ? 'A part with this name is already in the library' : '') });
  if (!name || name === rec.name) return;
  const next = { ...rec, name };
  libCache.delete(rec.id);
  const ok = await libAdd(next);
  note(`Renamed to ${name}` + (ok ? '' : KEPT_ONLY_NOW));
}
async function deletePart(rec) {
  if (!(await confirmAsk(`Delete "${rec.name}" from the Parts library? Layouts that use it keep their own copy.`, 'Delete'))) return;
  lib.items = lib.items.filter((r) => r.id !== rec.id);
  libCache.delete(rec.id);
  renderLibrary(); renderStep();
  try { await removePart(rec.id); } catch (err) { console.warn('Parts library: could not remove:', err); lib.failed = true; renderLibrary(); }
  note(`${rec.name} deleted from the Parts library`);
}
/** Export .dxf: the part as a DXF file (Save As in the app, a download in a browser). */
async function exportPart(rec) {
  const name = rec.name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').trim() + '.dxf', t = window.__TAURI__;
  try {
    if (t && t.dialog && t.dialog.save && t.fs && t.fs.writeTextFile) {
      let path = await t.dialog.save({ defaultPath: name, filters: [{ name: 'DXF drawing', extensions: ['dxf'] }] });
      if (!path) return;
      path = await withExt(t, path, 'dxf'); if (!path) return;
      await t.fs.writeTextFile(path, rec.dxf);
      note(`Exported ${path.split(/[\\/]/).pop()}`);
    } else { download(name, rec.dxf); note(`Exported ${name}`); }
  } catch (err) { note('Export failed: ' + (err && err.message ? err.message : err)); }
}

// ---- extracting a part from a drawing: select an outline, Extract part…, name it ----
async function extractPart() {
  const d = editable();
  if (!d) { note('Extract part: open a drawing first'); return; }
  if (!d.sel.size) { note('Extract part: click an outline in the drawing first'); return; }
  if (!selHasPart(d)) { note('Extract part: a kept dimension is not part of a part. Select the outline'); return; }
  const raw = LD.extractRaw(d.raw, d.sel), part = raw && LD.makePart(uid(), '', raw, d.factor, d.name);
  if (!part) { note('Extract part: the selection has no size (kept dimensions are not part of a part)'); return; }
  const name = await askName({
    title: 'Extract part', value: LD.nextName(baseName(d.name), lib.items.map((r) => r.name)), ok: 'Save to library',
    rows: [['Size', `${fmt(part.w)} × ${fmt(part.h)} mm`, true], ['Saves to', 'Parts library']],
    validate: (v) => (lib.items.some((r) => r.name.toLowerCase() === v.toLowerCase()) ? 'A part with this name is already in the library' : ''),
  });
  if (!name) return;
  part.name = name;
  const bad = unwritable(raw);
  libCache.set(part.id, part);
  const ok = await libAdd({ id: part.id, name, w: part.w, h: part.h, dxf: LD.partToDxf(part), thumb: thumbFor(part), source: d.name, t: Date.now() });
  d.savedAs = (d.savedAs || []).concat(sizeKey(part.w, part.h));
  renderEdit();
  note(`Part ${name} saved to the Parts library: ${fmt(part.w)} × ${fmt(part.h)} mm` + (bad.length ? ` (without ${bad.map((b) => b.type + ' ' + b.count).join(', ')})` : '') + (ok ? '' : KEPT_ONLY_NOW));
}
const sizeKey = (w, h) => fmt(w) + 'x' + fmt(h);

/** A small dialog asking for a name (the extract and rename dialogs). rows: [[label, value, mono]]; validate(name) → '' or a message. → the name, or null if cancelled. */
function askName({ title, label = 'Name', value, ok, rows = [], validate }) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'fld', type: 'text', value, 'data-testid': 'name-input', 'aria-label': label, autocomplete: 'off', spellcheck: 'false' });
    const err = h('span', { class: 'lbl warn', 'data-testid': 'name-error' });
    const okBtn = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'name-ok' }, ok);
    const cancel = h('button', { class: 'btn', type: 'button', 'data-testid': 'name-cancel' }, 'Cancel');
    const dlg = h('div', { class: 'pop-dialog', role: 'dialog', 'aria-label': title, 'data-testid': 'name-dialog' },
      h('strong', null, title), h('label', { class: 'field' }, label, input),
      rows.map(([k, v, mono]) => h('div', { class: 'row lbl' }, h('span', null, k), h('span', { class: mono ? 'mono' : '' }, v), mono && /mm$/.test(v) ? h('span', null, '1:1') : null)),
      err, h('div', { class: 'row end' }, cancel, okBtn));
    const back = h('div', { class: 'pop-back', 'data-testid': 'name-back' }, dlg);
    const finish = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const submit = () => {
      const v = input.value.trim(), bad = !v ? 'Type a name' : validate ? validate(v) : '';
      if (bad) { err.textContent = bad; input.focus(); return; }
      finish(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      else if (e.key === 'Enter' && dlg.contains(document.activeElement) && document.activeElement !== cancel) { e.preventDefault(); e.stopPropagation(); submit(); }
    };
    okBtn.addEventListener('click', submit); cancel.addEventListener('click', () => finish(null));
    back.addEventListener('pointerdown', (e) => { if (e.target === back) finish(null); });
    input.addEventListener('input', () => { err.textContent = ''; });
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    input.focus(); input.select();
  });
}

/** A small menu at a screen position; a click elsewhere or Esc closes it. items: [[text, fn]]. */
function popMenu(x, y, items) {
  hideMenu();
  const m = h('div', { class: 'pop ctxmenu', role: 'menu', 'data-testid': 'ctx-menu' }, items.map((it) => {
    if (it === '-') return h('div', { class: 'msep', role: 'separator' });
    const [text, fn, hint, enabled, svg] = it;                        // svg: an icon on a 20 px box
    const b = h('button', { class: 'mi', type: 'button', role: 'menuitem', disabled: enabled === false }, svg ? h('span', { class: 'mi-l' }, icon(svg, { size: 16, box: 20, width: 1.5, cap: 'round', join: 'round' }), text) : text, hint ? h('span', { class: 'hint', 'aria-hidden': 'true' }, hint) : null);
    b.addEventListener('click', (e) => { e.stopPropagation(); hideMenu(); fn(); });
    return b;
  }));
  document.body.append(m);
  m.style.left = Math.max(4, Math.min(x, window.innerWidth - m.offsetWidth - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, window.innerHeight - m.offsetHeight - 4)) + 'px';
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); hideMenu(); } };
  const away = (e) => { if (!m.contains(e.target)) hideMenu(); };
  setTimeout(() => { if (ui.ctx === m) document.addEventListener('pointerdown', away, true); }, 0);
  document.addEventListener('keydown', esc, true);
  ui.ctx = m;
  ui.ctxOff = () => { document.removeEventListener('keydown', esc, true); document.removeEventListener('pointerdown', away, true); };
}
function hideMenu() {
  if (ui.ctx) { ui.ctx.remove(); ui.ctx = null; }
  if (ui.ctxOff) { ui.ctxOff(); ui.ctxOff = null; }
}

// ---- PDF / Print (export.js is the dialog, pdf-export.js the pages) ----
/** The layout without the parts hidden in the Objects tab (their places and the grid, if the grid is made of one): what print and PDF use. */
function shownLayout(d) {
  const hid = d.hiddenParts;
  if (!hid || !hid.size) return d.lay;
  return { ...d.lay, s: { ...d.lay.s, gridPart: hid.has(d.lay.s.gridPart) ? null : d.lay.s.gridPart }, placed: d.lay.placed.filter((p) => !hid.has(p.partId)) };
}
/** What the PDF is made from: the active tab's drawing (a layout's Sheet and Marks layers are not artwork), or null (nothing open yet). */
function exportSource() {
  const d = curDoc();
  if (!d) return null;
  if (d.lay) {                                                       // a layout: the sheet as the page, the placed parts as artwork (its Sheet and Marks layers are not artwork)
    const lay = shownLayout(d);
    if (!LD.placedAll(lay).length) return null;
    return { name: d.name, fl: flatten(LD.layoutRaw(lay)), factor: 1, off: new Set(), sheetW: d.lay.s.sheetW, sheetH: d.lay.s.sheetH, hide: ['Sheet', 'Marks'] };
  }
  const hid = hidIdx(d), fl = hid && hid.size ? { ...d.fl, items: d.fl.items.filter((it) => !hid.has(it.e)) } : d.fl;       // objects hidden one by one are left out too: what you see is what prints
  if (d.fl && partView(d) && !d.bgOnly) {                            // a drawing tab: the drawing and its dimensions alone (never the background or a sheet)
    return partSource({ fl, factor: d.factor, off: d.off, name: d.name, hide: [] });
  }
  if (d.fl) return { name: d.name, fl, factor: d.factor, off: d.off, sheetW: state.sheetW, sheetH: state.sheetH, hide: [] };
  return null;
}
function exportPdf() {
  openExport({ source: exportSource, sheet: () => ({ w: state.sheetW, h: state.sheetH }), readDrawing, note });
}

// ---- save ----
const dxfName = (n) => (/\.dxf$/i.test(n) ? n : n + '.dxf');

// ---- autosave and recovery (TODO 32) ----
// Every 2 minutes a copy of each tab with unsaved changes is kept inside the app (recovery.js, IndexedDB): the text Save would write,
// with the tab's name, path and kind. A copy goes when the tab is saved or closed. At start-up, copies left over (a crash, a power cut)
// are offered back. Nothing here ever blocks: if storage fails the app simply goes on without recovery.
// ?autosave=<ms> in the page address sets another interval (the browser test uses it); 120000 (2 minutes) otherwise.
let autosaving = false;
function dropCopy(d) {
  d.autoEnts = d.autoBlocks = d.autoLayers = d.autoDxf = null;
  if (!d.hasCopy) return;
  d.hasCopy = false;
  RC.removeCopy(d.rid).catch(() => {});
}
/** Deletes the copies of these tabs and waits for it (the window may close right after). */
/** The window is closing: no new autosave round, and a copy still being written finishes first, so it is deleted too (up to 2 s). */
let dropping = false;
const dropCopiesNow = async (docs) => {
  dropping = true;
  for (let i = 0; autosaving && i < 100; i++) await new Promise((r) => setTimeout(r, 20));
  return Promise.all(docs.filter((d) => d.hasCopy).map((d) => { d.hasCopy = false; return RC.removeCopy(d.rid).catch(() => {}); }));
};
/** One round: a copy of every tab with unsaved changes that changed since its last copy; the copy of a tab that is saved now is dropped. */
async function autosaveNow() {
  if (autosaving || dropping) return;
  autosaving = true;
  try {
    for (const d of state.docs.slice()) {
      if (!d.raw && !d.lay) continue;
      if (!d.dirty) { if (d.hasCopy) { d.hasCopy = false; await RC.removeCopy(d.rid); } continue; }
      if (!d.lay && d.autoEnts === d.raw.entities && d.autoBlocks === d.raw.blocks && d.autoLayers === d.raw.layers) continue;        // a drawing's state is replaced at every change: same one, same copy
      let dxf;
      try { dxf = writeDxf(d.lay ? LD.layoutRaw(d.lay) : d.raw, { escapeUnicode: true, extents: d.lay || !d.fl ? null : d.fl.boxes.model }); } catch (e) { console.warn('Autosave: could not write', d.name, e); continue; }
      if (d.lay && d.hasCopy && d.autoDxf === dxf) continue;                                          // a layout: the same text as the last copy
      if (d.lay) d.autoDxf = dxf;
      if (!d.rid) d.rid = uid();
      await RC.saveCopy({ id: d.rid, name: d.name, path: d.path || null, kind: d.lay ? 'layout' : 'drawing', dxf, t: Date.now(),
        saved: !!d.saved, fromFile: !!d.fromFile, fromPdf: d.fromPdf || null, acceptedLoss: !!d.acceptedLoss });
      d.hasCopy = true;
      if (!d.lay) { d.autoEnts = d.raw.entities; d.autoBlocks = d.raw.blocks; d.autoLayers = d.raw.layers; }
      if (!state.docs.includes(d) || !d.dirty) dropCopy(d);                                          // closed or saved while this was being written
    }
  } catch (err) { console.warn('Autosave failed:', err); } finally { autosaving = false; }
}
/** The Recover / Discard question. → 'recover', 'discard' or null (Esc: ask again next time). */
function askRecover(text, copies) {
  return new Promise((resolve) => {
    const rec = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'recover-ok' }, 'Recover');
    const dis = h('button', { class: 'btn', type: 'button', 'data-testid': 'recover-discard' }, 'Discard');
    const dlg = h('div', { class: 'pop-dialog', role: 'dialog', 'aria-label': 'Recover unsaved work', 'data-testid': 'recover-dialog' },
      h('strong', { 'data-testid': 'recover-text' }, text),
      h('span', { class: 'lbl' }, 'Copies the app kept itself, from before it was closed without saving. Your files are not touched.'),
      h('ul', { class: 'reclist' }, copies.map((c) => h('li', null, c.name + ' (' + c.kind + ', ' + RC.timeText(c.t) + ')'))),
      h('div', { class: 'row end' }, dis, rec));
    const back = h('div', { class: 'pop-back', 'data-testid': 'recover-back' }, dlg);
    const finish = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
    rec.addEventListener('click', () => finish('recover')); dis.addEventListener('click', () => finish('discard'));
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    rec.focus();
  });
}
/** One copy back as a tab marked unsaved, with its old name and path (so Save works as before). */
async function recoverOne(c) {
  try {
    const r = await readDrawing(new TextEncoder().encode(c.dxf).buffer);
    if (!r.ok) return false;
    const lay = c.kind === 'layout' ? LD.layoutFromRaw(r.doc, c.name) : null;
    const openPath = c.saved ? null : c.path;                                  // not saved yet: its path is still the opened file's
    const doc = lay ? { name: c.name, path: c.path, openPath, dirty: true, lay, fromFile: c.fromFile, saved: c.saved }
      : { name: c.name, path: c.path, openPath, dirty: true, saved: c.saved, fromPdf: c.fromPdf || undefined, acceptedLoss: c.acceptedLoss, ...tabFields(r.doc, r.result) };
    if (lay) lay.name = c.name;
    doc.rid = c.id; doc.hasCopy = true;                                       // the copy stays until the tab is saved or closed
    state.panel = 'main';
    addTab(doc);
    return true;
  } catch (err) { console.warn('Recover failed for', c.name, err); return false; }
}
/** Is this the only window? Two windows share one recovery store, so a second one must not offer (or discard) the first one's live copies.
 *  The lock is held for as long as the window lives. */
function ownsRecovery() {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => navigator.locks.request('pd-app', { ifAvailable: true }, (lock) => { resolve(!!lock); return lock ? new Promise(() => {}) : undefined; }));
}
async function offerRecovery() {
  let copies;
  try { copies = RC.cleanCopies(await RC.loadCopies()); } catch { return; }
  if (!copies.length) return;
  const choice = await askRecover(RC.recoverPrompt(copies), copies);
  if (choice === 'discard') { try { await RC.clearCopies(); } catch { /* ignore */ } note('Discarded the recovery copies'); return; }
  if (choice !== 'recover') return;
  let n = 0;
  for (const c of copies) if (await recoverOne(c)) n++;
  note(n === copies.length ? `Recovered ${n} unsaved ${n === 1 ? 'drawing' : 'drawings'}. Save them to keep the changes` : `Recovered ${n} of ${copies.length}: the rest could not be read`);
}

/** Browser fallback: the file goes to the Downloads folder. */
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/dxf' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Save writes the tab to its own file; Save As asks for a name. The file a tab was opened from is never overwritten: the
 * first Save is a Save As ("<name>-edited.dxf"), later ones write that file. A file with things the writer can't keep
 * goes to Save As as "<name>-copy.dxf". A layout made here has no file yet: its first Save is a Save As, to "<name>.dxf";
 * the file holds the sheet and parts for any CAD app and the layout's settings for ours (layoutdoc.js). A tab with nothing in it has nothing to save.
 */
async function save(forceAs) {
  const d = curDoc();
  if (!d) return;
  if (!d.raw && !d.lay) { note('Nothing to save yet: open a DXF first'); return; }
  if (!d.lay) await balSave(d, false);                              // the balloons first: they go next to the file they came with, whatever the DXF dialog does
  if (!d.lay && d.bg && !d.raw.entities.length && balOf(d).items.length) {          // a picture alone: only its balloons are saved
    await balSave(d);
    if (d.balSaved === balOf(d)) { d.dirty = false; renderTabs(); }
    return;
  }
  const raw = d.lay ? LD.layoutRaw(d.lay) : d.raw;
  const bad = unwritable(raw);
  const lossy = bad.length > 0 && !d.acceptedLoss && !d.lay;       // a layout is a new file: nothing to overwrite
  if (lossy) note(`This file has things Save can't keep (${bad.map((b) => b.type + ' ' + b.count).join(', ')}), so it's saved as a copy`);
  // the opened file itself is never touched: its first save is a Save As (to "<name>-edited.dxf"), later ones overwrite that
  const source = forceAs && d.openPath;
  const first = (!d.saved || source) && !d.fromPdf && !d.scratch && !lossy && (!d.lay || d.fromFile);
  const base = baseName(dxfName(source ? source.split(/[\\/]/).pop() : d.name));
  const want = lossy ? base + '-copy.dxf' : first ? base + '-edited.dxf' : dxfName(d.name);
  const ask = forceAs || lossy || first || (d.lay && !d.saved) || (d.scratch && !d.saved);
  const t = window.__TAURI__;
  try {
    const text = writeDxf(raw, { escapeUnicode: true, extents: d.lay || !d.fl ? null : d.fl.boxes.model });
    let path = d.path, name = d.name;
    if (t && t.dialog && t.dialog.save && t.fs && t.fs.writeTextFile) {
      if (ask || !path) {
        path = await t.dialog.save({ defaultPath: d.openPath ? d.openPath.replace(/[^\\/]*$/, () => want) : want, filters: [{ name: 'DXF drawing', extensions: ['dxf'] }] });
        if (!path) return;
        path = await withExt(t, path, 'dxf');
        if (!path) return;
      }
      if (d.openPath && pathKey(path) === pathKey(d.openPath)) { note('Pick another name: that is the opened file, and Save never writes over it'); return; }
      await t.fs.writeTextFile(path, text);
      name = path.split(/[\\/]/).pop();
    } else {
      name = ask ? want : dxfName(d.name);
      download(name, text);
    }
    d.name = name; d.path = path; d.dirty = false; d.saved = true;
    if (!d.lay) await balSave(d);                                   // a new drawing's balloons go next to the DXF just saved
    dropCopy(d);
    if (path) rememberRecent(path);
    if (d.lay) d.lay.name = name;
    if (bad.length) d.acceptedLoss = true;
    renderTabs();
    const dir = path ? path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))) : '';
    note('Saved ' + name + (bad.length ? ' (without ' + bad.map((b) => b.type + ' ' + b.count).join(', ') + ')' : '') + (dir ? ' to ' + dir : '') + (d.bg ? '. The background picture is not saved in the DXF' : ''));
  } catch (err) {
    note('Save failed: ' + (err && err.message ? err.message : err));
  }
}

/**
 * File → Export for cutter… (TODO 52, mock-up R14 option B): a small dialog (the file name, "Curves flattened to [0.01] mm", what is left
 * out), then the native Save picker, defaulting to "<name>-cutter.dxf". The copy holds LINE, ARC and LWPOLYLINE only (dxf-cutter.js);
 * the tab, its dirty mark and its Save file are not touched.
 */
function exportCutter() {
  const d = curDoc();
  if (!d || (!d.raw && !d.lay)) { note('Export for cutter: open a drawing first'); return; }
  if (document.querySelector('.cutdlg')) return;
  const raw = d.lay ? LD.layoutRaw(d.lay) : d.raw;
  const factor = d.lay ? 1 : d.factor;
  let made = { tol: 0.01, res: cutterDoc(raw, 0.01 / factor) };        // the count of what is left out does not depend on the tolerance
  const want = baseName(dxfName(d.openPath ? d.openPath.split(/[\\/]/).pop() : d.name)) + '-cutter.dxf';
  const { left, other } = made.res;
  const leftText = left ? `${left} text / fill ${left === 1 ? 'object' : 'objects'} left out` : 'No text or fills to leave out';

  const input = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', value: '0.01', 'aria-label': 'Curve flattening tolerance in mm', 'data-testid': 'cutter-tol' });
  const err = h('div', { class: 'pd-bad', role: 'alert', hidden: true, 'data-testid': 'cutter-err' });
  const refusal = () => { const typed = input.value.trim(), v = Number(typed); return typed === '' || !Number.isFinite(v) || !(v > 0) ? 'The flattening tolerance must be a number above 0 (mm)' : ''; };
  const showRefusal = () => { const why = refusal(), shown = why && input.value.trim() !== ''; flagInvalid(input, shown); err.textContent = shown ? why : ''; err.hidden = !shown; return why; };
  clearInvalid(input);
  input.addEventListener('input', showRefusal);

  const finish = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const go = async () => {
    const why = showRefusal();
    if (why) { flagInvalid(input, true); err.textContent = why; err.hidden = false; note(why); input.focus(); return; }
    const tol = Number(input.value.trim());
    finish();
    const t = window.__TAURI__;
    try {
      if (made.tol !== tol) made = { tol, res: cutterDoc(raw, tol / factor) };
      const text = writeDxf(made.res.doc, { escapeUnicode: true });
      let name = want, dir = '';
      if (t && t.dialog && t.dialog.save && t.fs && t.fs.writeTextFile) {
        let path = await t.dialog.save({ defaultPath: d.openPath ? d.openPath.replace(/[^\\/]*$/, () => want) : want, filters: [{ name: 'DXF drawing', extensions: ['dxf'] }] });
        if (!path) return;
        path = await withExt(t, path, 'dxf');
        if (!path) return;
        if (d.openPath && pathKey(path) === pathKey(d.openPath)) { note('Pick another name: that is the opened file, and Export never writes over it'); return; }
        await t.fs.writeTextFile(path, text);
        name = path.split(/[\\/]/).pop();
        dir = path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')));
      } else download(name, text);
      note(`Exported ${name} for the cutter, curves flattened to ${tol} mm` + (left ? ` (${leftText})` : '') + (other ? `, ${other} other object${other === 1 ? '' : 's'} could not be kept` : '') + (dir ? ' in ' + dir : ''));
    } catch (e) {
      note('Export failed: ' + (e && e.message ? e.message : e));
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  const cancel = h('button', { class: 'btn', type: 'button', 'data-testid': 'cutter-cancel', onclick: finish }, 'Cancel');
  const choose = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'cutter-go', onclick: go }, 'Choose file…');
  const dlg = h('div', { class: 'pop-dialog cutdlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Export for cutter', 'data-testid': 'cutter-dialog' },
    h('div', { class: 'row between' }, h('strong', null, 'Export for cutter'), h('button', { class: 'btn sm', type: 'button', 'aria-label': 'Close', onclick: finish }, '×')),
    h('div', { class: 'row between' }, h('b', { class: 'mono', 'data-testid': 'cutter-name' }, want), h('span', { class: 'lbl cutchip' }, 'DXF drawing')),
    h('span', { class: 'lbl' }, 'Create a cutter copy from the active drawing.'),
    h('div', { class: 'cutnote' }, h('label', { class: 'row' }, 'Curves flattened to', input, 'mm'),
      h('span', { class: 'lbl' }, 'Maximum curve deviation · arcs stay arcs where possible.'), err),
    h('span', { class: 'lbl' }, 'Only lines, arcs and polylines are written. Blocks are exploded and a circle becomes two arcs. Runs on the export copy: the original stays as it is.'),
    h('span', { class: 'lbl' }, 'Line widths are not written (cutters ignore them).'),
    h('div', { class: 'cutnote' + (left ? ' bad' : ''), 'data-testid': 'cutter-left' }, leftText,
      other ? h('span', { class: 'lbl' }, `${other} other object${other === 1 ? '' : 's'} (points, 3D faces, missing blocks) cannot be kept`) : null),
    h('div', { class: 'row' }, h('span', { class: 'lbl', style: 'flex:1' }, 'Next: native file picker'), cancel, choose));
  const back = h('div', { class: 'pop-back', 'data-testid': 'cutter-back' }, dlg);
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); } };
  back.addEventListener('pointerdown', (e) => { if (e.target === back) finish(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  input.focus(); input.select();
}

/** The dimensions drawn on a layout: the sheet's width and height, and the width of the selected placed part (when there is one). */
const sheetDimCount = () => 2 + (selBoxDown() ? 1 : 0);
function layerRows() {
  const d = curDoc();
  if (d && d.lay) {                                                  // a layout: the placed parts and the marks (the parts' own layers are inside the parts)
    const marksCount = placedNow.length ? (state.crop ? 4 : 0) + (state.reg ? 4 : 0) : 0;
    return [
      { id: 'parts', name: 'Parts', color: 'var(--partline)', count: placedNow.length, on: true, live: true, eye: EYE },
      { id: 'marks', name: 'Marks', color: 'var(--mark)', count: marksCount, live: true, eye: LOCK },
      { id: 'dims', name: 'Dimensions', color: 'var(--accent)', count: sheetDimCount(), live: true, eye: EYE },
    ];
  }
  // a drawing tab: the open file's own layers
  const file = d && d.fl
    ? d.fl.layers.map((l, i) => ({ name: l.name, color: ink(l.css, isDark()), count: d.counts[i], fileLayer: i }))
    : [];
  const bgRow = d && d.bg ? [{ id: 'bg', name: 'Background', color: '#9aa5b1', count: 1, eye: EYE, live: true, bg: true }] : [];
  const curName = d && d.raw ? curLayerName(d) : null;                // the layer new shapes go on; "0" has no row until something is on it
  const added = d && d.raw && d.addedLayers ? [...d.addedLayers].filter((n) => d.raw.layers[n] && !file.some((l) => l.name === n)) : [];      // layers added by hand, still empty
  const shown = curName && !file.some((l) => l.name === curName) && !added.includes(curName) ? curName : added.length && !file.some((l) => l.name === '0') ? '0' : null;      // "0" stays listed once layers were added, so it can be made current again
  const virt = shown ? [{ name: shown, color: 'var(--partline)', count: 0, eye: EYE, live: false, zero: shown === '0' }] : [];
  virt.push(...added.map((n) => ({ name: n, css: layerCss(d.raw.layers[n]), color: ink(layerCss(d.raw.layers[n]), isDark()), count: 0, eye: EYE, live: false, added: true })));
  return [...file.map((l) => ({ ...l, eye: EYE, live: true, chip: d.newLayer === l.name ? 'new' : null })), ...virt, ...bgRow].map((l) => ({ ...l, cur: curName != null && l.name === curName && !l.bg }));
}

const layerCss = (def) => (def && def.tc != null ? '#' + (def.tc & 0xffffff).toString(16).padStart(6, '0') : ACI[def && def.aci] || '#ffffff');
const allLayerNames = (d) => [...Object.keys(d.raw.layers), ...d.fl.layers.map((l) => l.name)];
/** + Add: a new layer with the first free name (Layer1, Layer2…); it becomes the current layer, and its name is ready to type over. One undo step. */
function addLayerNow() {
  const d = drawTarget();
  if (!d) { note('Add layer: open a drawing tab first (a layout has its own layers)'); return; }
  const name = Ed.newLayerName(allLayerNames(d));
  d.hist.push(snapshotOf(d), 'Add layer ' + name);
  d.raw.layers = { ...d.raw.layers };
  addLayer(d.raw, name, { aci: 7 });
  (d.addedLayers || (d.addedLayers = new Set())).add(name);
  d.curLayer = name; d.dirty = true;
  renderLayers(); renderTabs(); renderCommand(); renderEdit();
  const inp = ui.layerRows.querySelector('[data-testid=layer-name]');
  if (inp) { inp.focus(); inp.select(); }
  note(`Added ${name}: it is the current layer. Type a name and pick a colour, or press Enter to keep them. Ctrl+Z takes it away`);
}
/** The name of a layer added by hand (empty, so nothing refers to it): typed over in the row; a refused name says why and goes back. */
function addedName(d, l) {
  const input = h('input', { class: 'fld lname', type: 'text', value: l.name, 'aria-label': 'Layer name', 'data-testid': 'layer-name', spellcheck: 'false', maxlength: 255 });
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); else if (e.key === 'Escape') { input.value = l.name; input.blur(); } });
  input.addEventListener('change', () => {
    const v = input.value.trim(), why = Ed.layerNameProblem(v, allLayerNames(d), l.name);
    if (why) { input.value = l.name; flagInvalid(input, true); note(why); return; }
    if (v === l.name) return;
    d.raw.layers = Object.fromEntries(Object.entries(d.raw.layers).map(([k, def]) => [k === l.name ? v : k, def]));
    d.addedLayers.delete(l.name); d.addedLayers.add(v);
    if (d.curLayer === l.name) d.curLayer = v;
    d.dirty = true; renderLayers(); renderTabs(); renderCommand(); renderEdit(); note(`Layer renamed to ${v}`);
  });
  clearInvalid(input);
  return input;
}
/** The colour of a layer added by hand: a colour box in place of the swatch. */
function addedSwatch(d, l) {
  const input = h('input', { class: 'swatch pick', type: 'color', value: l.css, 'aria-label': 'Layer colour', 'data-testid': 'layer-colour', title: 'Layer colour' });
  input.addEventListener('input', () => { d.raw.layers = { ...d.raw.layers, [l.name]: { ...d.raw.layers[l.name], tc: parseInt(input.value.slice(1), 16) } }; d.dirty = true; });
  input.addEventListener('change', () => { renderTabs(); renderLayers(); });
  return input;
}

function renderLayers() {
  const d = curDoc();
  ui.layerRows.replaceChildren(...layerRows().map((l) => {
    const isFile = l.fileLayer != null;
    const hid = l.bg ? !d.bg.visible : isFile ? d.off.has(l.fileLayer) : l.id && state.hidden[l.id];
    const label = hid ? 'Hidden' : l.eye === LOCK ? 'Locked' : 'Visible';
    const ic = icon(hid ? EYE_OFF : l.eye, { size: 16, label });
    const vis = h('button', { class: 'vis' + (l.live ? ' live' : ''), type: 'button', 'data-layer': isFile ? 'f' + l.fileLayer : l.id, disabled: !l.live, title: l.live ? 'Show / hide ' + l.name : null }, ic);
    if (l.live) {
      vis.addEventListener('click', () => {
        if (l.bg) { d.bg.visible = !d.bg.visible; paintOverlay(); } else if (isFile) { if (d.off.has(l.fileLayer)) d.off.delete(l.fileLayer); else d.off.add(l.fileLayer); layersChanged(d); paintOverlay(); } else state.hidden[l.id] = !state.hidden[l.id];
        renderLayers(); applyHidden(); renderStatus();       // (renderLayers also redraws the Objects tab)
      });
    }
    const pick = isFile || l.added || l.zero;
    const row = h('div', { class: 'layer' + (l.on ? ' on' : '') + (hid ? ' hidden-layer' : '') + (l.cur ? ' current' : ''), 'data-file-layer': isFile ? l.fileLayer : null, 'data-layer-name': pick || l.cur ? l.name : null, title: pick || l.cur ? 'Click to make this the current layer: new shapes and text go on it' : null },
      l.added ? addedSwatch(d, l) : h('span', { class: 'swatch', 'aria-hidden': 'true', style: 'background:' + l.color }),
      l.added ? addedName(d, l) : h('span', { class: 'nm' }, l.name), l.cur ? h('span', { class: 'chip', 'data-testid': 'layer-current' }, 'current') : null, l.chip ? h('span', { class: 'chip', 'data-testid': 'layer-new' }, l.chip) : null, h('span', { class: 'lbl mono' }, l.count), vis);
    if (pick) row.addEventListener('click', (e) => { if (e.target.closest('.vis') || e.target.closest('input')) return; d.curLayer = l.name; renderLayers(); renderCommand(); renderEdit(); note(`Current layer: ${l.name}. New shapes and text go on it`); });
    return row;
  }));
  if (state.ptab === 'objects') renderObjects();
}

// ---- the Objects tab (TODO 39, mock-up R11a Option A): the open file as a tree, layer by layer; the tree itself is objects.js ----
const OBJ_ICONS = {
  line: '<path d="M4 20L20 4"/>', rect: '<rect x="4" y="6" width="16" height="12"/>', circle: '<circle cx="12" cy="12" r="8"/>', arc: '<path d="M4 19c4-14 12-14 16 0"/>',
  poly: '<path d="M4 18l4-10 6 6 6-10"/>', text: '<path d="M5 6h14M12 6v13M9 19h6"/>', block: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/>',
  other: '<circle cx="12" cy="12" r="2"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/>',
};
const CHEV_DOWN = '<path d="M6 9l6 6 6-6"/>', CHEV_RIGHT = '<path d="M9 6l6 6-6 6"/>';
const oIcon = (inner, size = 14) => icon(inner, { size, width: 1.7, cap: 'round', join: 'round' });
/** The tab's own list state (search, filter, what is open); the layout tab keeps it the same way. */
const omOf = (d) => d.om || (d.om = { open: null, openB: new Set(), show: new Map(), query: '', filter: 'all', openP: new Set() });

function buildObjects() {
  ui.objSearch = h('input', { type: 'text', placeholder: 'Search objects…', 'aria-label': 'Search objects', 'data-testid': 'obj-search', autocomplete: 'off', spellcheck: 'false' });
  ui.objSearch.addEventListener('input', () => { const d = curDoc(); if (d) { omOf(d).query = ui.objSearch.value; renderObjects(); } });
  const filt = (id, text) => (ui['objF' + id] = h('button', { class: 'ofb', type: 'button', 'data-testid': 'obj-filter-' + id, 'data-filter': id, 'aria-pressed': 'false', onclick: () => { const d = curDoc(); if (d) { omOf(d).filter = id; renderObjects(); } } }, text));
  ui.objToggle = h('button', { class: 'ofb', type: 'button', 'data-testid': 'obj-toggle', 'aria-label': 'Expand or collapse all', title: 'Expand or collapse all', onclick: objToggleAll });
  ui.objTree = h('div', { class: 'otree', role: 'tree', 'aria-label': 'Objects', 'data-testid': 'obj-tree' });
  ui.objTree.addEventListener('click', objClick);
  ui.objTree.addEventListener('contextmenu', objMenu);
  ui.objCount = h('span', { 'data-testid': 'obj-count' }); ui.objSelN = h('span', { 'data-testid': 'obj-selected' });
  return ui.objPanel = h('div', { class: 'objpanel', 'data-testid': 'objects-panel', hidden: true },
    h('div', { class: 'omtop' },
      h('div', { class: 'osr' }, oIcon('<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>'), ui.objSearch),
      h('div', { class: 'ofs' }, filt('all', 'All'), filt('hidden', ''), filt('locked', ''), h('span', { style: 'flex:1' }), ui.objToggle)),
    ui.objTree,
    h('div', { class: 'omfoot' }, ui.objCount, h('span', { style: 'flex:1' }), ui.objSelN));
}

function setPtab(tab) {
  state.ptab = tab;
  ui.panelEl.dataset.ptab = tab;
  for (const [b, id] of [[ui.tabDrawing, 'drawing'], [ui.tabObjects, 'objects']]) { b.classList.toggle('on', tab === id); b.setAttribute('aria-selected', String(tab === id)); }
  ui.objPanel.hidden = tab !== 'objects';
  if (tab === 'objects') renderObjects();
}

/** The tree for the tab that is open: a drawing's layers and objects, or a layout's parts. */
function objOpts(d, om) {
  return { factor: d.factor, off: d.off, hid: hidIdx(d) || new Set(), locked: d.locked || new Set(), curLayer: curLayerName(d), query: om.query, filter: om.filter, open: om.open, show: om.show, extra: d.addedLayers ? [...d.addedLayers] : [] };
}
function objBtn(act, on, label, inner, cls = '') {
  return h('button', { class: 'oa' + (on ? '' : ' off') + cls, type: 'button', 'data-act': act, 'aria-label': label, title: label }, oIcon(inner, 15));
}
/** What the Objects tree is made of, apart from which rows are picked: when it is the same as the last draw, a pick only re-marks the rows. */
function objSig(d, dark) {
  const om = omOf(d), sets = JSON.stringify([om.query, om.filter, dark, [...om.openP], [...(om.open || [])], [...om.openB], [...om.show]]);
  if (d.lay) return { a: d, b: d.lay.parts, c: null, str: sets + JSON.stringify([Object.values(d.lay.parts).map((p) => p.name), [...(d.hiddenParts || [])], placedNow.map((p) => [p.partId, p.x, p.y, p.rot, p.lock, p.mirrorX, p.mirrorY])]) };
  return { a: d, b: d.raw.entities, c: d.raw.layers, str: sets + JSON.stringify([[...d.off], [...(hidIdx(d) || [])], [...(d.locked || [])], curLayerName(d), d.factor, [...(d.addedLayers || [])]]) };
}
let objSigLast = null;
/** Only the picked rows changed: toggles the .sel marks on the rows already there. False if a picked object has no row yet (the tree is rebuilt, which opens its layer). */
function markObjSel(d, reveal) {
  const lay = !!d.lay, key = lay ? 'place' : 'e', rows = ui.objTree.querySelectorAll(lay ? '.or[data-place]' : '.or.obj[data-e]'), want = new Set(lay ? selIdxs() : d.sel);
  if (reveal && !lay && d.sel.size && d.sel.size <= 50) { const listed = new Set([...rows].map((r) => +r.dataset[key])); for (const e of want) if (!listed.has(e)) return false; }
  for (const r of rows) r.classList.toggle('sel', want.has(+r.dataset[key]));
  ui.objSelN.textContent = want.size + ' selected';
  if (reveal) { const s = ui.objTree.querySelector('.or.sel'); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' }); }
  return true;
}
function renderObjects(reveal = false) {
  if (!ui.objTree || state.ptab !== 'objects') return;
  const d = curDoc(), lay = d && d.lay, ed = lay ? null : editable(), dark = isDark();
  const filterBtns = (hidden, locked) => {
    const f = d && d.om ? d.om.filter : 'all';
    ui.objFall.classList.toggle('on', f === 'all'); ui.objFhidden.classList.toggle('on', f === 'hidden'); ui.objFlocked.classList.toggle('on', f === 'locked');
    for (const b of [ui.objFall, ui.objFhidden, ui.objFlocked]) b.setAttribute('aria-pressed', String(b.classList.contains('on')));
    ui.objFhidden.replaceChildren(oIcon(EYE_OFF, 12), `Hidden ${hidden}`); ui.objFlocked.replaceChildren(oIcon(ICONS.lock, 12), `Locked ${locked}`);
    ui.objFlocked.hidden = !!lay;
  };
  const rows = [];
  const sig = lay || ed ? objSig(d, dark) : null;
  if (sig && objSigLast && objSigLast.a === sig.a && objSigLast.b === sig.b && objSigLast.c === sig.c && objSigLast.str === sig.str && markObjSel(d, reveal)) return;
  objSigLast = sig;
  if (lay) {
    const om = omOf(d), hp = d.hiddenParts || new Set(), parts = OB.partsTree(d.lay, placedNow, hp, om.query);
    if (document.activeElement !== ui.objSearch) ui.objSearch.value = om.query;
    const shown = om.filter === 'hidden' ? parts.filter((p) => p.hidden) : parts, sel = new Set(selIdxs());
    for (const p of shown) {
      const open = !!om.query || om.openP.has(p.id);
      rows.push(h('div', { class: 'or layer' + (p.hidden ? ' dim' : ''), 'data-part': p.id, role: 'treeitem', 'aria-expanded': String(open) },
        h('span', { class: 'otw' }, oIcon(open ? CHEV_DOWN : CHEV_RIGHT, 12)), h('span', { class: 'oti' }, oIcon(OBJ_ICONS.block)), h('span', { class: 'onm' }, p.name), h('span', { class: 'ocnt' }, p.count),
        objBtn('vis', !p.hidden, p.hidden ? 'Show' : 'Hide', p.hidden ? EYE_OFF : EYE)));
      if (open) for (const pl of p.places) rows.push(h('div', { class: 'or obj' + (sel.has(pl.k) ? ' sel' : '') + (p.hidden ? ' dim' : ''), 'data-place': pl.k, role: 'treeitem', style: 'padding-left:20px' },
        h('span', { class: 'otw' }), h('span', { class: 'oti' }, oIcon(OBJ_ICONS.rect)), h('span', { class: 'onm' }, pl.label), pl.locked ? h('span', { class: 'chp w' }, 'locked') : null));
    }
    filterBtns(parts.filter((p) => p.hidden).length, 0);
    ui.objToggle.replaceChildren(oIcon(om.openP.size ? CHEV_DOWN : CHEV_RIGHT, 12));
    ui.objTree.replaceChildren(...(rows.length ? rows : [h('div', { class: 'omempty' }, parts.length || om.query ? 'Nothing matches.' : 'No parts on this layout yet.')]));
    ui.objCount.replaceChildren(h('b', null, placedNow.length), ' placed · ', h('b', null, Object.keys(d.lay.parts).length), ' parts'); ui.objSelN.textContent = sel.size + ' selected';
    return;
  }
  if (!ed) {
    filterBtns(0, 0);
    ui.objTree.replaceChildren(h('div', { class: 'omempty' }, 'Open a drawing to see its objects.'));
    ui.objCount.textContent = ''; ui.objSelN.textContent = '';
    return;
  }
  const om = omOf(d);
  if (!om.open) { const names = d.fl.layers.map((l) => l.name), cur = curLayerName(d); om.open = new Set([names.includes(cur) ? cur : names[0]].filter(Boolean)); }       // the current layer is open, else the first
  if (document.activeElement !== ui.objSearch) ui.objSearch.value = om.query;
  let tree = OB.buildTree(d.raw, d.fl, objOpts(d, om));
  if (reveal && d.sel.size && d.sel.size <= 50) {                        // an object picked on the sheet: its layer opens and its row is listed
    let again = false;
    for (const e of d.sel) {
      const l = tree.layers.find((x) => x.name === d.raw.entities[e].layer);
      if (!l) continue;
      if (!l.open) { om.open.add(l.name); again = true; } else { const k = l.ents.indexOf(e); if (k >= l.cap) { om.show.set(l.name, k + 1); again = true; } }
    }
    if (again) tree = OB.buildTree(d.raw, d.fl, objOpts(d, om));
  }
  objLast = tree;
  for (const l of tree.layers) {
    const sw = h('span', { class: 'osw' });
    sw.style.background = l.css ? ink(l.css, dark) : 'var(--partline)';
    rows.push(h('div', { class: 'or layer' + (l.cur ? ' cur' : '') + (l.hidden ? ' dim' : ''), 'data-layer': l.name, role: 'treeitem', 'aria-expanded': String(l.open) },
      h('span', { class: 'otw' }, oIcon(l.open ? CHEV_DOWN : CHEV_RIGHT, 12)), sw, h('span', { class: 'onm' }, l.name), l.cur ? h('span', { class: 'chp', 'data-testid': 'obj-current' }, 'current') : null, h('span', { class: 'ocnt' }, l.count),
      l.index >= 0 ? objBtn('vis', !l.hidden, l.hidden ? 'Show' : 'Hide', l.hidden ? EYE_OFF : EYE) : null, objBtn('lock', l.locked, l.locked ? 'Unlock' : 'Lock', l.locked ? ICONS.lock : ICONS.unlock, l.locked ? ' lk' : '')));
    for (const r of l.rows) {
      const blockOpen = r.block && om.openB.has(r.e);
      rows.push(h('div', { class: 'or obj' + (d.sel.has(r.e) ? ' sel' : '') + (r.hidden ? ' dim' : ''), 'data-e': r.e, 'data-layer-of': l.name, role: 'treeitem', style: 'padding-left:20px' },
        h('span', { class: 'otw', 'data-act': r.block ? 'block' : null }, r.block ? oIcon(blockOpen ? CHEV_DOWN : CHEV_RIGHT, 12) : null), h('span', { class: 'oti' }, oIcon(OBJ_ICONS[r.icon])), h('span', { class: 'onm' }, r.label),
        r.locked ? h('span', { class: 'chp w' }, 'locked') : null, objBtn('vis', !r.hidden, r.hidden ? 'Show' : 'Hide', r.hidden ? EYE_OFF : EYE)));
      if (blockOpen) { const m = OB.membersOf(d.raw, d.raw.entities[r.e], d.factor); for (const x of m.rows) rows.push(h('div', { class: 'or member dim0', 'data-e': r.e, style: 'padding-left:36px' }, h('span', { class: 'otw' }), h('span', { class: 'oti' }, oIcon(OBJ_ICONS[x.icon])), h('span', { class: 'onm' }, x.label))); if (m.more) rows.push(h('div', { class: 'or member', style: 'padding-left:36px' }, h('span', { class: 'onm ocnt' }, `+ ${m.more} more`))); }
    }
    if (l.more) rows.push(h('button', { class: 'or more', type: 'button', 'data-act': 'more', 'data-layer': l.name, style: 'padding-left:20px' }, `Show ${Math.min(OB.CAP, l.more)} more (${l.more} not listed)`));
  }
  filterBtns(tree.hiddenN, tree.lockedN);
  ui.objToggle.replaceChildren(oIcon(om.open.size ? CHEV_DOWN : CHEV_RIGHT, 12));
  ui.objTree.replaceChildren(...(rows.length ? rows : [h('div', { class: 'omempty' }, om.query || om.filter !== 'all' ? 'Nothing matches.' : 'This drawing has no objects.')]));
  ui.objCount.replaceChildren(h('b', null, tree.objects), ` object${tree.objects === 1 ? '' : 's'} · ${tree.nLayers} layer${tree.nLayers === 1 ? '' : 's'}`);
  ui.objSelN.textContent = d.sel.size + ' selected';
  if (reveal) { const s = ui.objTree.querySelector('.or.sel'); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' }); }
}
let objLast = null;                              // the tree as last drawn (its layers' object lists, for Select on a layer)

function objToggleAll() {
  const d = curDoc(); if (!d) return;
  const om = omOf(d);
  if (d.lay) { if (om.openP.size) om.openP.clear(); else for (const id of Object.keys(d.lay.parts)) om.openP.add(id); }
  else if (om.open && om.open.size) { om.open.clear(); om.openB.clear(); } else if (objLast) om.open = new Set(objLast.layers.map((l) => l.name));
  renderObjects();
}

function objClick(e) {
  const d = curDoc(), row = e.target.closest('.or'), act = e.target.closest('[data-act]');
  if (!d || !row) return;
  const om = omOf(d), flip = (set, k) => (set.has(k) ? set.delete(k) : set.add(k));
  if (d.lay) {
    if (row.dataset.part) {
      if (act && act.dataset.act === 'vis') { const hp = d.hiddenParts || (d.hiddenParts = new Set()); flip(hp, row.dataset.part); drawSheet(); paintOverlay(); renderObjects(); note(hp.has(row.dataset.part) ? 'Part hidden: it is left out of print and PDF too. The saved file keeps it' : 'Part shown'); } else { flip(om.openP, row.dataset.part); renderObjects(); }
    } else if (row.dataset.place != null) {
      selectMany([+row.dataset.place]); update();
    }
    return;
  }
  if (act && act.dataset.act === 'more') { om.show.set(act.dataset.layer, (om.show.get(act.dataset.layer) || OB.CAP) + OB.CAP); renderObjects(); return; }
  if (row.dataset.layer && !row.dataset.e) {
    const name = row.dataset.layer, idx = d.fl.layers.findIndex((l) => l.name === name);
    if (act && act.dataset.act === 'vis') toggleLayerVis(d, idx);
    else if (act && act.dataset.act === 'lock') toggleLayerLock(d, name);
    else {
      flip(om.open, name);
      const ed = editable();       // a double-click's second click: the first rebuilt the rows, so the browser sends no dblclick; the click's detail still counts
      if (e.detail === 2 && ed) { ed.curLayer = name; renderLayers(); renderCommand(); renderEdit(); note(`Current layer: ${name}. New shapes and text go on it`); } else renderObjects();
    }
    return;
  }
  const ent = +row.dataset.e;
  if (act && act.dataset.act === 'vis') objHide(d, [ent]);
  else if (act && act.dataset.act === 'block') { flip(om.openB, ent); renderObjects(); }
  else objSelect(d, [ent], e.shiftKey || e.ctrlKey || e.metaKey);
}

function toggleLayerVis(d, idx) {
  if (idx < 0) return;
  if (d.off.has(idx)) d.off.delete(idx); else d.off.add(idx);
  layersChanged(d); paintOverlay(); renderLayers(); applyHidden(); renderStatus();
}
function toggleLayerLock(d, name) {
  const lk = d.locked || (d.locked = new Set());
  if (lk.has(name)) lk.delete(name); else { lk.add(name); if ([...d.sel].some((e) => lockedEnt(d, e))) { setSel(d, new Set([...d.sel].filter((e) => !lockedEnt(d, e)))); } }
  renderObjects();
  note(lk.has(name) ? `Layer ${name} locked: it is still drawn and snapped to, but cannot be picked or changed` : `Layer ${name} unlocked`);
}
/** Hides these objects, or shows them again if they are all hidden already. For this session only: the file does not keep it. */
function objHide(d, ents) {
  const hid = d.hid || (d.hid = new Set()), E = d.raw.entities;        // kept by entity object, so it survives edits that shift the numbers
  const off = ents.filter((e) => d.fl.layers.some((l, i) => l.name === E[e].layer && d.off.has(i)));
  if (off.length === ents.length) { note('Its layer is hidden: show the layer first'); return; }
  const all = ents.every((e) => hid.has(E[e]));
  for (const e of ents) { if (all) hid.delete(E[e]); else hid.add(E[e]); }
  d.hidC = null;
  layersChanged(d); paintOverlay(); renderObjects(); renderStatus();
  note(all ? `${ents.length} shown again` : `${ents.length} hidden for this session: the saved file keeps them`);
}
function objSelect(d, ents, add) {
  const free = ents.filter((e) => !lockedEnt(d, e));
  if (!free.length) { note(`Layer ${d.raw.entities[ents[0]].layer} is locked: unlock it to select its objects`); return; }
  const next = new Set(add ? d.sel : []);
  if (add && free.length === 1 && next.has(free[0])) next.delete(free[0]); else for (const e of free) next.add(e);
  setSel(d, next);
  note(`${next.size} selected`);
}
const zoomPad = (b) => Math.max(2, 0.15 * Math.max(b[2] - b[0], b[3] - b[1]));
function objZoom(d, ents) {
  const b = OB.boxOf(d.fl, ents);
  if (!b) { note('Nothing to zoom to: it has no shape on the sheet'); return; }
  const mm = b.map((v) => v * d.factor);
  zoomToBox(mm, zoomPad(mm));
}
function showAllHidden(d) {
  if (d.lay) { if (d.hiddenParts) d.hiddenParts.clear(); drawSheet(); paintOverlay(); renderObjects(); note('All parts are shown'); return; }
  d.off.clear(); d.hid = new Set(); d.hidC = null;
  layersChanged(d); paintOverlay(); renderLayers(); applyHidden(); renderStatus();
  note('All layers and objects are shown');
}
async function renameLayerNow(d, name) {
  if (name === '0') { note('Layer 0 cannot be renamed'); return; }
  const to = await askName({ title: 'Rename layer', label: 'Name', value: name, ok: 'Rename', validate: (v) => Ed.layerNameProblem(v, allLayerNames(d), name) });
  if (!to || to === name) return;
  const wasOff = d.off.has(d.fl.layers.findIndex((l) => l.name === name)), hid = hidIdx(d), lk = d.locked;
  commit(d, OB.renameLayer(d.raw, name, to), `Rename layer ${name} → ${to}`);
  const i = d.fl.layers.findIndex((l) => l.name === to);
  if (wasOff && i >= 0) d.off.add(i);                                      // restore() keeps hidden layers by name: this one has a new name
  d.hid = new Set([...(hid || [])].map((k) => d.raw.entities[k])); d.hidC = null;       // the renamed entities are new objects, at the same numbers
  if (lk && lk.delete(name)) lk.add(to);
  if (d.curLayer === name) d.curLayer = to;
  if (d.addedLayers && d.addedLayers.delete(name)) d.addedLayers.add(to);
  layersChanged(d); paintOverlay(); renderLayers(); renderStatus();
  note(`Layer ${name} is now ${to}. Ctrl+Z takes it back`);
}
function moveToLayerMenu(d, x, y) {
  popMenu(x, y, [...new Set(allLayerNames(d))].map((n) => [n, () => propSet('layer', n)]));
}
function objMenu(e) {
  const d = curDoc(), row = e.target.closest('.or');
  if (!d || !row || row.classList.contains('more') || row.classList.contains('member')) return;
  e.preventDefault();
  const { clientX: x, clientY: y } = e, hid = hidIdx(d) || new Set(), sep = '-';
  if (d.lay) {
    const id = row.dataset.part || (row.dataset.place != null ? placedNow[+row.dataset.place].partId : null), hp = d.hiddenParts || (d.hiddenParts = new Set());
    if (row.dataset.place != null) { selectMany([+row.dataset.place]); update(); }
    popMenu(x, y, [
      ['Select', () => { const k = placedNow.findIndex((p) => p.partId === id); if (k >= 0) { selectMany(placedNow.map((p, i) => (p.partId === id ? i : -1)).filter((i) => i >= 0)); update(); } }],
      ['Zoom to', () => { const bs = placedNow.filter((p) => p.partId === id).map((p) => placedBox(d.lay.parts[id], p)); if (bs.length) { const u = A.unionBox(bs); zoomToBox(u, zoomPad(u)); } }],
      sep, [hp.has(id) ? 'Show' : 'Hide', () => { if (hp.has(id)) hp.delete(id); else hp.add(id); drawSheet(); paintOverlay(); renderObjects(); }],
      sep, ['Show all hidden', () => showAllHidden(d), '', hp.size > 0]]);
    return;
  }
  if (!editable()) return;
  if (row.dataset.layer && !row.dataset.e) {
    const name = row.dataset.layer, l = objLast && objLast.layers.find((x) => x.name === name), idx = d.fl.layers.findIndex((q) => q.name === name), locked = !!(d.locked && d.locked.has(name)), hidden = idx >= 0 && d.off.has(idx);
    popMenu(x, y, [
      ['Select', () => objSelect(d, l ? l.ents : [], false), '', !!(l && l.ents.length)],
      ['Zoom to', () => objZoom(d, l ? l.ents : []), '', !!(l && l.ents.length)],
      sep, [hidden ? 'Show' : 'Hide', () => toggleLayerVis(d, idx), '', idx >= 0], [locked ? 'Unlock' : 'Lock', () => toggleLayerLock(d, name)],
      sep, ['Rename…', () => renameLayerNow(d, name), '', name !== '0'],
      sep, ['Show all hidden', () => showAllHidden(d), '', d.off.size > 0 || hid.size > 0]]);
    return;
  }
  const ent = +row.dataset.e, name = d.raw.entities[ent].layer, locked = !!(d.locked && d.locked.has(name));
  if (!d.sel.has(ent)) objSelect(d, [ent], false);
  const targets = d.sel.has(ent) ? [...d.sel] : [ent];
  popMenu(x, y, [
    ['Select', () => objSelect(d, [ent], false)],
    ['Zoom to', () => objZoom(d, targets)],
    sep, [targets.every((t) => hid.has(t)) ? 'Show' : 'Hide', () => objHide(d, targets)], [(locked ? 'Unlock' : 'Lock') + ` layer ${name}`, () => toggleLayerLock(d, name)],
    sep, ['Move to layer…', () => moveToLayerMenu(d, x, y), '', d.sel.has(ent)],
    sep, ['Show all hidden', () => showAllHidden(d), '', d.off.size > 0 || hid.size > 0]]);
}

/** The command bar (cmdui.js): the log the app writes to, the floating bar, the fade, the F2 history and the echo button. */
function buildCommand() {
  ui.cmdUI = buildCmdUI({ commands: () => ownCommands, tab: () => (curLay() ? 'layout' : 'draw'), active: activeCmd, submit: cmdEnter, runName: (name) => runCommand(ownCommands.find((x) => x.name === name)), canvas: () => ui.canvas, say: note });
  ui.hist = ui.cmdUI.hist; ui.prompt = ui.cmdUI.prompt; ui.cmd = ui.cmdUI.input;
  ui.keepMeas = h('button', { class: 'btn sm', type: 'button', hidden: true, 'data-testid': 'meas-keep', title: 'Keep this measure as a dimension (Enter)', onclick: keepMeasure }, 'Keep');
  ui.modAsk = h('span', { hidden: true, class: 'modask' }, h('button', { class: 'btn sm', type: 'button', 'data-testid': 'mirror-yes', onclick: () => { if (modLive()) modAnswer(editable(), true); } }, 'Yes'), h('button', { class: 'btn sm', type: 'button', 'data-testid': 'mirror-no', onclick: () => { if (modLive()) modAnswer(editable(), false); } }, 'No'));
  ui.cmdUI.acts.append(ui.keepMeas, ui.modAsk);
  return ui.cmdUI.log;
}
/** A command is on (a tool, a grip, a rotate, …): its name and what it asks for, for the bar. Null when nothing is running. */
function activeCmd() {
  const on = !['select', 'pan', 'step'].includes(state.tool) || state.grip || state.match || state.dsOpen || (curLay() && state.mode === 'rotate');
  if (!on) return null;
  const m = /^Command:\s*(\S+)/.exec(ui.hist.textContent);
  return { label: m ? m[1] : state.tool.toUpperCase(), prompt: ui.prompt.textContent.trim() };
}

/** What was typed at the bar (or sent by a chip or a history line), in the command that is on or as a new command. */
function cmdEnter(raw) {
  if (state.grip && editable()) { gripTyped(raw); return; }
  if (drawLive()) { drawTyped(raw); return; }
  if (modLive() && modTyped(editable(), raw)) return;
  if (state.tool === 'text' && editable() && !textEditing()) { textTyped(raw); return; }
  const c = raw.trim().toLowerCase();
  if (!c) return;
  if (state.mode === 'rotate' && curLay() && selectedPlaced()) {
    if (c === 'pivot' || c === 'p') { note('Pivot: drag ◎ on the sheet, or pick Custom in the Rotate section and type its X and Y'); return; }
    if (c === 'copy' || c === 'c') { state.rotCopy = !state.rotCopy; renderCommand(); note(state.rotCopy ? 'Copy on: the angle you type now turns a copy, and the part stays' : 'Copy off'); return; }
    if (PL.parseAngle(c) != null) { const copy = state.rotCopy; state.rotCopy = false; const why = setAngleText(c, copy); if (why) note(why); return; }
  }
  if (curLay() && selIdxs().length > 1) {                           // several selected: the words in the prompt
    const w = { left: 'left', l: 'left', centre: 'centre', center: 'centre', c: 'centre', right: 'right', r: 'right', top: 'top', t: 'top', middle: 'middle', m: 'middle', bottom: 'bottom', b: 'bottom', horizontal: 'horizontal', h: 'horizontal', vertical: 'vertical', v: 'vertical' }[c];
    if (w) { arrange(['horizontal', 'vertical'].includes(w) ? 'distribute' : 'align', w); return; }
  }
  if (state.tool === 'contour' && editable()) {                         // the words in the Contour prompt
    const m = /^(distance|dist|d|steps|s)\s+(.+)$/.exec(c), cfg = state.contourCfg, set = (k, v) => { cfg[k] = v; saveContourCfg(); renderContour(); renderCommand(); };
    if (c === 'inside' || c === 'i') { set('dir', 'inside'); return; }
    if (c === 'outside' || c === 'o') { set('dir', 'outside'); return; }
    if (c === 'sharp') { set('corners', 'sharp'); return; }
    if (c === 'rounded' || c === 'round') { set('corners', 'rounded'); return; }
    if (c === 'apply' || c === 'a') { applyContour(); return; }
    if (m) { const why = m[1][0] === 'd' ? setContourDist(m[2]) : setContourSteps(m[2]); renderContour(); renderCommand(); if (why) note(why); return; }
  }
  if (state.tool === 'balloon' && editable() && /^\d+$/.test(c)) { balNextTyped(c); return; }
  if (state.tool === 'dimension' && state.dimType === 'linear' && state.dim.pts.length === 2 && /^(h|horizontal|v|vertical)$/.test(c)) { state.dim.force = c[0]; note('Linear: ' + (c[0] === 'h' ? 'horizontal' : 'vertical') + '. ' + dimPrompt()); paintOverlay(); return; }
  const cmd = CB.resolve(c, curLay() ? 'layout' : 'draw', ownCommands);
  if (cmd) runCommand(cmd);
  else note('Unknown command: ' + c);
}

// what a command of cmdbar.js does when it is not just "pick that tool" (the tool's id is the command's name, but for rectangle)
const TOOL_OF = { rectangle: 'rect' };
const DIM_OF = { dimlinear: 'linear', dimradius: 'radius', dimdiameter: 'diameter', dimangular: 'angle' };
const DO = {
  dimension: () => { if (!editable()) { note('Dimensions work on a drawing tab: open a drawing first'); return; } state.dimType = 'aligned'; paintDimButton(); setTool('dimension'); },       // D is the Aligned dimension
  leader: () => { if (editable()) setTool('leader'); else note('Leaders work on a drawing tab: open a drawing first'); },
  dimstyle: () => showDimStyle(),
  extract: () => extractPart(), apply: () => apply(), nest: () => openNestDialog(),
  rotate: () => {
    const sp = selectedPlaced();
    if (sp) { if (sp.p.lock) { note(LOCKED); return; } state.mode = 'rotate'; state.pivot = centrePivot(); state.rotCopy = false; update(); return; }
    const order = ['best', '0', '90'];
    state.rotate = order[(order.indexOf(state.rotate) + 1) % 3];
    ui.rotate.value = state.rotate;
    touch(); update();
  },
  group: () => groupSel(), ungroup: () => ungroupSel(), lock: () => lockSel(true), unlock: () => lockSel(false), mx: () => mirrorSel('x'), my: () => mirrorSel('y'),
  newlayout: () => newLayoutTab(), library: () => showLibrary(), open: () => openFile(), save: () => save(false), saveas: () => save(true), pdf: () => exportPdf(), compare: () => cmpStart(),
  undo: () => { const d = editable(); if (d) undo(d); else undoLay(); },
  redo: () => { const d = editable(); if (d) redo(d); else redoLay(); },
  history: () => showHistory(), selectall: () => selectAll(), delete: () => (curLay() ? deletePlaced() : deleteSelection()),
  fit: () => fit(), rulers: () => setRulers(!state.rulers), properties: () => toggleProps(),
  shortcuts: () => showShortcuts(),
};
/** A command of the table started by its name (typed in the bar, a history line, Space on the drawing). */
function runCommand(cmd) {
  if (!cmd) return;
  const n = cmd.name, label = n[0].toUpperCase() + n.slice(1), lay = curLay();
  if (cmd.where === 'layout' && !lay) { note(`${label} is on a layout tab: New layout, or Add to layout`); return; }
  if (cmd.where === 'draw' && lay && cmd.cat !== 'Draw') { note(`${label} works on a drawing tab: open a drawing first`); return; }
  if (DIM_OF[n]) { if (editable()) setDimType(DIM_OF[n]); else note('Dimensions work on a drawing tab: open a drawing first'); }
  else if (DO[n]) DO[n]();
  else setTool(TOOL_OF[n] || n);
  ui.cmdUI.ran(n);
}

function buildStatus() {
  ui.coords = h('span', { class: 'mono coords', 'data-testid': 'coords', style: 'white-space:pre' }, 'X 0.00   Y 0.00 mm');
  // GRID is not built: greyed, never "on". SNAP, ORTHO, POLAR (F10) and OTRACK (F11) work.
  loadTrack();
  const TITLES = { SNAP: 'Snap to ends, middles and centres', GRID: 'Not built yet', ORTHO: 'Keep picked points straight along X or Y from the first point (Shift does it for one pick)',
    POLAR: 'Polar tracking (F10): picks lock onto the angles of the increment from the last point. Right-click: the increment', OTRACK: 'Object snap tracking (F11): hover on a snap point to acquire it, then line up with it' };
  ui.tog = {};
  const toggles = [['SNAP', true], ['GRID', false], ['ORTHO', false], ['POLAR', state.polar.on], ['OTRACK', state.otrack]].map(([t, on]) => {
    const off = t === 'GRID';
    const b = ui.tog[t] = h('button', { class: 'tog' + (on ? ' on' : '') + (off ? ' off' : ''), type: 'button', 'data-testid': 'tog-' + t.toLowerCase(), 'aria-pressed': String(on), 'aria-disabled': off ? 'true' : null, title: TITLES[t] }, t);
    b.addEventListener('click', () => {
      if (off) return;
      if (t === 'POLAR') { polarSet(!state.polar.on); return; }
      if (t === 'OTRACK') { otrackSet(!state.otrack); return; }
      chip(t, !b.classList.contains('on'));
      const clear = () => { for (const a of [state.setlen, state.meas, state.dim, state.ldr]) if (a) a.hover = null; paintOverlay(); };
      if (t === 'SNAP') { state.snap = b.classList.contains('on'); clear(); note(state.snap ? 'Snap on: ends, middles, centres and the nearest point on a line' : 'Snap off: the exact point you click'); }
      if (t === 'ORTHO') {
        state.ortho = b.classList.contains('on');
        if (state.ortho && state.polar.on) { state.polar.on = false; chip('POLAR', false); }          // ORTHO and POLAR turn each other off
        clear(); note(state.ortho ? 'Ortho on: the second point stays straight along X or Y from the first' : 'Ortho off: Shift still keeps one pick straight');
      }
    });
    return b;
  });
  ui.tog.POLAR.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const r = ui.tog.POLAR.getBoundingClientRect();
    popMenu(r.left, r.top, TK.INCREMENTS.map((v) => [v + '°', () => { state.polar.inc = v; polarSet(true); }, v === state.polar.inc ? '●' : null]));
    ui.ctx.style.top = Math.max(4, r.top - ui.ctx.offsetHeight - 4) + 'px';
  });
  ui.toolChip = h('span', { class: 'lbl tool-chip', 'data-testid': 'tool-chip', title: 'The tool that is on (Esc or S: back to Select)' },
    'Tool: ' + (TOOLS.find((x) => x.id === state.tool) || { label: 'Select' }).label);
  ui.sheetChip = h('span', { class: 'lbl tool-chip', hidden: true, 'data-testid': 'sheet-chip', title: 'The page of the PDF that is shown' });
  return h('div', { class: 'status' }, ui.cmdUI.echo, ui.cmdUI.hint, ui.coords, toggles, ui.toolChip, ui.sheetChip, h('span', { class: 'gap' }),
    ui.entities = h('span', { class: 'lbl', 'data-testid': 'entities' }),
    ui.units = h('span', { class: 'lbl', 'data-testid': 'units' }),
    ui.layerInfo = h('span', { class: 'lbl', 'data-testid': 'layer-info' }), h('span', { class: 'lbl' }, 'mm'),
    h('label', { class: 'lbl dp', title: 'Decimal places in dimensions' }, 'Dim ',
      ui.dp = h('select', { class: 'dp-sel', 'data-testid': 'decimals', 'aria-label': 'Decimal places in dimensions' },
        [0, 1, 2, 3, 4].map((n) => h('option', { value: String(n) }, n ? '0.' + '0'.repeat(n) : '0')))));
}

/** Decimal places for dimensions: the selected placed part's width on a layout, and every kept dimension, re-labelled (undoable). */
function setDecimals(n) {
  state.dp = Math.max(0, Math.min(4, Math.round(+n) || 0));
  ui.dp.value = String(state.dp);
  try { localStorage.setItem('pd-decimals', String(state.dp)); } catch { /* storage may be blocked */ }
  let k = 0;
  for (const d of state.docs) {
    if (!d.raw || !d.hist || !d.fl) continue;
    const next = Ed.relabelDims(d.raw, d.factor, state.dp);
    if (next) { commit(d, next, 'Dimension decimals'); k++; }
  }
  update();
  note(`Dimensions: ${state.dp} decimal place${state.dp === 1 ? '' : 's'}` + (k ? ` (re-labelled in ${k} drawing${k === 1 ? '' : 's'}; Ctrl+Z undoes)` : ''));
}

function renderStatus() {
  const d = curDoc();
  ui.entities.textContent = d && d.fl ? 'Entities ' + d.entities : '';
  ui.units.textContent = d && d.fl ? d.conv : '';
  // the layer: a layout's parts are all on "Parts"; on a drawing tab it is the selection's own layer ("—" when nothing is selected)
  let layer = '—';
  if (d && d.lay) layer = 'Parts';
  else if (d && d.fl && d.sel && d.sel.size) {
    const names = [...new Set([...d.sel].map((e) => d.raw.entities[e] && d.raw.entities[e].layer).filter((n) => n != null))];
    layer = names.length === 1 ? names[0] : names.length + ' layers';
  }
  ui.layerInfo.textContent = 'Layer: ' + layer;
}

// ---- drawing the sheet ----

/** Every side with a gripper is shaded and labelled. */
function gripperBand() {
  const { sheetW: W, sheetH: H } = state, out = [];
  for (const [e, key] of Object.entries(GRIP_KEYS)) {
    const g = Number(state[key]);
    if (!(g > 0)) continue;
    const r = { bottom: [0, H - g, W, g], top: [0, 0, W, g], left: [0, 0, g, H], right: [W - g, 0, g, H] }[e];
    let cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
    const rot = e === 'left' ? -90 : e === 'right' ? 90 : 0;
    // the label is centred in its band unless a registration mark sits there: then it moves along the band to the nearest free spot
    const horiz = !rot, len = horiz ? r[2] : r[3], half = (8 + String(g).length) * 8.8 / 2 + 2, across = 9, markHalf = 14;       // the label is about 8.8 mm a letter, 12 mm tall
    const hits = (along) => regMarksNow().some((m) => {
      const lx = horiz ? along : cx, ly = horiz ? cy : along;
      return Math.abs(m.cx - lx) < markHalf + (horiz ? half : across) && Math.abs(m.cy - ly) < markHalf + (horiz ? across : half);
    });
    const free = [0.5, 0.25, 0.75, 0.15, 0.85].map((f) => (horiz ? r[0] : r[1]) + len * f).find((along) => !hits(along));
    if (free != null) { if (horiz) cx = free; else cy = free; }
    out.push(s('rect', { class: 'grip-band', 'data-edge': e, x: r[0], y: r[1], width: r[2], height: r[3] }),
      s('text', { class: 'grip-label', 'data-edge': e, x: cx, y: cy + 4, 'text-anchor': 'middle', transform: rot ? `rotate(${rot} ${cx} ${cy})` : null }, 'GRIPPER ' + g));
  }
  return out;
}
/** The registration marks drawn now on the open layout (y down): [{ cx, cy, r }]. */
function regMarksNow() {
  const lay = curLay();
  return lay && placedNow.length && !state.hidden.marks ? LD.marksOf(lay, placedNow).reg : [];
}

function marks(lay) {
  const g = LD.marksOf(lay, placedNow);
  const d = (segs) => segs.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join('');
  const out = [];
  if (g.crop.length) out.push(s('path', { d: d(g.crop) }));
  for (const m of g.reg) out.push(s('circle', { cx: m.cx, cy: m.cy, r: m.r }), s('path', { d: d(m.cross) }));
  return out;
}

/** The selected placed part's box on the sheet, mm, y down: [x0, y0, x1, y1], or null. */
function selBoxDown() {
  const lay = curLay(), p = lay && !multiSel() && state.sel >= 0 && placedNow[state.sel];
  if (!p) return null;
  const b = placedBox(lay.parts[p.partId], p);
  return [b[0], state.sheetH - b[3], b[2], state.sheetH - b[1]];
}

/** The sheet's size lines, and the width of the selected placed part. */
function dimensions() {
  const { sheetW: W, sheetH: H } = state;
  const out = [
    s('path', { class: 'dim', d: `M0 -6v-38M${W} -6v-38M0 -34h${W}` }),
    s('path', { class: 'dim', d: `M-6 0h-38M-6 ${H}h-38M-34 0v${H}` }),
    s('text', { class: 'dim-text', x: W / 2, y: -42, 'text-anchor': 'middle' }, W),
    s('text', { class: 'dim-text', x: -42, y: H / 2, 'text-anchor': 'middle', transform: `rotate(-90 -42 ${H / 2})` }, H),
  ];
  const b = selBoxDown();
  if (b) {
    const bw = b[2] - b[0], by = b[3], t = Ed.dimText(bw, state.dp), tw = 10 + 7 * t.length, cx = b[0] + bw / 2;
    // below the part with its extension lines when that spot is empty; else the width is a small tag on the part's own bottom edge,
    // never over another part (a tight grid has no empty spot outside)
    const lay = curLay(), others = placedNow.filter((_, i) => i !== state.sel && !selIdxs().includes(i)).map((p) => { const q = placedBox(lay.parts[p.partId], p); return [q[0], H - q[3], q[2], H - q[1]]; });
    const clashes = (r) => others.some((o) => o[0] < r[2] && o[2] > r[0] && o[1] < r[3] && o[3] > r[1]);
    const below = [b[0], by + 15, b[2], by + 40], above = [b[0], b[1] - 40, b[2], b[1] - 15];
    if (!clashes(below) && by + 40 <= H + 60) {
      out.push(s('path', { class: 'dim', d: `M${b[0]} ${by + 15}v22M${b[2]} ${by + 15}v22M${b[0]} ${by + 31}h${bw}` }),
        s('rect', { class: 'dim-bg', x: cx - tw / 2, y: by + 23, width: tw, height: 17, rx: 2 }),
        s('text', { class: 'dim-text small', x: cx, y: by + 36, 'text-anchor': 'middle' }, t));
    } else if (!clashes(above) && b[1] - 40 >= -60) {
      const ay = b[1];
      out.push(s('path', { class: 'dim', d: `M${b[0]} ${ay - 15}v-22M${b[2]} ${ay - 15}v-22M${b[0]} ${ay - 31}h${bw}` }),
        s('rect', { class: 'dim-bg', x: cx - tw / 2, y: ay - 40, width: tw, height: 17, rx: 2 }),
        s('text', { class: 'dim-text small', x: cx, y: ay - 27, 'text-anchor': 'middle' }, t));
    } else if (tw + 4 <= bw && b[3] - b[1] >= 21) {
      out.push(s('rect', { class: 'dim-bg tag', x: cx - tw / 2, y: by - 20, width: tw, height: 17, rx: 2 }),
        s('text', { class: 'dim-text small', x: cx, y: by - 7, 'text-anchor': 'middle' }, t));
    } else {                                                                              // too small to hold it: a tag above the sheet's edge, with a thin line to the part
      out.push(s('path', { class: 'dim', d: `M${cx} ${b[1]}V-9` }),
        s('rect', { class: 'dim-bg tag', x: cx - tw / 2, y: -26, width: tw, height: 17, rx: 2 }),
        s('text', { class: 'dim-text small', x: cx, y: -13, 'text-anchor': 'middle' }, t));
    }
  }
  return out;
}

/** The sheet (on a layout tab) with its grippers, usable area, a hit box per placed part, the marks, the dimensions and the gaps. */
function drawSheet() {
  const lay = curLay(), { sheetW: W, sheetH: H } = state, L = layout, area = L.area;
  const parts = lay ? placedNow.map((p, i) => (partHid(p) ? null : s('g', { 'data-i': i }, s('polygon', { class: 'part-hit', points: polyPoints(PL.corners(lay.parts[p.partId], p), H) })))).filter(Boolean) : [];
  ui.gParts = s('g', { 'data-group': 'parts' }, parts);
  ui.gTools = s('g', { class: 'ptools', 'data-group': 'tools' });
  ui.gMarks = s('g', { class: 'marks', 'data-group': 'marks' }, lay ? marks(lay) : []);
  ui.gDims = s('g', { 'data-group': 'dims' }, lay ? dimensions() : []);
  ui.gGaps = s('g', { 'data-group': 'gaps' }, gapShapes(L));
  ui.gGuides = s('g', { 'data-group': 'guides' });
  ui.gSheetSel = s('g', { class: 'sheetsel', 'data-group': 'sheetsel' });
  ui.svg.replaceChildren(
    s('rect', { class: 'sheet-shadow', x: 5, y: 7, width: W, height: H }),
    s('rect', { class: 'sheet', x: 0, y: 0, width: W, height: H }),
    ...gripperBand(),
    s('rect', { class: 'printable', x: area.x, y: area.y, width: area.w, height: area.h }),
    ui.gParts, ui.gMarks, ui.gDims, ui.gGaps, ui.gGuides, ui.gTools, ui.gSheetSel);
  drawTools();
  drawSheetSel();
  drawGuides();
  drawRulers();
  applyHidden();
}

/** Points of an SVG polygon from sheet points (mm, y up). */
const polyPoints = (pts, H) => pts.map((q) => `${+q[0].toFixed(3)},${+(H - q[1]).toFixed(3)}`).join(' ');

/**
 * What is drawn over the selected placed part: its outline, and the size handles (for show: a part is scaled with its drawing) or, in rotate
 * mode, the four turn arrows and the pivot ◎. Sizes are in screen pixels, so it is redrawn when the view zooms.
 */
function drawTools() {
  const g = ui.gTools;
  if (!g) return;
  const lay = curLay(), sel = selectedPlaced();
  if (!lay || state.hidden.parts || sheetSelOn()) { g.replaceChildren(); return; }
  const H = state.sheetH, k = 1 / view.scale, Y = (q) => [q[0], H - q[1]], out = [];
  const poly = (pts) => pts.map((q) => `${+q[0].toFixed(3)},${+q[1].toFixed(3)}`).join(' ');
  for (const p of placedNow) {                                      // a padlock on the upper-right corner of every locked part
    if (!p.lock || !lay.parts[p.partId]) continue;
    const b = placedBox(lay.parts[p.partId], p);
    out.push(s('g', { class: 'padlock', 'data-locked': '1', transform: `translate(${b[2]} ${H - b[3]}) scale(${k})` }, s('rect', { class: 'padlock-bg', x: -13, y: -13, width: 26, height: 26, rx: 5 }),
      s('g', { transform: 'translate(-9 -9) scale(0.75)' }, s('rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }), s('path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }))));
  }
  const items = selItems();
  if (items.length > 1) {                                           // several selected: each outline, the box round them with its readout, and the pick-order numbers
    const ghosts = pdrag && pdrag.ghosts;
    if (ghosts) for (const gh of ghosts) out.push(s('polygon', { class: 'ghost', points: poly(PL.corners(gh.part, gh.pl).map(Y)) }));
    for (const x of items) out.push(s('polygon', { class: 'sel-box sel-multi', points: poly(PL.corners(x.part, x.p).map(Y)) }));
    const ub = A.unionBox(items.map(boxOf)), pad = 8 * k, x0 = ub[0] - pad, x1 = ub[2] + pad, yT = H - ub[3] - pad, yB = H - ub[1] + pad, xm = (x0 + x1) / 2, ym = (yT + yB) / 2;
    out.push(s('rect', { class: 'sel-union', x: x0, y: yT, width: x1 - x0, height: yB - yT }));
    out.push(s('g', { class: 'grip-sq' }, [[x0, yT], [xm, yT], [x1, yT], [x0, ym], [x1, ym], [x0, yB], [xm, yB], [x1, yB]].map((q) => s('rect', { x: q[0] - 6 * k, y: q[1] - 6 * k, width: 12 * k, height: 12 * k }))));
    const whole = wholeGroup(), text = whole ? `Group of ${items.length}` : `${items.length} parts · ${fmt(ub[2] - ub[0])} × ${fmt(ub[3] - ub[1])}`;
    if (whole) {
      const tw = (text.length * 7.4 + 24) * k;
      out.push(s('rect', { class: 'group-tag', x: x0, y: yT - 32 * k, width: tw, height: 24 * k, rx: 4 * k }), s('text', { class: 'group-tag-text', x: x0 + tw / 2, y: yT - 15 * k, 'text-anchor': 'middle', 'font-size': 13 * k, 'data-testid': 'sel-readout' }, text));
    } else {
      out.push(s('text', { class: 'sel-readout', x: x0, y: yT - 10 * k, 'font-size': 14 * k, 'data-testid': 'sel-readout' }, text));
      items.forEach((x, n) => {
        const b = boxOf(x), cx = b[0], cy = H - b[3];
        out.push(s('g', { class: 'pick-badge' }, s('circle', { cx, cy, r: 11 * k }), s('text', { x: cx, y: cy + 4.5 * k, 'text-anchor': 'middle', 'font-size': 13 * k }, String(n + 1))));
      });
    }
    g.replaceChildren(...out);
    return;
  }
  if (!sel) { g.replaceChildren(...out); return; }
  const cor = PL.corners(sel.part, sel.p).map(Y);
  if (pdrag && pdrag.ghost) out.push(s('polygon', { class: 'ghost', points: poly(PL.corners(sel.part, pdrag.ghost).map(Y)) }));
  if (pdrag && pdrag.ghosts) for (const gh of pdrag.ghosts) out.push(s('polygon', { class: 'ghost', points: poly(PL.corners(gh.part, gh.pl).map(Y)) }));
  out.push(s('polygon', { class: 'sel-box', points: poly(cor), 'data-mode': state.mode }));
  if (state.mode === 'rotate') {
    const mid = PL.centreOf(sel.part, sel.p), c = Y(mid), pv = Y(pivotPoint(sel.part, sel.p));
    cor.forEach((q, i) => {
      const a = Math.atan2(q[1] - c[1], q[0] - c[0]), r = 17 * k, span = 0.9;
      const at = (t) => [q[0] + r * Math.cos(t), q[1] + r * Math.sin(t)], p0 = at(a - span), p1 = at(a + span);
      const d = `M${p0[0]} ${p0[1]}A${r} ${r} 0 0 1 ${p1[0]} ${p1[1]}`;
      const head = (pt, t, dir) => {                                  // a small arrowhead at the arc's end, pointing along it
        const tx = -Math.sin(t) * dir, ty = Math.cos(t) * dir, nx = Math.cos(t), ny = Math.sin(t), tip = [pt[0] + tx * 7 * k, pt[1] + ty * 7 * k];
        return s('path', { class: 'rot-head', d: `M${tip[0]} ${tip[1]}L${pt[0] + nx * 4.5 * k} ${pt[1] + ny * 4.5 * k}L${pt[0] - nx * 4.5 * k} ${pt[1] - ny * 4.5 * k}Z` });
      };
      out.push(s('g', { class: 'rot-arrow' }, s('path', { class: 'rot-arc', d, 'stroke-width': 2 * k }), head(p1, a + span, 1), head(p0, a - span, -1),
        s('path', { class: 'rot-hit', d, 'stroke-width': 16 * k, 'data-rot': i })));
    });
    out.push(s('g', { class: 'pivot' }, s('circle', { class: 'pivot-ring', cx: pv[0], cy: pv[1], r: 7.5 * k, 'stroke-width': 1.8 * k }), s('circle', { class: 'pivot-dot', cx: pv[0], cy: pv[1], r: 2.6 * k }),
      s('circle', { class: 'pivot-hit', cx: pv[0], cy: pv[1], r: 12 * k, 'data-pivot': '1' })));
    if (pdrag && pdrag.label) out.push(s('text', { class: 'rot-label', x: pv[0] + 12 * k, y: pv[1] - 12 * k, 'font-size': 13 * k, 'stroke-width': 3 * k }, pdrag.label.text));
  } else {
    out.push(s('g', { class: 'grip-sq' }, PL.handlePoints(sel.part, sel.p).map(Y).map((q) => s('rect', { x: q[0] - 3.5 * k, y: q[1] - 3.5 * k, width: 7 * k, height: 7 * k }))));
  }
  g.replaceChildren(...out);
}

function applyHidden() {
  if (!ui.gParts) return;
  ui.gParts.style.display = state.hidden.parts ? 'none' : '';
  ui.gMarks.style.display = state.hidden.marks ? 'none' : '';
  ui.gDims.style.display = state.hidden.dims ? 'none' : '';
  ui.gGaps.style.display = state.hidden.parts ? 'none' : '';
  ui.gTools.style.display = state.hidden.parts ? 'none' : '';
}

// ---- view: zoom, pan, fit ----
const canvasSize = () => { const r = ui.canvas.getBoundingClientRect(); return { w: Math.max(r.width, 1), h: Math.max(r.height, 1) }; };

function applyView() {
  const { w, h: ch } = canvasSize();
  ui.svg.setAttribute('viewBox', `${view.ox} ${view.oy} ${w / view.scale} ${ch / view.scale}`);
  ui.ovl.setAttribute('viewBox', `${view.ox} ${view.oy} ${w / view.scale} ${ch / view.scale}`); ui.ovl.setAttribute('preserveAspectRatio', 'none');
  ui.svg.setAttribute('preserveAspectRatio', 'none');
  // 100% = real size on a 96 dpi screen (3.78 px per mm)
  ui.pct.textContent = Math.round(view.scale / (96 / 25.4) * 100) + '%';
  ui.fitBtn.classList.toggle('on', view.fitted);
  drawTools();
  drawSheetSel();
  drawGuides();
  drawRulers();
  paintOverlay();
}

/** The numbers of the entities hidden one by one (d.hid holds the entity objects): looked up again when the entity list changed. */
function hidIdx(d) {
  if (!d.hid || !d.hid.size) return null;
  if (!d.hidC || d.hidC.ents !== d.raw.entities) d.hidC = { ents: d.raw.entities, set: OB.hiddenIndexes(d.raw.entities, d.hid) };
  return d.hidC.set;
}
/** Entities not painted: the one a grip is dragging (the overlay draws it) and the ones hidden one by one in the Objects tab. */
function hideNow(d) {
  const drag = d && state.grip && state.grip.d === d && state.grip.next ? state.grip.e : null;
  if (!d || (drag == null && !(d.hid && d.hid.size))) return null;
  const out = new Set(hidIdx(d) || []);
  if (drag != null) out.add(drag);
  return out;
}
// the drawing canvas repaints once per frame, however often the view changes
let paintQueued = 0;
function paintOverlay() {
  if (paintQueued) return;
  paintQueued = requestAnimationFrame(() => {
    paintQueued = 0;
    drawOvl();
    const { w, h: ch } = canvasSize(), dpr = window.devicePixelRatio || 1, c = ui.dcanvas;
    const cw = Math.max(1, Math.round(w * dpr)), chh = Math.max(1, Math.round(ch * dpr));
    if (c.width !== cw || c.height !== chh) { c.width = cw; c.height = chh; }
    const d = curDoc();
    const base = { sheetH: state.sheetH, ox: view.ox, oy: view.oy, scale: view.scale, w, h: ch, dpr, dark: isDark() };
    if (d && d.cmp) { cmpPaint(c, d.cmp, base); return; }
    if (d && d.lay) {                       // a layout: each part painted once for all the places it is placed at (its matrix per place)
      paintDrawing(c, { ...base, fl: null, factor: 1 });                                      // clears
      if (!state.hidden.parts) {
        const byPart = new Map();
        for (const p of placedNow) { if (!byPart.has(p.partId)) byPart.set(p.partId, []); byPart.get(p.partId).push(p); }
        for (const [id, part] of Object.entries(d.lay.parts)) {
          if (d.hiddenParts && d.hiddenParts.has(id)) continue;                                // hidden in the Objects tab
          const mine = byPart.get(id) || [], slotsOf = (list) => list.map((p) => placedMat(part, p, state.sheetH));
          const on = mine.filter((p) => !p.off), outside = mine.filter((p) => p.off);          // a part off the sheet is drawn in the mark colour
          if (on.length) paintDrawing(c, { ...base, keep: true, fl: part.fl, off: part.off, factor: part.factor || 1, slots: slotsOf(on) });
          if (outside.length) paintDrawing(c, { ...base, keep: true, fl: part.fl, off: part.off, factor: part.factor || 1, slots: slotsOf(outside), tint: cssVar('--mark', '#c2410c') });
        }
      }
      return;
    }
    const L2 = state.setlen || state.meas || state.dim || state.ldr;
    const marks = L2 && d ? [...L2.pts.map((q) => [q[0], q[1], q[2], false]), ...(L2.pts.length < 2 && L2.hover ? [[L2.hover[0], L2.hover[1], L2.hover[2], true]] : [])] : null;
    paintDrawing(c, { ...base, fl: d && d.fl, off: d && d.off, factor: d ? d.factor : 1,
      bg: d && d.bg, hl: d ? (state.grip && state.grip.d === d && state.grip.next ? d.hl.filter((it) => it.e !== state.grip.e) : textSel(d) ? d.hl.filter((it) => it.k !== 't') : d.hl) : null, hide: hideNow(d), marks: marks || (drawLive() && state.drawHover && state.drawHover[2] ? [[state.drawHover[0] / d.factor, state.drawHover[1] / d.factor, state.drawHover[2], true]] : state.grip && state.grip.d === d && state.grip.to && state.grip.to[2] ? [[state.grip.to[0], state.grip.to[1], state.grip.to[2], true]] : null), dim: previewDim(d), gaps: d && state.gapShow && d.ed && editable() ? gapsOf(d).map((g) => [g.x, g.y]) : null,
      contour: d && d.cRes && state.tool === 'contour' ? d.cRes.polys : null,
      contourCol: d && d.cRes ? contourColour(d).replace('var(--text)', cssVar('--text', '#18181b')) : null, contourDash: contourStyle().dash,
      markCol: cssVar('--mark', '#c2410c'),
      accent: cssVar('--accent', '#4f46e5'),
      dimCol: cssVar('--dim', '#0f766e') });
  });
}

function fit() {
  const { w, h: ch } = canvasSize();
  // the sheet and, if one is open, the drawing; room for the dimension lines around
  const d = curDoc(), part = partView(d), lay = !!(d && d.lay), cb = cmpBox(d);
  const r = cb ? boxOnSheet(cb, state.sheetH) : part ? boxOnSheet(viewBox(d), state.sheetH) : lay ? fitRect(state.sheetW, state.sheetH, null) : boxOnSheet([0, 0, 200, 120], state.sheetH), P = lay ? 80 : 30;
  const bw = r[2] - r[0] + 2 * P, bh = r[3] - r[1] + 2 * P - (lay ? 10 : 0);
  const R = state.rulers ? RULER : 0, w2 = w - R, h2 = ch - R;                  // the rulers cover the top and left edge of the canvas: fit into what is left
  view.scale = Math.min(w2 / bw, h2 / bh);
  view.ox = r[0] - P - (w2 / view.scale - bw) / 2 - R / view.scale;
  view.oy = r[1] - P - (h2 / view.scale - bh) / 2 - R / view.scale;
  view.fitted = true;
  applyView();
}

function zoomAt(factor, px, py) {
  const next = Math.min(40, Math.max(0.05, view.scale * factor));
  const mx = view.ox + px / view.scale, my = view.oy + py / view.scale;
  view.scale = next;
  view.ox = mx - px / next; view.oy = my - py / next;
  view.fitted = false;
  applyView();
}
function zoomBy(factor) { const { w, h: ch } = canvasSize(); zoomAt(factor, w / 2, ch / 2); }

function attachCanvasEvents() {
  const c = ui.canvas;
  const local = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  let pan = null, drag = null, lrub = null;                          // lrub: a rubber band started on an empty bit of a layout's sheet
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  }, { passive: false });
  c.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.zoombox, .contourpanel, .preflightpanel, .balsheets, .balpic')) return;
    const rl = e.target.closest && e.target.closest('.ruler'), gh0 = e.target.closest && e.target.closest('[data-guide]');
    if (e.button === 0 && rl && !rl.classList.contains('corner')) { guideDown(e, rl.dataset.axis === 'top' ? 'y' : 'x', null); if (gdrag) { capture(c, e); } return; }
    if (e.button === 0 && gh0 && curLay() && !state.setlen && state.tool !== 'pan' && !curLay().s.guidesLock) { guideDown(e, gh0.dataset.axis, Number(gh0.dataset.guide)); if (gdrag) { capture(c, e); } return; }
    if (e.button === 0 && state.tool !== 'pan' && cmpDown(e)) return;
    if (e.button === 1 || (e.button === 0 && state.tool === 'pan')) {
      e.preventDefault();
      pan = { x: e.clientX, y: e.clientY };
      capture(c, e);
      c.classList.add('panning');
    } else if (e.button === 0 && state.tool !== 'pan') {
      const gh = e.target.closest && e.target.closest('[data-gap]');
      if (sheetDown(e)) { capture(c, e); return; }
      if (balDown(e)) { capture(c, e); return; }
      if (gripDown(e)) { capture(c, e); return; }
      if (!state.match && textHandleDown(e)) { capture(c, e); return; }
      if (state.tool === 'text' && drawTarget()) { textToolDown(e); return; }
      if (state.draw && drawTarget()) { drawClick(e); return; }
      if (gh && !state.setlen) return;                          // a gap is picked on click (below), so the browser's own focus change does not undo ours
      const d = state.tool === 'measure' || state.setlen ? editable() : editable();
      if (d && (state.tool === 'select' || state.tool === 'contour' || state.tool === 'measure' || state.tool === 'dimension' || state.tool === 'leader' || state.tool === 'balloon' || state.setlen || modLive())) {
        drag = { x: e.clientX, y: e.clientY, p: toDrawing(d, e.clientX, e.clientY), moved: false, shift: e.shiftKey };
        if ((state.tool === 'select' || state.tool === 'contour') && !state.setlen) drag.dim = dimGrab(d, drag.p);
        capture(c, e);
      }
      if (curLay() && (state.tool === 'select' || state.tool === 'step')) {
        if (placedDown(e)) { capture(c, e); }
        else if (!gh) { lrub = { x: e.clientX, y: e.clientY, shift: e.shiftKey, moved: false }; capture(c, e); }
      }
    }
  });
  c.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (gdrag) guideMove(e);
    if (state.sheetDrag) sheetMove(e);
    if (pdrag) placedMove(e);
    if (lrub) { if (!lrub.moved && Math.hypot(e.clientX - lrub.x, e.clientY - lrub.y) > 4) lrub.moved = true; if (lrub.moved) showRubber(lrub, e); }
    if (pan) {
      view.ox -= (e.clientX - pan.x) / view.scale; view.oy -= (e.clientY - pan.y) / view.scale;
      pan = { x: e.clientX, y: e.clientY };
      view.fitted = false;
      applyView();
    }
    const d = editable();
    if (state.draw && d && state.drawDoc === curDoc()) drawHoverAt(d, e.clientX, e.clientY, e.shiftKey);
    if (d && modLive()) modHover(d, e.clientX, e.clientY, e.shiftKey);
    if (state.text.drag) textDragMove(e);
    if (state.grip) gripMove(e);
    if (state.balDrag) balMove(e);
    const picking = (modLive() && !(state.mod.kind === 'mirror' && state.mod.stage === 'pick')) || state.setlen || state.tool === 'measure' || state.tool === 'dimension' || state.tool === 'leader' || state.tool === 'balloon';
    if (drag && !picking && !drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
    if (drag && drag.moved && drag.dim) { if (!drag.dim.cancelled) dimDragTo(d, drag.dim, toDrawing(d, e.clientX, e.clientY)); }
    else if (drag && drag.moved && !picking) showRubber(drag, e);
    const act = state.setlen || (state.tool === 'measure' ? state.meas : null);
    if (d && act && act.pts.length < 2) { act.hover = pickPoint(d, toDrawing(d, e.clientX, e.clientY), act.pts, e.shiftKey, true); paintOverlay(); }
    if (d && state.dim && editable()) dimHover(d, toDrawing(d, e.clientX, e.clientY), e.shiftKey);
    if (d && state.ldr && editable()) ldrHover(d, toDrawing(d, e.clientX, e.clientY), e.shiftKey);
    if (d && state.bal && editable()) balHover(d, toDrawing(d, e.clientX, e.clientY), e.shiftKey);
    const mx = view.ox + p.x / view.scale, my = view.oy + p.y / view.scale;
    const [cx, cy] = cursorMm(mx, my, state.sheetH);
    ui.coords.textContent = `X ${fmt(cx)}   Y ${fmt(cy)} mm`;
  });
  const end = () => { pan = null; c.classList.remove('panning'); };
  c.addEventListener('pointerup', (e) => {
    if (gdrag) guideUp();
    if (state.sheetDrag && !state.sheetDrag.hot) sheetUp(e);
    if (state.text.drag) textDragEnd(false);
    if (state.grip) gripUp(e);
    if (state.balDrag) balUp();
    if (pdrag) placedUp();
    if (lrub) { const r = lrub; lrub = null; hideRubber(); layoutBoxSelect(r, e); }
    const was = drag; drag = null;
    const d = editable();
    if (was && d && e.button === 0) {
      hideRubber();
      const p = toDrawing(d, e.clientX, e.clientY);
      if (state.setlen) { if (!was.moved) lengthPoint(d, p, e.shiftKey); }
      else if (state.tool === 'measure') { if (!was.moved) measurePoint(d, p, e.shiftKey); }
      else if (state.tool === 'dimension') dimensionPoint(d, p, e.shiftKey);
      else if (state.tool === 'leader') ldrPoint(d, p, e.shiftKey);
      else if (state.tool === 'balloon') balClick(d, p, e.shiftKey);
      else if (modLive()) modUp(d, was, p, e.shiftKey);
      else if (state.match && editable() === d) { if (!was.moved) matchClick(d, was.p); }
      else if (was.dim && was.moved) dimDragEnd(d, was.dim);
      else if (!editable()) { /* a layout tab: its placed parts are picked by the page itself (data-i) */ }
      else if (was.moved) boxSelect(d, was.p, p, e.shiftKey || was.shift);
      else clickSelect(d, was.p, e.shiftKey || was.shift);
    }
    end();
  });
  c.addEventListener('click', (e) => { const gh = e.target.closest && e.target.closest('[data-gap]'); if (gh && !state.setlen) pickGap(gh.dataset.gap); });
  c.addEventListener('dblclick', (e) => { if (!balDbl(e)) textDblClick(e); });
  c.addEventListener('mousedown', (e) => { if (e.button === 0 && state.tool === 'text' && !e.target.closest('.texted, .zoombox, .contourpanel')) e.preventDefault(); });      // the click places a text: it must not take the focus from the box it opens
  c.addEventListener('pointercancel', () => { if (state.grip && !state.grip.hot) gripCancel(); state.balDrag = null; if (state.text.drag) textDragEnd(true); if (gdrag) cancelGuideDrag(); if (pdrag) cancelPlacedDrag(); drag = null; lrub = null; state.dimDrag = null; hideRubber(); paintOverlay(); end(); });
  c.addEventListener('auxclick', (e) => e.preventDefault());
  c.addEventListener('contextmenu', (e) => {                       // right-click an outline on a drawing tab: Extract part… and the other things to do with it
    e.preventDefault();
    const gh = e.target.closest && e.target.closest('[data-guide]');
    if (state.draw && !curLay()) { if (DR.toolBusy(state.draw)) drawFinish(); return; }
    if (modLive()) { modEnter(editable()); return; }
    if (gh && curLay()) { guideMenu(e, Number(gh.dataset.guide)); return; }
    if (curLay()) { layoutMenu(e); return; }
    const d = editable();
    if (!d || state.setlen) return;
    const p = toDrawing(d, e.clientX, e.clientY), hit = Ed.hitEntity(edIndex(d), p[0], p[1], pickTol(d));
    if (hit >= 0 && !d.sel.has(hit)) clickSelect(d, p, false);
    if (!d.sel.size) return;
    const items = [['Measure from here', () => { setTool('measure'); measurePoint(d, p, false); }], ['Delete', deleteSelection]];
    popMenu(e.clientX, e.clientY, selHasPart(d) ? [['Extract part…', extractPart], ['Keep only this', keepSelection], ...items] : items);   // a dimension alone is not a part
  });
  new ResizeObserver(() => { if (view.fitted) fit(); else applyView(); }).observe(c);
}

// ---- keeping the panels in step with the layout ----
function renderCommand() {
  if (ui.keepMeas) ui.keepMeas.hidden = !(state.meas && state.meas.pts.length === 2 && editable());
  if (ui.modAsk) ui.modAsk.hidden = !(modLive() && state.mod.kind === 'mirror' && state.mod.stage === 'erase');
  const cm = cmpDoc();
  if (cm) { cmpCommand(cm.cmp); return; }
  if (state.dsOpen) { ui.hist.textContent = 'Command: DIMSTYLE   Dimension style'; ui.prompt.textContent = 'Preset, arrow size, text height, decimals, gap, units and text position. OK applies, Esc cancels:'; return; }
  const t = TOOLS.find((x) => x.id === state.tool), lay = curLay(), ed = editable();
  if (lay && state.sheetDrag && (state.sheetDrag.moved || state.sheetDrag.hot)) { const sg = state.sheetDrag; ui.hist.textContent = `Command: STRETCH   Sheet W ${sg.newW} × H ${sg.newH} mm (whole mm)`; ui.prompt.textContent = state.msg ? state.msg : 'Specify the new edge (click, Esc cancels):'; return; }
  if (lay && sheetSelOn()) { ui.hist.textContent = `Command: SELECT   Sheet ${state.sheetW} × ${state.sheetH} mm selected. Drag a side handle to resize, Esc deselects`; ui.prompt.textContent = state.msg ? state.msg : 'Drag a side handle, or type Width and Height in the Sheet section:'; return; }
  if (state.match && ed && ed.raw.entities[state.match.src]) { ui.hist.textContent = 'Command: MATCHPROP   Source: ' + matchWords(ed.raw.entities[state.match.src]) + (state.msg ? '   ' + state.msg : ''); ui.prompt.textContent = 'Select destination object (Esc ends):'; return; }
  if (state.grip && ed) { const gg = state.grip; ui.hist.textContent = `Command: ${GR.commandOf(gg.ent, gg.id)}   ${gg.hot ? 'Hot grip: click the new place' : 'Dragging a grip'}` + (state.msg ? '   ' + state.msg : ''); ui.prompt.textContent = 'Specify the new point (click, x,y, @dx,dy or a length; Esc cancels):'; return; }
  if (state.tool === 'text' && ed) { ui.hist.textContent = textStatus() + (state.msg ? '   ' + state.msg : ''); ui.prompt.textContent = textEditing() ? 'Type the text. Enter ends, Shift+Enter starts a new line:' : 'Specify insertion point or [Height / Justify / Style]:'; return; }
  if (modLive()) { modSync(ed); const mp = modPrompt(ed); ui.hist.textContent = mp.status + (state.msg ? '   ' + state.msg : ''); ui.prompt.textContent = mp.prompt; return; }
  if (drawLive()) { const dp = DR.toolPrompt(state.draw, curLayerName(ed)); ui.hist.textContent = dp.status + (state.msg ? '   ' + state.msg : ''); ui.prompt.textContent = dp.prompt; return; }
  const gp = lay && lay.parts[lay.s.gridPart];
  const rs = state.mode === 'rotate' ? selectedPlaced() : null, rp = rs && pivotPoint(rs.part, rs.p);
  const nSel = lay ? selIdxs().length : 0, gd = state.guideDrag && lay && lay.s.guides[state.guideDrag.idx];
  ui.hist.textContent = gd ? `Command: GUIDE   Dragging a ${gd.axis === 'y' ? 'horizontal' : 'vertical'} guide from the ${gd.axis === 'y' ? 'top' : 'left'} ruler (Esc cancels)` : rs ? `Command: ROTATE   Pivot: ${fmt(rp[0])}, ${fmt(rp[1])}` : (state.tool === 'select' || state.tool === 'step') && nSel > 1 ? `Command: SELECT   ${wholeGroup() ? `Group of ${nSel}` : `${nSel} parts selected`} (Shift-click adds or removes a part)` : state.tool === 'step' && lay
    ? `Command: STEP   Part: ${gp ? gp.name : '(none)'}   Gap X <5>: ${state.gapX}   Gap Y <5>: ${state.gapY}   Click a gap between rows or columns for extra room`
    : state.tool === 'contour' && ed ? 'Command: CONTOUR   ' + contourCommandText()
    : state.tool === 'select' && ed ? 'Command: SELECT   Click an edge: its whole outline. Shift adds or removes, drag a box, Esc clears. Right-click: Extract part…'
    : state.tool === 'dimension' && ed ? 'Command: ' + dimTypeRow(state.dimType)[4]
    : state.tool === 'leader' && ed ? 'Command: LEADER'
    : state.tool === 'balloon' && ed ? `Command: BALLOON   next no. ${balOf(ed).next}`
    : 'Command: ' + t.label.toUpperCase();
  const word = state.fit ? 'fit' : 'placed';
  ui.prompt.textContent = gd ? `${gd.axis.toUpperCase()} position <${fmt(gd.mm)}>:` : state.msg ? state.msg
    : rs ? `Angle <${fmt(rs.p.rot)}>: ${state.rotCopy ? 'Copy on. ' : ''}[Pivot / Copy / Esc]:`
    : state.tool === 'contour' && ed ? 'Option [Inside / Outside / Distance / Steps / Sharp / Rounded / Apply]:'
    : nSel > 1 ? (wholeGroup() ? 'Command [Group / Ungroup / Lock / Unlock]:' : 'Align or distribute [Left / Centre / Right / Top / Middle / Bottom / Horizontal / Vertical]:')
    : lay ? (gp
      ? (layout.count ? `${layout.count} ${word} (${layout.cols} × ${layout.rows}), ${Math.round(layout.usedPct)}% of sheet${layout.fits ? '' : '. Does not fit the usable area'}. [Apply / Rotate / Nest]:`
        : '0 fit: the part is larger than the usable area. [Apply / Rotate / Nest]:')
      : `${placedNow.length} placed part${placedNow.length === 1 ? '' : 's'}. Pick a part for step and repeat, or add one from the Parts library:`)
    : state.tool === 'balloon' && ed ? balPrompt()
    : ed && ed.sel.size ? `${ed.sel.size} selected. [Extract / Keep only / Measure]:`
    : ed ? 'Click an outline to select it. [Extract / Keep only / Measure]:' : '';
}

/**
 * The property bar of a layout. A placed part selected: its name, where it is and how it is turned. Nothing selected: the layout
 * itself and where its parts come from. The Parts library open: what to do with it.
 */
function renderProps() {
  const lay = curLay(), library = state.panel === 'library', p = lay && !library && state.sel >= 0 && placedNow[state.sel], part = p && lay.parts[p.partId];
  const items = p ? selItems() : [], many = items.length > 1, whole = many && wholeGroup();
  const locked = items.length > 0 && items.some((x) => x.p.lock), allLocked = items.length > 0 && items.every((x) => x.p.lock);
  ui.pfields.hidden = !p; ui.partFrom.hidden = !!p;
  if (lay && !p) {
    const from = [...new Set(Object.values(lay.parts).map((q) => q.src).filter(Boolean))];
    ui.partName.textContent = library ? 'Parts library' : 'Layout · ' + curDoc().name;
    ui.partKind.textContent = library ? 'drag a part onto the sheet, or press Add to sheet' : 'its own tab, not tied to one drawing';
    ui.partFrom.textContent = library ? '' : 'Parts from: ' + (from.length ? from.join(', ') : 'none yet');
  } else {
    ui.partName.textContent = many ? (whole ? `Group of ${items.length}` : `${items.length} parts selected`) : part ? part.name : '';
    ui.partKind.textContent = many ? (whole ? 'group' : '') : p ? (p.src === 'grid' ? 'placed part · step and repeat' : 'placed part') : '';
  }
  ui.partKind.hidden = !!(many && !whole);
  ui.partOrigin.hidden = !(lay && !p && !library);
  if (lay) ui.partOrigin.textContent = `Sheet ${fmtSize(lay.s.sheetW)} × ${fmtSize(lay.s.sheetH)} mm · Origin 0,0 at the sheet's bottom-left · Y points up` + (state.rulers ? ' · Rulers: mm' : '');
  ui.lockChip.hidden = !allLocked; ui.ppLock.hidden = !allLocked;
  const b = many ? selBox() : part && placedBox(part, p);
  ui.pw.value = b ? fmt(b[2] - b[0]) : '—';
  ui.ph.value = b ? fmt(b[3] - b[1]) : '—';
  for (const k of ['pw', 'ph']) ui[k].disabled = !p;
  for (const f of placedFields) {                                   // the typed fields show the part's values, except the one being typed in
    f.input.disabled = !p || !f.enabled() || (locked && f.input.dataset.lockable === '1') || (many && /^rot-p[xy]$/.test(f.input.dataset.testid));
    if (document.activeElement !== f.input) f.input.value = p ? f.show() : '—';
  }
  const secOn = { 'sec-arrange': many, 'sec-group': true };
  for (const sec of ui.placedSecs) sec.hidden = !p || (sec.dataset.testid in secOn && !secOn[sec.dataset.testid]);
  if (p) {
    ui.ppName.textContent = many ? (whole ? `Group of ${items.length}` : `${items.length} parts`) : part.name;
    ui.ppSize.textContent = `${fmtSize(b[2] - b[0])} × ${fmtSize(b[3] - b[1])}`;
    ui.members.hidden = !many;
    ui.members.replaceChildren(...(many ? items.map((x, n) => { const bx = boxOf(x); return h('li', { class: 'row member' }, h('span', { class: 'lbl mono' }, String(n + 1)), h('span', { class: 'nm' }, x.part.name), x.p.lock ? icon(ICONS.lock, { size: 12, width: 1.8, label: 'Locked' }) : null, h('span', { class: 'lbl mono' }, `${fmtSize(bx[2] - bx[0])} × ${fmtSize(bx[3] - bx[1])}`)); }) : []));
    ui.secTitle.textContent = many ? (whole ? 'Selected group' : 'Selected parts') : 'Selected part';
    ui.pivotSel.value = state.pivot.kind;
    for (const el of ui.pivotRows) el.hidden = many;
    ui.rotHelp.textContent = many ? 'The selection turns by the angle you type, about its middle.' : 'Click the part again to turn it by hand; drag ◎ to move the pivot.';
    ui.relSel.value = state.arrangeRel;
    const hasGroup = items.some((x) => x.p.g);
    ui['grp-group'].disabled = !many || whole; ui['grp-ungroup'].disabled = !hasGroup; ui['grp-lock'].disabled = allLocked; ui['grp-unlock'].disabled = !locked;
    ui.dupAxisBtns.forEach((btn) => { const on = btn.dataset.axis === state.dupAxis; btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); });
    // the top bar: Group / Ungroup (several selected) and Lock / Unlock
    const gs = whole ? ['Ungroup', 'ungroup', 'Ungroup (Ctrl+Shift+G)'] : ['Group', 'group', 'Group the selected parts (Ctrl+G)'], ls = allLocked ? ['Unlock', 'unlock', 'Unlock'] : ['Lock', 'lock', 'Lock: it cannot be moved, turned, mirrored or deleted'];
    ui['bar-group'].hidden = !many; ui['bar-group'].replaceChildren(icon(ICONS[gs[1]], { size: 16, cap: 'round', join: 'round' }), h('span', { class: 't' }, gs[0])); ui['bar-group'].title = gs[2];
    ui['bar-lock'].replaceChildren(icon(ICONS[ls[1]], { size: 16, cap: 'round', join: 'round' }), h('span', { class: 't' }, ls[0])); ui['bar-lock'].title = ls[2];
  }
  ui.hintPill.hidden = !p;
  ui.hintPill.textContent = state.mode === 'rotate' ? 'Drag a corner arrow to turn · Shift = 15° steps · drag ◎ to move the pivot · Esc = done'
    : whole ? 'A group moves, turns and copies as one part · Ctrl+Shift+G ungroups'
    : many ? 'Rubber-band or Shift-click to select several parts · the number is the pick order'
    : 'Ctrl-drag = copy · Ctrl+Shift-drag = copy straight (along X or Y)';
  if (lay && state.ptab === 'objects') renderObjects();                    // a part picked on the sheet is lit in the tree
}

function update(refit = false) {
  const lay = curLay();
  layout = gridNow();
  for (let i = 0; i < 3 && pruneGaps(); i++) layout = gridNow();
  placedNow = lay ? LD.placedAll(lay, layout) : [];
  for (const p of placedNow) p.off = PL.offSheet(lay.parts[p.partId], p, lay.s.sheetW, lay.s.sheetH);       // off the sheet: drawn in orange
  if (selLooseMany) {
    const l = selLooseMany.map((i) => placedNow.findIndex((p) => p.src === 'loose' && p.i === i)).filter((k) => k >= 0);
    selLooseMany = null;
    if (l.length) { state.sel = l[l.length - 1]; picksArr = l.length > 1 ? l : []; }
  }
  clampSel();
  state.msg = null;
  ui.svg.setAttribute('aria-label', lay ? `Sheet ${state.sheetW} by ${state.sheetH} mm with ${placedNow.length} placed parts` : 'Sheet');
  renderStep(); renderPartsList(); renderCommand(); renderProps(); renderLayers(); drawSheet(); renderStatus(); renderEdit(); renderGaps(); renderGuidePanel(); renderCompare();
  if (refit) fit(); else paintOverlay();
}


// ---- the background: a picture (or a PDF page) under the drawing, dimmed, locked, never saved or exported ----
/** Puts a .png / .jpg under the drawing of the active tab (a tab of its own if there is none). It starts at 96 dpi; Set length or the size fields make it true size. */
async function importBackground(file) {
  const ext = ((file.name.match(/\.([^.]+)$/) || [])[1] || '').toLowerCase();
  if (ext === 'pdf') { await importBackgroundPdf(file.name, await file.arrayBuffer()); return; }
  if (!['png', 'jpg', 'jpeg'].includes(ext)) { note(file.name + ': a background must be a .png or .jpg'); return; }
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { note(file.name + ': could not read this picture'); return; }
  placeBackground(file.name, bitmap, 25.4 / 96, 'shown at 96 dpi. Set length makes it true size');
}
/** A PDF page (page 1, or the one asked for when there are more) as the background, at true size (a 150 dpi picture of it). */
async function importBackgroundPdf(name, bytes, newTab = false, path = null) {
  let page = 1;
  const keep = bytes.slice(0);                                      // pdf.js takes the buffer it is given: a copy stays for the other sheets
  try {
    const probe = await renderPdfPage(bytes.slice(0), { page: 1, dpi: 20 });
    if (probe.pages > 1) { const a = window.prompt(`${name} has ${probe.pages} pages. Which page?`, '1'); page = Math.min(probe.pages, Math.max(1, parseInt(a, 10) || 1)); }
    const r = await renderPdfPage(bytes, { page, dpi: 150 });
    placeBackground(name, await createImageBitmap(r.canvas), r.mmPerPx, `page ${page} of ${r.pages}, true size from the PDF`, newTab, { path, pdf: { name, bytes: keep, pages: r.pages, page, picture: true } });
  } catch (err) { note(name + ': could not draw this PDF (' + (err && err.message ? err.message : err) + ')'); }
}
function placeBackground(name, bitmap, mm, how, newTab = false, src = null) {
  let d = newTab ? null : curDoc();
  const bg = { name, bitmap, w: bitmap.width, h: bitmap.height, mm, x: 0, y: 0, visible: true };
  if (!d || !d.raw) {
    const raw = { header: {}, layers: {}, ltypes: {}, blocks: {}, entities: [] };
    d = { name, path: null, dirty: false, ...tabFields(raw, flatten(raw)) };
    d.bg = bg;
    addTab(d);
    balLoad(d, src && src.path, name);
  } else {
    if (d.box) { bg.x = d.box[0]; bg.y = d.box[1]; }
    d.bg = bg; d.scaleTarget = 'drawing'; d.dirty = true;
    showDoc();
  }
  if (src && src.pdf) d.pdf = src.pdf;
  note(`Background ${name}: ${bg.w} × ${bg.h} px, ${how}`);
}
function removeBackground() {
  const d = curDoc();
  if (!d || !d.bg) return;
  d.bg = null; d.scaleTarget = 'drawing';
  showDoc();
  note('Background removed');
}

// ---- extra gaps: click the gap between two rows or columns, type the extra mm (layout.js does the maths) ----
/** Invisible strips (10 px wide on screen, whatever the zoom) over each gap, and the picked gap's shading. */
function gapShapes(L) {
  const out = [];
  if (!L.count) return out;
  const sel = state.gapSel;
  for (const g of L.rowGaps) {
    const y = g.at + g.size / 2, on = sel && sel.axis === 'r' && sel.after === g.after;
    if (on) out.push(s('rect', { class: 'gap-sel', x: L.x0, y: g.at, width: L.gridW, height: g.size }));
    out.push(s('path', { class: 'gap-hit', 'data-gap': 'r' + g.after, d: `M${L.x0} ${y}h${L.gridW}` }));
  }
  for (const g of L.colGaps) {
    const x = g.at + g.size / 2, on = sel && sel.axis === 'c' && sel.after === g.after;
    if (on) out.push(s('rect', { class: 'gap-sel', x: g.at, y: L.y0, width: g.size, height: L.gridH }));
    out.push(s('path', { class: 'gap-hit', 'data-gap': 'c' + g.after, d: `M${x} ${L.y0}v${L.gridH}` }));
  }
  return out;
}
const gapList = (axis) => (axis === 'r' ? state.extraRows : state.extraCols);
const gapName = (axis, after) => 'After ' + (axis === 'r' ? 'row ' : 'column ') + after;

/** A click on a gap: it is shaded and its extra gets a field in the panel (rows from the top, columns from the left). */
function pickGap(key) {
  const axis = key[0], after = Number(key.slice(1)), list = gapList(axis);
  state.gapSel = { axis, after };
  if (!list.some((e) => e.after === after)) list.push({ after, mm: 0 });
  update();
  const inp = ui.gapList.querySelector(`[data-gap-field="${key}"]`);
  if (inp) { inp.focus(); inp.select(); }
}
/** Drops extra gaps that have no gap to sit in (beyond the last row / column), and empty ones nobody is editing. */
function pruneGaps() {
  let changed = false;
  for (const [axis, key, base] of [['r', 'extraRows', layout.baseRows], ['c', 'extraCols', layout.baseCols]]) {
    const keep = state[key].filter((e) => e.after >= 1 && e.after < base && (e.mm > 0 || (state.gapSel && state.gapSel.axis === axis && state.gapSel.after === e.after)));
    if (keep.length !== state[key].length) { state[key] = keep; changed = true; }
  }
  const g = state.gapSel;
  if (g && !gapList(g.axis).some((e) => e.after === g.after)) { state.gapSel = null; changed = true; }
  return changed;
}
let gapSig = '';
/** The list in the Step and repeat panel: one row per extra gap, rebuilt only when the set of gaps changes (so typing keeps its field). */
function renderGaps() {
  const items = [...state.extraRows.map((e) => ['r', e]), ...state.extraCols.map((e) => ['c', e])].sort((a, b) => (a[0] === b[0] ? a[1].after - b[1].after : a[0] < b[0] ? 1 : -1));
  const sig = items.map(([a, e]) => a + e.after).join();
  const mark = () => { for (const r of ui.gapList.children) r.classList.toggle('on', !!state.gapSel && r.dataset.gapRow === state.gapSel.axis + state.gapSel.after); };
  if (sig === gapSig) { mark(); return; }
  gapSig = sig;
  ui.gapList.replaceChildren(...items.map(([axis, e]) => {
    const key = axis + e.after;
    const inp = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', 'data-gap-field': key, 'aria-label': gapName(axis, e.after) + ', extra mm', placeholder: 'extra', value: e.mm > 0 ? String(e.mm) : '' });
    const bad = () => { const v = Number(inp.value.trim().replace(',', '.')); return inp.value.trim() !== '' && (!Number.isFinite(v) || v < 0); };
    inp.addEventListener('input', () => {
      const v = Number(inp.value.trim().replace(',', '.'));
      flagInvalid(inp, bad());
      if (inp.value.trim() === '' || !Number.isFinite(v) || v < 0) { if (inp.value.trim() === '') { pushLay(curDoc(), null, 'gap' + key, 'Extra gap'); e.mm = 0; update(); } return; }
      pushLay(curDoc(), null, 'gap' + key, 'Extra gap'); e.mm = v; update();
    });
    inp.addEventListener('change', () => {                          // refused: say so, mark it, and show the gap as it still is
      if (!bad()) return;
      note(`${gapName(axis, e.after)}: extra gap must be a number in mm, 0 or more`);
      inp.value = e.mm > 0 ? String(e.mm) : ''; flagInvalid(inp, true);
    });
    clearInvalid(inp);
    inp.addEventListener('focus', () => { if (!state.gapSel || state.gapSel.axis !== axis || state.gapSel.after !== e.after) { state.gapSel = { axis, after: e.after }; drawSheet(); } });
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') inp.blur(); });
    const x = h('button', { class: 'tog', type: 'button', 'aria-label': 'Remove ' + gapName(axis, e.after), 'data-gap-remove': key, onclick: () => {
      const list = gapList(axis), i = list.indexOf(e);
      if (i >= 0) { pushLay(curDoc(), null, '', 'Remove extra gap'); list.splice(i, 1); }
      if (state.gapSel && state.gapSel.axis === axis && state.gapSel.after === e.after) state.gapSel = null;
      update();
    } }, '×');
    return h('div', { class: 'gaprow', 'data-gap-row': key },
      h('span', { class: 'lbl' }, gapName(axis, e.after) + ': +'), inp, h('span', { class: 'lbl' }, 'mm'), x);
  }));
  mark();
}

// ---- editing the opened drawing: pick by chain, Keep only, Delete, size, Set length, undo (edit.js is the logic) ----
/** What the size fields and Set length act on: the drawing, or the background (always, when it is all the tab has). */
const sizeTarget = (d) => (d.bg && (!d.box || d.scaleTarget === 'bg') ? 'bg' : 'drawing');
const sizeBox = (d) => (sizeTarget(d) === 'bg' ? Ed.bgBox(d.bg) : partBox(d));
/**
 * The drawing's box in mm without its kept dimensions: the size of the part itself, which Width / Height and Set length
 * scale by (a dimension drawn outside the part must not change it). The drawing's own box when it has no dimension.
 * Worked out from what is drawn (every item says which entity it came from), kept until the drawing or its layers change.
 */
function partBox(d) {
  if (!d.box) return d.box;
  const key = [...d.off].join();
  if (!d.pb || d.pb.fl !== d.fl || d.pb.key !== key) {
    const space = spaceOf(d.fl);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, dims = false;
    for (const it of d.fl.items) {
      if (it.e == null || (it.ps ? 1 : 0) !== space || !itemVisible(it, d.off)) continue;
      if (d.raw.entities[it.e].layer === Ed.DIM_LAYER) { dims = true; continue; }
      x0 = Math.min(x0, it.b[0]); y0 = Math.min(y0, it.b[1]); x1 = Math.max(x1, it.b[2]); y1 = Math.max(y1, it.b[3]);
    }
    d.pb = { fl: d.fl, key, box: dims && x1 > x0 && y1 > y0 ? [x0 * d.factor, y0 * d.factor, x1 * d.factor, y1 * d.factor] : null };
  }
  return d.pb.box || d.box;
}
/** The tab being edited: a drawing tab (not a layout). */
const editable = () => { const d = curDoc(); return d && !d.lay && d.raw && d.fl && d.hist ? d : null; };
const drawBox = (fl) => fl.boxes[spaceOf(fl) ? 'paper' : 'model'];
const fmtSize = (v) => String(+Number(v).toFixed(2));
const snapshotOf = (d) => ({ entities: d.raw.entities, blocks: d.raw.blocks, layers: d.raw.layers, mm: d.bg ? d.bg.mm : null, pos: d.bg ? [d.bg.x, d.bg.y] : null, bl: d.balloons });
/** The edit index of a tab (pick grid, ends), built on first use and again after a change. */
function edIndex(d) { if (!d.ed) d.ed = Ed.makeIndex(d.raw, d.fl, d.off, hidIdx(d)); return d.ed; }
/** The entity under a point, unless its layer is locked (Objects tab): a locked layer is drawn and snapped to, but cannot be picked. -1 if none. */
function hitAt(d, p) { const e = Ed.hitEntity(edIndex(d), p[0], p[1], pickTol(d)); return e >= 0 && lockedEnt(d, e) ? -1 : e; }
const lockedEnt = (d, e) => !!d.locked && d.locked.size > 0 && d.locked.has(d.raw.entities[e].layer);
/** Builds the index once the page has painted, so the first click is quick. */
function warm(d) { requestAnimationFrame(() => setTimeout(() => { if (state.docs.includes(d) && d.fl && !d.ed) { edIndex(d); d.outl = null; if (curDoc() === d) renderEdit(); } }, 0)); }
function layersChanged(d) { d.ed = null; d.outl = null; d.sel = new Set(); d.hl = []; warm(d); renderEdit(); }

/** A pointer position → drawing units (y up), and the pick distance (7 px) in them. */
function toDrawing(d, cx, cy) {
  const r = ui.canvas.getBoundingClientRect();
  const mx = view.ox + (cx - r.left) / view.scale, my = view.oy + (cy - r.top) / view.scale;
  return [mx / d.factor, (state.sheetH - my) / d.factor];
}
const pickTol = (d) => 7 / (view.scale * d.factor);
/** The point to use for a click: snapped (with its kind) when SNAP is on and something is near, else the exact point. */
const snapPoint = (d, p) => { const sn = Ed.snapPick(edIndex(d), p[0], p[1], pickTol(d), state.snap); return sn ? [sn.x, sn.y, sn.kind] : [p[0], p[1]]; };
/** A Measure / Dimension / Leader pick: the snaps, then POLAR / OTRACK (where their guides show), else Shift / ORTHO straight from the first point. */
function pickPoint(d, p, pts, shift, hover = false) {
  const q = snapPoint(d, p), base = pts.length === 1 ? pts[0] : null, straight = !!((shift || state.ortho) && base);
  const tq = !d.lay && editable() === d ? trackPick(d, p, q, base, straight, hover) : null;
  return tq ? [tq[0], tq[1]] : straight ? Ed.orthoLock(base, q) : q;
}

function setSel(d, sel) {
  d.sel = sel;
  if (sel.size) state.balSel = null;
  const ed = edIndex(d);
  d.hl = [];
  for (const e of sel) for (const i of ed.byEnt[e] || []) d.hl.push(ed.items[i]);
  paintOverlay(); renderEdit();
  if (state.ptab === 'objects') renderObjects(true);
}

/** A click: the edge under it with everything joined to it end to end; Shift adds it or, if it is in already, takes it out. */
function clickSelect(d, p, shift) {
  const ed = edIndex(d), e = Ed.hitEntity(ed, p[0], p[1], pickTol(d));
  if (e >= 0 && lockedEnt(d, e)) { note(`Layer ${d.raw.entities[e].layer} is locked: unlock it in the Objects tab to pick this`); return; }
  if (e < 0) { if (!shift && d.sel.size) setSel(d, new Set()); return; }
  const chain = Ed.chainAt(ed, e, Ed.chainTol(drawBox(d.fl), d.factor)).filter((c) => !lockedEnt(d, c)), next = new Set(shift ? d.sel : []);
  if (shift && d.sel.has(e)) for (const c of chain) next.delete(c); else for (const c of chain) next.add(c);
  setSel(d, next);
  note(chain.length > 1 ? `${chain.length} entities joined end to end` + (shift ? '' : ' selected') : '1 entity selected');
}
/** A dragged box: what lies fully inside it. */
function boxSelect(d, a, b, add) {
  const inside = Ed.inBox(edIndex(d), [a[0], a[1], b[0], b[1]]).filter((e) => !lockedEnt(d, e)), next = new Set(add ? d.sel : []);
  for (const e of inside) next.add(e);
  setSel(d, next);
  note(inside.length + (inside.length === 1 ? ' entity' : ' entities') + ' inside the box');
}
function showRubber(drag, e) {
  const r = ui.canvas.getBoundingClientRect(), x0 = Math.min(drag.x, e.clientX) - r.left, y0 = Math.min(drag.y, e.clientY) - r.top;
  const st = ui.rubber.style;
  st.left = x0 + 'px'; st.top = y0 + 'px'; st.width = Math.abs(e.clientX - drag.x) + 'px'; st.height = Math.abs(e.clientY - drag.y) + 'px';
  ui.rubber.hidden = false;
}
function hideRubber() { if (ui.rubber) ui.rubber.hidden = true; }

/** A new state for the tab: kept for undo; the drawing is drawn again from it. */
function commit(d, next, label) { d.hist.push(snapshotOf(d), label); d.newLayer = null; restore(d, next); }
function restoreBg(d, st) {
  if (st.mm != null && d.bg) d.bg.mm = st.mm;
  if (st.pos && d.bg) [d.bg.x, d.bg.y] = st.pos;
}
function restore(d, st) {
  if (st.layers) d.raw.layers = st.layers;                      // the layer table is replaced, never edited, when a layer is added or changed by hand
  if ('bl' in st) d.balloons = st.bl;                           // a drawing edit does not carry balloons, an undo step does
  if (st.entities === d.raw.entities && st.blocks === d.raw.blocks) {       // only the balloons (or the background's size) changed: nothing to flatten again
    restoreBg(d, st);
    d.dirty = true; showDoc(); return;
  }
  d.raw.entities = st.entities; d.raw.blocks = st.blocks;
  restoreBg(d, st);
  const names = [...d.off].map((i) => d.fl.layers[i] && d.fl.layers[i].name), fl = flatten(d.raw);
  d.off = new Set(fl.layers.map((l, i) => (names.includes(l.name) ? i : -1)).filter((i) => i >= 0));      // layer numbers can shift: keep them by name
  Object.assign(d, { fl, counts: layerCounts(d.raw, fl), entities: entityCount(d.raw, fl), box: drawingBoxMm(fl, d.factor), dirty: true, ed: null, outl: null, sel: new Set(), hl: [] });
  showDoc();
  warm(d);
}
/** Does the selection hold anything but kept dimensions? (Keep only and Extract part need geometry.) */
const selHasPart = (d) => [...d.sel].some((e) => d.raw.entities[e].layer !== Ed.DIM_LAYER);
function keepSelection() {
  const d = editable();
  if (!d || !d.sel.size) return;
  if (!selHasPart(d)) { note('Keep only: a kept dimension is not part of a part. Delete it, or select the outline'); return; }
  const kept = d.sel.size, gone = d.raw.entities.length - kept;
  commit(d, Ed.keepOnly(d.raw, d.sel), `Keep only ${kept}`);
  note(`Kept ${kept}, removed ${gone}. Ctrl+Z brings them back`);
}
function deleteSelection() {
  if (balDelete()) return;
  const d = editable();
  if (!d || !d.sel.size) return;
  const n = d.sel.size;
  commit(d, Ed.removeEntities(d.raw, d.sel), `Delete ${n}`);
  note(`Deleted ${n}. Ctrl+Z brings them back`);
}
function undo(d) {
  if (state.draw && state.drawDoc === d && DR.toolUndoSeg(state.draw) === 'point') { state.msg = null; note('First point dropped'); renderCommand(); paintOverlay(); return; }   // a Line with only its first point: nothing made to undo
  const st = d.hist.undo(snapshotOf(d)); if (!st) { note('Nothing to undo'); return; } restore(d, st); note('Undone'); if (state.draw) { renderCommand(); paintOverlay(); } }
function redo(d) { const st = d.hist.redo(snapshotOf(d)); if (!st) { note('Nothing to redo'); return; } restore(d, st); note('Redone'); }

/** Scales the whole drawing by s about the bottom-left of its extents, so it stays where it is on the sheet. */
function scaleDrawing(d, s, label = 'Scale') {
  if (sizeTarget(d) === 'bg') {
    state.setlen = null; if (ui.realLen) ui.realLen.blur();
    d.hist.push(snapshotOf(d), `${label} background ×${s.toFixed(3)}`);
    d.bg = Ed.bgScaled(d.bg, s);
    if (view.fitted) fit(); else paintOverlay();
    renderEdit();
    const b = Ed.bgBox(d.bg);
    note(`Background scaled ×${+s.toPrecision(6)}: now ${fmtSize(b[2] - b[0])} × ${fmtSize(b[3] - b[1])} mm`);
    return;
  }
  const b = drawBox(d.fl), pb = partBox(d);
  if (!b || !pb) return;
  const r = Ed.scaleAbout(d.raw, s, pb[0] / d.factor, pb[1] / d.factor, spaceOf(d.fl));       // about the part's own bottom-left, not a dimension's
  commit(d, r, `${label} ×${s.toFixed(3)}`);
  const left = Object.entries(r.skipped).map(([t, n]) => t + ' ' + n).join(', '), nb = partBox(d);
  note(`Scaled ×${+s.toPrecision(6)}: now ${fmtSize(nb[2] - nb[0])} × ${fmtSize(nb[3] - nb[1])} mm` + (left ? ` (not scaled: ${left})` : ''));
}
/** ×25.4 / ÷25.4 (TODO 51): the whole chosen target, whatever is selected, about 0,0, widths too, one undo step; the unit header stays. */
function unitFix(fix) {
  const d = editable(), before = d && sizeBox(d);
  if (!d || !before) return;
  state.setlen = null; if (ui.realLen) ui.realLen.blur();
  const was = UF.unitFixSize(before, 1);
  if (sizeTarget(d) === 'bg') {
    d.hist.push(snapshotOf(d), `Unit fix ${fix.text} background`);
    d.bg = UF.bgUnitFixed(d.bg, fix.s);
    if (view.fitted) fit(); else paintOverlay();
    renderEdit();
    note(UF.unitFixLine(fix, was, UF.unitFixSize(Ed.bgBox(d.bg), 1)));
    return;
  }
  const r = Ed.scaleAbout(d.raw, fix.s, 0, 0, spaceOf(d.fl));
  commit(d, r, `Unit fix ${fix.text}`);
  const left = Object.entries(r.skipped).map(([t, n]) => t + ' ' + n).join(', ');
  note(UF.unitFixLine(fix, was, UF.unitFixSize(partBox(d), 1)) + (left ? ` (not scaled: ${left})` : ''));
}
function sizeTyped(input, axis) {
  input.blur();
  const d = editable();
  const b = d && sizeBox(d);
  if (!d || !b) return;
  const cur = axis === 'w' ? b[2] - b[0] : b[3] - b[1];
  const s = Ed.scaleFactor(Number(input.value.trim().replace(',', '.')), cur);
  if (s == null) { note('Type the size in mm: a number above 0'); renderEdit(); return; }
  if (Math.abs(s - 1) < 1e-9) { renderEdit(); return; }
  scaleDrawing(d, s);
}

// Set length: two points, then the real distance between them in mm
function startSetlen() {
  const d = editable(), sb = d && sizeBox(d);
  if (!d || !sb) return;
  if (state.setlen) { cancelSetlen(); return; }
  state.setlen = { pts: [], hover: null, measured: null };
  note('Set length: click the first point (it snaps to ends and centres)');
  renderEdit(); paintOverlay();
}
/** Measure: two clicks (snapping to ends and centres); a third starts again. */
function measurePoint(d, p, shift = false) {
  const M = state.meas;
  if (!M) return;
  if (M.pts.length >= 2) M.pts = [];
  M.pts.push(pickPoint(d, p, M.pts, shift)); M.hover = null;
  if (M.pts.length === 1) note('Measure: now the second point');
  else {
    M.result = Ed.measureTwo(M.pts[0], M.pts[1], d.factor);
    note(Ed.formatMeasure(M.result));
  }
  paintOverlay();
}
/** Keeps the measure on screen as a dimension on the layer "Dimensions" (line, arrowheads, the length in mm). */
function keepMeasure() {
  const d = editable(), M = state.meas;
  if (!d || !M || M.pts.length !== 2) return;
  const dim = Ed.makeDimension(M.pts[0], M.pts[1], d.factor, d.raw.blocks, state.dp, dimNew(d));
  if (!dim) return;
  commit(d, Ed.addDimension(d.raw, dim), 'Add dimension');
  note(`Dimension kept: ${dim.label} mm, on the layer ${Ed.DIM_LAYER}. Select it to delete it`);
}
/// Dimension: first point, second point, then the callout follows the mouse sideways and a third click places it (AutoCAD's way). Linear is the
// same with the pointer choosing a horizontal or a vertical line. Radius and diameter: pick a circle or an arc, then place it. Angle: pick two lines, then the arc.
const newDim = () => ({ pts: [], hover: null, cursor: null, obj: null, lines: [], force: null });
const dimBusy = (D) => D.pts.length > 0 || !!D.obj || D.lines.length > 0;
function dimClear(D) { D.pts = []; D.hover = null; D.obj = null; D.lines = []; D.force = null; }
/** What the command line asks for next. */
function dimPrompt() {
  const D = state.dim, type = state.dimType;
  if (!editable()) return 'Dimension: open a drawing tab first';
  if (!D) return null;
  if (type === 'aligned') return ['Dimension: first point (it snaps to ends and centres)', 'Dimension: second point', 'Dimension: move the line up or down and click to place it'][D.pts.length];
  if (type === 'linear') return ['Specify first extension line origin:', 'Specify second extension line origin:', 'Specify dimension line location [Horizontal/Vertical]:'][D.pts.length];
  if (type === 'angle') return ['Select first line:', 'Select second line:', 'Specify dimension arc location:'][D.lines.length];
  return D.obj ? 'Specify dimension line location:' : 'Select arc or circle:';
}
/** The look a new dimension gets: the current dimension style, { textH, arrow, gap, pos, units } in drawing units. */
const dimNew = (d) => DM.lookOf(curDimStyle(), d.factor);
/** The dimension as it is with the pointer at `at` (drawing units): { kind, params } for Ed.dimGeom, or null while there is not enough picked. */
function dimDraft(at) {
  const D = state.dim, type = state.dimType;
  if (!D) return null;
  if (type === 'aligned' || type === 'linear') {
    if (D.pts.length === 1 && D.hover) return { kind: 'aligned', params: { a: D.pts[0], b: D.hover, offset: 0 } };
    if (D.pts.length !== 2 || !at) return null;
    const [a, b] = D.pts;
    if (type === 'aligned') return { kind: 'aligned', params: { a, b, offset: Ed.dimOffsetAt(a, b, at) } };
    const axis = D.force || Ed.linearAxis(a, b, at);
    return { kind: 'linear', params: { a, b, axis, offset: Ed.dimOffsetAt(a, b, at, axis) } };
  }
  if (type === 'angle') { const m = D.lines.length === 2 && at && Ed.angleBetween(D.lines[0], D.lines[1], at); return m ? { kind: 'angle', params: m } : null; }
  if (!D.obj || !at) return null;
  if (type === 'radius') return { kind: 'radius', params: { c: D.obj.c, r: D.obj.r, p: at } };
  const ends = Ed.diameterEnds(D.obj.c, D.obj.r, at);
  return ends && { kind: 'diameter', params: { ...ends, offset: 0 } };
}
/** The dimension being placed or moved as a drawing (edit.js dimGeom), or null. */
function previewDim(d) {
  if (!d || !editable()) return null;
  if (state.ldr) return ldrPreview(d);
  const G = state.dimDrag;
  if (G && G.moved) return Ed.dimGeom(G.kind, { ...G.params, offset: G.offset }, d.factor, G.dp);
  const m = dimDraft(state.dim && state.dim.cursor);
  return m ? Ed.dimGeom(m.kind, { ...m.params, ...dimNew(d) }, d.factor, state.dp) : null;
}
function dimHover(d, p, shift) {
  const D = state.dim;
  D.cursor = p;
  if (D.pts.length < 2 && (state.dimType === 'aligned' || state.dimType === 'linear')) D.hover = pickPoint(d, p, D.pts, shift, true);
  paintOverlay();
}
/** Puts the dimension m ({ kind, params }) in the drawing (one undo step) and starts the next. */
function dimPlace(d, m) {
  if (!m) { note(state.dimType === 'angle' ? 'Dimension: no angle there, try another place' : 'Dimension: nothing to measure there, try another place'); return; }
  const dim = Ed.buildDim(m.kind, { ...m.params, ...dimNew(d) }, d.factor, Ed.freeName(d.raw.blocks, m.kind === 'linear' ? 'aligned' : m.kind), state.dp);
  if (!dim) { note('Dimension: nothing to measure there, try another place'); return; }
  dimClear(state.dim);
  commit(d, Ed.addDimension(d.raw, dim), 'Add dimension');                                // (showDoc inside starts the next one)
  note(`Dimension placed: ${dim.label}${m.kind === 'angle' || dim.label.endsWith('"') ? '' : ' mm'}, on the layer ${Ed.DIM_LAYER}. Select it to move it or resize its text`);
}
function dimensionPoint(d, p, shift = false) {
  const D = state.dim, type = state.dimType;
  if (!D || !editable()) return;
  if (type === 'radius' || type === 'diameter' || type === 'angle') {
    if (D.obj || D.lines.length === 2) { dimPlace(d, dimDraft(p)); return; }
    const ent = d.raw.entities[Ed.hitEntity(edIndex(d), p[0], p[1], pickTol(d))];
    if (type === 'angle') {
      const l = Ed.lineOf(ent);
      if (!l) { note('Select a line: click on one'); return; }
      if (D.lines.length && Ed.angleBetween(D.lines[0], l, [0, 0]) == null) { note('Those lines are parallel, there is no angle. Select another line'); return; }
      D.lines.push(l);
    } else {
      D.obj = Ed.circleOf(ent);
      if (!D.obj) { note('Select an arc or a circle: click on one'); return; }
    }
    D.cursor = p; note(dimPrompt()); paintOverlay();
    return;
  }
  if (D.pts.length === 2) { dimPlace(d, dimDraft(p)); return; }
  const q = pickPoint(d, p, D.pts, shift);
  if (D.pts.length === 1 && Math.hypot(q[0] - D.pts[0][0], q[1] - D.pts[0][1]) < 1e-9) { note('Dimension: that is the first point again, pick another'); return; }
  D.pts.push(q); D.hover = null; D.cursor = p;
  note(dimPrompt());
  paintOverlay();
}
/** The selected dimension, if exactly one thing is selected and it is a kept dimension: { e, name, kind, params, dp }. */
function dimSel(d) {
  if (d.sel.size !== 1) return null;
  const e = [...d.sel][0], o = Ed.dimOfEntity(d.raw, e);
  return o && { e, ...o };
}
/** A press on the one selected aligned or linear dimension starts moving it (otherwise null: the press selects or draws a box). */
function dimGrab(d, p) {
  const sd = dimSel(d);
  if (!sd || (sd.kind !== 'aligned' && sd.kind !== 'linear') || Ed.hitEntity(edIndex(d), p[0], p[1], pickTol(d)) !== sd.e) return null;
  return { ...sd, start: p, offset: sd.params.offset, moved: false, cancelled: false };
}
function dimDragTo(d, g, p) {
  const a = g.params.a, b = g.params.b, ax = g.params.axis;
  g.offset = g.params.offset + Ed.dimOffsetAt(a, b, p, ax) - Ed.dimOffsetAt(a, b, g.start, ax);
  g.moved = true; state.dimDrag = g;
  paintOverlay();
}
function dimDragEnd(d, g) {
  state.dimDrag = null;
  if (g.cancelled || Math.abs(g.offset - g.params.offset) * d.factor < 0.001) { paintOverlay(); return; }
  commit(d, Ed.replaceDimension(d.raw, Ed.buildDim(g.kind, { ...g.params, offset: g.offset }, d.factor, g.name, g.dp)), 'Move dimension');
  setSel(d, new Set([g.e]));
  note(`Dimension moved: its line is ${fmtSize(Math.abs(g.offset) * d.factor)} mm from the points. Ctrl+Z undoes it`);
}
/** The text height typed in the right panel: the selected dimension is rebuilt (arrowheads and extension lines follow). */
function dimHeightTyped() {
  ui.dimH.blur();
  const d = editable(), sd = d && dimSel(d);
  if (!sd) return;
  const mm = Number(ui.dimH.value.trim().replace(',', '.'));
  if (!(mm > 0) || !Number.isFinite(mm) || mm > 1e4) { note('Type the text height in mm: a number above 0'); renderEdit(); return; }
  const textH = mm / d.factor;
  if (Math.abs(textH - sd.params.textH) < 1e-9 * textH) { renderEdit(); return; }
  commit(d, Ed.replaceDimension(d.raw, Ed.buildDim(sd.kind, DM.withHeight(sd.params, textH), d.factor, sd.name, sd.dp)), 'Dimension text height');
  setSel(d, new Set([sd.e]));
  note(`Dimension text height ${fmtSize(mm)} mm. Ctrl+Z undoes it`);
}
/** Reset next to the text height: the selected dimension gets the dimension style's text height again. */
function dimHeightReset() {
  const d = editable(), sd = d && dimSel(d);
  if (!sd) return;
  const p = DM.withHeight(sd.params, dimNew(d).textH), textH = p.textH;
  if (sd.params.textH != null && Math.abs(textH - sd.params.textH) < 1e-9 * textH) { note(`Dimension text height is already the style's, ${fmtSize(textH * d.factor)} mm`); return; }
  commit(d, Ed.replaceDimension(d.raw, Ed.buildDim(sd.kind, p, d.factor, sd.name, sd.dp)), 'Dimension text height');
  setSel(d, new Set([sd.e]));
  note(`Dimension text height back to the style's, ${fmtSize(textH * d.factor)} mm. Ctrl+Z undoes it`);
}
// ---- Format → Dimension style… (dims.js; mock-up R8b, Option A): arrow size, text height, decimals, gap, units, text position, as presets ----
const DS_SAVED = 'pd-dimstyles';
function loadDimStyles() { try { return DM.loadPresets(JSON.parse(localStorage.getItem(DS_SAVED) || 'null')); } catch { return DM.loadPresets(null); } }
const saveDimStyles = () => { try { localStorage.setItem(DS_SAVED, JSON.stringify(state.dimStyles)); } catch { /* storage may be blocked */ } };
/** The style new dimensions get (see dims.js). */
const curDimStyle = () => state.dimStyles.presets[state.dimStyles.cur];
const fix2 = (v) => Number(v).toFixed(2);

/** The selected dimensions rebuilt in the current style (one undo step); how many. */
function applyDimStyleToSelected() {
  const d = editable();
  if (!d) return 0;
  const look = dimNew(d), blocks = { ...d.raw.blocks };
  let k = 0;
  for (const e of d.sel) {
    const o = Ed.dimOfEntity(d.raw, e), nd = o && Ed.buildDim(o.kind, { ...o.params, ...look }, d.factor, o.name, state.dp), lo = !o && LR.ofEntity(d.raw, e);
    if (nd) { blocks[o.name] = nd.block; k++; }
    else if (lo) { const nl = LR.replace(d.raw, lo.name, { ...lo.model, textH: look.textH, arrow: look.arrow }); if (nl) { blocks[lo.name] = nl.blocks[lo.name]; k++; } }       // a leader takes the text height and the arrow size
  }
  if (k) { const sel = new Set(d.sel); commit(d, { entities: d.raw.entities, blocks }, 'Dimension style'); setSel(d, sel); }
  return k;
}
/** The dialog's live preview: a 60 mm dimension under a 60 × 15 mm plate drawn in the style, on a 260 × 150 box (3.33 px per mm). */
function dsPreview(style) {
  const sc = 200 / 60, P = (x, y) => [30 + x * sc, 80 - y * sc], g = Ed.dimGeom('aligned', { a: [0, 0], b: [60, 0], offset: -12, ...DM.lookOf(style, 1) }, 1, style.dp);
  const pt = (q) => P(q[0], q[1]).map((v) => +v.toFixed(2)).join(' '), t = g.text, tp = P(t.x, t.y), e = g.ext[1], y0 = P(0, 0)[1], y1 = P(e[0], e[1])[1];
  return [
    s('rect', { class: 'ds-part', x: 30, y: 30, width: 200, height: 50 }),
    s('path', { class: 'ds-dim', d: g.lines.map((l) => `M${pt(l.slice(0, 2))}L${pt(l.slice(2))}`).join('') }),
    s('path', { class: 'ds-arrow', d: g.arrows.map((tri) => 'M' + tri.map(pt).join('L') + 'Z').join('') }),
    s('text', { class: 'ds-text', x: tp[0], y: tp[1], 'text-anchor': 'middle', 'font-size': +(t.h * sc / 0.7).toFixed(2), 'dominant-baseline': t.va === 2 ? 'central' : null }, t.label),
    s('path', { class: 'ds-mark', d: `M236 ${y0}h5M236 ${y1}h5M238.5 ${y0}V${y1}` }),
    s('text', { class: 'ds-note', x: 243, y: 86 }, 'gap'), s('text', { class: 'ds-note', x: 14, y: 142 }, 'arrow size')];
}
function showDimStyle() {
  hideMenu();
  const S = state.dimStyles;
  let name = S.cur, units = 'mm', pos = 'above', shown = S.presets[name];
  const field = (tid, label) => h('input', { class: 'fld', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'aria-label': label, 'data-testid': tid });
  const iArrow = field('ds-arrow', 'Arrow size (mm)'), iText = field('ds-text', 'Text height (mm)'), iGap = field('ds-gap', 'Gap (mm)');
  const iDp = h('select', { class: 'fld', 'aria-label': 'Decimals', 'data-testid': 'ds-dp' }, [0, 1, 2, 3, 4].map((n) => h('option', { value: String(n) }, n ? '0.' + '0'.repeat(n) : '0')));
  const sel = h('select', { class: 'fld', 'aria-label': 'Preset', 'data-testid': 'ds-preset', style: 'flex:1' });
  const saveBtn = h('button', { class: 'btn', type: 'button', 'data-testid': 'ds-save' }, 'Save as preset…');
  const delBtn = h('button', { class: 'btn', type: 'button', 'data-testid': 'ds-delete', title: 'Standard cannot be deleted' }, 'Delete');
  const err = h('span', { class: 'lbl warn', 'data-testid': 'ds-error' }), cap = h('span', { class: 'lbl mono', 'data-testid': 'ds-caption' });
  const svg = s('svg', { class: 'ds-prev', viewBox: '0 0 260 150', role: 'img', 'aria-label': 'Live preview of a dimension in the chosen style, with the gap and the arrow size marked', 'data-testid': 'ds-preview' });
  const segs = (tid, label, items, get, set) => {
    const bs = items.map(([v, text]) => h('button', { class: 'seg', type: 'button', 'data-testid': `${tid}-${v}`, onclick: () => { set(v); paint(); } }, text));
    return { box: h('div', { class: 'mode', role: 'group', 'aria-label': label }, bs), sync: () => bs.forEach((b, i) => { b.classList.toggle('on', items[i][0] === get()); b.setAttribute('aria-pressed', String(items[i][0] === get())); }) };
  };
  const uSeg = segs('ds-units', 'Units', [['mm', 'mm'], ['inch', 'inch']], () => units, (v) => { units = v; });
  const pSeg = segs('ds-pos', 'Text position', [['above', 'Above'], ['centre', 'Centred']], () => pos, (v) => { pos = v; });
  const load = (st) => { iArrow.value = fix2(st.arrow); iText.value = fix2(st.textH); iGap.value = fix2(st.gap); iDp.value = String(st.dp); units = st.units; pos = st.pos; };
  const read = () => DM.checkStyle({ arrow: iArrow.value, textH: iText.value, gap: iGap.value, dp: iDp.value, units, pos });
  const paint = () => {
    const r = read();
    err.textContent = r.error || '';
    if (r.style) shown = r.style;                                              // a half-typed number keeps the last good picture
    svg.replaceChildren(...dsPreview(shown));
    cap.textContent = `arrow ${fix2(shown.arrow)} · text ${fix2(shown.textH)} · gap ${fix2(shown.gap)} mm`;
    uSeg.sync(); pSeg.sync(); delBtn.disabled = name === 'Standard';
  };
  const fill = () => { sel.replaceChildren(...Object.keys(S.presets).map((n) => h('option', { value: n }, n))); sel.value = name; };
  const finish = () => { back.remove(); document.removeEventListener('keydown', onKey, true); state.dsOpen = false; renderCommand(); };
  const ok = () => {
    const r = read();
    if (r.error) { err.textContent = r.error; return; }
    S.presets[name] = r.style; S.cur = name; saveDimStyles(); finish();
    const d = editable(), keep = d && new Set(d.sel), k = applyDimStyleToSelected();
    if (r.style.dp !== state.dp) { setDecimals(r.style.dp); if (keep && keep.size) setSel(d, keep); }       // (Decimals re-labels every dimension, and clears the selection)
    note(`Dimension style ${name}` + (k ? `: ${k} selected dimension${k === 1 ? '' : 's'} restyled. Ctrl+Z takes it back` : '. New dimensions use it'));
  };
  sel.addEventListener('change', () => { name = sel.value; load(S.presets[name]); paint(); });
  for (const i of [iArrow, iText, iGap]) { i.addEventListener('input', paint); i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }); }
  iDp.addEventListener('change', paint);
  saveBtn.addEventListener('click', async () => {
    const r = read();
    if (r.error) { err.textContent = r.error; return; }
    const nm = await askName({ title: 'Save as preset', label: 'Preset name', value: '', ok: 'Save', validate: (v) => (v.length > 40 ? 'At most 40 characters' : Object.hasOwn(S.presets, v) ? 'A preset with this name already exists' : '') });
    if (!nm) return;
    S.presets[nm] = r.style; name = nm; saveDimStyles(); fill(); paint();
  });
  delBtn.addEventListener('click', () => {
    if (name === 'Standard') return;
    delete S.presets[name]; if (S.cur === name) S.cur = 'Standard';
    name = 'Standard'; saveDimStyles(); fill(); load(S.presets[name]); paint();
  });
  const close = h('button', { class: 'btn', type: 'button', 'aria-label': 'Close', 'data-testid': 'ds-close', onclick: finish }, '×');
  const lab = (text, input) => h('label', { class: 'field' }, text, input);
  const dlg = h('div', { class: 'pop-dialog ds', role: 'dialog', 'aria-label': 'Dimension style', 'data-testid': 'dimstyle-dialog' },
    h('div', { class: 'ds-head' }, h('span', null, h('strong', null, 'Dimension style'), h('span', { class: 'lbl' }, 'Format → Dimension style…')), close),
    h('div', { class: 'ds-body' },
      h('div', { class: 'ds-form' }, h('div', { class: 'field' }, 'Preset', h('div', { class: 'row' }, sel, saveBtn, delBtn)),
        h('div', { class: 'ds-grid' }, lab('Arrow size (mm)', iArrow), lab('Text height (mm)', iText), lab('Decimals', iDp), lab('Gap (mm)', iGap),
          h('div', { class: 'field' }, 'Units', uSeg.box), h('div', { class: 'field' }, 'Text position', pSeg.box)), err),
      h('div', { class: 'ds-side' }, h('span', { class: 'ds-t' }, 'Live preview'), svg, cap, h('span', { class: 'lbl' }, 'Redraws as you type.'))),
    h('div', { class: 'ds-foot' }, h('span', { class: 'lbl' }, 'OK applies to new dimensions and to any selected.'),
      h('button', { class: 'btn', type: 'button', 'data-testid': 'ds-cancel', onclick: finish }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', 'data-testid': 'ds-ok', onclick: ok }, 'OK')));
  const back = h('div', { class: 'pop-back', 'data-testid': 'ds-back' }, dlg);
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[data-testid=name-dialog]')) { e.preventDefault(); e.stopPropagation(); finish(); } };
  back.addEventListener('pointerdown', (e) => { if (e.target === back) finish(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  state.dsOpen = true; renderCommand();
  fill(); load(S.presets[name]); paint();
  iArrow.focus(); iArrow.select();
}
// ---- Inspection balloons (TODO 29, balloons.js; mock-ups R9a and R9c Option B): numbered circles with a leader, a docked table, a sidecar file ----
// A balloon is not in the DXF. d.balloons (an immutable set) is undone with the drawing's own history and saved in <name>.pdballoons.json next to the
// file (a PDF is never rewritten). Coordinates are mm on the sheet, y up. A multi-page PDF is one tab; its page is the balloon's sheet (d.pdf).
/** The circle's radius in mm: 3.5, or 1.6 % of the page's longest side on a big one (an A1 scan), so it reads at the same size on any page. */
function balR(d) {
  const bs = [d.bg ? Ed.bgBox(d.bg) : null, d.box].filter(Boolean);
  return Math.max(3.5, 0.016 * Math.max(0, ...bs.map((b) => Math.max(b[2] - b[0], b[3] - b[1]))));
}
const BAL_LABEL = { n: 'number', dim: 'dimension', tp: 'tolerance +', tm: 'tolerance -', note: 'note' };
const balOf = (d) => d.balloons || BAL.EMPTY;
const sheetOf = (d) => (d.pdf ? d.pdf.page : 1);
const balItem = (d, id) => balOf(d).items.find((it) => it.id === id) || null;
const balSelItem = (d) => (d && state.balSel != null ? balItem(d, state.balSel) : null);
const balPrompt = () => (!editable() ? 'Balloon: open a drawing tab first (a PDF or a picture too)' : state.bal && state.bal.tip ? 'Click where the balloon sits:' : 'Click the feature to balloon:');
/** The drawing's TEXT and MTEXT as text.js models (drawing units); null for a picture or a drawing with no text. Remembered until the entities change. */
function balTexts(d) {
  if (!d.txtMemo || d.txtMemo.ents !== d.raw.entities) d.txtMemo = { ents: d.raw.entities, list: d.raw.entities.map(TX.decode).filter(Boolean) };
  return d.txtMemo.list;
}

/** A balloon change as ONE labelled undo step (the set is immutable, so the history keeps the old one); sel: the balloon selected afterwards. */
function balApply(d, set, label, sel = state.balSel) {
  d.hist.push(snapshotOf(d), label);
  d.balloons = set; d.dirty = true; state.balSel = sel;
  renderTabs(); renderEdit(); renderCommand(); paintOverlay();
}
function balSelect(d, id) {
  state.balSel = id;
  if (id != null && d.sel.size) { setSel(d, new Set()); return; }          // a balloon and a drawing selection are not picked together
  renderEdit(); paintOverlay();
}

// -- the Balloon tool: click the feature (the arrow's tip), click where the circle sits --
function balHover(d, p, shift) {
  const B = state.bal, f = d.factor;
  if (!B) return;
  const q = B.tip ? (shift || state.ortho ? Ed.orthoLock([B.tip[0] / f, B.tip[1] / f], p) : p) : snapPoint(d, p);
  B.hover = [q[0] * f, q[1] * f]; paintOverlay();
}
function balClick(d, p, shift) {
  const B = state.bal, f = d.factor;
  if (!B) return;
  const q = B.tip ? (shift || state.ortho ? Ed.orthoLock([B.tip[0] / f, B.tip[1] / f], p) : p) : snapPoint(d, p), mm = [q[0] * f, q[1] * f];
  if (!B.tip) { B.tip = mm; B.hover = null; state.msg = balPrompt(); renderCommand(); paintOverlay(); return; }
  const set = BAL.add(balOf(d), { tip: B.tip, c: mm, sheet: sheetOf(d) }), it = set.items[set.items.length - 1];
  B.tip = null; B.hover = null;
  balApply(d, set, `Add balloon ${it.n}`, it.id);
  note(`Balloon ${it.n} placed (sheet ${it.sheet}). ${balPrompt()}`);
}

// -- a selected balloon: grips at the circle's centre (moves the circle) and the tip (moves the arrow); a click on one selects it --
function balDown(e) {
  const d = editable();
  if (!d || state.tool !== 'select' || state.setlen || state.match) return false;
  const p = sheetAt(e.clientX, e.clientY), tol = 7 / view.scale, sheet = sheetOf(d), sel = balSelItem(d);
  let it = sel && sel.sheet === sheet ? sel : null, which = it ? BAL.gripAt(it, p, tol * 1.3) : null;
  if (!which) {
    it = [...balOf(d).items].reverse().find((x) => x.sheet === sheet && BAL.bodyAt(x, p, balR(d), tol)) || null;
    if (!it) { if (state.balSel != null && !e.shiftKey) balSelect(d, null); return false; }
    balSelect(d, it.id);
    return true;
  }
  state.balDrag = { id: it.id, which, set: null, moved: false, x: e.clientX, y: e.clientY };
  return true;
}
function balMove(e) {
  const g = state.balDrag, d = editable();
  if (!g || !d) return;
  if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 4) return;
  g.moved = true;
  const p = sheetAt(e.clientX, e.clientY), f = d.factor;
  let q = p;
  if (g.which === 'tip') { const sn = snapPoint(d, [p[0] / f, p[1] / f]); q = [sn[0] * f, sn[1] * f]; }           // the arrow's tip snaps to the drawing
  g.set = BAL.update(balOf(d), g.id, g.which === 'tip' ? { tip: q } : { c: q });
  paintOverlay();
}
function balUp() {
  const g = state.balDrag, d = editable();
  state.balDrag = null;
  if (!g || !d) return;
  if (g.moved && g.set) balApply(d, g.set, g.which === 'tip' ? 'Move balloon arrow' : 'Move balloon', g.id);
  else paintOverlay();
}
function balDelete() {
  const d = editable(), it = balSelItem(d);
  if (!d || !it) return false;
  balApply(d, BAL.remove(balOf(d), it.id), `Delete balloon ${it.n}`, null);
  note(`Balloon ${it.n} deleted; the others keep their numbers. Ctrl+Z takes it back`);
  return true;
}

/** The balloons of the shown sheet, drawn in the overlay (the one being dragged as it will be), and the Balloon tool's ghost. */
function balOvl(d, out, k) {
  const H = state.sheetH, set = state.balDrag && state.balDrag.set ? state.balDrag.set : balOf(d), sheet = sheetOf(d), on = state.tool === 'select', R = balR(d);
  const P = (p) => `${p[0]} ${H - p[1]}`;
  const shape = (it, cls, extra) => {
    const gm = BAL.geometry(it, R), txt = String(it.n), fs = R * (txt.length > 2 ? 0.85 : txt.length > 1 ? 1.05 : 1.25);
    return s('g', { class: 'bal' + cls, 'data-bal': it.id, 'data-n': it.n, 'data-testid': extra ? 'balloon-ghost' : 'balloon' },
      gm.line ? s('path', { class: 'bal-line', d: `M${P([gm.line[0], gm.line[1]])}L${P([gm.line[2], gm.line[3]])}` }) : null,
      gm.arrow ? s('path', { class: 'bal-arrow', d: `M${gm.arrow.map(P).join('L')}z` }) : null,
      s('circle', { class: 'bal-c', cx: it.c[0], cy: H - it.c[1], r: R }),
      s('text', { class: 'bal-n', x: it.c[0], y: H - it.c[1] + fs * 0.35, 'font-size': fs, 'text-anchor': 'middle' }, txt));
  };
  for (const it of set.items) if (it.sheet === sheet) out.push(shape(it, it.id === state.balSel ? ' on' : '', false));
  const sel = set.items.find((it) => it.id === state.balSel && it.sheet === sheet);
  if (sel && on) for (const [which, p] of [['c', sel.c], ['tip', sel.tip]]) { const z = 10 * k; out.push(s('rect', { class: 'gr', x: p[0] - z / 2, y: H - p[1] - z / 2, width: z, height: z, 'data-bal-grip': which, 'data-testid': 'bal-grip' })); }
  const B = state.bal;
  if (B && B.hover) {
    const cross = B.tip ? null : s('path', { class: 'bal-cross', d: `M${B.hover[0] - 8 * k} ${H - B.hover[1]}h${16 * k}M${B.hover[0]} ${H - B.hover[1] - 8 * k}v${16 * k}` });
    if (B.tip) out.push(shape({ n: set.next, tip: B.tip, c: B.hover }, ' ghost', true));
    else out.push(cross);
    return { text: B.tip ? `Balloon ${set.next} · place` : `Balloon ${set.next} · tip`, x: B.hover[0], y: B.hover[1] };
  }
  return null;
}

// -- the fields: the Balloon section of the right panel, typed; Pick from text; the count; Renumber --
function balFieldTyped(key) {
  const d = editable(), it = balSelItem(d), input = ui['bal_' + key];
  if (!it) return;
  const raw = input.value.trim();
  if (key === 'n') {
    const n = BAL.parseNo(raw);
    if (n == null) { note('Balloon number: a whole number from 1'); renderBalloons(); return; }
    if (n === it.n) return;
    balApply(d, BAL.update(balOf(d), it.id, { n }), `Balloon ${it.n}: number ${n}`);
    note(balOf(d).items.some((x) => x.id !== it.id && x.n === n) ? `Number ${n} is on two balloons now: Renumber puts them in order` : `Balloon is now number ${n}. Ctrl+Z takes it back`);
    return;
  }
  if (raw === it[key]) return;
  balApply(d, BAL.update(balOf(d), it.id, { [key]: raw.slice(0, 200) }), `Balloon ${it.n}: ${BAL_LABEL[key]}`);
  note(`Balloon ${it.n}: ${BAL_LABEL[key]} changed. Ctrl+Z takes it back`);
}
/** Pick from text: the dimension is the text of the PDF under the arrow's tip (vector pages only). */
function balPick() {
  const d = editable(), it = balSelItem(d);
  if (!it) return;
  const texts = balTexts(d);
  if (!texts.length) { note('Pick from text: this page has no text (it is a picture), so type the dimension'); return; }
  const f = d.factor, hit = BAL.nearestText(texts, [it.tip[0] / f, it.tip[1] / f], 3 / f);
  if (!hit) { note('Pick from text: no text under the arrow. Move the arrow tip onto the dimension'); return; }
  balApply(d, BAL.update(balOf(d), it.id, { dim: hit.str }), `Balloon ${it.n}: dimension from text`);
  note(`Balloon ${it.n}: dimension "${hit.str}" taken from the text under the arrow. Ctrl+Z takes it back`);
}
/** The count carries on from n (typed in the Numbering field or at the command line). */
function balNextTyped(text) {
  const d = editable(), set = d && BAL.setNext(balOf(d), text);
  if (!d) return;
  if (!set) { note('Next number: a whole number from 1'); renderBalloons(); return; }
  if (set.next !== balOf(d).next) balApply(d, set, `Next balloon number ${set.next}`);
  note(`The next balloon is number ${set.next}`);
}
function balRenumber() {
  const d = editable(), set = d && balOf(d);
  if (!set || !set.items.length) return;
  balApply(d, BAL.renumber(set), 'Renumber balloons');
  note(`Renumbered 1 to ${set.items.length} (sheet by sheet, in the order placed); the next is ${set.items.length + 1}. Ctrl+Z takes it back`);
}

// -- the table: a row zooms to its balloon (on its sheet); a selected balloon lights its row --
async function balRow(id) {
  const d = editable(), it = d && balItem(d, id);
  if (!it) return;
  if (it.sheet !== sheetOf(d) && !(await balSheet(d, it.sheet))) return;
  balSelect(d, it.id);
  const x = [it.c[0], it.tip[0]], y = [it.c[1], it.tip[1]];
  const R = balR(d);
  zoomToBox([Math.min(...x) - R, Math.min(...y) - R, Math.max(...x) + R, Math.max(...y) + R], Math.max(20, 3 * R));
  note(`Balloon ${it.n}` + (it.dim ? ': ' + it.dim : ''));
}
/** The table's file: Export CSV, and Export Excel (the same rows, as a UTF-8 CSV with a byte order mark: Excel opens it with Ø and ± right). */
async function balExport(excel) {
  const d = editable(), rows = d ? BAL.rows(balOf(d), state.balDock.sheet === 'all' ? null : +state.balDock.sheet) : [];
  if (!rows.length) { note('Export: no balloons in the list'); return; }
  // shortcut: Excel gets a CSV with a BOM, not a real .xlsx (no xlsx writer in the app); upgrade when he needs formatting or several sheets in one file
  const name = baseName(d.balName || d.name) + '-balloons' + (excel ? '-excel' : '') + '.csv', text = BAL.csv(rows, { bom: excel });
  const t = window.__TAURI__;
  try {
    if (t && t.dialog && t.dialog.save && t.fs && t.fs.writeTextFile) {
      const picked = await t.dialog.save({ defaultPath: name, filters: [{ name: 'CSV table', extensions: ['csv'] }] });
      const path = picked && await withExt(t, picked, 'csv');
      if (!path) return;
      await t.fs.writeTextFile(path, text);
      note(`Saved ${rows.length} balloons to ${path}`);
    } else { download(name, text); note(`Saved ${name} (${rows.length} balloons) to the Downloads folder`); }
  } catch (err) { note('Export failed: ' + (err && err.message ? err.message : err)); }
}

// -- sheets: a multi-page PDF is one tab showing one page; the switcher reads another page in (the balloons of every sheet stay in the tab) --
async function balSheet(d, n) {
  const P = d.pdf;
  if (!P || n === P.page || n < 1 || n > P.pages) return false;
  if (!P.picture && (d.raw.entities !== P.orig || d.raw.blocks !== P.origBlocks) && !(await confirmAsk(`Go to sheet ${n}? The edits made to this sheet's drawing are dropped (the balloons stay).`, 'Go to sheet ' + n))) return false;
  try {
    if (P.picture) {
      const r = await renderPdfPage(P.bytes.slice(0), { page: n, dpi: 150 }), bm = await createImageBitmap(r.canvas);
      d.bg = { ...d.bg, bitmap: bm, w: bm.width, h: bm.height, mm: r.mmPerPx, x: 0, y: 0 };
      d.hist = Ed.createHistory();
    } else {
      const r = await readPdf(new Uint8Array(P.bytes.slice(0)), { page: n });
      Object.assign(d, tabFields(r.doc, flatten(r.doc)));
      d.hist = Ed.createHistory(); d.sel = new Set(); d.hl = []; d.ed = null; P.orig = r.doc.entities; P.origBlocks = r.doc.blocks; warm(d);
    }
  } catch (err) { note(`Sheet ${n}: could not read this page (${err && err.message ? err.message : err})`); return false; }
  P.page = n; state.balSel = null; view.fitted = true;
  showDoc();
  note(`Sheet ${n} of ${P.pages}. The balloons of the other sheets are in the table`);
  return true;
}

// -- the sidecar: <name>.pdballoons.json next to the file; read when the file opens, written by Save --
/** The balloons that belong to a file just opened: in the app from the file next to it, in a browser from the .pdballoons.json picked or dropped with it. */
async function balLoad(d, path, name) {
  d.balName = name;
  const side = BAL.sidecarName(name), t = window.__TAURI__;
  let text = null;
  if (path) d.balloonPath = BAL.sidecarPath(path);
  if (path && t && t.fs && t.fs.readTextFile) { try { if (await t.fs.exists(d.balloonPath)) text = await t.fs.readTextFile(d.balloonPath); } catch (err) { d.balBlocked = true; note(side + ': could not be read (' + (err && err.message ? err.message : err) + ')'); return; } }
  else { text = state.sidecars.get(side.toLowerCase()) ?? null; state.sidecars.delete(side.toLowerCase()); }
  if (text != null) balAttach(d, text, side);
}
function balAttach(d, text, side) {
  const r = BAL.decode(text);
  if (r.error) { d.balBlocked = true; note(`${side}: ${r.error}`); return; }       // balSave must not write over a file that could not be read
  d.balBlocked = false; d.balloons = r.set; d.balSaved = r.set;
  renderEdit(); paintOverlay();
  note(`${side}: ${r.set.items.length} ${r.set.items.length === 1 ? 'balloon' : 'balloons'}` + (r.dropped ? `, ${r.dropped} unreadable ones left out` : ''));
}
/** Where the sidecar goes: next to the file it was opened from; a picture opened without a path asks once (in the app). */
const balPath = (d) => d.balloonPath || (d.path ? BAL.sidecarPath(d.path) : null);
/** Writes the sidecar if the balloons changed since it was read or written. ask: the app may ask where (for a file with no path yet). */
async function balSave(d, ask = true) {
  const set = balOf(d), t = window.__TAURI__;
  if (set === d.balSaved || (!set.items.length && !d.balSaved)) return;
  const text = BAL.encode(set, { source: d.balName || d.name, pages: d.pdf ? d.pdf.pages : 1 });
  try {
    if (t && t.fs && t.fs.writeTextFile) {
      let path = d.balBlocked ? null : balPath(d);
      if (!path) {
        if (!ask || !t.dialog || !t.dialog.save) return;
        path = await t.dialog.save({ defaultPath: BAL.sidecarName(d.balName || d.name), filters: [{ name: 'Balloons', extensions: ['json'] }] });
        path = path && await withExt(t, path, 'json');
        if (!path) return;
        d.balloonPath = String(path); d.balBlocked = false;
      }
      await t.fs.writeTextFile(path, text);
      note('Saved the balloons to ' + path);
    } else download(BAL.sidecarName(d.balName || d.name), text);
    d.balSaved = set;
  } catch (err) { note('Saving the balloons failed: ' + (err && err.message ? err.message : err)); }
}

/** Balloon files first, so a drawing picked together with its balloons finds them waiting. */
const balFirst = (files) => [...files].sort((a, b) => BAL.isSidecar(b.name) - BAL.isSidecar(a.name));
/** A .pdballoons.json picked or dropped (a browser cannot look next to the file): kept for its drawing, or given to the open tab it belongs to. */
function balPicked(name, text) {
  state.sidecars.set(name.toLowerCase(), text);
  const d = state.docs.find((x) => x.balName && BAL.sidecarName(x.balName).toLowerCase() === name.toLowerCase() && !balOf(x).items.length);
  if (d) { balAttach(d, text, name); state.sidecars.delete(name.toLowerCase()); return; }
  note(`${name} read: it goes with the drawing of the same name. Open that too`);
}
/** Double-click a balloon (Select): its number is typed in the panel. */
function balDbl(e) {
  const d = editable();
  if (!d || state.tool !== 'select') return false;
  const p = sheetAt(e.clientX, e.clientY), it = balOf(d).items.find((x) => x.sheet === sheetOf(d) && BAL.bodyAt(x, p, balR(d), 7 / view.scale));
  if (!it) return false;
  balSelect(d, it.id); ui.bal_n.focus(); ui.bal_n.select();
  return true;
}

// -- the panel, the docked table, the sheet switcher --
function buildBalloonPanel() {
  const field = (key, label, extra = {}) => {
    const i = ui['bal_' + key] = h('input', { class: 'fld', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': label, 'data-testid': 'bal-' + key, ...extra });
    i.addEventListener('change', () => balFieldTyped(key));
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
    return h('label', { class: 'field' }, label, i);
  };
  ui.balChip = h('span', { class: 'chip', 'data-testid': 'bal-chip' });
  ui.balWhere = h('span', { class: 'lbl' });
  ui.balPickBtn = h('button', { class: 'btn sm', style: 'white-space:nowrap', type: 'button', 'data-testid': 'bal-pick', onclick: balPick }, 'Pick from text');
  ui.balPickLbl = h('span', { class: 'lbl' }, 'vector PDFs only');
  ui.balSelBox = h('section', { class: 'balbox', hidden: true, 'data-testid': 'bal-panel' },
    h('h2', { class: 'sec' }, 'Balloon'), h('span', { class: 'row' }, ui.balChip, ui.balWhere, h('span', { style: 'flex:1' }), h('button', { class: 'btn sm', type: 'button', 'data-testid': 'bal-delete', title: 'Delete this balloon (Delete)', onclick: balDelete }, 'Delete')),
    h('div', { class: 'balgrid1' }, field('n', 'No.'), field('dim', 'Dimension (nominal)')),
    h('div', { class: 'balgrid2' }, field('tp', 'Tol +'), field('tm', 'Tol −')),
    field('note', 'Note'),
    h('span', { class: 'row' }, ui.balPickBtn, ui.balPickLbl));
  ui.balNext = h('input', { class: 'fld', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Next number', 'data-testid': 'bal-next' });
  ui.balNext.addEventListener('change', () => balNextTyped(ui.balNext.value));
  ui.balNext.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.balNext.blur(); });
  ui.balNumBox = h('section', { class: 'balbox', hidden: true, 'data-testid': 'bal-numbering' },
    h('h2', { class: 'sec' }, 'Numbering'),
    h('div', { class: 'row' }, h('label', { class: 'field balnext' }, 'Next number', ui.balNext), h('span', { class: 'lbl', style: 'flex:1' }, 'goes up by itself; type a number to restart the count')),
    h('div', { class: 'balLater', 'data-testid': 'bal-later' }, h('span', { class: 'row' }, h('span', { class: 'lt' }, 'Later'), h('strong', null, 'Automatic placement')), h('span', { class: 'lbl' }, 'Vector PDFs: find the dimension texts. Image-only pages: OCR. Not built yet.')));
  return [ui.balSelBox, ui.balNumBox];
}
function buildBalloonDock() {
  ui.balCount = h('span', { class: 'chip', 'data-testid': 'bal-count' }, '0');
  ui.balFilter = h('select', { class: 'fld', 'aria-label': 'Sheet filter', 'data-testid': 'bal-filter' });
  ui.balFilter.addEventListener('change', () => { state.balDock.sheet = ui.balFilter.value; renderBalloons(); });
  ui.balRows = h('tbody', { 'data-testid': 'bal-rows' });
  ui.balCollapse = h('button', { class: 'btn sm iconbtn', type: 'button', 'aria-label': 'Collapse', title: 'Collapse the table', 'data-testid': 'bal-collapse', onclick: () => { state.balDock.collapsed = !state.balDock.collapsed; renderBalloons(); } });
  const handle = h('div', { class: 'baldrag', role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': 'Drag to resize', title: 'Drag to resize', 'data-testid': 'bal-drag' }, h('span'));
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || state.balDock.collapsed) return;
    const y0 = e.clientY, h0 = state.balDock.h;
    capture(handle, e);
    const mv = (ev) => { state.balDock.h = Math.round(Math.max(90, Math.min(window.innerHeight * 0.6, h0 + y0 - ev.clientY))); renderBalloons(); };
    const up = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
    handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  });
  ui.balDock = h('section', { class: 'baldock', hidden: true, 'aria-label': 'Balloons', 'data-testid': 'bal-dock' }, handle,
    h('div', { class: 'balhead' }, h('h2', { class: 'sec' }, 'Balloons'), ui.balCount, h('label', { class: 'row lbl' }, 'Show', ui.balFilter), h('span', { class: 'lbl balhint' }, 'Click a row to zoom to its balloon'), h('span', { style: 'flex:1' }),
      h('button', { class: 'btn sm', type: 'button', 'data-testid': 'bal-renumber', title: 'Number them 1 to n, sheet by sheet, in the order placed (one undo step)', onclick: balRenumber }, 'Renumber'),
      h('button', { class: 'btn sm', type: 'button', 'data-testid': 'bal-csv', onclick: () => balExport(false) }, 'Export CSV'),
      h('button', { class: 'btn sm', type: 'button', 'data-testid': 'bal-excel', title: 'A CSV that Excel opens (not an .xlsx)', onclick: () => balExport(true) }, 'Export Excel'), ui.balCollapse),
    h('div', { class: 'balscroll' }, h('table', { class: 'bt' }, h('thead', null, h('tr', null, ['No.', 'Dimension', 'Tol +', 'Tol −', 'Sheet', 'Note'].map((x) => h('th', null, x)))), ui.balRows)));
  ui.balPic = h('div', { class: 'pop balpic', hidden: true, 'data-testid': 'bal-picture-only' }, h('span', { class: 'chip' }, 'Picture only'), h('span', { class: 'lbl' }, 'no text in this page: pick by eye.'));
  ui.balSheets = h('div', { class: 'pop balsheets', hidden: true, 'data-testid': 'bal-sheets' });
  return ui.balDock;
}
/** The panel, the table, the status bar's sheet chip and the sheet switcher follow the tab, the tool, the selection and the balloons. */
function renderBalloons() {
  if (!ui.balDock) return;
  const d = editable(), set = d ? balOf(d) : BAL.EMPTY, lib = state.panel === 'library';
  if (state.balSel != null && !(d && balItem(d, state.balSel))) state.balSel = null;
  const sel = d && balSelItem(d), tool = state.tool === 'balloon', show = !!d && (set.items.length > 0 || tool), P = d && d.pdf;
  const pages = Math.max(P ? P.pages : 1, ...set.items.map((it) => it.sheet));
  ui.balDock.hidden = !show;
  ui.balDock.classList.toggle('collapsed', state.balDock.collapsed);
  ui.balDock.style.height = state.balDock.collapsed ? '' : state.balDock.h + 'px';
  ui.balCollapse.replaceChildren(icon(state.balDock.collapsed ? '<path d="M6 15l6-6 6 6"/>' : '<path d="M6 9l6 6 6-6"/>', { size: 14, width: 2, cap: 'round', join: 'round' }));
  ui.balCollapse.setAttribute('aria-label', state.balDock.collapsed ? 'Expand' : 'Collapse'); ui.balCollapse.title = state.balDock.collapsed ? 'Show the table' : 'Collapse the table';
  ui.balSelBox.hidden = !sel || lib; ui.balNumBox.hidden = !(show || sel) || lib;
  if (d && ui.balNext !== document.activeElement) ui.balNext.value = String(set.next);
  if (sel) {
    const put = (key, v) => { const i = ui['bal_' + key]; if (document.activeElement !== i) i.value = v; };
    ui.balChip.textContent = 'Balloon ' + sel.n; ui.balWhere.textContent = 'selected · sheet ' + sel.sheet;
    put('n', String(sel.n)); put('dim', sel.dim); put('tp', sel.tp); put('tm', sel.tm); put('note', sel.note);
    const text = balTexts(d).length > 0;
    ui.balPickBtn.setAttribute('aria-disabled', String(!text)); ui.balPickBtn.classList.toggle('off', !text);
    ui.balPickBtn.title = text ? 'Fill the dimension from the text under the arrow' : 'This page is a picture: no text to pick from';
  }
  if (show) {
    const opts = [['all', 'All sheets'], ...Array.from({ length: pages }, (_, i) => [String(i + 1), 'Sheet ' + (i + 1)])];
    if (!opts.some((o) => o[0] === state.balDock.sheet)) state.balDock.sheet = 'all';
    if (ui.balFilter.dataset.sig !== opts.length + ':' + pages) { ui.balFilter.replaceChildren(...opts.map(([v, text]) => h('option', { value: v }, text))); ui.balFilter.dataset.sig = opts.length + ':' + pages; }
    ui.balFilter.value = state.balDock.sheet;
    const list = BAL.rows(set, state.balDock.sheet === 'all' ? null : +state.balDock.sheet);
    ui.balCount.textContent = String(set.items.length);
    ui.balRows.replaceChildren(...list.map((it) => {
      const tr = h('tr', { class: it.id === state.balSel ? 'hi' : '', tabindex: '0', 'data-id': it.id, 'data-n': it.n, 'data-testid': 'bal-row', onclick: () => balRow(it.id) },
        h('td', null, h('span', { class: 'bn' }, String(it.n))), h('td', null, it.dim), h('td', null, it.tp), h('td', null, it.tm), h('td', null, String(it.sheet)), h('td', { class: 'tx' }, it.note));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') balRow(it.id); });
      return tr;
    }));
  }
  ui.balPic.hidden = !(d && tool && !balTexts(d).length);
  ui.balSheets.hidden = !(P && P.pages > 1);
  if (!ui.balSheets.hidden) {
    const key = P.page + ':' + P.pages + ':' + P.name;
    if (ui.balSheets.dataset.sig !== key) {
      ui.balSheets.dataset.sig = key;
      const go = (n) => balSheet(editable(), n);
      const pick = P.pages <= 6 ? h('div', { class: 'grp', role: 'group', 'aria-label': 'Sheets' }, Array.from({ length: P.pages }, (_, i) => h('button', { class: 'seg' + (i + 1 === P.page ? ' on' : ''), type: 'button', 'data-sheet': i + 1, 'aria-pressed': String(i + 1 === P.page), onclick: () => go(i + 1) }, 'Sheet ' + (i + 1))))
        : (() => { const sl = h('select', { class: 'fld', 'aria-label': 'Sheets', 'data-testid': 'bal-sheet-select' }, Array.from({ length: P.pages }, (_, i) => h('option', { value: i + 1 }, 'Sheet ' + (i + 1)))); sl.value = String(P.page); sl.addEventListener('change', () => go(+sl.value)); return sl; })();
      ui.balSheets.replaceChildren(h('span', { class: 'lbl' }, `${P.name} · ${P.pages} pages`), pick);
    }
  }
  ui.sheetChip.hidden = !(P && P.pages > 1);
  if (P) ui.sheetChip.textContent = `Sheet ${P.page} / ${P.pages}`;
}

// ---- Leader (TODO 28, leader.js; mock-up R8c): click the shape, click the next point (once more for a second segment, or Enter), type the note where it lands ----
const newLdr = () => ({ pts: [], hover: null, cursor: null });
/** What the command line asks for next. */
function ldrPrompt() {
  const L = state.ldr;
  if (!editable()) return 'Leader: open a drawing tab first';
  return L ? ['Specify leader arrowhead location:', 'Specify next point:', 'Specify next point, or Enter to type the note:'][L.pts.length] : null;
}
/** The leader being drawn, with the pointer as its last point, as a preview drawing (lines and arrowhead; no note yet), or null. */
function ldrPreview(d) {
  const L = state.ldr, q = L && (L.hover || L.cursor);
  if (!d || !editable() || !L || !L.pts.length || !q || textEditing()) return null;       // (no preview while the note is typed)
  const look = dimNew(d), g = LR.geometry({ pts: [...L.pts, [q[0], q[1]]], lines: [''], textH: look.textH, arrow: look.arrow });
  return g && { lines: g.lines, arrows: g.arrows, text: null };
}
function ldrHover(d, p, shift) {
  const L = state.ldr;
  L.cursor = p; L.hover = pickPoint(d, p, L.pts, shift, true);
  paintOverlay();
}
function ldrPoint(d, p, shift = false) {
  const L = state.ldr;
  if (!L || !editable()) return;
  const q = pickPoint(d, p, L.pts, shift), last = L.pts[L.pts.length - 1];
  if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 1e-9) { note('Leader: that is the same point again, pick another'); return; }
  L.pts.push([q[0], q[1]]); L.hover = null;
  if (L.pts.length === 3) { ldrNoteOpen(d); return; }
  note(ldrPrompt()); paintOverlay();
}
/** All the points are picked (the third click, or Enter after the second): type the note in place where it lands. */
function ldrNoteOpen(d) {
  const L = state.ldr, look = dimNew(d), model = { pts: L.pts.map((q) => [q[0], q[1]]), lines: [''], textH: look.textH, arrow: look.arrow };
  L.hover = null;
  if (!LR.geometry(model)) { L.pts = []; note('Leader: the points are on one another, start again'); return; }
  textOpen(d, null, null, { model, e: null });
}
/** The typed note becomes the leader: one undo step, selected. */
function ldrAdd(d, m) {
  const b = LR.build(m, LR.freeName(d.raw.blocks));
  if (state.ldr) { state.ldr.pts = []; state.ldr.hover = null; }
  if (!b) return;
  const idx = d.raw.entities.length;
  view.fitted = false;
  commit(d, Ed.addDimension(d.raw, b), 'Add leader');
  setSel(d, new Set([idx]));
  note(`Leader placed on the layer ${Ed.DIM_LAYER}: ${m.lines.join(' / ')}. Ctrl+Z takes it back`);
}
/** The leader at entity e changed to model m, as one undo step with this label; it stays selected. */
function ldrReplace(d, e, m, label) {
  const o = LR.ofEntity(d.raw, e), next = o && LR.replace(d.raw, o.name, m);
  if (!next) return false;
  view.fitted = false;
  commit(d, next, label);
  setSel(d, new Set([e]));
  return true;
}
/** Double-click on a leader with Select: its note is typed in place. */
function ldrEdit(d, e, model) { setSel(d, new Set([e])); textOpen(d, null, null, { model, e }); }
/** The leader pseudo-entity the grips work on ({ type: 'LEADER', name, model }), or null when entity e is not a leader. */
function ldrPseudo(d, e) { const o = d.raw.entities[e] && d.raw.entities[e].type === 'INSERT' && LR.ofEntity(d.raw, e); return o ? { type: 'LEADER', name: o.name, model: o.model } : null; }
/** The one selected leader { e, name, model }, or null. */
function ldrSel(d) {
  if (!d || d.sel.size !== 1) return null;
  const e = [...d.sel][0], o = LR.ofEntity(d.raw, e);
  return o && { e, ...o };
}
/** The Leader section's fields: a typed note (one line), text height or arrow size (mm) changes the selected leader. */
function ldrFieldTyped(which) {
  const d = editable(), sl = d && ldrSel(d), input = which === 'note' ? ui.ldrNote : which === 'h' ? ui.ldrH : ui.ldrA;
  input.blur();
  if (!sl) return;
  let m = sl.model, label;
  if (which === 'note') {
    const lines = TX.linesOf(input.value);
    if (!lines) { note('A leader needs a note: type something, or Delete the leader'); renderEdit(); return; }
    if (JSON.stringify(lines) === JSON.stringify(m.lines)) return;
    m = { ...m, lines }; label = 'Leader note';
  } else {
    const mm = Number(input.value.trim().replace(',', '.'));
    if (!(mm > 0) || !Number.isFinite(mm) || mm > 1e4) { note(`Type the ${which === 'h' ? 'text height' : 'arrow size'} in mm: a number above 0`); renderEdit(); return; }
    const v = mm / d.factor;
    if (Math.abs(v - (which === 'h' ? m.textH : m.arrow)) < 1e-9 * v) { renderEdit(); return; }
    m = which === 'h' ? { ...m, textH: v } : { ...m, arrow: v }; label = which === 'h' ? 'Leader text height' : 'Leader arrow size';
  }
  if (ldrReplace(d, sl.e, m, label)) note(`${label}. Ctrl+Z takes it back`);
}
function cancelSetlen() { state.setlen = null; note('Set length cancelled'); renderEdit(); paintOverlay(); }
function lengthPoint(d, p, shift = false) {
  const L = state.setlen;
  if (L.pts.length >= 2) return;
  L.pts.push(pickPoint(d, p, L.pts, shift)); L.hover = null;
  if (L.pts.length === 1) note('Set length: now the second point');
  else {
    L.measured = Math.hypot(L.pts[1][0] - L.pts[0][0], L.pts[1][1] - L.pts[0][1]) * d.factor;
    if (!(L.measured > 1e-9)) { L.pts = []; L.measured = null; note('Set length: those are the same point, pick two'); } else note(`Set length: ${fmtSize(L.measured)} mm measured. Type the real length`);
  }
  renderEdit(); paintOverlay();
  if (L.measured) { ui.realLen.focus(); ui.realLen.select(); }
}
function applyLength() {
  const d = editable(), L = state.setlen;
  if (!d || !L || !L.measured) return;
  const real = Number(ui.realLen.value.trim().replace(',', '.')), s = Ed.scaleFactor(real, L.measured);
  if (s == null) { note('Type the real length in mm: a number above 0'); return; }
  ui.realLen.value = '';
  scaleDrawing(d, s, 'Set length');
}

// ---- drawing tools (draw.js): Line, Polyline, Rectangle, Rounded rectangle, Circle, Ellipse, Arc ----

/** An empty tab becomes a drawing to draw in (mm, one layer "0"); its first change makes it dirty. */
function ensureScratch(d) {
  if (d.raw || d.lay) return;
  const raw = newDoc(4), fl = flatten(raw);
  Object.assign(d, tabFields(raw, fl), { scratch: true });
  d.hist = Ed.createHistory(); d.sel = new Set(); d.hl = []; d.ed = null; warm(d);
  update();
}
/** The drawing tab the drawing tools work on (an empty tab is made into one), or null on a layout. */
function drawTarget() {
  const d = curDoc();
  if (!d || d.lay) return null;
  if (!d.raw) ensureScratch(d);
  return editable();
}
/** The layer new shapes go on: the one picked in the Layers panel, else "0". */
function curLayerName(d) {
  const names = new Set([...Object.keys(d.raw.layers), ...d.fl.layers.map((l) => l.name)]);
  return d.curLayer && names.has(d.curLayer) ? d.curLayer : '0';
}
const drawLive = () => !!(state.draw && state.drawDoc === curDoc() && editable());

/** The point for a pick (mm, y up, with its snap kind): the drawing's snaps, the tool's own points, then Shift / ORTHO along X or Y. */
function drawPick(d, cx, cy, shift, hover) {
  const T = state.draw, f = d.factor, p = toDrawing(d, cx, cy);
  let q = null;
  if (state.snap) for (const o of T.pts) if (Math.hypot(o[0] / f - p[0], o[1] / f - p[1]) <= pickTol(d)) { q = [o[0] / f, o[1] / f, 'end']; break; }
  if (!q) q = snapPoint(d, p);
  const ref = DR.toolRef(T), base = ref && DR.orthoApplies(T) ? [ref[0] / f, ref[1] / f] : null, straight = !!((shift || state.ortho) && base);
  const tq = trackPick(d, p, q, base, straight, hover);
  if (tq) return [tq[0] * f, tq[1] * f, null];
  if (q.length === 2) q = [Math.round(q[0] * f * 100) / 100 / f, Math.round(q[1] * f * 100) / 100 / f];           // a free pick lands on 0.01 mm
  if (straight) q = Ed.orthoLock(base, q);
  return [q[0] * f, q[1] * f, q[2] || null];
}
function drawHoverAt(d, cx, cy, shift) {
  const q = drawPick(d, cx, cy, shift, true);
  state.drawHover = q; DR.toolHover(state.draw, [q[0], q[1]]);
  paintOverlay();
}
function drawClick(e) {
  const d = drawTarget();
  if (!d) return;
  state.drawDoc = d;
  const q = drawPick(d, e.clientX, e.clientY, e.shiftKey);
  trackStop();                                                      // a click ends the hover (and the lock it showed)
  state.drawHover = q; state.msg = null;
  drawApply(DR.toolClick(state.draw, [q[0], q[1]]));
}
/** What a tool action gave: shapes become ONE labelled undo step; otherwise its message and the new prompt. */
function drawApply(r) {
  const T = state.draw, d = state.drawDoc;
  if (!T || !d) return;
  if (r.undoSeg) { undo(d); return; }                               // U in a Line: the last segment's step is taken back (undo() steps the tool back too)
  if (r.made) trackClear();                                         // the tool action is over: the acquired points go
  if (T.kind === 'rrect' && T.radius !== state.drawCfg.radius) { state.drawCfg.radius = T.radius; try { localStorage.setItem('pd-rradius', String(T.radius)); } catch { /* ignore */ } }
  if (r.made && r.made.length) { drawCommit(d, T.kind, r.made); return; }
  state.msg = r.msg || null; renderCommand(); paintOverlay();
}
/** Enter / Esc / right-click: the tool ends what it has (a line or polyline keeps it) and the acquired points go. */
function drawFinish() { trackClear(); drawApply(DR.toolFinish(state.draw)); }
function drawCommit(d, kind, shapes) {
  const layer = curLayerName(d);
  if (!d.raw.layers[layer]) addLayer(d.raw, layer);
  const ents = shapes.map((sh) => DR.toEntity(sh, { layer }, d.factor));
  view.fitted = false;                                              // the view stays where it is while he draws
  commit(d, { entities: [...d.raw.entities, ...ents], blocks: d.raw.blocks }, DR.LABELS[kind]);
  note(`${DR.LABELS[kind]} made on layer ${layer}` + (shapes.length > 1 ? ` (${shapes.length} lines)` : '') + '. Ctrl+Z takes it back');
}
/** The command line while a drawing tool is on: typed points, lengths and words. Returns true when it took the text. */
function drawTyped(raw) {
  if (!drawLive()) return false;
  const T = state.draw, word = raw.trim().toLowerCase();
  if (word && !DR.toolBusy(T) && !DR.toolWords(T).has(word)) { const cmd = CB.resolve(word, 'draw', ownCommands); if (cmd && (TOOL_OF[cmd.name] || cmd.name) !== T.kind) { runCommand(cmd); return true; } }       // a command typed between two shapes
  state.msg = null;
  drawApply(DR.toolType(T, raw));
  return true;
}

/** The overlay over the drawing: the shape being drawn, its helper lines and the readout. */
function drawOvl() {
  if (!ui.ovl) return;
  const d = curDoc(), H = state.sheetH, out = [];
  let tip = null;
  if (d && d.cmp && d.cmp.show && !d.cmp.moving && d.cmp.res) cmpGlow(d.cmp, out);
  if (d && !d.lay && drawLive()) {
    const pv = DR.toolPreview(state.draw);
    for (const g of pv.guides) out.push(s('path', { class: 'dr-guide', d: DR.svgPath({ t: 'line', a: g[0], b: g[1] }, H) }));
    for (const sh of pv.shapes) out.push(s('path', { class: 'dr-shape', d: DR.svgPath(sh, H), 'data-testid': 'draw-preview' }));
    if (pv.at && (pv.readout || state.trk.res)) tip = { text: state.trk.res ? state.trk.res.text : pv.readout, x: pv.at[0], y: pv.at[1] };
  }
  if (d && !d.lay && modLive()) modOvl(d, out);
  if (d && !d.lay && editable()) {
    const bt = balOvl(d, out, 1 / view.scale), tt = textOvl(d, out, 1 / view.scale) || gripOvl(d, out, 1 / view.scale);
    if (bt && !tt) tip = bt;
    if (drawLive() || state.grip || state.meas || state.dim || state.ldr) trackOvl(d, out, 1 / view.scale);
    if (tt && state.grip && state.trk.res) tt.text = state.trk.res.text;
    if (tt) { const cr = ui.canvas.getBoundingClientRect(); tip = { text: tt.text, x: (tt.px[0] - cr.left) / view.scale + view.ox, y: H - ((tt.px[1] - cr.top) / view.scale + view.oy) }; }
  }
  ui.ovl.replaceChildren(...out);
  if (ui.gripHint) ui.gripHint.hidden = !(d && !d.lay && gripOn(d) && gripList(d).length > 0);
  const t = ui.tip;
  if (!tip) { t.hidden = true; return; }
  const r = canvasSize(), px = (tip.x - view.ox) * view.scale + 16, py = (H - tip.y - view.oy) * view.scale + 16;
  t.textContent = tip.text; t.hidden = false;
  t.style.left = Math.max(4, Math.min(px, r.w - t.offsetWidth - 4)) + 'px'; t.style.top = Math.max(4, Math.min(py, r.h - t.offsetHeight - 4)) + 'px';
}

/** Keys while a drawing tool is on or a letter starts one. Returns true when it took the key. */
function drawKey(e, k) {
  if (drawLive()) {
    const T = state.draw;
    if (e.key === 'Enter' || (e.key === ' ' && DR.toolBusy(T))) { e.preventDefault(); state.msg = null; drawFinish(); return true; }
  }
  return false;
}

// ---- Offset, Trim and Mirror (modify.js) ----
const MOD_KINDS = ['offset', 'trim', 'mirror'], OFFSET_SAVED = 'pd-offset';
const loadOffsetDist = () => { try { const v = Number(localStorage.getItem(OFFSET_SAVED)); return v > 0 && Number.isFinite(v) ? v : 10; } catch { return 10; } };
/** A fresh tool: Offset picks an object then a side; Trim picks cutting edges then parts; Mirror picks objects, then two points, then Erase Yes / No. */
const newMod = (kind) => ({ kind, stage: kind === 'offset' ? 'obj' : kind === 'trim' ? 'edges' : 'pick', ent: null, edges: [], was: new Map(), all: false, objs: [], p1: null, p2: null, p: null, cur: null });
const modLive = () => !!(state.mod && state.modDoc === curDoc() && editable());
const offDistU = (d) => state.offDist / d.factor;
const mmText = (v) => String(+Number(v).toFixed(3));
/** Drops what an undo took away (the object Offset was holding, edges that are gone). */
function modSync(d) {
  const m = state.mod, have = new Set(d.raw.entities);
  if (m.ent && !have.has(m.ent)) { m.ent = null; if (m.stage === 'side') m.stage = 'obj'; }
  // an undone Trim brings the original entity back, not the pieces it made: an edge that is gone is swapped for the object it was cut from
  const back = (e) => { for (let k = 0; e && !have.has(e) && k < 1000; k++) e = m.was.get(e); return e; };
  m.edges = [...new Set(m.edges.map(back).filter(Boolean))];
}
const modEntAt = (d, p) => { const i = hitAt(d, p); return i >= 0 ? d.raw.entities[i] : null; };
/** The cutting edges: the ones picked, or (Enter with none picked) every line, arc, circle and polyline showing. */
const trimEdges = (d, m) => (m.all ? edIndex(d).shown.map((i) => d.raw.entities[i]).filter(MD.canModify) : m.edges);

/** A modify tool just chosen: Offset reads its remembered distance; Mirror takes the selection if there is one. */
function modStart(id) {
  const m = state.mod, d = editable();
  if (id === 'offset') { state.offDist = loadOffsetDist(); state.msg = 'Offset: pick an object, or type the distance first'; }
  else if (id === 'trim') state.msg = 'Trim: pick the cutting edges, then Enter (Enter alone = all)';
  else if (d.sel.size) { m.objs = [...d.sel].map((i) => d.raw.entities[i]); m.stage = 'p1'; state.msg = `${d.sel.size} selected: click the first point of the mirror line`; }
  else state.msg = 'Mirror: select the objects, then press Enter';
}
function modPrompt(d) {
  const m = state.mod, n = m.kind === 'trim' ? (m.all ? 'all' : m.edges.length) : m.kind === 'mirror' ? d.sel.size : 0;
  if (m.kind === 'offset') return { status: `Command: OFFSET   Distance <${mmText(state.offDist)}> mm`, prompt: m.stage === 'obj' ? `Select the object to offset, or type the distance <${mmText(state.offDist)}>:` : `Click the side to offset to (or type a new distance <${mmText(state.offDist)}>):` };
  if (m.kind === 'trim') return { status: `Command: TRIM   Cutting edges: ${n}`, prompt: m.stage === 'edges' ? 'Select cutting edges (click adds or takes out), Enter = all:' : 'Click the part to cut away. Enter or Esc ends:' };
  const objs = m.objs.length;
  return { status: `Command: MIRROR   ${m.stage === 'pick' ? `${n} selected` : `${objs} object${objs === 1 ? '' : 's'}`}`,
    prompt: m.stage === 'pick' ? 'Select objects (click or drag a box), then Enter:' : m.stage === 'p1' ? 'Specify first point of mirror line:' : m.stage === 'p2' ? 'Specify second point of mirror line:' : 'Erase source objects? [Yes / No] <No>:' };
}

function modEsc(d) {
  const m = state.mod;
  if (m.kind === 'offset' && m.stage === 'side') { m.stage = 'obj'; m.ent = null; note('Offset: pick an object'); paintOverlay(); return; }
  if (m.kind === 'trim' && m.stage === 'edges' && (m.edges.length || m.all)) { m.edges = []; m.all = false; note('Cutting edges cleared'); paintOverlay(); return; }
  if (m.kind === 'mirror' && m.stage === 'pick' && d.sel.size) { setSel(d, new Set()); renderCommand(); return; }
  const was = m.kind;
  setTool('select'); note(was[0].toUpperCase() + was.slice(1) + ' ended');
}
function modEnter(d) {
  const m = state.mod;
  if (m.kind === 'offset') { modEsc(d); return; }
  if (m.kind === 'trim') {
    if (m.stage === 'edges') { m.all = !m.edges.length; m.stage = 'cut'; note(m.all ? 'Every line, arc, circle and polyline is a cutting edge. Click the part to cut away' : `${m.edges.length} cutting edge${m.edges.length === 1 ? '' : 's'}. Click the part to cut away`); paintOverlay(); }
    else modEsc(d);
    return;
  }
  if (m.stage === 'pick') {
    if (!d.sel.size) { note('Mirror: pick at least one object first'); return; }
    m.objs = [...d.sel].map((i) => d.raw.entities[i]); m.stage = 'p1'; note(`${m.objs.length} to mirror. Click the first point of the mirror line`); paintOverlay();
  } else if (m.stage === 'erase') modAnswer(d, false);
  else note('Mirror: click the ' + (m.stage === 'p1' ? 'first' : 'second') + ' point of the mirror line');
}
/** The command line while a modify tool is on. True when it took the text. */
function modTyped(d, raw) {
  const m = state.mod, c = raw.trim().toLowerCase();
  if (!c) { modEnter(d); return true; }
  if (m.kind === 'offset' && /^\d*\.?\d+(\s*mm)?$/.test(c)) {
    const v = Number(c.replace(/\s*mm$/, ''));
    if (!(v > 0) || v > 1e6) { note('The offset distance must be more than 0'); return true; }
    state.offDist = v; try { localStorage.setItem(OFFSET_SAVED, String(v)); } catch { /* ignore */ }
    note(`Offset distance ${mmText(v)} mm`); paintOverlay(); return true;
  }
  if (m.kind === 'mirror' && m.stage === 'erase') {
    if (c === 'y' || c === 'yes') modAnswer(d, true); else if (c === 'n' || c === 'no') modAnswer(d, false); else note('Erase source objects? Type Yes or No (Enter = No)');
    return true;
  }
  if (m.kind === 'trim' && m.stage === 'edges' && (c === 'a' || c === 'all')) { m.edges = []; modEnter(d); return true; }
  return false;
}

function modHover(d, cx, cy, shift) {
  const m = state.mod, p = toDrawing(d, cx, cy);
  m.p = p;
  if (m.kind === 'mirror' && (m.stage === 'p1' || m.stage === 'p2')) m.cur = pickPoint(d, p, m.stage === 'p2' ? [m.p1] : [], shift, true);
  paintOverlay();
}
function modUp(d, was, p, shift) {
  const m = state.mod;
  modSync(d);
  if (m.kind === 'mirror' && m.stage === 'pick') { if (was.moved) boxSelect(d, was.p, p, shift || was.shift); else clickSelect(d, was.p, shift || was.shift); renderCommand(); return; }
  if (was.moved) return;
  if (m.kind === 'offset') {
    if (m.stage === 'obj') {
      const ent = modEntAt(d, was.p);
      if (!ent) { note('Offset: nothing there. Click a line, arc, circle or polyline'); return; }
      if (!MD.canModify(ent)) { note('Offset takes a line, arc, circle or polyline'); return; }
      m.ent = ent; m.stage = 'side'; m.p = was.p; note('Click the side to offset to'); paintOverlay();
    } else offsetDo(d, was.p);
  } else if (m.kind === 'trim') {
    if (m.stage === 'edges') {
      const ent = modEntAt(d, was.p);
      if (!ent) { note('Trim: click a cutting edge, or press Enter to use them all'); return; }
      if (!MD.canModify(ent)) { note('A cutting edge is a line, arc, circle or polyline'); return; }
      m.edges = m.edges.includes(ent) ? m.edges.filter((e) => e !== ent) : [...m.edges, ent];
      note(`${m.edges.length} cutting edge${m.edges.length === 1 ? '' : 's'}. Click more, or press Enter`); paintOverlay();
    } else trimDo(d, was.p, shift || was.shift);
  } else {
    const q = pickPoint(d, was.p, m.stage === 'p2' ? [m.p1] : [], shift || was.shift);
    if (m.stage === 'p1') { m.p1 = [q[0], q[1]]; m.stage = 'p2'; note('Click the second point of the mirror line'); paintOverlay(); }
    else if (m.stage === 'p2') {
      if (Math.hypot(q[0] - m.p1[0], q[1] - m.p1[1]) < 1e-9) { note('The two points are the same: click a different second point'); return; }
      m.p2 = [q[0], q[1]]; m.stage = 'erase'; note('Erase source objects? Type Yes or No, or click a button (Enter = No)'); paintOverlay();
    }
  }
}

function offsetDo(d, p) {
  const m = state.mod, r = MD.offsetEntity(m.ent, offDistU(d), p);
  if (r.error) { note(r.error); return; }
  view.fitted = false;
  commit(d, { entities: [...d.raw.entities, r.ent], blocks: d.raw.blocks }, 'Offset');
  m.stage = 'obj'; m.ent = null;
  note(`Offset ${mmText(state.offDist)} mm made on layer ${r.ent.layer}. Pick another object, or Esc ends. Ctrl+Z takes it back`);
}
function trimDo(d, p, shift) {
  const m = state.mod, idx = hitAt(d, p);
  if (idx < 0) { note('Trim: nothing there. Click the part to cut away'); return; }
  const ent = d.raw.entities[idx];
  if (!MD.canModify(ent)) { note('Trim takes a line, arc, circle or polyline'); return; }
  const r = MD.trimEntity(ent, trimEdges(d, m), p);
  if (r.error) { note(r.error); return; }
  view.fitted = false;
  // the pieces of a cutting edge are still cutting edges (set before the commit, whose redraw drops edges that are gone)
  if (m.edges.includes(ent)) { for (const p of r.ents) m.was.set(p, ent); m.edges = m.edges.flatMap((e) => (e === ent ? r.ents : [e])); }
  commit(d, { entities: d.raw.entities.flatMap((e, i) => (i === idx ? r.ents : [e])), blocks: d.raw.blocks }, 'Trim');
  note((r.ents.length ? `Trimmed: ${r.ents.length} piece${r.ents.length === 1 ? '' : 's'} left.` : 'Trimmed away.') + (shift ? ' (Shift, extend, is not built: this trims.)' : '') + ' Click another part, or Esc ends. Ctrl+Z takes it back');
}
/** Mirror: the second point is picked, now Yes (the sources go) or No (they stay). One undo step. */
function modAnswer(d, erase) {
  const m = state.mod, at = new Map(d.raw.entities.map((e, i) => [e, i])), done = [], made = [], skipped = [];
  for (const ent of m.objs) {
    if (!at.has(ent)) continue;
    const r = MD.mirrorEntity(ent, m.p1, m.p2);
    if (r.ent) { made.push(r.ent); done.push(at.get(ent)); } else skipped.push(r.skip);
  }
  if (!made.length) { setTool('select'); note('Mirror: nothing could be mirrored' + (skipped.length ? ' (' + skipped[0] + ')' : '')); return; }
  const base = erase ? Ed.removeEntities(d.raw, new Set(done)) : { entities: d.raw.entities, blocks: d.raw.blocks }, first = base.entities.length;
  view.fitted = false;
  commit(d, { entities: [...base.entities, ...made], blocks: base.blocks }, 'Mirror');
  setTool('select'); setSel(d, new Set(made.map((_, i) => first + i)));
  note(`Mirrored ${made.length}${erase ? ', the sources erased' : ''}` + (skipped.length ? `; ${skipped.length} left out (${[...new Set(skipped)].join('; ')})` : '') + '. Ctrl+Z takes it back');
}

/** The overlay of a modify tool: what it holds (dashed), the cutting edges, and the result before the click. */
function modOvl(d, out) {
  const m = state.mod, H = state.sheetH, f = d.factor;
  modSync(d);
  const add = (shape, cls, tid) => out.push(s('path', { class: cls, d: DR.svgPath(shape, H), 'data-testid': tid || null }));
  const addEnt = (ent, cls, tid) => { if (ent && GR.hasGrips(ent)) add(GR.shapeOf(ent, f), cls, tid); };
  if (m.kind === 'offset') {
    if (m.stage === 'obj') { const e = m.p ? modEntAt(d, m.p) : null; if (e && MD.canModify(e)) addEnt(e, 'dr-guide'); }
    else if (m.ent) { addEnt(m.ent, 'dr-guide'); const r = m.p ? MD.offsetEntity(m.ent, offDistU(d), m.p) : null; if (r && r.ent) addEnt(r.ent, 'dr-shape', 'mod-preview'); }
  } else if (m.kind === 'trim') {
    for (const e of m.edges) addEnt(e, 'dr-edge', 'trim-edge');
    if (m.stage === 'cut' && m.p) {
      const e = modEntAt(d, m.p);
      if (e && MD.canModify(e)) { addEnt(e, 'dr-guide'); const r = MD.trimEntity(e, trimEdges(d, m), m.p); if (r.ents) for (const k of r.ents) addEnt(k, 'dr-shape', 'mod-preview'); }
    }
  } else if (m.stage === 'p1' || m.stage === 'p2' || m.stage === 'erase') {
    const a = m.p1, b = m.stage === 'erase' ? m.p2 : m.stage === 'p2' ? m.cur : null;
    if (a && b && Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9) {
      add({ t: 'line', a: [a[0] * f, a[1] * f], b: [b[0] * f, b[1] * f] }, 'dr-guide', 'mod-line');
      for (const e of m.objs.slice(0, 300)) { const r = MD.mirrorEntity(e, a, b); if (r.ent) addEnt(r.ent, 'dr-shape', 'mod-preview'); }
    }
  }
}

// ---- the Text tool (text.js; mock-up R5a, Option A) ----
const TX_SAVED = 'pd-text';
const loadTextCfg = () => {
  const cfg = { h: 10, font: 'Standard', ha: 0, bold: false, angle: 0 };
  try {
    const v = JSON.parse(localStorage.getItem(TX_SAVED) || 'null');
    if (v && v.h > 0) cfg.h = v.h;
    if (v && TX.FONTS.some((f) => f.id === v.font)) cfg.font = v.font;
    if (v && [0, 1, 2].includes(v.ha)) cfg.ha = v.ha;
    if (v && v.bold === true) cfg.bold = true;
  } catch { /* ignore */ }
  return cfg;
};
const saveTextCfg = () => { const c = state.text.cfg; try { localStorage.setItem(TX_SAVED, JSON.stringify({ h: c.h, font: c.font, ha: c.ha, bold: c.bold })); } catch { /* ignore */ } };
const ALIGN_WORDS = ['Left', 'Centre', 'Right'];

let measCtx = null;
/** A function: a line's width in a 100 px font of this kind (the canvas measures it; a guess without one). */
function width100(font, bold) {
  if (!measCtx) { try { measCtx = document.createElement('canvas').getContext('2d'); } catch { measCtx = null; } }
  if (!measCtx) return (l) => l.length * 55;
  measCtx.font = (bold ? 'bold ' : '') + '100px ' + FONT_FAMILY[font];
  return (l) => measCtx.measureText(l).width;
}
/** The text selected on a drawing tab (exactly one TEXT or MTEXT, not a dimension's): { e, ent, m, box } with the box in drawing units. */
function textSel(d) {
  if (!d || !d.sel || d.sel.size !== 1) return null;
  const e = [...d.sel][0], ent = d.raw.entities[e], m = TX.decode(ent);
  if (!m || ent.layer === Ed.DIM_LAYER) return null;
  return { e, ent, m, box: TX.textBox(m, width100(m.font, m.bold)) };
}
const textBarOn = (d) => !!d && !d.lay && !!editable() && (state.tool === 'text' || !!textSel(d));
const textEditing = () => !!state.text.ed;
const toSheetPt = (d, p) => [p[0] * d.factor, state.sheetH - p[1] * d.factor];

/** A text pick (drawing units): snapped when SNAP is on, else free to 0.01 mm. */
function textPick(d, cx, cy) {
  const f = d.factor;
  let q = snapPoint(d, toDrawing(d, cx, cy));
  if (q.length === 2) q = [Math.round(q[0] * f * 100) / 100 / f, Math.round(q[1] * f * 100) / 100 / f];
  return [q[0], q[1]];
}

/** Puts a text into the drawing (one undo step "Text") and selects it. */
function textAdd(d, m) {
  const layer = curLayerName(d);
  if (!d.raw.layers[layer]) addLayer(d.raw, layer);
  const ent = TX.encode(m, { layer }), idx = d.raw.entities.length;
  view.fitted = false;
  commit(d, { entities: [...d.raw.entities, ent], blocks: d.raw.blocks }, 'Text');
  setSel(d, new Set([idx]));
  note(`${TX.kindOf(m)} placed on layer ${layer}` + (m.lines.length > 1 ? ` (${m.lines.length} lines)` : '') + '. Ctrl+Z takes it back');
}
/** Changes the text at entity e to model m (it keeps its layer and colour), as one undo step with this label; the text stays selected. */
function textReplace(d, e, m, label) {
  const old = d.raw.entities[e], ent = TX.encode(m, { layer: old.layer, lt: old.lt, aci: old.aci, tc: old.tc, lw: old.lw, lts: old.lts, hidden: old.hidden, ps: old.ps });
  view.fitted = false;
  commit(d, { entities: d.raw.entities.map((x, i) => (i === e ? ent : x)), blocks: d.raw.blocks }, label);
  setSel(d, new Set([e]));
}

// -- the editor over the canvas: a box you type in, in the text's own font and size
function placeTextEditor() {
  const ed = state.text.ed;
  if (!ed) return;
  const d = ed.d, m = ed.m, f = d.factor, S = m.h * f * view.scale / CAP, P = TX.LH * m.h * f * view.scale;
  const lines = ui.textArea.value.split('\n'), w = width100(m.font, m.bold);
  const metrics = (() => { width100(m.font, m.bold); const t = measCtx && measCtx.measureText('Mg'); return t && t.fontBoundingBoxAscent ? [t.fontBoundingBoxAscent / 100, t.fontBoundingBoxDescent / 100] : [0.95, 0.25]; })();
  const A = metrics[0] * S, D = metrics[1] * S, padX = 6, padY = 3;
  const wpx = Math.max(60, ...lines.map((l) => w(l) * S / 100)) + 2 * padX + 4;
  const rows = Math.max(1, lines.length), hpx = rows * P + 2 * padY;
  const base = padY + (P - (A + D)) / 2 + A;                          // the first baseline's distance from the box's top
  const sx = (m.x * f - view.ox) * view.scale, sy = (state.sheetH - m.y * f - view.oy) * view.scale;     // the anchor on screen
  const left = sx - (wpx - 2 * padX) * m.ha / 2 - padX, top = sy - base;
  const ta = ui.textArea, st = ui.textEd.style;
  ta.style.fontSize = S + 'px'; ta.style.lineHeight = P + 'px'; ta.style.fontFamily = FONT_FAMILY[m.font]; ta.style.fontWeight = m.bold ? '700' : '400';
  ta.style.textAlign = ['left', 'center', 'right'][m.ha]; ta.style.width = wpx + 'px'; ta.style.height = hpx + 'px'; ta.style.padding = `${padY}px ${padX}px`;
  ta.rows = rows;
  st.left = left + 'px'; st.top = top + 'px';
  st.transformOrigin = `${sx - left}px ${base}px`; st.transform = m.angle ? `rotate(${-m.angle}deg)` : '';
  const room = canvasSize().w - (left + wpx);                         // the hint sits to the right of the box, or under it near the right edge
  if (room > 190) { ui.textHintEd.style.left = (wpx + 10) + 'px'; ui.textHintEd.style.top = '0px'; } else { ui.textHintEd.style.left = '0px'; ui.textHintEd.style.top = (hpx + 6) + 'px'; }
}

/** Opens the editor: a new text at drawing point p, or the text at entity e to change (its lines in the box). */
function textOpen(d, p, e = null, ldr = null) {
  textCommit();
  const c = state.text.cfg;
  let m, orig = null;
  if (ldr) { m = { ...LR.geometry(ldr.model).text }; e = ldr.e; }                 // a leader's note: where it lands, in the leader's text height
  else if (e != null) { orig = TX.decode(d.raw.entities[e]); m = { ...orig }; setSel(d, new Set([e])); }
  else m = { type: 'TEXT', x: p[0], y: p[1], h: c.h / d.factor, lines: [''], angle: c.angle || 0, ha: c.ha, font: c.font, styleName: c.font, bold: c.bold };
  state.text.ed = { d, e, m, orig, ldr: ldr && ldr.model };
  ui.textArea.value = m.lines.join('\n');
  ui.textEd.hidden = false;
  placeTextEditor();
  ui.textArea.focus({ preventScroll: true }); ui.textArea.setSelectionRange(ui.textArea.value.length, ui.textArea.value.length);
  state.msg = null; renderCommand(); paintOverlay(); renderEdit();
}
/** Enter, Esc or clicking away: the typed lines become the text (a new one, or the changed one). */
function textCommit() {
  const ed = state.text.ed;
  if (!ed) return;
  state.text.ed = null; ui.textEd.hidden = true; ui.textArea.blur();      // hiding alone moves focus only at the next frame: a key pressed sooner would still go to the textarea
  const lines = TX.linesOf(ui.textArea.value), d = ed.d;
  if (!state.docs.includes(d) || !d.raw) return;
  if (ed.ldr) {                                                       // a leader's note
    if (!lines) { if (ed.e == null && state.ldr) state.ldr.pts = []; renderCommand(); renderEdit(); paintOverlay(); if (ed.e == null) note('Leader: nothing typed, so nothing was made'); return; }
    if (ed.e == null) ldrAdd(d, { ...ed.ldr, lines });
    else if (JSON.stringify(lines) !== JSON.stringify(ed.ldr.lines)) { if (ldrReplace(d, ed.e, { ...ed.ldr, lines }, 'Leader note')) note('Leader note changed. Ctrl+Z takes it back'); }
    else { renderCommand(); renderEdit(); paintOverlay(); }
    return;
  }
  if (!lines) { renderCommand(); renderEdit(); paintOverlay(); if (ed.e == null) note('Text: nothing typed, so nothing was made'); return; }
  if (ed.e != null) {
    if (JSON.stringify(lines) === JSON.stringify(ed.orig.lines)) { renderCommand(); renderEdit(); paintOverlay(); return; }
    textReplace(d, ed.e, { ...ed.m, lines }, 'Edit text');
    note(`${TX.kindOf({ ...ed.m, lines })} changed. Ctrl+Z takes it back`);
  } else textAdd(d, { ...ed.m, lines });
}
function textCancel() {
  if (!state.text.ed) return;
  const ldr = state.text.ed.ldr;
  state.text.ed = null; ui.textEd.hidden = true; ui.textArea.blur();
  if (ldr && state.ldr) { state.ldr.pts = []; note('Leader cancelled'); }
  renderCommand(); renderEdit(); paintOverlay();
}

/** The text tool's click: on a text, change it; anywhere else, a new text there. */
function textToolDown(e) {
  const d = drawTarget();
  if (!d) return;
  if (textEditing()) { textCommit(); return; }                      // clicking away only ends the one being typed
  const p = textPick(d, e.clientX, e.clientY), hit = hitAt(d, toDrawing(d, e.clientX, e.clientY));
  if (hit >= 0 && TX.decode(d.raw.entities[hit]) && d.raw.entities[hit].layer !== Ed.DIM_LAYER) { textOpen(d, p, hit); return; }
  textOpen(d, p);
}
/** Double-click on a text with the Select tool: change it. */
function textDblClick(e) {
  const d = editable();
  if (!d || state.tool !== 'select' || state.setlen) return;
  const hit = hitAt(d, toDrawing(d, e.clientX, e.clientY));
  if (hit >= 0 && TX.decode(d.raw.entities[hit]) && d.raw.entities[hit].layer !== Ed.DIM_LAYER) textOpen(d, null, hit);
  else if (hit >= 0 && ldrPseudo(d, hit)) ldrEdit(d, hit, ldrPseudo(d, hit).model);
}

// -- the corner handles of a selected text: a corner drag scales the height
const textDrag = () => state.text.drag;
function textHandleDown(e) {
  const d = editable(), ts = d && (state.tool === 'select' || state.tool === 'text') && !textEditing() ? textSel(d) : null;
  if (!ts) return false;
  const r = ui.canvas.getBoundingClientRect();
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = toSheetPt(d, ts.box.corners[i]), px = (sx - view.ox) * view.scale + r.left, py = (sy - view.oy) * view.scale + r.top;
    if (Math.hypot(e.clientX - px, e.clientY - py) <= 9) { state.text.drag = { d, e: ts.e, m: ts.m, box: ts.box, i, next: null }; return true; }
  }
  return false;
}
function textDragMove(e) {
  const g = state.text.drag;
  if (!g) return;
  g.next = TX.scaleByCorner(g.m, g.box, g.i, toDrawing(g.d, e.clientX, e.clientY));
  g.cursor = [e.clientX, e.clientY];
  paintOverlay();
}
function textDragEnd(cancel) {
  const g = state.text.drag;
  state.text.drag = null;
  if (!g || cancel || !g.next || Math.abs(g.next.h - g.m.h) < 1e-9) { paintOverlay(); return; }
  const f = g.d.factor;
  textReplace(g.d, g.e, { ...g.m, ...g.next }, 'Text height');
  note(`Height ${fmt(g.m.h * f)} → ${fmt(g.next.h * f)}. Ctrl+Z takes it back`);
}

/** Overlay pieces for the selected text: its box, corner handles and tag; while a corner is dragged the scaled box, the hot handle and the readout. Returns the readout tip or null. */
function textOvl(d, out, k) {
  const g = state.text.drag, ts = textSel(d);
  if (!ts || textEditing()) return null;
  const poly = (pts) => pts.map((q) => q.map((v) => +v.toFixed(3)).join(',')).join(' ');
  const sh = ts.box.corners.map((c) => toSheetPt(d, c));
  out.push(s('polygon', { class: 'tx-box', points: poly(sh), 'data-testid': 'text-box' }));
  const m = ts.m;
  const tag = `${TX.kindOf(m)} · layer ${ts.ent.layer}`, tw = (tag.length * 6.6 + 12) * k, tl = sh[3];
  out.push(s('g', { class: 'tx-tag', 'data-testid': 'text-tag' }, s('rect', { x: tl[0], y: tl[1] - 22 * k, width: tw, height: 18 * k, rx: 3 * k }), s('text', { x: tl[0] + 6 * k, y: tl[1] - 9 * k, 'font-size': 11 * k }, tag)));
  sh.forEach((q, i) => out.push(s('rect', { class: 'tx-handle' + (g && g.i === i ? ' hot' : ''), x: q[0] - 5 * k, y: q[1] - 5 * k, width: 10 * k, height: 10 * k, 'data-handle': i, 'data-testid': 'text-handle-' + i })));
  if (g && g.next && g.e === ts.e) {
    const nm = { ...g.m, ...g.next }, nb = TX.textBox(nm, width100(nm.font, nm.bold)), ns = nb.corners.map((c) => toSheetPt(d, c)), f = d.factor;
    out.push(s('polygon', { class: 'tx-box tx-new', points: poly(ns) }));
    const b0 = toSheetPt(d, [nm.x, nm.y]), along = [ns[1][0] - ns[0][0], ns[1][1] - ns[0][1]];       // the baseline, as on the board
    out.push(s('path', { class: 'tx-base', d: `M${b0[0]} ${b0[1]}l${along[0]} ${along[1]}` }));
    out.push(s('rect', { class: 'tx-handle hot', x: ns[g.i][0] - 6 * k, y: ns[g.i][1] - 6 * k, width: 12 * k, height: 12 * k }));
    return { text: `Height ${fmt(g.m.h * f)} → ${fmt(g.next.h * f)}`, px: g.cursor };
  }
  return null;
}

// -- the top bar: Height, Font, Angle, Align, Bold (R5a Option A)
function buildTextbar() {
  const mk = (id, label, input, cls = 'lbl inline') => h('label', { class: cls }, label, input);
  ui.txKind = h('span', { class: 'lbl tlabel', 'data-testid': 'text-kind' });
  const field = (id, aria, apply) => {
    const input = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'aria-label': aria, 'data-testid': id });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } else if (e.key === 'Escape') { e.stopPropagation(); input.dataset.cancel = '1'; input.blur(); } });
    input.addEventListener('change', () => { if (input.dataset.cancel) { delete input.dataset.cancel; renderTextBar(); return; } const why = apply(input.value); renderTextBar(); if (why) note(why); });
    input.addEventListener('blur', () => { if (input.dataset.cancel) { delete input.dataset.cancel; renderTextBar(); } });
    return input;
  };
  ui.txH = field('text-height', 'Height in mm', textHeightTyped);
  ui.txAngle = field('text-angle', 'Angle in degrees', (v) => { const x = PL.parseAngle(v); if (x == null) return 'Angle: type degrees, like 30'; textProp({ angle: PL.normAngle(x) }); return null; });
  ui.txFont = select(TX.FONTS.map((f) => [f.id, f.label]), 'Standard', (v) => textProp({ font: v }), { 'data-testid': 'text-font', 'aria-label': 'Font' });
  ui.txAligns = TX.ALIGNS.map((a, i) => {
    const b = h('button', { class: 'ib', type: 'button', 'aria-label': a.label, title: a.label, 'aria-pressed': 'false', 'data-testid': 'text-align-' + a.name, onclick: () => textProp({ ha: i }) },
      icon(['<path d="M4 6h16M4 12h10M4 18h13"/>', '<path d="M4 6h16M7 12h10M5.5 18h13"/>', '<path d="M4 6h16M10 12h10M7 18h13"/>'][i], { size: 18, cap: 'round', join: 'round' }));
    return b;
  });
  ui.txBold = h('button', { class: 'ib bold', type: 'button', 'aria-label': 'Bold', title: 'Bold (saved as MTEXT with a bold font code)', 'aria-pressed': 'false', 'data-testid': 'text-bold', onclick: () => textProp({ bold: !textValues().bold }) }, 'B');
  ui.txLayer = h('span', { class: 'lbl', 'data-testid': 'text-layer' });
  return ui.textbar = h('div', { class: 'propbar textbar', hidden: true, 'data-testid': 'textbar' },
    h('strong', { class: 'name' }, 'Text'), ui.txKind,
    mk('h', 'Height', ui.txH), h('span', { class: 'lbl tmm' }, 'mm'), mk('f', 'Font', ui.txFont), mk('a', 'Angle', ui.txAngle),
    h('span', { class: 'vsep', 'aria-hidden': 'true' }), h('div', { class: 'row', role: 'group', 'aria-label': 'Alignment', style: 'gap:4px' }, ui.txAligns), ui.txBold,
    h('span', { class: 'vsep', 'aria-hidden': 'true' }), ui.txLayer);
}
/** The values the bar shows: the selected text's, else the next text's. */
function textValues() {
  const d = curDoc(), ts = d && textSel(d), c = state.text.cfg;
  if (ts) return { h: ts.m.h * d.factor, font: ts.m.font, angle: ts.m.angle, ha: ts.m.ha, bold: ts.m.bold, lines: ts.m.lines.length, layer: ts.ent.layer, sel: true };
  return { ...c, lines: 0, layer: d && d.raw ? curLayerName(d) : '0', sel: false };
}
function renderTextBar() {
  if (!ui.textbar) return;
  const v = textValues(), put = (input, val) => { if (document.activeElement !== input) input.value = val; };
  ui.txKind.textContent = v.sel ? `selected · ${v.lines} line${v.lines === 1 ? '' : 's'}` : 'new text';
  put(ui.txH, fmt(v.h)); put(ui.txAngle, fmt(v.angle) + '°');
  ui.txFont.value = v.font;
  ui.txAligns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === v.ha)));
  ui.txBold.setAttribute('aria-pressed', String(!!v.bold));
  ui.txLayer.textContent = 'Layer: ' + v.layer;
}
/** A typed height (mm) → the property, or what is wrong with it. */
function textHeightTyped(v) {
  const x = PL.parseMm(v);
  if (x == null || !(x > 0) || x > 100000) return 'Height must be a number above 0 (mm)';
  textProp({ h: x });
  return null;
}
/** A property from the bar or the command line: changes the selected text (one undo step), the one being typed, and is what the next text gets. patch: { h (mm), angle, font, ha, bold }. */
function textProp(patch) {
  const d = editable(), c = state.text.cfg, ts = d && textSel(d);
  const m = {};
  if (patch.h != null) m.h = patch.h;
  if (patch.angle != null) m.angle = patch.angle;
  if (patch.font) m.font = patch.font;
  if (patch.ha != null) m.ha = patch.ha;
  if (patch.bold != null) m.bold = !!patch.bold;
  for (const k of Object.keys(m)) c[k] = m[k];
  if (m.h != null || m.font || m.ha != null || m.bold != null) saveTextCfg();
  if (ts) {
    const label = m.h != null ? 'Text height' : m.angle != null ? 'Text angle' : m.font ? 'Text font' : m.ha != null ? 'Text align' : 'Text bold';
    const next = { ...ts.m };
    if (m.h != null) next.h = m.h / d.factor;
    if (m.angle != null) next.angle = m.angle;
    if (m.font) { next.font = m.font; next.styleName = m.font; }
    if (m.ha != null) next.ha = m.ha;
    if (m.bold != null) next.bold = m.bold;
    if (JSON.stringify(next) !== JSON.stringify(ts.m)) { textReplace(d, ts.e, next, label); note(`${label.replace('Text ', '')} changed on the selected text. Ctrl+Z takes it back`); }
  } else if (textEditing()) {
    const ed = state.text.ed;
    if (m.h != null) ed.m.h = m.h / d.factor;
    if (m.angle != null) ed.m.angle = m.angle;
    if (m.font) { ed.m.font = m.font; ed.m.styleName = m.font; }
    if (m.ha != null) ed.m.ha = m.ha;
    if (m.bold != null) ed.m.bold = m.bold;
    placeTextEditor();
  }
  state.msg = null; renderCommand(); renderTextBar();
  return null;
}
/** The command line while the Text tool is on: Height, Justify, Style, Bold, or a typed insertion point. */
function textTyped(raw) {
  const d = drawTarget();
  if (!d) return;
  const c = raw.trim().toLowerCase(), c0 = state.text.cfg;
  if (!c) return;
  let m = /^(?:height|h)\s+(\S+)$/.exec(c);
  if (m) { const why = textHeightTyped(m[1]); if (why) note(why); return; }
  m = /^(?:justify|j)?\s*(left|centre|center|right|l|c|r)$/.exec(c);
  if (m) { textProp({ ha: { left: 0, l: 0, centre: 1, center: 1, c: 1, right: 2, r: 2 }[m[1]] }); return; }
  m = /^(?:style|s)\s+(standard|arial|mono)$/.exec(c);
  if (m) { textProp({ font: { standard: 'Standard', arial: 'Arial', mono: 'Mono' }[m[1]] }); return; }
  if (c === 'bold' || c === 'b') { textProp({ bold: !c0.bold }); return; }
  const inp = DR.parseInput(raw);
  if (inp.kind === 'xy' && !inp.rel) { const f = d.factor; textOpen(d, [inp.x / f, inp.y / f]); return; }
  if (/^(height|justify|style)$/.test(c)) { note('Type it with a value: Height 12, Justify Centre, Style Mono'); return; }
  const cmd = CB.resolve(c, 'draw', ownCommands);
  if (cmd && cmd.name !== 'text') { runCommand(cmd); return; }
  note(`"${raw.trim()}" is not an option here. Click to place, or type x,y, Height 12, Left / Centre / Right, Style Mono, Bold`);
}
const textStatus = () => { const c = state.text.cfg, d = curDoc(); return `Command: TEXT   Height ${fmt(c.h)} · ${TX.FONTS.find((f) => f.id === c.font).label} · ${ALIGN_WORDS[c.ha]}${c.bold ? ' · Bold' : ''} · layer ${d && d.raw ? curLayerName(d) : '0'}`; };

// ---- polar and object-snap tracking (track.js; mock-up R7a, Option A) ----
const TRK_SAVED = 'pd-track';
function loadTrack() {
  try {
    const v = JSON.parse(localStorage.getItem(TRK_SAVED) || 'null');
    if (v && typeof v.polar === 'boolean') state.polar.on = v.polar;
    if (v && TK.INCREMENTS.includes(v.inc)) state.polar.inc = v.inc;
    if (v && typeof v.otrack === 'boolean') state.otrack = v.otrack;
  } catch { /* ignore */ }
}
const saveTrack = () => { try { localStorage.setItem(TRK_SAVED, JSON.stringify({ polar: state.polar.on, inc: state.polar.inc, otrack: state.otrack })); } catch { /* ignore */ } };
function chip(name, on) { const b = ui.tog[name]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
function polarSet(on) {
  state.polar.on = on; chip('POLAR', on);
  if (on && state.ortho) { state.ortho = false; chip('ORTHO', false); }          // POLAR and ORTHO turn each other off
  saveTrack(); paintOverlay();
  note(on ? `Polar on (${state.polar.inc}°)` : 'Polar off');
}
function otrackSet(on) {
  state.otrack = on; chip('OTRACK', on);
  if (!on) trackClear();
  saveTrack(); paintOverlay();
  note(on ? 'Object snap tracking on' : 'Object snap tracking off');
}
/** The hover ends (a click) and with it the lock it showed; the acquired points stay. */
function trackStop() { const t = state.trk; clearTimeout(t.timer); t.timer = 0; t.cand = null; t.res = null; }
/** The tool or grip action is over (or the tool changed): the acquired points go. */
function trackClear() { trackStop(); state.trk.acq = []; }
/** Hovering about 0.5 s on a snap point acquires it (a small +); hovering on an acquired point releases it. */
function trackWatch(d, q) {
  const t = state.trk, ok = state.otrack && q.length === 3 && TK.acquirable(q[2]);
  if (ok && t.cand && t.cand.x === q[0] && t.cand.y === q[1]) return;                // still on the same point: its timer runs (or it has fired)
  clearTimeout(t.timer); t.timer = 0; t.cand = null;
  if (!ok) return;
  const c = t.cand = { x: q[0], y: q[1], kind: q[2] };
  t.timer = setTimeout(() => { t.timer = 0; if (t.cand !== c || t.d !== d) return; t.acq = TK.toggleAcquired(t.acq, c, 1e-6); paintOverlay(); }, 500);
}
/**
 * POLAR and OTRACK for a pick: where the pointer p (drawing units) locks, or null. q is the snap under it (an object snap wins), base the
 * point the rubber band starts from (null: no polar), straight that Shift / ORTHO is keeping the pick straight (no tracking then).
 */
function trackPick(d, p, q, base, straight, hover) {
  const t = state.trk;
  if (t.d !== d) { trackClear(); t.d = d; }
  t.res = null;
  if (hover) trackWatch(d, q);
  if ((q.length === 3 && q[2] !== 'near') || straight) return null;
  const inc = state.polar.on && base ? state.polar.inc : 0;
  if (!inc && !(state.otrack && t.acq.length)) return null;
  t.res = TK.resolve({ p, base, inc, acq: state.otrack ? t.acq : [], tol: 8 / (view.scale * d.factor), step: 0.01 / d.factor, scale: d.factor });
  return t.res && t.res.q;
}
/** The dotted guides of the lock (tracking lines, the polar ray), the × where they meet, and a + on each acquired point. */
function trackOvl(d, out, k) {
  const t = state.trk, r = t.res;
  if (t.d !== d) return;
  const P = (x, y) => toSheetPt(d, [x, y]), FAR = 1e6, ray = (cls, x0, y0, x1, y1) => out.push(s('path', { class: cls, d: `M${x0} ${y0}L${x1} ${y1}` }));
  if (r) {
    for (const l of r.lines) { const [x, y] = P(l.x, l.y); if (l.h) ray('trk-line', -FAR, y, FAR, y); else ray('trk-line', x, -FAR, x, FAR); }
    if (r.ray) { const [bx, by] = P(...r.ray.base), a = r.ray.a * Math.PI / 180; ray('trk-line trk-polar', bx, by, bx + FAR * Math.cos(a), by - FAR * Math.sin(a)); }
    if (r.cross) { const [x, y] = P(...r.q), z = 7 * k; out.push(s('path', { class: 'trk-x', d: `M${x - z} ${y - z}l${2 * z} ${2 * z}M${x + z} ${y - z}l${-2 * z} ${2 * z}` })); }
  }
  for (const a of t.acq) { const [x, y] = P(a.x, a.y), z = 6 * k; out.push(s('path', { class: 'trk-plus', d: `M${x - z} ${y}h${2 * z}M${x} ${y - z}v${2 * z}` })); }
}

// ---- grips (grips.js; mock-up R5c, left pane): blue squares on a selected line, arc, circle or polyline to drag ----
/** Do grips show? On a drawing tab with the Select tool, something selected (not too many things), and no text handles in the way. */
const gripOn = (d) => !!d && !d.lay && !state.match && editable() === d && state.tool === 'select' && !state.setlen && !!d.sel && d.sel.size > 0 && d.sel.size <= GR.MAX_SELECTED && !textSel(d) && !textEditing();
/** Every grip of the selection: [{ e, id, kind, x, y }] (drawing units); kept while the selection and the drawing stay the same. */
function gripList(d) {
  const ents = d.raw.entities;
  if (d.gripCache && d.gripCache.sel === d.sel && d.gripCache.ents === ents) return d.gripCache.list;
  const list = [];
  for (const e of d.sel) {
    const ent = ents[e], lp = ent && ldrPseudo(d, e);
    if (lp) { for (const g of GR.gripsOf(lp)) { if (list.length < GR.MAX_GRIPS) list.push({ e, ...g }); } continue; }       // a leader: a grip at each point
    if (!ent || ent.layer === Ed.DIM_LAYER) continue;
    for (const g of GR.gripsOf(ent)) { if (list.length < GR.MAX_GRIPS) list.push({ e, ...g }); }
  }
  d.gripCache = { sel: d.sel, ents, list };
  return list;
}
const sheetPx = (d, p) => { const [sx, sy] = toSheetPt(d, p), r = ui.canvas.getBoundingClientRect(); return [(sx - view.ox) * view.scale + r.left, (sy - view.oy) * view.scale + r.top]; };
/** The grip under a pointer position (8 px), or null. */
function gripAt(d, cx, cy) {
  let best = null, bd = 8.5;
  for (const g of gripList(d)) { const [px, py] = sheetPx(d, [g.x, g.y]), dd = Math.hypot(cx - px, cy - py); if (dd <= bd) { bd = dd; best = g; } }
  return best;
}
/** The point under the pointer for a grip: the snaps (the 0.01 mm grid when free), and Shift / ORTHO along X or Y from where the rubber band starts. */
function gripPick(g, cx, cy, shift, hover) {
  const d = g.d, f = d.factor, p = toDrawing(d, cx, cy);
  let q = snapPoint(d, p);
  const ref = GR.refPoint(g.ent, g.id), base = ref && g.ent.type !== 'CIRCLE' && g.ent.type !== 'ARC' ? ref : null, straight = !!((shift || state.ortho) && base);
  const tq = trackPick(d, p, q, base, straight, hover);
  if (tq) return tq;
  if (q.length === 2) q = [Math.round(q[0] * f * 100) / 100 / f, Math.round(q[1] * f * 100) / 100 / f];
  if (straight) q = Ed.orthoLock(base, q);
  return q;
}
/** The grip's drag is now at q: what the shape becomes. */
function gripAim(g, q) {
  g.to = q;
  const r = GR.dragGrip(g.ent, g.id, [q[0], q[1]]);
  g.next = r ? r.ent : null; g.label = r ? r.label : null;
}
function gripDown(e) {
  const d = editable();
  if (!d) return false;
  const g0 = state.grip;
  if (g0 && g0.hot && g0.d === d) { gripAim(g0, gripPick(g0, e.clientX, e.clientY, e.shiftKey)); gripCommit(); return true; }       // the second click of click, then click
  if (!gripOn(d)) return false;
  const hit = gripAt(d, e.clientX, e.clientY);
  if (!hit) return false;
  state.grip = { d, e: hit.e, id: hit.id, ent: ldrPseudo(d, hit.e) || d.raw.entities[hit.e], next: null, to: null, label: null, hot: false, moved: false, px: [e.clientX, e.clientY], sel: new Set(d.sel) };
  state.msg = null; renderCommand(); paintOverlay();
  return true;
}
function gripMove(e) {
  const g = state.grip;
  if (!g || g.d !== curDoc()) return;
  if (!g.moved && !g.hot && Math.hypot(e.clientX - g.px[0], e.clientY - g.px[1]) < 4) return;
  g.moved = true; g.cursor = [e.clientX, e.clientY];
  gripAim(g, gripPick(g, e.clientX, e.clientY, e.shiftKey, true));
  paintOverlay();
}
function gripUp(e) {
  const g = state.grip;
  if (!g || g.hot) return;
  if (g.moved) { gripAim(g, gripPick(g, e.clientX, e.clientY, e.shiftKey)); gripCommit(); return; }
  g.hot = true; g.cursor = [e.clientX, e.clientY];                  // a click on the grip: it is hot until the next click puts it down
  renderCommand(); paintOverlay();
}
function gripCancel() { state.grip = null; trackClear(); renderCommand(); paintOverlay(); }
/** Puts the dragged grip down: one undo step, named for what it did; the selection stays. */
function gripCommit() {
  const g = state.grip;
  state.grip = null; trackClear();
  if (!g) return;
  if (!g.next) { note(g.to ? 'That would not change the shape (or leaves nothing of it), so it stays as it was' : 'Stretch cancelled'); renderCommand(); paintOverlay(); return; }
  const d = g.d, label = g.label, text = GR.readoutOf(g.ent, g.id, g.next, d.factor);
  view.fitted = false;
  commit(d, g.next.type === 'LEADER' ? LR.replace(d.raw, g.next.name, g.next.model) : { entities: d.raw.entities.map((x, i) => (i === g.e ? g.next : x)), blocks: d.raw.blocks }, label);
  setSel(d, g.sel);
  note(`${label}: ${text}. Ctrl+Z takes it back`);
}
/** Typed while a grip is dragged: x,y, @dx,dy (from where the grip was), @len<ang, or a length (the way the rubber band points; a circle's radius). */
function gripTyped(raw) {
  const g = state.grip, d = g && g.d;
  if (!g || !d) return;
  const f = d.factor, inp = DR.parseInput(raw);
  if (inp.kind === 'enter') { if (g.next) gripCommit(); else gripCancel(); return; }
  if (inp.kind === 'word') { if (inp.w === 'x' || inp.w === 'exit' || inp.w === 'esc') { gripCancel(); note('Stretch cancelled'); } else note(`"${inp.w}" is not an option here: type x,y, @dx,dy or a length, or press Esc`); return; }
  if (inp.kind === 'bad') { note(`I do not understand "${raw.trim()}". Type x,y, @dx,dy or a length`); return; }
  const grip = GR.gripsOf(g.ent).find((x) => x.id === g.id), origMm = [grip.x * f, grip.y * f], refMm = (() => { const r = GR.refPoint(g.ent, g.id); return [r[0] * f, r[1] * f]; })();
  let mm = null;
  if (inp.kind === 'len') {
    const hover = g.to ? [g.to[0] * f, g.to[1] * f] : null;
    mm = DR.directDistance(refMm, hover, inp.v) || (g.ent.type === 'CIRCLE' && g.id.startsWith('q') ? [refMm[0] + inp.v, refMm[1]] : null);
    if (!mm) { note('Move the pointer the way you want it to go, then type the length'); return; }
  } else mm = DR.typedPoint(inp, origMm);
  gripAim(g, [mm[0] / f, mm[1] / f]);
  gripCommit();
}
/** Grips, and while one is dragged: the original as a dashed ghost, the new shape dashed, the hot grip, and the readout. Returns the readout tip or null. */
function gripOvl(d, out, k) {
  const g = state.grip;
  const square = (p, hot, id) => {
    const [sx, sy] = toSheetPt(d, p), z = (hot ? 12 : 10) * k;
    const sq = s('rect', { class: 'gr' + (hot ? ' hot' : ''), x: sx - z / 2, y: sy - z / 2, width: z, height: z, 'data-grip': id, 'data-testid': hot ? 'grip-hot' : 'grip' });
    if (!hot) return sq;
    const t = 14 * k, u = 8 * k;
    return s('g', null, sq, s('path', { class: 'gr-tick', d: `M${sx} ${sy - t}v${-u}M${sx} ${sy + t}v${u}M${sx - t} ${sy}h${-u}M${sx + t} ${sy}h${u}` }));
  };
  if (g && g.d === d) {
    const ghost = GR.shapeOf(g.ent, d.factor);
    if (ghost) out.push(s('path', { class: 'gr-ghost', d: DR.svgPath(ghost, state.sheetH) }));
    if (g.next) {
      const nw = GR.shapeOf(g.next, d.factor);
      if (nw) out.push(s('path', { class: 'gr-new', d: DR.svgPath(nw, state.sheetH), 'data-testid': 'grip-preview' }));
    }
    const live = g.next ? GR.gripsOf(g.next) : GR.gripsOf(g.ent), hotG = live.find((x) => x.id === g.id);
    for (const x of live) if (x.id !== g.id) out.push(square([x.x, x.y], false, x.id));
    if (hotG) out.push(square([hotG.x, hotG.y], true, g.id));
    if (g.next && g.to) { return { text: GR.readoutOf(g.ent, g.id, g.next, d.factor), px: g.cursor || sheetPx(d, [g.to[0], g.to[1]]) }; }
    return null;
  }
  if (!gripOn(d)) return null;
  const list = gripList(d);
  for (const e of d.sel) {                                          // an arc's spokes: the centre to each end
    const ent = d.raw.entities[e];
    if (ent && ent.type === 'ARC' && GR.hasGrips(ent)) {
      const gs = GR.gripsOf(ent), c = gs.find((x) => x.id === 'c'), a = gs.find((x) => x.id === 'a'), b = gs.find((x) => x.id === 'b'), P = (q) => toSheetPt(d, [q.x, q.y]).join(' ');
      out.push(s('path', { class: 'gr-spoke', d: `M${P(a)}L${P(c)}L${P(b)}` }));
    }
  }
  for (const x of list) {
    out.push(square([x.x, x.y], false, x.e + ':' + x.id));
    if (x.kind === 'centre') { const [sx, sy] = toSheetPt(d, [x.x, x.y]), z = 12 * k; out.push(s('path', { class: 'gr-cross', d: `M${sx - z} ${sy}h${2 * z}M${sx} ${sy - z}v${2 * z}` })); }
  }
  return null;
}
/** Keys on a layout tab: undo / redo, and for the selected placed part Delete, Ctrl+D and the arrow keys. → true when the key was used. */
function layoutKey(e, mod, k) {
  if (!curLay()) return false;
  if (sheetSelOn() && !(mod && !e.altKey && (k === 'z' || k === 'y'))) return false;      // the sheet is selected: the arrow keys and Delete are not for the part behind it
  if (mod && !e.altKey && k === 'z') { e.preventDefault(); if (e.shiftKey) redoLay(); else undoLay(); return true; }
  if (mod && !e.altKey && !e.shiftKey && k === 'y') { e.preventDefault(); redoLay(); return true; }
  if (!selectedPlaced()) return false;
  if (mod && !e.altKey && !e.shiftKey && k === 'd') { e.preventDefault(); duplicateOne(); return true; }
  if (e.key === 'Delete' && !mod) { e.preventDefault(); deletePlaced(); return true; }
  const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
  if (dir && !mod && !e.altKey) { e.preventDefault(); nudgeSel(dir, e.shiftKey); return true; }
  return false;
}

/** Ctrl+A / Edit → Select all: a drawing's visible entities (the layers switched off are left out), a layout's placed parts. */
function selectAll() {
  const lay = curLay(), d = editable();
  if (lay) {
    const idxs = placedNow.map((_, i) => i).filter((i) => !partHid(placedNow[i]));
    if (!idxs.length) { note('Nothing to select: no parts on the sheet'); return; }
    if (sheetSelOn()) selectSheet(false);
    selectMany(idxs);
    update(); note(`${idxs.length} part${idxs.length === 1 ? '' : 's'} selected`);
  } else if (d) {
    if (drawLive() && DR.toolBusy(state.draw)) return;
    const all = edIndex(d).shown.filter((e) => !lockedEnt(d, e));       // a locked layer cannot be picked, so Ctrl+A + Delete cannot reach it
    if (!all.length) { note('Nothing to select'); return; }
    setSel(d, new Set(all)); note(`${all.length} entit${all.length === 1 ? 'y' : 'ies'} selected`);
  }
}

function editKey(e) {
  if (document.querySelector('[data-testid=pdf-dialog]')) return;
  if ((e.key === 'F10' || e.key === 'F11') && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); if (e.key === 'F10') polarSet(!state.polar.on); else otrackSet(!state.otrack); return; }
  if (e.key === 'F2' && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); ui.cmdUI.toggleHistory(); return; }
  const d = editable();
  if (e.key === 'Escape') {
    if (e.target !== ui.cmd && e.target && e.target.closest && e.target.closest('input, textarea, select')) return;       // Esc in a field only cancels the typing (the command bar's own input handles its Esc)
    const wasOn = !!activeCmd(), shut = ui.cmdUI.escape();                 // Esc shuts the bar (and the history); a command that is on is cancelled too
    if (shut === 'drawer' || (shut === 'bar' && !wasOn)) return;
    if (gdrag) cancelGuideDrag();
    else if (state.sheetDrag) sheetCancel();
    else if (sheetSelOn() && !pdrag) selectSheet(false);
    else if (curLay() && pdrag) cancelPlacedDrag();
    else if (curLay() && multiSel() && !state.setlen) { selectMany(groupIdxs(state.sel), state.sel); update(); note('Selection: just the main part'); }
    else if (curLay() && state.mode === 'rotate') { state.mode = 'select'; state.rotCopy = false; update(); note('Rotate done'); }
    else if (state.match) endMatch();
    else if (state.setlen) cancelSetlen();
    else if (state.balDrag) { state.balDrag = null; note('Move cancelled'); paintOverlay(); }
    else if (state.grip) { gripCancel(); note('Stretch cancelled'); }
    else if (state.text.drag) { textDragEnd(true); note('Resize cancelled'); }
    else if (modLive()) modEsc(d);
    else if (state.tool === 'text' && d && !textEditing()) { if (d.sel.size) setSel(d, new Set()); else setTool('select'); }
    else if (drawLive()) { if (DR.toolBusy(state.draw) || state.draw.stage === 'radius') { state.msg = null; drawFinish(); } else setTool('select'); }
    else if (state.dimDrag) { state.dimDrag.cancelled = true; state.dimDrag = null; note('Move cancelled'); paintOverlay(); }
    else if (state.dim && dimBusy(state.dim)) { dimClear(state.dim); note('Dimension cancelled. ' + dimPrompt()); paintOverlay(); }
    else if (state.ldr && state.ldr.pts.length) { state.ldr.pts = []; state.ldr.hover = null; note('Leader cancelled. ' + ldrPrompt()); paintOverlay(); }
    else if (state.bal && state.bal.tip) { state.bal.tip = null; note('Balloon cancelled. ' + balPrompt()); paintOverlay(); }
    else if (state.meas && state.meas.pts.length) { state.meas.pts = []; note('Measure cleared'); paintOverlay(); }
    else if (state.tool === 'dimension' || state.tool === 'leader' || state.tool === 'measure' || state.tool === 'balloon') setTool('select');       // nothing in progress: back to Select
    else if (state.tool === 'contour' && !(d && d.sel.size)) setTool('select');
    else if (d && state.balSel != null) balSelect(d, null);
    else if (d && d.sel.size) setSel(d, new Set());
    return;
  }
  const key = SC.eventKey(e), own = ownCommands.find((c) => c.key && c.key === key && !SC.fixedKey(c.name));
  const inField = e.target && e.target.closest && e.target.closest('input, textarea, select');
  if (own && (!inField || own.name === 'properties')) { e.preventDefault(); runCommand(own); return; }       // Properties' key works in a field too, as Ctrl+1 always did
  if (inField) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  const dialog = !!document.querySelector('.pop-back, .pdlg-back'), seed = CB.keyOpensBar(e, { dialog, active: !!activeCmd() });
  if (seed != null) { e.preventDefault(); ui.cmdUI.open(seed); return; }       // a letter or digit typed on the drawing starts the command bar
  if (cmpKey(e, mod)) return;
  if (!mod && !e.altKey && drawKey(e, k)) return;
  if (e.key === ' ' && !mod && !e.altKey && !e.shiftKey && !dialog && !activeCmd() && !(e.target.closest && e.target.closest('button, a'))) { e.preventDefault(); ui.cmdUI.repeat(); return; }       // Space is Enter: the last command again
  if (layoutKey(e, mod, k)) return;
  if (!d) return;
  if (e.key === 'Enter' && state.meas && state.meas.pts.length === 2) { e.preventDefault(); keepMeasure(); return; }
  if (e.key === 'Enter' && state.ldr && state.ldr.pts.length === 2) { e.preventDefault(); ldrNoteOpen(d); return; }
  if (modLive() && e.key === 'Enter') { e.preventDefault(); modEnter(d); return; }
  if (e.key === 'Delete' && !mod) { e.preventDefault(); deleteSelection(); }
  else if (mod && !e.altKey && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(d); else undo(d); }
  else if (mod && !e.altKey && k === 'y') { e.preventDefault(); redo(d); }
}

function buildDrawingSection() {
  ui.bgName = h('span', { class: 'lbl bgname', 'data-testid': 'bg-name' });
  ui.bgX = h('button', { class: 'tog', type: 'button', 'aria-label': 'Remove the background', 'data-testid': 'bg-remove', onclick: removeBackground }, '×');
  ui.scaleTarget = h('select', { class: 'fld', 'aria-label': 'Size and Set length act on', 'data-testid': 'scale-target' }, h('option', { value: 'drawing' }, 'Drawing'), h('option', { value: 'bg' }, 'Background'));
  ui.scaleTarget.addEventListener('change', () => { const d = curDoc(); if (d) { d.scaleTarget = ui.scaleTarget.value; renderEdit(); } });
  ui.bgRow = h('div', { class: 'bgrow' }, h('button', { class: 'btn sm', type: 'button', 'data-testid': 'bg-import', onclick: () => ui.bgPicker.click() }, 'Background…'), ui.bgName, ui.bgX);
  const useBtn = h('button', { class: 'btn sm primary', type: 'button', 'data-testid': 'add-to-layout', title: 'Put this drawing on a layout (the open layout tab, or a new one)', onclick: addToLayout }, 'Add to layout');
  const size = (label, id, axis) => {
    const input = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', 'data-testid': id, 'aria-label': label + ' in mm' });
    input.addEventListener('change', () => sizeTyped(input, axis));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    ui[id] = input;
    return h('label', { class: 'field' }, label, input);
  };
  const btn = (text, id, fn, cls = 'btn sm') => { const b = h('button', { class: cls, type: 'button', 'data-testid': id, onclick: fn }, text); ui[id] = b; return b; };
  ui.selCount = h('span', { class: 'lbl', 'data-testid': 'sel-count' });
  ui.selRow = h('div', { class: 'selrow', 'data-testid': 'selrow', hidden: true }, ui.selCount, btn('Keep only this', 'keep-only', keepSelection, 'btn sm primary'), btn('Delete', 'delete', deleteSelection));
  ui.dimH = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', 'data-testid': 'dim-height', 'aria-label': 'Dimension text height in mm' });
  ui.dimH.addEventListener('change', dimHeightTyped);
  ui.dimH.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.dimH.blur(); });
  ui.dimReset = h('button', { class: 'linkbtn', type: 'button', 'data-testid': 'dim-reset', title: 'Back to the text height of the dimension style', onclick: dimHeightReset }, 'Reset');
  ui.dimRow = h('div', { class: 'dimrow', 'data-testid': 'dim-row', hidden: true }, h('span', { class: 'lbl' }, 'Dimension · text height'), ui.dimH, h('span', { class: 'lbl' }, 'mm'), ui.dimReset);
  const ldrField = (tid, label) => h('input', { class: 'fld', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'data-testid': tid, 'aria-label': label });
  ui.ldrNote = ldrField('ldr-note', 'Leader note'); ui.ldrH = ldrField('ldr-height', 'Leader text height in mm'); ui.ldrA = ldrField('ldr-arrow', 'Leader arrow size in mm');
  for (const [i, which] of [[ui.ldrNote, 'note'], [ui.ldrH, 'h'], [ui.ldrA, 'a']]) { i.addEventListener('change', () => ldrFieldTyped(which)); i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); }); }
  ui.ldrStyle = h('span', { class: 'lbl', 'data-testid': 'ldr-style' });
  ui.ldrRow = h('div', { class: 'ldrrow', 'data-testid': 'ldr-row', hidden: true },
    h('span', { class: 'row' }, h('span', { class: 'chip' }, 'Leader'), h('span', { class: 'lbl' }, 'selected')), h('label', { class: 'field' }, 'Note', ui.ldrNote),
    h('div', { class: 'ldrgrid' }, h('label', { class: 'field' }, 'Text height (mm)', ui.ldrH), h('label', { class: 'field' }, 'Arrow size (mm)', ui.ldrA)), ui.ldrStyle);
  ui.gapCount = h('span', { class: 'lbl', 'data-testid': 'gap-count' });
  ui.gapTol = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', 'data-testid': 'gap-tol', 'aria-label': 'Tiny gap tolerance in mm' });
  ui.gapTol.addEventListener('change', gapTolTyped);
  ui.gapTol.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.gapTol.blur(); });
  ui.gapShow = h('button', { class: 'tog', type: 'button', 'data-testid': 'gap-show', title: 'Mark the gaps on the drawing', onclick: () => { state.gapShow = !state.gapShow; paintOverlay(); renderEdit(); } }, 'Show');
  ui.gapJoin = h('button', { class: 'btn sm', type: 'button', 'data-testid': 'gap-join', title: 'Move the ends of each gap together, to the middle between them (one undo step)', onclick: joinTinyGaps }, 'Join');
  ui.gapRow = h('div', { class: 'gaprow2', 'data-testid': 'gap-row' }, h('span', { class: 'lbl', title: 'Ends that almost meet, closer than the tolerance' }, 'Tiny gaps'), ui.gapCount, h('span', { class: 'lbl' }, '<'), ui.gapTol, h('span', { class: 'lbl' }, 'mm'), ui.gapShow, ui.gapJoin);
  ui.duplicateCount = h('span', { class: 'lbl', 'data-testid': 'duplicate-count' });
  ui.duplicateRemove = h('button', { class: 'btn sm', type: 'button', 'data-testid': 'duplicate-remove', onclick: removeDuplicates }, 'Remove duplicates…');
  ui.realLen = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', 'data-testid': 'real-length', 'aria-label': 'Real length in mm', placeholder: 'real length, mm' });
  ui.realLen.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyLength(); } });
  ui.measured = h('span', { class: 'lbl mono', 'data-testid': 'measured' });
  ui.lenRow = h('div', { class: 'lenrow', 'data-testid': 'len-row', hidden: true }, ui.measured, ui.realLen,
    h('div', { class: 'btnrow' }, btn('Scale', 'real-ok', applyLength, 'btn sm primary'), btn('Cancel', 'real-cancel', cancelSetlen)));
  const tog = (text, id, fn, title) => { const b = h('button', { class: 'tog', type: 'button', 'data-testid': id, title, onclick: fn }, text); ui[id] = b; return b; };
  ui.drawSec = h('section', { class: 'drawbox', hidden: true, 'data-testid': 'drawing-panel' },
    h('div', { class: 'layers-head' }, h('h2', { class: 'sec' }, 'Drawing scale'),
      h('span', { class: 'tools' },
        tog('Undo', 'undo', () => { const d = editable(); if (d) undo(d); }, 'Undo (Ctrl+Z)'),
        tog('Redo', 'redo', () => { const d = editable(); if (d) redo(d); }, 'Redo (Ctrl+Y)'))),
    h('div', { class: 'unitrow' },
      tog('Set length', 'set-length', startSetlen, 'Click two points, then type the real distance between them'),
      tog('×25.4', 'unit-up', () => unitFix(UF.UNIT_FIXES.up), ''),
      tog('÷25.4', 'unit-down', () => unitFix(UF.UNIT_FIXES.down), '')),
    h('span', { class: 'lbl' }, 'Make the whole drawing 1:1 once. Every part extracted from it is true size.'),
    ui.selRow, ui.dimRow, ui.ldrRow, ui.gapRow,
    h('div', { class: 'row' }, ui.duplicateRemove, ui.duplicateCount),
    h('div', { class: 'lbl sizelbl', title: 'The part itself, without kept dimensions. Set length and a typed size scale the drawing by it' }, 'Whole drawing'),
    h('div', { class: 'grid2' }, size('Width mm', 'dw', 'w'), size('Height mm', 'dh', 'h')),
    ui.scaleTarget, ui.bgRow, ui.lenRow, useBtn);
  ui.outList = h('div', { class: 'outlist', 'data-testid': 'outlines' });
  ui.outSec = h('section', { class: 'outbox', hidden: true, 'data-testid': 'outlines-panel' },
    h('h2', { class: 'sec' }, 'Outlines in this drawing'), ui.outList,
    btn('Extract part…', 'extract', extractPart, 'btn primary'),
    h('span', { class: 'lbl' }, 'Click an outline in the drawing, then Extract part…, or right-click it.'));
  return h('div', { class: 'contents' }, buildPropsSection(), ...buildBalloonPanel(), ui.drawSec, ui.outSec);
}

// ---- Sheet resize (TODO 23; mock-up R5c, right pane): select the sheet, drag a side handle, whole mm; the parts stay exactly where they are ----
// Selecting: the Select sheet button, or a click on the sheet's edge. Four square handles at the middle of the sides. A drag (or a click on a handle, then a click
// at the new place) shows the new outline dashed, the strip that is added tinted, and "W 1060 × H 700 mm" beside the handle; Esc cancels. One undo step.
// The origin (0,0) is the sheet's bottom-left. The right and top sides only change the size. Dragging the left or bottom side keeps the parts where they are
// *on the screen*: their sheet positions (and the guides) move by the change, so nothing lies in a different place relative to the other parts.
const SHEET_MIN = 1, SHEET_MAX = 20000;
const sheetSelOn = () => { const lay = curLay(); return !!lay && state.sheetSel === lay; };
const SHEET_SIDES = ['top', 'right', 'bottom', 'left'];
function selectSheet(on = true) {
  state.sheetSel = on && curLay() ? curLay() : null;
  state.sheetDrag = null;
  drawTools(); drawSheetSel(); renderCommand();
  if (on && state.sheetSel) note(`Sheet ${state.sheetW} × ${state.sheetH} mm selected. Drag a side handle to resize`);
}
function sheetEdgeNear(e) {
  const [x, y] = sheetAt(e.clientX, e.clientY), W = state.sheetW, H = state.sheetH, tol = 6 / view.scale;
  return x >= -tol && x <= W + tol && y >= -tol && y <= H + tol && (Math.abs(x) <= tol || Math.abs(x - W) <= tol || Math.abs(y) <= tol || Math.abs(y - H) <= tol);
}
/** A press on the layout canvas: a sheet handle starts (or, when one is waiting for its second click, ends) a resize; the sheet's edge selects the sheet. True when it took the press. */
function sheetDown(e) {
  const lay = curLay();
  if (!lay || (state.tool !== 'select' && state.tool !== 'step') || state.setlen) return false;
  if (state.sheetDrag && state.sheetDrag.hot) { sheetMove(e, true); sheetCommit(); return true; }
  const t = e.target && e.target.closest ? e.target : null;
  const hd = t && t.closest('[data-sheet-handle]');
  if (hd && sheetSelOn()) {
    state.sheetDrag = { side: hd.dataset.sheetHandle, p0: sheetAt(e.clientX, e.clientY), cx: e.clientX, cy: e.clientY, W: state.sheetW, H: state.sheetH, newW: state.sheetW, newH: state.sheetH, hot: false, moved: false };
    drawSheetSel();
    return true;
  }
  if (t && t.closest('.ruler, [data-guide], [data-i], [data-rot], [data-pivot], [data-gap]')) { if (sheetSelOn()) selectSheet(false); return false; }
  if (sheetEdgeNear(e)) { selectSheet(true); return true; }
  if (sheetSelOn()) selectSheet(false);
  return false;
}
function sheetMove(e, force = false) {
  const g = state.sheetDrag;
  if (!g) return;
  if (!g.moved && !g.hot && !force) { if (Math.hypot(e.clientX - g.cx, e.clientY - g.cy) <= 4) return; g.moved = true; }
  if (!g.moved && !g.hot) return;
  const p = sheetAt(e.clientX, e.clientY), cl = (v) => Math.max(SHEET_MIN, Math.min(SHEET_MAX, Math.round(v)));      // the side goes where the pointer is
  g.newW = g.side === 'right' ? cl(p[0]) : g.side === 'left' ? cl(g.W - p[0]) : g.W;
  g.newH = g.side === 'top' ? cl(p[1]) : g.side === 'bottom' ? cl(g.H - p[1]) : g.H;
  drawSheetSel(); renderCommand();
}
function sheetUp() {
  const g = state.sheetDrag;
  if (!g) return;
  if (g.moved) { sheetCommit(); return; }
  g.hot = true;                                                       // a click on the handle: the next click puts the side down
  drawSheetSel(); renderCommand();
  note('Sheet resize: click the new place, or Esc');
}
function sheetCancel() { if (!state.sheetDrag) return; state.sheetDrag = null; drawSheetSel(); renderCommand(); note('Sheet resize cancelled'); }
function sheetCommit() {
  const g = state.sheetDrag;
  state.sheetDrag = null;
  if (!g) return;
  if (g.newW === g.W && g.newH === g.H) { drawSheetSel(); renderCommand(); note('Sheet size unchanged'); return; }
  resizeSheet(g.side, g.newW, g.newH);
}
/** Gives the open layout this sheet size (whole mm) as one undo step; side says which side moved (left / bottom keep the parts where they are on the screen). */
function resizeSheet(side, newW, newH) {
  const d = curDoc(), lay = d && d.lay;
  if (!lay) return;
  const oldW = lay.s.sheetW, oldH = lay.s.sheetH, dx = side === 'left' ? newW - oldW : 0, dy = side === 'bottom' ? newH - oldH : 0;
  pushLay(d, laySnap(lay), '', `Sheet ${newW} × ${newH} mm`);
  lay.s.sheetW = newW; lay.s.sheetH = newH;
  if (dx || dy) {
    lay.placed = lay.placed.map((p) => ({ ...p, x: PL.r6(p.x + dx), y: PL.r6(p.y + dy) }));
    lay.s.guides = lay.s.guides.map((g) => (g.axis === 'x' ? { ...g, mm: PL.r6(g.mm + dx) } : { ...g, mm: PL.r6(g.mm + dy) }));
  }
  touch();
  const fitted = view.fitted;
  if (!fitted) { if (side === 'top') view.oy += newH - oldH; if (side === 'left') view.ox += dx; }
  syncFields();
  if (!fitted) applyView();
  update(fitted);
  const off = placedNow.filter((p) => p.off).length;
  note(`Sheet ${newW} × ${newH} mm. The parts stayed where they were` + (off ? `; ${off} now ${off === 1 ? 'is' : 'are'} off the sheet (drawn in orange)` : '') + '. Ctrl+Z takes it back');
}
/** The sheet's own marks when it is selected: the outline, four handles, where 0,0 is, and (while one is dragged) the new outline, the added strip and the size. */
function drawSheetSel() {
  const g = ui.gSheetSel;
  if (!g) return;
  if (ui.sheetSelBtn) { ui.sheetSelBtn.classList.toggle('on', sheetSelOn()); ui.sheetSelBtn.setAttribute('aria-pressed', String(sheetSelOn())); }
  if (!sheetSelOn()) { g.replaceChildren(); return; }
  const W = state.sheetW, H = state.sheetH, k = 1 / view.scale, dr = state.sheetDrag && (state.sheetDrag.moved || state.sheetDrag.hot) ? state.sheetDrag : null, out = [];
  if (dr) {
    const x0 = dr.side === 'left' ? W - dr.newW : 0, x1 = dr.side === 'left' ? W : dr.newW, y0 = dr.side === 'top' ? H - dr.newH : 0, y1 = dr.side === 'bottom' ? dr.newH : H;
    const strip = dr.side === 'right' && dr.newW > W ? [W, 0, dr.newW, H] : dr.side === 'left' && dr.newW > W ? [x0, 0, 0, H] : dr.side === 'top' && dr.newH > H ? [0, y0, W, 0] : dr.side === 'bottom' && dr.newH > H ? [0, H, W, dr.newH] : null;
    if (strip) out.push(s('rect', { class: 'ssel-add', x: strip[0], y: strip[1], width: strip[2] - strip[0], height: strip[3] - strip[1] }));
    out.push(s('rect', { class: 'ssel-new', 'data-testid': 'sheet-preview', x: x0, y: y0, width: x1 - x0, height: y1 - y0 }));
  }
  out.push(s('rect', { class: 'ssel-outline', x: 0, y: 0, width: W, height: H }));
  out.push(s('text', { class: 'ssel-label', 'data-testid': 'sheet-label', x: 0, y: -10 * k, 'font-size': 12 * k }, `Sheet selected · ${W} × ${H} mm`));
  const at = { top: [W / 2, 0], bottom: [W / 2, H], left: [0, H / 2], right: [W, H / 2] };
  if (dr) at[dr.side] = { right: [dr.newW, H / 2], left: [W - dr.newW, H / 2], top: [W / 2, H - dr.newH], bottom: [W / 2, dr.newH] }[dr.side];      // the dragged handle is on the new edge
  for (const side of SHEET_SIDES) {
    const hot = !!dr && dr.side === side, [hx, hy] = at[side], z = (hot ? 14 : 12) * k;
    out.push(s('g', { 'data-sheet-handle': side, 'data-testid': hot ? 'sheet-handle-hot' : 'sheet-handle', class: 'ssel-hg' + (hot ? ' hot' : '') },
      s('rect', { class: 'ssel-hit', x: hx - 11 * k, y: hy - 11 * k, width: 22 * k, height: 22 * k }), s('rect', { class: 'ssel-h', x: hx - z / 2, y: hy - z / 2, width: z, height: z })));
  }
  out.push(s('path', { class: 'ssel-origin', d: `M${-9 * k} ${H}h${18 * k}M0 ${H - 9 * k}v${18 * k}` }));
  out.push(s('text', { class: 'ssel-note', x: 10 * k, y: H + 18 * k, 'font-size': 12 * k }, '0,0 parts stay here'));
  if (dr) {
    const hp = at[dr.side], pw = 170 * k, ph = 24 * k;
    const px = dr.side === 'right' ? hp[0] - pw - 22 * k : dr.side === 'left' ? hp[0] + 22 * k : hp[0] - pw / 2, py = dr.side === 'top' ? hp[1] + 22 * k : dr.side === 'bottom' ? hp[1] - ph - 22 * k : hp[1] - ph / 2;
    out.push(s('text', { class: 'ssel-whole', x: px, y: py - 8 * k, 'font-size': 12 * k }, 'Whole mm only'),
      s('rect', { class: 'ssel-pill', x: px, y: py, width: pw, height: ph, rx: 4 * k }),
      s('text', { class: 'ssel-pilltext', 'data-testid': 'sheet-readout', x: px + pw / 2, y: py + 16.5 * k, 'text-anchor': 'middle', 'font-size': 13 * k }, `W ${dr.newW} × H ${dr.newH} mm`));
  }
  g.replaceChildren(...out);
}

// ---- Properties (TODO 24, 25; mock-up R5b, Option B): a section at the top of the Drawing panel, switched on from View → Properties (Ctrl+1) ----
// Layer, colour and line type of what is selected, its geometry (length, radius, centre, text height …), Select similar and Match properties.
// A value the selected shapes do not share shows "*varies*"; typing into it sets it on all of them. One undo step per change.
const PROPS_SAVED = 'pd-props';
const VARIES = '*varies*';
/** [index, entity] of the selection without kept dimensions (a dimension has its own text-height field). */
function propEnts(d, all = false) {
  const out = [];
  for (const e of d.sel) { const ent = d.raw.entities[e]; if (ent && (all || ent.layer !== Ed.DIM_LAYER)) out.push([e, ent]); }
  return out;
}
/** The layers to pick from: the file's, and the ones the selection is on (not the kept-dimensions layer). */
function propLayers(d, pe) {
  const names = new Set([...Object.keys(d.raw.layers || {}), ...d.fl.layers.map((l) => l.name), ...pe.map((x) => x[1].layer)]);
  names.delete(Ed.DIM_LAYER);
  return [...names].sort((a, b) => a.localeCompare(b));
}
function colourCss(key) {
  if (key.startsWith('tc:')) return '#' + (Number(key.slice(3)) & 0xffffff).toString(16).padStart(6, '0');
  if (key.startsWith('aci:')) return Number(key.slice(4)) === 7 ? 'var(--text)' : ACI[Number(key.slice(4))] || 'var(--text)';
  return 'transparent';
}
const layerMap = (d) => d.raw.layers || {};

function buildPropsSection() {
  const row = (label, ...kids) => h('label', { class: 'proprow' }, h('span', { class: 'lbl' }, label), ...kids);
  ui.propChip = h('span', { class: 'chip', 'data-testid': 'prop-chip' });
  ui.propLayer = h('select', { class: 'fld', 'aria-label': 'Layer', 'data-testid': 'prop-layer' });
  ui.propColour = h('select', { class: 'fld', 'aria-label': 'Colour', 'data-testid': 'prop-colour' });
  ui.propLt = h('select', { class: 'fld', 'aria-label': 'Line type', 'data-testid': 'prop-lt' });
  ui.propSwatch = h('span', { class: 'cswatch', 'aria-hidden': 'true', 'data-testid': 'prop-swatch' });
  ui.propLayer.addEventListener('change', () => propSet('layer', ui.propLayer.value));
  ui.propColour.addEventListener('change', () => propSet('colour', ui.propColour.value));
  ui.propLt.addEventListener('change', () => propSet('lt', ui.propLt.value));
  ui.propWidthUnits = h('span', { class: 'lbl' });
  ui.propWidthHint = h('span', { class: 'lbl' });
  ui.propWidthInput = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Custom outline width in mm', 'data-testid': 'prop-width-custom' });
  ui.propWidthInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); ui.propWidthInput.blur(); }
    else if (e.key === 'Escape') { ui.propWidthInput.dataset.cancel = '1'; ui.propWidthInput.blur(); }
  });
  ui.propWidthInput.addEventListener('change', () => {
    if (!ui.propWidthInput.dataset.cancel) propWidthSet(PL.parseMm(ui.propWidthInput.value));
  });
  ui.propWidthInput.addEventListener('blur', () => { delete ui.propWidthInput.dataset.cancel; renderEdit(); });
  ui.propWidthPresets = h('div', { class: 'widthpresets', role: 'group', 'aria-label': 'Outline width presets' },
    PR.WIDTHS.map((value) => h('button', { class: 'btn', type: 'button', 'data-width': String(value), 'aria-pressed': 'false', onclick: () => propWidthSet(value) }, typeof value === 'number' ? fmt(value) : value)));
  ui.propWidth = h('div', { class: 'widthbox', 'data-testid': 'prop-width' },
    h('div', { class: 'proprow widthhead' }, h('b', {}, 'Outline width'), ui.propWidthHint), ui.propWidthPresets,
    h('label', { class: 'proprow' }, h('span', { class: 'lbl' }, 'Custom'), ui.propWidthInput, ui.propWidthUnits),
    h('p', { class: 'lbl widthnote' }, 'True width on screen · scales with zoom'));
  ui.propGeo = h('div', { class: 'propgeo', 'data-testid': 'prop-geo' });
  ui.propSimilar = h('button', { class: 'btn', type: 'button', 'data-testid': 'prop-similar', title: 'Select every shape like the first one selected', onclick: (e) => selectSimilarMenu(e.currentTarget) }, 'Select similar ▾');
  ui.propMatch = h('button', { class: 'btn', type: 'button', 'data-testid': 'prop-match', title: 'Copy layer, colour and line type from the first selected shape to the shapes you click', onclick: startMatch },
    icon('<path d="M14 4l6 6-7 7-6-6z"/><path d="M7 11c-2 2-2 6-4 9 4 0 7 0 9-3"/>', { size: 16, join: 'round', cap: 'round' }), ' Match');
  ui.propEmpty = h('div', { class: 'lbl', 'data-testid': 'prop-empty' });
  ui.propCommon = h('div', { class: 'propbody' }, row('Layer', ui.propLayer), row('Colour', ui.propSwatch, ui.propColour), row('Line type', ui.propLt));
  ui.propButtons = h('div', { class: 'proprow btns' }, ui.propSimilar, ui.propMatch);
  ui.propBody = h('div', { class: 'propbody' }, ui.propCommon, ui.propWidth, ui.propGeo, ui.propButtons);
  ui.propSec = h('section', { class: 'propbox', hidden: true, 'data-testid': 'props-panel' },
    h('div', { class: 'layers-head' }, h('h2', { class: 'sec' }, 'Properties'), ui.propChip), ui.propEmpty, ui.propBody);
  return ui.propSec;
}

function setSelect(sel, options, current) {
  const sig = options.map((o) => o[0] + '\n' + o[1]).join('\n\n');
  if (sel.dataset.sig !== sig) { sel.replaceChildren(...options.map(([v, text]) => h('option', { value: v }, text))); sel.dataset.sig = sig; }
  sel.value = current;
}
function renderPropsPanel(d) {
  const show = state.propsOn && !!d && state.panel !== 'library';
  ui.propSec.hidden = !show;
  if (!show) return;
  const pe = propEnts(d), ents = pe.map((x) => x[1]), all = propEnts(d, true).map((x) => x[1]), sm = PR.summarize(ents), none = !ents.length;
  ui.propEmpty.hidden = !none; ui.propBody.hidden = !all.length; ui.propChip.hidden = none;
  ui.propCommon.hidden = none; ui.propGeo.hidden = none; ui.propButtons.hidden = none;
  ui.propEmpty.textContent = d.sel.size ? 'A kept dimension has its own text height, above.' : 'Select something to see its properties.';
  const widths = all.map((e) => PR.widthKey(e, d.factor)), width = widths.length && widths.every((w) => w === widths[0]) ? widths[0] : null;
  ui.propWidthHint.textContent = 'Selection · mm';
  ui.propWidthUnits.textContent = 'mm';
  for (const b of ui.propWidthPresets.children) {
    const active = typeof width === 'number' ? Math.abs(width - Number(b.dataset.width)) < d.factor * 1e-6 : String(width) === b.dataset.width;
    b.setAttribute('aria-pressed', String(active));
  }
  if (document.activeElement !== ui.propWidthInput) {
    ui.propWidthInput.value = typeof width === 'number' ? String(+width.toPrecision(10)) : '';
    ui.propWidthInput.placeholder = width == null ? VARIES : typeof width === 'string' ? width : '';
  }
  if (none) return;
  ui.propChip.textContent = sm.chip;
  setSelect(ui.propLayer, [...(sm.layer == null ? [['', VARIES]] : []), ...propLayers(d, pe).map((n) => [n, n])], sm.layer == null ? '' : sm.layer);
  const cols = [...PR.COLOURS.map((c) => [c.key, c.label])];
  if (sm.colour != null && !cols.some((c) => c[0] === sm.colour)) cols.push([sm.colour, PR.colourLabel(sm.colour)]);
  setSelect(ui.propColour, [...(sm.colour == null ? [['', VARIES]] : []), ...cols], sm.colour == null ? '' : sm.colour);
  const lts = [...PR.LINETYPES.map((c) => [c.key, c.label])];
  if (sm.lt != null && !lts.some((c) => c[0] === sm.lt)) lts.push([sm.lt, PR.ltLabel(sm.lt)]);
  setSelect(ui.propLt, [...(sm.lt == null ? [['', VARIES]] : []), ...lts], sm.lt == null ? '' : sm.lt);
  ui.propSwatch.style.background = sm.colour == null ? 'repeating-linear-gradient(45deg, var(--line) 0 3px, transparent 3px 6px)' : colourCss(sm.colour === 'bylayer' ? PR.effectiveColour(ents[0], layerMap(d)) : sm.colour);
  // the geometry: rebuilt when the list of fields changes, else only the numbers are put in
  const fields = PR.fieldsOf(ents, d.factor), sig = fields.map((f) => f.key).join();
  if (ui.propGeo.dataset.sig !== sig) {
    ui.propGeo.dataset.sig = sig;
    const groups = [];
    for (const f of fields) { const g = f.group && groups.find((x) => x.group === f.group); if (g) g.items.push(f); else groups.push({ group: f.group, items: [f] }); }
    ui.propGeo.replaceChildren(...groups.map((g) => h('div', { class: 'proprow' }, h('span', { class: 'lbl' }, g.items[0].label),
      g.items.map((f) => {
        const input = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'data-prop': f.key, 'aria-label': f.label + (g.items.length > 1 ? (f.key.endsWith('X') ? ' X' : ' Y') : '') + (f.unit ? ' (' + f.unit + ')' : ''), disabled: !f.editable, title: f.unit || null });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } else if (e.key === 'Escape') { input.dataset.cancel = '1'; input.blur(); } });
        input.addEventListener('change', () => { if (input.dataset.cancel) { delete input.dataset.cancel; renderEdit(); return; } propFieldSet(f.key, input.value); });
        input.addEventListener('blur', () => { delete input.dataset.cancel; });
        return input;
      }))));
  }
  for (const f of fields) {
    const input = ui.propGeo.querySelector(`[data-prop="${f.key}"]`);
    if (!input || document.activeElement === input) continue;
    input.value = f.value == null ? '' : f.key === 'vertices' ? String(f.value) : fmt(f.value);
    input.placeholder = f.value == null ? VARIES : '';
  }
}

/** Applies fn to every entity in the selection (not kept dimensions) as one undo step; fn returns the changed entity or null (left as it was). */
function propCommit(d, label, fn, all = false) {
  const pe = propEnts(d, all), repl = new Map();
  for (const [i, ent] of pe) { const n = fn(ent); if (n && n !== ent) repl.set(i, n); }
  if (!repl.size) return 0;
  const keep = new Set(d.sel);
  view.fitted = false;
  commit(d, { entities: d.raw.entities.map((x, i) => repl.get(i) || x), blocks: d.raw.blocks }, label);
  setSel(d, keep);
  return repl.size;
}
function propWidthSet(value) {
  const d = editable();
  if (!d) return;
  const all = propEnts(d, true);
  if (!all.length) return;
  if (!PR.withWidth(all[0][1], value, d.factor)) {
    note('Outline width: type a positive number up to ' + fmt(327.67) + ' mm'); renderEdit(); return;
  }
  const label = typeof value === 'number' ? fmt(value) + ' mm' : value;
  const n = propCommit(d, 'Outline width → ' + label, (ent) => {
    const next = PR.withWidth(ent, value, d.factor);
    return PR.widthKey(next, d.factor) === PR.widthKey(ent, d.factor) ? null : next;
  }, true);
  if (n) note(`Outline width ${label} on ${n} shape${n === 1 ? '' : 's'}. Ctrl+Z takes it back`);
  renderEdit();
}
function propSet(what, value) {
  const d = editable();
  if (!d || value === '') { renderEdit(); return; }
  const same = (ent) => (what === 'layer' ? ent.layer === value : what === 'colour' ? PR.colourKey(ent) === value : PR.ltKey(ent) === value);
  if (propEnts(d).every((x) => same(x[1]))) { renderEdit(); return; }
  const label = what === 'layer' ? 'Layer → ' + value : what === 'colour' ? 'Colour → ' + PR.colourLabel(value) : 'Line type → ' + PR.ltLabel(value);
  const n = propCommit(d, label, (ent) => (what === 'layer' ? PR.withLayer(ent, value) : what === 'colour' ? PR.withColour(ent, value) : PR.withLineType(ent, value)));
  if (n) note(`${label} on ${n} shape${n === 1 ? '' : 's'}. Ctrl+Z takes it back`);
}
const FIELD_LABELS = { length: 'Length', radius: 'Radius', diameter: 'Diameter', centreX: 'Centre X', centreY: 'Centre Y', textH: 'Text height', textAngle: 'Angle' };
function propFieldSet(key, textValue) {
  const d = editable();
  if (!d) return;
  const v = PL.parseMm(textValue), label = FIELD_LABELS[key] || key;
  if (v == null) { note(`${label}: type a number`); renderEdit(); return; }
  if (['length', 'radius', 'diameter', 'textH'].includes(key) && !(v > 0)) { note(`${label}: must be above 0`); renderEdit(); return; }
  const ents = propEnts(d).map((x) => x[1]), cur = PR.fieldsOf(ents, d.factor).find((f) => f.key === key);
  if (cur && cur.value != null && Math.abs(cur.value - v) < 5e-3) { renderEdit(); return; }       // the shown number again: nothing to do
  let failed = 0;
  const n = propCommit(d, `${label} → ${fmt(v)}`, (ent) => { const r = PR.setField(ent, key, v, d.factor); if (!r) failed++; return r; });
  if (!n) note(key === 'length' && ents.some((e) => e.type === 'ARC') ? `${label}: an arc cannot be longer than its full circle` : `${label}: that cannot be set`);
  else note(`${label} ${fmt(v)}` + (key === 'length' && ents[0].type === 'ARC' ? ' (the radius stays; the sweep changes)' : '') + (failed ? `; ${failed} could not change` : '') + '. Ctrl+Z takes it back');
  renderEdit();
}

function toggleProps() {
  state.propsOn = !state.propsOn;
  try { localStorage.setItem(PROPS_SAVED, state.propsOn ? '1' : '0'); } catch { /* ignore */ }
  renderEdit();
  note(state.propsOn ? (editable() ? 'Properties on (View → Properties, Ctrl+1)' : 'Properties on: it shows at the top of the Drawing panel on a drawing tab') : 'Properties off');
}

// -- Select similar: every shape on the same layer, in the same colour or of the same type as the first one selected
const hiddenLayerNames = (d) => new Set([...d.off].map((i) => d.fl.layers[i] && d.fl.layers[i].name));
function similarList(d, by) {
  const first = [...d.sel].find((e) => d.raw.entities[e] && d.raw.entities[e].layer !== Ed.DIM_LAYER);
  if (first == null) return null;
  const off = new Set([...hiddenLayerNames(d), ...(d.locked || [])]), ents = d.raw.entities;        // a locked layer's shapes are not picked up, as by a click
  return { ref: ents[first], list: PR.similar(ents, ents[first], by, layerMap(d), Ed.DIM_LAYER).filter((i) => !off.has(ents[i].layer)) };
}
function selectSimilar(by) {
  const d = editable(), r = d && similarList(d, by);
  if (!r) return;
  setSel(d, new Set(r.list));
  const what = by === 'layer' ? 'on layer ' + r.ref.layer : by === 'colour' ? PR.colourLabel(PR.effectiveColour(r.ref, layerMap(d))).toLowerCase() : 'of the type ' + PR.typeName(r.ref).toLowerCase();
  note(`Selected ${r.list.length} shape${r.list.length === 1 ? '' : 's'} ${by === 'colour' ? 'in colour ' : ''}${what}`);
}
function selectSimilarMenu(btn) {
  const d = editable();
  if (!d) return;
  const items = [['layer', 'Layer'], ['colour', 'Colour'], ['type', 'Type']].map(([by, text]) => { const r = similarList(d, by); return [`${text} (${r ? r.list.length : 0})`, () => selectSimilar(by), null, !!r && r.list.length > 0]; });
  const b = btn.getBoundingClientRect();
  popMenu(b.left, b.bottom + 2, items);
}

// -- Match properties: the first selected shape is the source; each shape clicked takes its layer, colour and line type; Esc ends
function matchWords(ent) { return `${PR.typeName(ent)} (${ent.layer}, ${PR.colourLabel(PR.colourKey(ent))}, ${PR.ltLabel(PR.ltKey(ent))})`; }
function startMatch() {
  const d = editable();
  if (!d) return;
  const src = [...d.sel].find((e) => d.raw.entities[e] && d.raw.entities[e].layer !== Ed.DIM_LAYER);
  if (src == null) { note('Match properties: select the shape to copy from first'); return; }
  if (state.tool !== 'select') setTool('select');
  state.match = { d, src };
  renderEdit(); renderCommand(); paintOverlay();
  note('Match properties on. Click each shape that should change; Esc ends');
}
function endMatch(say = true) {
  if (!state.match) return;
  state.match = null;
  renderEdit(); renderCommand(); paintOverlay();
  if (say) note('Match properties ended');
}
function matchClick(d, p) {
  const m = state.match, srcEnt = m && d.raw.entities[m.src];
  if (!srcEnt) { endMatch(false); return; }
  const hit = hitAt(d, p);                                                        // a locked layer cannot be matched
  if (hit < 0) { note('Match properties: nothing there. Click a shape, or Esc to end'); return; }
  const dst = d.raw.entities[hit];
  if (dst.layer === Ed.DIM_LAYER) { note('Match properties: a kept dimension cannot be matched'); return; }
  if (hit === m.src || !PR.matchChanges(srcEnt, dst)) { note('Match properties: that shape already has them'); return; }
  const keep = new Set(d.sel);
  view.fitted = false;
  commit(d, { entities: d.raw.entities.map((x, i) => (i === hit ? PR.matchProps(srcEnt, x) : x)), blocks: d.raw.blocks }, 'Match properties');
  setSel(d, keep);
  note(`Matched ${PR.typeName(dst).toLowerCase()} to ${matchWords(srcEnt)}. Ctrl+Z takes it back; click the next or Esc`);
}

// ---- Contour (TODO 35; mock-up R4d, Option A): a floating panel; the preview is drawn on the sheet; Apply adds the outlines as lines and arcs on the layer "Contour" ----
const CONTOUR_LAYER = 'Contour';
const CT_STYLES = [{ key: 'BYLAYER', label: 'Solid', dash: [] }, { key: 'DASHED', label: 'Dashed', dash: [7, 4] }, { key: 'DOT', label: 'Dotted', dash: [0, 4] }];
const contourStyle = () => CT_STYLES.find((st) => st.key === state.contourCfg.lt);
const contourColour = (d) => {
  const key = PR.effectiveColour(PR.withColour({ layer: CONTOUR_LAYER }, state.contourCfg.colour), { [CONTOUR_LAYER]: d.raw.layers[CONTOUR_LAYER] || { aci: 3 } });
  return colourCss(key);
};
const CT_SAVED = 'pd-contour';
const loadContourCfg = () => {
  const cfg = { dir: 'outside', dist: 5, steps: 1, corners: 'sharp', colour: 'bylayer', lt: 'BYLAYER', live: true };
  try {
    const v = JSON.parse(localStorage.getItem(CT_SAVED) || 'null');
    if (v && (v.dir === 'inside' || v.dir === 'outside')) cfg.dir = v.dir;
    if (v && v.corners === 'rounded') cfg.corners = 'rounded';
    if (v && PR.COLOURS.some((c) => c.key === v.colour)) cfg.colour = v.colour;
    if (v && CT_STYLES.some((st) => st.key === v.lt)) cfg.lt = v.lt;
    if (v && Number.isFinite(+v.dist) && +v.dist > 0 && +v.dist <= 10000) cfg.dist = +v.dist;
    if (v && Number.isInteger(+v.steps) && +v.steps >= 1 && +v.steps <= 100) cfg.steps = +v.steps;
  } catch { /* storage may be blocked or hold something else */ }
  return cfg;
};
const saveContourCfg = () => { const c = state.contourCfg; try { localStorage.setItem(CT_SAVED, JSON.stringify({ dir: c.dir, dist: c.dist, steps: c.steps, corners: c.corners, colour: c.colour, lt: c.lt })); } catch { /* storage may be blocked */ } };
const contourWords = (c = state.contourCfg, dist = fmt1, tail = '') => `${c.dir === 'inside' ? 'Inside' : 'Outside'} · ${dist(c.dist)} mm · ${c.steps} step${c.steps === 1 ? '' : 's'} · ${c.corners === 'rounded' ? 'Rounded' : 'Sharp'}${tail}`;
const contourCommandText = () => contourWords(state.contourCfg, (v) => v.toFixed(2), ' corners');

function buildContourPanel() {
  const cfg = state.contourCfg;
  ui.ctColours = PR.COLOURS.map(({ key, label }) => h('button', {
    class: 'cs' + (key === 'bylayer' ? ' bylayer' : ''), type: 'button', title: label, 'aria-label': label, 'aria-pressed': 'false',
    style: 'background:' + (key === 'bylayer' ? 'var(--field)' : colourCss(key)),
    onclick: () => { cfg.colour = key; saveContourCfg(); renderContour(); }
  }, key === 'bylayer' ? label : null));
  ui.ctStyles = CT_STYLES.map(({ key, label, dash }) => h('button', {
    class: 'ctstyle', type: 'button', 'aria-pressed': 'false',
    onclick: () => { cfg.lt = key; saveContourCfg(); renderContour(); }
  }, s('svg', { viewBox: '0 0 40 8', 'aria-hidden': 'true' }, s('path', {
    d: 'M2 4H38', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-dasharray': dash.join(' ') || 'none', 'stroke-linecap': key === 'DOT' ? 'round' : 'butt'
  })), label));
  const segs = (group, label, items, key) => {
    const btns = items.map(([v, text]) => {
      const b = h('button', { class: 'seg', type: 'button', 'data-testid': `contour-${v}`, 'aria-pressed': 'false', onclick: () => { cfg[key] = v; saveContourCfg(); renderContour(); } }, text);
      return b;
    });
    ui['ct_' + key] = btns;
    return h('div', { class: 'row' }, h('span', { class: 'lbl ctlbl' }, label), h('div', { class: 'mode', role: 'group', 'aria-label': group }, btns));
  };
  const field = (label, id, apply, aria) => {
    const input = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'data-testid': id, 'aria-label': aria });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } else if (e.key === 'Escape') { e.stopPropagation(); input.value = ''; input.blur(); renderContour(); } });
    input.addEventListener('change', () => { const why = apply(input.value); if (why) note(why); renderContour(); });
    ui[id] = input;
    return h('label', { class: 'lbl field' }, label, input);
  };
  ui.ctPreview = s('svg', { viewBox: '0 0 240 90', width: '100%', height: 90, role: 'img', 'aria-label': 'Preview of the contour', class: 'ctpreview', 'data-testid': 'contour-preview' });
  ui.ctLive = h('input', { type: 'checkbox', id: 'contour-live', 'data-testid': 'contour-live', checked: true });
  ui.ctLive.addEventListener('change', () => { cfg.live = ui.ctLive.checked; renderContour(); paintOverlay(); });
  ui.ctHint = h('span', { class: 'lbl', 'data-testid': 'contour-hint' });
  ui.ctWarn = h('span', { class: 'lbl warn', 'data-testid': 'contour-warn', hidden: true });
  ui.ctApply = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'contour-apply', onclick: applyContour }, 'Apply');
  const head = h('div', { class: 'row cthead' }, h('strong', null, 'Contour'),
    h('button', { class: 'ib', type: 'button', 'data-testid': 'contour-x', 'aria-label': 'Close Contour', style: 'margin-left:auto;width:26px;height:26px', onclick: closeContour }, icon('<path d="M5 5l14 14M19 5L5 19"/>', { size: 12, width: 2, cap: 'round' })));
  const panel = h('div', { class: 'pop contourpanel', role: 'dialog', 'aria-label': 'Contour', hidden: true, 'data-testid': 'contour-panel' }, head,
    h('div', { class: 'ctbody' }, ui.ctPreview,
      segs('Direction', 'Direction', [['inside', 'Inside'], ['outside', 'Outside']], 'dir'),
      h('div', { class: 'grid2' }, field('Distance (mm)', 'contour-dist', setContourDist, 'Distance in mm'), field('Steps', 'contour-steps', setContourSteps, 'Steps')),
      segs('Corners', 'Corners', [['sharp', 'Sharp'], ['rounded', 'Rounded']], 'corners'),
      h('div', { class: 'row' }, h('span', { class: 'lbl ctlbl' }, 'Colour'), h('div', { class: 'cswatches', role: 'group', 'aria-label': 'Colour' }, ui.ctColours)),
      h('div', { class: 'row' }, h('span', { class: 'lbl ctlbl' }, 'Line style'), h('div', { class: 'ctstyles', role: 'group', 'aria-label': 'Line style' }, ui.ctStyles)),
      h('div', { class: 'row' }, ui.ctLive, h('label', { for: 'contour-live', style: 'flex:1' }, 'Live preview on the sheet')),
      ui.ctHint, ui.ctWarn,
      h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', 'data-testid': 'contour-close', onclick: closeContour }, 'Close'), ui.ctApply)));
  // dragged by its title bar: a floating panel, not a dialog
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect(), c = ui.canvas.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, c };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    panel.style.right = 'auto';
    panel.style.left = Math.max(0, Math.min(e.clientX - drag.dx - drag.c.left, drag.c.width - panel.offsetWidth)) + 'px';
    panel.style.top = Math.max(0, Math.min(e.clientY - drag.dy - drag.c.top, drag.c.height - 40)) + 'px';
  });
  head.addEventListener('pointerup', () => { drag = null; });
  head.addEventListener('pointercancel', () => { drag = null; });
  return panel;
}

function setContourDist(text) {
  const v = PL.parseMm(text);
  if (v == null || !(v > 0) || v > 10000) return 'Distance must be a number above 0 mm (up to 10000)';
  state.contourCfg.dist = v; saveContourCfg();
  return '';
}
function setContourSteps(text) {
  const v = PL.parseMm(text);
  if (v == null || !Number.isInteger(v) || v < 1 || v > 100) return 'Steps must be a whole number from 1 to 100';
  state.contourCfg.steps = v; saveContourCfg();
  return '';
}
/** The Contour panel opens on the side of the canvas away from the selected outline (top right, or top left when the outline is on the right). */
function placeContourPanel() {
  const d = editable(), p = ui.contourPanel;
  if (!d || !p) return;
  const ed = edIndex(d);
  let x0 = Infinity, x1 = -Infinity;
  for (const e of d.sel) { x0 = Math.min(x0, ed.box[e * 4]); x1 = Math.max(x1, ed.box[e * 4 + 2]); }
  const midScreen = x1 >= x0 ? ((x0 + x1) / 2 * d.factor - view.ox) * view.scale : 0;
  const right = midScreen > ui.canvas.clientWidth / 2;
  p.style.top = ''; p.style.left = right ? '14px' : ''; p.style.right = right ? 'auto' : '';
}
function closeContour() { if (state.tool === 'contour') setTool('select'); }

/** The closed outlines the selection draws (cached for the selection and the drawing's index). */
function contourLoops(d) {
  const sig = [...d.sel].sort((a, b) => a - b).join(',');
  if (d.cAn && d.cAn.ed === d.ed && d.cAn.sig === sig) return d.cAn;
  const ed = edIndex(d), tol = Ed.chainTol(drawBox(d.fl), d.factor);
  const segs = d.sel.size > 4000 ? null : CT.segmentsFromItems(ed, d.sel, (e) => e.layer === Ed.DIM_LAYER || e.type === 'DIMENSION');
  const r = segs ? CT.buildLoops(segs, tol) : { loops: [], open: 0 };
  return (d.cAn = { ed: d.ed, sig, loops: r.loops, open: r.open, big: !segs, n: segs ? segs.length : 0 });
}
/** The contour for the selection and the panel's values: { kind: 'none' | 'big' | 'open' | 'ok', an, res (CT.contour's result) }. */
function contourCompute(d) {
  const cfg = state.contourCfg, an = contourLoops(d);
  if (!d.sel.size) return { kind: 'none', an };
  if (an.big) return { kind: 'big', an };
  if (!an.loops.length) return { kind: 'open', an };
  const res = CT.contour(an.loops, { dist: cfg.dist / d.factor, steps: cfg.steps, outward: cfg.dir === 'outside', corners: cfg.corners });
  return { kind: 'ok', an, res };
}

/** Shows or hides the Contour panel and brings it, the preview and the top bar up to date (called with every change of the drawing tab). */
function renderContour() {
  if (!ui.contourPanel) return;
  const d = editable(), on = state.tool === 'contour';
  if (on && !d) { setTool('select'); return; }
  ui.contourPanel.hidden = !on;
  ui.selContour.hidden = !on;
  if (!on) { if (d) d.cRes = null; return; }
  const cfg = state.contourCfg;
  ui.ctColours.forEach((b, i) => b.setAttribute('aria-pressed', String(PR.COLOURS[i].key === cfg.colour)));
  ui.ctStyles.forEach((b, i) => b.setAttribute('aria-pressed', String(CT_STYLES[i].key === cfg.lt)));
  ui.ct_dir.forEach((b) => { const v = b.dataset.testid.slice(8) === cfg.dir; b.classList.toggle('on', v); b.setAttribute('aria-pressed', String(v)); });
  ui.ct_corners.forEach((b) => { const v = b.dataset.testid.slice(8) === cfg.corners; b.classList.toggle('on', v); b.setAttribute('aria-pressed', String(v)); });
  if (document.activeElement !== ui['contour-dist']) ui['contour-dist'].value = fmt1(cfg.dist);
  if (document.activeElement !== ui['contour-steps']) ui['contour-steps'].value = String(cfg.steps);
  ui.ctLive.checked = cfg.live;
  ui.selContour.textContent = 'Contour: ' + contourWords();
  const cc = contourCompute(d), res = cc.kind === 'ok' ? cc.res : null;
  d.cRes = res && cfg.live ? { polys: res.steps.flatMap((st) => st.map((l) => CT.loopPoints(l, 3))) } : null;
  const made = res ? res.made : 0;
  ui.ctApply.disabled = made === 0;
  ui.ctHint.textContent = cc.kind === 'none' ? 'Pick a closed outline in the drawing: click one of its edges.'
    : cc.kind === 'big' ? 'That selection is too big for a contour. Pick one outline.'
    : cc.kind === 'open' ? `That is not a closed outline (${cc.an.open} piece${cc.an.open === 1 ? '' : 's'} left open). Join the tiny gaps, or pick a closed one.`
    : made ? `Apply makes ${made} new outline${made === 1 ? '' : 's'} on the layer Contour. The part itself is not changed.` : 'Nothing to make with these values.';
  const warn = res && res.stopped ? `Step ${res.stopped.step} would close up: made ${made}.` : res && res.dropped ? `${res.dropped} hole${res.dropped === 1 ? '' : 's'} closed up on the way.` : '';
  ui.ctWarn.hidden = !warn; ui.ctWarn.textContent = warn;
  // Reduced opacity distinguishes preview contours from applied geometry.
  ui.ctPreview.style.setProperty('--ct-colour', contourColour(d));
  ui.ctPreview.style.setProperty('--ct-dash', contourStyle().dash.join(' ') || 'none');
  const loops = cc.an ? cc.an.loops.map((l) => CT.loopPoints(l, 6)) : [], outs = res ? res.steps.flatMap((st) => st.map((l) => CT.loopPoints(l, 4))) : [];
  const all = [...loops, ...outs].flat();
  if (!all.length) ui.ctPreview.replaceChildren();
  else {
    const x0 = Math.min(...all.map((p) => p[0])), x1 = Math.max(...all.map((p) => p[0])), y0 = Math.min(...all.map((p) => p[1])), y1 = Math.max(...all.map((p) => p[1]));
    const k = Math.min(220 / Math.max(x1 - x0, 1e-9), 70 / Math.max(y1 - y0, 1e-9)), ox = 120 - k * (x0 + x1) / 2, oy = 45 + k * (y0 + y1) / 2;
    const path = (pts) => 'M' + pts.map((p) => `${(ox + k * p[0]).toFixed(1)} ${(oy - k * p[1]).toFixed(1)}`).join('L') + 'Z';
    ui.ctPreview.replaceChildren(
      ...(cfg.live ? outs.map((p) => s('path', { class: 'ct-out', d: path(p) })) : []),
      ...loops.map((p) => s('path', { class: 'ct-orig', d: path(p) })));
  }
  renderCommand();
  ui.hintPill.hidden = !(cfg.live && made);
  if (cfg.live && made) ui.hintPill.textContent = `Preview: ${made} outline${made === 1 ? '' : 's'} ${cfg.dir === 'inside' ? 'inside' : 'outside'}, ${cfg.corners} corners`;
  paintOverlay();
}

/** Apply: the outlines are added to the drawing as lines and arcs (a circle as a circle) on the layer "Contour"; one undo step. */
function applyContour() {
  const d = editable();
  if (!d) return;
  const cc = contourCompute(d), cfg = state.contourCfg;
  if (cc.kind !== 'ok' || !cc.res.made) { note('Contour: nothing to apply. Pick a closed outline first'); return; }
  const res = cc.res, ents = [];
  if (!d.raw.layers[CONTOUR_LAYER]) addLayer(d.raw, CONTOUR_LAYER, { aci: 3 });
  if (cfg.lt !== 'BYLAYER' && !d.raw.ltypes[cfg.lt]) d.raw.ltypes[cfg.lt] = { pattern: contourStyle().dash.map((x, i) => (i % 2 ? -x : x) / d.factor), contour: true };
  for (const st of res.steps) for (const l of st) ents.push(...CT.toEntities(l, CONTOUR_LAYER));
  for (let i = 0; i < ents.length; i++) ents[i] = PR.withLineType(PR.withColour(ents[i], cfg.colour), cfg.lt);
  const keep = new Set(d.sel);
  commit(d, { entities: [...d.raw.entities, ...ents], blocks: d.raw.blocks }, `Contour ${cfg.dir} ${fmtSize(cfg.dist)} mm × ${res.made}`);
  d.newLayer = CONTOUR_LAYER;
  setSel(d, keep);
  renderLayers();
  note(`Contour: ${res.made} new outline${res.made === 1 ? '' : 's'} (${ents.length} line${ents.length === 1 ? '' : 's'} and arcs) on the layer ${CONTOUR_LAYER}` + (res.stopped ? `. Step ${res.stopped.step} would close up` : '') + '. Ctrl+Z takes them away');
}

/** The outlines of a drawing, biggest first: what is joined end to end and at least 5 × 5 mm ({ set, w, h }). Null until the drawing has been read for picking. Kept dimensions are not outlines. */
function outlinesOf(d) {
  if (d.outl) return d.outl;
  const ed = d.ed;
  if (!ed) return null;
  const out = [];
  if (ed.shown.length <= 6000) {
    const tol = Ed.chainTol(drawBox(d.fl), d.factor), seen = new Set();
    for (const e of ed.shown) {
      if (seen.has(e)) continue;
      const chain = Ed.chainAt(ed, e, tol).filter((c) => d.raw.entities[c].layer !== Ed.DIM_LAYER);
      seen.add(e); for (const c of chain) seen.add(c);
      if (!chain.length) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of chain) { x0 = Math.min(x0, ed.box[c * 4]); y0 = Math.min(y0, ed.box[c * 4 + 1]); x1 = Math.max(x1, ed.box[c * 4 + 2]); y1 = Math.max(y1, ed.box[c * 4 + 3]); }
      const w = (x1 - x0) * d.factor, hh = (y1 - y0) * d.factor;
      if (w >= 5 && hh >= 5) out.push({ set: new Set(chain), w, h: hh });
    }
    out.sort((a, b) => b.w * b.h - a.w * a.h);
  }
  return (d.outl = out.slice(0, 12));
}

/** The property bar for the selection and the list of outlines (drawing tab). */
function renderSelection(d) {
  const outs = outlinesOf(d), n = d.sel.size;
  ui.outList.replaceChildren(...(outs ? outs.map((o, k) => h('button', { class: 'orow', type: 'button', 'data-outline': k + 1, onclick: () => setSel(d, new Set(o.set)) },
    h('span', { class: 'nm' }, 'Outline ' + (k + 1)), h('span', { class: 'lbl mono' }, `${fmtSize(o.w)} × ${fmtSize(o.h)}`),
    (d.savedAs || []).includes(sizeKey(o.w, o.h)) ? h('span', { class: 'chip' }, 'saved') : null)) : [h('span', { class: 'lbl' }, 'Reading the drawing…')]));
  if (outs && !outs.length) ui.outList.append(h('span', { class: 'lbl' }, ed6000(d) ? 'Too many pieces to list. Click an outline in the drawing.' : 'No outlines found. Click a shape in the drawing.'));
  // Keep only and Extract part act on geometry: a selection of kept dimensions alone has none (they are not part of a part)
  const noPart = !n || !selHasPart(d);
  ui.barKeep.disabled = ui.barExtract.disabled = ui['keep-only'].disabled = noPart;
  ui.barKeep.title = ui.barExtract.title = ui['keep-only'].title = n && noPart ? 'A kept dimension is not part of a part' : '';
  if (!n) { ui.selName.textContent = 'Nothing selected'; ui.selLayer.textContent = 'click an outline in the drawing'; ui['sel-w'].value = '—'; ui['sel-h'].value = '—'; ui.selArea.textContent = ''; return; }
  const ed = edIndex(d);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of d.sel) { if (d.raw.entities[e].layer === Ed.DIM_LAYER || !ed.byEnt[e]) continue; x0 = Math.min(x0, ed.box[e * 4]); y0 = Math.min(y0, ed.box[e * 4 + 1]); x1 = Math.max(x1, ed.box[e * 4 + 2]); y1 = Math.max(y1, ed.box[e * 4 + 3]); }
  const k = outs ? outs.findIndex((o) => o.set.size === n && [...d.sel].every((e) => o.set.has(e))) : -1;
  ui.selName.textContent = k >= 0 ? 'Outline ' + (k + 1) : n + ' selected';        // one wording with the panel's count ("1 selected")
  ui.selLayer.textContent = 'layer ' + d.raw.entities[[...d.sel][0]].layer;
  ui['sel-w'].value = x1 >= x0 ? fmt((x1 - x0) * d.factor) : '—';
  ui['sel-h'].value = y1 >= y0 ? fmt((y1 - y0) * d.factor) : '—';
  // area and perimeter (TODO 31): for ink and cost; skipped on a huge selection, where it would be slow
  const ap = n <= 3000 ? Ed.areaPerimeter(ed, d.sel, d.factor, Ed.chainTol(drawBox(d.fl), d.factor)) : null;
  ui.selArea.textContent = !ap ? '' : (ap.loops ? `Area ${fmt(ap.area)} mm²` + (ap.holes ? ` (${ap.holes} hole${ap.holes > 1 ? 's' : ''} off)` : '') +
    (ap.gaps ? ` (closed across ${ap.gaps} tiny gap${ap.gaps > 1 ? 's' : ''})` : '') : 'Not closed: no area') +
    ` · Perimeter ${fmt(ap.perimeter)} mm` + (ap.loops && ap.open ? ` · ${ap.open} open piece${ap.open > 1 ? 's' : ''} not in the area` : '');
}
const ed6000 = (d) => !!d.ed && d.ed.shown.length > 6000;

/** The tiny gaps of a drawing tab (TODO 46) at the typed tolerance: ends that almost meet. Cached per index and tolerance; null until the index is ready. */
function gapsOf(d) {
  if (!d.ed) return null;
  const tol = state.gapMm / (d.factor || 1);
  if (!d.gaps || d.gaps.ed !== d.ed || d.gaps.tol !== tol) d.gaps = { ed: d.ed, tol, list: d.ed.shown.length > 60000 ? [] : Ed.findGaps(d.ed, tol) };
  return d.gaps.list;
}
function gapTolTyped() {
  const v = PL.parseMm(ui.gapTol.value);
  if (v == null || v <= 0 || v > 5) { note('Tiny gaps: type a tolerance in mm, above 0 and up to 5'); renderEdit(); return; }
  state.gapMm = v;
  try { localStorage.setItem('pd-gaptol', String(v)); } catch { /* ignore */ }
  paintOverlay(); renderEdit();
}
function joinTinyGaps(whole = false) {
  const d = editable(), ed = d && (whole === true ? CL.checkIndex(d.raw) : edIndex(d));
  const gaps = ed && Ed.findGaps(ed, state.gapMm / d.factor).filter((g) => g.ends.every((e) => !lockedEnt(d, e.e)));
  if (!gaps || !gaps.length) return;
  const r = Ed.joinGaps(d.raw, ed, gaps);
  if (!r.changed) { note('Join gaps: nothing could be moved' + skippedText(r.skipped)); return; }
  commit(d, { entities: r.entities, blocks: r.blocks }, 'Join gaps');
  const left = gapsOf(d) || [];
  note(`Joined ${r.joined} gap${r.joined === 1 ? '' : 's'}` + skippedText(r.skipped) + (left.length ? `; ${left.length} left` : '') + '. Ctrl+Z puts them back');
}
const skippedText = (sk) => { const l = Object.entries(sk).map(([t, n]) => t + ' ' + n).join(', '); return l ? ` (not moved: ${l})` : ''; };

function removeDuplicates() {
  const d = editable();
  if (!d) return;
  const r = CL.removeDuplicates(d.raw, (i) => !lockedEnt(d, i));
  d.duplicates = { source: d.raw.entities, count: d.locked?.size ? CL.removeDuplicates(d.raw).count : r.count };
  if (!r.count) { note('No removable duplicates / overlaps (locked layers are kept)'); renderEdit(); return; }
  commit(d, r, 'Remove duplicates / overlaps');
  note(`Removed redundant geometry from ${r.count} entities. Ctrl+Z brings it back`);
}

function showPreflight() {
  if (!editable()) { note('Preflight works on a drawing tab: open a drawing first'); return; }
  ui.cmdUI.close();
  if (!ui.preflight) {
    ui.preflight = h('section', { class: 'pop preflightpanel', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Preflight', 'data-testid': 'preflight' });
    ui.preflight.addEventListener('keydown', (e) => { if (e.key === 'Escape') { ui.preflight.hidden = true; e.stopPropagation(); } });
    ui.canvas.append(ui.preflight);
  }
  ui.preflight.hidden = false;
  recheckPreflight();
}
function recheckPreflight(check) {
  const d = editable();
  if (!d || !ui.preflight || ui.preflight.hidden) return;
  const fresh = CL.preflight(d.raw, { factor: d.factor, tolerance: state.gapMm, check });
  const rows = check ? ui.preflightRows.map((r) => fresh.find((f) => f.id === r.id) || r) : fresh;
  ui.preflightRows = rows;
  if (!check) { ui.preflightDoc = d; ui.preflightSource = d.raw.entities; }
  const duplicates = fresh.find((r) => r.id === 'duplicates');
  if (duplicates) { d.duplicates = { source: d.raw.entities, count: duplicates.count }; renderEdit(); }
  const button = (label, id, fn, disabled = false) => h('button', { class: 'btn sm', type: 'button', 'data-testid': id, disabled, onclick: fn }, label);
  const select = (id) => {
    const fresh = recheckPreflight(id);
    setTool('select');
    const offenders = fresh.offenders.filter((i) => !lockedEnt(d, i));
    setSel(d, new Set(offenders));
    note(`Preflight: ${fresh.label} · ${offenders.length} entities selected` + (offenders.length < fresh.offenders.length ? ' (locked layers skipped)' : ''));
  };
  const fix = (id) => {
    if (id === 'duplicates') removeDuplicates();
    else if (id === 'gaps') joinTinyGaps(true);
    else {
      const [wide] = CL.preflight(d.raw, { factor: d.factor, check: 'wide' });
      const offenders = new Set(wide.offenders.filter((i) => !lockedEnt(d, i)));
      if (offenders.size) commit(d, CL.hairline(d.raw, offenders, d.locked), 'Preflight Hairline');
    }
    recheckPreflight(id);
  };
  ui.preflightNote = h('p', { class: 'lbl', 'data-testid': 'preflight-note' },
    (ui.preflightSource !== d.raw.entities ? 'Drawing changed · Recheck for other counts.' : 'Whole drawing · checked just now.') + ' Cut layer: name contains “cut” (any case).');
  ui.preflight.replaceChildren(
    h('div', { class: 'pfhead' }, h('strong', {}, 'Preflight'), h('span', { class: 'chip', 'data-testid': 'preflight-flagged' }, `${rows.filter((r) => r.count).length} checks flagged`)),
    h('div', { class: 'pfbody' }, ui.preflightNote,
      h('div', { class: 'pfrow pfcols', 'aria-hidden': 'true' }, ['Check', 'Count', 'Select', 'Fix'].map((label) => h('span', {}, label))),
      rows.map((r) => h('div', { class: 'pfrow', 'data-testid': `preflight-${r.id}` }, h('span', {}, r.label),
        h('span', { class: 'pfcount', 'data-testid': `preflight-${r.id}-count` }, r.count ?? 'n/a (no sheet)'),
        button('Select', `preflight-${r.id}-select`, () => select(r.id), !r.count),
        r.fix ? button(r.fix, `preflight-${r.id}-fix`, () => fix(r.id), !r.count) : h('span', { class: 'pfmanual' }, 'Manual'))),
      h('p', { class: 'lbl' }, `Tiny gaps use Drawing scale’s ${state.gapMm} mm tolerance. Hairline: 0.05 mm. Hidden / locked objects are checked; fixes skip locks. Warnings only; output is never blocked.`),
      h('div', { class: 'pfbuttons' }, button('Recheck', 'preflight-recheck', () => recheckPreflight()), button('Close', 'preflight-close', () => { ui.preflight.hidden = true; })))
  );
  return fresh[0];
}

function renderEdit() {
  if (!ui.drawSec) return;
  renderStatus();                                          // the status bar's layer follows the selection
  renderBalloons();
  const d = curDoc(), on = !!editable(), L = state.setlen, lib = state.panel === 'library';
  if (ui.preflight && !ui.preflight.hidden) {
    if (!on) ui.preflight.hidden = true;
    else if (ui.preflightDoc !== d) recheckPreflight();
    else if (ui.preflightSource !== d.raw.entities) ui.preflightNote.textContent = 'Drawing changed · Recheck for current counts. Cut layer: name contains “cut” (any case).';
  }
  ui.drawSec.hidden = !on || lib; ui.outSec.hidden = !on || lib;
  if (state.match && (!on || state.match.d !== d || !d.raw.entities[state.match.src])) state.match = null;
  renderPropsPanel(on ? d : null);
  if (ui.matchHint) { ui.matchHint.hidden = !state.match; if (state.match) ui.matchHint.textContent = 'Match properties · source: ' + matchWords(d.raw.entities[state.match.src]) + ' · click what should change · Esc ends'; }
  const tb = textBarOn(d);
  ui.selbar.hidden = !on || tb;                             // always there on a drawing tab (or the text bar in its place), so the drawing does not jump when something is picked
  ui.textbar.hidden = !tb; if (tb) renderTextBar();
  ui.canvas.classList.toggle('texttool', on && state.tool === 'text');
  renderContour();
  ui.canvas.classList.toggle('pick', (on && (state.tool === 'select' || state.tool === 'contour' || state.tool === 'dimension' || !!state.draw || !!L)) || (!!editable() && state.tool === 'measure'));
  if (!on) return;
  renderSelection(d);
  const n = d.sel.size, b = sizeBox(d), scalable = !!b;
  ui.bgName.textContent = d.bg ? d.bg.name : '';
  ui.bgX.hidden = !d.bg;
  ui.scaleTarget.hidden = !(d.bg && d.box);
  ui.scaleTarget.value = sizeTarget(d);
  ui.selRow.hidden = n === 0;
  ui.selCount.textContent = n + ' selected';
  const sd = dimSel(d);
  ui.dimRow.hidden = !sd;
  if (sd && document.activeElement !== ui.dimH) ui.dimH.value = String(+(sd.params.textH * d.factor).toFixed(3));
  const sl = ldrSel(d);
  ui.ldrRow.hidden = !sl;
  if (sl) {
    const set = (i, v) => { if (document.activeElement !== i) i.value = v; };
    set(ui.ldrNote, sl.model.lines.join(' / ')); ui.ldrNote.disabled = sl.model.lines.length > 1; ui.ldrNote.title = ui.ldrNote.disabled ? 'Several lines: double-click the note to change it' : '';
    set(ui.ldrH, String(+(sl.model.textH * d.factor).toFixed(3))); set(ui.ldrA, String(+(sl.model.arrow * d.factor).toFixed(3)));
    ui.ldrStyle.textContent = `Style: ${state.dimStyles.cur}. Note lands ${LR.sideOf(sl.model.pts) > 0 ? 'right' : 'left'}.`;
  }
  const put = (input, v) => { if (document.activeElement !== input) input.value = v; };
  put(ui.dw, b ? fmtSize(b[2] - b[0]) : ''); put(ui.dh, b ? fmtSize(b[3] - b[1]) : '');
  ui.dw.disabled = ui.dh.disabled = ui['set-length'].disabled = !scalable;
  ui['set-length'].classList.toggle('on', !!L);
  for (const [id, fix] of [['unit-up', UF.UNIT_FIXES.up], ['unit-down', UF.UNIT_FIXES.down]]) { ui[id].disabled = !scalable; ui[id].title = UF.unitFixTip(fix, b); }
  ui.undo.disabled = !d.hist.canUndo; ui.redo.disabled = !d.hist.canRedo;
  const gl = gapsOf(d);
  ui.gapRow.hidden = !d.ed;
  ui.gapCount.textContent = gl ? String(gl.length) : '…';
  if (document.activeElement !== ui.gapTol) ui.gapTol.value = String(state.gapMm);
  ui.gapShow.classList.toggle('on', state.gapShow); ui.gapShow.disabled = ui.gapJoin.disabled = !gl || !gl.length;
  const duplicates = d.duplicates?.source === d.raw.entities ? d.duplicates : null;
  ui.duplicateCount.textContent = duplicates ? `${duplicates.count} found` : 'Check';
  ui.duplicateRemove.disabled = duplicates?.count === 0;
  ui.lenRow.hidden = !(L && L.measured);
  if (L && L.measured) ui.measured.textContent = fmtSize(L.measured) + ' mm measured';
}

// ---- Compare two drawings (TODO 41; mock-up R5d, Option B; compare.js is the logic): its own tab, the controls in the right-hand panel ----
// A Compare tab (d.cmp) holds two sides { name, fl, factor, off, polys, box }; the second is moved by c.off (Line up) and every place where
// the outlines differ by more than the tolerance is a difference (c.res), drawn as a glow in the overlay and listed in the panel.
const cmpDoc = () => { const d = curDoc(); return d && d.cmp ? d : null; };
const cmpCss = (id) => { const k = C.COLOURS.find((x) => x.id === id) || C.COLOURS[0]; return isDark() ? k.dark : k.css; };
const cmpOff = (c) => C.lineUp(c.a && c.a.box, c.b && c.b.box, c.mode, c.manual);
const cmpSide = (name, fl, factor, off) => ({ name, fl, factor, off, ...C.polylines(fl, factor, off) });
/** What the Compare tab covers (mm, y up): both drawings, the second where it is moved to. */
function cmpBox(d) {
  const c = d && d.cmp;
  return c ? unionBox(c.a && c.a.box, c.b && c.b.box && [c.b.box[0] + c.off[0], c.b.box[1] + c.off[1], c.b.box[2] + c.off[0], c.b.box[3] + c.off[1]]) : null;
}
function cmpCalc(c) {
  c.off = cmpOff(c); c.sel = 0;
  c.res = c.a && c.b ? C.compare(c.a.polys, c.b.polys, c.tol, { offsetB: c.off }) : null;
}
function cmpRun(d, refit = false) { cmpCalc(d.cmp); update(refit && view.fitted); }

/** File → Compare two drawings…: the Compare tab (the one already open, else a new one with the open drawing tabs as drawing 1 and 2). */
function cmpStart() {
  const have = state.docs.findIndex((x) => x.cmp);
  if (have >= 0) { state.doc = have; showDoc(); return; }
  const tabs = state.docs.filter((x) => x.raw && x.fl && !x.lay && x.box), cur = curDoc(), first = tabs.includes(cur) ? cur : tabs[0], second = tabs.find((x) => x !== first);
  const side = (x) => (x ? cmpSide(x.name, x.fl, x.factor, x.off) : null);
  const c = { a: side(first), b: side(second), ca: 'red', cb: 'blue', mode: 'bl', manual: [0, 0], tol: C.DEFAULT_TOL, show: true, res: null, off: [0, 0], sel: 0 };
  cmpCalc(c);
  addTab({ name: 'Compare', path: null, dirty: false, cmp: c });
  note(c.b ? 'Compare: the first two open drawings. Open… picks others' : 'Compare: open two drawings with Open…');
}

async function cmpPick(i) {
  const t = window.__TAURI__;
  if (!t || !t.dialog || !t.dialog.open) { ui.cmpPicker.value = ''; ui.cmpPicker.dataset.side = i; ui.cmpPicker.click(); return; }
  try {
    const picked = await t.dialog.open({ multiple: false, filters: [{ name: 'Drawings', extensions: ['dxf'] }] });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (path) await cmpLoad(i, String(path).split(/[\\/]/).pop(), await t.fs.readFile(path));
  } catch (err) { note('Open failed: ' + (err && err.message ? err.message : err)); }
}
async function cmpLoad(i, name, buf) {
  const d = cmpDoc();
  if (!d) return;
  if (!/\.dxf$/i.test(name)) { note(name + ': Compare opens DXF drawings'); return; }
  const r = await readDrawing(buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if (!r.ok) { note(name + ': ' + (r.sorry || 'could not read this drawing' + (r.error ? ' (' + r.error + ')' : ''))); return; }
  const side = cmpSide(name, r.result, unitFactor(r.result.units), startHidden(r.result));
  if (!side.polys.length) { note(name + ': no outlines to compare (lines, arcs, circles and polylines)'); return; }
  d.cmp[i] = side;
  cmpRun(d, true);
  note(`Drawing ${i === 'a' ? 1 : 2}: ${name}`);
}

function buildCompareSection() {
  ui.cmp = {};
  ui.cmpPicker = h('input', { type: 'file', accept: '.dxf', hidden: true, 'data-testid': 'cmp-picker' });
  ui.cmpPicker.addEventListener('change', async () => { const f = ui.cmpPicker.files[0], i = ui.cmpPicker.dataset.side; ui.cmpPicker.value = ''; if (f) await cmpLoad(i, f.name, await f.arrayBuffer()); });
  const side = (i, key) => {
    const u = ui.cmp[key] = { nm: h('strong', { class: 'cmpname', 'data-testid': 'cmp-name-' + i }),
      sel: h('div', { class: 'cswatches', role: 'group', 'aria-label': `Drawing ${i} colour`, 'data-testid': 'cmp-colour-' + i }, C.COLOURS.map((k) =>
        h('button', { class: 'cs', type: 'button', 'aria-label': k.label, 'aria-pressed': 'false', 'data-colour': k.id, 'data-testid': `cmp-colour-${i}-${k.id}`, onclick: () => { cmpDoc().cmp['c' + key] = k.id; update(); } }))) };
    return [h('div', { class: 'proprow' }, h('span', { class: 'lbl' }, `Drawing ${i}`), u.nm, h('button', { class: 'btn', type: 'button', 'data-testid': 'cmp-open-' + i, onclick: () => cmpPick(key) }, 'Open…')),
      h('div', { class: 'proprow' }, h('span', { class: 'lbl' }, 'Colour'), u.sel)];
  };
  ui.cmpModes = [['bl', 'Bottom-left'], ['centre', 'Centres'], ['manual', 'Manual']].map(([m, text]) => h('button', { class: 'seg', type: 'button', 'data-m': m, 'data-testid': 'cmp-lineup-' + m, onclick: () => {
    const d = cmpDoc(), c = d.cmp;
    if (m === 'manual' && c.mode !== 'manual') c.manual = [...c.off];          // by hand starts where the last Line up put it
    c.mode = m; cmpRun(d);
  } }, text));
  ui.cmpHint = h('div', { class: 'lbl', 'data-testid': 'cmp-hint' });
  ui.cmpTol = h('input', { class: 'fld', type: 'text', inputmode: 'decimal', 'aria-label': 'Tolerance, mm', 'data-testid': 'cmp-tol' });
  ui.cmpTol.addEventListener('keydown', (e) => { if (e.key === 'Enter') ui.cmpTol.blur(); });
  ui.cmpTol.addEventListener('change', () => {
    const d = cmpDoc(), v = PL.parseMm(ui.cmpTol.value);
    if (v == null || v <= 0 || v > C.MAX_TOL) { note(`Tolerance: a number above 0 and up to ${C.MAX_TOL} mm`); ui.cmpTol.value = String(d.cmp.tol); return; }
    d.cmp.tol = v; cmpRun(d);
  });
  ui.cmpShow = h('input', { type: 'checkbox', role: 'switch', class: 'swin', 'aria-label': 'Show differences', 'data-testid': 'cmp-show', onchange: (e) => { cmpDoc().cmp.show = e.target.checked; paintOverlay(); } });
  ui.cmpCount = h('span', { class: 'chip', 'data-testid': 'cmp-count' });
  ui.cmpList = h('div', { class: 'gaplist', 'data-testid': 'cmp-list' });
  ui.cmpSec = h('section', { class: 'propbox cmpbox', hidden: true, 'data-testid': 'compare-panel' },
    h('h2', { class: 'sec' }, 'Compare'), ...side(1, 'a'), ...side(2, 'b'),
    h('div', { class: 'lbl' }, 'Line up'), h('div', { class: 'mode', role: 'group', 'aria-label': 'Line up' }, ui.cmpModes), ui.cmpHint,
    h('div', { class: 'proprow' }, h('span', { class: 'lbl' }, 'Tolerance'), ui.cmpTol, h('span', { class: 'lbl' }, 'mm')),
    h('label', { class: 'row swrow' }, h('span', null, 'Show differences'), ui.cmpShow),
    h('div', { class: 'layers-head' }, h('h2', { class: 'sec' }, 'Differences'), ui.cmpCount), ui.cmpList, ui.cmpPicker);
  return ui.cmpSec;
}

function renderCompare() {
  const d = cmpDoc();
  ui.cmpSec.hidden = !d || state.panel === 'library';
  if (ui.cmpSec.hidden) return;
  const c = d.cmp;
  for (const k of ['a', 'b']) {
    const u = ui.cmp[k], sd = c[k];
    u.nm.textContent = sd ? sd.name : 'Not chosen yet'; u.nm.title = u.nm.textContent;
    for (const b of u.sel.children) { b.style.background = cmpCss(b.dataset.colour); b.setAttribute('aria-pressed', String(b.dataset.colour === c['c' + k])); }
  }
  for (const b of ui.cmpModes) { const on = b.dataset.m === c.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  ui.cmpHint.textContent = (c.mode === 'manual' ? `Drag drawing 2 on the canvas, or use the arrow keys (${state.nudge} mm). ` : '') + `Drawing 2 moved X ${fmt(c.off[0])}, Y ${fmt(c.off[1])} mm`;
  if (document.activeElement !== ui.cmpTol) ui.cmpTol.value = String(c.tol);
  ui.cmpShow.checked = c.show;
  const diffs = c.res ? c.res.diffs : [];
  ui.cmpCount.textContent = !c.res ? 'Choose two drawings' : diffs.length ? `${diffs.length} difference${diffs.length === 1 ? '' : 's'}${c.res.truncated ? ' or more' : ''}` : 'No differences';
  if (ui.cmpListRes !== c.res) {
    ui.cmpListRes = c.res;
    ui.cmpList.replaceChildren(...diffs.map((x) => h('button', { class: 'gaprow cmprow', type: 'button', 'data-n': x.n, 'data-testid': 'cmp-diff', title: 'Zoom to this difference', onclick: () => cmpZoom(d, x) },
      h('span', { class: 'lbl' }, String(x.n)), h('span', { class: 'lbl mono' }, x.mm.toFixed(2) + ' mm'), h('span', { class: 'lbl mono' }, `X ${Math.round(x.x)} Y ${Math.round(x.y)}`))));
  }
  for (const r of ui.cmpList.children) r.classList.toggle('on', Number(r.dataset.n) === c.sel);
}

/** Centres the view on a box (mm, y up) with room round it. */
function zoomToBox(b, pad) {
  const { w, h: ch } = canvasSize(), R = state.rulers ? RULER : 0, bw = b[2] - b[0] + 2 * pad, bh = b[3] - b[1] + 2 * pad;
  view.scale = Math.min(40, (w - R) / bw, (ch - R) / bh);
  view.ox = (b[0] + b[2]) / 2 - (w + R) / 2 / view.scale;
  view.oy = state.sheetH - (b[1] + b[3]) / 2 - (ch + R) / 2 / view.scale;
  view.fitted = false;
  applyView();
}
function cmpZoom(d, x) {
  d.cmp.sel = x.n;
  update();
  zoomToBox(x.box, Math.max(20, x.box[2] - x.box[0], x.box[3] - x.box[1]));
  note(`Difference ${x.n}: ${x.mm.toFixed(2)} mm at X ${fmt(x.x)}, Y ${fmt(x.y)}`);
}

function cmpPaint(canvas, c, base) {
  paintDrawing(canvas, { ...base, fl: null, factor: 1 });                                      // clears
  for (const [sd, col, o] of [[c.a, c.ca, [0, 0]], [c.b, c.cb, c.off]]) {
    if (sd) paintDrawing(canvas, { ...base, keep: true, fl: sd.fl, off: sd.off, factor: sd.factor, slots: [[sd.factor, 0, 0, -sd.factor, o[0], state.sheetH - o[1]]], tint: cmpCss(col) });
  }
}
/** The differences as a glow (a soft round patch) with its number; the one picked in the list has a ring. */
function cmpGlow(c, out) {
  const k = 1 / view.scale, H = state.sheetH;
  out.push(s('defs', null, s('radialGradient', { id: 'cmp-glow' }, s('stop', { offset: 0, class: 'cmp-g0' }), s('stop', { offset: 1, class: 'cmp-g1' }))));
  for (const x of c.res.diffs) {
    const cx = (x.box[0] + x.box[2]) / 2, cy = H - (x.box[1] + x.box[3]) / 2, r = Math.max(16 * k, Math.hypot(x.box[2] - x.box[0], x.box[3] - x.box[1]) / 2 + 10 * k);
    out.push(s('circle', { class: 'cmp-glow' + (c.sel === x.n ? ' on' : ''), cx, cy, r, fill: 'url(#cmp-glow)', 'data-testid': 'cmp-glow' }),
      s('g', { class: 'pick-badge' }, s('circle', { cx, cy: cy - r, r: 11 * k }), s('text', { x: cx, y: cy - r + 4.5 * k, 'text-anchor': 'middle', 'font-size': 13 * k }, String(x.n))));
  }
}

/** Manual line up: dragging on the canvas moves drawing 2 (the differences are worked out again on release). */
function cmpDown(e) {
  const d = cmpDoc(), c = d && d.cmp;
  if (!c || c.mode !== 'manual' || !c.b) return false;
  const p0 = sheetAt(e.clientX, e.clientY), m0 = [...c.off];
  c.moving = true;
  const move = (ev) => { const p = sheetAt(ev.clientX, ev.clientY); c.manual = [m0[0] + p[0] - p0[0], m0[1] + p[1] - p0[1]]; c.off = cmpOff(c); paintOverlay(); };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); c.moving = false; cmpRun(d); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  return true;
}
/** Manual line up: the arrow keys nudge drawing 2 by the toolbar's step. */
function cmpKey(e, mod) {
  const d = cmpDoc(), c = d && d.cmp, dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
  if (!c || c.mode !== 'manual' || !c.b || !dir || mod || e.altKey) return false;
  e.preventDefault();
  c.manual = [PL.r6(c.off[0] + dir[0] * state.nudge), PL.r6(c.off[1] + dir[1] * state.nudge)];
  cmpRun(d);
  note(`Drawing 2 nudged ${state.nudge} mm`);
  return true;
}
function cmpCommand(c) {
  const n = c.res ? c.res.diffs.length : 0, nm = (sd, col) => (sd ? sd.name : '(none)') + ` (${C.COLOURS.find((k) => k.id === col).label.toLowerCase()})`;
  ui.hist.textContent = `Command: COMPARE   ${nm(c.a, c.ca)} vs ${nm(c.b, c.cb)} · tolerance ${c.tol} mm · ` + (c.res ? `${n} difference${n === 1 ? '' : 's'}` : 'choose two drawings');
  ui.prompt.textContent = state.msg ? state.msg : n ? `Zoom to a difference: click it in the panel (1-${n}):` : 'Line up, Tolerance and Show differences are in the panel:';
}

async function init() {
  guardClose();
  let shortcutError = '';
  try {
    const saved = (await shortcutStore.all()).find((r) => r.id === 'own');
    const loaded = SC.bindings(saved?.overrides);
    if (SC.clashes(loaded).length) shortcutError = 'Saved shortcuts have conflicts; defaults are active. Import a corrected PGP to change them.';
    else { ownBindings = loaded; ownCommands = SC.commandsFor(loaded); }
  } catch (err) { shortcutError = 'Could not load shortcuts; defaults are active: ' + (err.message || err); }
  const app = document.getElementById('app');
  state.contourCfg = loadContourCfg();
  state.text.cfg = loadTextCfg();
  state.dimStyles = loadDimStyles();
  try { const v = localStorage.getItem('pd-dimtype'); if (DIM_TYPES.some((x) => x[0] === v)) state.dimType = v; } catch { /* ignore */ }
  const cmdLog = buildCommand();                           // before the canvas: the bar, the fade and the history sit on it
  const balDock = buildBalloonDock();                      // before the canvas: its picture-only chip and sheet switcher sit on the canvas
  app.append(h('div', { class: 'shell' },
    buildMenus(), buildTabs(), buildPropbar(), buildSelbar(), buildTextbar(),
    h('div', { class: 'main' }, buildRail(), buildCanvas(), buildPanel()),
    balDock, cmdLog, buildStatus()));
  renderTabs();
  attachDrop();
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.pop-back, .pdlg-back')) return;                       // a dialog is open: its keys are its own, the drawing behind it waits
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(e.shiftKey); }
    editKey(e);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { cssCache = null; paintOverlay(); renderLayers(); });
  try { const t = localStorage.getItem('pd-theme'); if (t) setTheme(t); } catch { /* ignore */ }
  let dp = 2;
  try { const v = localStorage.getItem('pd-decimals'); if (v != null) dp = +v; } catch { /* ignore */ }
  state.dp = Math.max(0, Math.min(4, Math.round(dp) || 0)); ui.dp.value = String(state.dp);
  try { const v = PL.parseMm(localStorage.getItem('pd-gaptol') || ''); if (v != null && v > 0 && v <= 5) state.gapMm = v; } catch { /* ignore */ }
  try { const v = PL.parseMm(localStorage.getItem('pd-nudge') || ''); if (v != null && v > 0) state.nudge = v; } catch { /* ignore */ }
  try { if (localStorage.getItem('pd-rulers') === '0') state.rulers = false; } catch { /* ignore */ }
  try { if (localStorage.getItem(PROPS_SAVED) === '1') state.propsOn = true; } catch { /* ignore */ }
  ui.dp.addEventListener('change', () => setDecimals(ui.dp.value));
  syncFields(); applyKind();
  update(true);
  setTool('select');
  if (shortcutError) note(shortcutError);
  libInit();
  const every = Number(new URLSearchParams(location.search).get('autosave'));
  setInterval(autosaveNow, every >= 100 ? every : 120000);
  ownsRecovery().then((own) => { if (own) offerRecovery(); });
}

init();
