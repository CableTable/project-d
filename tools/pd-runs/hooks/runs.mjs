// Pure logic of the pd-runs mod: newest runs<N> folder, Bishop / Knight rows, usage rows, IST time. No I/O here.
export const RUN_MS = 3 * 60_000; // a file quiet longer than this is not running (as pd-band)
export const KEEP_MS = 2 * 3_600_000; // finished rows stay this long
export const MAX_ROWS = 10;
export const BIG = 4 * 1024 * 1024; // $.fs.read cannot read a file over this

export const ago = (ms) => (ms < 60_000 ? '<1m' : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m` : `${Math.floor(ms / 3_600_000)}h${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')}`);

// Time of day in IST (UTC+5:30), whatever the PC's own zone.
export const istHM = (ms) => new Date(ms + 5.5 * 3_600_000).toISOString().slice(11, 16);

// entries: [{ name, kind }] of the extras folder. Highest N of runs<N>, or null.
export function newestRunsDir(entries) {
  let best = null;
  for (const e of entries) {
    const m = e.kind === 'dir' ? /^runs(\d+)$/.exec(e.name) : null;
    if (m && (best === null || +m[1] > best.n)) best = { n: +m[1], name: e.name };
  }
  return best?.name ?? null;
}

// Which *.jsonl files the caller must read to tell finished from running: those inside the keep window, small enough.
export const jsonlToRead = (files, now) =>
  files.filter((f) => f.name.endsWith('.jsonl') && now - f.mtimeMs <= KEEP_MS && (f.size ?? 0) <= BIG).map((f) => f.name);

const hasResult = (text) => /"type"\s*:\s*"result"/.test(text ?? '');

// files: [{ name, mtimeMs, size? }]. texts: { '<x>.jsonl': content } for jsonlToRead().
// Row: { who, name, state: 'running' | 'done' | 'cut off', age }, running first then newest, at most MAX_ROWS.
export function findRuns(files, now, texts) {
  const rows = [];
  for (const f of files) {
    const age = now - f.mtimeMs;
    if (age > KEEP_MS || age < 0) continue;
    const fresh = age <= RUN_MS;
    if (f.name.endsWith('.jsonl')) {
      // shortcut: a file over BIG is never read, so it counts as done once quiet; upgrade if a cut-off run that big shows up
      const big = (f.size ?? 0) > BIG;
      const done = hasResult(texts[f.name]) || (big && !fresh);
      rows.push({ who: 'Bishop', name: f.name.slice(0, -6).replace(/^(pip-|b(?=\d|-))/, '').replace(/^-/, ''), state: done ? 'done' : fresh ? 'running' : 'cut off', age });
      continue;
    }
    const m = /^(?:rowan-|r)(.+)\.log$/.exec(f.name);
    if (!m) continue;
    // r<name>.txt (or rowan-<name>-r.txt) is written last; 2 s of slack for log and answer closing together
    const answer = files.find((r) => r.name === `r${m[1]}.txt` || r.name === `rowan-${m[1]}-r.txt`);
    const done = !!answer && answer.mtimeMs >= f.mtimeMs - 2000;
    rows.push({ who: 'Knight', name: m[1].replace(/^-/, ''), state: done ? 'done' : fresh ? 'running' : 'cut off', age });
  }
  return rows.sort((a, b) => (a.state === 'running' ? 0 : 1) - (b.state === 'running' ? 0 : 1) || a.age - b.age).slice(0, MAX_ROWS);
}

// limits.csv: agent,role,model,window,used_pct,cap_pct,starts,resets,as_of. Old names (Pip, Rowan) read as Bishop, Knight.
const CSV_NAMES = { Rook: ['Rook'], Bishop: ['Bishop', 'Pip'], Knight: ['Knight', 'Rowan'] };
export function usageLines(csv, ageMs) {
  if (csv == null || ageMs == null) return ['no usage cache'];
  const rows = csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
  const pct = (who, w) => {
    const r = rows.find((c) => CSV_NAMES[who].includes(c[0] ?? '') && c[3] === w);
    return r && r[4] !== '' && Number.isFinite(+r[4]) ? `${Math.round(+r[4])}%` : '?';
  };
  const lines = Object.keys(CSV_NAMES).map((who) => `${who.padEnd(6)}  5h ${pct(who, '5h').padStart(4)}   week ${pct(who, 'week').padStart(4)}`);
  lines.push(ageMs > 15 * 60_000 ? `usage stale ${ago(ageMs)}` : `cache ${ago(ageMs)} ago`);
  return lines;
}

// One Rook background Bash call. job: { desc, command, startedMs, state: 'running' | 'completed' | 'failed' | 'killed', endedMs? }
export function jobText(job, now) {
  const span = `${istHM(job.startedMs)}${job.endedMs ? `-${istHM(job.endedMs)}` : ''}`;
  if (job.state !== 'running') return `${job.state === 'completed' ? 'done' : job.state}  ${job.desc}  (${span})`;
  const wait = /waiting[^'"\n]*?\bfor (\d\d:\d\d)/i.exec(job.command ?? '');
  return wait ? `queued for ${wait[1]}  ${job.desc}  (started ${span})` : `started ${span}  ${job.desc}  (${ago(now - job.startedMs)})`;
}
