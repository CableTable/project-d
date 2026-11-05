// Drawing groups: { members: [top-level entity indexes], name, description, unnamed, selectable }.
// All helpers return new group lists; entities and the input groups are left alone.

const unique = (members) => [...new Set(members)].filter((i) => Number.isInteger(i) && i >= 0);

/** Group a selection, absorbing every group it touches into one flat group. */
export function group(groups = [], selection) {
  const members = new Set(unique(selection)), absorbed = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of groups) {
      if (absorbed.has(g) || !g.members.some((i) => members.has(i))) continue;
      absorbed.add(g); changed = true;
      for (const i of g.members) members.add(i);
    }
  }
  if (members.size < 2) return groups.slice();
  return [...groups.filter((g) => !absorbed.has(g)),
    { members: [...members], name: '', description: '', unnamed: true, selectable: true }];
}

/** Ungroup dissolves each touched group, keeping all its entities. */
export function ungroup(groups = [], selection) {
  const selected = new Set(selection);
  return groups.filter((g) => !g.members.some((i) => selected.has(i)));
}

export const groupOf = (groups = [], entity) => groups.find((g) => g.members.includes(entity)) || null;

/** A crossing / click expands touched groups; a window accepts only complete groups. */
export function selectionOf(groups = [], selection, crossing = true, eligible = () => true) {
  const seeds = new Set([...selection].filter(eligible)), picked = new Set(seeds);
  for (const g of groups) {
    if (g.selectable === false || !g.members.some((i) => seeds.has(i))) continue;
    const include = g.members.every(eligible) && (crossing || g.members.every((i) => seeds.has(i)));
    for (const i of g.members) { if (include) picked.add(i); else picked.delete(i); }
  }
  return picked;
}

/** The selection is exactly one complete, selectable group. */
export function wholeGroup(groups = [], selection) {
  const g = groupOf(groups, selection.values().next().value);
  return g && g.selectable !== false && g.members.length === selection.size && g.members.every((i) => selection.has(i)) ? g : null;
}

/** Remove erased members (alive is a Set of surviving indexes); singletons dissolve. */
export function prune(groups = [], alive) {
  return groups.map((g) => ({ ...g, members: unique(g.members).filter((i) => alive.has(i)) })).filter((g) => g.members.length >= 2);
}

/** Map each old index to an array of new indexes: [] / missing erases, multiple indexes explode. */
export function remap(groups = [], indexes) {
  return groups.map((g) => ({ ...g, members: unique(g.members.flatMap((i) => indexes.get(i) || [])) })).filter((g) => g.members.length >= 2);
}

/** `standIn` maps each removed index (of `count` entities) to offsets in the new tail, which starts at count - standIn.size; the rest shift down. */
export function swap(groups = [], count, standIn) {
  const tail = count - standIn.size, indexes = new Map([...standIn].map(([i, ks]) => [i, ks.map((k) => tail + k)]));
  for (let i = 0, rank = 0; i < count; i++) if (!indexes.has(i)) indexes.set(i, [rank++]);
  return remap(groups, indexes);
}

/** One entity (index `at` of `count`) becomes `n` entities in its place; the rest shift by n - 1. */
export function splice(groups = [], count, at, n) {
  return remap(groups, new Map(Array.from({ length: count }, (_, i) => [i, i < at ? [i] : i === at ? Array.from({ length: n }, (_, k) => at + k) : [i + n - 1]])));
}

/** Surviving objects anchor the indexes; new objects in a removed member's place inherit its group. */
export function follow(groups = [], before, after) {
  if (!groups.length || before === after) return groups;
  const at = new Map(after.map((e, i) => [e, i]));
  if (before.length === after.length && before.every((e, i) => !at.has(e) || at.get(e) === i)) return groups;
  const was = new Map(before.map((e, i) => [e, i]));
  const indexes = new Map(before.map((e, i) => [i, at.has(e) ? [at.get(e)] : []]));
  const gone = before.flatMap((e, i) => at.has(e) ? [] : [i]);
  const made = after.flatMap((e, i) => was.has(e) ? [] : [i]);
  if (gone.length === 1) indexes.set(gone[0], made);       // one edited source: all its split pieces, even when appended
  else {
    let old = 0, start = 0;
    for (let end = 0; end <= after.length; end++) {
      if (end < after.length && !was.has(after[end])) continue;
      const stop = end < after.length ? was.get(after[end]) : before.length;
      const removed = [];
      for (; old < stop; old++) if (!at.has(before[old])) removed.push(old);
      const added = Array.from({ length: end - start }, (_, k) => start + k);
      // shortcut: a fallback only; load (follow after linkFills, a pure erase) is the one remaining caller without an explicit map. Delete this guess once it passes one.
      removed.forEach((i, k) => indexes.set(i, removed.length === 1 && end < after.length ? added : added.length ? [added[Math.min(k, added.length - 1)]] : []));
      old = stop + 1; start = end + 1;
    }
    const pending = gone.filter((i) => !indexes.get(i).length);
    const used = new Set([...indexes.values()].flat());
    const free = made.filter((i) => !used.has(i));
    pending.forEach((i, k) => indexes.set(i, pending.length === 1 ? free : free[k] == null ? [] : [free[k]]));
  }
  return remap(groups, indexes);
}

/** A copy map describes only the new entities; the original groups stay separate. */
export const copy = (groups = [], indexes) => [...groups, ...remap(groups, indexes)];
