// recovery.js — autosave copies of the tabs with unsaved changes (TODO 32). Kept INSIDE the app (IndexedDB, as partstore.js), never next to
// the user's files and never over them. Every call can fail (private mode, blocked storage, a full disk): the caller catches and the app
// carries on without recovery.
//
// A record: { id (the tab's recovery id), name, path, kind ('drawing' | 'layout'), dxf (the text Save would write), t (ms),
//             saved, fromFile, fromPdf, acceptedLoss (the tab's Save state, so Save works as before after a recovery) }.
const DB = 'project-d-recovery', STORE = 'copies';
let opened = null;

function open() {
  if (!opened) {
    opened = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB here')); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('could not open the recovery store'));
      r.onblocked = () => reject(new Error('the recovery store is blocked'));
    });
    opened.catch(() => { opened = null; });                  // try again next time
  }
  return opened;
}
const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const tx = async (mode) => (await open()).transaction(STORE, mode).objectStore(STORE);

/** Every recovery copy, oldest first. */
export async function loadCopies() {
  const all = await done((await tx('readonly')).getAll());
  return all.sort((a, b) => (a.t || 0) - (b.t || 0));
}
/** Adds or replaces a copy. */
export async function saveCopy(rec) { await done((await tx('readwrite')).put(rec)); }
/** Removes the copy of one tab. */
export async function removeCopy(id) { await done((await tx('readwrite')).delete(id)); }
/** Removes every copy. */
export async function clearCopies() { await done((await tx('readwrite')).clear()); }

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
