// RGB channels are bytes; HSB and CMYK use degrees / percentages, without a colour profile.
export const pack420 = ([r, g, b]) => (r << 16) | (g << 8) | b;
export const unpack420 = (n) => [(n >>> 16) & 255, (n >>> 8) & 255, n & 255];
export const rgbHex = (rgb) => '#' + pack420(rgb).toString(16).padStart(6, '0');

export function parseHex(text) {
  const value = text.trim();
  if (/^#?[\da-f]{6}$/i.test(value)) return unpack420(parseInt(value.replace('#', ''), 16));
  if (!/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(value)) return null;
  const rgb = value.split(',').map(Number);
  return rgb.every((n) => n <= 255) ? rgb : null;
}

export function hsbRgb([h, s, b]) {
  s /= 100; b /= 100;
  const f = (k) => { const a = (k + h / 60) % 6; return Math.round(255 * b * (1 - s * Math.max(0, Math.min(a, 4 - a, 1)))); };
  return [f(5), f(3), f(1)];
}
export function rgbHsb(rgb) {
  const [r, g, b] = rgb.map((n) => n / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, max ? d / max * 100 : 0, max * 100];
}
export function rgbCmyk(rgb) {
  const channels = rgb.map((n) => n / 255), max = Math.max(...channels);
  return [...channels.map((n) => max ? (1 - n / max) * 100 : 0), (1 - max) * 100];
}
export const cmykRgb = ([c, m, y, k]) => [c, m, y].map((n) => Math.round(255 * (1 - n / 100) * (1 - k / 100)));

/** AutoCAD's indexed palette, also used by the drawing renderer. Index zero means ByBlock. */
export const ACI = (() => {
  const t = ['#000000', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffffff', '#808080', '#c0c0c0'];
  const V = [100, 100, 80, 80, 60, 60, 50, 50, 30, 30];
  for (let i = 10; i < 250; i++) {
    const hue = Math.floor((i - 10) / 10) * 15, n = (i - 10) % 10;
    t.push(rgbHex(hsbRgb([hue, n % 2 ? 50 : 100, V[n]])));
  }
  for (const g of [0x33, 0x50, 0x69, 0x82, 0xbe, 0xff]) t.push(rgbHex([g, g, g]));
  return t;
})();
const indexed = ACI.map(parseHex);
/** Euclidean RGB distance; ties use the first index, excluding ByBlock / ByLayer. */
export function nearestAci(rgb) {
  let best = 1, distance = Infinity;
  const grey = Math.max(...rgb) - Math.min(...rgb) <= 8;                // a grey must not land on a tinted index such as 18
  for (let i = 1; i < indexed.length; i++) {
    if (grey && Math.max(...indexed[i]) !== Math.min(...indexed[i])) continue;
    const d = rgb.reduce((sum, n, j) => sum + (n - indexed[i][j]) ** 2, 0);
    if (d < distance) { distance = d; best = i; }
  }
  return best;
}
export function rgbKey(rgb) {
  const aci = nearestAci(rgb);
  return ACI[aci] === rgbHex(rgb) && aci !== 7 ? 'aci:' + aci : 'tc:' + pack420(rgb);
}
export const keyRgb = (key) => key?.startsWith('tc:') ? unpack420(Number(key.slice(3))) : parseHex(key === 'aci:7' ? '#000000' : ACI[Number(key?.slice(4))] || '#ffffff');   // ACI 7 is white or black by the background; the picker opens it as black
export const validColourKey = (key) => typeof key === 'string' && (['bylayer', 'byblock'].includes(key) ||
  /^tc:\d+$/.test(key) && +key.slice(3) <= 0xffffff || /^aci:[1-9]\d*$/.test(key) && +key.slice(4) <= 255);
