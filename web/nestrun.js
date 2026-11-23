// nestrun.js — runs an Auto-nest job without freezing the page: in a Web Worker (nest-worker.js), or in slices of 30 ms on the page when
// there is no worker. startNest(job, onStep) → { stop(), done }: onStep({ done, total, placements }) as it goes; `done` is a promise of
// the result (nest.js's shape, plus ms). stop() ends the run and keeps what was placed so far (result.stopped = true).
// Free angles (job.rotations === 'free', job.timeLimit s): K = half the cores workers each try their own seeds (nest.js freeRun); the best try
// (highest usedPct, a tie to the lower seed) is kept. The result is that try's, plus free: { seed, tried, stopped }; onStep gets a message only on a
// new best (its placements, free: { tried, usedPct }), and, while there is none yet, seed 0's steps. The time limit ends the random tries, never seed 0.
import { packSteps, summary, freeRun, betterTry } from './nest.js';

function startFree(job, onStep, useWorker) {
  const t0 = Date.now(), until = t0 + (job.timeLimit > 0 ? job.timeLimit : 60) * 1000, K = Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2));
  const tried = [], workers = [];
  let best = null, last = { placements: [] }, ended = false, need = K, got = 0, settle;
  const done = new Promise((res) => { settle = res; });
  const count = () => tried.reduce((s, n) => s + (n || 0), 0);
  const finish = (stopped) => {
    if (ended) return; ended = true; workers.forEach((w) => w.terminate());
    settle({ ...(best || summary(job, last.placements.slice())), free: { seed: best ? best.seed : 0, tried: count(), stopped }, ms: Date.now() - t0 });
  };
  const onMsg = (k, m) => {
    if (ended) return;
    if (m.type === 'step') { if (!(m.seed > 0) && !best) { last = m; onStep(m); } }
    else if (m.type === 'best') {
      tried[k] = m.tried;
      if (betterTry(m.result, best)) { best = m.result; onStep({ done: best.total, total: best.total, placements: best.placements, free: { tried: count(), usedPct: best.usedPct } }); }
    } else if (m.type === 'done') { tried[k] = m.tried; if (++got === need) finish(false); }
  };
  const onPage = (why) => {                                    // no worker: one worker's share on the page, 30 ms at a time
    console.warn('Auto-nest: no worker, packing on the page:', why);
    workers.splice(0).forEach((w) => w.terminate());
    need = 1; got = 0; tried.length = 0;
    const gen = freeRun(job, 0, 1, until);
    const tick = () => {
      if (ended) return;
      const s = performance.now();
      let step = null;
      while (performance.now() - s < 30) {
        let r;
        try { r = gen.next(); } catch (err) { console.error('Auto-nest failed:', err); finish(true); return; }
        if (r.done) { onMsg(0, { type: 'done', tried: r.value.tried }); return; }
        if (r.value.type === 'step') step = r.value; else onMsg(0, r.value);
      }
      if (step) onMsg(0, step);
      setTimeout(tick, 0);
    };
    tick();
  };
  if (useWorker && typeof Worker !== 'undefined') {
    try {
      for (let k = 0; k < K; k++) {
        const w = new Worker('nest-worker.js', { type: 'module' });
        workers.push(w);
        w.onmessage = (e) => { if (e.data.type === 'error') { if (!ended && workers.length) onPage(e.data.error); } else onMsg(k, e.data); };
        w.onerror = (e) => { if (!ended && workers.length) onPage(e.message); };
        w.postMessage({ job, free: { k, K, until } });
      }
    } catch (err) { onPage(err); }
  } else onPage('Worker is not available');
  return { done, stop() { finish(true); } };
}

export function startNest(job, onStep = () => {}, { useWorker = true } = {}) {
  if (job.rotations === 'free') return startFree(job, onStep, useWorker);
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
        let r;
        try { r = gen.next(); } catch (err) { console.error('Auto-nest failed:', err); finish({ ...summary(job, last.placements.slice()), stopped: true, error: String(err) }); return; }
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
