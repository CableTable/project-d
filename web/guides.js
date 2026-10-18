// guides.js — pure: rulers and guidelines (no DOM) — guides.test.mjs.
//
// A guide is { axis: 'x' | 'y', mm }: 'x' is a vertical line at that X on the sheet, 'y' a horizontal line at that Y (mm; 0,0 is the
// sheet's bottom-left and Y counts up, as everywhere in the app). Boxes are [x0, y0, x1, y1] in the same mm, y up.

export const MAX_GUIDES = 200;
const r6 = (v) => { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; };

/** Guides read from a file or typed: odd entries go, positions kept to 6 decimals, at most MAX_GUIDES. */
export function cleanGuides(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((g) => g && (g.axis === 'x' || g.axis === 'y') && Number.isFinite(+g.mm) && g.mm !== '' && g.mm !== null)
    .slice(0, MAX_GUIDES).map((g) => ({ axis: g.axis, mm: r6(+g.mm) }));
}

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];

/**
 * Where the ruler's marks go: from `lo` to `hi` mm, with `scale` pixels to the mm. A numbered mark about every `minPx` pixels
 * (1, 2, 5, 10 … mm), small marks between (a fifth of the step, a quarter for 2s). → { major, minor, ticks: [{ v, major }] }.
 */
export function rulerTicks(lo, hi, scale, minPx = 64) {
  const major = STEPS.find((s) => s * scale >= minPx) || STEPS[STEPS.length - 1];
  const minor = major / (String(major)[0] === '2' ? 4 : 5), ticks = [];
  if (!(hi > lo) || !(scale > 0)) return { major, minor, ticks };
  const k0 = Math.ceil(lo / minor - 1e-9), k1 = Math.floor(hi / minor + 1e-9);
  for (let k = k0; k <= k1 && ticks.length < 4000; k++) {
    const v = r6(k * minor);
    ticks.push({ v, major: Math.abs(v / major - Math.round(v / major)) < 1e-6 });
  }
  return { major, minor, ticks };
}

/** A mark's label: whole numbers as they are, others with only the decimals they need. */
export const tickLabel = (v) => String(+Number(v).toFixed(3)).replace(/^-0$/, '0');

/**
 * Lands a box on the guides: the left edge, middle or right edge of the box on a vertical guide, the bottom, middle or top on a
 * horizontal one, whichever is nearest and within `tol` mm. skipX / skipY leave an axis alone (a straight drag).
 * → { dx, dy, hits: [{ axis, mm }] } — the move to add, and the guides it landed on.
 */
export function snapBoxToGuides(box, guides, tol, { skipX = false, skipY = false } = {}) {
  const out = { dx: 0, dy: 0, hits: [] };
  const best = (edges, axis) => {
    let d = null, g = null;
    for (const gd of guides) {
      if (gd.axis !== axis) continue;
      for (const e of edges) { const m = gd.mm - e; if (Math.abs(m) <= tol && (d === null || Math.abs(m) < Math.abs(d) - 1e-9)) { d = m; g = gd; } }
    }
    return d === null ? null : { d, g };
  };
  if (!skipX) { const b = best([box[0], (box[0] + box[2]) / 2, box[2]], 'x'); if (b) { out.dx = r6(b.d); out.hits.push({ axis: 'x', mm: b.g.mm }); } }
  if (!skipY) { const b = best([box[1], (box[1] + box[3]) / 2, box[3]], 'y'); if (b) { out.dy = r6(b.d); out.hits.push({ axis: 'y', mm: b.g.mm }); } }
  return out;
}

/** A free position for a new guide on this axis: `start`, then 10 mm further on while another guide is already there. */
export function freeSpot(guides, axis, start) {
  let v = start;
  for (let i = 0; i < 1000 && guides.some((g) => g.axis === axis && Math.abs(g.mm - v) < 0.005); i++) v += 10;
  return v;
}

/** "Y 350.00" or "X 250.00": the readout of a guide. */
export const guideText = (g) => `${g.axis === 'x' ? 'X' : 'Y'} ${Number(g.mm).toFixed(2)}`;
