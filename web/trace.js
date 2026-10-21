// trace.js — Trace a bitmap (TODO 40): the pure part. imagetracerjs (web/vendor/imagetracer, Unlicense) does the tracing; this file maps the
// dialog's four controls to its options, makes the picture black and white for the two-colour case, and turns its paths into closed
// polylines at the picture's position and true size.   node trace.test.mjs
//   fitSize(w, h)                      → { w, h, k }  the size to trace at (long side at most MAX_PX), and the shrink k
//   tracerOptions(p)                   → imagetracerjs options from { threshold, detail, smoothing, colours } (all 0–100 but colours 2–32)
//   maskThreshold(data, threshold)     black and white from RGBA bytes, in place
//   isBackground(colour)               white and see-through colours are the paper, not artwork
//   tracedataToPolys(td, mmW, mmH)     [[ [x, y] … ]] closed outlines in mm from the picture's bottom-left, y up
//   traceEntities(polys, o)            LWPOLYLINE entities: o = { x, y (picture's bottom-left, mm), factor (mm per drawing unit), layer }
import { lwpoly } from './dxf-write.js';

/** The longest side traced; a bigger picture is shrunk to this first so the dialog stays quick. */
export const MAX_PX = 1000;
export const DEFAULTS = { threshold: 128, detail: 65, smoothing: 30, colours: 2 };
export const MAX_COLOURS = 32;
/** More outlines than this and a noisy scan would freeze the dialog (42,000 took 2.9 s): the preview asks for less Detail instead. */
export const MAX_OUTLINES = 5000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const r2 = (v) => Math.round(v * 100) / 100;

export function fitSize(w, h, max = MAX_PX) {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), k };
}

const BLACK_WHITE = [{ r: 0, g: 0, b: 0, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }];
/** Detail → how closely lines and curves follow the pixels, and how small a speck still counts; smoothing → blur radius (0–5 px). */
export function tracerOptions(p) {
  const detail = clamp(p.detail, 0, 100) / 100, smooth = clamp(p.smoothing, 0, 100) / 100, n = Math.round(clamp(p.colours, 2, MAX_COLOURS));
  const tol = r2(0.1 + (1 - detail) * 3);
  const o = { ltres: tol, qtres: tol, pathomit: Math.round((1 - detail) * 24), blurradius: Math.round(smooth * 5), blurdelta: 20, numberofcolors: n,
    colorsampling: 2, colorquantcycles: 3, rightangleenhance: true, roundcoords: 2, strokewidth: 0 };
  if (n === 2) { o.pal = BLACK_WHITE.map((c) => ({ ...c })); o.colorsampling = 0; o.colorquantcycles = 1; }       // black ink on white: the threshold decides which is which
  return o;
}

/** Every pixel black (darker than the threshold, 0–255) or white; see-through pixels are white. */
export function maskThreshold(data, threshold) {
  for (let i = 0; i < data.length; i += 4) {
    const dark = data[i + 3] >= 128 && 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < threshold, v = dark ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return data;
}

export const isBackground = (c) => !c || c.a < 128 || 0.299 * c.r + 0.587 * c.g + 0.114 * c.b >= 235;

/** A path's corner points; a curve piece (a quadratic) is cut into straight pieces no more than 0.25 px off the curve. */
function pathPoints(path) {
  const segs = path.segments;
  if (!segs || !segs.length) return [];
  const pts = [[segs[0].x1, segs[0].y1]];
  for (const s of segs) {
    if (s.type !== 'Q') { pts.push([s.x2, s.y2]); continue; }
    const p0 = pts[pts.length - 1], dev = Math.hypot(p0[0] - 2 * s.x2 + s.x3, p0[1] - 2 * s.y2 + s.y3) / 4, n = Math.min(16, Math.max(1, Math.ceil(Math.sqrt(dev / 0.25))));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push([u * u * p0[0] + 2 * u * t * s.x2 + t * t * s.x3, u * u * p0[1] + 2 * u * t * s.y2 + t * t * s.y3]);
    }
  }
  return pts;
}

const area2 = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0);

/** The traced outlines (holes too) of every colour that is not paper, in mm from the picture's bottom-left corner, y up. */
export function tracedataToPolys(td, mmW, mmH) {
  const sx = mmW / td.width, sy = mmH / td.height, out = [];
  td.layers.forEach((layer, i) => {
    if (isBackground(td.palette[i])) return;
    for (const path of layer) {
      const pts = pathPoints(path);
      const last = pts[pts.length - 1];
      if (pts.length > 1 && last[0] === pts[0][0] && last[1] === pts[0][1]) pts.pop();
      const poly = pts.map(([px, py]) => [Math.round(px * sx * 1e4) / 1e4, Math.round((td.height - py) * sy * 1e4) / 1e4]);
      if (poly.length >= 3 && Math.abs(area2(poly)) > 1e-9) out.push(poly);
    }
  });
  return out;
}

export function traceEntities(polys, o) {
  const f = o.factor || 1, at = (p) => [Math.round((o.x + p[0]) / f * 1e5) / 1e5, Math.round((o.y + p[1]) / f * 1e5) / 1e5];
  return polys.map((p) => lwpoly(p.map(at), { layer: o.layer, closed: true }));
}
