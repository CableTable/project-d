// Cursor typing stays separate from the tools; point parsing and geometry stay shared.
import { angleOf, dist, parseInput, typedPoint } from './draw.js';

export const createInput = (first) => ({ mode: first ? 'xy' : 'polar', prefix: '', values: ['', ''], locked: [false, false], active: 0 });
export const hasTyped = (s) => !!(s.prefix || s.values.some(Boolean));

// Keep the clear-before-cancel policy here so an AutoCAD check can change it once.
export const escapeInput = (s, first) => hasTyped(s) ? createInput(first) : null;

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
    next.mode = 'xy'; next.locked[0] = !!s.values[0]; next.active = 1;
  } else if (key === '<' && !first && i === 0) {
    next.mode = 'polar'; next.locked[0] = !!s.values[0]; next.active = 1;
  } else {
    next.values[i] = (s.locked[i] ? '' : s.values[i]) + key; next.locked[i] = false;
  }
  return next;
}

/** Untyped fields use full precision mouse values, never the rounded display text. */
export function pointInput(s, last, mouse) {
  const origin = last || [0, 0], relative = s.prefix === '@' || (!!last && s.prefix !== '#');
  const live = s.mode === 'polar' ? [dist(origin, mouse), angleOf(origin, mouse)]
    : mouse.map((v, i) => v - (relative ? origin[i] : 0));
  const labels = s.mode === 'polar' ? ['Length', 'Angle'] : relative ? ['Δx', 'Δy'] : ['X', 'Y'];
  const errors = s.values.map((v, i) => v && (parseInput(v).kind !== 'len' || !Number.isFinite(+v)) ? `${labels[i]} must be a finite number` : '');
  // The typed-point grammar has no exponent notation (tiny mouse deltas can have it).
  const values = s.values.map((v, i) => v || live[i].toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 21 }));
  const text = (relative ? '@' : '') + values.join(s.mode === 'polar' ? '<' : ',');
  const point = errors.some(Boolean) ? null : typedPoint(parseInput(text), last);
  return { text, point, live, labels, errors, why: errors.find(Boolean) || (point ? '' : 'Point coordinates must be finite') };
}
