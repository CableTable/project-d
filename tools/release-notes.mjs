// For the CI `release` job (TODO 287a): the date tag of the exe release and the "added" lines of its notes.
// CLI: node tools/release-notes.mjs tag <tags.txt>             -> vYYYY.MM.DD (IST), vYYYY.MM.DD.2 ... when that day's tag exists
//      node tools/release-notes.mjs notes <subjects.txt> <TODO.md> -> one "<id> <title>" line per TODO id in the commit subjects
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const IST_MS = 5.5 * 3600e3; // the runner clock is UTC; his days are IST

// tags: the existing tag names; now: a Date.
export function releaseTag(tags, now = new Date()) {
  const base = `v${new Date(now.getTime() + IST_MS).toISOString().slice(0, 10).replaceAll('-', '.')}`;
  let tag = base;
  for (let n = 2; tags.includes(tag); n++) tag = `${base}.${n}`;
  return tag;
}

// subjects: `git log --format=%s <previous>..<sha>`, newest first; todoText: TODO.md.
// A subject `TODO <id>...` credits the exe that holds the code; Rook's "ticked" commits come later and are skipped.
export function addedLines(subjects, todoText) {
  const titles = new Map();
  for (const m of todoText.matchAll(/^- \[.\] (\S+?)\. \*\*(.+?)\*\*/gm)) titles.set(m[1], m[2]);
  const seen = new Set();
  const lines = [];
  for (const s of [...subjects].reverse()) {
    const m = /^TODO (\d+[a-z0-9]*)\b(?: fix\d*)?:?\s*(.*)/.exec(s);
    if (!m || /^TODO [\w ,+]+ ticked\b/.test(s) || seen.has(m[1])) continue;
    seen.add(m[1]);
    lines.push(`${m[1]} ${titles.get(m[1]) ?? m[2]}`.trim());
  }
  return lines;
}

const lines = (file) => readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'tag') console.log(releaseTag(lines(a)));
  else if (cmd === 'notes') console.log(addedLines(lines(a), readFileSync(b, 'utf8')).join('\n'));
  else { console.error('usage: node tools/release-notes.mjs tag <tags.txt> | notes <subjects.txt> <TODO.md>'); process.exit(1); }
}
