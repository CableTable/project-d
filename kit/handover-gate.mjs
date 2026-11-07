// The launcher's handover gate (TODO 165): at most LIMIT new-item launches per Rook, so the pipeline drains to a clean break.
// A rule in WORKFLOW.md did not hold (Rook S29 built 9 items), so `rook.mjs build` / `knight` count and refuse.
// State: runs<N>/rook-gate.json { uuid, startSha, launches: [{ kind: item | fix | tool, ids, brief, branch, at, over? }] }; one Rook = one uuid (rook-next.txt line 1).
import { project } from './project.mjs';
const { todo: TODO, workflow: WORKFLOW } = project.docs;
export const LIMIT = 2;
const ROW = /^(\s*)(?:- \[([ x])\] )?(\d+[a-z]*\d*)\.\s*(✅)?/; // "- [x] 160." / "    155a. ✅" / "1. ✅"; ids repeat in old lists, so rows are keyed id#occurrence

// Ids right after Tick, joined by , and & / +; a single-digit prose count is not an id.
export const tickIds = (line) => line.match(/^\s*(?:\d+\.\s+)?`?Tick\s+(?:TODO\s+)?(\d{2,}[a-z]*\d*(?:\s*(?:,|and|&|\/|\+)\s*(?:TODO\s+)?\d{2,}[a-z]*\d*)*)/i)?.[1].match(/\d{2,}[a-z]*\d*/g) ?? [];

export function briefIds(text) {
  const lines = text.split(/\r?\n/);
  const ids = [...lines[0].matchAll(/\bTODO\s+(\d{2,}[a-z]*\d*(?:\s*(?:,|and|&|\/|\+)\s*(?:TODO\s+)?\d{2,}[a-z]*\d*)*)/gi)].flatMap((m) => m[1].match(/\d{2,}[a-z]*\d*/gi));
  return [...new Set([...ids, ...lines.flatMap(tickIds)].map((s) => s.toLowerCase()))];
}

// shortcut: id#occurrence miscounts when a same-number open row is inserted above a ticked one; it only feeds the queue line (never a launch), upgrade if the line misleads.
function rows(text) {
  const seen = {}, list = [];
  for (const line of text.split(/\r?\n/)) {
    const m = ROW.exec(line);
    if (m) list.push({ key: `${m[3]}#${seen[m[3]] = (seen[m[3]] || 0) + 1}`, indent: m[1].length, ticked: m[2] === 'x' || !!m[4] });
  }
  return list.map((r, i) => ({ ...r, leaf: !(list[i + 1] && list[i + 1].indent > r.indent) }));
}

// Leaf rows ticked in `after` that were not ticked (or did not exist) in `before`; a parent ticked because its children are does not count.
// skip = TODO ids whose tick is not a new item (TODO 167e: a --tool or fix launch, see skipIds).
export function countTicked(before, after, skip = new Set()) {
  const was = new Set(rows(before).filter((r) => r.ticked).map((r) => r.key));
  return rows(after).filter((r) => r.leaf && r.ticked && !was.has(r.key) && !skip.has(r.key.split('#')[0])).length;
}

// The recorded launch kind decides which ticks to skip; older records get their ids from the saved brief.
export function skipIds(state, read = () => '') {
  const ids = (l) => l.ids ?? briefIds((l.brief && read(l.brief)) || '');
  const items = new Set(itemsOf(state).flatMap(ids));
  return new Set(state.launches.filter((l) => l.kind !== 'item').flatMap(ids).filter((i) => !items.has(i)));
}

// TODO 167a: context of the LAST main-chain assistant message (a compact lowers it, so not the peak) = input + cache read + cache write; null when there is none.
export const CONTEXT_LIMIT = 150_000;
export function contextOf(text) {
  let last = null;
  for (const line of text.split(/\r?\n/)) {
    let e;
    try { e = JSON.parse(line); } catch { continue; } // a run in progress has a half-written last line
    const u = e.type === 'assistant' && !e.isSidechain && !e.parent_tool_use_id && e.message?.usage;
    const n = u && (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    if (n) last = n; // a synthetic message has all zeros: skip it
  }
  return last;
}

export const itemsOf = (state) => [...new Map(state.launches.filter((l) => l.kind === 'item').map((l) => [l.branch, l])).values()]; // a relaunch on the same branch counts once

// The stored state, or a fresh one when a different Rook (uuid) is running now.
export const nextState = (old, uuid, startSha) => (old && old.uuid === uuid ? old : { uuid, startSha, launches: [] });

export const toolsOf = (state) => state.launches.filter((l) => l.kind === 'tool');

// TODO 167c: tool tickets (`--tool`) pass the gate and are not counted as items; the line names them when there are any.
export const queueLine = (name, ticked, items, tools = 0) =>
  `items since start (${name}): ${ticked} ticked, ${items} launched / ${LIMIT}${tools ? `, ${tools} tool` : ''}${items >= LIMIT || ticked >= LIMIT ? ' -> HANDOVER DUE' : ''}`;

// Line 2 of queue.txt: replaces an earlier "items since start" line, else is inserted (the other lines stay as they are).
export function setLine2(text, line) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n', lines = text.split(/\r?\n/);
  if (/^items since start/.test(lines[1] ?? '')) lines[1] = line; else lines.splice(1, 0, line);
  return lines.join(eol);
}

export const refusal = (name, state) => {
  const items = itemsOf(state);
  return `handover due: ${items.length} new items launched since ${name} started (${items.map((l) => l.branch).join(', ')}). Hand over (${WORKFLOW} Handover), or pass --over with his OK.`;
};

// env: { extras, read(path) -> text | null, write(path, text), git(...args) } (git runs in the repo). The launcher and `rook.mjs gate` share this.
export function gateOps(env) {
  function load() {
    const next = env.read(`${env.extras}/rook-next.txt`);
    if (!next) throw new Error(`rook-next.txt not found in ${env.extras}: cannot tell which Rook this is`);
    const [uuid, name, resume = ''] = next.split(/\r?\n/).map((s) => s.trim());
    const n = /runs(\d+)/.exec(resume)?.[1]; // line 3 names runs<N>/resume-rook.txt; a build's branch (king/165) carries no session number
    if (!uuid || !name || !n) throw new Error('rook-next.txt must have the Rook uuid, its name and runs<N>/resume-rook.txt on lines 1-3');
    const dir = `${env.extras}/runs${n}`, file = `${dir}/rook-gate.json`, head = `claude/session${n}`, old = env.read(file);
    let saved = null;
    try { saved = old && JSON.parse(old); } catch { throw new Error(`${file} is corrupt: delete it to reset the count`); }
    const state = nextState(saved, uuid, null);
    if (!state.startSha) state.startSha = env.git('rev-parse', head);
    return { name, dir, file, head, state };
  }
  function show(g) {
    const ticked = countTicked(env.git('show', `${g.state.startSha}:${TODO}`), env.git('show', `${g.head}:${TODO}`), skipIds(g.state, env.read));
    const line = queueLine(g.name, ticked, itemsOf(g.state).length, toolsOf(g.state).length);
    const q = `${g.dir}/queue.txt`;
    env.write(q, setLine2(env.read(q) || '', line));
    console.log(`queue: ${q}`);
    return line;
  }
  // Throws `HANDOVER: context <N>k ...` when this Rook's transcript is over CONTEXT_LIMIT (every launch, --fix too); --over passes; no transcript: warns and allows.
  function ownContext() {
    const uuid = (env.read(`${env.extras}/rook-next.txt`) || '').split(/\r?\n/)[0].trim();
    const text = uuid && env.read(`${env.claudeDir}/${uuid}.jsonl`);
    return text && contextOf(text);
  }
  function context(over) {
    if (over) return;
    const n = ownContext();
    if (!n) return void console.log(`context not checked: no transcript for this Rook in ${env.claudeDir}`);
    if (n > CONTEXT_LIMIT) throw new Error(`HANDOVER: context ${Math.round(n / 1e3)}k (over ${CONTEXT_LIMIT / 1e3}k). Hand over (${WORKFLOW} Handover), or pass --over with his OK.`);
  }
  return {
    context,
    // TODO 193a: the line `rook.mjs result` ends with; '' when this Rook's transcript is not there (nothing to say).
    contextLine() {
      const n = ownContext();
      return n ? `Rook context ${Math.round(n / 1e3)}k (handover at ${CONTEXT_LIMIT / 1e3}k)` : '';
    },
    // TODO 167d: this Rook's runs<N>/queue.txt (rook-next.txt line 3 names runs<N>/resume-rook.txt).
    queueFile() {
      const n = /runs(\d+)/.exec((env.read(`${env.extras}/rook-next.txt`) || '').split(/\r?\n/)[2] || '')?.[1];
      if (!n) throw new Error('rook-next.txt line 3 does not name runs<N>/resume-rook.txt');
      return `${env.extras}/runs${n}/queue.txt`;
    },
    // Throws when the launch is a new item over the limit and --over is not given.
    check(fix, over, tool) {
      context(over);
      if (fix || over || tool) return;
      const g = load();
      if (itemsOf(g.state).length >= LIMIT) throw new Error(refusal(g.name, g.state));
    },
    // After a launch started: never throws (a bad state file must not look like a failed launch, or Rook launches twice); it warns instead.
    record({ fix, over, tool, brief, branch }) {
      let g;
      try {
        g = load();
        g.state.launches.push({ kind: fix ? 'fix' : tool ? 'tool' : 'item', ids: briefIds(env.read(brief) || ''), brief, branch, at: new Date().toISOString(), ...(over && !fix && !tool ? { over: true } : {}) });
        env.write(g.file, JSON.stringify(g.state, null, 2) + '\n');
      } catch (e) { return void console.error(`launch not counted: ${e.message}`); }
      try { return show(g); } catch (e) { console.error(`queue line not updated: ${e.message}`); }
    },
    // `rook.mjs gate`: save the (possibly reset) state, rewrite the queue line, return it.
    report() {
      const g = load();
      env.write(g.file, JSON.stringify(g.state, null, 2) + '\n');
      return show(g);
    },
  };
}
