export function peakContext(events) {
  let peak = 0;
  for (const event of events) {
    if (event.type !== 'assistant' || !event.message?.usage) continue;
    const u = event.message.usage;
    peak = Math.max(peak, (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0));
  }
  return peak;
}
