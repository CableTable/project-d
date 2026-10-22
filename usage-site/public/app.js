
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp, getDocFromServer } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js';
import { codexWindow, resetLabel } from './usage-window.js';
import { firebaseConfig } from './firebase-config.js';
import { cumulativeTokens, resetTimes, tokenEndLabels } from './token-chart.js';

const AGENT_COLOR = { Rook: 'var(--ud-rook)', Pip: 'var(--ud-pip)', Rowan: 'var(--ud-rowan)', Bishop: 'var(--ud-pip)', Knight: 'var(--ud-rowan)' };
const ORDER = ['Rook', 'Pip', 'Rowan'];
const label = (text) => String(text).replace(/\bPip\b/g, 'Bishop').replace(/\bRowan\b/g, 'Knight');
const IST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
const chartDate = (time) => DAY.format(new Date(time)).replace(' ', '-').slice(0, 6);
const compact = (n) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const num = (x) => (x === '' || x == null ? null : Number(x));

let data = { limits: [], history: [], runs: [], analysis: [], tickets: [], tokens: [] };
function paceRows() {
  return data.limits.map((r) => ({ agent: r.agent, window: r.window,
    pace_pct: Math.round(Math.max(0, Math.min(1, (Date.parse(r.as_of) - Date.parse(r.starts)) / (Date.parse(r.resets) - Date.parse(r.starts)))) * 100) }));
}
function forecasts() {
  return data.limits.filter((r) => r.window === 'week').map((r) => {
    const s = Date.parse(r.starts), e = Date.parse(r.resets), a = Date.parse(r.as_of), used = Number(r.used_pct);
    const at_reset_pct = a - s < 12 * 3600e3 || used <= 0 ? null : Math.round(used * (e - s) / (a - s));
    return { agent: r.agent, at_reset_pct, hit_at: at_reset_pct >= 100 ? new Date(s + (a - s) * 100 / used).toISOString() : null };
  });
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = label(text); return e; };
const mark = (e, src, field, where) => { e.dataset.source = src; e.dataset.field = field; if (where) e.dataset.where = where; return e; };
const wh = (a, w) => 'agent=' + encodeURIComponent(a) + '&window=' + encodeURIComponent(w);

function setPage(name) {
  if (!['usage', 'todo', 'tickets'].includes(name)) name = 'usage';
  document.querySelectorAll('[data-page]').forEach((page) => { page.hidden = page.id !== name; });
  document.querySelectorAll('[data-tab]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.tab === name));
  try { localStorage.setItem('usage-tab', name); } catch { /* Private browsing can deny storage. */ }
  if (name === 'usage') { drawChart(data.history); drawTokenChart(); }
}
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.tab)));
let savedPage = 'usage';
try { savedPage = localStorage.getItem('usage-tab'); } catch { /* Use Usage when storage is unavailable. */ }
setPage(savedPage);

let win = 'week';
const btnW = document.getElementById('w-week'), btn5 = document.getElementById('w-5h');
const setWin = (w) => { win = w; btnW.setAttribute('aria-pressed', w === 'week'); btn5.setAttribute('aria-pressed', w === '5h'); draw(); };
btnW.addEventListener('click', () => setWin('week'));
btn5.addEventListener('click', () => setWin('5h'));
let query = '';
document.getElementById('q').addEventListener('input', (e) => { query = e.target.value.toLowerCase(); draw(); });

function status(used, pace, cap) {
  if (cap != null && used >= cap) return ['bad', 'At today’s cap'];
  if (used >= 85) return ['bad', 'Near the limit'];
  if (used > pace + 10) return ['warn', 'Ahead of even use'];
  return ['ok', 'Within pace'];
}

function drawAgents(limits, pace) {
  const box = document.getElementById('agents');
  box.replaceChildren();
  const pk = new Map(pace.map((p) => [p.agent + '|' + p.window, p.pace_pct]));
  const fk = new Map(forecasts().map((f) => [f.agent, f]));
  ORDER.forEach((a) => {
    const rows = limits.filter((r) => r.agent === a);
    if (!rows.length) return;
    const card = el('div', 'ud-card');
    const head = el('div', 'ud-agent');
    const t = el('div'); t.append(el('h3', null, a)); t.append(mark(el('p', 'ud-muted', rows[0].role + ' · ' + rows[0].model), 'limits', 'role', 'agent=' + a + '&window=' + rows[0].window));
    t.lastChild.textContent = a === 'Rowan' ? 'Builder and web research (Codex)' : label(rows[0].role); head.append(t);
    head.append(mark(el('span', 'ud-muted', rows[0].model), 'limits', 'model', wh(a, rows[0].window)));
    card.append(head);
    ['5h', 'week'].forEach((w) => {
      const r = rows.find((x) => x.window === w); if (!r) return;
      const [used, resets] = a === 'Rowan' ? codexWindow([Number(r.used_pct), r.resets ? Date.parse(r.resets) / 1000 : null]) : [Number(r.used_pct), Date.parse(r.resets) / 1000];
      const p = resets == null ? null : pk.get(a + '|' + w), cap = num(r.cap_pct);
      const m = el('div', 'ud-meter');
      const top = el('div', 'ud-mrow');
      const left = el('div');
      left.append(el('span', 'ud-muted', w === '5h' ? '5-hour window ' : 'Week '));
      const big = el('div', 'ud-big'); big.append(mark(el('span', null, String(used)), 'limits', 'used_pct', wh(a, w)), document.createTextNode('%'));
      left.append(big); top.append(left);
      const [cls, label] = status(used, p ?? 0, cap);
      top.append(el('span', 'ud-chip ' + cls, label));
      m.append(top);
      const tr = el('div', 'ud-track');
      const f = el('div', 'ud-fill'); f.style.width = Math.min(100, used) + '%'; f.style.background = cls === 'bad' ? 'var(--cds-chart-status-critical)' : AGENT_COLOR[a];
      tr.append(f);
      if (p != null) { const k = el('div', 'ud-tick'); k.style.left = 'calc(' + p + '% - 1px)'; k.title = 'Even use'; tr.append(k); }
      if (cap != null) { const k = el('div', 'ud-tick cap'); k.style.left = 'calc(' + cap + '% - 1px)'; tr.append(k); }
      m.append(tr);
      const foot = el('div', 'ud-mrow ud-muted');
      const fl = el('span'); fl.append(document.createTextNode('Even use: '), mark(el('span', null, String(p ?? '—')), 'pace', 'pace_pct', wh(a, w)), document.createTextNode('%'));
      if (cap != null) { fl.append(document.createTextNode(' · cap today: '), mark(el('span', null, String(cap)), 'limits', 'cap_pct', wh(a, w)), document.createTextNode('%')); }
      foot.append(fl);
      const rs = mark(el('span', null, resetLabel(resets, (s) => (w === '5h' ? HM : IST).format(new Date(s * 1000)))), 'limits', 'resets', wh(a, w));
      foot.append(rs);
      m.append(foot);
      const fc = resets != null && w === 'week' && fk.get(a);
      if (fc) {
        const fp = el('div', 'ud-mrow');
        const s = el('span');
        if (fc.hit_at) {
          s.append(document.createTextNode('At this pace: hits 100% '), mark(el('b', 'ud-hit', IST.format(new Date(fc.hit_at))), 'forecast', 'hit_at', 'agent=' + encodeURIComponent(a)), document.createTextNode(', before the reset'));
        } else if (fc.at_reset_pct != null) {
          s.append(document.createTextNode('At this pace: about '), mark(el('b', null, String(fc.at_reset_pct)), 'forecast', 'at_reset_pct', 'agent=' + encodeURIComponent(a)), document.createTextNode('% at the reset'));
        } else s.append(el('span', 'ud-muted', 'At this pace: too early in the week to tell'));
        fp.append(s);
        m.append(fp);
      }
      card.append(m);
    });
    box.append(card);
  });
}

function drawTake(limits, pace) {
  const p = document.getElementById('takeaway');
  p.replaceChildren();
  const pk = new Map(pace.map((x) => [x.agent + '|' + x.window, x.pace_pct]));
  const wk = limits.filter((r) => r.window === 'week').map((r) => ({ r, gap: Number(r.used_pct) - (pk.get(r.agent + '|week') ?? 0) }));
  if (!wk.length) return;
  wk.sort((a, b) => b.gap - a.gap);
  const top = wk[0].r;
  p.append(document.createTextNode(label(top.agent) + ' is the one to watch: '),
    mark(el('b', null, top.used_pct), 'limits', 'used_pct', wh(top.agent, 'week')), document.createTextNode('% of its week used, with '),
    mark(el('b', null, String(pk.get(top.agent + '|week'))), 'pace', 'pace_pct', wh(top.agent, 'week')), document.createTextNode('% of the week gone. '));
  const pip = limits.find((r) => r.agent === 'Pip' && r.window === 'week');
  if (pip && pip.cap_pct !== '') {
    p.append(document.createTextNode('Bishop is at '), mark(el('b', null, pip.used_pct), 'limits', 'used_pct', wh('Pip', 'week')),
      document.createTextNode('% against today’s cap of '), mark(el('b', null, pip.cap_pct), 'limits', 'cap_pct', wh('Pip', 'week')), document.createTextNode('%.'));
  }
}

function drawChart(hist) {
  const box = document.getElementById('chart'); box.replaceChildren();
  const rows = hist.filter((r) => r.window === win).map((r) => ({ t: Date.parse(r.when), agent: r.agent, v: Number(r.used_pct) }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.v));
  if (!rows.length) { box.append(el('p', 'ud-muted', 'No readings yet.')); return; }
  const W = Math.max(260, box.clientWidth), H = 240, left = 34, right = W - 88;
  const min = Math.min(...rows.map((r) => r.t)), max = Math.max(...rows.map((r) => r.t));
  const x = (t) => left + (t - min) / (max - min || 1) * (right - left);
  const y = (v) => 214 - Math.max(0, Math.min(100, v)) * 2;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Usage readings over time in IST'); box.append(svg);
  function add(tag, attrs, text, parent = svg) {
    const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text != null) node.textContent = label(text);
    parent.append(node); return node;
  }
  for (const v of [0, 25, 50, 75, 100]) {
    add('line', { x1: left, x2: right, y1: y(v), y2: y(v), stroke: 'var(--cds-chart-grid)' });
    add('text', { x: left - 5, y: y(v) + 4, 'text-anchor': 'end' }, v + '%');
  }
  for (let i = 0; i < (min === max ? 1 : 3); i++) {
    const t = min + (max - min) * i / 2;
    add('text', { x: x(t), y: 234, 'text-anchor': 'middle' }, chartDate(t));
  }
  const ends = [];
  for (const agent of ORDER) {
    const pts = rows.filter((r) => r.agent === agent).sort((a, b) => a.t - b.t);
    if (!pts.length) continue;
    add('polyline', { points: pts.map((p) => x(p.t) + ',' + y(p.v)).join(' '), fill: 'none', stroke: AGENT_COLOR[agent], 'stroke-width': 2 });
    for (const p of pts) {
      const dot = add('circle', { cx: x(p.t), cy: y(p.v), r: 3, fill: AGENT_COLOR[agent] });
      add('title', {}, agent + ' ' + p.v + '% ? ' + chartDate(p.t) + ' ' + HM.format(new Date(p.t)) + ' IST', dot);
    }
    const last = pts.at(-1); ends.push({ agent, v: last.v, y: y(last.v) });
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);
  for (const end of ends) add('text', { x: right + 6, y: end.y + 4, style: 'fill:' + AGENT_COLOR[end.agent] }, end.agent + ' ' + end.v + '%');
}

function drawRuns(runs) {
  const tb = document.getElementById('runrows');
  tb.replaceChildren();
  const max = Math.max(0, ...runs.map((r) => Number(r.new_tokens || 0))) || 1;
  runs.filter((r) => !query || label([r.agent, r.task, r.kind, r.verdict, r.model].join(' ')).toLowerCase().includes(query))
    .forEach((r) => {
      const tr = el('tr'); tr.dataset.key = r.id;
      tr.append(el('td', null, r.session), el('td', null, r.agent));
      const task = el('td'); task.append(el('div', null, r.task)); task.append(el('div', 'ud-muted', r.model + ' · ' + r.kind)); tr.append(task);
      const nt = el('td', 'num');
      if (r.new_tokens !== '' && r.new_tokens != null) { const b = el('span', 'bar ' + r.agent.toLowerCase()); b.style.width = Math.max(2, (Number(r.new_tokens) / max) * 60) + 'px'; nt.append(b, document.createTextNode(compact(Number(r.new_tokens)))); } else nt.textContent = '—';
      tr.append(nt, el('td', 'num hide-narrow', compact(Number(r.total_tokens))), el('td', 'hide-narrow', r.verdict || ''));
      [...tr.children].forEach((td, i) => { td.dataset.label = ['Session', 'Agent', 'Task', 'New tokens', 'Total', 'Verdict'][i]; });
      tb.append(tr);
    });
}

function drawByAgent(rows) {
  const tb = document.getElementById('byagent'); tb.replaceChildren();
  rows.forEach((r) => { const tr = el('tr'); tr.append(el('td', null, String(r.session)), el('td', null, r.agent), el('td', 'num', String(r.runs)), el('td', 'num', compact(r.new_tokens))); tb.append(tr); });
}

function drawNotes(notes) {
  const tb = document.getElementById('notes'); tb.replaceChildren();
  notes.forEach((n) => {
    const tr = el('tr'); tr.dataset.key = n.id;
    const [topic, asOf] = [n.topic, n.as_of].map((text) => /^\d{4}-\d{2}-\d{2}T/.test(text) && Number.isFinite(Date.parse(text)) ? IST.format(new Date(text)) + ' IST' : text);
    const c = el('td'); c.append(el('div', null, topic), el('div', 'ud-muted', asOf));
    tr.append(c, el('td', null, n.note)); tb.append(tr);
  });
}

function drawTodo(sections) {
  const box = document.getElementById('todo-sections'); box.replaceChildren();
  if (!sections.length) box.append(el('p', 'ud-muted', 'No TODO uploaded yet.'));
  for (const section of sections) {
    const card = el('div', 'ud-card ud-todo');
    card.append(el('h3', null, section.title));
    const open = el('ul', 'ud-todo-list'), completed = el('ul', 'ud-todo-list');
    for (const item of section.items) {
      const row = el('li');
      const head = el('div', 'ud-todo-head');
      head.append(el('span', 'ud-muted', item.num + '.'), el('strong', null, item.title));
      if (item.size) head.append(el('span', 'ud-chip', item.size));
      row.append(head);
      if (item.text) row.append(el('p', 'ud-muted', item.text));
      (item.done ? completed : open).append(row);
    }
    if (open.childElementCount) card.append(open);
    else card.append(el('p', 'ud-muted', 'No open items.'));
    if (completed.childElementCount) {
      const details = el('details');
      details.append(el('summary', null, completed.childElementCount + ' done'), completed);
      card.append(details);
    }
    box.append(card);
  }
}

function drawTokenChart() {
  const box = document.getElementById('token-chart'), legend = document.getElementById('token-legend');
  box.replaceChildren(); legend.replaceChildren();
  const agents = ['Rook', 'Bishop', 'Knight'];
  for (const agent of agents) {
    const item = el('span'), dot = el('i'); dot.style.background = AGENT_COLOR[agent]; item.append(dot, document.createTextNode(agent)); legend.append(item);
  }
  if (!data.tokens.length) { box.append(el('p', 'ud-muted', 'No token data uploaded yet.')); return; }
  const W = Math.max(260, box.clientWidth), H = 240, left = 38, right = W - 70, bottom = 212;
  const rows = data.tokens, lastDay = Math.floor((rows.length - 1) / 24);
  const series = agents.map((agent) => ({ agent, values: cumulativeTokens(rows, agent, resetTimes(agent, data.limits, data.history, rows[0].t, rows.at(-1).t + 3600e3)) }));
  const max = Math.max(1, ...series.flatMap((line) => line.values));
  const step = (right - left) / Math.max(1, rows.length - 1);
  const labelEvery = Math.max(1, Math.ceil(60 / (24 * step)));
  const y = (value) => bottom - value / max * 190;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Tokens used, running total by Rook, Bishop and Knight over the last 14 days in IST, back to 0 at each weekly reset; input + output + cache creation; cache reads excluded');
  box.append(svg);
  function add(tag, attrs, text, parent = svg) {
    const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text != null) node.textContent = text;
    parent.append(node); return node;
  }
  for (const fraction of [0, .5, 1]) {
    const y = bottom - fraction * 190;
    add('line', { x1: left, x2: right, y1: y, y2: y, stroke: 'var(--cds-chart-grid)' });
    add('text', { x: left - 5, y: y + 4, 'text-anchor': 'end' }, compact(max * fraction));
  }
  const ends = [];
  for (const { agent, values } of series) {
    // A value below the one before is a reset: go straight down at the same x.
    const points = values.flatMap((value, i) => (i && value < values[i - 1] ? [[i, values[i - 1]]] : []).concat([[i, value]]));
    add('polyline', { class: 'token-line', points: points.map(([i, value]) => `${left + i * step},${y(value)}`).join(' '), stroke: AGENT_COLOR[agent] });
    values.forEach((value, i) => {
      if (i % 24 !== 23 && i !== values.length - 1) return; // one dot per day, with the day's closing total
      const dot = add('circle', { cx: left + i * step, cy: y(value), r: 2.5, fill: AGENT_COLOR[agent] });
      add('title', {}, `${chartDate(rows[i].t)} IST · ${agent}: ${value.toLocaleString('en')} tokens, running total`, dot);
    });
    ends.push({ agent, value: values.at(-1), y: y(values.at(-1)) });
  }
  const endX = left + (rows.length - 1) * step;
  for (const end of tokenEndLabels(ends, bottom)) {
    add('line', { x1: endX, y1: y(end.value), x2: endX + 8, y2: end.y, stroke: AGENT_COLOR[end.agent] });
    add('text', { class: 'token-end', x: endX + 12, y: end.y, 'dominant-baseline': 'middle', style: 'fill:' + AGENT_COLOR[end.agent] }, compact(end.value));
  }
  rows.forEach((row, i) => {
    if (i % 24 === 0 && (lastDay - i / 24) % labelEvery === 0) add('text', { x: left + i * step, y: 234, 'text-anchor': 'middle' }, chartDate(row.t));
  });
}

let ticketTag = 'All';
function drawTickets() {
  const filters = document.getElementById('ticket-tags'), box = document.getElementById('ticket-list');
  const tags = [...new Set(data.tickets.flatMap((row) => row.tags || []))].sort();
  if (!tags.includes(ticketTag)) ticketTag = 'All';
  filters.replaceChildren(); box.replaceChildren();
  for (const tag of ['All', ...tags]) {
    const button = el('button', null, tag); button.type = 'button'; button.setAttribute('aria-pressed', tag === ticketTag);
    button.addEventListener('click', () => { ticketTag = tag; drawTickets(); [...filters.children].find((b) => b.textContent === tag)?.focus(); });
    filters.append(button);
  }
  const rows = data.tickets.filter((row) => ticketTag === 'All' || row.tags.includes(ticketTag));
  if (!rows.length) { box.append(el('p', 'ud-muted', 'No tickets to show.')); return; }
  const card = el('div', 'ud-card'), table = el('table', 'ticket-table'), head = el('thead'), headings = el('tr'), body = el('tbody');
  for (const name of ['#', 'Status', 'Size', 'Type', 'Tags', 'Title', 'TODO', 'Updated']) headings.append(el('th', null, name));
  head.append(headings); table.append(head, body); card.append(table); box.append(card);
  for (const row of rows) {
    const tr = el('tr', 'ticket'); tr.dataset.id = row.id;
    const cell = (name, text) => { const td = el('td', null, text); td.dataset.label = name; tr.append(td); return td; };
    cell('#', row.id);
    const statusClass = /^(?:merged|checked in exe)/i.test(row.status) ? 'ok' : /^built/i.test(row.status) ? 'info' : /^(?:building|in TODO)/i.test(row.status) ? 'warn' : 'bad';
    cell('Status').append(el('span', 'ud-chip ' + statusClass, row.status));
    cell('Size', row.size); cell('Type', row.type); cell('Tags', row.tags.join(', '));
    const details = el('details'), summary = el('summary', null, row.title);
    details.append(summary, el('p', 'ticket-note', row.note || 'No note yet.')); cell('Title').append(details);
    cell('TODO', row.todo); cell('Updated', row.updated);
    tr.addEventListener('click', (event) => { if (!event.target.closest('summary, .ticket-note')) details.open = !details.open; });
    body.append(tr);
  }
}

function draw() {
  const times = data.limits.map((r) => Date.parse(r.as_of)).filter(Number.isFinite);
  document.getElementById('asof').textContent = times.length ? IST.format(new Date(Math.max(...times))) + ' IST' : '\u2014';
  const pace = paceRows();
  drawAgents(data.limits, pace); drawTake(data.limits, pace); drawChart(data.history); drawTokenChart();
  drawRuns(data.runs); drawNotes(data.analysis);
  const groups = new Map();
  for (const r of data.runs) {
    const key = r.session + '|' + r.agent;
    const group = groups.get(key) || { session: r.session, agent: r.agent, runs: 0, new_tokens: 0 };
    group.runs++; group.new_tokens += Number(r.new_tokens || 0); groups.set(key, group);
  }
  drawByAgent([...groups.values()].sort((a, b) => b.session - a.session || b.new_tokens - a.new_tokens));
}
const chartObserver = new ResizeObserver(() => { drawChart(data.history); drawTokenChart(); });
chartObserver.observe(document.getElementById('chart')); chartObserver.observe(document.getElementById('token-chart'));

const message = document.getElementById('message');
const signin = document.getElementById('signin'), signout = document.getElementById('signout');
const refreshButton = document.getElementById('refresh'), dashboard = document.getElementById('dashboard');
const pageTabs = document.querySelector('.page-tabs');
const lastUpdateLabel = document.getElementById('last-update'), offline = document.getElementById('offline');
const lastErrorLabel = document.getElementById('last-error');
let currentStatus = {}, pending = null, allowed = false;

function finishUpdate(text) {
  if (pending) clearTimeout(pending.timer);
  pending = null;
  refreshButton.disabled = !allowed;
  refreshButton.textContent = 'Update now';
  message.textContent = text;
}
function showStatus() {
  const last = currentStatus.lastUpdate?.toMillis();
  const heartbeat = currentStatus.agentHeartbeat?.toMillis();
  const errorAt = currentStatus.lastErrorAt?.toMillis();
  lastUpdateLabel.textContent = 'Last update: ' + (last ? IST.format(new Date(last)) + ' IST' : '—');
  lastErrorLabel.hidden = !allowed || !currentStatus.lastError;
  const shortError = currentStatus.lastError && /^(?:(?:Rook|Bishop|Knight) usage probe failed, exit (?:\d+|unknown)|(?:Main|Second) account: 100%, limit reached|Usage refresh failed; see the local agent log)$/.test(currentStatus.lastError)
    ? currentStatus.lastError : 'Usage refresh failed; see the local agent log';
  lastErrorLabel.textContent = currentStatus.lastError ? shortError : '';
  offline.hidden = !allowed || (heartbeat != null && Date.now() - heartbeat <= 180_000);
  if (pending?.requestedAt != null && last > pending.requestedAt) finishUpdate('Updated.');
  else if (pending?.requestedAt != null && errorAt > pending.requestedAt) finishUpdate('');
}
setInterval(showStatus, 10_000);

if (Object.values(firebaseConfig).some((v) => v.includes('<'))) {
  message.textContent = 'Setup needed: fill the placeholders in firebase-config.js.';
  signin.disabled = true;
} else {
  const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app);
  const provider = new GoogleAuthProvider();
  let subscriptions = [];
  function stopListening() { subscriptions.forEach((stop) => stop()); subscriptions = []; }
  function report(error) {
    if (error.code === 'permission-denied' && auth.currentUser) {
      allowed = false; dashboard.hidden = pageTabs.hidden = true; stopListening();
      finishUpdate('Not allowed. Your uid: ' + auth.currentUser.uid);
      showStatus();
    } else finishUpdate('Could not load/update usage: ' + error.message);
  }
  signin.addEventListener('click', async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      const phone = matchMedia('(pointer: coarse)').matches;
      if (error.code === 'auth/popup-blocked' || (phone && ['auth/popup-closed-by-user', 'auth/operation-not-supported-in-this-environment'].includes(error.code))) {
        try { await signInWithRedirect(auth, provider); } catch (e) { report(e); }
      } else if (error.code !== 'auth/popup-closed-by-user') report(error);
    }
  });
  signout.addEventListener('click', () => signOut(auth).catch(report));
  getRedirectResult(auth).catch(report);
  onAuthStateChanged(auth, (user) => {
    stopListening(); allowed = false; currentStatus = {};
    data = { limits: [], history: [], runs: [], analysis: [], tickets: [], tokens: [] };
    drawTodo([]); drawTickets();
    draw(); finishUpdate(user ? 'Loading…' : 'Sign in to see usage.');
    dashboard.hidden = pageTabs.hidden = true; signin.hidden = !!user; signout.hidden = !user; showStatus();
    if (!user) return;
    for (const name of ['limits', 'history', 'runs', 'analysis', 'todo', 'tickets', 'tokens', 'status']) {
      subscriptions.push(onSnapshot(doc(db, 'usage', name), { includeMetadataChanges: true }, (snapshot) => {
        if (snapshot.metadata.fromCache) return;
        allowed = true; dashboard.hidden = pageTabs.hidden = false;
        refreshButton.disabled = !!pending;
        if (message.textContent === 'Loading…') message.textContent = 'Signed in.';
        const value = snapshot.data() || {};
        if (name === 'status') currentStatus = value;
        else if (name === 'todo') drawTodo(value.sections || []);
        else data[name] = value[name === 'analysis' ? 'items' : 'rows'] || [];
        if (name === 'tickets') drawTickets();
        showStatus(); draw();
      }, report));
    }
  });
  refreshButton.addEventListener('click', async () => {
    if (pending || !allowed) return;
    const attempt = { requestedAt: null, timer: null };
    pending = attempt;
    refreshButton.disabled = true; refreshButton.textContent = 'Updating…'; message.textContent = 'Updating…';
    attempt.timer = setTimeout(() => { if (pending === attempt) finishUpdate("PC didn't answer"); }, 60_000);
    try {
      const control = doc(db, 'control', 'refresh');
      await setDoc(control, { requestedAt: serverTimestamp() });
      if (pending !== attempt) return;
      const saved = await getDocFromServer(control);
      if (pending !== attempt) return;
      attempt.requestedAt = saved.data()?.requestedAt?.toMillis();
      showStatus();
    } catch (error) { if (pending === attempt) report(error); }
  });
}
