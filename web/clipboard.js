// In-app drawing snapshots and same-coordinate paste; no browser clipboard access.
import { blocksUsed, extractRaw, makePart } from './layoutdoc.js';
import { dropPart } from './dropin.js';
import { relabelDims, DIM_BLOCK, LDR_BLOCK } from './edit.js';
import { buildLayoutDoc } from './apply.js';
import { explodeSelection } from './explode.js';

export function copySnapshot(raw, selection, factor, name, source = name) {
  const entities = raw.entities.filter((_, i) => selection.has(i));
  return structuredClone({ raw: { ...raw, entities, blocks: blocksUsed(raw.blocks, entities) }, factor, name, source });
}

/** Selected placements keep their library ids and own their part geometry. */
export function copyPlacedSnapshot(parts, placed) {
  return structuredClone({ parts: Object.fromEntries(placed.map((p) => [p.partId, parts[p.partId]])), placed });
}

function drawingFromPlaced(snapshot) {
  const { doc } = buildLayoutDoc({ ...snapshot, sheetW: 0, sheetH: 0 });
  doc.entities = doc.entities.slice(1);
  // Members that cannot safely explode stay in ordinary drawing blocks, preserving their geometry.
  const { entities, blocks } = explodeSelection(doc, new Set(doc.entities.map((_, i) => i)));
  return { raw: { ...doc, entities, blocks: blocksUsed(blocks, entities) }, factor: 1 };
}

/** The clipboard as a new extracted part, with its source name and an unused library name. */
export function partFromSnapshot(snapshot, id, taken) {
  const base = `${snapshot.name} paste`, names = new Set(taken.map((n) => n.toLowerCase()));
  let name = base;
  for (let n = 2; names.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  const raw = extractRaw(structuredClone(snapshot.raw), null);
  return raw && makePart(id, name, raw, snapshot.factor, snapshot.source);
}

export function pasteSnapshot(snapshot, target) {
  const part = structuredClone(snapshot.placed ? drawingFromPlaced(snapshot) : snapshot);
  const s = part.factor / target.factor;
  part.raw.entities = part.raw.entities.map((e) => {
    const name = e.type === 'INSERT' ? String(e.r.v[e.r.c.indexOf(2)] || '') : '';
    // scaleAbout scales annotation blocks but leaves their inserts fixed; copied annotations can have an insert offset.
    if (s !== 1 && (DIM_BLOCK.test(name) || LDR_BLOCK.test(name))) e = { ...e, r: { ...e.r, v: e.r.v.map((v, i) => [10, 20, 30].includes(e.r.c[i]) ? String(+v * s) : v) } };
    return { ...e, ps: false };
  });
  const r = dropPart({ ...part, box: [0, 0], space: 0 }, target, [0, 0]);
  // Unit conversion changes drawing coordinates, not the measured physical length on a dimension.
  if (part.factor !== target.factor) {
    const dims = relabelDims({ entities: [], blocks: blocksUsed(r.blocks, r.entities.slice(r.from)) }, target.factor, target.dp);
    if (dims) r.blocks = { ...r.blocks, ...dims.blocks };
  }
  r.entities = r.entities.map((e, i) => i < r.from ? e : { ...e, ps: !!target.space });
  return r;
}
