// Codex writes fresh limit readings only when it runs again.
export function codexWindow([used, resets], now = Date.now()) {
  return resets == null || resets * 1000 <= now ? [0, null] : [used, resets];
}
export const resetLabel = (resets, format) => resets == null ? 'Reset' : 'Resets ' + format(resets);
// [used %, reset in seconds or null] of one limits.csv row; a limited account's 5h row has a blank reset (Date.parse('') is NaN, and formatting NaN throws).
export function windowReading(agent, r) {
  const reading = [Number(r.used_pct), r.resets ? Date.parse(r.resets) / 1000 : null];
  return agent === 'Rowan' ? codexWindow(reading) : reading;
}

export function weeklyForecast(r, now = Date.now()) {
  const s = Date.parse(r.starts), e = Date.parse(r.resets), a = Date.parse(r.as_of);
  const used = r.used_pct === '' || r.used_pct == null ? NaN : Number(r.used_pct);
  const knight = r.agent === 'Rowan' || r.agent === 'Knight';
  const hasData = Number.isFinite(used) && used >= 0 && a > s && a < e && e > now;
  const at_reset_pct = !hasData || a - s < (knight ? 3 : 12) * 3600e3 || used <= 0 ? null : Math.round(used * (e - s) / (a - s));
  return { agent: r.agent, at_reset_pct, hit_at: at_reset_pct >= 100 ? new Date(s + (a - s) * 100 / used).toISOString() : null };
}
