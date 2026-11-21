// Pure helper for the usage page's tokens-per-day chart.
const DAY = 864e5, HOUR = 3600e3;

// Tokens per IST day for the last `days` days ending on the day of the newest row: [{ t: the day's IST midnight (ms), <agent>: tokens }].
export function dailyTokens(rows, agents, days = 7) {
  if (!rows.length) return [];
  const offset = 5.5 * HOUR, day = (t) => Math.floor((t + offset) / DAY), first = day(Math.max(...rows.map((r) => r.t))) - days + 1;
  const out = Array.from({ length: days }, (_, i) => ({ t: (first + i) * DAY - offset, ...Object.fromEntries(agents.map((a) => [a, 0])) }));
  for (const row of rows) {
    const i = day(row.t) - first;
    if (i >= 0 && i < days) for (const a of agents) out[i][a] += Math.max(0, Number(row[a]) || 0);
  }
  return out;
}
