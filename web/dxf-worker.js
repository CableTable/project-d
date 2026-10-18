// The drawing reader (.dxf), off the page's thread (viewers.js): drawing.js reads the file and lays it out here,
// so a big drawing doesn't freeze the page while it reads. One file per message:
//   in:  { bytes: ArrayBuffer }      out: { ok: true, result (drawn), doc (the DXF document, to save and copy) } | { ok: false, sorry? (a plain message), error? }

import { decodeDxf, readDxf, flatten, DrawingError } from './drawing.js';

self.onmessage = (e) => {
  try {
    const doc = readDxf(decodeDxf(e.data.bytes));
    self.postMessage({ ok: true, result: flatten(doc), doc });
  } catch (err) {
    if (err instanceof DrawingError) self.postMessage({ ok: false, sorry: err.message });
    else self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};
