// Both files must be present and at most five minutes old.
export function cacheAge(mtimes, now) {
  if (mtimes.length !== 2 || mtimes.some((t) => !Number.isFinite(t) || t > now)) return null;
  const age = now - Math.min(...mtimes);
  return age <= 5 * 60_000 ? age : null;
}
