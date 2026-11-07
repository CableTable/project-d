// TODO 167a, `rook.mjs wait`: has a run ended? `texts` = { file: text | null (not there yet) }; returns the first finished file or null.
// A Claude run (.jsonl) is done at its `result` line (a half-written last line is skipped) or a `NO REVIEW: <why>` line (TODO 167d, a review that was not chained); a suite log (.log) at a `SUITE unit=<n> browser=<n>` line; any other file (a Knight report, a retro .out) when it is not empty.
export function firstDone(texts) {
  const done = (file, text) => text != null && (file.endsWith('.jsonl')
    ? text.startsWith('NO REVIEW:') || text.split(/\r?\n/).some((l) => { try { return JSON.parse(l).type === 'result'; } catch { return false; } })
    : file.endsWith('.log') ? /^SUITE unit=\d+ browser=(\d+|skipped)/m.test(text) // TODO 167e: a suite log has a `SUITE unit=<code> browser=<code>` line (Node warnings may follow it)
    : text.trim() !== '');
  return Object.keys(texts).find((f) => done(f, texts[f])) ?? null;
}

export function peakContext(events) {
  let peak = 0;
  for (const event of events) {
    if (event.type !== 'assistant' || !event.message?.usage || event.parent_tool_use_id) continue; // sub-agent turns have their own context
    const u = event.message.usage;
    peak = Math.max(peak, (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0));
  }
  return peak;
}
