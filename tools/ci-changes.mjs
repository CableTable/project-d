// Decides for the CI `changes` job whether a PR push needs test and build (true) or only changed .md files after a green run (false).
// Any doubt (no files, a failed diff, no check runs, a red or missing run) answers true.
// CLI: node tools/ci-changes.mjs <files.txt> <runs.json>   (runs.json is the raw `gh api .../check-runs` answer)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// files: the changed names (null or '?' = the diff failed); checkRuns: the check_runs array of the BEFORE commit (null = API error).
export function codeChanged(files, checkRuns) {
  if (!Array.isArray(files) || !files.length || !Array.isArray(checkRuns)) return true;
  if (files.some((f) => !f.endsWith('.md'))) return true;
  const changes = checkRuns.filter((r) => r.name === 'changes');
  const builds = checkRuns.filter((r) => r.name === 'build' || r.name.startsWith('test'));
  const green = changes.length > 0 && changes.every((r) => r.conclusion === 'success')
    && builds.length > 0 && builds.every((r) => r.conclusion === 'success' || r.conclusion === 'skipped');
  return !green;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  let answer = true;
  try {
    const files = readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean);
    answer = codeChanged(files, JSON.parse(readFileSync(process.argv[3], 'utf8')).check_runs);
  } catch { /* any error keeps code=true */ }
  console.log(String(answer)); // a string, so FORCE_COLOR never wraps it in ANSI codes
}
