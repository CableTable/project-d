// Codex writes fresh limit readings only when it runs again.
export function codexWindow([used, resets], now = Date.now()) {
  return resets == null || resets * 1000 <= now ? [0, null] : [used, resets];
}
export const resetLabel = (resets, format) => resets == null ? 'Reset' : 'Resets ' + format(resets);
