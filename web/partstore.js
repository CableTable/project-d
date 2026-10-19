// partstore.js — the Parts library's storage: IndexedDB in the WebView (no Rust, no plugin; idbstore.js). Every call can fail (private
// mode, blocked storage, a full disk); the caller catches and keeps the library in memory, so the app stays usable.
//
// A record: { id, name, w, h (mm), dxf (the part as DXF text, layoutdoc.partToDxf), thumb (a small PNG data URL), source (file it came from), t (ms) }.
import { idbStore } from './idbstore.js';

const store = idbStore('project-d', 'parts', 'the parts store');

/** Every saved part, oldest first. */
export async function loadParts() {
  const all = await store.all();
  return all.sort((a, b) => (a.t || 0) - (b.t || 0));
}
/** Adds or replaces a part. */
export const savePart = (rec) => store.put(rec);
/** Removes a part. */
export const removePart = (id) => store.del(id);
