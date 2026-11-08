// TODO 219a: the project's own values, read once from rook.config.json at the repo root, so the tools hold no Project D literals.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULTS = {
  test: 'npm test', browserTest: 'npm run test:browser',
  docs: { todo: 'TODO.md', decisions: 'DECISIONS.md', history: 'HISTORY.md', glossary: 'GLOSSARY.md', workflow: 'WORKFLOW.md' },
};
const REQUIRED = ['name', 'slug', 'extras', 'main', 'support', 'github', 'folders'];

// Pure: config text -> the project's values (defaults filled, `mainGit` and `claudeProject` derived); throws a message naming the file and the key.
export function loadProject(text, file = 'rook.config.json') {
  let c;
  try { c = JSON.parse(text); } catch (e) { throw new Error(`${file}: ${e.message}`); }
  for (const key of REQUIRED) if (!c?.[key]) throw new Error(`${file}: missing "${key}"`);
  // Claude Code names a project's transcript folder after its path: every character but a letter or digit becomes "-".
  return { ...DEFAULTS, ...c, docs: { ...DEFAULTS.docs, ...c.docs }, mainGit: `${c.main}/.git`, claudeProject: claudeSlug(c.main) };
}
export const claudeSlug = (path) => path.replace(/[^A-Za-z0-9]/g, '-');

// A command as cmd.exe runs it: `npm test` -> `npm.cmd test` (a .cmd shim needs its extension from node).
export const winCmd = (command) => command.replace(/^npm\b/, 'npm.cmd');

// TODO 219b: the registry hq.json (next to rook.config.json; env ROOK_HQ overrides): `projects` maps a name to its folder, `runs` is the folder that holds runs<N>.
// TODO 219c: the one place that finds the project D's checkout (hq.json, its rook.config.json, worktrees): env ROOK_ROOT (set by tools/kit.mjs, inherited by the child processes), else the folder the command runs in.
// The kit's own folder is never used for this, so the kit can sit outside the repo.
export const ROOT = resolve(process.env.ROOK_ROOT || process.cwd());
process.env.ROOK_ROOT = ROOT;
export const HQ = process.env.ROOK_HQ || join(ROOT, 'hq.json');

export const hqConfig = () => JSON.parse(readFileSync(HQ, 'utf8'));

// TODO 219d: hq.json "hq" is Rook's HQ folder. From session "runsFrom" (default 41) on, runs<N> and Rook's transcripts live there; earlier sessions stay in "runs" and the project's Claude folder.
// The session is the N of rook-next.txt line 3 (runs<N>/resume-rook.txt); `handover` also writes that file into "runs" (`pointer`), so it is always found there.
export const sessionOf = (nextText) => +(/runs(\d+)/.exec((nextText || '').split(/\r?\n/)[2] || '')?.[1] ?? 0);
export const inHq = (hq, session) => !!hq.hq && session >= (hq.runsFrom ?? 41);
const readNext = (hq) => { try { return readFileSync(join(hq.runs, 'rook-next.txt'), 'utf8'); } catch { return ''; } };

// A project's values by name (D = the config in ROOT, so a worktree's own config counts); the runs folder is the registry's. Throws the refusal.
export function projectFor(name, hq = hqConfig(), nextText = readNext(hq)) {
  const folder = Object.hasOwn(hq.projects, name) && hq.projects[name];
  if (!folder) throw new Error(`unknown project ${name} (known: ${Object.keys(hq.projects).join(', ')})`);
  const file = name === 'D' ? join(ROOT, 'rook.config.json') : `${folder}/rook.config.json`;
  if (!existsSync(file)) throw new Error(`project ${name} has no rook.config.json (TODO 219e)`);
  const p = loadProject(readFileSync(file, 'utf8'), file), up = inHq(hq, sessionOf(nextText));
  return { ...p, extras: up ? hq.hq : hq.runs, pointer: hq.runs, claudeProject: up ? claudeSlug(hq.hq) : p.claudeProject };
}

// `--project <name>` anywhere in argv (default D); stripProjectFlag removes it so each command parses only its own flags.
export const projectNameOf = (argv) => { const i = argv.indexOf('--project'); return i < 0 ? 'D' : argv[i + 1] || ''; };
export function stripProjectFlag(argv) { const i = argv.indexOf('--project'); if (i >= 0) argv.splice(i, 2); return argv; }

export const projectName = projectNameOf(process.argv);
// TODO 219c: a refusal (unknown project, no config, a bad hq.json) is one line and exit 1, no stack trace.
export const project = (() => { try { return projectFor(projectName); } catch (e) { console.error(e.message); process.exit(1); } })();

// Brief text: `{project}`, `{test}`, ... become the project's values; any other `{word}` stays for the caller.
const valuesOf = (p) => ({ project: p.name, extras: p.extras, main: p.main, test: p.test, browserTest: p.browserTest, claudeProject: p.claudeProject, kingBuild: p.folders.king?.build, ...p.docs });
export function fillProject(text, p = project) {
  const values = valuesOf(p);
  return text.replace(/\{([a-zA-Z]+)\}/g, (all, key) => (Object.hasOwn(values, key) ? values[key] : all));
}

// A `{lowercase}` word that is no config value is a typo (`{mian}`): it would reach the builder unfilled. `${js}` template code is not one; neither is anything inside a one-line `code span`.
export const unknownKeys = (text, p = project) => [...new Set([...text.replace(/`[^`\r\n]*`/g, '').matchAll(/(?<!\$)\{([a-z][a-zA-Z]*)\}/g)].map((m) => m[1]))].filter((key) => !Object.hasOwn(valuesOf(p), key));
