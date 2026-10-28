// Cursor typing stays separate from the tools; point parsing and geometry stay shared.
import { angleOf, dist, parseInput, typedPoint } from './draw.js';

export const createInput = (first, mode = first ? 'xy' : 'polar') => ({ mode, prefix: '', values: ['', ''], locked: [false, false], active: 0 });
export const hasTyped = (s) => !!(s.prefix || s.values.some(Boolean));

const rectangle = (T) => T.kind === 'rect' || T.kind === 'rrect';
// Measure, Dimension and Set length are shown by app.js as tools of mm points; Measure types only its first point, its second is a read-only length.
const STAGES = { measure: ['xy'], setlen: ['xy', 'polar'], dimension: ['xy', 'polar', 'xy'] };
export const inputMode = (T) => STAGES[T.kind] ? STAGES[T.kind][T.pts.length] ?? null : T.stage !== 'radius' && ['line', 'polyline', 'rect', 'rrect'].includes(T.kind)
  ? !T.pts.length ? 'xy' : rectangle(T) ? 'size' : 'polar' : null;
export const readOnlyLength = (T) => T.kind === 'measure' && T.pts.length === 1;

/** Rectangles anchor at the first corner, chains at their latest vertex, a dimension line's place at nothing (absolute X / Y). */
export const anchorOf = (T) => rectangle(T) ? T.pts[0] : T.kind === 'dimension' && T.pts.length === 2 ? undefined : T.pts.at(-1);
export const firstPoint = (T) => !anchorOf(T);
export function toolPointInput(s, T) {
  const last = anchorOf(T);
  const result = pointInput(s, last, T.hover || last || [0, 0], T.kind === 'dimension' ? 'Distance' : 'Length');
  // Rectangle's command-bar grammar takes sizes even when cursor entry used absolute X / Y.
  if (rectangle(T) && last && result.point) result.text = '@' + result.point.map((v, i) => (v - last[i]).toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 21 })).join(',');
  return result;
}

// Keep the clear-before-cancel policy here so an AutoCAD check can change it once.
export const escapeInput = (s, first) => hasTyped(s) ? createInput(first, s.mode === 'size' ? 'size' : undefined) : null;

/** A routed key gives a new state; null leaves the key to the command bar. */
export function inputKey(s, key, first) {
  if (key === 'Escape') return escapeInput(s, first);
  if (!/^[0-9.\-,@#<]$/.test(key) && !['Tab', 'Backspace'].includes(key)) return null;
  const next = { ...s, values: [...s.values], locked: [...s.locked] }, i = s.active;
  if (key === 'Tab') {
    next.locked[i] = !!s.values[i]; next.active = 1 - i;
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
