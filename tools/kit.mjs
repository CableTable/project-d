// TODO 219c: the one resolver for the Rook kit (the generic tools, kit/): hq.json "kit" (an absolute folder that exists) wins, else <this repo>/kit.
// The kit finds the project from ROOK_ROOT (kit/project.mjs), which this file sets to the checkout it sits in.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
process.env.ROOK_ROOT = ROOT;
const HQ = process.env.ROOK_HQ || join(ROOT, 'hq.json');

// TODO 219e1: hq.json "kit" counts only while that folder exists (rook.mjs local-init KIT writes it after the copy); otherwise <repo>/kit.
export const kitDir = (hq, root = ROOT, exists = existsSync) => (hq?.kit && exists(hq.kit) ? hq.kit : join(root, 'kit'));
const hqData = existsSync(HQ) ? JSON.parse(readFileSync(HQ, 'utf8')) : null;
if (hqData?.kit && !existsSync(hqData.kit)) console.error(`kit: hq.json "kit" folder ${hqData.kit} does not exist, using ${join(ROOT, 'kit')}`); // once per process: a typo must not run the stale in-repo kit silently
export const KIT = kitDir(hqData);
export const kitFile = (name) => join(KIT, name);
export const kitUrl = (name) => pathToFileURL(kitFile(name)).href;

// What a shim runs: the arguments to run a kit file with `args`, same arguments after it (.sh runs under `bash`, which runKit gives as Git Bash).
export const kitCommand = (name, args, bash = 'bash') => (name.endsWith('.sh') ? [bash, [kitFile(name), ...args]] : [process.execPath, [kitFile(name), ...args]]);

// The shims (tools/rook.mjs, base-check.mjs, ci-watch.sh, the hooks) call this: the kit's file with the same arguments, stdin and exit code.
// A missing kit file is one line and exit 1; `hook` shims exit 0 instead (a hook must not block a session).
export async function runKit(name, args = process.argv.slice(2), hook = false) {
  if (!existsSync(kitFile(name))) { console.error(`${name}: not found in the kit folder ${KIT} (hq.json "kit")`); process.exit(hook ? 0 : 1); }
  const [bin, argv] = kitCommand(name, args, name.endsWith('.sh') ? (await import(kitUrl('rook.mjs'))).gitBash() : undefined); // Git Bash, not the WSL bash PATH may find first
  const r = spawnSync(bin, argv, { stdio: 'inherit' });
  if (r.error) console.error(`${name}: ${r.error.message}`);
  process.exit(r.status ?? 1);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) runKit(process.argv[2], process.argv.slice(3));
