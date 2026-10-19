// The Auto-nest packer, off the page's thread (nestrun.js), so the progress line moves and Stop works while it packs.
//   in:  { job }   (nest.js's job)
//   out: { type: 'step', done, total, placements } about every 60 ms, then { type: 'done', result }
import { packSteps } from './nest.js';

self.onmessage = (e) => {
  try {
    const g = packSteps(e.data.job);
    let last = 0, r;
    for (;;) {
      r = g.next();
      if (r.done) break;
      const now = Date.now();
      if (now - last > 60) { last = now; self.postMessage({ type: 'step', done: r.value.done, total: r.value.total, placements: r.value.placements }); }
    }
    self.postMessage({ type: 'done', result: r.value });
  } catch (err) { self.postMessage({ type: 'error', error: String((err && err.message) || err) }); }
};
