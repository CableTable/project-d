export function isLockStale(mtimeMs, bootTime, probeError) {
  if (mtimeMs < bootTime) return true;
  if (!probeError) return false;
  if (probeError.code === 'ESRCH' || probeError.code === 'EPERM') return true;
  throw probeError;
}

export function shouldRefresh({ busy, now, nextRefresh, requestedAt, lastHandled }) {
  return !busy && (now >= nextRefresh || requestedAt > lastHandled);
}
