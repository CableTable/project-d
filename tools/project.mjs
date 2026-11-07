// TODO 219a: the project's own values, read once from rook.config.json at the repo root, so the tools hold no Project D literals.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  return { ...DEFAULTS, ...c, docs: { ...DEFAULTS.docs, ...c.docs }, mainGit: `${c.main}/.git`, claudeProject: c.main.replace(/[^A-Za-z0-9]/g, '-') };
}

// A command as cmd.exe runs it: `npm test` -> `npm.cmd test` (a .cmd shim needs its extension from node).
export const winCmd = (command) => command.replace(/^npm\b/, 'npm.cmd');

// TODO 219b: the registry hq.json (next to rook.config.json; env ROOK_HQ overrides): `projects` maps a name to its folder, `runs` is the folder that holds runs<N>.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HQ = process.env.ROOK_HQ || join(ROOT, 'hq.json');

// A project's values by name (D = the config beside these tools, so a worktree's own config counts); the runs folder is the registry's. Throws the refusal.
export function projectFor(name, hq = JSON.parse(readFileSync(HQ, 'utf8'))) {
  const folder = Object.hasOwn(hq.projects, name) && hq.projects[name];
  if (!folder) throw new Error(`unknown project ${name} (known: ${Object.keys(hq.projects).join(', ')})`);
  const file = name === 'D' ? join(ROOT, 'rook.config.json') : `${folder}/rook.config.json`;
  if (!existsSync(file)) throw new Error(`project ${name} has no rook.config.json (TODO 219e)`);
  return { ...loadProject(readFileSync(file, 'utf8'), file), extras: hq.runs };
}

// `--project <name>` anywhere in argv (default D); stripProjectFlag removes it so each command parses only its own flags.
export const projectNameOf = (argv) => { const i = argv.indexOf('--project'); return i < 0 ? 'D' : argv[i + 1] || ''; };
export function stripProjectFlag(argv) { const i = argv.indexOf('--project'); if (i >= 0) argv.splice(i, 2); return argv; }

export const projectName = projectNameOf(process.argv);
export const project = projectFor(projectName);

// Brief text: `{project}`, `{test}`, ... become the project's values; any other `{word}` stays for the caller.
const valuesOf = (p) => ({ project: p.name, extras: p.extras, main: p.main, test: p.test, browserTest: p.browserTest, claudeProject: p.claudeProject, kingBuild: p.folders.king?.build, ...p.docs });
export function fillProject(text, p = project) {
  const values = valuesOf(p);
  return text.replace(/\{([a-zA-Z]+)\}/g, (all, key) => (Object.hasOwn(values, key) ? values[key] : all));
}

// A `{lowercase}` word that is no config value is a typo (`{mian}`): it would reach the builder unfilled. `${js}` template code is not one; neither is anything inside a one-line `code span`.
export const unknownKeys = (text, p = project) => [...new Set([...text.replace(/`[^`\r\n]*`/g, '').matchAll(/(?<!\$)\{([a-z][a-zA-Z]*)\}/g)].map((m) => m[1]))].filter((key) => !Object.hasOwn(valuesOf(p), key));
