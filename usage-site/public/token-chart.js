// Pure helpers for the usage page's running-total token chart.
export function cumulativeTokens(rows, agent) {
  let total = 0;
  return rows.map((row) => (total += Math.max(0, Number(row[agent]) || 0)));
}

// Nudge end labels apart (min `gap` px) and keep them between the plot top and `bottom`; returns them top to bottom.
export function tokenEndLabels(ends, bottom, gap = 20) {
  const labels = ends.map((end) => ({ ...end })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + gap);
  if (labels.length) labels.at(-1).y = Math.min(labels.at(-1).y, bottom);
  for (let i = labels.length - 2; i >= 0; i--) labels[i].y = Math.min(labels[i].y, labels[i + 1].y - gap);
  return labels;
}
