// Ribbon tab sets and folding, independent of the DOM.
export const FOLDS = ['full', 'titles', 'tabs'];
export function ribbonTabs(kind) {
  return ['Home', ...(kind === 'layout' ? ['Layout'] : kind === 'compare' ? ['Compare'] : ['Draw', 'Modify', 'Annotate']), 'View', 'Output'];
}
export const nextFold = (mode) => FOLDS[(FOLDS.indexOf(mode) + 1) % FOLDS.length];
export const doubleFold = (mode, last) => mode === 'tabs' ? (last === 'titles' ? 'titles' : 'full') : 'tabs';
