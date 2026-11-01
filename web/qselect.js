// Quick Select's scope and rules; indices always refer to the source drawing.
import { typeName, fieldsOf, effectiveColour, colourLabel, ltKey, ltLabel } from './props.js';
import { decode } from './text.js';

const COMMON = [['colour', 'Colour'], ['layer', 'Layer'], ['lt', 'Line type'], ['lw', 'Line weight']];
const OPS = { eq: '= Equals', ne: '<> Not Equal', gt: '> Greater than', lt: '< Less than', wildcard: '* Wildcard Match', all: 'Select All' };
export function objectTypes(entities) {
  const types = [...new Set(entities.map((e) => e.type))].sort((a, b) => typeName({ type: a }).localeCompare(typeName({ type: b })));
  return [...(types.length > 1 ? [['Multiple', 'Multiple']] : []), ...types.map((type) => [type, typeName({ type })])];
}
export function propertiesOf(entities, type, factor = 1, dp = 2) {
  const ents = entities.filter((e) => e.type === type);
  return [...COMMON.map(([key, label]) => ({ key, label, kind: 'list' })),
    ...fieldsOf(ents, factor).map((f) => ({ key: f.key, label: f.label + (f.group ? (f.key.endsWith('X') ? ' X' : ' Y') : ''), kind: 'number', decimals: f.key === 'vertices' ? 0 : dp })),
    ...(['TEXT', 'MTEXT'].includes(type) ? [{ key: 'contents', label: 'Contents', kind: 'text' }] : [])];
}
export const operatorsOf = (kind) => ['eq', 'ne', ...(kind === 'number' ? ['gt', 'lt'] : kind === 'text' ? ['wildcard'] : []), 'all'].map((key) => [key, OPS[key]]);
const weight = (e) => e.lw ?? -1;
const valueOf = (e, layers, key, factor) => key === 'colour' ? effectiveColour(e, layers) : key === 'layer' ? e.layer : key === 'lt' ? ltKey(e) : key === 'lw' ? weight(e)
  : key === 'contents' ? decode(e)?.lines.join('\n') ?? '' : fieldsOf([e], factor).find((f) => f.key === key)?.value;
export function valuesOf(entities, layers, key) {
  const values = [...new Set(entities.map((e) => valueOf(e, layers, key, 1)))];
  const label = (v) => key === 'colour' ? colourLabel(v) : key === 'lt' ? ltLabel(v) : key === 'lw' ? ({ '-1': 'ByLayer', '-2': 'ByBlock', '-3': 'Default' }[v] ?? `${(v / 100).toFixed(2)} mm`) : String(v);
  return [...values.sort((a, b) => key === 'layer' && (a === '0' || b === '0') ? (a === b ? 0 : a === '0' ? -1 : 1) : label(a).localeCompare(label(b), undefined, { numeric: true })).map((v) => [String(v), label(v)])];
}
function wildcard(pattern) {
  return new RegExp('^' + String(pattern).split('').map((c) => c === '*' ? '[\\s\\S]*' : c === '?' ? '[\\s\\S]' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('') + '$', 'iu');
}
/** rule: { scope?: indices, type, property, operator, value, exclude?, factor?, dp? (decimals shown) }. */
export function quickSelect(entities, layers, rule) {
  const { type = 'Multiple', property, operator, value, exclude = false, factor = 1, dp = 2 } = rule;
  const scope = [...(rule.scope ?? entities.keys())], out = [];
  // Properties come from the scope, as in the dialog; an entity without the field simply does not match.
  const prop = propertiesOf(scope.map((i) => entities[i]).filter(Boolean), type, factor, dp).find((p) => p.key === property);
  if (!prop || !operatorsOf(prop.kind).some(([op]) => op === operator)) return out;
  if (operator !== 'all' && (String(value ?? '').trim() === '' || (prop.kind === 'number' && !Number.isFinite(Number(value))))) return out;
  const pattern = operator === 'wildcard' ? wildcard(value) : null;
  for (const i of scope) {
    const e = entities[i], layer = e && layers[e.layer];
    if (!e || layer?.off || layer?.frozen || (layer?.flags & 4)) continue;
    let match = type === 'Multiple' || e.type === type;
    if (match && operator !== 'all') {
      let have = valueOf(e, layers, property, factor), want = value;
      if (prop.kind === 'number') {
        have = have == null ? null : Number(have.toFixed(prop.decimals)); want = Number(Number(value).toFixed(prop.decimals));
      } else { have = String(have).toLowerCase(); want = String(value).toLowerCase(); }
      match = have != null && (operator === 'eq' ? have === want : operator === 'ne' ? have !== want : operator === 'gt' ? have > want : operator === 'lt' ? have < want : pattern.test(have));
    }
    if (exclude ? !match : match) out.push(i);
  }
  return out;
}
