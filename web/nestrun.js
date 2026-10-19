// nestrun.js — runs an Auto-nest job without freezing the page: in a Web Worker (nest-worker.js), or in slices of 30 ms on the page when
// there is no worker. startNest(job, onStep) → { stop(), done }: onStep({ done, total, placements }) as it goes; `done` is a promise of
// the result (nest.js's shape, plus ms). stop() ends the run and keeps what was placed so far (result.stopped = true).
import { packSteps, summary } from './nest.js';

export function startNest(job, onStep = () => {}, { useWorker = true } = {}) {
  const t0 = Date.now();
  let last = { done: 0, total: 0, placements: [] }, settle, ended = false, worker = null, timer = 0, gen = null;
  const done = new Promise((res) => { settle = res; });
  const finish = (result) => { if (ended) return; ended = true; if (worker) worker.terminate(); clearTimeout(timer); settle({ ...result, ms: Date.now() - t0 }); };
  const onPage = () => {                                       // no worker: the same generator, 30 ms at a time
    gen = packSteps(job);
    const tick = () => {
      if (ended) return;
      const s = performance.now();
      while (performance.now() - s < 30) {
        const r = gen.next();
        if (r.done) { onStep({ done: r.value.total, total: r.value.total, placements: r.value.placements }); finish(r.value); return; }
        last = r.value;
      }
      onStep(last);
      timer = setTimeout(tick, 0);
    };
    tick();
  };
  if (useWorker && typeof Worker !== 'undefined') {
    try {
      worker = new Worker('nest-worker.js', { type: 'module' });
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'step') { last = m; onStep(m); } else if (m.type === 'done') finish(m.result);
        else if (m.type === 'error') { worker.terminate(); worker = null; console.warn('Auto-nest: the worker failed, packing on the page:', m.error); onPage(); }
      };
      worker.onerror = (e) => { if (ended) return; worker.terminate(); worker = null; console.warn('Auto-nest: no worker, packing on the page:', e.message); onPage(); };
      worker.postMessage({ job });
    } catch (err) { worker = null; console.warn('Auto-nest: no worker, packing on the page:', err); onPage(); }
  } else onPage();
  return {
    done,
    stop() { if (!ended) finish(summary(job, last.placements.slice())); },
  };
}
