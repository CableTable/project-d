export function isLockStale(mtimeMs, bootTime, probeError) {
  if (mtimeMs < bootTime) return true;
  if (!probeError) return false;
  // EPERM counts as stale: the boot-time check above covers the common case; an elevated process reusing the PID is accepted
  if (probeError.code === 'ESRCH' || probeError.code === 'EPERM') return true;
  throw probeError;
}

export function shouldRefresh({ busy, now, nextRefresh, requestedAt, lastHandled }) {
  return !busy && (now >= nextRefresh || requestedAt > lastHandled);
}
