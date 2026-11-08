// TODO 219d: `node tools/rook.mjs hq-install [--dry]` copies the staged hq files (kit/hq/) out to Rook HQ (hq.json "hq") and the three Claude accounts.
// Copies only (a symlink needs admin or Developer Mode), no admin, idempotent: a file already equal is left alone, a different one gets a `.bak` first (an older .bak is never overwritten: a later backup that differs gets a timestamped name).
//   kit/hq/WORKFLOW.md + global-CLAUDE.md          -> <hq>/ ; global-CLAUDE.md also -> CLAUDE.md in ~/.claude, ~/.claude-account2, ~/.claude-account3 (a missing account folder is skipped)
//   kit/hq/start-rook.ps1 ({{...}} filled)         -> <hq>/start-rook.ps1
//   Rook's memory (project D's folder)             -> the <hq> project's memory folder, files already there are skipped, subfolders are not copied
//   Rook.lnk in the Startup folder (WScript.Shell) -> wt.exe tab in <hq> running <hq>/start-rook.ps1; left alone (no .bak) when its target, arguments and folder already match
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeSlug } from './project.mjs';

export const ACCOUNT_DIRS = ['.claude', '.claude-account2', '.claude-account3'];
export const KIT_HQ = join(dirname(fileURLToPath(import.meta.url)), 'hq');

// WScript.Shell writes the shortcut; the values go in by env so no quoting reaches PowerShell.
export function writeLnk(lnk, target, args, cwd, run = spawnSync) {
  const script = '$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK_PATH);$s.TargetPath=$env:LNK_TARGET;$s.Arguments=$env:LNK_ARGS;$s.WorkingDirectory=$env:LNK_CWD;$s.Save()';
  const r = run('powershell.exe', ['-NoProfile', '-Command', script], { env: { ...process.env, LNK_PATH: lnk, LNK_TARGET: target, LNK_ARGS: args, LNK_CWD: cwd }, encoding: 'utf8', windowsHide: true });
  if (r.error || r.status) throw new Error(`Rook.lnk not written: ${r.error?.message || String(r.stderr).trim().split(/\r?\n/)[0] || `exit ${r.status}`}`);
}

// The shortcut as {target, args, cwd}, or null when there is none.
export function readLnk(lnk, run = spawnSync) {
  if (!existsSync(lnk)) return null;
  const script = '$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK_PATH);[pscustomobject]@{target=$s.TargetPath;args=$s.Arguments;cwd=$s.WorkingDirectory}|ConvertTo-Json -Compress';
  const r = run('powershell.exe', ['-NoProfile', '-Command', script], { env: { ...process.env, LNK_PATH: lnk }, encoding: 'utf8', windowsHide: true });
  if (r.error || r.status) throw new Error(`Rook.lnk not read: ${r.error?.message || String(r.stderr).trim().split(/\r?\n/)[0] || `exit ${r.status}`}`);
  return JSON.parse(r.stdout);
}

// hq = the hq.json object. Everything lives under `home` (tests pass a temp one). Returns the list of actions (also sent to `log`); `dry` changes nothing.
export function hqInstall({ hq, kitHq = KIT_HQ, home = homedir(), dry = false, lnk = writeLnk, lnkRead = readLnk, log = console.log } = {}) {
  if (!hq?.hq) throw new Error('hq.json has no "hq" folder');
  const actions = [], say = (m) => { actions.push(m); log((dry ? 'would ' : '') + m); };
  // The first backup is `<dst>.bak`; later ones that differ from it get a timestamped name, one that equals it needs none (review of 219d1: Rook edits the HQ files between installs).
  const bakFor = (dst) => {
    if (!existsSync(dst)) return null;
    const bak = `${dst}.bak`;
    if (!existsSync(bak)) return bak;
    return readFileSync(bak).equals(readFileSync(dst)) ? null : `${dst}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
  };
  const put = (content, dst) => {
    if (existsSync(dst) && readFileSync(dst).equals(Buffer.from(content))) return say(`same ${dst}`);
    const bak = bakFor(dst);
    if (bak) say(`backup ${dst} -> ${bak}`);
    say(`write ${dst}`);
    if (dry) return;
    mkdirSync(dirname(dst), { recursive: true });
    if (bak) copyFileSync(dst, bak);
    writeFileSync(dst, content);
  };
  const staged = (name) => readFileSync(join(kitHq, name));
  const global = staged('global-CLAUDE.md');
  put(staged('WORKFLOW.md'), join(hq.hq, 'WORKFLOW.md'));
  put(global, join(hq.hq, 'global-CLAUDE.md'));
  for (const a of ACCOUNT_DIRS) existsSync(join(home, a)) ? put(global, join(home, a, 'CLAUDE.md')) : say(`skip ${join(home, a)}: no such folder`);
  const addDirs = [...Object.values(hq.projects), hq.runs].map((d) => `--add-dir '${d}'`).join(' ');
  const script = String(staged('start-rook.ps1')).replace(/\{\{(\w+)\}\}/g, (all, k) => ({ HQ: hq.hq, ADD_DIRS: addDirs, HQ_SLUG: claudeSlug(hq.hq), OLD_CWD: hq.projects.D, OLD_SLUG: claudeSlug(hq.projects.D) })[k] ?? all);
  put(script, join(hq.hq, 'start-rook.ps1'));
  const memFrom = join(home, '.claude', 'projects', claudeSlug(hq.projects.D), 'memory'), memTo = join(home, '.claude', 'projects', claudeSlug(hq.hq), 'memory');
  const files = existsSync(memFrom) ? readdirSync(memFrom, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name) : [], fresh = files.filter((f) => !existsSync(join(memTo, f)));
  say(`copy memory ${memFrom} -> ${memTo}: ${fresh.length} new, ${files.length - fresh.length} already there`);
  if (!dry) { mkdirSync(memTo, { recursive: true }); for (const f of fresh) copyFileSync(join(memFrom, f), join(memTo, f)); }
  const startup = join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Rook.lnk'), wt = join(home, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'wt.exe');
  const args = `new-tab --title "Rook" -d "${hq.hq}" powershell -NoExit -ExecutionPolicy Bypass -File "${join(hq.hq, 'start-rook.ps1')}"`, norm = (s) => String(s).replaceAll('/', '\\').toLowerCase();
  const have = lnkRead(startup); // a lnk's bytes differ on every save: compare what it opens, and back up only when that changes
  if (have && norm(have.target) === norm(wt) && have.args === args && norm(have.cwd) === norm(hq.hq)) { say(`same ${startup}`); return actions; }
  const bak = bakFor(startup);
  if (bak) say(`backup ${startup} -> ${bak}`);
  say(`write ${startup} (wt.exe tab in ${hq.hq}, ${Object.keys(hq.projects).length} projects + runs as --add-dir)`);
  if (!dry) {
    if (bak) copyFileSync(startup, bak);
    lnk(startup, wt, args, hq.hq);
  }
  return actions;
}
