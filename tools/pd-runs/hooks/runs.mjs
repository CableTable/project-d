// Pure logic of the pd-runs mod: newest runs<N> folder, Bishop / Knight rows, live processes, usage, IST time. No I/O here.
export const RUN_MS = 3 * 60_000; // a run with no process match and no result, quiet longer than this, is cut off
export const KEEP_MS = 2 * 3_600_000; // finished rows stay this long
export const MAX_RECENT = 8;
export const MAX_RUNNING = 8;
export const BIG = 4 * 1024 * 1024; // $.fs.read cannot read a file over this
export const WIDTH = 40; // the pane's columns

export const PIECE = { Rook: '♜', Bishop: '♝', Knight: '♞', Pawn: '♟' };
export const WHO_COLOR = { Rook: 'cyan', Bishop: 'magenta', Knight: 'yellow', Pawn: 'white' };

export const ago = (ms) => (ms < 60_000 ? '<1m' : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m` : `${Math.floor(ms / 3_600_000)}h${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')}`);

// Cut to n cells with an ellipsis, padded to n.
export const fit = (s, n) => (s.length > n ? `${s.slice(0, Math.max(n - 1, 0))}…` : s.padEnd(n));

// Wrap words ({ t, ...style }) into lines of at most n cells; at least one line. A word longer than n stays whole (wrap() splits those).
/** @template {{ t: string }} W @param {W[]} words @param {number} n @returns {W[][]} */
export function wrapWords(words, n) {
  /** @type {typeof words[]} */
  const lines = [[]];
  let len = 0;
  for (const w of words) {
    if (len && len + 1 + w.t.length > n) { lines.push([]); len = 0; }
    lines[lines.length - 1].push(w);
    len += (len ? 1 : 0) + w.t.length;
  }
  return lines;
}
// A string into lines of at most n cells, at spaces; a word longer than n is cut.
export const wrap = (s, n) =>
  wrapWords(s.split(/\s+/).filter(Boolean).flatMap((t) => t.match(new RegExp(`.{1,${Math.max(n, 1)}}`, 'gs')) ?? []).map((t) => ({ t })), n).map((l) => l.map((w) => w.t).join(' '));

// Is the session's folder one of `dirs` (';' or newline between them) or inside one? / and \ alike, case-insensitive.
const slashed = (p) => p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
export const hiddenIn = (cwd, dirs) => {
  const c = slashed(cwd ?? '');
  return (dirs ?? '').split(/[;\r\n]+/).map(slashed).some((d) => d !== '' && (c === d || c.startsWith(`${d}/`)));
};

// Time of day in IST (UTC+5:30), whatever the PC's own zone.
export const istHM = (ms) => new Date(ms + 5.5 * 3_600_000).toISOString().slice(11, 16);
const istDay = (ms) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(ms + 5.5 * 3_600_000).getUTCDay()];

// entries: [{ name, kind }] of the extras folder. Highest N of runs<N>, or null.
export function newestRunsDir(entries) {
  let best = null;
  for (const e of entries) {
    const m = e.kind === 'dir' ? /^runs(\d+)$/.exec(e.name) : null;
    if (m && (best === null || +m[1] > best.n)) best = { n: +m[1], name: e.name };
  }
  return best?.name ?? null;
}

// Which *.jsonl files the caller must read: those inside the keep window, small enough.
export const jsonlToRead = (files, now) =>
  files.filter((f) => f.name.endsWith('.jsonl') && now - f.mtimeMs <= KEEP_MS && (f.size ?? 0) <= BIG).map((f) => f.name);

// ---- live processes: the signal for "still running". A result line only says the model wrote its last message. ----

// One cheap listing per tick (~0.4 s): pid|parent pid|start (ms since epoch)|command line of every process, so the
// chain from a claude / codex process down to its browser test is whole (a filter would cut it at a plain bash).
export const PS_ARGV = [
  'powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
  "$me=$PID; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -and $_.CommandLine -notmatch 'Win32_Process' } | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.ProcessId,$_.ParentProcessId,([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds(),($_.CommandLine -replace '\\s+',' ') }",
];

export function parseProcs(out) {
  return (out ?? '').split(/\r?\n/).map((l) => /^(\d+)\|(\d+)\|(-?\d+)\|(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], startMs: +m[3], cmd: m[4] }));
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (cmd, tok) => new RegExp(`(?<![\\w.-])${esc(tok)}(?![\\w.-])`, 'i').test(cmd);
const sessionOf = (text) => /"session_id"\s*:\s*"([0-9a-f-]{36})"/.exec(text ?? '')?.[1];

// The processes whose command line names any token (a resume / session id, or a file the run writes), and what runs under them.
// null: none alive. Else { startMs, testing } (testing: a browser test is running below).
const treeOf = (procs, pids) => {
  const tree = new Set(pids);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of procs) if (!tree.has(p.pid) && tree.has(p.ppid)) { tree.add(p.pid); grew = true; }
  }
  return tree;
};
export function probe(procs, tokens) {
  const hit = procs.filter((p) => tokens.some((t) => mentions(p.cmd, t)));
  if (!hit.length) return null;
  const tree = treeOf(procs, hit.map((p) => p.pid));
  return { pids: hit.map((p) => p.pid), startMs: Math.min(...hit.map((p) => p.startMs)), testing: procs.some((p) => tree.has(p.pid) && /browser\.test/i.test(p.cmd)) };
}

const jsonlName = (file) => file.slice(0, -6).replace(/^(pip-|b(?=\d|-))/, '').replace(/^-/, '');

// Last "type":"result" line of a stream-json run: null (none yet) or { error }.
function lastResult(text) {
  if (!/"type"\s*:\s*"result"/.test(text ?? '')) return null;
  for (const line of text.split('\n').reverse()) {
    if (!/"type"\s*:\s*"result"/.test(line)) continue;
    try { const r = JSON.parse(line); return { error: r.is_error === true || /^error/.test(r.subtype ?? '') }; } catch {}
  }
  return { error: false };
}

// files: [{ name, mtimeMs, size? }]. texts: { '<x>.jsonl': content } for jsonlToRead(). procs: parseProcs() or null (listing failed).
// Row: { who, name, state: 'running' | 'testing' | 'done' | 'cut off' | 'failed', age, files (the run files it owns) }; age = running time of a live row, else time since it ended.
// A live process decides: result line + process = running. No process match: result = done, else running only while the file moves.
export function findRuns(files, now, texts, procs = null) {
  const inWindow = files.filter((f) => now - f.mtimeMs <= KEEP_MS && now - f.mtimeMs >= 0);
  const jsonl = inWindow.filter((f) => f.name.endsWith('.jsonl')).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newestOfSession = new Map(); // a resumed run shares its session with the older file: only the newest file may claim it
  for (const f of jsonl) {
    const sid = sessionOf(texts[f.name]);
    if (sid && !newestOfSession.has(sid)) newestOfSession.set(sid, f.name);
  }
  const probes = new Map();
  for (const f of jsonl) {
    const sid = sessionOf(texts[f.name]);
    // also the launching script go-<name>.sh, whose bash is the live parent of a fresh run
    probes.set(f.name, procs && probe(procs, [f.name, `go-${jsonlName(f.name)}.sh`, ...(sid && newestOfSession.get(sid) === f.name ? [sid] : [])]));
  }
  // claude -p processes no run file claimed (a fresh run's command line holds no id): they stand for the newest unmatched files
  const roots = (procs ?? []).filter((p) => /stream-json/.test(p.cmd) && !procs.some((q) => q.pid === p.ppid && /stream-json/.test(q.cmd)));
  const used = new Set([...probes.values()].flatMap((p) => p?.pids ?? []));
  const claimed = treeOf(procs ?? [], [...used]); // a go-<name>.sh bash claims the claude under it too
  const spare = roots.filter((r) => !claimed.has(r.pid) && ![...treeOf(procs ?? [], [r.pid])].some((pid) => used.has(pid))).sort((a, b) => b.startMs - a.startMs);

  const rows = [];
  for (const f of inWindow) {
    const age = now - f.mtimeMs;
    const fresh = age <= RUN_MS;
    if (f.name.endsWith('.jsonl')) {
      const result = lastResult(texts[f.name]);
      // shortcut: a file over BIG is never read, so it counts as done once quiet; upgrade if a cut-off run that big shows up
      const doneBig = (f.size ?? 0) > BIG && !fresh;
      const p = probes.get(f.name) ?? (!result && !doneBig ? spare.shift() : null);
      const name = jsonlName(f.name);
      const owns = [f.name];
      if (p) rows.push({ who: 'Bishop', name, state: p?.testing ? 'testing' : 'running', age: p ? now - p.startMs : age, files: owns });
      else rows.push({ who: 'Bishop', name, state: result ? (result.error ? 'failed' : 'done') : doneBig ? 'done' : fresh ? 'running' : 'cut off', age, files: owns });
      continue;
    }
    const m = /^(?:rowan-|r)(.+)\.log$/.exec(f.name);
    if (!m) continue;
    // r<name>.txt (or rowan-<name>-r.txt) is written last; 2 s of slack for log and answer closing together
    const answerNames = [`r${m[1]}.txt`, `rowan-${m[1]}-r.txt`];
    const answer = files.find((r) => answerNames.includes(r.name));
    const p = procs && probe(procs, [f.name, ...answerNames, `go-${m[1].replace(/^-/, '')}.sh`]);
    const done = !!answer && answer.mtimeMs >= f.mtimeMs - 2000;
    const name = m[1].replace(/^-/, '');
    const owns = [f.name, ...answerNames];
    if (p) rows.push({ who: 'Knight', name, state: p.testing ? 'testing' : 'running', age: now - p.startMs, files: owns });
    else rows.push({ who: 'Knight', name, state: done ? 'done' : fresh ? 'running' : 'cut off', age, files: owns });
  }
  return rows;
}

// ---- usage ----

// Today's cap on the week bar (% of the weekly limit he allows himself by the end of today). null: no cap (Knight).
// Bishop 14 % x k, week resets Mon 15:30 IST; Rook the same from its Sun 15:30 IST reset, but this week (before 2026-10-25 15:30) fixed days below.
// shortcut: reset days are fixed here, not read from limits.csv; move them to the csv if a reset day ever changes.
const DAY = 86_400_000;
const WEEK_RESET = { Rook: Date.UTC(2026, 9, 25, 10, 0), Bishop: Date.UTC(2026, 9, 26, 10, 0) }; // 15:30 IST = 10:00 UTC
const ROOK_THIS_WEEK = { '2026-10-23': 83, '2026-10-24': 94 }; // IST dates
export function todayCap(who, now) {
  const anchor = WEEK_RESET[who];
  if (anchor == null) return null;
  const day = new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10);
  if (who === 'Rook' && day in ROOK_THIS_WEEK) return ROOK_THIS_WEEK[day];
  const k = Math.floor((((now - anchor) % (7 * DAY)) + 7 * DAY) % (7 * DAY) / DAY) + 1; // whole days since the reset + 1
  return 14 * k;
}
// The 10-cell bar as kinds, the cap marker on the cell holding the cap: ['fill' | 'empty' | 'cap' x 10].
export function barParts(pct, cap) {
  const filled = barCells(pct);
  const mark = cap == null ? -1 : Math.max(0, Math.min(9, Math.ceil(cap / 10) - 1));
  return Array.from({ length: 10 }, (_, i) => (i === mark ? 'cap' : i < filled ? 'fill' : 'empty'));
}

// limits.csv: agent,role,model,window,used_pct,cap_pct,starts,resets,as_of. Old names (Pip, Rowan) read as Bishop, Knight.
const CSV_NAMES = { Rook: ['Rook'], Bishop: ['Bishop', 'Pip'], Knight: ['Knight', 'Rowan'] };
export const resetLabel = (iso, week) => {
  const ms = Date.parse(iso ?? '');
  return Number.isNaN(ms) ? '' : `${week ? `${istDay(ms)} ` : ''}${istHM(ms)}`;
};
// -> null (no cache) or [{ who, w5: { pct, reset }, wk: { pct, reset }, cap }]; pct null when the cache has none, cap = todayCap().
export function usageRows(csv, now) {
  if (csv == null) return null;
  const rows = csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
  const cell = (who, w) => {
    const r = rows.find((c) => CSV_NAMES[who].includes(c[0] ?? '') && c[3] === w);
    return { pct: r && r[4] !== '' && Number.isFinite(+r[4]) ? Math.round(+r[4]) : null, reset: resetLabel(r?.[7], w === 'week') };
  };
  return Object.keys(CSV_NAMES).map((who) => ({ who, w5: cell(who, '5h'), wk: cell(who, 'week'), cap: todayCap(who, now) }));
}
// 10 cells: how many are filled, and the theme colour (green < 70, amber 70-89, red >= 90).
export const barCells = (pct) => (pct == null ? 0 : Math.max(0, Math.min(10, Math.round(pct / 10))));
export const barColor = (pct) => (pct == null ? 'inactive' : pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'success');

// ---- Rook's own background Bash calls ----

// How a task-notification's status ends a job: null while the word does not say it ended (no word, running, started...).
export function endState(status) {
  const s = (status ?? '').toLowerCase();
  if (!s || /^(running|pending|started|in[_ -]?progress|queued)$/.test(s)) return null;
  return /fail|error/.test(s) ? 'failed' : /kill|stop|cancel/.test(s) ? 'killed' : 'completed';
}

// The go-<name>.sh scripts a command runs: [{ name, path }]; path is where to read it (an absolute one as typed, else in `dir`).
export function goScripts(command, dir) {
  return [...(command ?? '').matchAll(/([^\s'"]*?)(go-[\w.-]+\.sh)(?![\w.-])/g)].map((m) => ({ name: m[2], path: /^([A-Za-z]:|\/)/.test(m[1]) ? `${m[1]}${m[2]}` : `${dir}/${m[2]}` }));
}
// The run files (*.jsonl / *.txt / *.log, base names) a script writes or reads: how a wrapper is matched to the Bishop / Knight row it launches.
export const scriptFiles = (text) => [...new Set([...(text ?? '').matchAll(/([\w.-]+\.(?:jsonl|txt|log))(?![\w.-])/gi)].map((m) => m[1]))];

// Is the process of a Rook background call still in the listing? true when it cannot be told (no go script, no long plain word).
// shortcut: a command with no go script is found by its two longest plain words, which a quoted command may not keep; then it reads as ended after 2 misses, upgrade by reading the task's pid.
function jobAlive(procs, command) {
  const scripts = [...(command ?? '').matchAll(/(?<![\w.-])go-[\w.-]+\.sh(?![\w.-])/g)].map((m) => m[0]);
  if (scripts.length) return procs.some((p) => scripts.some((t) => mentions(p.cmd, t)));
  const words = [...new Set((command ?? '').match(/(?<![\w.-])[A-Za-z][\w.-]{5,}/g) ?? [])].sort((a, b) => b.length - a.length).slice(0, 2).map((w) => w.toLowerCase());
  return !words.length || procs.some((p) => words.every((w) => p.cmd.toLowerCase().includes(w)));
}
// Fallback for a task notice that never came: a running job whose process has left the listing is done. Seen alive once, one miss ends it;
// never seen (it started and ended between two ticks), two misses. null procs (listing failed) changes nothing. Returns the same array when nothing changed.
export function reapJobs(jobs, procs, now) {
  if (!procs) return jobs;
  let changed = false;
  const out = jobs.map((j) => {
    if (j.state !== 'running') return j;
    const alive = jobAlive(procs, j.command);
    const seen = !!j.seen || alive;
    const miss = alive ? 0 : (j.miss ?? 0) + 1;
    if (!alive && (seen || miss >= 2)) { changed = true; return { ...j, state: 'completed', endedMs: now, seen, miss }; }
    if (seen === !!j.seen && miss === (j.miss ?? 0)) return j;
    changed = true;
    return { ...j, seen, miss };
  });
  return changed ? out : jobs;
}

// ---- the pane ----

export const isLive = (state) => /^(running|testing|queued)/.test(state);

// jobs: Rook's (see register.tsx), rows: findRuns(). -> { running, recent }, each [{ who, name, state, age }].
// job: { desc, command, startedMs, state: 'running' | 'completed' | 'failed' | 'killed', endedMs? }. A job is done only when its notice arrived.
export function paneRows(jobs, rows, now) {
  const mine = jobs.map((j) => {
    const wait = /waiting[^'"\n]*?\bfor (\d\d:\d\d)/i.exec(j.command ?? '');
    if (j.state === 'running') return { who: 'Rook', name: j.desc, state: wait ? `queued ${wait[1]}` : 'running', age: now - j.startedMs };
    return { who: 'Rook', name: j.desc, state: j.state === 'completed' ? 'done' : j.state === 'failed' ? 'failed' : 'cut off', age: now - (j.endedMs ?? j.startedMs) };
  });
  const view = (all) => ({
    running: all.filter((r) => isLive(r.state)).sort((a, b) => b.age - a.age).slice(0, MAX_RUNNING),
    recent: all.filter((r) => !isLive(r.state) && r.age <= KEEP_MS).sort((a, b) => a.age - b.age).slice(0, MAX_RECENT),
  });
  // a running wrapper of go-<name>.sh is the same job as the Bishop / Knight row named <name> or owning a run file its script writes
  // (job.files), while that row is live on screen; a queued / failed / cut off / done wrapper is its own news and stays
  const onScreen = view(rows).running.filter((r) => /^(running|testing)/.test(r.state));
  const twin = (j, m) => j.state === 'running' && m.state === 'running' && [...(j.command ?? '').matchAll(/(?<![\w.-])go-([\w.-]+)\.sh/g)].some((x) => onScreen.some((r) => r.name === x[1])) ||
    onScreen.some((r) => (r.files ?? []).some((f) => (j.files ?? []).includes(f)));
  return view([...mine.filter((m, i) => !twin(jobs[i], m)), ...rows]);
}

// ---- queue: runs<N>/queue.txt, lines "[x] / [>] / [ ] text", '#' lines ignored ----

// -> null (no file) or { rows: [{ mark: '>' | ' ', text }], done }: the [>] ones, then the waiting ones, at most `max` rows with the "N done" line counted.
export function queueRows(text, max = 8) {
  if (text == null) return null;
  /** @type {{ mark: '>' | ' ', text: string }[]} */
  const items = [];
  let done = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\[([x> ])\]\s*(.*?)\s*$/i.exec(line);
    if (!m) continue; // blank, '#' and anything else
    if (m[1]?.toLowerCase() === 'x') done++;
    else items.push({ mark: m[1] === '>' ? '>' : ' ', text: m[2] ?? '' });
  }
  const rows = [...items.filter((i) => i.mark === '>'), ...items.filter((i) => i.mark === ' ')];
  return { rows: rows.slice(0, max - (done ? 1 : 0)), done };
}

// ---- CI of the open PR ----

export const CI_EVERY_MS = 2 * 60_000;
export const branchOf = (head) => /^ref:\s*refs\/heads\/(\S+)/.exec(head ?? '')?.[1] ?? null;

const RED = /^(FAILURE|ERROR|TIMED_OUT|CANCELLED|ACTION_REQUIRED|STARTUP_FAILURE)$/;
// stdout of `gh pr view --json number,labels,statusCheckRollup` -> { at, num, state: 'running' | 'green' | 'red' | 'unknown', automerge }. Bad output = unknown.
export function parseCi(out, at) {
  try {
    const j = JSON.parse(out);
    const one = (c) => {
      const s = String(c.conclusion || c.state || '').toUpperCase(); // CheckRun: status + conclusion; StatusContext: state
      return RED.test(s) ? 'red' : (c.status && c.status !== 'COMPLETED') || s === '' || s === 'PENDING' || s === 'EXPECTED' ? 'running' : 'green';
    };
    const all = (j.statusCheckRollup ?? []).map(one);
    const state = all.includes('red') ? /** @type {const} */ ('red') : all.length === 0 || all.includes('running') ? /** @type {const} */ ('running') : /** @type {const} */ ('green');
    return { at, num: j.number, state, automerge: (j.labels ?? []).some((l) => l.name === 'automerge') };
  } catch {
    return { at, num: null, state: /** @type {const} */ ('unknown'), automerge: false };
  }
}

// The CI line as wrapped lines of styled words: [[{ t, dim?, bold?, color? }]]. `at`: when the disk was read.
/** @param {{ at: number, num: number | null, state: string, automerge: boolean }} ci @param {number} at @returns {{ t: string, dim?: boolean, bold?: boolean, color?: string }[][]} */
export function ciLines(ci, at) {
  const age = at - ci.at;
  if (ci.state === 'unknown' || ci.num == null) return wrapWords([{ t: 'CI', dim: true }, { t: 'unknown', dim: true }, ...(age >= 60_000 ? [{ t: ago(age), dim: true }] : [])], WIDTH);
  const color = ci.state === 'green' ? 'success' : ci.state === 'red' ? 'error' : 'warning';
  return wrapWords([{ t: `#${ci.num}` }, { t: 'CI' }, { t: ci.state, bold: true, color }, { t: '·' }, { t: 'automerge' }, { t: ci.automerge ? 'on' : 'off' }, { t: ago(age), dim: true }], WIDTH);
}

// ---- toasts: what changed between two ticks ----

// view: paneRows(); ci: parseCi() or null.
export const snapshot = (view, ci) => ({
  // shortcut: keyed "who name", so two jobs of one name collapse; upgrade if that shows up
  jobs: Object.fromEntries([...view.running, ...view.recent].map((r) => [`${r.who} ${r.name}`, r.state])),
  ci: ci ? { num: ci.num, state: ci.state } : null,
});
// prev null (first tick after a load) -> nothing. A job toasts when it went from live to done / cut off / failed; CI when it went running -> green / red.
export function toastsFor(prev, cur) {
  if (!prev) return [];
  const out = [];
  for (const [key, state] of Object.entries(cur.jobs)) {
    const was = prev.jobs[key];
    if (was && isLive(was) && !isLive(state)) out.push(`${PIECE[key.split(' ')[0]] ?? '·'} ${key} ${state}`);
  }
  if (prev.ci && cur.ci && prev.ci.num === cur.ci.num && prev.ci.state === 'running' && (cur.ci.state === 'green' || cur.ci.state === 'red')) out.push(`CI #${cur.ci.num} ${cur.ci.state}`);
  return out;
}
