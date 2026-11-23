// The Auto-nest packer, off the page's thread (nestrun.js), so the progress line moves and Stop works while it packs.
//   in:  { job }   (nest.js's job), or { job, free: { k, K, until } }: Free angles, this worker's share of the seeds (nest.js freeRun)
//   out: { type: 'step', done, total, placements } about every 60 ms, then { type: 'done', result }
//        Free angles: { type: 'step', … } for seed 0 only, { type: 'best', result, tried } on each new best of this worker, then { type: 'done', tried }
import { packSteps, freeRun } from './nest.js';

self.onmessage = (e) => {
  try {
    let last = 0, r;
    if (e.data.free) {
      const { k, K, until } = e.data.free, g = freeRun(e.data.job, k, K, until);
      for (;;) {
        r = g.next();
        if (r.done) break;
        const m = r.value, now = Date.now();
        if (m.type === 'best') self.postMessage(m);
        else if (m.seed === 0 && now - last > 60) { last = now; self.postMessage({ type: 'step', done: m.done, total: m.total, placements: m.placements }); }
      }
      self.postMessage({ type: 'done', tried: r.value.tried });
      return;
    }
    const g = packSteps(e.data.job);
    for (;;) {
      r = g.next();
      if (r.done) break;
      const now = Date.now();
      if (now - last > 60) { last = now; self.postMessage({ type: 'step', done: r.value.done, total: r.value.total, placements: r.value.placements }); }
    }
    self.postMessage({ type: 'done', result: r.value });
  } catch (err) { self.postMessage({ type: 'error', error: String((err && err.message) || err) }); }
};
