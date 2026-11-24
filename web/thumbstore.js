// thumbstore.js — the Start screen's Recent thumbnails (TODO 136b): a small PNG blob per file path in IndexedDB (idbstore.js; its own database, as
// "project-d" is already at version 1 without this store). Every call can fail (private mode, blocked storage): the caller catches, and a row without a thumbnail shows its icon.
//
// A record: { id (recentKey of the path), blob (PNG, about 160 x 110) }.
import { idbStore } from './idbstore.js';

const store = idbStore('project-d-thumbs', 'thumbs', 'the thumbnail store');

/** Every thumbnail as a Map of id → PNG blob. */
export async function loadThumbs() {
  return new Map((await store.all()).map((r) => [r.id, r.blob]));
}
/** Adds or replaces the thumbnail of a path key. */
export const saveThumb = (id, blob) => store.put({ id, blob });
/** The path keys that have a thumbnail. */
export const thumbIds = async () => (await store.all()).map((r) => r.id);
/** Removes the thumbnails of these path keys. */
export const dropThumbs = (ids) => Promise.all(ids.map((id) => store.del(id)));
