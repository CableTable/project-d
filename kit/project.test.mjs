import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

// Dynamic imports: on a base without kit/project.mjs each test fails (red), not the whole file (a load error).
const P = () => import('./project.mjs').catch(() => assert.fail('kit/project.mjs is missing'));
const L = () => import('./rook-launch.mjs').catch(() => assert.fail('kit/rook-launch.mjs is missing'));
const KIT = fileURLToPath(new URL('.', import.meta.url));

const X = 'E:/Project B/Claude/Project D extras';
const D = 'E:/Project B/Claude/Project D';
const MIN = { name: 'Project Z', slug: 'project-z', extras: 'E:/Z extras', main: 'E:/Z/app', support: 'E:/Z/support', github: 'me/z', folders: { king: { review: 'Z-king2', build: 'Z-king' }, bishop: { review: 'Z-b', build: 'Z-b' }, knight: 'Z-rowan' } };

test('TODO 219a: loadProject fills defaults and derives the git folder and the transcript folder; a bad file names the file and the key', async () => {
  const { loadProject } = await P();
  const p = loadProject(JSON.stringify(MIN));
  assert.equal(p.test, 'npm test');
  assert.equal(p.browserTest, 'npm run test:browser');
  assert.deepEqual(p.docs, { todo: 'TODO.md', decisions: 'DECISIONS.md', history: 'HISTORY.md', glossary: 'GLOSSARY.md', workflow: 'WORKFLOW.md' });
  assert.equal(p.mainGit, 'E:/Z/app/.git');
  assert.equal(p.claudeProject, 'E--Z-app');
  assert.equal(loadProject(JSON.stringify({ ...MIN, test: 'pytest', docs: { todo: 'PLAN.md' } })).docs.todo, 'PLAN.md');
  assert.equal(loadProject(JSON.stringify({ ...MIN, docs: { todo: 'PLAN.md' } })).docs.decisions, 'DECISIONS.md');
  assert.throws(() => loadProject('{ nope', 'x.json'), /^Error: x\.json: /);
  assert.throws(() => loadProject(JSON.stringify({ ...MIN, extras: '' }), 'x.json'), /x\.json: missing "extras"/);
  assert.throws(() => loadProject('null'), /missing "name"/);
});

test('TODO 219a: rook.config.json holds Project D\'s values', async () => {
  const { project } = await P(), { ACCOUNTS } = await L();
  assert.equal(project.name, 'Project D');
  assert.equal(project.slug, 'project-d');
  assert.equal(project.extras, X);
  assert.equal(project.main, D);
  assert.equal(project.mainGit, `${D}/.git`);
  assert.equal(project.support, 'E:/Project B/Claude/support');
  assert.equal(project.github, 'CableTable/project-d');
  assert.equal(project.claudeProject, 'E--Project-B-Claude-Project-D');
  assert.equal(project.test, 'npm test');
  assert.equal(project.browserTest, 'npm run test:browser');
  assert.deepEqual(project.docs, { todo: 'TODO.md', decisions: 'DECISIONS.md', history: 'HISTORY.md', glossary: 'GLOSSARY.md', workflow: 'WORKFLOW.md' });
  assert.deepEqual(ACCOUNTS, { bishop: { bin: 'claude2.cmd', review: 'ProjectD-s15fix', build: 'ProjectD-s15fix' }, king: { bin: 'claude3.cmd', review: 'ProjectD-king2', build: 'ProjectD-king' } });
});

test('TODO 219a: winCmd gives the cmd.exe form of an npm command; fillProject fills known placeholders and leaves the rest', async () => {
  const { fillProject, loadProject, winCmd } = await P();
  assert.equal(winCmd('npm test'), 'npm.cmd test');
  assert.equal(winCmd('npm run test:browser'), 'npm.cmd run test:browser');
  assert.equal(winCmd('pytest -q'), 'pytest -q');
  assert.equal(fillProject('{project} {test} {browserTest} {extras}/runs{N} {main} {todo} {decisions} {history} {glossary} {workflow} {claudeProject} {kingBuild} {ID} {nope}'),
    `Project D npm test npm run test:browser ${X}/runs{N} ${D} TODO.md DECISIONS.md HISTORY.md GLOSSARY.md WORKFLOW.md E--Project-B-Claude-Project-D ProjectD-king {ID} {nope}`);
  assert.equal(fillProject('{project} runs {test}', loadProject(JSON.stringify({ ...MIN, test: 'pytest' }))), 'Project Z runs pytest');
});

test('TODO 219a: the launcher\'s argument lists for D\'s config equal the literal lists from before the config (review, build, retro, fresh, board, knight)', async () => {
  const { boardArgs, buildArgs, commandLine, fresh, knightArgs, retroArgs, reviewerArgs } = await L();
  assert.deepEqual(reviewerArgs(), ['-p', '--agent', 'reviewer', '--model', 'claude-opus-5-5', '--effort', 'medium', '--permission-mode', 'dontAsk', '--max-budget-usd', '6', '--add-dir', X,
    '--disallowedTools', 'Agent', 'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git add:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git stash:*)', 'Bash(git restore:*)', 'Bash(git pull:*)', '--output-format', 'stream-json', '--verbose']);
  assert.deepEqual(buildArgs(), ['-p', '--agent', 'builder', '--strict-mcp-config', '--model', 'claude-sonnet-5-5', '--effort', 'high', '--permission-mode', 'acceptEdits', '--max-budget-usd', '8',
    '--add-dir', `${D}/.git`, '--add-dir', X,
    '--disallowedTools', 'Bash(gh pr merge:*)', 'PowerShell(gh pr merge:*)', 'Agent', 'Bash(git push:*)', 'Bash(taskkill:*)', 'PowerShell(Stop-Process:*)', 'Bash(node -e:*)',
    '--allowedTools', 'Bash(echo:*)', 'Bash(tee:*)', 'Bash(npx.cmd:*)', 'Bash(npm.cmd:*)', 'PowerShell(Select-String:*)', 'PowerShell(Select-Object:*)', 'PowerShell(Write-Output:*)',
    'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git fetch:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git cherry-pick:*)', 'Bash(git rebase:*)', 'Bash(git apply:*)', 'Bash(git check-ignore:*)', 'Bash(git merge --squash:*)', 'Bash(git grep:*)',
    '--output-format', 'stream-json', '--verbose']);
  assert.deepEqual(retroArgs(undefined, 'H'), ['-p', '--model', 'claude-opus-5-5', '--effort', 'medium', '--permission-mode', 'dontAsk', '--max-budget-usd', '6', '--output-format', 'text',
    '--add-dir', X, '--add-dir', D, '--add-dir', 'H/.claude/projects/E--Project-B-Claude-Project-D', '--add-dir', 'H/.claude/plugins/cache/mattpocock',
    '--allowedTools', 'Read', 'Grep', 'Glob', 'Write', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(wc:*)', '--disallowedTools', 'Agent']);
  assert.deepEqual(boardArgs(), ['-p', '--model', 'claude-sonnet-5-5', '--effort', 'high', '--permission-mode', 'dontAsk', '--max-budget-usd', '4', '--output-format', 'text',
    '--add-dir', X, '--add-dir', D, '--allowedTools', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(node:*)', '--disallowedTools', 'Agent']);
  assert.deepEqual(knightArgs(`${X}/runs1/k.txt`, undefined, 'H'), ['exec', '-p', 'builder', '-C', `${X}/ProjectD-rowan`, '--add-dir', `${X}/ProjectD-rowan-git`, '--add-dir', 'H/AppData/Local/ms-playwright', '-o', `${X}/runs1/k.txt`, '-']);
  // fresh builds its list inside the command: run it against a recorder
  const launches = [];
  const x = { need() {}, locked: () => false, open: (p) => `fd:${p}`, queue: { open: () => null, set() {} }, launch: (...a) => launches.push(a), gate: { queueFile: () => `${X}/runs39/queue.txt` } };
  const log = console.log; console.log = () => {};
  try { fresh(['219a'], x); } finally { console.log = log; }
  assert.deepEqual(launches[0][1], ['-p', "Fresh read of TODO 219a: read grill-219a.md, TODO.md row 219a and the code files it names. Max 8 lines: gaps, contradictions, missing cases; for each 'X never Y' answer, quote the code line that keeps it or say not found. Change nothing.",
    '--model', 'claude-opus-5-5', '--effort', 'medium', '--permission-mode', 'dontAsk', '--max-budget-usd', '2', '--output-format', 'text', '--add-dir', D, '--add-dir', 'E:/Project B/Claude/support', '--allowedTools', 'Read', 'Grep', 'Glob', '--disallowedTools', 'Agent']);
  assert.doesNotThrow(() => commandLine('claude3.cmd', launches[0][1]));
});

test('TODO 219a: no brief template keeps a Project D literal, and filling the retro briefs leaves no config placeholder behind', async () => {
  const { fillProject } = await P();
  for (const file of ['board', 'build', 'retro', 'retro-king', 'retro-rook']) {
    const text = readFileSync(new URL(`./briefs/${file}.txt`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /Project D|ProjectD|E:\/Project B|E--Project|npm\.cmd test|\b(TODO|DECISIONS|WORKFLOW)\.md/, file);
    assert.doesNotMatch(fillProject(text), /\{(project|extras|main|test|browserTest|claudeProject|kingBuild|todo|decisions|history|glossary|workflow)\}/, file);
  }
  assert.match(fillProject(readFileSync(new URL('./briefs/retro.txt', import.meta.url), 'utf8')), new RegExp(`^Project D retro for session \\{N\\}.*${X}/runs\\{N\\}/`));
});

test('TODO 219a fix: a brief opened for reading hands on the filled text and the brief file stays unchanged; a write open is left alone', async () => {
  const { openFilled } = await L();
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  try {
    const brief = join(dir, 'b.txt'), plain = join(dir, 'p.txt'), out = join(dir, 'o.txt');
    const raw = '{project}: run {test}\r\nrow in {todo} {ID}\r\n';
    writeFileSync(brief, raw);
    writeFileSync(plain, 'nothing {to} fill\r\n');
    const fd = openFilled(brief, 'r'), fdPlain = openFilled(plain, 'r');
    assert.equal(readFileSync(fd, 'utf8'), 'Project D: run npm test\r\nrow in TODO.md {ID}\r\n');
    assert.equal(readFileSync(fdPlain, 'utf8'), 'nothing {to} fill\r\n');
    closeSync(fd);
    closeSync(fdPlain);
    closeSync(openFilled(out, 'w'));
    assert.equal(readFileSync(brief, 'utf8'), raw);
    assert.equal(readFileSync(plain, 'utf8'), 'nothing {to} fill\r\n');
    assert.equal(readFileSync(out, 'utf8'), '');
  } finally { rmSync(dir, { recursive: true }); }
});

test('TODO 219a fix: lintBrief refuses a {lowercase} key that is no config value and names it', async () => {
  const { lintBrief } = await L();
  assert.deepEqual(lintBrief('1. Run {mian} and {mian} again'), ['unknown placeholder {mian} (not a rook.config.json value)']);
  assert.deepEqual(lintBrief('1. Fix {project} in {todo}, runs{N}/{ID}, ${shotDir}'), []);
});

test('TODO 219a fix 2: unknownKeys skips one-line code spans, still refuses a bare key beside one; every runs39 brief passes lintBrief', async () => {
  const { lintBrief } = await L();
  assert.deepEqual(lintBrief('1. A key like `{mian}` or `x {foo} y` is a typo'), []);
  assert.deepEqual(lintBrief('1. `{mian}` is fine but {oops} is not'), ['unknown placeholder {oops} (not a rook.config.json value)']);
  const latest = existsSync(X) ? readdirSync(X).filter((f) => /^runs\d+$/.test(f)).sort((a, b) => a.slice(4) - b.slice(4)).pop() : null; // the newest runs<N>: no session number written here (retro39d)
  if (!latest) return; // CI has no runs folder
  const runs = join(X, latest);
  const briefs = readdirSync(runs).filter((f) => /^(b|rv|f)-.*\.txt$/.test(f));
  for (const f of briefs) assert.deepEqual(lintBrief(readFileSync(join(runs, f), 'utf8')), [], f);
});

// TODO 219b: a temp registry with a project R config; `runs` is the registry's folder, not the config's.
function hqWorld() {
  const dir = mkdtempSync(join(tmpdir(), 'hq-')).replaceAll('\\', '/'), r = `${dir}/R`;
  mkdirSync(r);
  const R = { name: 'Project R', slug: 'project-r', extras: 'E:/ignored', main: r, support: `${dir}/rsupport`, github: 'CableTable/project-r', test: 'npm run check', folders: { king: { review: 'R-king2', build: 'R-king' }, bishop: { review: 'R-b', build: 'R-b' }, knight: 'R-rowan' } };
  writeFileSync(`${r}/rook.config.json`, JSON.stringify(R));
  const hq = { projects: { D, R: r, B: `${dir}/none` }, runs: `${dir}/runs` };
  writeFileSync(`${dir}/hq.json`, JSON.stringify(hq));
  return { dir, r, hq, hqFile: `${dir}/hq.json` };
}

test('TODO 219b: projectFor gives a project\'s config with the registry\'s runs folder; an unknown name and a project without rook.config.json are refused', async () => {
  const { projectFor, projectNameOf, stripProjectFlag } = await P();
  const w = hqWorld();
  try {
    const r = projectFor('R', w.hq);
    assert.deepEqual([r.name, r.main, r.extras, r.test, r.github, r.folders.king.build, r.claudeProject], ['Project R', w.r, `${w.dir}/runs`, 'npm run check', 'CableTable/project-r', 'R-king', w.r.replace(/[^A-Za-z0-9]/g, '-')]);
    assert.equal(projectFor('D', w.hq).name, 'Project D'); // D = the config beside the tools
    assert.equal(projectFor('D', w.hq).extras, `${w.dir}/runs`);
    assert.throws(() => projectFor('Q', w.hq), /unknown project Q \(known: D, R, B\)/);
    assert.throws(() => projectFor('toString', w.hq), /unknown project toString/);
    assert.throws(() => projectFor('B', w.hq), /^Error: project B has no rook\.config\.json \(TODO 219e\)$/);
    assert.equal(projectNameOf(['node', 'rook.mjs', 'build']), 'D');
    assert.equal(projectNameOf(['node', 'rook.mjs', 'build', '--project', 'R', '--tool']), 'R');
    assert.equal(projectNameOf(['node', 'rook.mjs', 'build', '--project']), ''); // no name: refused as unknown
    const argv = ['node', 'rook.mjs', '--project', 'R', 'build', 'b.txt'];
    assert.deepEqual(stripProjectFlag(argv), ['node', 'rook.mjs', 'build', 'b.txt']);
  } finally { rmSync(w.dir, { recursive: true }); }
});

test('TODO 219b: the launcher run with --project R uses R\'s folders, test command, repo and runs folder; without the flag it is D (real child processes)', async () => {
  const w = hqWorld();
  try {
    const script = `${w.dir}/probe.mjs`, launch = pathToFileURL(join(KIT, 'rook-launch.mjs')).href;
    writeFileSync(script, `import * as L from '${launch}';
const launches = [];
const x = { git: (dir, ...a) => (a[0] === 'rev-parse' ? 'abc1234' + '0'.repeat(33) : ''), exists: () => true, locked: () => false, open: () => 'fd', queue: { open: () => null, set() {} }, launch: (...a) => launches.push(a), gate: { queueFile: () => L.EXTRAS + '/runs40/queue.txt' } };
console.log = () => {};
L.suite(['abc1234', '--over'], x);
process.stdout.write(JSON.stringify({ extras: L.EXTRAS, repo: L.REPO, accounts: L.ACCOUNTS, build: L.buildArgs(), board: L.boardArgs(), suite: launches[0].slice(1, 3) }));
`);
    const run = (...flags) => spawnSync(process.execPath, [script, ...flags], { encoding: 'utf8', env: { ...process.env, ROOK_HQ: w.hqFile } });
    const r = JSON.parse(run('--project', 'R').stdout);
    assert.equal(r.extras, `${w.dir}/runs`);
    assert.equal(r.repo, w.r);
    assert.deepEqual(r.accounts.king, { bin: 'claude3.cmd', review: 'R-king2', build: 'R-king' });
    assert.deepEqual(r.build.slice(r.build.indexOf('--add-dir'), r.build.indexOf('--add-dir') + 4), ['--add-dir', `${w.r}/.git`, '--add-dir', `${w.dir}/runs`]);
    assert.deepEqual(r.board.slice(r.board.indexOf('--add-dir')), ['--add-dir', `${w.dir}/runs`, '--add-dir', w.r, '--allowedTools', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(node:*)', '--disallowedTools', 'Agent']);
    assert.deepEqual(r.suite[0].slice(1), ['--project', 'R']); // rook-suite.mjs runs R's test command, in R's repo
    assert.equal(r.suite[0][0].replaceAll('\\', '/').endsWith('/kit/rook-suite.mjs'), true);
    assert.equal(r.suite[1], w.r);
    const d = JSON.parse(run().stdout);
    assert.deepEqual([d.extras, d.accounts.king.build, d.suite[0].length], [`${w.dir}/runs`, 'ProjectD-king', 1]);
    assert.equal(d.repo, process.cwd());
    const bad = run('--project', 'Q');
    assert.equal(bad.status, 1);
    assert.equal(bad.stderr.trim(), 'unknown project Q (known: D, R, B)'); // TODO 219c: one line, no stack trace
    const none = run('--project', 'B');
    assert.equal(none.status, 1);
    assert.equal(none.stderr.trim(), 'project B has no rook.config.json (TODO 219e)');
  } finally { rmSync(w.dir, { recursive: true }); }
});

test('TODO 219c: kit/project.mjs finds the project from ROOK_ROOT or the folder it runs in, never from its own folder (a copy elsewhere gives the same project)', () => {
  const w = hqWorld();
  try {
    mkdirSync(`${w.dir}/elsewhere`);
    copyFileSync(join(KIT, 'project.mjs'), `${w.dir}/elsewhere/project.mjs`);
    const probe = `${w.dir}/elsewhere/probe.mjs`;
    writeFileSync(probe, "import { ROOT, project } from './project.mjs'; process.stdout.write(JSON.stringify([ROOT, project.name, process.env.ROOK_ROOT]));");
    const run = (env, cwd) => JSON.parse(spawnSync(process.execPath, [probe], { cwd, encoding: 'utf8', env: { ...process.env, ROOK_ROOT: '', ROOK_HQ: w.hqFile, ...env } }).stdout);
    const root = resolve(w.r);
    assert.deepEqual(run({ ROOK_ROOT: w.r }, tmpdir()), [root, 'Project R', root]); // env wins, whatever the folder it runs in
    assert.deepEqual(run({}, w.r), [root, 'Project R', root]); // else the folder it runs in; children inherit the answer
  } finally { rmSync(w.dir, { recursive: true }); }
});

test('TODO 219b: a chained review runs for the build\'s project; D\'s job and review line stay as before; fresh allows --as bishop', async () => {
  const { finish } = await import('./rook-end.mjs').catch(() => assert.fail('kit/rook-end.mjs is missing')), { fresh } = await L();
  const reviews = [], x = { read: () => '', write() {}, git: () => 'def5678', review: (a) => reviews.push(a) };
  const review = { dir: '/wt', branch: 'br', base: 'abc1234', brief: '/b', out: '/o' };
  finish({ review }, 0, x);
  finish({ review, project: 'R' }, 0, x);
  assert.deepEqual(reviews, [['review', 'def5678', '/b', '/o', '--over'], ['review', 'def5678', '/b', '/o', '--over', '--project', 'R']]);
  const launches = [], f = { need() {}, locked: () => false, open: (p) => `fd:${p}`, queue: { open: () => null, set() {} }, launch: (...a) => launches.push(a), gate: { queueFile: () => `${X}/runs39/queue.txt` } };
  const log = console.log; console.log = () => {};
  try { fresh(['219b', '--as', 'bishop'], f); } finally { console.log = log; }
  assert.match(launches[0][0], /claude2\.cmd$/);
});
