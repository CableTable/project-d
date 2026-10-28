// Uniform drawing-object scaling; widths and direction vectors keep their meaning. No DOM.
import { SPEC, OCS, copyEntities, relabel, DIM_BLOCK, LDR_BLOCK } from './edit.js';

const field = (r, code) => r.v[r.c.indexOf(code)];
const text = (v) => String(+v.toPrecision(15));

export function scaleFactor(text) {
  return /^[+]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim()) && Number.isFinite(+text) && +text > 0 ? +text : null;
}

/** Reference: new length / reference length; null unless both are above 0 (a zero reference cannot scale). */
export const referenceFactor = (reference, next) => reference > 0 && next > 0 && Number.isFinite(reference) && Number.isFinite(next) ? next / reference : null;

export const scaleDistance = (base, point) => Math.hypot(point[0] - base[0], point[1] - base[1]);
export const scaleMatrix = ([x, y], factor) => [factor, 0, 0, factor, x * (1 - factor), y * (1 - factor)];

/** Isolate dimension blocks through Copy before transforming; ordinary inserts keep shared local geometry. */
export function scaleEntities(raw, selection, base, factor, copy = false) {
  if (!base || base.length !== 2 || ![...base, factor].every(Number.isFinite) || factor <= 0) throw new Error('Scale needs a finite base point and a positive factor');
  const next = copyEntities(raw, selection, 0, 0);
  let blocks = next.blocks;
  const done = new Set();
  const one = (e, anchor) => {
    let r = scaleRecord(e.type, e.r, anchor, factor, e.flip);
    let name = field(r, 2);
    const kept = e.type === 'INSERT' && (DIM_BLOCK.test(name) || LDR_BLOCK.test(name));
    if (e.type === 'ACAD_TABLE' && blocks[name]) {
      let n = 1; while (blocks['*T' + n]) n++;
      const own = '*T' + n;
      blocks = { ...blocks, [own]: blocks[name] };
      r = { ...r, v: r.v.map((v, i) => r.c[i] === 2 ? own : v) }; name = own;
    }
    const b = blocks[name];
    if ((e.type === 'DIMENSION' || e.type === 'ACAD_TABLE' || kept) && b && !b.xref && !done.has(name)) {
      done.add(name);
      const local = e.type !== 'DIMENSION';
      let entities = b.entities.map((e) => one(e, local ? [0, 0] : anchor));
      // shortcut: ordinate measurements stay unchanged, recompute when DXF ordinate origins are supported.
      if (e.type === 'DIMENSION' ? ((+field(r, 70) || 0) & 7) !== 6 : DIM_BLOCK.test(name)) entities = relabel(entities, factor);
      blocks = { ...blocks, [name]: { ...b, base: local ? b.base.map((v) => v * factor) : b.base, entities } };
    }
    return { ...e, r, kids: e.kids?.map((kid) => scaleRecord(kid.type, kid, anchor, factor,
      kid.type === 'VERTEX' ? e.flip : +field(kid, 230) < 0)) };
  };
  const copies = next.entities.slice(raw.entities.length).map((e) => one(e, base));
  let k = 0;
  const entities = copy ? [...raw.entities, ...copies] : raw.entities.map((e, i) => selection.has(i) ? copies[k++] : e);
  return { entities, blocks };
}

function scaleRecord(type, r, base, factor, flip) {
  const c = r.c.slice(), v = r.v.slice(), anchor = flip && (OCS.has(type) || type === 'VERTEX') ? [-base[0], base[1]] : base;
  const set = (code, value) => { const k = c.indexOf(code); if (k < 0) { c.push(code); v.push(text(value)); } else v[k] = text(value); };
  const length = (k) => { v[k] = text(+r.v[k] * factor); };
  const pair = (k, vector = false, dy = 10) => {
    const code = r.c[k];
    let j = k + 1;
    while (j < r.c.length && r.c[j] !== code && r.c[j] !== code + dy) j++;
    const x = vector ? 0 : anchor[0], y = vector ? 0 : anchor[1];
    v[k] = text(x + (+r.v[k] - x) * factor);
    const yy = y + ((r.c[j] === code + dy ? +r.v[j] : 0) - y) * factor;
    if (r.c[j] === code + dy) v[j] = text(yy); else { c.push(code + dy); v.push(text(yy)); }
  };
  if (type === 'HATCH') {
    let stage = 'head', flags = 0, edge = 0;
    for (let k = 0; k < r.c.length; k++) {
      const code = r.c[k];
      if (code === 91) stage = 'paths'; else if (code === 75) stage = 'pattern'; else if (code === 98) stage = 'seed';
      else if (stage === 'paths') {
        if (code === 92) { flags = +r.v[k]; edge = 0; }
        else if (code === 72 && !(flags & 2)) edge = +r.v[k];
        else if ([10, 11, 12, 13].includes(code)) pair(k, edge === 3 && code === 11 || edge === 4 && code >= 12);
        else if (edge === 2 && code === 40) length(k);
      } else if (stage === 'pattern') {
        if (code === 43 || code === 45) pair(k, code === 45, 1);
        else if ([41, 47, 49].includes(code)) length(k);
      } else if (stage === 'seed' && code === 10) pair(k);
    }
  } else if (type === 'MLEADER' || type === 'MULTILEADER') {
    const stack = [];
    for (let k = 0; k < r.c.length; k++) {
      const code = r.c[k], value = r.v[k].trim();
      if (code === 300 && value === 'CONTEXT_DATA{') stack.push('ctx');
      else if (code === 302 && value === 'LEADER{') stack.push('leader');
      else if (code === 304 && value === 'LEADER_LINE{') stack.push('line');
      else if ([301, 303, 305].includes(code) && value === '}') stack.pop();
      const where = stack.at(-1);
      const points = where === 'ctx' ? [10, 12, 15, 110] : where === 'leader' ? [10, 12, 13] : where === 'line' ? [10, 11, 12] : [];
      if (points.includes(code)) pair(k);
      else if (where === 'ctx' && [40, 41, 43, 44, 45, 140, 141].includes(code) || where === 'leader' && code === 40) length(k);
    }
  } else {
    const pts = ['ACAD_TABLE', 'WIPEOUT', 'IMAGE', 'VIEWPORT'].includes(type) ? [10] : SPEC[type]?.pts;
    if (!pts) throw new Error('Cannot scale ' + type);
    const vec = type === 'ELLIPSE' ? [11] : type === 'SPLINE' ? [12, 13] : ['WIPEOUT', 'IMAGE'].includes(type) ? [11, 12] : [];
    const lens = ['LWPOLYLINE', 'POLYLINE', 'VERTEX'].includes(type) ? [] : type === 'VIEWPORT' ? [40, 41] : SPEC[type]?.len || [];
    for (let k = 0; k < r.c.length; k++) {
      const code = r.c[k];
      if (pts.includes(code) || vec.includes(code)) pair(k, vec.includes(code));
      else if (lens.includes(code) && !(type === 'DIMENSION' && code === 42 && [2, 5, 6].includes((+field(r, 70) || 0) & 7))) length(k);
    }
    if (type === 'INSERT' && !DIM_BLOCK.test(field(r, 2)) && !LDR_BLOCK.test(field(r, 2))) {
      for (const code of [41, 42, 43]) set(code, (+(field(r, code) || 1) || 1) * factor);
    }
  }
  if (v.some((value, k) => value !== r.v[k] && !Number.isFinite(+value))) throw new Error('Scale result is too large');
  return { ...r, c, v };
}
