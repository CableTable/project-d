// Both files must be present and at most 75 minutes old (the PC agent refreshes hourly).
export function cacheAge(mtimes, now) {
  if (mtimes.length !== 2 || mtimes.some((t) => !Number.isFinite(t) || t > now)) return null;
  const age = now - Math.min(...mtimes);
  return age <= 75 * 60_000 ? age : null;
}
