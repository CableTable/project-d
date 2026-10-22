export const WORK_AREAS = ['Follow app', 'Light', 'Dark'];

export function workAreaDark(mode, appDark) {
  return mode === 'Dark' || (mode !== 'Light' && appDark);
}
