// Pure helpers for the usage page's running-total token chart.
const DAY = 864e5, HOUR = 3600e3;
const NAMES = { Rook: ['Rook'], Bishop: ['Bishop', 'Pip'], Knight: ['Knight', 'Rowan'] }; // limits / history may still use the old names
const DROP = 20; // a weekly % that falls this many points between two readings is a reset

// Weekly reset times (ms, ascending) of one agent inside [from, now]: the current resetsAt stepped back in 7-day steps,
// plus the time of any reading where the stored week % dropped sharply (a manual reset). Resets under 6 h apart count as one.
export function resetTimes(agent, limits, history, from, now) {
  const names = NAMES[agent] || [agent], found = [];
  const week = limits.find((r) => names.includes(r.agent) && r.window === 'week');
  for (let t = Date.parse(week?.resets); t >= from; t -= 7 * DAY) if (t <= now) found.push(t);
  const readings = history.filter((r) => names.includes(r.agent) && r.window === 'week')
    .map((r) => ({ t: Date.parse(r.when), v: Number(r.used_pct) })).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.v)).sort((a, b) => a.t - b.t);
  for (let i = 1; i < readings.length; i++) if (readings[i - 1].v - readings[i].v >= DROP && readings[i].t >= from && readings[i].t <= now) found.push(readings[i].t);
  const times = [];
  for (const t of found.sort((a, b) => a - b)) if (!times.length || t - times.at(-1) >= 6 * HOUR) times.push(t);
  return times;
}

// Running total per hourly row (rows[].t = bucket start, ms); it restarts at 0 in the bucket holding each reset time.
// A value below the one before marks a reset, so the chart can draw the vertical drop.
export function cumulativeTokens(rows, agent, resets = []) {
  let total = 0;
  return rows.map((row) => {
    if (resets.some((t) => t >= row.t && t < row.t + HOUR)) total = 0;
    return (total += Math.max(0, Number(row[agent]) || 0));
  });
}

// Nudge end labels apart (min `gap` px) and keep them between the plot top and `bottom`; returns them top to bottom.
export function tokenEndLabels(ends, bottom, gap = 20) {
  const labels = ends.map((end) => ({ ...end })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + gap);
  if (labels.length) labels.at(-1).y = Math.min(labels.at(-1).y, bottom);
  for (let i = labels.length - 2; i >= 0; i--) labels[i].y = Math.min(labels[i].y, labels[i + 1].y - gap);
  return labels;
}
