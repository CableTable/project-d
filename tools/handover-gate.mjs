// The launcher's handover gate (TODO 165): at most LIMIT new-item launches per Rook, so the pipeline drains to a clean break.
// A rule in WORKFLOW.md did not hold (Rook S29 built 9 items), so `rook.mjs build` / `knight` count and refuse.
// State: runs<N>/rook-gate.json { uuid, startSha, launches: [{ kind, brief, branch, at, over? }] }; one Rook = one uuid (rook-next.txt line 1).
export const LIMIT = 3;
const ROW = /^(\s*)(?:- \[([ x])\] )?(\d+[a-z]*\d*)\.\s*(✅)?/; // "- [x] 160." / "    155a. ✅" / "1. ✅"; ids repeat in old lists, so rows are keyed id#occurrence

function rows(text) {
  const seen = {}, list = [];
  for (const line of text.split(/\r?\n/)) {
    const m = ROW.exec(line);
    if (m) list.push({ key: `${m[3]}#${seen[m[3]] = (seen[m[3]] || 0) + 1}`, indent: m[1].length, ticked: m[2] === 'x' || !!m[4] });
  }
  return list.map((r, i) => ({ ...r, leaf: !(list[i + 1] && list[i + 1].indent > r.indent) }));
}

// Leaf rows ticked in `after` that were not ticked (or did not exist) in `before`; a parent ticked because its children are does not count.
export function countTicked(before, after) {
  const was = new Set(rows(before).filter((r) => r.ticked).map((r) => r.key));
  return rows(after).filter((r) => r.leaf && r.ticked && !was.has(r.key)).length;
}

export const itemsOf = (state) => state.launches.filter((l) => l.kind === 'item');

// The stored state, or a fresh one when a different Rook (uuid) is running now.
export const nextState = (old, uuid, startSha) => (old && old.uuid === uuid ? old : { uuid, startSha, launches: [] });

export const queueLine = (name, ticked, items) =>
  `items since start (${name}): ${ticked} ticked, ${items} launched / ${LIMIT}${items >= LIMIT || ticked >= LIMIT ? ' -> HANDOVER DUE' : ''}`;

// Line 2 of queue.txt: replaces an earlier "items since start" line, else is inserted (the other lines stay as they are).
export function setLine2(text, line) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n', lines = text.split(/\r?\n/);
  if (/^items since start/.test(lines[1] ?? '')) lines[1] = line; else lines.splice(1, 0, line);
  return lines.join(eol);
}

export const refusal = (name, state) => {
  const items = itemsOf(state);
  return `handover due: ${items.length} new items launched since ${name} started (${items.map((l) => l.branch).join(', ')}). Hand over (WORKFLOW.md Handover), or pass --over with his OK.`;
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
    const state = nextState(old && JSON.parse(old), uuid, null);
    if (!state.startSha) state.startSha = env.git('rev-parse', head);
    return { name, dir, file, head, state };
  }
  function show(g) {
    const ticked = countTicked(env.git('show', `${g.state.startSha}:TODO.md`), env.git('show', `${g.head}:TODO.md`));
    const line = queueLine(g.name, ticked, itemsOf(g.state).length);
    const q = `${g.dir}/queue.txt`;
    env.write(q, setLine2(env.read(q) || '', line));
    return line;
  }
  return {
    // Throws when the launch is a new item over the limit and --over is not given.
    check(fix, over) {
      if (fix || over) return;
      const g = load();
      if (itemsOf(g.state).length >= LIMIT) throw new Error(refusal(g.name, g.state));
    },
    // After a launch started. The queue line is a note: its failure must not look like a failed launch.
    record({ fix, over, brief, branch }) {
      const g = load();
      g.state.launches.push({ kind: fix ? 'fix' : 'item', brief, branch, at: new Date().toISOString(), ...(over && !fix ? { over: true } : {}) });
      env.write(g.file, JSON.stringify(g.state, null, 2) + '\n');
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
