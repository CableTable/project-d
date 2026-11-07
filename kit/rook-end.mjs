// TODO 167d: what a detached launch does when its run ends (called by the RUN script of tools/rook-launch.mjs):
// rewrite its runs<N>/queue.txt line to `ended`, and for `build` / `knight --review` launch the review of the branch tip, or write `NO REVIEW: <why>`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOLS = dirname(fileURLToPath(import.meta.url));

// Chain the review? base = the sha the build branched from, tip = the branch's sha now (or a function that reads it: not called after a non-zero exit), code = the build's exit code.
export function reviewChain({ base, tip, code }) {
  if (code !== 0) return { why: `the build ended in error (exit ${code})` };
  if (typeof tip === 'function') tip = tip();
  if (!tip) return { why: 'the branch has no tip' };
  if (tip.startsWith(base.toLowerCase())) return { why: 'no commit on the branch (tip equals the base)' }; // base may be a short sha
  return { chain: true };
}

// Lines 1-2 of queue.txt are Rook's (status, gate); a run line is `<kind> <branch|sha> -> <out basename>: running|ended`. Same out file = same line.
export function setRunLine(text, line, key) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n', lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  while (lines.length < 2) lines.push(''); // a run line never takes line 1 or 2
  const i = lines.findIndex((l, j) => j >= 2 && l.includes(` -> ${key}: `));
  if (i < 0) lines.push(line); else lines[i] = line;
  return lines.join(eol) + eol;
}

// job = { queue, key, text: '<kind> <id> -> <key>:', review?: { dir, branch, base, brief, out, from? } } (JSON from the launcher); x = file / git / launch access.
export function finish(job, code, x) {
  // A launch that died writes no result: give `wait` one (the out file sits beside queue.txt; a Knight .txt report is done once non-empty)
  if (job.queue && code !== 0 && /\.(jsonl|txt)$/.test(job.key)) {
    const out = job.out || join(dirname(job.queue), job.key), cur = x.read(out);
    if (job.key.endsWith('.jsonl') ? !/"type":"result"/.test(cur) && !cur.startsWith('NO REVIEW:') : !cur.trim()) x.write(out, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + '{"type":"result","is_error":true,"result":"LAUNCH DIED"}\n');
  }
  // `ended` goes in after the chained review wrote its `running`, so a refresh in between sees no gap
  try { chainReview(job, code, x); } finally {
    if (job.queue) { try { x.write(job.queue, setRunLine(x.read(job.queue) || '', `${job.text} ended`, job.key)); } catch { /* queue.txt is a note, not the run */ } }
  }
}

function chainReview(job, code, x) {
  const r = job.review;
  if (!r) return;
  let why;
  try {
    let tip;
    const d = reviewChain({ base: r.base, tip: () => (tip = x.git(r.dir, 'rev-parse', r.branch)), code });
    // --over: the launcher's 150k context gate must not refuse a review of a build that already ran
    if (d.chain) { x.review(['review', tip, r.brief, r.out, ...(r.from ? ['--from', r.from, r.branch] : []), '--over', ...(job.project ? ['--project', job.project] : [])]); return; }
    why = d.why;
  } catch (e) { why = `review not launched: ${e.message}`; }
  x.write(r.out, `NO REVIEW: ${why}\n`);
}

const io = {
  read: (p) => (existsSync(p) ? readFileSync(p, 'utf8') : ''),
  write: writeFileSync,
  git: (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'pipe' }).trim(),
  review(a) {
    try { execFileSync(process.execPath, [join(TOOLS, 'rook.mjs'), ...a], { encoding: 'utf8', stdio: 'pipe', windowsHide: true }); }
    catch (e) { throw new Error(String(e.stderr || e.message).trim()); }
  },
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) finish(JSON.parse(process.argv[2]), Number(process.argv[3]), io);
