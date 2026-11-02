// TODO 167d: what a detached launch does when its run ends (called by the RUN script of tools/rook-launch.mjs):
// rewrite its runs<N>/queue.txt line to `ended`, and for `build` / `knight --review` launch the review of the branch tip, or write `NO REVIEW: <why>`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOLS = dirname(fileURLToPath(import.meta.url));

// Chain the review? base = the sha the build branched from, tip = the branch's sha now, code = the build's exit code.
export function reviewChain({ base, tip, code }) {
  if (code !== 0) return { why: `the build ended in error (exit ${code})` };
  if (!tip) return { why: 'the branch has no tip' };
  if (tip.startsWith(base.toLowerCase())) return { why: 'no commit on the branch (tip equals the base)' }; // base may be a short sha
  return { chain: true };
}

// Lines 1-2 of queue.txt are Rook's (status, gate); a run line is `<kind> <branch|sha> -> <out basename>: running|ended`. Same out file = same line.
export function setRunLine(text, line, key) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n', lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const i = lines.findIndex((l, j) => j >= 2 && l.includes(` -> ${key}: `));
  if (i < 0) lines.push(line); else lines[i] = line;
  return lines.join(eol) + eol;
}

// job = { queue, key, text: '<kind> <id> -> <key>:', review?: { dir, branch, base, brief, out, from? } } (JSON from the launcher); x = file / git / launch access.
export function finish(job, code, x) {
  if (job.queue) { try { x.write(job.queue, setRunLine(x.read(job.queue) || '', `${job.text} ended`, job.key)); } catch { /* queue.txt is a note, not the run */ } }
  const r = job.review;
  if (!r) return;
  let why;
  try {
    const tip = x.git(r.dir, 'rev-parse', r.branch), d = reviewChain({ base: r.base, tip, code });
    if (d.chain) { x.review(['review', tip, r.brief, r.out, ...(r.from ? ['--from', r.from, r.branch] : [])]); return; }
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
