// partstore.js — the Parts library's storage: IndexedDB in the WebView (no Rust, no plugin). Every call can fail (private
// mode, blocked storage, a full disk); the caller catches and keeps the library in memory, so the app stays usable.
//
// A record: { id, name, w, h (mm), dxf (the part as DXF text, layoutdoc.partToDxf), thumb (a small PNG data URL), source (file it came from), t (ms) }.
const DB = 'project-d', STORE = 'parts';
let opened = null;

function open() {
  if (!opened) {
    opened = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB here')); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('could not open the parts store'));
      r.onblocked = () => reject(new Error('the parts store is blocked'));
    });
    opened.catch(() => { opened = null; });                  // try again next time
  }
  return opened;
}
const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const tx = async (mode) => (await open()).transaction(STORE, mode).objectStore(STORE);

/** Every saved part, oldest first. */
export async function loadParts() {
  const all = await done((await tx('readonly')).getAll());
  return all.sort((a, b) => (a.t || 0) - (b.t || 0));
}
/** Adds or replaces a part. */
export async function savePart(rec) { await done((await tx('readwrite')).put(rec)); }
/** Removes a part. */
export async function removePart(id) { await done((await tx('readwrite')).delete(id)); }
