// TODO 219a: the project's own values, read once from rook.config.json at the repo root, so the tools hold no Project D literals.
import { readFileSync } from 'node:fs';

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

export const project = loadProject(readFileSync(new URL('../rook.config.json', import.meta.url), 'utf8'));

// Brief text: `{project}`, `{test}`, ... become the project's values; any other `{word}` stays for the caller.
export function fillProject(text, p = project) {
  const values = { project: p.name, extras: p.extras, main: p.main, test: p.test, browserTest: p.browserTest, claudeProject: p.claudeProject, kingBuild: p.folders.king?.build, ...p.docs };
  return text.replace(/\{([a-zA-Z]+)\}/g, (all, key) => (Object.hasOwn(values, key) ? values[key] : all));
}
