// PD dimensions draw resolved TEXT; an invisible constant attribute keeps the group 1 override and measured label for rebuilds.
import { entity } from './dxf-write.js';

const field = (e, c) => e?.r.v[e.r.c.indexOf(c)] || '';
const unesc = (s) => String(s).replace(/\\U\+([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
export const overrideText = (text = '') => !text.trim() || text === '<>' ? '' : text;
export const dimensionText = (measured, override) => overrideText(override) ? override.replaceAll('<>', measured) : measured;
export const textRecord = (ents) => ents.find((e) => e.type === 'ATTDEF' && field(e, 2) === 'PD_DIM_TEXT');
export const measuredText = (ents) => unesc(field(textRecord(ents) || ents.find((e) => e.type === 'TEXT'), textRecord(ents) ? 3 : 1));
export const readOverride = (ents) => { const e = textRecord(ents); return e ? unesc(field(e, 1)) : ''; };
export const overrideRecord = (override, measured) => entity('ATTDEF', [[10, 0], [20, 0], [30, 0], [40, 1], [1, override], [2, 'PD_DIM_TEXT'], [3, measured], [70, 3]], { layer: '0' });
