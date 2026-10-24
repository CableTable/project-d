// The floating command bar's pure parts (TODO 47, mock-up R12b Option B): the command table, alias lookup, autocomplete ranking,
// the option chips of a prompt, which keys open the bar, and where the bar sits. No DOM here.

/** [name, category, description, aliases, where ('draw' | 'layout' | '' = both), default key (optional)] */
const TABLE = [
  ['line', 'Draw', 'Straight segments', ['l'], 'draw'],
  ['polyline', 'Draw', 'Connected segments in one object', ['pl', 'pline', 'p'], 'draw'],
  ['rectangle', 'Draw', 'Rectangle from two corners', ['rec', 'rect', 'r'], 'draw'],
  ['rrect', 'Draw', 'Rectangle with rounded corners', ['rr'], 'draw'],
  ['circle', 'Draw', 'Circle by centre and radius', ['c'], 'draw'],
  ['ellipse', 'Draw', 'Ellipse by centre and axes', ['el'], 'draw'],
  ['arc', 'Draw', 'Arc by three points', ['a'], 'draw'],
  ['text', 'Draw', 'Text placed and typed in place', ['t'], 'draw'],
  ['dimension', 'Annotate', 'Aligned dimension', ['d', 'dim'], 'draw'],
  ['dimlinear', 'Annotate', 'Horizontal or vertical dimension', ['dli'], 'draw'],
  ['dimradius', 'Annotate', 'Radius of a circle or arc', ['dra'], 'draw'],
  ['dimdiameter', 'Annotate', 'Diameter of a circle or arc', ['ddi'], 'draw'],
  ['dimangular', 'Annotate', 'Angle between two lines', ['dan'], 'draw'],
  ['leader', 'Annotate', 'Arrow pointing at a feature, with a note', ['le'], 'draw'],
  ['balloon', 'Annotate', 'Numbered balloon for a feature', ['b'], 'draw'],
  ['dimstyle', 'Annotate', 'Dimension style: arrows, text, units', [], ''],
  ['select', 'Edit', 'Pick objects or parts', ['s'], ''],
  ['measure', 'Edit', 'Distance between two points', ['m'], 'draw'],
  ['pan', 'View', 'Drag the view around', [], ''],
  ['move', 'Edit', 'Move objects from a base point to a target', ['mv'], 'draw'],
  ['offset', 'Edit', 'A parallel copy at a distance', ['o'], 'draw'],
  ['trim', 'Edit', 'Cut objects back to cutting edges', ['tr'], 'draw'],
  ['mirror', 'Edit', 'Mirror objects about a line', ['mi'], 'draw'],
  ['contour', 'Edit', 'Offset a closed outline in steps', ['ct'], 'draw'],
  ['trace', 'Edit', 'Trace a picture into closed outlines', ['tb'], 'draw'],
  ['textoutlines', 'Edit', 'Turn the selected text into closed outlines', ['txo'], 'draw'],
  ['weld', 'Edit', 'Shaping: join the selected closed outlines into one', [], 'draw'],
  ['explode', 'Edit', 'Split polylines or blocks into their members', ['x'], 'draw'],
  ['breakapart', 'Edit', 'Separate a group or block into outlines', [], '', 'Ctrl+K'],
  ['shapetrim', 'Edit', 'Shaping: cut the other outlines out of the last picked one', ['strim'], 'draw'],
  ['intersect', 'Edit', 'Shaping: keep the area the selected outlines share', ['int'], 'draw'],
  ['simplify', 'Edit', 'Shaping: remove the parts covered by outlines in front', [], 'draw'],
  ['frontminus', 'Edit', 'Shaping: frontmost outline minus all the others', [], 'draw'],
  ['backminus', 'Edit', 'Shaping: backmost outline minus all the others', [], 'draw'],
  ['boundary', 'Edit', 'Shaping: add the union on the current layer; originals stay', [], 'draw'],
  ['extract', 'Layout', 'Save the selected outline as a part', ['e'], ''],
  ['apply', 'Layout', 'Turn the step and repeat into placed parts', ['a', 'ap'], 'layout'],
  ['rotate', 'Layout', 'Turn the selected part about a pivot', ['r', 'ro'], 'layout'],
  ['nest', 'Layout', 'Auto-nest mixed parts', ['n'], ''],
  ['step', 'Layout', 'Step and repeat the chosen part', [], 'layout'],
  ['group', 'Layout', 'Group the selected parts', ['g'], 'layout', 'Ctrl+G'],
  ['ungroup', 'Layout', 'Split a group', ['u'], 'layout', 'Ctrl+Shift+G'],
  ['lock', 'Layout', 'Lock the selected parts', [], 'layout'],
  ['unlock', 'Layout', 'Unlock the selected parts', [], 'layout'],
  ['mx', 'Layout', 'Mirror the selected part left to right', [], 'layout'],
  ['my', 'Layout', 'Mirror the selected part top to bottom', [], 'layout'],
  ['newlayout', 'Layout', 'A new layout tab', ['nl'], ''],
  ['library', 'Layout', 'Open the Parts library', ['lib'], 'layout'],
  ['open', 'File', 'Open a DXF or PDF', [], ''],
  ['closetab', 'File', 'Close the current tab', [], '', 'Ctrl+W'],
  ['nexttab', 'View', 'Go to the next tab, wrapping', [], '', 'Ctrl+Tab'],
  ['previoustab', 'View', 'Go to the previous tab, wrapping', [], '', 'Ctrl+Shift+Tab'],
  ['save', 'File', 'Save the open tab', [], '', 'Ctrl+S'],
  ['saveas', 'File', 'Save under another name', [], '', 'Ctrl+Shift+S'],
  ['pdf', 'File', 'PDF / Print', ['print'], ''],
  ['compare', 'File', 'Compare drawings', ['cmp'], ''],
  ['undo', 'Edit', 'Take back the last step', [], '', 'Ctrl+Z'],
  ['redo', 'Edit', 'Bring back the step taken back', [], '', 'Ctrl+Y / Ctrl+Shift+Z'],
  ['copy', 'Edit', 'Copy selected drawing objects inside the app', [], '', 'Ctrl+C'],
  ['paste', 'Edit', 'Paste drawing objects at the same coordinates', [], '', 'Ctrl+V'],
  ['history', 'Edit', 'Undo history: go back to any step', ['uh'], ''],
  ['selectall', 'Edit', 'Select everything', ['all'], '', 'Ctrl+A'],
  ['delete', 'Edit', 'Delete the selection', ['del', 'erase'], '', 'Delete'],
  ['fit', 'View', 'Fit the view to the window', ['z', 'zoom', 'ze'], '', 'Ctrl+0'],
  ['rulers', 'View', 'Show or hide the rulers', [], ''],
  ['wireframe', 'View', 'Outline-only view; PDF / Print keeps fills', [], '', 'F9'],
  ['properties', 'View', 'Show or hide the Properties bar', ['props'], '', 'Ctrl+1'],
  ['shortcuts', 'Edit', 'Own typed aliases and key shortcuts', [], ''],
];

export const COMMANDS = TABLE.map(([name, cat, desc, alias, where, key = '']) => ({ name, cat, desc, alias, where, key }));

const fits = (c, tab) => !c.where || !tab || c.where === tab;     // tab: 'draw' | 'layout' | '' (unknown)

/** The command a typed word means (its name or an alias, any case), the ones for the open tab first. → a command or null */
export function resolve(text, tab = '', commands = COMMANDS) {
  const w = String(text || '').trim().toLowerCase();
  if (!w) return null;
  const all = commands.filter((c) => c.name === w || c.alias.includes(w));
  return all.find((c) => fits(c, tab)) || all[0] || null;
}

/** Autocomplete: commands whose name or alias starts with the text, then words inside the name or description. → [{ cmd, alias, hit }] (hit = how many letters of the name are typed) */
export function suggest(text, tab = '', limit = 6, commands = COMMANDS) {
  const t = String(text || '').trim().toLowerCase();
  if (!t || /\s/.test(t) || !/^[a-z]/.test(t)) return [];
  const out = [];
  for (const c of commands) {
    const exact = c.alias.includes(t) || c.name === t;
    const aliasStart = c.alias.find((a) => a.startsWith(t));
    let rank;
    if (exact) rank = 0;
    else if (c.name.startsWith(t)) rank = 2;
    else if (aliasStart) rank = 3;
    else if (c.name.includes(t)) rank = 5;
    else if (c.desc.toLowerCase().split(/\W+/).some((w) => w.startsWith(t))) rank = 7;
    else continue;
    out.push({ cmd: c, alias: aliasStart || c.alias[0] || '', hit: c.name.startsWith(t) ? t.length : 0, rank: rank + (fits(c, tab) ? 0 : 10) });
  }
  out.sort((a, b) => a.rank - b.rank || a.cmd.name.length - b.cmd.name.length || (a.cmd.name < b.cmd.name ? -1 : 1));
  return out.slice(0, limit).map(({ cmd, alias, hit }) => ({ cmd, alias, hit }));
}

/** The options in a prompt's [Brackets]: the last bracket with single words ("Esc" is not one). The capital letters at the start of a word are its key. → [{ word, key, rest }] */
export function parseOptions(prompt) {
  const groups = [...String(prompt || '').matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].split('/').map((x) => x.trim()));
  for (let i = groups.length - 1; i >= 0; i--) {
    const words = groups[i].filter((w) => /^[A-Za-z0-9]+$/.test(w) && w !== 'Esc');
    if (!words.length || words.length !== groups[i].filter((w) => w !== 'Esc').length) continue;
    return words.map((word, n) => {
      let len = (/^[A-Z0-9]+/.exec(word) || [word[0]])[0].length;
      while (len < word.length && words.some((o, m) => m !== n && o.toLowerCase().startsWith(word.slice(0, len).toLowerCase()) && (m < n || o.length === len))) len++;     // Steps / Sharp: the key grows until it is the only one
      return { word, key: word.slice(0, len), rest: word.slice(len) };
    });
  }
  return [];
}

/** The option a typed text picks: its key (the underlined letters) or the whole word, any case. → an option or null */
export function matchOption(options, text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  return options.find((o) => o.key.toLowerCase() === t) || options.find((o) => o.word.toLowerCase() === t) || null;
}

/** Does Space act as Enter? On an empty bar it repeats the last command; after a command or alias it accepts it; never in a text-entry command or in the middle of a sentence. */
export function spaceIsEnter(text, label = '', tab = '', commands = COMMANDS) {
  if (isTextEntry(label)) return false;
  const t = String(text || '').trim();
  return !t || (!/\s/.test(t) && !!resolve(t, tab, commands));
}
export const isTextEntry = (label) => /^(text|rename)$/i.test(String(label || '').trim());

/** The text a key starts the bar with, or null: a letter or digit (and . , @ < - + while a command waits for a point), never with Ctrl / Alt / Meta, in a field or in a dialog. */
export function keyOpensBar(ev, { inField = false, dialog = false, active = false } = {}) {
  if (inField || dialog || ev.ctrlKey || ev.metaKey || ev.altKey || !ev.key || ev.key.length !== 1) return null;
  if (/^[a-z0-9]$/i.test(ev.key)) return ev.key;
  return active && /^[-+@.,<]$/.test(ev.key) ? ev.key : null;
}

/** Where the bar goes: 20 px right of and below the cursor, flipped left / up when it would leave the canvas, then held inside it. → { x, y } */
export function placeBar(cursor, size, area, gap = 20) {
  let x = cursor.x + gap, y = cursor.y + gap;
  if (x + size.w > area.w) x = cursor.x - gap - size.w;
  if (y + size.h > area.h) y = cursor.y - gap - size.h;
  return { x: Math.max(0, Math.min(x, area.w - size.w)), y: Math.max(0, Math.min(y, area.h - size.h)) };
}

/** The history lines that contain the filter text (any case). */
export const filterLines = (lines, q) => { const t = String(q || '').trim().toLowerCase(); return t ? lines.filter((l) => `${l.pre} ${l.ans || ''}`.toLowerCase().includes(t)) : lines; };
/** The history as plain text, one line each, for Copy history. */
export const linesText = (lines) => lines.map((l) => `${l.pre}${l.ans ? ' ' + l.ans : ''}`).join('\n');
/** The last three lines for the fade: 1 newest, 2 and 3 older. */
export const fadeOf = (lines) => lines.slice(-3).map((l, i, a) => ({ ...l, age: a.length - i }));
