
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';
import { getFirestore, doc, collection, addDoc, onSnapshot, setDoc, serverTimestamp, getDocFromServer } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js';
import { activeBreaks, isTodayIst, resetLabel, stripChips, weeklyForecast, windowReading } from './usage-window.js';
import { firebaseConfig } from './firebase-config.js';
import { dailyTokens, niceStep } from './token-chart.js';

const AGENT_COLOR = { Rook: 'var(--ud-rook)', Pip: 'var(--ud-pip)', Rowan: 'var(--ud-rowan)', Bishop: 'var(--ud-pip)', King: 'var(--ud-king)', Knight: 'var(--ud-rowan)' };
const ACCOUNTS = ['Rook', 'Bishop', 'King']; // account cards and strip alerts: Knight is retired
const label = (text) => String(text).replace(/\bPip\b/g, 'Bishop').replace(/\bRowan\b/g, 'Knight');
const IST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
const WEEKDAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short' });
const WEEKDAY_HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const noComma = (text) => text.replace(/,/g, ''); // "Mon, 07:00" -> "Mon 07:00", as the mock-up writes it
const chartDate = (time) => DAY.format(new Date(time)).replace(' ', '-').slice(0, 6);
const compact = (n) => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const num = (x) => (x === '' || x == null ? null : Number(x));

let data = { limits: [], runs: [], tickets: [], tokens: [], queue: [] };
let queueNext = [], queueNextFrom = '', docs = {}; // docs: the `breaks`, `forhim` and `ci` docs, as uploaded
let workFoldOpen = false; // the Work card's "N earlier today" fold, kept across redraws
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = label(text); return e; };
const mark = (e, src, field, where) => { e.dataset.source = src; e.dataset.field = field; if (where) e.dataset.where = where; return e; };
const wh = (a, w) => 'agent=' + encodeURIComponent(a) + '&window=' + encodeURIComponent(w);

let tabSettled = false; // once he taps a tab, or the first for-him doc is read, the page stays where it is
function setPage(name, remember = true) {
  if (!['usage', 'todo', 'tickets', 'questions'].includes(name)) name = 'usage';
  document.querySelectorAll('[data-page]').forEach((page) => { page.hidden = page.id !== name; });
  document.querySelectorAll('[data-tab]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.tab === name));
  if (remember) try { localStorage.setItem('usage-tab', name); } catch { /* Private browsing can deny storage. */ }
  if (name === 'usage') drawTokenChart();
}
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => { tabSettled = true; setPage(button.dataset.tab); }));
let savedPage = 'usage';
try { savedPage = localStorage.getItem('usage-tab'); } catch { /* Use Usage when storage is unavailable. */ }
setPage(savedPage);

let query = '';
document.getElementById('q').addEventListener('input', (e) => { query = e.target.value.toLowerCase(); draw(); });

// The token chart's Knight bar and legend show only while its tokens appear in the uploaded window (Knight is retired: no card).
function knightSeen() { return data.tokens.some((r) => Number(r.Knight) > 0); } // a function: setPage draws the chart before this line runs
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
  ACCOUNTS.forEach((a) => {
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
    const off = activeBreaks(docs.breaks).find((b) => label(b.account) === a); // a is never Pip / Rowan here
    const chip = el('span', 'ud-chip ' + (off ? 'bad' : cap == null ? 'ok' : wkUsed >= cap ? 'bad' : 'warn'));
    if (off) chip.textContent = 'break till ' + noComma(WEEKDAY_HM.format(new Date(off.to)));
    else if (cap == null) chip.textContent = 'no cap today'; else chip.append(document.createTextNode('cap '), mark(el('span', null, String(cap)), 'limits', 'cap_pct', wh(a, 'week')), document.createTextNode('%'));
    title.append(h3, chip); name.append(title);
    if (h5Line) name.append(h5Line);
    top.append(name); card.append(top);
    if (wk) {
      const [used, resets] = windowReading(a, wk), fc = fk.get(a), m = el('div', 'ud-meter');
      const row = el('div', 'ud-mrow'), wl = el('span'); wl.append(document.createTextNode('Week '), mark(el('b', null, String(used)), 'limits', 'used_pct', wh(a, 'week')), document.createTextNode('%'));
      row.append(wl, mark(el('span', 'ud-muted', resetLabel(resets, (s) => noComma(IST.format(new Date(s * 1000))))), 'limits', 'resets', wh(a, 'week')));
      const tr = el('div', 'ud-track'), f = el('div', 'ud-fill');
      f.style.width = Math.min(100, used) + '%'; f.style.background = color; tr.append(f);
      const to = fc?.hit_at ? 100 : fc?.at_reset_pct != null ? Math.min(100, fc.at_reset_pct) : 0;
      if (to > used) { const g = el('div', 'ud-ghost'); g.style.left = Math.min(100, used) + '%'; g.style.width = to - Math.min(100, used) + '%'; tr.append(g); }
      if (cap != null) { const k = el('div', 'ud-tick cap'); k.style.left = 'calc(' + cap + '% - 1px)'; k.title = 'Today’s cap'; tr.append(k); }
      m.append(row, tr);
      const foot = el('div', 'ud-mrow ud-muted'), forecast = 'agent=' + encodeURIComponent(a); // two columns: the cap, then the forecast
      let pace;
      if (fc?.hit_at) { pace = mark(el('span', 'ud-hit', 'hits 100% before reset'), 'forecast', 'hit_at', forecast); pace.title = noComma(IST.format(new Date(fc.hit_at))); }
      else if (fc?.at_reset_pct != null) pace = mark(el('span', fc.at_reset_pct >= 95 ? 'ud-hit' : '', '~' + fc.at_reset_pct + '% at reset'), 'forecast', 'at_reset_pct', forecast);
      else pace = el('span', null, 'too early to tell');
      foot.append(el('span', null, cap == null ? 'no cap today' : 'red tick = today’s cap ' + cap + '%'), pace);
      m.append(foot); card.append(m);
    }
    box.append(card);
  });
  const queen = el('div', 'ud-card ud-empty'); queen.append(el('b', null, 'Queen'), el('span', 'ud-muted', 'empty slot, no account yet')); box.append(queen);
}

// The one-line strip on top: who is building what, then alerts from the usage % alone (week >= 95%, 5h >= 85%).
function drawStrip() {
  const box = document.getElementById('strip'), alerts = el('div', 'ud-alerts');
  box.replaceChildren();
  const running = [...data.queue].reverse().filter((row) => row.state === 'running');
  if (!running.length) box.append(el('span', 'ud-muted', 'Nothing running'));
  for (const row of running) {
    const { who, text, item: id } = queueParts(row), item = el('span'), cut = text.endsWith(id) ? text.length - id.length : text.length, start = who && text.startsWith(who + ' ') ? who.length : 0;
    if (start) { const b = el('b', null, who); b.style.color = AGENT_COLOR[who] || ''; item.append(b); }
    item.append(cutSha(text.slice(start, cut)), el('b', null, cutSha(text.slice(cut))));
    box.append(item);
  }
  for (const a of ACCOUNTS) for (const [w, at, cls] of [['week', 95, 'bad'], ['5h', 85, 'warn']]) {
    const r = data.limits.find((x) => x.agent === a && x.window === w);
    if (!r) continue;
    const [used] = windowReading(a, r);
    if (used >= at) alerts.append(el('span', 'ud-chip ' + cls, a + ' ' + w + ' ' + used + '%'));
  }
  for (const a of ACCOUNTS) { // today's cap, as the mock's "Bishop cap 50%" chip
    const r = data.limits.find((x) => x.agent === a && x.window === 'week'), cap = num(r?.cap_pct);
    if (cap != null) alerts.append(el('span', 'ud-chip ' + (windowReading(a, r)[0] >= cap ? 'bad' : 'warn'), a + ' cap ' + cap + '%'));
  }
  const forhim = { open: openCount(docs.forhim) }; // the chip takes a count; `open` is a list now
  for (const { cls, text, plain } of stripChips({ ...docs, forhim })) (plain ? box : alerts).append(plain ? el('span', 'ud-muted', text) : el('span', 'ud-chip ' + cls, text)); // a break is a plain muted line before the chips
  box.append(alerts);
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

// One Todo / Tickets row: id, short title, status chip.
function shortRow(id, title, status, cls) {
  const row = el('li', 'ud-row'), full = String(title ?? '');
  row.append(el('span', 'ud-muted', id), el('span', null, full.length > 60 ? full.slice(0, 60).trimEnd() + '…' : full), el('span', 'ud-chip ' + cls, status));
  return row;
}
const TODO_CHIP = { done: 'ok', running: 'warn', planned: 'info', held: 'bad' };

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
    const open = el('ul', 'ud-rows');
    for (const item of section.items) {
      if (!!item.done !== todoClosed) continue;
      const status = item.status || 'open';
      open.append(shortRow(item.num + '.', item.title, status, TODO_CHIP[status] || 'muted'));
    }
    card.append(open.childElementCount ? open : el('p', 'ud-muted', todoClosed ? 'No closed items.' : 'No open items.'));
    box.append(card);
  }
}

function drawTokenChart() {
  const box = document.getElementById('token-chart'), legend = document.getElementById('token-legend'), note = document.getElementById('token-note');
  box.replaceChildren(); legend.replaceChildren(); note.textContent = '';
  const agents = ['Rook', 'Bishop', 'King', 'Knight'].filter((a) => a !== 'Knight' || knightSeen());
  for (const agent of agents) {
    const item = el('span'), dot = el('i'); dot.style.background = AGENT_COLOR[agent]; item.append(dot, document.createTextNode(agent)); legend.append(item);
  }
  note.textContent = 'Input + output + cache creation; cache reads excluded.';
  if (!data.tokens.length) { box.append(el('p', 'ud-muted', 'No token data uploaded yet.')); return; }
  const days = dailyTokens(data.tokens, agents, 7);
  const W = Math.max(260, box.clientWidth), H = 130, left = 34, right = W - 4, bottom = 100, plot = 84; // the mock-up's plot: 4 gridlines, day names under the bars
  const step = niceStep(Math.max(...days.flatMap((d) => agents.map((a) => d[a])))), max = step * 3;
  const group = (right - left) / days.length, bar = Math.min(10, group * .8 / agents.length);
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Tokens per account per day over the last 7 days in IST; input + output + cache creation; cache reads excluded' });
  box.append(chart);
  for (const i of [0, 1, 2, 3]) {
    const y = bottom - i * plot / 3;
    svg('line', { x1: left, x2: right, y1: y, y2: y, stroke: 'var(--cds-chart-grid)' }, chart);
    svg('text', { x: left - 5, y: y + 4, 'text-anchor': 'end' }, chart, compact(step * i));
  }
  const today = days.at(-1);
  if (isTodayIst(new Date(today.t).toISOString())) note.textContent += ' Today so far: ' + (agents.filter((a) => today[a] > 0).map((a) => a + ' ' + compact(today[a])).join(', ') || 'nothing yet') + '.';
  days.forEach((day, i) => {
    const x0 = left + i * group + (group - bar * agents.length) / 2;
    agents.forEach((agent, k) => {
      const h = day[agent] / max * plot;
      const rect = svg('rect', { class: 'token-bar', x: x0 + k * bar, y: bottom - h, width: Math.max(1, bar - 1), height: h, rx: 2, fill: AGENT_COLOR[agent] }, chart);
      svg('title', {}, rect, `${chartDate(day.t)} IST · ${agent}: ${day[agent].toLocaleString('en')} tokens`);
    });
    svg('text', { x: left + (i + .5) * group, y: 118, 'text-anchor': 'middle' }, chart, WEEKDAY.format(new Date(day.t)));
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
  const card = el('div', 'ud-card'), list = el('ul', 'ud-rows');
  card.append(list); box.append(card);
  for (const row of rows) {
    const statusClass = isClosed(row) ? 'ok' : /^built/i.test(row.status) ? 'info' : /^(?:building|in TODO)/i.test(row.status) ? 'warn' : 'bad';
    const item = shortRow(row.id, row.title, row.status, statusClass);
    item.classList.add('ticket'); item.dataset.id = row.id; list.append(item);
  }
}

// Questions tab: the `forhim` doc's open lines, answered on the page. A send is remembered per n until the line leaves `open`.
const answers = new Map(), drafts = new Map(), failed = new Map(); // by n: 'sending' | 'sent', typed text, last send error
let closedFoldOpen = false, addAnswer;
const openCount = (forhim) => (Array.isArray(forhim?.open) ? forhim.open.length : Number(forhim?.open) || 0); // an older doc has a count only
async function sendAnswer(n, text) {
  if (!text || answers.has(n)) return;
  answers.set(n, 'sending'); failed.delete(n); drawQuestions();
  try { await addAnswer(n, text); answers.set(n, 'sent'); drafts.delete(n); }
  catch (error) { answers.delete(n); failed.set(n, 'Not sent: ' + error.message); }
  drawQuestions();
}
function drawQuestions() {
  const box = document.getElementById('question-list'), forhim = docs.forhim;
  const open = Array.isArray(forhim?.open) ? forhim.open : [], closed = Array.isArray(forhim?.closed) ? forhim.closed.slice(-10) : [];
  const typing = box.contains(document.activeElement) ? document.activeElement.dataset.n : null; // a redraw must not drop the phone keyboard
  const old = box.querySelector('details.ud-fold'); if (old) closedFoldOpen = old.open;
  for (const map of [answers, drafts, failed]) for (const n of map.keys()) if (!open.some((q) => q.n === n)) map.delete(n);
  box.replaceChildren();
  const count = openCount(forhim);
  if (!open.length) box.append(el('p', 'ud-muted', count ? `${count} open question${count === 1 ? '' : 's'}` : 'No open questions'));
  for (const { n, text, replies, needed, sent } of open) {
    const card = el('div', 'ud-card ud-question'), line = el('p');
    line.append(el('strong', null, n + '. '), el('span', null, text)); card.append(line);
    if (needed) card.append(el('p', 'ud-muted', 'needed by ' + needed));
    if (sent || answers.get(n) === 'sent') card.append(el('p', 'ud-muted', 'sent, waiting for Rook'));
    else {
      const busy = answers.has(n), choices = el('div', 'tag-filters'), form = el('form', 'ud-answer'), input = el('input'), send = el('button', null, 'Send');
      for (const reply of replies || []) {
        const button = el('button', null, reply); button.type = 'button'; button.disabled = busy;
        button.addEventListener('click', () => sendAnswer(n, reply)); choices.append(button);
      }
      input.type = 'text'; input.value = drafts.get(n) || ''; input.dataset.n = n; input.disabled = send.disabled = busy;
      input.placeholder = 'Your answer'; input.setAttribute('aria-label', 'Answer to question ' + n);
      input.addEventListener('input', () => drafts.set(n, input.value));
      form.addEventListener('submit', (event) => { event.preventDefault(); sendAnswer(n, input.value.trim()); });
      form.append(input, send); card.append(choices, form);
      if (busy) card.append(el('p', 'ud-muted', 'sending…'));
      else if (failed.has(n)) card.append(el('p', 'ud-hit', failed.get(n)));
    }
    box.append(card);
  }
  if (closed.length) {
    const fold = el('details', 'ud-fold'), list = el('ul', 'ud-rows');
    for (const q of closed) { const row = el('li', 'ud-row'); row.append(el('span', 'ud-muted', q.n + '.'), el('span', null, q.text)); list.append(row); }
    fold.append(el('summary', null, `Closed (${closed.length})`), list); fold.open = closedFoldOpen; box.append(fold);
  }
  if (typing != null) box.querySelector(`input[data-n="${CSS.escape(typing)}"]`)?.focus();
}

// One Work card on the Usage page: Now / Next / Done today, each row an account chip, the bold item and its TODO title; it always shows all three parts and says why one is empty.
// Done today = rows whose end time (`ended`) is today's IST date (none, left out); the last 5 show, the rest fold into "N earlier today". Minutes and tokens per job are not in the queue doc: not shown.
function renderWork(box) {
  const old = box.querySelector('details.ud-fold'); if (old) workFoldOpen = old.open; // a redraw keeps the fold as the user left it
  box.replaceChildren();
  const rows = [...data.queue].reverse(), running = (row) => row.state === 'running'; // newest first
  const job = (chip, lead, bold, title) => { const item = el('div', 'job'), main = el('span'); if (lead) main.append(lead); main.append(el('strong', null, bold)); if (title) main.append(el('span', null, ' ' + title)); item.append(chip, main); return item; };
  const rowJob = (row) => {
    const { who, text, base, item } = queueParts(row), chip = el('span', 'ud-chip', who || row.kind);
    if (who) chip.style.color = AGENT_COLOR[who] || ''; else chip.classList.add('muted');
    const rest = who && text.startsWith(who + ' ') ? text.slice(who.length + 1) : text, cut = rest.endsWith(item) ? rest.length - item.length : rest.length; // only the id is bold, the verb before it plain
    return job(chip, cutSha(rest.slice(0, cut)), cutSha(rest.slice(cut)), cutSha(todoTitle(base).slice(3)));
  };
  const part = (name, empty, jobs, tail = '') => {
    if (!jobs.length) { box.append(el('p', 'ud-muted', `${name}: ${empty}`)); return; }
    const head = el('h2', null, name); if (tail) head.append(el('span', 'ud-muted', tail));
    const list = el('div', 'ud-jobs'); list.append(...jobs); box.append(head, list);
  };
  const now = rows.filter(running), next = queueNext.map(String), done = rows.filter((row) => !running(row) && isTodayIst(row.ended));
  part('Now', 'nothing running', now.map(rowJob));
  part('Next', 'nothing planned (no next: line in the queue)', next.map((id) => job(el('span', 'ud-chip muted', 'next'), '', id,todoTitle(id).slice(3))), queueNextFrom === 'todo' ? ' · from TODO order' : '');
  part('Done today', 'nothing yet', done.slice(0, 5).map(rowJob), ` · ${done.length} ${done.length === 1 ? 'job' : 'jobs'}`);
  if (done.length > 5) {
    const fold = el('details', 'ud-fold'), more = el('div', 'ud-jobs');
    more.append(...done.slice(5).map(rowJob)); fold.append(el('summary', null, `${done.length - 5} earlier today`), more);
    fold.open = workFoldOpen; box.append(fold);
  }
}

// " · short title" from the TODO row of an item id (number, sub-id like 273a, or letter id like U1d): "U1c: " prefix dropped, 8 words at most; '' when there is no row.
function todoTitle(base) {
  const num = base.match(/^(\d+)[a-z]?$/)?.[1]; // 273a (a sub-step) reads the title of TODO 273; one letter at most, so a sha like 280abcd stays a sha
  const todo = todoSections.flatMap((s) => s.items).find((t) => (num ? t.num === Number(num) : /^[A-Za-z]/.test(base) && t.title.startsWith(base + ':')));
  const words = todo?.title.replace(/^[A-Za-z]+\d+[A-Za-z]*: /, '').split(/\s+/) || [];
  return todo ? ' · ' + words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '') : '';
}

// "Who verb item" from a queue row; every sha is cut to 7 chars.
const cutSha = (text) => text.replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, (hex) => hex.slice(0, 7));
function queueParts({ kind, id, out, state }) {
  const first = id.split(' ')[0], branch = first.match(/^(king|knight)\//);
  const acct = id.match(/\(([A-Za-z]\w*)[,)]/)?.[1] || id.match(/--as (\w+)/)?.[1] || (branch ? branch[1] : kind === 'knight' ? 'knight' : '');
  const who = acct && acct[0].toUpperCase() + acct.slice(1);
  const from = kind === 'review' ? out.match(/(?:^|\/)(?:rv|review)-(.+?)\.\w+$/)?.[1] || first.slice(0, 7) : first.replace(/^(king|knight)\//, '');
  const name = from.replace(/^(.+?)fix\d*$/, '$1 fix'), base = name.replace(/ fix$/, '');
  const done = state === 'ended', verbs = { build: ['building', 'built'], knight: ['building', 'built'], review: ['checking', 'checked'] }[kind];
  const text = kind === 'suite' ? 'Full tests ' + first : kind === 'fresh' ? 'Grill check ' + name : [who, verbs ? verbs[+done] : kind, name].filter(Boolean).join(' ');
  return { who, text, base, item: kind === 'suite' ? first : name };
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
  drawAgents(data.limits); drawStrip(); drawTokenChart();
  drawRuns(data.runs);
  const groups = new Map();
  for (const r of data.runs) {
    const key = r.session + '|' + r.agent;
    const group = groups.get(key) || { session: r.session, agent: r.agent, runs: 0, new_tokens: 0 };
    group.runs++; group.new_tokens += Number(r.new_tokens || 0); groups.set(key, group);
  }
  drawByAgent([...groups.values()].sort((a, b) => b.session - a.session || b.new_tokens - a.new_tokens));
}
new ResizeObserver(drawTokenChart).observe(document.getElementById('token-chart'));

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
  refreshButton.textContent = 'Refresh';
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
setInterval(() => { drawStrip(); drawAgents(data.limits); }, 60_000); // a break ends on its own

if (Object.values(firebaseConfig).some((v) => v.includes('<'))) {
  message.textContent = 'Setup needed: fill the placeholders in firebase-config.js.';
  signin.disabled = true;
} else {
  const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app);
  addAnswer = (n, text) => addDoc(collection(db, 'answers'), { n, text, at: serverTimestamp() });
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
    data = { limits: [], runs: [], tickets: [], tokens: [], queue: [] }; queueNext = []; queueNextFrom = ''; docs = {};
    drawTodo([]); drawTickets(); renderWork(document.getElementById('work-list')); drawQuestions(); drawRookStuck(); drawRelease();
    draw(); finishUpdate(user ? 'Loading…' : 'Sign in to see usage.');
    dashboard.hidden = pageTabs.hidden = true; signin.hidden = !!user; signout.hidden = !user; showStatus();
    if (!user) return;
    for (const name of ['limits', 'runs', 'todo', 'tickets', 'queue', 'tokens', 'rook', 'release', 'breaks', 'forhim', 'ci', 'status']) {
      subscriptions.push(onSnapshot(doc(db, 'usage', name), { includeMetadataChanges: true }, (snapshot) => {
        if (snapshot.metadata.fromCache) return;
        allowed = true; dashboard.hidden = pageTabs.hidden = false;
        refreshButton.disabled = !!pending;
        if (message.textContent === 'Loading…') message.textContent = ''; // the Sign out button says who is in
        const value = snapshot.data() || {};
        if (name === 'status') currentStatus = value;
        else if (name === 'todo') drawTodo(value.sections || []);
        else if (name === 'rook') drawRookStuck(value);
        else if (name === 'release') drawRelease(value);
        else if (['breaks', 'forhim', 'ci'].includes(name)) docs[name] = value;
        else data[name] = (value.rows || []).map((r) => (r.agent === 'Pip' ? { ...r, agent: 'Bishop' } : r)); // rows uploaded before the rename
        if (name === 'tickets') drawTickets();
        if (name === 'queue') { queueNext = Array.isArray(value.next) ? value.next : []; queueNextFrom = value.nextFrom; }
        if (name === 'queue' || name === 'todo') renderWork(document.getElementById('work-list')); // a TODO upload can fill in titles
        if (name === 'forhim') {
          drawQuestions();
          // He answers from the phone: with a question to answer, Questions comes up first (not remembered as his tab); a count-only doc has none.
          if (!tabSettled && value.open?.length && matchMedia('(max-width: 40rem)').matches) setPage('questions', false);
          tabSettled = true;
        }
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
