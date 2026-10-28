// layoutcontour.js — pure: Contour on a placed part of a layout (TODO 147, T53) (no DOM) — layoutcontour.test.mjs.
//
// A part's contour follows its outer outline only (its biggest closed loop; holes and inside features are left alone). The rings
// of one run become one new part (all steps), placed on the sheet exactly where the source part's outline is, with the same turn
// and mirror, so the app can group the two and they travel together. The geometry stays in the source part's own drawing units.
import * as Ed from './edit.js';
import * as CT from './contour.js';
import * as PR from './props.js';
import { mapply } from './drawing.js';
import { makePart } from './layoutdoc.js';
import { placedMat, placement1 } from './apply.js';
import { addLayer } from './dxf-write.js';

const loops = new WeakMap(), results = new WeakMap();

/** The part's outer outline in its drawing units: { loop (its biggest closed loop, or null), open (pieces left open when there is none) }. Kept per part. */
export function outerLoop(part) {
  if (loops.has(part)) return loops.get(part);
  const out = { loop: null, open: 0 };
  try {
    const ed = Ed.makeIndex(part.raw, part.fl, part.off || new Set()), ents = [];
    for (let e = 0; e < ed.byEnt.length; e++) if (ed.byEnt[e]) ents.push(e);
    const segs = CT.segmentsFromItems(ed, ents, (e) => e.layer === Ed.DIM_LAYER || e.type === 'DIMENSION');
    const r = CT.buildLoops(segs, Ed.chainTol(part.box, part.factor || 1));
    out.open = r.open;
    for (const l of r.loops) if (!out.loop || Math.abs(CT.loopArea(l)) > Math.abs(CT.loopArea(out.loop))) out.loop = l;
  } catch { /* an unreadable part has no outline */ }
  loops.set(part, out);
  return out;
}

/**
 * The contour of a part for cfg { dist (mm), steps, dir ('inside' | 'outside'), corners ('sharp' | 'rounded') }:
 * { kind: 'ok' | 'open' (no closed outline) | 'none' (nothing to make with these values), loop, open, res (CT.contour's result) }. Kept per part, placement scale and values.
 */
export function partContour(part, cfg, sc = 1) {
  const key = [cfg.dist, cfg.steps, cfg.dir, cfg.corners, sc].join('|');
  let byKey = results.get(part);
  if (!byKey) results.set(part, byKey = new Map());
  if (byKey.has(key)) return byKey.get(key);
  const { loop, open } = outerLoop(part);
  let out = { kind: 'open', loop: null, open, res: null };
  if (loop) {
    const res = CT.contour([loop], { dist: cfg.dist / ((part.factor || 1) * sc), steps: cfg.steps, outward: cfg.dir === 'outside', corners: cfg.corners });
    out = { kind: res.made ? 'ok' : 'none', loop, open, res };
  }
  byKey.set(key, out);
  return out;
}

/**
 * The part a contour result makes (the rings as lines and arcs on `o.layer`, the colour and line style of the Contour panel), or null.
 * o: { id, name, layer, colour (props.js key), lt ('BYLAYER' | 'DASHED' | 'DOT'), dash (the style's pattern in mm) }.
 */
export function contourPart(part, res, o) {
  const f = part.factor || 1, ents = [];
  for (const st of res.steps) for (const l of st) ents.push(...CT.toEntities(l, o.layer));
  const raw = { header: { ...part.raw.header }, layers: {}, ltypes: { ...part.raw.ltypes }, blocks: {},
    entities: ents.map((e) => ({ ...PR.withLineType(PR.withColour(e, o.colour), o.lt), ps: false })) };
  addLayer(raw, o.layer, { aci: 3 });
  if (o.lt !== 'BYLAYER' && !raw.ltypes[o.lt]) raw.ltypes[o.lt] = { pattern: o.dash.map((x, i) => (i % 2 ? -x : x) / f), contour: true };
  return makePart(o.id, o.name, raw, f, part.src);
}

const r6 = (v) => Math.round(v * 1e6) / 1e6;
/** Where the contour part goes so its rings lie on the source part's outline: the source's turn and mirror, and its corner moved by the boxes' difference. */
export function contourPlacement(srcPart, srcPl, ctPart) {
  const f = srcPart.factor || 1, u = (ctPart.box[0] - srcPart.box[0]) * f, v = (ctPart.box[1] - srcPart.box[1]) * f;
  const th = (srcPl.rot || 0) * Math.PI / 180, co = Math.cos(th), si = Math.sin(th), k = srcPl.sc || 1, p = u * k * (srcPl.mirrorX ? -1 : 1), q = v * k * (srcPl.mirrorY ? -1 : 1);
  return { ...placement1(ctPart.id, r6(srcPl.x + co * p - si * q), r6(srcPl.y + si * p + co * q), srcPl.rot, srcPl.mirrorX, srcPl.mirrorY), ...(srcPl.sc ? { sc: srcPl.sc } : {}) };
}

/** The rings of a contour result as closed point lists on the sheet (mm, y up), for the preview. */
export function sheetLoops(part, pl, res, sheetH) {
  const M = placedMat(part, pl, sheetH);
  return res.steps.flatMap((st) => st.map((l) => CT.loopPoints(l, 3).map(([x, y]) => { const q = mapply(M, x, y); return [q[0], sheetH - q[1]]; })));
}
