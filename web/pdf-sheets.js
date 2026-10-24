// Only visited pages hold drawing state. The active page lives on the tab.
const FIELDS = 'raw fl factor off counts entities conv box hist bg dirty name path saved acceptedLoss curLayer addedLayers locked hid om scaleTarget savedAs'.split(' ');

export const pageFields = (d) => Object.fromEntries(FIELDS.map((key) => [key, d[key]]));
export const sheetNumbers = (pdf) => pdf.sheets || Array.from({ length: pdf.pages }, (_, i) => i + 1);

export function keepPage(d) {
  const pages = d.pdf.states || (d.pdf.states = new Map());
  const state = pageFields(d);
  if (d.pdf.picture && state.bg) state.bg = { ...state.bg, bitmap: null };
  pages.set(d.pdf.page, state);
}

export const dirtySheets = (d) => sheetNumbers(d.pdf).filter((n) => n === d.pdf.page ? d.dirty : d.pdf.states?.get(n)?.dirty);
export const hasChanges = (d) => d.pdf ? dirtySheets(d).length > 0 : d.dirty;

/** Keep original PDF numbers; the shown page goes to its next neighbour, or its previous one. */
export function withoutSheet(pdf, n) {
  const sheets = sheetNumbers(pdf), i = sheets.indexOf(n);
  if (i < 0 || sheets.length === 1) return null;
  const left = sheets.filter((page) => page !== n);
  return { sheets: left, page: pdf.page === n ? left[Math.min(i, left.length - 1)] : pdf.page };
}

/** Undo belongs to this sheet: leave later edits on other sheets, and deleted sheets, alone. */
export function restoreBalloons(current, saved, sheet) {
  const others = current.items.filter((it) => it.sheet !== sheet);
  const items = [...others, ...saved.items.filter((it) => it.sheet === sheet)];
  return { items, next: Math.max(saved.next, ...others.map((it) => it.n + 1)), seq: Math.max(current.seq, saved.seq) };
}
