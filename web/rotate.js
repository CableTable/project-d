// Drawing-unit rotation, counter-clockwise degrees. No DOM.
import { SPEC, OCS, moveEntities, copyEntities } from './edit.js';
import { turnBetween } from './place.js';

const field = (r, code) => r.v[r.c.indexOf(code)];
const text = (v) => String(+v.toPrecision(15));

export function rotationAngle(pivot, point, shift = false) {
  const a = Math.atan2(point[1] - pivot[1], point[0] - pivot[0]) * 180 / Math.PI;
  return shift ? Math.round(a / 15) * 15 : a;
}

/** Reference: the turn that takes the reference angle to the new angle (degrees). */
export const referenceTurn = (reference, next) => next - reference;

/** A corner drag measures its turn from the picked arrow, rather than from +X. */
export function rotationDragAngle(pivot, start, point, shift = false) {
  const angle = turnBetween(rotationAngle(pivot, start), rotationAngle(pivot, point));
  return shift ? Math.round(angle / 15) * 15 : angle;
}

/** Cached drawing ghosts use the same canvas placement path as layout parts. */
export function rotationMatrix([x, y], degrees) {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, s, -s, c, x - c * x + s * y, y - s * x - c * y];
}

/** Copy uses the existing block isolation; native dimensions own world-coordinate geometry. */
export function rotateEntities(raw, selection, pivot, degrees, copy = false) {
  if (!pivot || ![...pivot, degrees].every(Number.isFinite)) throw new Error('Rotate needs a finite pivot and angle');
  const next = copy ? copyEntities(raw, selection, 0, 0) : moveEntities(raw, selection, 0, 0);
  let blocks = next.blocks;
  const done = new Set();
  const one = (e) => {
    const r = rotateRecord(e.type, e.r, pivot, degrees, e.flip);
    if (e.type === 'DIMENSION') {
      const name = field(r, 2), b = blocks[name];
      if (b && !b.xref && !done.has(name)) {
        done.add(name);
        const entities = b.entities.map(one);
        blocks = { ...blocks, [name]: { ...b, entities } };
      }
    }
    return { ...e, r, kids: e.kids?.map((kid) => rotateRecord(kid.type, kid, pivot, degrees,
      kid.type === 'VERTEX' ? e.flip : +field(kid, 230) < 0)) };
  };
  const entities = next.entities.map((e, i) => (copy ? i >= raw.entities.length : selection.has(i)) ? one(e) : e);
  return { entities, blocks };
}

export function rotateRecord(type, r, pivot, degrees, flip) {
  const reflected = flip && (OCS.has(type) || type === 'VERTEX');
  const a = (reflected ? -degrees : degrees) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  const px = reflected ? -pivot[0] : pivot[0], py = pivot[1];
  const c = r.c.slice(), v = r.v.slice();
  const set = (code, value) => {
    const k = c.indexOf(code);
    if (k < 0) { c.push(code); v.push(text(value)); } else v[k] = text(value);
  };
  const pair = (k, vector = false, dy = 10) => {
    const code = r.c[k];
    let j = k + 1;
    while (j < r.c.length && r.c[j] !== code && r.c[j] !== code + dy) j++;
    if (r.c[j] !== code + dy) j = -1;
    const x = +r.v[k] - (vector ? 0 : px), y = (j < 0 ? 0 : +r.v[j]) - (vector ? 0 : py);
    v[k] = text(x * cos - y * sin + (vector ? 0 : px));
    const yy = text(x * sin + y * cos + (vector ? 0 : py));
    if (j < 0) { c.push(code + dy); v.push(yy); } else v[j] = yy;
  };
  const angle = (k, radians = false) => { v[k] = text(+r.v[k] + (radians ? a : a * 180 / Math.PI)); };
  if (type === 'HATCH') {
    let stage = 'head', flags = 0, edge = 0;
    for (let k = 0; k < r.c.length; k++) {
      const code = r.c[k];
      if (code === 91) stage = 'paths';
      else if (code === 75) stage = 'pattern';
      else if (code === 98) stage = 'seed';
      else if (stage === 'paths') {
        if (code === 92) { flags = +r.v[k]; edge = 0; }
        else if (code === 72 && !(flags & 2)) edge = +r.v[k];
        else if ([10, 11, 12, 13].includes(code)) pair(k, edge === 3 && code === 11 || edge === 4 && code >= 12);
        else if (edge === 2 && [50, 51].includes(code)) {
          let j = k + 1;
          while (j < r.c.length && ![73, 72, 92, 97, 75, 98].includes(r.c[j])) j++;
          // The reader negates stored angles for clockwise hatch arc edges.
          const direction = r.c[j] === 73 && +r.v[j] === 0 ? -1 : 1;
          v[k] = text(+r.v[k] + direction * a * 180 / Math.PI);
        }
      } else if (stage === 'pattern') {
        if (code === 43 || code === 45) pair(k, code === 45, 1);
        else if (code === 52 || code === 53) angle(k);
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
      const vectors = where === 'ctx' ? [11, 13, 111, 112] : where === 'leader' ? [11] : [];
      if (points.includes(code) || vectors.includes(code)) pair(k, vectors.includes(code));
      else if (where === 'ctx' && [42, 46].includes(code)) angle(k, true);
    }
  } else {
    const points = ['ACAD_TABLE', 'WIPEOUT', 'IMAGE', 'VIEWPORT'].includes(type) ? [10] : SPEC[type]?.pts;
    if (!points) throw new Error('Cannot rotate ' + type);
    const vectors = type === 'ELLIPSE' || type === 'MTEXT' || type === 'ACAD_TABLE' ? [11]
      : type === 'SPLINE' ? [12, 13] : type === 'LEADER' ? [211, 212, 213]
        : type === 'WIPEOUT' || type === 'IMAGE' ? [11, 12] : [];
    for (let k = 0; k < r.c.length; k++) {
      if (points.includes(r.c[k]) || vectors.includes(r.c[k])) pair(k, vectors.includes(r.c[k]));
    }
    if (type === 'ARC') { set(50, +(field(r, 50) || 0) + a * 180 / Math.PI); set(51, +(field(r, 51) || 0) + a * 180 / Math.PI); }
    else if (['TEXT', 'ATTRIB', 'ATTDEF', 'INSERT'].includes(type)) set(50, +(field(r, 50) || 0) + a * 180 / Math.PI);
    else if (type === 'MTEXT' && (field(r, 50) != null || !(+field(r, 11) || +field(r, 21)))) set(50, +(field(r, 50) || 0) + a * 180 / Math.PI);
    else if (type === 'ACAD_TABLE' && field(r, 11) == null) { set(11, cos); set(21, sin); }
    else if (type === 'DIMENSION') {
      for (const code of [50, 51, 52, 53]) if (field(r, code) != null) set(code, +field(r, code) + degrees);
      if (field(r, 50) == null && ((+field(r, 70) || 0) & 7) === 0) set(50, degrees);
    } else if (type === 'VIEWPORT') set(51, +(field(r, 51) || 0) + degrees);
  }
  return { ...r, c, v };
}
