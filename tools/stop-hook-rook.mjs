// The main-account (Rook) checks of tools/stop-hook.mjs (TODO 190a): pure, every read and git call is injected.
// Returns '' to let Rook stop, else the stderr text for exit 2. Any read that fails means no block.
import { project } from './project.mjs';
const EXTRAS = project.extras;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// read(path) -> text (throws when missing), exists(path) -> bool, git(...args) -> trimmed stdout (throws on failure)
export function rookStop(input, { read, exists, git, extras = EXTRAS }) {
  try { // (a) handover written but the next Rook's transcript is not there yet
    const uuid = read(`${extras}/rook-next.txt`).split(/\r?\n/)[0].trim();
    if (UUID.test(uuid) && uuid !== input.session_id && input.transcript_path
      && !exists(`${input.transcript_path.replace(/[\\/][^\\/]*$/, '')}/${uuid}.jsonl`)) return 'Handover written: start Rook.lnk (node tools/rook.mjs next)';
  } catch { /* unreadable: no block */ }
  try { // (f) suite green on a local-only head and no run going: push now
    const n = /^claude\/session(\d+)$/.exec(git('branch', '--show-current'))?.[1];
    if (!n) return '';
    const head = git('rev-parse', 'HEAD'), dir = `${extras}/runs${n}`;
    if (git('branch', '-r', '--contains', head)) return '';
    const logs = [head, head.slice(0, 7)].map((h) => { try { return read(`${dir}/suite-${h}.log`); } catch { return ''; } });
    const invalid = logs.some((l) => /^SUITE INVALID/m.test(l)), green = !invalid && logs.some((l) => /SUITE unit=0 browser=0/.test(l));
    if ((green || invalid) && !read(`${dir}/queue.txt`).includes(': running')) return green ? 'Suite green: push now (git push)' : `Suite invalid (HEAD moved during the run): rerun node tools/rook.mjs suite ${head}`;
  } catch { /* any read failing: no block */ }
  return '';
}
