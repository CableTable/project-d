// TODO 219e1: `node tools/rook.mjs local-init <KIT|WF> [--dry]` makes the kit and WF local git projects (no remote, no symlinks, no admin).
//   KIT: copies D's kit/ to hq.json "kit" (default E:/Project B/Claude/rook-kit), writes rook.config.json, .gitignore, package.json (test = the kit's test.mjs), git init, one commit naming D's HEAD; hq.json gets "kit" and projects.KIT.
//   WF:  in hq.json projects.WF: git init, .gitignore (node_modules, build, previews), rook.config.json (test = node build-wfs.mjs), one commit. No WF source file is touched.
// Idempotent: a folder that already has a `local-init <NAME>:` commit is left alone; one whose .git has other commits is refused. A file that already exists is kept. `--dry` prints the actions only.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

export const KIT_DEFAULT = 'E:/Project B/Claude/rook-kit';
const IGNORE = { KIT: 'node_modules\ntmp-*.mjs\n', WF: 'node_modules\nbuild\npreviews\n' };
const json = (o) => JSON.stringify(o, null, 2) + '\n';
const runGit = (dir, args, env) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });

// The commit subjects of a repo ([] when it has none yet: `git log --all` exits 0 on an empty repo; any other git error throws before the first write).
const subjects = (dir, git) => git(dir, ['log', '--all', '--format=%s']).split(/\r?\n/).filter(Boolean);

// hqFile = hq.json; root = project D's checkout (its kit/ is the source, its rook.config.json gives "support"). Returns the actions (also sent to `log`).
export function localInit({ name, hqFile, root, dry = false, log = console.log, git = runGit } = {}) {
  if (name !== 'KIT' && name !== 'WF') throw new Error('local-init takes KIT or WF');
  const kit = name === 'KIT', text = readFileSync(hqFile, 'utf8'), hq = JSON.parse(text);
  const dir = kit ? hq.kit || KIT_DEFAULT : hq.projects?.WF;
  if (!dir) throw new Error('hq.json has no WF project');
  const actions = [], say = (m) => { actions.push(m); log((dry ? 'would ' : '') + m); };
  const next = structuredClone(hq); // built before any write, so a hq.json without "projects" cannot fail after the commit
  if (kit) { next.kit = dir; (next.projects ??= {}).KIT = dir; }
  const hasGit = existsSync(join(dir, '.git')), have = hasGit ? subjects(dir, git) : [];
  if (have.length && !have.some((s) => s.startsWith(`local-init ${name}:`))) throw new Error(`${dir} already has git commits that local-init did not make: refused`);
  if (kit && !have.length && existsSync(dir) && readdirSync(dir).some((f) => f !== '.git')) throw new Error(`${dir} is not empty and has no commits: refused`);
  const src = join(root, 'kit');
  if (kit && !have.length && !existsSync(src)) throw new Error(`no kit folder ${src} to copy`);

  if (have.length) say(`same ${dir}: already local-init'ed`);
  else {
    const env = { GIT_AUTHOR_NAME: 'Rook', GIT_AUTHOR_EMAIL: 'rook@localhost', GIT_COMMITTER_NAME: 'Rook', GIT_COMMITTER_EMAIL: 'rook@localhost' };
    if (!hasGit) { say(`git init ${dir}`); if (!dry) { mkdirSync(dir, { recursive: true }); git(dir, ['init', '-q']); } }
    if (kit) { say(`copy ${src} -> ${dir}`); if (!dry) cpSync(src, dir, { recursive: true, filter: (f) => !['node_modules', '.git'].includes(basename(f)) }); }
    const put = (file, content) => (existsSync(join(dir, file)) ? say(`keep ${join(dir, file)}`) : (say(`write ${join(dir, file)}`), !dry && writeFileSync(join(dir, file), content)));
    const extras = hq.hq || hq.runs, support = JSON.parse(readFileSync(join(root, 'rook.config.json'), 'utf8')).support;
    const slug = kit ? 'rook-kit' : 'project-wf', test = kit ? 'npm test' : 'node build-wfs.mjs';
    // "github" is required by loadProject; these projects have no remote (merges are local), so it holds a placeholder.
    put('rook.config.json', json({ name: kit ? 'Rook kit' : 'Project WF', slug, extras, main: dir, support, github: `local/${slug}`, test, browserTest: test, folders: { bishop: { review: `${slug}-bishop`, build: `${slug}-bishop` }, king: { review: `${slug}-king2`, build: `${slug}-king` }, knight: `${slug}-knight` } }));
    put('.gitignore', IGNORE[name]);
    if (kit) put('package.json', json({ name: slug, type: 'module', private: true, scripts: { test: 'node test.mjs' } }));
    let sha = 'unknown'; if (kit) try { sha = git(root, ['rev-parse', 'HEAD']).trim(); } catch { /* D is not a git checkout: the message says so */ }
    const msg = kit ? `local-init KIT: copy of Project D kit/ at ${sha}` : 'local-init WF: first commit';
    say(`git add -A, commit "${msg}"`);
    if (!dry) {
      let named = true; try { git(dir, ['config', 'user.name']); } catch { named = false; } // an identity git already has is kept
      git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', msg], named ? undefined : env);
    }
  }

  if (json(next) !== json(hq)) {
    say(`write ${hqFile}: "kit" and projects.KIT = ${dir}`);
    if (!dry) writeFileSync(hqFile, json(next).replace(/\n/g, text.includes('\r\n') ? '\r\n' : '\n'));
  }
  return actions;
}
