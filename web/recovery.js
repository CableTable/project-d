// recovery.js — autosave copies of the tabs with unsaved changes (TODO 32). Kept INSIDE the app (IndexedDB, as partstore.js), never next to
// the user's files and never over them. Every call can fail (private mode, blocked storage, a full disk): the caller catches and the app
// carries on without recovery.
//
// A record: { id (the tab or PDF sheet's recovery id), name, path, kind ('drawing' | 'layout'), dxf (the text Save would write), t (ms),
//             saved, fromFile, fromPdf, acceptedLoss (the tab's Save state, so Save works as before after a recovery) }.
import { idbStore } from './idbstore.js';

const store = idbStore('project-d-recovery', 'copies', 'the recovery store');

/** Every recovery copy, oldest first. */
export async function loadCopies() {
  const all = await store.all();
  return all.sort((a, b) => (a.t || 0) - (b.t || 0));
}
/** Adds or replaces a copy (done when it is really on disk). */
export const saveCopy = (rec) => store.put(rec);
/** Removes the copy of one tab. */
export const removeCopy = (id) => store.del(id);
/** Removes every copy. */
export const clearCopies = () => store.clear();

const two = (n) => String(n).padStart(2, '0');
/** A time for the prompt: "14:05" today, "17 Oct 14:05" on another day (local time). */
export function timeText(t, now = Date.now()) {
  const d = new Date(t), n = new Date(now), hm = two(d.getHours()) + ':' + two(d.getMinutes());
  if (d.toDateString() === n.toDateString()) return hm;
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${hm}`;
}
/** The question at start-up: "Recover 2 unsaved drawings from 14:05?" (the newest copy's time). */
export function recoverPrompt(copies, now = Date.now()) {
  const n = copies.length, newest = Math.max(...copies.map((c) => c.t || 0));
  return `Recover ${n} unsaved ${n === 1 ? 'drawing' : 'drawings'} from ${timeText(newest, now)}?`;
}
/** Valid copies only (a record from storage is data, not trusted): the fields the recovery needs, in the right types. */
export function cleanCopies(list) {
  return (Array.isArray(list) ? list : []).filter((c) => c && typeof c.id === 'string' && typeof c.dxf === 'string' && c.dxf.length && typeof c.name === 'string' && (c.kind === 'drawing' || c.kind === 'layout'))
    .map((c) => ({ id: c.id, name: c.name, path: typeof c.path === 'string' ? c.path : null, kind: c.kind, dxf: c.dxf, t: Number.isFinite(c.t) ? c.t : 0,
      saved: !!c.saved, fromFile: !!c.fromFile, fromPdf: typeof c.fromPdf === 'string' ? c.fromPdf : null, acceptedLoss: !!c.acceptedLoss }));
}
