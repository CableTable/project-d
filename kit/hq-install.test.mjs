import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Dynamic imports: on a base without kit/hq-install.mjs each test fails (red), not the whole file.
const H = () => import('./hq-install.mjs').catch(() => assert.fail('kit/hq-install.mjs is missing'));
const P = () => import('./project.mjs');
const KIT = fileURLToPath(new URL('.', import.meta.url));

// TODO 219d: a temp home, hq folder and staged kit/hq; nothing here touches the real home or rook-hq.
function world() {
  const dir = mkdtempSync(join(tmpdir(), 'hqi-')).replaceAll('\\', '/'), home = `${dir}/home`, hqDir = `${dir}/rook-hq`, D = `${dir}/D`;
  const kitHq = `${dir}/staged`;
  mkdirSync(kitHq);
  for (const f of ['WORKFLOW.md', 'global-CLAUDE.md', 'start-rook.ps1']) writeFileSync(`${kitHq}/${f}`, `staged ${f} {{HQ}} {{HQ_SLUG}} {{OLD_SLUG}} {{ADD_DIRS}}\n`);
  for (const a of ['.claude', '.claude-account2', '.claude-account3']) mkdirSync(`${home}/${a}`, { recursive: true });
  const mem = `${home}/.claude/projects/${D.replace(/[^A-Za-z0-9]/g, '-')}/memory`;
  mkdirSync(mem, { recursive: true });
  writeFileSync(`${mem}/a.md`, 'memory a');
  writeFileSync(`${mem}/b.md`, 'memory b');
  const hq = { projects: { D, R: `${dir}/R` }, runs: `${dir}/runs`, hq: hqDir, runsFrom: 41 };
  const lnks = [];
  // fake WScript.Shell: the "lnk" file holds its target / args / cwd as JSON, and its bytes differ on every save like a real one
  const lnk = (...a) => { lnks.push(a); mkdirSync(dirname(a[0]), { recursive: true }); writeFileSync(a[0], JSON.stringify({ target: a[1], args: a[2], cwd: a[3], n: lnks.length })); };
  const lnkRead = (f) => { if (!existsSync(f)) return null; const { target, args, cwd } = JSON.parse(readFileSync(f, 'utf8')); return { target, args, cwd }; };
  const run = (extra = {}) => { const out = []; const actions = H().then(({ hqInstall }) => hqInstall({ hq, kitHq, home, lnk, lnkRead, log: (m) => out.push(m), ...extra })); return actions.then((a) => ({ a, out })); };
  return { dir, home, hq, hqDir, kitHq, mem, lnks, run, slug: hqDir.replace(/[^A-Za-z0-9]/g, '-') };
}

test('TODO 219d: --dry prints every action and changes nothing', async () => {
  const w = world();
  try {
    const { a, out } = await w.run({ dry: true });
    assert.deepEqual(a, out.map((l) => l.replace(/^would /, '')));
    assert.ok(out.every((l) => l.startsWith('would ')), out.join('\n'));
    assert.match(out.join('\n'), /write .*rook-hq[\\/]WORKFLOW\.md/);
    assert.match(out.join('\n'), /write .*\.claude-account3[\\/]CLAUDE\.md/);
    assert.match(out.join('\n'), /copy memory .*: 2 new, 0 already there/);
    assert.match(out.join('\n'), /write .*Rook\.lnk/);
    assert.ok(!existsSync(w.hqDir), 'no rook-hq folder');
    assert.ok(!existsSync(`${w.home}/.claude/CLAUDE.md`));
    assert.equal(w.lnks.length, 0);
  } finally { rmSync(w.dir, { recursive: true }); }
});

test('TODO 219d: a real run copies the files, fills start-rook.ps1, writes the lnk args; a second run changes nothing', async () => {
  const w = world();
  try {
    await w.run();
    assert.equal(readFileSync(`${w.hqDir}/WORKFLOW.md`, 'utf8'), readFileSync(`${w.kitHq}/WORKFLOW.md`, 'utf8'));
    for (const a of ['.claude', '.claude-account2', '.claude-account3']) assert.equal(readFileSync(`${w.home}/${a}/CLAUDE.md`, 'utf8'), readFileSync(`${w.kitHq}/global-CLAUDE.md`, 'utf8'));
    const ps = readFileSync(`${w.hqDir}/start-rook.ps1`, 'utf8');
    assert.ok(ps.includes(`${w.hqDir} ${w.slug}`) && ps.includes(`--add-dir '${w.hq.projects.D}' --add-dir '${w.hq.projects.R}' --add-dir '${w.hq.runs}'`), ps); // every project + the old runs folder
    assert.ok(!/\{\{/.test(ps));
    assert.equal(readdirSync(`${w.home}/.claude/projects/${w.slug}/memory`).join(), 'a.md,b.md');
    assert.equal(w.lnks.length, 1);
    const [lnk, target, args, cwd] = w.lnks[0];
    assert.ok(lnk.endsWith('Startup\\Rook.lnk') || lnk.endsWith('Startup/Rook.lnk'));
    assert.match(target, /WindowsApps[\\/]wt\.exe$/);
    assert.equal(cwd, w.hqDir);
    assert.match(args, /^new-tab --title "Rook" -d ".*rook-hq" powershell -NoExit -ExecutionPolicy Bypass -File ".*start-rook\.ps1"$/);
    const { a, out } = await w.run(); // idempotent: equal files are left alone, no .bak, memory already there
    assert.ok(!a.some((l) => /^(write|backup)/.test(l)), a.join('\n')); // the lnk too: target, args and folder match, so it is not rewritten
    assert.equal(w.lnks.length, 1);
    assert.match(out.join('\n'), /copy memory .*: 0 new, 2 already there/);
    assert.ok(!existsSync(`${w.hqDir}/WORKFLOW.md.bak`) && !existsSync(`${w.home}/.claude/CLAUDE.md.bak`));
  } finally { rmSync(w.dir, { recursive: true }); }
});

test('TODO 219d: a different existing CLAUDE.md gets a .bak first and the first .bak is kept on later runs; an existing memory file is never overwritten; a missing account folder is skipped', async () => {
  const w = world();
  try {
    writeFileSync(`${w.home}/.claude/CLAUDE.md`, 'his old rules');
    mkdirSync(`${w.home}/.claude/projects/${w.slug}/memory`, { recursive: true });
    writeFileSync(`${w.home}/.claude/projects/${w.slug}/memory/a.md`, 'edited in rook-hq');
    rmSync(`${w.home}/.claude-account2`, { recursive: true });
    const { out } = await w.run();
    assert.equal(readFileSync(`${w.home}/.claude/CLAUDE.md.bak`, 'utf8'), 'his old rules');
    assert.equal(readFileSync(`${w.home}/.claude/CLAUDE.md`, 'utf8'), readFileSync(`${w.kitHq}/global-CLAUDE.md`, 'utf8'));
    assert.equal(readFileSync(`${w.home}/.claude/projects/${w.slug}/memory/a.md`, 'utf8'), 'edited in rook-hq');
    assert.equal(readFileSync(`${w.home}/.claude/projects/${w.slug}/memory/b.md`, 'utf8'), 'memory b');
    assert.match(out.join('\n'), /copy memory .*: 1 new, 1 already there/);
    assert.match(out.join('\n'), /skip .*\.claude-account2: no such folder/);
    assert.ok(!existsSync(`${w.home}/.claude-account2/CLAUDE.md`));
    writeFileSync(`${w.home}/.claude/CLAUDE.md`, 'edited again'); // a later run: the .bak stays the first one
    await w.run();
    assert.equal(readFileSync(`${w.home}/.claude/CLAUDE.md.bak`, 'utf8'), 'his old rules');
    assert.equal(readFileSync(`${w.home}/.claude/CLAUDE.md`, 'utf8'), readFileSync(`${w.kitHq}/global-CLAUDE.md`, 'utf8'));
    const stamped = () => readdirSync(`${w.home}/.claude`).filter((f) => /^CLAUDE\.md\.\d.*\.bak$/.test(f));
    assert.deepEqual(stamped().map((f) => readFileSync(`${w.home}/.claude/${f}`, 'utf8')), ['edited again'], 'the second edit is kept in a timestamped .bak');
    await new Promise((r) => setTimeout(r, 5));
    writeFileSync(`${w.hqDir}/WORKFLOW.md`, 'rook edit 1'); // Rook's edits of the HQ copy between installs: each round is kept
    await w.run();
    writeFileSync(`${w.hqDir}/WORKFLOW.md`, 'rook edit 2');
    await w.run();
    assert.equal(readFileSync(`${w.hqDir}/WORKFLOW.md.bak`, 'utf8'), 'rook edit 1');
    assert.deepEqual(readdirSync(w.hqDir).filter((f) => /^WORKFLOW\.md\.\d.*\.bak$/.test(f)).length, 1);
    await w.run(); // nothing changed since: no further backup
    assert.equal(readdirSync(w.hqDir).filter((f) => /\.bak$/.test(f) && f.startsWith('WORKFLOW')).length, 2);
  } finally { rmSync(w.dir, { recursive: true }); }
});

test('TODO 219d1 fix 2: Rook.lnk is backed up only when its target, arguments or folder differ; 3 runs give at most one .bak', async () => {
  const w = world();
  const startup = `${w.home}/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup`, baks = () => readdirSync(startup).filter((f) => /\.bak$/.test(f));
  try {
    await w.run(); // no lnk yet: written, nothing to back up
    assert.deepEqual(baks(), []);
    const good = JSON.parse(readFileSync(`${startup}/Rook.lnk`, 'utf8'));
    for (const [what, change] of [['target', { target: 'C:\\old\\wt.exe' }], ['args', { args: 'old args' }], ['folder', { cwd: 'C:\\old' }]]) {
      writeFileSync(`${startup}/Rook.lnk`, JSON.stringify({ ...good, ...change }));
      for (const f of readdirSync(startup)) if (f.endsWith('.bak')) rmSync(`${startup}/${f}`);
      for (let i = 0; i < 3; i++) await w.run();
      assert.equal(baks().length, 1, `${what} differs: one .bak over 3 runs`);
      assert.equal(JSON.parse(readFileSync(`${startup}/Rook.lnk`, 'utf8')).target, good.target, `${what}: the lnk is rewritten`);
    }
    const before = w.lnks.length;
    const { a } = await w.run();
    assert.equal(w.lnks.length, before, 'unchanged: no write');
    assert.ok(a.some((l) => /^same .*Rook\.lnk/.test(l)));
    writeFileSync(`${startup}/Rook.lnk`, JSON.stringify({ ...good, target: good.target.replaceAll('/', '\\').toUpperCase() })); // Windows hands back backslashes and its own case
    await w.run();
    assert.equal(w.lnks.length, before, 'slash and case differences are not a change');
  } finally { rmSync(w.dir, { recursive: true }); }
});

test('TODO 219d: the memory copy takes files only: a subfolder is skipped, not a crash', async () => {
  const w = world();
  try {
    mkdirSync(`${w.mem}/sub`);
    writeFileSync(`${w.mem}/sub/c.md`, 'in a folder');
    const { out } = await w.run();
    assert.equal(readdirSync(`${w.home}/.claude/projects/${w.slug}/memory`).join(), 'a.md,b.md');
    assert.match(out.join('\n'), /copy memory .*: 2 new, 0 already there/);
  } finally { rmSync(w.dir, { recursive: true }); }
});

test('TODO 219d: a hq.json without "hq" is refused', async () => {
  const { hqInstall } = await H();
  assert.throws(() => hqInstall({ hq: { projects: {}, runs: 'x' } }), /no "hq" folder/);
});

test('TODO 219d: the runs folder and Rook\'s transcript folder are the old ones before session 41 and rook-hq from 41; no rook-next.txt = old', async () => {
  const { projectFor, sessionOf, inHq } = await P();
  const w = world();
  try {
    mkdirSync(w.hq.projects.R);
    writeFileSync(`${w.hq.projects.R}/rook.config.json`, JSON.stringify({ name: 'R', slug: 'r', extras: 'x', main: w.hq.projects.R, support: 's', github: 'a/b', folders: { king: {}, bishop: {} } }));
    const next = (n) => `uuid\nRook S${n}\n${w.hq.runs}/runs${n}/resume-rook.txt\n`;
    const oldSlug = w.hq.projects.R.replace(/[^A-Za-z0-9]/g, '-');
    assert.equal(sessionOf(next(40)), 40);
    assert.equal(sessionOf(''), 0);
    assert.equal(sessionOf(undefined), 0);
    const at = (text) => projectFor('R', w.hq, text);
    for (const text of [next(40), next(1), '', 'garbage']) assert.deepEqual([at(text).extras, at(text).claudeProject], [w.hq.runs, oldSlug], text);
    for (const n of [41, 42, 100]) assert.deepEqual([at(next(n)).extras, at(next(n)).claudeProject, at(next(n)).pointer], [w.hqDir, w.slug, w.hq.runs], String(n));
    assert.equal(inHq({ ...w.hq, runsFrom: 50 }, 49), false);
    assert.equal(inHq({ ...w.hq, runsFrom: undefined }, 41), true); // default 41
    assert.equal(inHq({ runs: 'x' }, 99), false); // no "hq" key: never
    assert.equal(projectFor('R', w.hq).extras, w.hq.runs); // the default text comes from <runs>/rook-next.txt: missing -> old
    mkdirSync(w.hq.runs);
    writeFileSync(`${w.hq.runs}/rook-next.txt`, next(41));
    assert.equal(projectFor('R', w.hq).extras, w.hqDir);
  } finally { rmSync(w.dir, { recursive: true }); }
});

test('TODO 219d: handover writes rook-next.txt into "runs" and, whenever hq.hq is set (session 40 too), into "hq"; no "hq" key: only the old folder', async () => {
  const { handover } = await import('./rook.mjs');
  const w = world();
  try {
    const skills = 'First action: mattpocock-skills:grilling AND mattpocock-skills:domain-modeling';
    const needs = 'read merge-due.log\nselect:Monitor,TaskStop\none ci-watch per push\n';
    const resume = (n) => { mkdirSync(`${w.hq.runs}/runs${n}`, { recursive: true }); const f = `${w.hq.runs}/runs${n}/resume-rook.txt`; writeFileSync(f, `Rook S${n}\n${skills}\n${needs}`); return f; };
    handover(resume(40), 'Rook S40', w.hq.runs, 'u-40', true, w.hq);
    for (const dir of [w.hq.runs, w.hqDir]) assert.equal(readFileSync(`${dir}/rook-next.txt`, 'utf8').split('\n')[0], 'u-40', 'session 40 feeds rook-hq too (the new Rook.lnk reads only there)');
    const { hq: _unset, ...noHq } = w.hq, old = `${w.dir}/old-runs`;
    mkdirSync(`${old}/runs40`, { recursive: true });
    const f = `${old}/runs40/resume-rook.txt`;
    writeFileSync(f, `Rook S40\n${skills}\n${needs}`);
    handover(f, 'Rook S40', old, 'u-old', true, noHq);
    assert.ok(existsSync(`${old}/rook-next.txt`) && readFileSync(`${w.hqDir}/rook-next.txt`, 'utf8').split('\n')[0] === 'u-40', 'no hq.hq: rook-hq untouched');
    handover(resume(41), 'Rook S41', w.hq.runs, 'u-41', true, w.hq); // the 40 -> 41 handover runs in the old folder and still feeds rook-hq
    for (const dir of [w.hq.runs, w.hqDir]) assert.equal(readFileSync(`${dir}/rook-next.txt`, 'utf8').split('\n')[0], 'u-41');
    handover(resume(42), 'Rook S42', w.hqDir, 'u-42', true, w.hq); // a Rook in rook-hq: its own folder and the pointer in "runs"
    for (const dir of [w.hq.runs, w.hqDir]) assert.equal(readFileSync(`${dir}/rook-next.txt`, 'utf8').split('\n')[0], 'u-42');
  } finally { rmSync(w.dir, { recursive: true }); }
});

test('TODO 219d1: key rules of the old single WORKFLOW.md (37a35b3) are in D\'s file or the hq file after the split', async () => {
  const { ROOT } = await P(); // the project's checkout, also when this kit folder is a copy elsewhere
  const both = [join(ROOT, 'WORKFLOW.md'), join(KIT, 'hq', 'WORKFLOW.md')].map((f) => readFileSync(f, 'utf8')).join('\n').toLowerCase();
  const phrases = ['real failure', 'seen twice', 'ponytail-debt', 'worked value', 'trial moves', 'over 70', '140k', 'Open bugs checked', 'way in', 'audit',
    'pr` skill', 'one background script', 'rate_limit_event', 'cache write', 'checks the new uuid', 'overruled fix first', 'lows.txt', 'rook-gate.json', 'no review:', 'wip todo', 'tell him once',
    // fix 2: the rules review 2 found missing, then a rule-by-rule pass over the old file
    'never by `sed` on another script', 'print it (`head`)', 'never FETCH_HEAD', '`switch -c <branch> <sha>`', 'never with `--dangerously-skip-permissions`', 'small lookups (one grep', 'one tool family or one command',
    'never piped into grep', '`replace_all` for a rename', '`reviewer.md` step 3 names', 'must be HEAD', 'the next Rook reads its `.out` first', 'no placeholder commands', 'report quotes that FAIL', 'Rook lists the ones it recommends',
    'recommendation', 'only paths inside a brief'];
  for (const p of phrases) assert.ok(both.includes(p.toLowerCase()), `"${p}" is in neither WORKFLOW.md`);
});

test('TODO 219d: every `node tools/rook.mjs <verb>` the staged WORKFLOW.md names exists in kit/rook.mjs; the three staged files exist and the global rules carry the house lines', () => {
  const rook = readFileSync(join(KIT, 'rook.mjs'), 'utf8');
  const text = readFileSync(join(KIT, 'hq', 'WORKFLOW.md'), 'utf8');
  const verbs = [...new Set([...text.matchAll(/rook\.mjs ([a-z][a-z-]*)/g)].map((m) => m[1]))];
  assert.ok(verbs.length >= 15, verbs.join());
  for (const verb of verbs) assert.ok(rook.includes(`node tools/rook.mjs ${verb}`), `${verb}: not in kit/rook.mjs`);
  for (const f of ['WORKFLOW.md', 'global-CLAUDE.md', 'start-rook.ps1']) assert.ok(existsSync(join(KIT, 'hq', f)), f);
  const globalText = readFileSync(join(KIT, 'hq', 'global-CLAUDE.md'), 'utf8');
  for (const need of ['`', 'IST', 'No admin', 'plain text', 'passwords']) assert.ok(globalText.includes(need), need);
});
