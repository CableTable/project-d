// Pure logic of the pd-band mod: parse the usage cache, find running runs, format the one line. No I/O here.
export const RUN_MS = 3 * 60_000;
export const STALE_MS = 15 * 60_000;
const AGENTS = ['Rook', 'Pip', 'Rowan'];

export const ago = (ms) => (ms < 60_000 ? '<1m' : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m` : `${Math.floor(ms / 3_600_000)}h`);

// limits.csv: agent,role,model,window,used_pct,cap_pct,starts,resets,as_of (no quoted commas, as rook.mjs writes it)
export function usageText(csv, ageMs) {
  if (csv == null || ageMs == null) return 'no usage cache';
  const rows = csv.trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
  const pct = (a, w) => { const r = rows.find((c) => c[0] === a && c[3] === w); return r && Number.isFinite(+r[4]) ? `${Math.round(+r[4])}%` : '?'; };
  const body = AGENTS.map((a) => `${a} 5h ${pct(a, '5h')} wk ${pct(a, 'week')}`).join(' · ');
  return ageMs > STALE_MS ? `${body} · usage stale ${ago(ageMs)}` : `${body} · ${ago(ageMs)} ago`;
}

// files: [{ name, mtimeMs }] of the runs folder. texts: { '<x>.jsonl': content } for the files recentJsonl() named.
export const recentJsonl = (files, now) => files.filter((f) => f.name.endsWith('.jsonl') && now - f.mtimeMs <= RUN_MS).map((f) => f.name);

export function findRuns(files, now, texts) {
  const runs = [];
  for (const f of files) {
    const age = now - f.mtimeMs;
    if (age > RUN_MS || age < 0) continue;
    if (f.name.endsWith('.jsonl') && !/"type"\s*:\s*"result"/.test(texts[f.name] ?? '')) runs.push({ who: 'Pip', name: f.name.slice(0, -6).replace(/^pip-/, ''), age });
    const m = /^rowan-(.+)\.log$/.exec(f.name);
    const done = m && files.find((r) => r.name === `rowan-${m[1]}-r.txt`);
    if (m && !(done && done.mtimeMs > f.mtimeMs)) runs.push({ who: 'Rowan', name: m[1], age });
  }
  return runs;
}

export const runsText = (runs) => (runs.length ? runs.map((r) => `${r.who} ${r.name} ${ago(r.age)}`).join(' · ') : 'idle');

export const bandLine = (csv, csvAgeMs, files, now, texts) => `${usageText(csv, csvAgeMs)}  |  ${runsText(findRuns(files, now, texts))}`;
