// The floating command bar (TODO 47, mock-up R12b Option B): the bar at the cursor, the last three command lines at the bottom centre
// of the canvas, the F2 history drawer, and the echo button of the status bar. The logic is in cmdbar.js (pure); this is the DOM.
// Text from a file only ever goes in with textContent / h().
import { h } from './dom.js';
import * as CB from './cmdbar.js';

const NS = 'http://www.w3.org/2000/svg';
const VALUED = /^(distance|steps|height|justify|style)$/i;       // the option words that take a value
const PATH = {
  term: 'M4 6l6 6-6 6M12 18h8', search: 'M5 11a6 6 0 1 0 12 0a6 6 0 1 0-12 0M16 16l4 4', close: 'M6 6l12 12M18 6L6 18',
  Draw: 'M4 20l4-1 11-11-3-3L5 16z', Annotate: 'M4 8v10M20 8v10M4 13h16', Edit: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5',
  Layout: 'M5 5h8v8H5zM15 11l4 4-4 4', View: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0', File: 'M6 3h9l4 4v14H6zM9 12h7M9 16h5',
};
function svg(name, size = 14) {
  const el = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) el.setAttribute(k, String(v));
  p.setAttribute('d', PATH[name] || PATH.term);
  el.append(p);
  return el;
}

/**
 * hooks: tab() → 'draw' | 'layout', active() → { label, prompt } | null (a command is on), submit(text) (the text goes to the command that is on, or
 * starts one), runName(name) (start a command by its name), canvas() → the canvas element, previewBounds() → a list of canvas-pixel boxes, say(text).
 */
export function buildCmdUI(hooks) {
  const resolve = (text, tab = '') => CB.resolve(text, tab, hooks.commands());
  const suggest = (text, tab = '') => CB.suggest(text, tab, 6, hooks.commands());
  const lines = [], typed = [];                // the session's command lines { pre, ans, cls, run } (not saved), and what was typed at the bar
  let lastName = '', echoName = '', echoAns = [], hi = 0, sugg = [], recall = -1, ptr = null, anchor = { x: 0, y: 0 }, cur = anchor, idle = 0;
  let corner = null, nudge = null;

  // the log the rest of the app writes to (tests and screen readers read these two); the sight of them is the fade and the drawer
  const hist = h('div', { class: 'sr-only', 'data-testid': 'cmd-hist' });
  const prompt = h('span', { class: 'sr-only', 'data-testid': 'cmd-prompt', 'aria-live': 'polite' });
  const log = h('div', { class: 'sr-only-box' }, hist, prompt);

  const input = h('input', { type: 'text', 'aria-label': 'Command line', autocomplete: 'off', spellcheck: 'false', 'data-testid': 'cmd-input' });
  const lab = h('span', { class: 'cb-lab', hidden: true });
  const promptEl = h('div', { class: 'cb-prompt', hidden: true, 'data-testid': 'cmd-bar-prompt' });
  const chips = h('div', { class: 'cb-chips', hidden: true });
  const rows = h('div', { class: 'cb-rows', hidden: true, role: 'listbox', 'aria-label': 'Commands' });
  const foot = h('div', { class: 'cb-foot' });
  const bar = h('div', { class: 'cbar', hidden: true, role: 'dialog', 'aria-label': 'Command bar', 'data-testid': 'cmd-bar' },
    h('div', { class: 'cb-in' }, svg('term'), lab, input, h('kbd', null, 'Esc')), promptEl, chips, rows, foot);

  const acts = h('div', { class: 'cb-acts' });
  const fadeRows = h('div', { class: 'cb-fade-rows' });
  const fade = h('div', { class: 'cfade', 'aria-label': 'Recent command lines', 'data-testid': 'cmd-fade' }, acts, fadeRows);

  const filter = h('input', { type: 'text', placeholder: 'Filter history…', 'aria-label': 'Filter history', autocomplete: 'off', spellcheck: 'false' });
  const body = h('div', { class: 'cb-drb', 'data-testid': 'cmd-history-lines' });
  const drawer = h('aside', { class: 'cdrawer', hidden: true, 'aria-label': 'Command history', 'data-testid': 'cmd-history' },
    h('div', { class: 'cb-drh' }, svg('term'), h('h2', null, 'Command history'), h('kbd', null, 'F2'),
      h('button', { class: 'cb-ib', type: 'button', 'aria-label': 'Close the history', onclick: () => toggleHistory(false) }, svg('close'))),
    h('label', { class: 'cb-fs' }, svg('search', 12), filter),
    body,
    h('div', { class: 'cb-drh cb-drf' }, h('button', { class: 'btn sm', type: 'button', 'data-testid': 'cmd-copy', onclick: copyHistory }, 'Copy history'), h('span', { class: 'lbl' }, 'Click a line to run it again')));

  const echoSpan = h('span', { class: 'cb-echo-text' }, 'Command');
  const echo = h('button', { class: 'cb-echo', type: 'button', 'aria-label': 'Open the command bar', title: 'Open the command bar (or just start typing on the drawing)', 'data-testid': 'cmd-echo', onclick: () => open('') }, svg('term', 12), echoSpan);
  const hint = h('span', { class: 'lbl cb-hint' }, 'Just start typing on the drawing · ', h('kbd', null, 'F2'), ' history');

  const hiName = () => (sugg[hi] ? sugg[hi].cmd.name : '');
  const labelOf = (name) => name.toUpperCase();

  /** A box stays where it opened; only a tool preview that starts to cover it sends it to the first clear corner round the cursor now. */
  function placeBox(box, previous) {
    const r = hooks.canvas().getBoundingClientRect(), size = { w: box.offsetWidth, h: box.offsetHeight }, area = { w: r.width, h: r.height }, avoid = hooks.previewBounds();
    const p = CB.placeBox(anchor, cur, size, area, avoid, previous);
    anchor = p.anchor;
    box.style.left = p.x + 'px'; box.style.top = p.y + 'px';
    return p.corner;
  }
  function place() {
    if (!bar.hidden) corner = placeBox(bar, corner);
    if (nudge) nudge.corner = placeBox(nudge.box, nudge.corner);
  }

  /** The bar shows what the text means now: the command that is on with its prompt and option chips, and the commands the text could be. */
  function update() {
    const act = hooks.active(), tab = hooks.tab(), text = input.value.trim();
    let def;
    const opts = act ? CB.parseOptions(act.prompt) : [], hit = CB.matchOption(opts, text);
    lab.hidden = !act; if (act) lab.textContent = act.label;
    promptEl.hidden = !act; promptEl.textContent = act ? act.prompt : '';
    chips.hidden = !opts.length;
    chips.replaceChildren(...opts.map((o) => h('button', { class: 'chip' + (o === hit ? ' hit' : ''), type: 'button', 'aria-label': 'Option ' + o.word, 'data-testid': 'cmd-chip', onmousedown: (e) => e.preventDefault(), onclick: () => chip(o) }, h('b', null, o.key), o.rest)));
    sugg = hit ? [] : suggest(input.value, tab);
    hi = Math.max(0, Math.min(hi, sugg.length - 1));
    rows.hidden = !sugg.length;
    rows.replaceChildren(...sugg.map((s, i) => h('div', { class: 'r' + (i === hi ? ' hi' : '') + (s.cmd.where && s.cmd.where !== tab ? ' off' : ''), role: 'option', 'aria-selected': String(i === hi), 'data-testid': 'cmd-sugg', onmousedown: (e) => e.preventDefault(), onclick: () => go(s.cmd.name) },
      svg(s.cmd.cat), h('span', { class: 'nm' }, h('b', null, s.cmd.name.slice(0, s.hit)), s.cmd.name.slice(s.hit)), s.alias ? h('kbd', null, s.alias) : null, h('span', { class: 'ds' }, s.cmd.desc), h('span', { class: 'ct' }, s.cmd.cat))));
    foot.replaceChildren(...(sugg.length
      ? [h('span', null, h('kbd', null, '↑'), h('kbd', null, '↓'), ' choose'), h('span', null, h('kbd', null, 'Tab'), ' or ', h('kbd', null, 'Enter'), ' accept'), lastName ? h('span', null, h('kbd', null, 'Space'), ' on an empty bar repeats ' + labelOf(lastName)) : null]
      : act ? [h('span', null, /angle/i.test(act.prompt) ? 'Type an angle, ' : 'Type a value, ', h('kbd', null, 'x,y'), ', ', h('kbd', null, '@dx,dy'), ' or ', h('kbd', null, '@len<angle')),
        (def = /<([^<>]+)>/.exec(act.prompt)) ? h('span', null, h('kbd', null, 'Enter'), ' takes <' + def[1] + '>') : h('span', null, h('kbd', null, 'Enter'), ' finishes the step')]
        : [h('span', null, 'Type a command or its alias, e.g. ', h('kbd', null, 'L'), ' ', h('kbd', null, 'OFFSET')), lastName ? h('span', null, h('kbd', null, 'Space'), ' repeats ' + labelOf(lastName)) : null]));
    place();
  }

  function open(seed = '') {
    const r = hooks.canvas().getBoundingClientRect();
    anchor = cur = ptr ? { x: ptr.x - r.left, y: ptr.y - r.top } : { x: r.width / 2, y: r.height / 2 };
    corner = null;
    bar.hidden = false; input.value = seed; hi = 0; recall = -1;
    update(); input.focus(); input.setSelectionRange(seed.length, seed.length);
    fadeUp();
  }
  function close() {
    if (bar.hidden) return;
    bar.hidden = true; input.value = '';
    if (document.activeElement === input) input.blur();
    fadeUp();
  }

  function openNudge(step, apply) {
    close();
    const field = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': 'Nudge step in mm', 'data-testid': 'nudge-input', value: step });
    const error = h('div', { class: 'cb-prompt', role: 'status', hidden: true });
    const box = h('div', { class: 'cbar nudgebox', role: 'dialog', 'aria-label': 'Nudge step', 'data-testid': 'nudge-box' },
      h('label', { class: 'cb-in' }, h('span', { class: 'cb-lab' }, 'Nudge (mm)'), field, h('kbd', null, 'Esc')), error);
    const finish = () => { field.removeEventListener('blur', finish); box.remove(); nudge = null; };
    const canvas = hooks.canvas(), r = canvas.getBoundingClientRect();
    canvas.append(box);
    anchor = cur = ptr ? { x: ptr.x - r.left, y: ptr.y - r.top } : { x: r.width / 2, y: r.height / 2 };
    nudge = { box, corner: null }; place();
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'dblclick', 'contextmenu']) box.addEventListener(ev, (e) => e.stopPropagation());
    field.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { finish(); return; }
      const why = apply(field.value);
      if (!why) { finish(); return; }
      hooks.say(why); error.textContent = why; error.hidden = false;
      place();
      field.setAttribute('aria-invalid', 'true'); field.select();
    });
    field.addEventListener('blur', finish);
    field.focus(); field.select();
  }

  function addLine(pre, ans, cls, run) {
    if (!cls && /cancel|unknown|must |cannot|can't|failed/i.test(pre)) cls = 'er';
    lines.push({ pre, ans: ans || '', cls: cls || '', run: run || '' });
    if (lines.length > 1000) lines.shift();
    if (cls === 'cm') { echoName = resolve(ans) ? resolve(ans).name.toUpperCase() : String(ans).toUpperCase(); echoAns = []; }
    else if (ans && echoName) echoAns = [...echoAns, ans].slice(-2);       // the command and its last two answers, as the mock-up's "OFFSET  5  ·  Exit"
    echoSpan.textContent = echoName ? [echoName, echoAns.join('  ·  ')].filter(Boolean).join('  ') : 'Command';
    echo.title = echoSpan.textContent;
    paintFade();
    if (!drawer.hidden) paintDrawer();
  }
  function paintFade() {
    const f = CB.fadeOf(lines);
    fadeRows.replaceChildren(...f.map((l) => h('div', { class: 'o' + l.age + (l.cls === 'er' ? ' er' : ''), title: l.pre + (l.ans ? ' ' + l.ans : '') }, h('span', null, l.pre), l.ans ? h('span', { class: 'ans' }, l.ans) : null)));
    fadeUp();
  }
  /** The lines show for a while after a change (an error 9 s, so it can be read), then fade away; they stay while the bar or the drawer is open. */
  function fadeUp() {
    fade.classList.remove('idle');
    clearTimeout(idle);
    idle = setTimeout(() => { if (bar.hidden && drawer.hidden) fade.classList.add('idle'); }, lines.length && lines[lines.length - 1].cls === 'er' ? 9000 : 3000);
  }

  /** A line the bar sends: a picked option, a typed answer, a command by name or a highlighted suggestion. */
  function go(raw) {
    const text = String(raw).trim(), act = hooks.active(), tab = hooks.tab();
    const picked = act ? CB.matchOption(CB.parseOptions(act.prompt), text) : null;
    if (!text) {
      if (act) { addLine(act.prompt, '↵'); close(); hooks.submit(''); return; }
      if (lastName) { addLine('Command:', '↵ (repeats ' + labelOf(lastName) + ')', 'cm', lastName); close(); hooks.runName(lastName); return; }
      close(); return;
    }
    if (picked && VALUED.test(picked.word)) { chip(picked); return; }       // it needs a value: the bar waits for it, as the chip does
    let send = text;
    if (picked) send = picked.word.toLowerCase();
    else if (!act && /^[a-z][a-z0-9]*$/i.test(text) && !resolve(text, tab)) { const s = suggest(text, tab); if (s.length && s[Math.min(hi, s.length - 1)].hit) send = s[Math.min(hi, s.length - 1)].cmd.name; }
    const isCmd = !picked && !!resolve(send, tab);
    addLine(act && !isCmd ? act.prompt : 'Command:', text, act && !isCmd ? '' : 'cm', isCmd ? send : '');
    if (typed[typed.length - 1] !== text) typed.push(text);
    close(); hooks.submit(send);
  }
  /** A chip: a word that needs a value waits in the bar for it, any other goes at once. */
  function chip(o) {
    if (VALUED.test(o.word)) { input.value = o.word.toLowerCase() + ' '; hi = 0; update(); input.focus(); return; }
    go(o.word);
  }

  input.addEventListener('input', () => { hi = 0; recall = -1; update(); });
  input.addEventListener('keydown', (e) => {
    const act = hooks.active();
    if (e.key === 'Enter') { e.preventDefault(); go(input.value); }
    else if (e.key === 'Tab') { e.preventDefault(); if (sugg.length) { input.value = hiName(); update(); } }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (sugg.length) { hi = (hi + (e.key === 'ArrowDown' ? 1 : sugg.length - 1)) % sugg.length; update(); }
      else if (typed.length && e.key === 'ArrowUp') { recall = Math.min(typed.length - 1, recall + 1); input.value = typed[typed.length - 1 - recall]; update(); }
      else if (e.key === 'ArrowDown' && recall >= 0) { recall--; input.value = recall >= 0 ? typed[typed.length - 1 - recall] : ''; update(); }
    } else if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.metaKey && CB.spaceIsEnter(input.value, act && act.label, hooks.tab(), hooks.commands())) { e.preventDefault(); go(input.value); }
  });
  for (const el of [bar, drawer, acts]) for (const ev of ['pointerdown', 'pointermove', 'wheel', 'dblclick', 'contextmenu']) el.addEventListener(ev, (e) => e.stopPropagation());       // the canvas under them gets none of it
  bar.addEventListener('focusout', () => setTimeout(() => { if (!bar.hidden && !bar.contains(document.activeElement)) close(); }));

  // every message the app puts in the prompt line is a line of the history (a moving readout settles first)
  let wait = 0, lastPrompt = '';
  new MutationObserver(() => {
    clearTimeout(wait);
    wait = setTimeout(() => { const t = prompt.textContent.trim(); if (t && t !== lastPrompt) { lastPrompt = t; addLine(t); } }, 350);
  }).observe(prompt, { childList: true, characterData: true, subtree: true });

  function paintDrawer() {
    body.replaceChildren(...CB.filterLines(lines, filter.value).map((l) => h('div', { class: 'hl ' + l.cls + (l.run ? ' run' : ''), title: l.run ? 'Run ' + l.run.toUpperCase() + ' again' : null, 'data-testid': 'cmd-history-line', onclick: () => { if (l.run) go(l.run); } },
      h('span', null, l.pre), l.ans ? h('span', { class: 'ans' }, l.ans) : null)));
    body.scrollTop = body.scrollHeight;
  }
  filter.addEventListener('input', paintDrawer);
  filter.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); toggleHistory(false); } });       // Esc in the filter shuts the drawer (the page's Esc ignores fields)
  function toggleHistory(on = drawer.hidden) {
    drawer.hidden = !on;
    if (on) { paintDrawer(); fadeUp(); filter.focus(); }
    else if (document.activeElement === filter) filter.blur();
  }
  async function copyHistory() {
    try { await navigator.clipboard.writeText(CB.linesText(lines)); hooks.say(`History copied: ${lines.length} lines`); } catch { hooks.say('Could not copy: select the lines in the history and copy them'); }
  }

  return {
    hist, prompt, log, input, bar, fade, drawer, acts, echo, hint,
    open, close, openNudge, toggleHistory, go, place,
    isOpen: () => !bar.hidden, historyOpen: () => !drawer.hidden,
    /** A command ran (by its name): Space on an empty bar repeats it. */
    ran: (name) => { lastName = name; },
    lastName: () => lastName,
    pointer: (x, y) => {
      ptr = { x, y };
      if (!bar.hidden || nudge) {
        const r = hooks.canvas().getBoundingClientRect();
        cur = { x: x - r.left, y: y - r.top };
      }
    },
    /** Space on the drawing with the bar shut: the last command again. */
    repeat: () => { if (lastName) go(''); },
    /** Esc: the bar shuts (and the command is cancelled by the caller); with only the drawer open it shuts. → 'bar' | 'drawer' | '' */
    escape: () => { if (!bar.hidden) { close(); return 'bar'; } if (!drawer.hidden) { toggleHistory(false); return 'drawer'; } return ''; },
    lines: () => lines,
    refresh: () => { if (!bar.hidden) update(); },
  };
}
