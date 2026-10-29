// Drawing saves expose overrides to CAD apps as native DIMENSION group 1, with the same cached graphics.
import { dimOfEntity, readDim, dimGeom, freeName } from './edit.js';
import { bakeBlock, turnedTag } from './layoutdim.js';
import { entity } from './dxf-write.js';
import { unitFactor } from './doc.js';
import { UNITS } from './drawing.js';

const field = (e, c) => e.r.v[e.r.c.indexOf(c)];
const point = (code, p) => [[code, p[0]], [code + 10, p[1]], [code + 20, 0]];
const DEG = Math.PI / 180;

export function nativeDimensionOverrides(raw) {
  const blocks = { ...raw.blocks }, dimstyles = { ...raw.dimstyles }, converted = new Set();
  const uses = new Map();
  for (const e of [...raw.entities, ...Object.values(raw.blocks).flatMap((b) => b.entities)]) {
    if (['INSERT', 'DIMENSION'].includes(e.type)) { const name = field(e, 2); uses.set(name, (uses.get(name) || 0) + 1); }
  }
  const entities = raw.entities.map((e, i) => {
    const dim = dimOfEntity(raw, i);
    if (!dim?.params.override) return e;
    const sx = +(field(e, 41) || 1), sy = +(field(e, 42) || 1), rot = +(field(e, 50) || 0);
    // shortcut: keep non-uniform imported INSERTs as blocks, until dimension editing supports that distortion.
    if (Math.abs(Math.abs(sx) - Math.abs(sy)) > 1e-9) return e;
    const old = raw.blocks[dim.name], block = bakeBlock(old, { box: old.base }, {
      x: +(field(e, 10) || 0), y: +(field(e, 20) || 0), rot, sc: Math.abs(sx), mirrorX: sx < 0, mirrorY: sy < 0,
    });
    const tag = turnedTag((/^PD_DIM_([HV])/.exec(dim.name) || [])[1] || dim.params.axis?.toUpperCase(), rot);
    const kind = dim.kind === 'linear' && !tag ? 'aligned' : dim.kind;
    const shared = uses.get(dim.name) > 1;
    const name = kind === dim.kind && (kind !== 'linear' || tag?.toLowerCase() === dim.params.axis) && !shared
      ? dim.name : freeName(blocks, kind, tag?.toLowerCase());
    delete block.dimAxis;
    blocks[name] = block; converted.add(dim.name);
    const { params: p } = readDim(name, block), factor = unitFactor(UNITS[+raw.header.$INSUNITS]), g = dimGeom(kind, p, factor, dim.dp);
    const tx = block.entities.find((child) => child.type === 'TEXT'), angle = +field(tx, 50) * DEG;
    const rise = ({ 1: .5, 3: -.5 }[+field(tx, 73)] || 0) * +field(tx, 40);
    const middle = [+field(tx, 10) - Math.sin(angle) * rise, +field(tx, 20) + Math.cos(angle) * rise];
    const type = { aligned: 1, linear: 0, radius: 4, diameter: 3, angle: 5 }[kind];
    let points;
    if (kind === 'angle') {
      const at = (a) => [p.v[0] + p.r * Math.cos(a * DEG), p.v[1] + p.r * Math.sin(a * DEG)];
      points = [...point(10, at(p.a0 + ((p.a1 - p.a0 + 360) % 360) / 2)), ...point(13, at(p.a0)), ...point(14, at(p.a1)), ...point(15, p.v)];
    } else if (kind === 'radius') {
      const solid = block.entities.find((child) => child.type === 'SOLID');
      points = [...point(10, p.c), ...point(15, [+field(solid, 10), +field(solid, 20)]), [40, 0]];
    } else if (kind === 'diameter') points = [...point(10, p.a), ...point(15, p.b), [40, 0]];
    else points = [...point(10, g.line.slice(2)), ...point(13, p.a), ...point(14, p.b), ...(kind === 'linear' ? [[50, p.axis === 'v' ? 90 : 0]] : [])];
    dimstyles[name] = { c: [70, 40, 41, 42, 44, 140, 144, 147, 271, 277, 77, 179, 275, 3],
      v: [0, 1, p.arrow, p.gap || 0, .4 * p.textH, p.textH, factor / (p.units === 'inch' ? 25.4 : 1), .4 * p.textH, dim.dp, 2, p.pos === 'centre' ? 0 : 1, dim.dp, 0, p.units === 'inch' ? '<>"' : ''].map(String) };
    return entity('DIMENSION', [[2, name], [3, name], [70, type + 32 + 128], [1, p.override], ...point(11, middle), ...points], e);
  });
  const refs = new Set([...entities, ...Object.values(blocks).flatMap((b) => b.entities)].filter((e) => ['INSERT', 'DIMENSION'].includes(e.type)).map((e) => field(e, 2)));
  for (const name of converted) if (!refs.has(name)) delete blocks[name];
  return { ...raw, entities, blocks, dimstyles };
}
