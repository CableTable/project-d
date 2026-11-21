// Codex writes fresh limit readings only when it runs again.
export function codexWindow([used, resets], now = Date.now()) {
  return resets == null || resets * 1000 <= now ? [0, null] : [used, resets];
}
export const resetLabel = (resets, format) => resets == null ? 'Reset' : 'Resets ' + format(resets); // the kit's status lines (outside this repo) import this too: keep the wording
// [used %, reset in seconds or null] of one limits.csv row; a limited account's 5h row has a blank reset (Date.parse('') is NaN, and formatting NaN throws).
export function windowReading(agent, r) {
  const reading = [Number(r.used_pct), r.resets ? Date.parse(r.resets) / 1000 : null];
  return agent === 'Rowan' ? codexWindow(reading) : reading;
}

// Is this ISO time on today's IST date? A blank or bad time is no.
const istDay = (ms) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
export function isTodayIst(iso, now = Date.now()) {
  const t = Date.parse(iso);
  return Number.isFinite(t) && istDay(t) === istDay(now);
}

// The breaks ({ rows: [{ account, from, to }] }) that are on now: [{ account, to (ms) }]; unreadable rows are skipped.
export function activeBreaks(breaks, now = Date.now()) {
  const out = [];
  for (const b of Array.isArray(breaks?.rows) ? breaks.rows : []) {
    if (!b || typeof b !== 'object') continue;
    const from = Date.parse(b.from), to = Date.parse(b.to);
    if (from <= now && now <= to) out.push({ account: b.account, to });
  }
  return out;
}

// The status strip's items from the `breaks`, `forhim` ({ open }) and `ci` ({ status, conclusion, sha, updated }) docs: [{ cls, text, plain? }].
// A break is a plain muted line (plain), the rest are chips. A missing doc gives nothing.
export function stripChips({ breaks, forhim, ci } = {}, now = Date.now()) {
  const chips = activeBreaks(breaks, now).map((b) => ({ cls: 'muted', text: b.account + ' on break', plain: true }));
  if (Number(forhim?.open) > 0) chips.push({ cls: 'info', text: Number(forhim.open) + ' for him' });
  const sha = String(ci?.sha || '').slice(0, 7);
  if (ci?.status && ci.status !== 'completed' && ci.status !== 'none') {
    const at = Date.parse(ci.updated), min = Math.max(0, Math.round((now - at) / 60000));
    chips.push({ cls: 'warn', text: 'CI running' + (Number.isFinite(at) ? ' · ' + (min >= 60 ? Math.floor(min / 60) + ' h' : min + ' min') + ' ago' : '') });
  } else if (ci?.status === 'completed' && ci.conclusion === 'success') chips.push({ cls: 'ok', text: 'CI green' });
  else if (ci?.status === 'completed' && ci.conclusion === 'cancelled') chips.push({ cls: 'muted', text: 'CI cancelled ' + sha });
  else if (ci?.status === 'completed' && /^(failure|timed_out|startup_failure)$/.test(ci.conclusion)) chips.push({ cls: 'bad', text: 'CI red ' + sha });
  return chips;
}

export function weeklyForecast(r, now = Date.now()) {
  const s = Date.parse(r.starts), e = Date.parse(r.resets), a = Date.parse(r.as_of);
  const used = r.used_pct === '' || r.used_pct == null ? NaN : Number(r.used_pct);
  const knight = r.agent === 'Rowan' || r.agent === 'Knight';
  const hasData = Number.isFinite(used) && used >= 0 && a > s && a < e && e > now;
  const at_reset_pct = !hasData || a - s < (knight ? 3 : 12) * 3600e3 || used <= 0 ? null : Math.round(used * (e - s) / (a - s));
  return { agent: r.agent, at_reset_pct, hit_at: at_reset_pct >= 100 ? new Date(s + (a - s) * 100 / used).toISOString() : null };
}
