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

/** Remove erased members (alive is a Set of surviving indexes); singletons dissolve. */
export function prune(groups = [], alive) {
  return groups.map((g) => ({ ...g, members: unique(g.members).filter((i) => alive.has(i)) })).filter((g) => g.members.length >= 2);
}

/** Map each old index to an array of new indexes: [] / missing erases, multiple indexes explode. */
export function remap(groups = [], indexes) {
  return groups.map((g) => ({ ...g, members: unique(g.members.flatMap((i) => indexes.get(i) || [])) })).filter((g) => g.members.length >= 2);
}

/** A copy map describes only the new entities; the original groups stay separate. */
export const copy = (groups = [], indexes) => [...groups, ...remap(groups, indexes)];
