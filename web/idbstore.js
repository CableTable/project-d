// idbstore.js — one IndexedDB store keyed by "id", shared by partstore.js and recovery.js. Every call can fail (private mode, blocked
// storage, a full disk): the caller catches. A write is done when its transaction commits, not when the request succeeds.

/** JSON records in localStorage; the caller catches blocked storage or malformed records. */
export function localStore(prefix, storage) {
  return {
    get: (id) => JSON.parse(storage.getItem(prefix + id) || 'null'),
    put: (id, value) => storage.setItem(prefix + id, JSON.stringify(value)),
  };
}

/** → { all(), put(rec), del(id), clear() } for database `db`, object store `store`; `what` names it in an error ("the parts store"). */
export function idbStore(db, store, what) {
  let opened = null;
  const open = () => {
    if (!opened) {
      opened = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB here')); return; }
        const r = indexedDB.open(db, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore(store, { keyPath: 'id' }); };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error || new Error('could not open ' + what));
        r.onblocked = () => reject(new Error(what + ' is blocked'));
      });
      opened.catch(() => { opened = null; });                // try again next time
    }
    return opened;
  };
  const tx = async (mode) => (await open()).transaction(store, mode);
  /** A write is done when its transaction commits (a full disk aborts it there, after the request itself has succeeded). */
  const write = async (f) => {
    const t = await tx('readwrite');
    const c = new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onabort = () => reject(t.error || new Error(what + ' could not save'));
      t.onerror = () => reject(t.error || new Error(what + ' could not save'));
    });
    f(t.objectStore(store));
    await c;
  };
  return {
    all: async () => {
      const req = (await tx('readonly')).objectStore(store).getAll();
      return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    },
    put: (rec) => write((s) => s.put(rec)),
    del: (id) => write((s) => s.delete(id)),
    clear: () => write((s) => s.clear()),
  };
}
