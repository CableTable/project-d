import { validColourKey, pack420, rgbHex, parseHex, keyRgb } from './colour.js';
import { colourLabel } from './props.js';

const literal = (key) => validColourKey(key) && key !== 'bylayer' && key !== 'byblock';
export const STANDARD_SWATCHES = [...Array.from({ length: 9 }, (_, i) => 'aci:' + (i + 1)), 'tc:0', 'tc:16777215'];

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
    group, swatches: colours.map((key) => ({ key, title: key.startsWith('aci:') ? 'Colour ' + key.slice(4) : colourLabel(key),
      id: key.startsWith('tc:') ? rgbHex(keyRgb(key)) : null }))
  }));
}
