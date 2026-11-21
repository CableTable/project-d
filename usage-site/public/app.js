
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp, getDocFromServer } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js';
import { resetLabel, weeklyForecast, windowReading } from './usage-window.js';
import { firebaseConfig } from './firebase-config.js';
import { dailyTokens } from './token-chart.js';

const AGENT_COLOR = { Rook: 'var(--ud-rook)', Pip: 'var(--ud-pip)', Rowan: 'var(--ud-rowan)', Bishop: 'var(--ud-pip)', King: 'var(--ud-king)', Knight: 'var(--ud-rowan)' };
const ORDER = ['Rook', 'Bishop', 'King', 'Rowan'];
const label = (text) => String(text).replace(/\bPip\b/g, 'Bishop').replace(/\bRowan\b/g, 'Knight');
const IST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
const chartDate = (time) => DAY.format(new Date(time)).replace(' ', '-').slice(0, 6);
const compact = (n) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const num = (x) => (x === '' || x == null ? null : Number(x));

let data = { limits: [], history: [], runs: [], analysis: [], tickets: [], tokens: [], queue: [] };
let queueUpdated = '', queueNext = [], showAllDone = false;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = label(text); return e; };
const mark = (e, src, field, where) => { e.dataset.source = src; e.dataset.field = field; if (where) e.dataset.where = where; return e; };
const wh = (a, w) => 'agent=' + encodeURIComponent(a) + '&window=' + encodeURIComponent(w);

function setPage(name) {
  if (!['usage', 'todo', 'tickets', 'queue'].includes(name)) name = 'usage';
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

// Knight card, chart series and legend show only while its tokens appear in the uploaded window; old Knight history still parses elsewhere.
function knightSeen() { return data.tokens.some((r) => Number(r.Knight) > 0); } // a function: setPage draws the chart before this line runs
const shownAgents = () => ORDER.filter((a) => a !== 'Rowan' || knightSeen());
function svg(tag, attrs, parent, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  parent?.append(node); return node;
}
const RING = 2 * Math.PI * 28;
const until = (secs) => { const m = Math.max(0, Math.round((secs * 1000 - Date.now()) / 60000)); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' m' : m + ' m'; };

function drawAgents(limits) {
  const box = document.getElementById('agents');
  box.replaceChildren();
  const fk = new Map(limits.filter((r) => r.window === 'week').map((r) => [r.agent, weeklyForecast(r)]));
  shownAgents().forEach((a) => {
    const rows = limits.filter((r) => r.agent === a);
    if (!rows.length) return;
    const h5 = rows.find((x) => x.window === '5h'), wk = rows.find((x) => x.window === 'week');
    const color = AGENT_COLOR[a], card = el('div', 'ud-card'), top = el('div', 'ud-acc-top'), name = el('div', 'ud-acc-name');
    let h5Line;
    if (h5) {
      const [used, resets] = windowReading(a, h5), ring = el('div', 'ud-ring'), s = svg('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' }, ring);
      svg('circle', { class: 't', cx: 32, cy: 32, r: 28 }, s);
      svg('circle', { class: 'v', cx: 32, cy: 32, r: 28, stroke: used >= 85 ? 'var(--color-bad)' : color, 'stroke-dasharray': RING * Math.max(0, Math.min(100, used)) / 100 + ' ' + RING }, s);
      const big = el('span'); big.append(mark(el('span', null, String(used)), 'limits', 'used_pct', wh(a, '5h')), document.createTextNode('%'));
      ring.append(big); top.append(ring);
      h5Line = mark(el('div', 'ud-muted', '5 h: ' + (resets == null ? 'window not started' : 'resets in ' + until(resets) + ' (' + HM.format(new Date(resets * 1000)) + ')')), 'limits', 'resets', wh(a, '5h'));
    }
    const cap = num(wk?.cap_pct), wkUsed = wk ? windowReading(a, wk)[0] : 0;
    const title = el('div', 'ud-agent'), h3 = el('h3'), dot = el('i', 'ud-dot');
    dot.style.background = color; h3.append(dot, document.createTextNode(label(a)));
    const chip = el('span', 'ud-chip ' + (cap == null ? 'ok' : wkUsed >= cap ? 'bad' : 'warn'));
    if (cap == null) chip.textContent = 'no cap today'; else chip.append(document.createTextNode('cap '), mark(el('span', null, String(cap)), 'limits', 'cap_pct', wh(a, 'week')), document.createTextNode('%'));
    title.append(h3, chip); name.append(title);
    if (h5Line) name.append(h5Line);
    top.append(name); card.append(top);
    if (wk) {
      const [used, resets] = windowReading(a, wk), fc = fk.get(a), m = el('div', 'ud-meter');
      const row = el('div', 'ud-mrow'), wl = el('span'); wl.append(document.createTextNode('Week '), mark(el('b', null, String(used)), 'limits', 'used_pct', wh(a, 'week')), document.createTextNode('%'));
      row.append(wl, mark(el('span', 'ud-muted', resetLabel(resets, (s) => IST.format(new Date(s * 1000)))), 'limits', 'resets', wh(a, 'week')));
      const tr = el('div', 'ud-track'), f = el('div', 'ud-fill');
      f.style.width = Math.min(100, used) + '%'; f.style.background = used >= 95 ? 'var(--cds-chart-status-critical)' : color; tr.append(f);
      const to = fc?.hit_at ? 100 : fc?.at_reset_pct != null ? Math.min(100, fc.at_reset_pct) : 0;
      if (to > used) { const g = el('div', 'ud-ghost'); g.style.left = Math.min(100, used) + '%'; g.style.width = to - Math.min(100, used) + '%'; tr.append(g); }
      if (cap != null) { const k = el('div', 'ud-tick cap'); k.style.left = 'calc(' + cap + '% - 1px)'; k.title = 'Today’s cap'; tr.append(k); }
      m.append(row, tr);
      const foot = el('div', 'ud-muted'); // one block: a flex row would split the sentence at each bold part
      if (fc?.hit_at) {
        foot.append(document.createTextNode('At this pace: hits 100% '), mark(el('b', 'ud-hit', IST.format(new Date(fc.hit_at))), 'forecast', 'hit_at', 'agent=' + encodeURIComponent(a)), document.createTextNode(', before the reset'));
      } else if (fc?.at_reset_pct != null) {
        foot.append(document.createTextNode('At this pace: about '), mark(el('b', null, String(fc.at_reset_pct)), 'forecast', 'at_reset_pct', 'agent=' + encodeURIComponent(a)), document.createTextNode('% at the reset'));
      } else foot.append(el('span', null, a === 'Rowan' ? 'At this pace: no data yet' : 'At this pace: too early in the week to tell'));
      m.append(foot); card.append(m);
    }
    box.append(card);
  });
  const queen = el('div', 'ud-card ud-empty'); queen.append(el('b', null, 'Queen'), el('span', 'ud-muted', 'not set up')); box.append(queen);
}

// The one-line strip on top: who is building what, then alerts from the usage % alone (week >= 95%, 5h >= 85%).
function drawStrip() {
  const box = document.getElementById('strip'), alerts = el('div', 'ud-alerts');
  box.replaceChildren();
  const running = [...data.queue].reverse().filter((row) => row.state === 'running');
  if (!running.length) box.append(el('span', 'ud-muted', 'Nothing running'));
  for (const row of running) {
    const { who, text } = queueParts(row), item = el('span');
    if (who && text.startsWith(who + ' ')) { const b = el('b', null, who); b.style.color = AGENT_COLOR[who] || ''; item.append(b, document.createTextNode(cutSha(text.slice(who.length)))); } else item.textContent = cutSha(text);
    box.append(item);
  }
  for (const a of shownAgents()) for (const [w, at, cls] of [['week', 95, 'bad'], ['5h', 85, 'warn']]) {
    const r = data.limits.find((x) => x.agent === a && x.window === w);
    if (!r) continue;
    const [used] = windowReading(a, r);
    if (used >= at) alerts.append(el('span', 'ud-chip ' + cls, a + ' ' + w + ' ' + used + '%'));
  }
  box.append(alerts);
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

let openSubsteps = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('usage-todo-open'));
  if (Array.isArray(saved)) openSubsteps = new Set(saved);
} catch { /* Start closed when storage is unavailable. */ }

let todoClosed = false, todoSections = [];
for (const [id, closed] of [['todo-open', false], ['todo-closed', true]]) document.getElementById(id).addEventListener('click', () => { todoClosed = closed; drawTodo(todoSections); });
function drawTodo(sections) {
  todoSections = sections;
  const box = document.getElementById('todo-sections'); box.replaceChildren();
  document.getElementById('todo-open').setAttribute('aria-pressed', !todoClosed);
  document.getElementById('todo-closed').setAttribute('aria-pressed', todoClosed);
  if (!sections.length) box.append(el('p', 'ud-muted', 'No TODO uploaded yet.'));
  for (const section of sections) {
    const card = el('div', 'ud-card ud-todo');
    card.append(el('h3', null, section.title));
    const open = el('ul', 'ud-todo-list');
    for (const item of section.items) {
      if (!!item.done !== todoClosed) continue;
      const row = el('li');
      const head = el('div', 'ud-todo-head');
      head.append(el('span', 'ud-muted', item.num + '.'), el('strong', null, item.title));
      if (item.size) head.append(el('span', 'ud-chip', item.size));
      row.append(head);
      if (item.text) row.append(el('p', 'ud-muted', item.text));
      if (item.substeps?.length) {
        const details = el('details', 'ud-substeps'), list = el('ul', 'ud-todo-list');
        const key = JSON.stringify([section.title, item.num]);
        details.open = openSubsteps.has(key);
        details.append(el('summary', null, item.substeps.filter((step) => step.done).length + ' of ' + item.substeps.length + ' done'), list);
        for (const step of item.substeps) {
          const tick = el('span', step.done ? 'ud-done' : 'ud-muted', step.done ? '✓' : '○');
          tick.setAttribute('role', 'img');
          tick.setAttribute('aria-label', step.done ? 'Done' : 'Not done');
          const li = el('li', 'ud-substep');
          li.append(tick, el('span', 'ud-muted', step.num + '.'), el('span', null, step.text)); list.append(li);
        }
        details.addEventListener('toggle', () => {
          if (details.open) openSubsteps.add(key); else openSubsteps.delete(key);
          try { localStorage.setItem('usage-todo-open', JSON.stringify([...openSubsteps])); } catch { /* Keep working without storage. */ }
        });
        row.append(details);
      }
      open.append(row);
    }
    card.append(open.childElementCount ? open : el('p', 'ud-muted', todoClosed ? 'No closed items.' : 'No open items.'));
    box.append(card);
  }
}

function drawTokenChart() {
  const box = document.getElementById('token-chart'), legend = document.getElementById('token-legend');
  box.replaceChildren(); legend.replaceChildren();
  const agents = ['Rook', 'Bishop', 'King', 'Knight'].filter((a) => a !== 'Knight' || knightSeen());
  for (const agent of agents) {
    const item = el('span'), dot = el('i'); dot.style.background = AGENT_COLOR[agent]; item.append(dot, document.createTextNode(agent)); legend.append(item);
  }
  if (!data.tokens.length) { box.append(el('p', 'ud-muted', 'No token data uploaded yet.')); return; }
  const days = dailyTokens(data.tokens, agents, 7);
  const W = Math.max(260, box.clientWidth), H = 150, left = 38, right = W - 4, bottom = 124, plot = 108;
  const max = Math.max(1, ...days.flatMap((d) => agents.map((a) => d[a])));
  const group = (right - left) / days.length, bar = Math.min(14, group * .8 / agents.length);
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Tokens per account per day over the last 7 days in IST; input + output + cache creation; cache reads excluded' });
  box.append(chart);
  for (const fraction of [0, .5, 1]) {
    const y = bottom - fraction * plot;
    svg('line', { x1: left, x2: right, y1: y, y2: y, stroke: 'var(--cds-chart-grid)' }, chart);
    svg('text', { x: left - 5, y: y + 4, 'text-anchor': 'end' }, chart, compact(max * fraction));
  }
  days.forEach((day, i) => {
    const x0 = left + i * group + (group - bar * agents.length) / 2;
    agents.forEach((agent, k) => {
      const h = day[agent] / max * plot;
      const rect = svg('rect', { class: 'token-bar', x: x0 + k * bar, y: bottom - h, width: Math.max(1, bar - 1), height: h, rx: 2, fill: AGENT_COLOR[agent] }, chart);
      svg('title', {}, rect, `${chartDate(day.t)} IST · ${agent}: ${day[agent].toLocaleString('en')} tokens`);
    });
    svg('text', { x: left + (i + .5) * group, y: 142, 'text-anchor': 'middle' }, chart, chartDate(day.t));
  });
}

let ticketClosed = false;
const isClosed = (row) => /^(?:merged|done|checked in exe)/i.test(row.status);
for (const [id, closed] of [['ticket-open', false], ['ticket-closed', true]]) document.getElementById(id).addEventListener('click', () => { ticketClosed = closed; drawTickets(); });
document.getElementById('ticket-tag').addEventListener('change', drawTickets);
function drawTickets() {
  const box = document.getElementById('ticket-list'), select = document.getElementById('ticket-tag');
  const tags = [...new Set(data.tickets.flatMap((row) => row.tags || []))].sort();
  const ticketTag = tags.includes(select.value) ? select.value : '';
  select.replaceChildren(new Option('All tags', ''), ...tags.map((tag) => new Option(tag, tag))); select.value = ticketTag;
  document.getElementById('ticket-open').setAttribute('aria-pressed', !ticketClosed);
  document.getElementById('ticket-closed').setAttribute('aria-pressed', ticketClosed);
  box.replaceChildren();
  const rows = data.tickets.filter((row) => isClosed(row) === ticketClosed && (!ticketTag || (row.tags || []).includes(ticketTag)));
  if (!rows.length) { box.append(el('p', 'ud-muted', 'No tickets')); return; }
  const card = el('div', 'ud-card'), table = el('table', 'ticket-table'), head = el('thead'), headings = el('tr'), body = el('tbody');
  for (const name of ['#', 'Status', 'Size', 'Type', 'Tags', 'Title', 'TODO', 'Updated']) headings.append(el('th', null, name));
  head.append(headings); table.append(head, body); card.append(table); box.append(card);
  for (const row of rows) {
    const tr = el('tr', 'ticket'); tr.dataset.id = row.id;
    const cell = (name, text) => { const td = el('td', null, text); td.dataset.label = name; tr.append(td); return td; };
    cell('#', row.id);
    const statusClass = isClosed(row) ? 'ok' : /^built/i.test(row.status) ? 'info' : /^(?:building|in TODO)/i.test(row.status) ? 'warn' : 'bad';
    cell('Status').append(el('span', 'ud-chip ' + statusClass, row.status));
    cell('Size', row.size); cell('Type', row.type); cell('Tags', (row.tags || []).join(', '));
    const details = el('details'), summary = el('summary', null, row.title);
    details.append(summary, el('p', 'ticket-note', row.note || 'No note yet.')); cell('Title').append(details);
    cell('TODO', row.todo); cell('Updated', row.updated);
    tr.addEventListener('click', (event) => { if (!event.target.closest('summary, .ticket-note')) details.open = !details.open; });
    body.append(tr);
  }
}

// The Queue tab and the Usage page's Work section show the same rows; Work (work = true) puts the account in a chip, always shows all three parts and says why Next is empty.
function drawQueue() {
  const time = Date.parse(queueUpdated);
  document.getElementById('queue-updated').textContent = Number.isFinite(time) ? 'Updated ' + IST.format(new Date(time)) + ' IST' : '';
  renderQueue(document.getElementById('queue-list'), false);
  renderQueue(document.getElementById('work-list'), true);
}
function renderQueue(box, work) {
  box.replaceChildren();
  const rows = [...data.queue].reverse(), running = (row) => row.state === 'running'; // newest first
  const part = (name, empty, build, count, tail = '') => {
    if (!count) { box.append(el('p', 'ud-muted', `${name}: ${empty}`)); return; }
    const card = el('div', 'ud-card'); box.append(el('h3', null, name + tail), card); build(card);
  };
  const line = (card, text, row) => {
    const item = el('div', 'queue-row'), head = el('div', 'ud-mrow'), who = work && row ? queueParts(row).who : '';
    if (who && text.startsWith(who + ' ')) { const chip = el('span', 'ud-chip', who); chip.style.color = AGENT_COLOR[who] || ''; head.append(chip); text = text.slice(who.length + 1); }
    head.append(el('strong', null, text));
    if (row && !work) head.append(el('span', 'ud-chip ' + (running(row) ? 'warn' : row.state === 'ended' ? 'ok' : 'info'), row.state === 'ended' ? 'done' : row.state));
    item.append(head); card.append(item);
  };
  const now = rows.filter(running), done = rows.filter((row) => !running(row)), next = queueNext.map(String);
  const nextPart = () => part('Next', work ? 'nothing planned (no next: line in the queue)' : 'nothing planned', (card) => next.forEach((id) => line(card, id + todoTitle(id))), next.length);
  if (!rows.length && !work) { box.append(el('p', 'ud-muted', 'No runs')); if (next.length) nextPart(); return; } // planned work shows when nothing runs
  part('Now', 'nothing running', (card) => now.forEach((row) => line(card, queueHeadline(row), row)), now.length);
  nextPart();
  part(work ? 'Done today' : 'Done', 'nothing yet', (card) => {
    done.slice(0, showAllDone ? done.length : 5).forEach((row) => line(card, queueHeadline(row), row));
    if (done.length > 5) {
      const more = el('button', null, showAllDone ? 'Show fewer' : `Show ${done.length - 5} more`);
      more.type = 'button'; more.setAttribute('aria-expanded', showAllDone);
      more.addEventListener('click', () => { showAllDone = !showAllDone; drawQueue(); });
      card.append(more);
    }
  }, done.length, work ? ` · ${done.length} ${done.length === 1 ? 'job' : 'jobs'}` : '');
}

// " · short title" from the TODO row of an item id (number, sub-id like 273a, or letter id like U1d): "U1c: " prefix dropped, 8 words at most; '' when there is no row.
function todoTitle(base) {
  const num = base.match(/^(\d+)[a-z]?$/)?.[1]; // 273a (a sub-step) reads the title of TODO 273; one letter at most, so a sha like 280abcd stays a sha
  const todo = todoSections.flatMap((s) => s.items).find((t) => (num ? t.num === Number(num) : /^[A-Za-z]/.test(base) && t.title.startsWith(base + ':')));
  const words = todo?.title.replace(/^[A-Za-z]+\d+[A-Za-z]*: /, '').split(/\s+/) || [];
  return todo ? ' · ' + words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '') : '';
}

// "Who verb item · short title" from a queue row; every sha is cut to 7 chars.
const cutSha = (text) => text.replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, (hex) => hex.slice(0, 7));
function queueHeadline(row) { const { text, base } = queueParts(row); return cutSha(text + todoTitle(base)); }
function queueParts({ kind, id, out, state }) {
  const first = id.split(' ')[0], branch = first.match(/^(king|knight)\//);
  const acct = id.match(/\(([A-Za-z]\w*)[,)]/)?.[1] || id.match(/--as (\w+)/)?.[1] || (branch ? branch[1] : kind === 'knight' ? 'knight' : '');
  const who = acct && acct[0].toUpperCase() + acct.slice(1);
  const from = kind === 'review' ? out.match(/(?:^|\/)(?:rv|review)-(.+?)\.\w+$/)?.[1] || first.slice(0, 7) : first.replace(/^(king|knight)\//, '');
  const name = from.replace(/^(.+?)fix\d*$/, '$1 fix'), base = name.replace(/ fix$/, '');
  const done = state === 'ended', verbs = { build: ['building', 'built'], knight: ['building', 'built'], review: ['checking', 'checked'] }[kind];
  const text = kind === 'suite' ? 'Full tests ' + first : kind === 'fresh' ? 'Grill check ' + name : [who, verbs ? verbs[+done] : kind, name].filter(Boolean).join(' ');
  return { who, text, base };
}

// The "Latest exe" card from the `release` doc (`gh release view --json tagName,publishedAt,body`); no doc or no tag hides it. The body's first line is the build note, the rest lists what the exe added.
function drawRelease(value) {
  const section = document.getElementById('release'), card = document.getElementById('release-card');
  card.replaceChildren();
  section.hidden = typeof value?.tagName !== 'string' || !value.tagName;
  if (section.hidden) return;
  const published = new Date(value.publishedAt), added = String(value.body || '').split(/\r?\n/).slice(1).filter((l) => l.trim());
  card.append(el('h3', null, value.tagName), el('p', 'ud-muted', isNaN(published) ? '' : IST.format(published) + ' IST'));
  if (!added.length) { card.append(el('p', 'ud-muted', 'No TODO items listed.')); return; }
  const list = el('ul');
  added.forEach((line) => list.append(el('li', null, line)));
  card.append(list);
}

function draw() {
  const times = data.limits.map((r) => Date.parse(r.as_of)).filter(Number.isFinite);
  document.getElementById('asof').textContent = times.length ? IST.format(new Date(Math.max(...times))) + ' IST' : '\u2014';
  drawAgents(data.limits); drawStrip(); drawChart(data.history); drawTokenChart();
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
const rookStuck = document.getElementById('rook-stuck');
const IST_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
function drawRookStuck(rook) {
  const since = new Date(rook?.since);
  const show = rook?.stuck === true && !isNaN(since);
  rookStuck.textContent = show ? 'Rook stuck since ' + IST_TIME.format(since) : '';
  rookStuck.hidden = !show;
}
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
  const shortError = currentStatus.lastError && /^(?:(?:Rook|Bishop|King|Knight) usage probe failed, exit (?:\d+|unknown)|(?:Main|Second|Third) account: 100%, limit reached|Usage refresh failed; see the local agent log)$/.test(currentStatus.lastError)
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
    data = { limits: [], history: [], runs: [], analysis: [], tickets: [], tokens: [], queue: [] }; queueUpdated = ''; queueNext = [];
    drawTodo([]); drawTickets(); drawQueue(); drawRookStuck(); drawRelease();
    draw(); finishUpdate(user ? 'Loading…' : 'Sign in to see usage.');
    dashboard.hidden = pageTabs.hidden = true; signin.hidden = !!user; signout.hidden = !user; showStatus();
    if (!user) return;
    for (const name of ['limits', 'history', 'runs', 'analysis', 'todo', 'tickets', 'queue', 'tokens', 'rook', 'release', 'status']) {
      subscriptions.push(onSnapshot(doc(db, 'usage', name), { includeMetadataChanges: true }, (snapshot) => {
        if (snapshot.metadata.fromCache) return;
        allowed = true; dashboard.hidden = pageTabs.hidden = false;
        refreshButton.disabled = !!pending;
        if (message.textContent === 'Loading…') message.textContent = 'Signed in.';
        const value = snapshot.data() || {};
        if (name === 'status') currentStatus = value;
        else if (name === 'todo') drawTodo(value.sections || []);
        else if (name === 'rook') drawRookStuck(value);
        else if (name === 'release') drawRelease(value);
        else data[name] = (value[name === 'analysis' ? 'items' : 'rows'] || []).map((r) => (r.agent === 'Pip' ? { ...r, agent: 'Bishop' } : r)); // rows uploaded before the rename
        if (name === 'tickets') drawTickets();
        if (name === 'queue') { queueUpdated = value.updated || ''; queueNext = Array.isArray(value.next) ? value.next : []; }
        if (name === 'queue' || name === 'todo') drawQueue(); // a TODO upload can fill in titles
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
