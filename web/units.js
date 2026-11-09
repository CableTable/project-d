// Drawing-unit lengths in mm. No DOM; file coordinates never change with this setting.
export const UNITS = ['mm', 'inch', 'ft', 'ft-in'];
const FACTOR = { mm: 1, inch: 25.4, ft: 304.8, 'ft-in': 304.8 };
const NUM = '(?:\\d+\\.?\\d*|\\.\\d+)';
const DECIMAL = new RegExp(`^[+-]?${NUM}$`);
const MARKS = new RegExp(`^([+-]?)(${NUM})\\s*'\\s*(?:-?\\s*(${NUM})\\s*")?$`);
const INCH = new RegExp(`^([+-]?${NUM})\\s*"$`);

/** A whole length token, or null. Only mm keeps decimal-comma input. */
export function parse(text, unit = 'mm') {
  let s = String(text ?? '').trim();
  if (!UNITS.includes(unit)) return null;
  if (unit === 'mm') s = s.replace(',', '.');
  let value, m = MARKS.exec(s);
  if (m) value = (m[1] === '-' ? -1 : 1) * (+m[2] * 304.8 + +(m[3] || 0) * 25.4);
  else if ((m = INCH.exec(s))) value = +m[1] * 25.4;
  else {
    const mm = /\s*mm$/i.test(s);
    if (mm) s = s.replace(/\s*mm$/i, '');
    if (!DECIMAL.test(s)) return null;
    value = +s * (mm ? 1 : FACTOR[unit]);
  }
  return Number.isFinite(value) ? value : null;
}

/** The drawing's printed length; rounded forms parse back to the printed precision. */
export function format(mm, unit = 'mm') {
  if (unit === 'inch' || unit === 'ft') return (+(mm / FACTOR[unit]).toFixed(3) || 0).toLocaleString('en-US', { useGrouping: false, minimumFractionDigits: 3, maximumFractionDigits: 3 }) + (unit === 'inch' ? '"' : "'");
  if (unit === 'ft-in') {
    const inches = Math.round(Math.abs(mm) / 25.4 * 100) / 100;
    return (mm < 0 && inches ? '-' : '') + Math.floor(inches / 12).toLocaleString('en-US', { useGrouping: false }) + "'-" + +(inches % 12).toFixed(2) + '"';
  }
  return (+mm.toFixed(2) || 0).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 2 });
}

export const defaultUnit = (insunits) => +insunits === 1 ? 'inch' : +insunits === 2 ? 'ft' : 'mm';
export const sidecarPath = (path) => String(path).replace(/([^\\/])\.[^./\\]+$/, '$1') + '.pdunits.json';
export const isSidecar = (name) => /\.pdunits\.json$/i.test(name);
export const encode = (unit) => JSON.stringify({ kind: 'Project D drawing unit', unit });
export function decode(text) {
  try { const v = JSON.parse(text); return v?.kind === 'Project D drawing unit' && UNITS.includes(v.unit) ? v.unit : null; }
  catch { return null; }
}
