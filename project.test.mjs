import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Dynamic imports: on a base without tools/project.mjs each test fails (red), not the whole file (a load error).
const P = () => import('./tools/project.mjs').catch(() => assert.fail('tools/project.mjs is missing'));
const L = () => import('./tools/rook-launch.mjs');

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
    const text = readFileSync(new URL(`./tools/briefs/${file}.txt`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /Project D|ProjectD|E:\/Project B|E--Project|npm\.cmd test|\b(TODO|DECISIONS|WORKFLOW)\.md/, file);
    assert.doesNotMatch(fillProject(text), /\{(project|extras|main|test|browserTest|claudeProject|kingBuild|todo|decisions|history|glossary|workflow)\}/, file);
  }
  assert.match(fillProject(readFileSync(new URL('./tools/briefs/retro.txt', import.meta.url), 'utf8')), new RegExp(`^Project D retro for session \\{N\\}.*${X}/runs\\{N\\}/`));
});

test('TODO 219a: a brief opened for reading is filled in place; a file without placeholders and a write open are left alone', async () => {
  const { openFilled } = await L();
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  try {
    const brief = join(dir, 'b.txt'), plain = join(dir, 'p.txt'), out = join(dir, 'o.txt');
    writeFileSync(brief, '{project}: run {test}\r\nrow in {todo} {ID}\r\n');
    writeFileSync(plain, 'nothing {to} fill\r\n');
    closeSync(openFilled(brief, 'r'));
    closeSync(openFilled(plain, 'r'));
    closeSync(openFilled(out, 'w'));
    assert.equal(readFileSync(brief, 'utf8'), 'Project D: run npm test\r\nrow in TODO.md {ID}\r\n');
    assert.equal(readFileSync(plain, 'utf8'), 'nothing {to} fill\r\n');
    assert.equal(readFileSync(out, 'utf8'), '');
  } finally { rmSync(dir, { recursive: true }); }
});
