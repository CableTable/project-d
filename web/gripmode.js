// gripmode.js — the grip modes of a hot grip (TODO 155e1), pure (no DOM): gripmode.test.mjs.
//
// A hot grip starts in STRETCH; Space or Enter cycles STRETCH → MOVE → ROTATE → SCALE → MIRROR → STRETCH (AutoCAD). MOVE, ROTATE, SCALE and
// MIRROR act on every selected object about the hot grip (`base`). The value of a pick `p` is: MOVE / MIRROR the point itself, ROTATE the angle
// from base to p (degrees, 0 = east), SCALE the distance from base to p (a factor, in drawing units). The geometry is the commands' own
// (rotate.js, scale.js, edit.js, modify.js).
//
//   apply(raw, sel, mode, base, v) → the { entities, blocks } after the mode, same indexes; null when it changes nothing; throws when it cannot
import { moveEntities, removeEntities } from './edit.js';
import { rotateEntities, rotationAngle } from './rotate.js';
import { scaleEntities, scaleDistance } from './scale.js';
import { mirrorEntity } from './modify.js';
import { n2 } from './draw.js';

export const MODES = ['STRETCH', 'MOVE', 'ROTATE', 'SCALE', 'MIRROR'];
export const NAMES = { STRETCH: 'Stretch', MOVE: 'Move', ROTATE: 'Rotate', SCALE: 'Scale', MIRROR: 'Mirror' };       // the undo step of a mode
const PROMPTS = {                                                  // AutoCAD 2027's, as tested (acad-grips-2027.txt)
  STRETCH: 'Specify stretch point or [Base point/Copy/Undo/eXit]:',
  MOVE: 'Specify move point or [Base point/Copy/Undo/eXit]:',
  ROTATE: 'Specify rotation angle or [Base point/Copy/Undo/Reference/eXit]:',
  SCALE: 'Specify scale factor or [Base point/Copy/Undo/Reference/eXit]:',
  MIRROR: 'Specify second point or [Base point/Copy/Undo/eXit]:',
};
export const header = (mode) => `** ${mode} **`;
export const prompt = (mode) => PROMPTS[mode];
/** The mode index after `i` (Space / Enter). */
export const cycle = (i) => (i + 1) % MODES.length;

/** What a pick `p` means in a mode: the angle (ROTATE), the factor (SCALE) or the point itself. */
export const valueAt = (mode, base, p) => (mode === 'ROTATE' ? rotationAngle(base, p) : mode === 'SCALE' ? scaleDistance(base, p) : [p[0], p[1]]);

/** The readout beside the pointer; factor: mm per unit. */
export function readout(mode, base, v, factor = 1) {
  if (mode === 'ROTATE') return `Rotate ${n2(v)}°`;
  if (mode === 'SCALE') return `Scale ×${+v.toPrecision(6)}`;
  if (mode === 'MIRROR') return `Mirror line ${n2(rotationAngle(base, v))}°`;
  return `Move ΔX ${n2((v[0] - base[0]) * factor)} ΔY ${n2((v[1] - base[1]) * factor)}`;
}

function mirror(raw, sel, p1, p2) {
  let blocks = raw.blocks;
  const entities = raw.entities.slice(), olds = [];
  for (const i of sel) {
    const r = mirrorEntity(raw.entities[i], p1, p2, blocks);
    if (r.blocks) blocks = r.blocks;
    if (r.ent) { entities[i] = r.ent; olds.push(raw.entities[i]); }
  }
  if (!olds.length) return null;
  // the old entities go through removeEntities so a dimension's block that only they used goes too
  return { entities, blocks: removeEntities({ entities: entities.concat(olds), blocks }, new Set(olds.map((_, k) => entities.length + k))).blocks };
}

export function apply(raw, sel, mode, base, v) {
  if (mode === 'MOVE') return Math.hypot(v[0] - base[0], v[1] - base[1]) < 1e-12 ? null : moveEntities(raw, sel, v[0] - base[0], v[1] - base[1]);
  if (mode === 'ROTATE') return Math.abs(v) < 1e-12 ? null : rotateEntities(raw, sel, base, v);
  if (mode === 'SCALE') { if (!(v > 0)) throw new Error('The scale factor must be above 0'); return Math.abs(v - 1) < 1e-12 ? null : scaleEntities(raw, sel, base, v); }
  if (mode === 'MIRROR') return Math.hypot(v[0] - base[0], v[1] - base[1]) < 1e-12 ? null : mirror(raw, sel, base, v);
  return null;
}
