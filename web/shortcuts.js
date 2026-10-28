// Own bindings and PGP interchange. Pure; defaults live in cmdbar.js TABLE.
import { COMMANDS, aliasScope, fixedKey } from './cmdbar.js';
export { fixedKey };

export const RESERVED = {
  'Ctrl+S': 'Reserved for Save, so saving a drawing stays available.',
  'Ctrl+Shift+S': 'Reserved for Save As.',
  'Ctrl+Z': 'Reserved for Undo.', 'Ctrl+Y': 'Reserved for Redo.', 'Ctrl+Shift+Z': 'Reserved for Redo.',
  'Ctrl+C': 'Reserved for Copy inside the app.', 'Ctrl+V': 'Reserved for Paste inside the app.',
  Esc: 'Reserved for cancel / close / clear selection.', Delete: 'Reserved for deleting the selection.',
  'Ctrl+D': 'Reserved for Duplicate in a layout.',
  F2: 'Reserved for command history.', F10: 'Reserved for polar tracking.', F11: 'Reserved for object snap tracking.',
  F3: 'Reserved for Snap.', F7: 'Reserved for Grid.', F8: 'Reserved for Ortho.', F9: 'Reserved for Wireframe.', F12: 'Reserved for Dynamic input.',
  F5: 'Reserved for the desktop reload guard.', 'Ctrl+R': 'Reserved for the desktop reload guard.',
};
export const aliases = (text) => [...new Set(String(text).toLowerCase().split(',').map((x) => x.trim()).filter(Boolean))];

/** Canonical modifier order; Meta / Cmd share Ctrl, as in the app's existing handlers. null = malformed. */
export function normalizeKey(text) {
  if (!String(text).trim()) return '';
  const parts = String(text).trim().split('+').map((x) => x.trim().toLowerCase());
  const mods = new Set(), keys = [];
  for (const p of parts) {
    if (['ctrl', 'control', 'meta', 'cmd', 'command'].includes(p)) mods.add('Ctrl');
    else if (p === 'alt' || p === 'option') mods.add('Alt');
    else if (p === 'shift') mods.add('Shift');
    else keys.push(p);
  }
  if (keys.length !== 1) return null;
  const named = { escape: 'Esc', esc: 'Esc', delete: 'Delete', del: 'Delete', enter: 'Enter', return: 'Enter', space: 'Space', tab: 'Tab', backspace: 'Backspace', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', minus: '-', plus: 'Plus' };
  const k = keys[0], key = named[k] || (/^[a-z0-9]$/.test(k) || /^f(?:[1-9]|1[0-9]|2[0-4])$/.test(k) || /^[-=,.;/\[\]\\'`]$/.test(k) ? k.toUpperCase() : null);
  return key ? [...['Ctrl', 'Alt', 'Shift'].filter((m) => mods.has(m)), key].join('+') : null;
}

export function eventKey(e) {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return null;
  const digit = /^Digit([0-9])$/.exec(e.code || '') || /^Numpad([0-9])$/.exec(e.code || '');
  const key = digit ? digit[1] : e.key === ' ' ? 'Space' : e.key === '+' ? 'Plus' : e.key;
  return normalizeKey([e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+'));
}

export function keyReason(key) {
  const k = normalizeKey(key);
  if (k == null) return 'Press a recognised key combination.';
  if (RESERVED[k]) return RESERVED[k];
  if (!/^(Ctrl|Alt)\+/.test(k) && !/^(Shift\+)?F\d+$/.test(k)) return 'Keys without Ctrl or Alt are kept for typing and drawing (letters, Space, Enter, Tab, arrows).';
  return '';
}

/** Apply only known, well-formed fields; callers check clashes before using loaded or imported bindings. */
export function bindings(overrides = {}) {
  const bound = Object.fromEntries(COMMANDS.map((c) => {
    const o = Object.hasOwn(overrides || {}, c.name) ? overrides[c.name] : null;
    return [c.name, { alias: Array.isArray(o?.alias) && o.alias.every((a) => typeof a === 'string') ? aliases(o.alias.join(',')) : [...c.alias],
      key: typeof o?.key === 'string' && !fixedKey(c.name) ? normalizeKey(o.key) ?? o.key : c.key }];
  }));
  // Discard older own keys now owned by the clipboard or fixed view toggles.
  for (const c of COMMANDS) if (bound[c.name].key !== c.key && ['Ctrl+C', 'Ctrl+V', 'F3', 'F7', 'F8', 'F9', 'F12'].includes(bound[c.name].key)) bound[c.name].key = '';
  // Existing own keys win over the newly added tab defaults on upgrade.
  for (const name of ['closetab', 'nexttab', 'previoustab']) {
    if (!Object.hasOwn(overrides?.[name] || {}, 'key') && COMMANDS.some((c) => c.name !== name && typeof overrides?.[c.name]?.key === 'string' && bound[c.name].key === bound[name].key)) bound[name].key = '';
  }
  return bound;
}
export function differences(draft) {
  return Object.fromEntries(COMMANDS.flatMap((c) => {
    const b = draft[c.name], o = {};
    if (b.alias.join(',') !== c.alias.join(',')) o.alias = b.alias;
    if (b.key !== c.key) o.key = b.key;
    return Object.keys(o).length ? [[c.name, o]] : [];
  }));
}
export const commandsFor = (draft) => COMMANDS.map((c) => ({ ...c, ...draft[c.name] }));

/** Pairs clash in alias scope; keys always clash globally. Canonical names cannot be exchanged. */
export function clashes(draft) {
  const out = [];
  for (const [i, c] of COMMANDS.entries()) {
    const b = draft[c.name];
    for (const a of b.alias) {
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(a)) out.push({ name: c.name, field: 'alias', value: a, reason: 'Use comma-separated words without spaces or punctuation.' });
      const owner = COMMANDS.find((d) => d.name === a && d.name !== c.name);
      if (owner) out.push({ name: c.name, field: 'alias', value: a, reason: `Command name ${owner.name} cannot be reassigned.` });
    }
    if (b.key && b.key !== c.key && keyReason(b.key)) out.push({ name: c.name, field: 'key', value: b.key, reason: keyReason(b.key) });
    for (const d of COMMANDS.slice(i + 1)) {
      for (const a of b.alias.filter((a) => draft[d.name].alias.includes(a))) {
        const cw = aliasScope(c, a), dw = aliasScope(d, a);
        if (!cw || !dw || cw === dw) out.push({ name: c.name, other: d.name, field: 'alias', value: a });
      }
      if (b.key && b.key === draft[d.name].key) out.push({ name: c.name, other: d.name, field: 'key', value: b.key });
    }
  }
  return out;
}

/** First alias line for a command replaces its list. Unmentioned commands keep the supplied draft. */
export function parsePgp(text, current = bindings()) {
  const draft = bindings(current), seen = new Set();
  let skipped = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || (line.startsWith(';') && !/^;KEY\s/i.test(line))) continue;
    const keyLine = /^;KEY\s+([^,]+),\s*(.*)$/i.exec(line), aliasLine = /^([^,]+),\s*\*([a-z0-9]+)\s*$/i.exec(line);
    const name = (keyLine ? keyLine[1].trim() : aliasLine ? aliasLine[2] : '').toLowerCase();
    if (!Object.hasOwn(draft, name)) { skipped++; continue; }
    if (keyLine) {
      const key = normalizeKey(keyLine[2]);
      if (keyLine[2] === current[name].key || keyLine[2] === COMMANDS.find((c) => c.name === name).key) draft[name].key = keyLine[2];
      else if (key == null || (fixedKey(name) && key !== draft[name].key)) skipped++;
      else draft[name].key = key;
    } else {
      const a = aliases(aliasLine[1]);
      if (a.length !== 1 || !/^[a-z0-9][a-z0-9_-]*$/.test(a[0])) { skipped++; continue; }
      if (!seen.has(name)) { draft[name].alias = []; seen.add(name); }
      // A canonical self-alias is valid AutoCAD syntax and represents an empty extra-alias list on export.
      if (a[0] !== name && !draft[name].alias.includes(a[0])) draft[name].alias.push(a[0]);
    }
  }
  return { draft, skipped };
}

export function writePgp(draft) {
  return '; Project D shortcuts: aliases + keys\r\n' + COMMANDS.map((c) => {
    const b = draft[c.name];
    return [...(b.alias.length ? b.alias : [c.name]).map((a) => `${a.toUpperCase()},        *${c.name.toUpperCase()}`), `;KEY ${c.name.toUpperCase()}, ${b.key}`].join('\r\n');
  }).join('\r\n') + '\r\n';
}

/** Exchange the two cells using the edited cell's previous value, rather than duplicating the attempted binding. */
export function swap(draft, name, other, field, previous) {
  const copy = bindings(draft);
  copy[name][field] = draft[other][field];
  copy[other][field] = previous;
  return copy;
}
