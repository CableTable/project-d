// Zoom Previous (TODO 74): the last views of a tab, newest last. Not saved in the file. No DOM here.

export const MAX_VIEWS = 10;

/** Remembers a view ({ ox, oy, scale, fitted }) unless it is the one already on top; the oldest goes past MAX_VIEWS. → the list */
export function pushView(list, v) {
  const top = list[list.length - 1];
  if (top && top.ox === v.ox && top.oy === v.oy && top.scale === v.scale) return list;
  list.push({ ox: v.ox, oy: v.oy, scale: v.scale, fitted: !!v.fitted });
  if (list.length > MAX_VIEWS) list.shift();
  return list;
}

/** The view before this one (taken off the list), or null when there is none. */
export const popView = (list) => list.pop() || null;
