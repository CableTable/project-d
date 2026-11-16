import { validColourKey, pack420, rgbHex, parseHex, keyRgb } from './colour.js';
import { colourLabel } from './props.js';

const literal = (key) => validColourKey(key) && key !== 'bylayer' && key !== 'byblock';
const tc = (r, g, b) => 'tc:' + pack420([r, g, b].map(Math.round));
const hsl = (h, s, l) => { const a = s * Math.min(l, 1 - l), f = (n) => (l - a * Math.max(-1, Math.min((n + h / 30) % 12 - 3, 9 - (n + h / 30) % 12, 1))) * 255; return tc(f(0), f(8), f(4)); };
const GREYS = [90, 80, 70, 60, 40, 30, 20, 10].map((ink) => [ink, tc(...Array(3).fill(255 * (100 - ink) / 100))]);   // ink darkness; 50% skipped, tc:8421504 would equal ACI 8
const TITLES = { 'tc:0': 'Black', 'tc:16777215': 'White', ...Object.fromEntries(GREYS.map(([ink, key]) => [key, `Grey ${ink}%`])) };
/** Greys, ACI 1..9 (kept as DXF index colours), then 10 hues x 8 tints, soft to deep. */
export const STANDARD_SWATCHES = ['tc:0', ...GREYS.map(([, key]) => key), 'tc:16777215', ...Array.from({ length: 9 }, (_, i) => 'aci:' + (i + 1)),
  ...Array.from({ length: 10 }, (_, i) => [90, 80, 70, 60, 50, 40, 30, 20].map((l) => hsl(i * 36, .7, l / 100))).flat()];

/** Stored keys retain indexed / true-colour identity; the first occurrence is newest. */
export function recentColours(stored, used) {
  return [...new Set([used, ...(Array.isArray(stored) ? stored : [])].filter(literal))].slice(0, 12);
}

/** Three groups, including empty groups, so their order and separators stay fixed. */
export function stripGroups(saved, recent) {
  const keys = (Array.isArray(saved) ? saved : []).flatMap((rec) => {
    const rgb = typeof rec?.id === 'string' && /^#[\da-f]{6}$/i.test(rec.id) ? parseHex(rec.id) : null;
    return rgb ? ['tc:' + pack420(rgb)] : [];
  });
  return [['standard', STANDARD_SWATCHES], ['saved', [...new Set(keys)]], ['recent', recentColours(recent)]].map(([group, colours]) => ({
    group, swatches: colours.map((key) => ({ key, title: (group === 'standard' && TITLES[key]) || (key.startsWith('aci:') ? 'Colour ' + key.slice(4) : colourLabel(key)),
      id: key.startsWith('tc:') ? rgbHex(keyRgb(key)) : null }))
  }));
}
