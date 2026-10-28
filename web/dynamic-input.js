// Cursor typing stays separate from the tools; point parsing and geometry stay shared.
import { angleOf, dist, parseInput, typedPoint } from './draw.js';

export const createInput = (first, mode = first ? 'xy' : 'polar') => ({ mode, prefix: '', values: ['', ''], locked: [false, false], active: 0 });
export const hasTyped = (s) => !!(s.prefix || s.values.some(Boolean));

const rectangle = (T) => T.kind === 'rect' || T.kind === 'rrect';
// Measure, Dimension, Set length and the Modify tools are shown by app.js as tools of mm points; Measure types only its first point, its second is a read-only length.
// Move / Copy take a base point only (their target stays the prompt); Rotate then types an Angle, Scale a Factor: one number, no point.
// Circle types its centre then one Radius; Ellipse its centre, Length + Angle of axis 1, then one Length (the other half-axis); Arc its first point, then Length + Angle from the previous point twice.
const STAGES = { measure: ['xy'], setlen: ['xy', 'polar'], dimension: ['xy', 'polar', 'xy'], move: ['xy'], copy: ['xy'], rotate: ['xy', 'angle'], scale: ['xy', 'factor'],
  circle: ['xy', 'radius'], ellipse: ['xy', 'polar', 'length'], arc: ['xy', 'polar', 'polar'] };
export const isSingle = (mode) => ['angle', 'factor', 'radius', 'length'].includes(mode);
export const inputMode = (T) => STAGES[T.kind] ? STAGES[T.kind][T.pts.length] ?? null : T.stage !== 'radius' && ['line', 'polyline', 'rect', 'rrect'].includes(T.kind)
  ? !T.pts.length ? 'xy' : rectangle(T) ? 'size' : 'polar' : null;
export const readOnlyLength = (T) => T.kind === 'measure' && T.pts.length === 1;

/** Rectangles anchor at the first corner, an ellipse's last half-axis at its centre, chains at their latest vertex, a dimension line's place at nothing (absolute X / Y). */
export const anchorOf = (T) => rectangle(T) || (T.kind === 'ellipse' && T.pts.length === 2) ? T.pts[0] : T.kind === 'dimension' && T.pts.length === 2 ? undefined : T.pts.at(-1);
export const firstPoint = (T) => !anchorOf(T);
export function toolPointInput(s, T) {
  const last = anchorOf(T);
  if (isSingle(s.mode)) return valueInput(s, last, T.hover || last, s.mode === 'factor' ? T.f || 1 : 1, T.dia);
  const result = pointInput(s, last, T.hover || last || [0, 0], T.kind === 'dimension' ? 'Distance' : 'Length');
  if (s.mode === 'polar' && ['ellipse', 'arc'].includes(T.kind) && s.values[0] && !(+s.values[0] > 0) && !result.errors[0]) {   // no axis or chord of 0 or less
    result.errors[0] = result.why = 'Length must be more than 0'; result.point = null;
  }
  // Rectangle's command-bar grammar takes sizes even when cursor entry used absolute X / Y.
  if (rectangle(T) && last && result.point) result.text = '@' + result.point.map((v, i) => (v - last[i]).toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 21 })).join(',');
  return result;
}

// Keep the clear-before-cancel policy here so an AutoCAD check can change it once.
export const escapeInput = (s, first) => hasTyped(s) ? createInput(first, s.mode === 'size' || isSingle(s.mode) ? s.mode : undefined) : null;

/** A routed key gives a new state; null leaves the key to the command bar. */
export function inputKey(s, key, first) {
  if (key === 'Escape') return escapeInput(s, first);
  if (!/^[0-9.\-,@#<]$/.test(key) && !['Tab', 'Backspace'].includes(key)) return null;
  if (isSingle(s.mode) && /^[,@#<]$/.test(key)) return null;                   // one number: x,y and polar text stay in the command box
  const next = { ...s, values: [...s.values], locked: [...s.locked] }, i = s.active;
  if (key === 'Tab') {
    next.locked[i] = !!s.values[i]; next.active = isSingle(s.mode) ? 0 : 1 - i;
  } else if (key === 'Backspace') {
    if (s.values[i]) next.values[i] = s.values[i].slice(0, -1);
    else next.prefix = '';
    next.locked[i] = false;
  } else if ((key === '#' || key === '@') && !s.values.some(Boolean)) {
    next.prefix = key;
    if (key === '#') next.mode = 'xy';
  } else if (key === ',' && i === 0) {
    if (s.mode !== 'size') next.mode = 'xy';
    next.locked[0] = !!s.values[0]; next.active = 1;
  } else if (key === '<' && !first && i === 0 && s.mode !== 'size') {
    next.mode = 'polar'; next.locked[0] = !!s.values[0]; next.active = 1;
  } else {
    next.values[i] = (s.locked[i] ? '' : s.values[i]) + key; next.locked[i] = false;
  }
  return next;
}

/** Untyped fields use full precision mouse values, never the rounded display text. */
export function pointInput(s, last, mouse, lengthLabel = 'Length') {
  const origin = last || [0, 0], relative = s.prefix === '@' || (!!last && s.prefix !== '#');
  const live = s.mode === 'size' ? mouse.map((v, i) => Math.abs(v - origin[i]))
    : s.mode === 'polar' ? [dist(origin, mouse), angleOf(origin, mouse)]
    : mouse.map((v, i) => v - (relative ? origin[i] : 0));
  const labels = s.mode === 'size' ? ['Width', 'Height'] : s.mode === 'polar' ? [lengthLabel, 'Angle'] : relative ? ['Δx', 'Δy'] : ['X', 'Y'];
  const errors = s.values.map((v, i) => v && (parseInput(v).kind !== 'len' || !Number.isFinite(+v)) ? `${labels[i]} must be a finite number`
    : s.mode === 'size' && +(v || live[i]) === 0 ? `${labels[i]} must not be zero` : '');
  // The typed-point grammar has no exponent notation (tiny mouse deltas can have it).
  const values = s.values.map((v, i) => {
    const value = s.mode === 'size' ? +(v || live[i]) * (mouse[i] < origin[i] ? -1 : 1) : v || live[i];
    return typeof value === 'number' ? value.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 21 }) : value;
  });
  const text = (relative ? '@' : '') + values.join(s.mode === 'polar' ? '<' : ',');
  const point = errors.some(Boolean) ? null : typedPoint(parseInput(text), last);
  return { text, point, live, labels, errors, why: errors.find(Boolean) || (point ? '' : 'Point coordinates must be finite') };
}

const ONE = { angle: 'Angle', factor: 'Factor', radius: 'Radius', length: 'Length' };
/** The one number of Rotate (degrees from the pivot), Scale (a factor), Circle (radius, or diameter after D) or an ellipse's last half-axis (mm); untyped, it is the mouse's value. `unit` is mm per drawing unit: a factor is a ratio of drawing-unit distances. A length also gives `point`, along the mouse's way, so the tool's own preview follows it. */
function valueInput(s, base, mouse, unit, dia) {
  const mode = s.mode, label = mode === 'radius' && dia ? 'Diameter' : ONE[mode], typed = s.values[0];
  const live = [mode === 'angle' ? angleOf(base, mouse) : dist(base, mouse) / unit * (label === 'Diameter' ? 2 : 1)];
  const bad = typed && (parseInput(typed).kind !== 'len' || !Number.isFinite(+typed)) ? `${label} must be a finite number` : '';
  const value = typed ? +typed : live[0];
  const error = bad || (mode !== 'angle' && !(value > 0) && (typed || mode === 'factor') ? `${label} must be more than 0` : '');
  const point = (mode === 'radius' || mode === 'length') && !error ? alongTo(base, mouse, value) : null;
  return { value: error ? null : value, point, live, labels: [label], errors: [error, ''], text: String(value), why: error };
}
const alongTo = (a, b, v) => { const d = dist(a, b), u = d > 1e-9 ? [(b[0] - a[0]) / d, (b[1] - a[1]) / d] : [1, 0]; return [a[0] + u[0] * v, a[1] + u[1] * v]; };
