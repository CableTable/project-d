// Guard (TODO 184): commit() answers false when the result is too nested to draw, so every call must use its answer.
// A bare `commit(...);` statement (nothing before it but a line start, `;`, `{`, `}`, `)` or `else`) goes on as if it had worked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

/** The `file:line` of every commit( or layGripCommit( call (its Layout twin) whose result is dropped. */
export function bareCommits(src, file) {
  const out = [];
  for (const m of src.matchAll(/\b(?:commit|layGripCommit)\(/g)) {
    const before = src.slice(0, m.index).replace(/\s+$/, '');
    if (/function$/.test(before)) continue;       // the definition
    if (before === '' || /(?:[;{})]|\belse)$/.test(before)) out.push(`${file}:${src.slice(0, m.index).split('\n').length}`);
  }
  return out;
}

test('every commit( call in web/ uses its result', () => {
  const bare = readdirSync('web').filter((f) => f.endsWith('.js')).flatMap((f) => bareCommits(readFileSync('web/' + f, 'utf8'), 'web/' + f));
  assert.deepEqual(bare, [], 'commit( result ignored at ' + bare.join(', '));
});

test('the guard sees a bare call and lets the checked ones pass', () => {
  assert.deepEqual(bareCommits('a();\n  commit(d, x);', 'f'), ['f:2']);
  assert.deepEqual(bareCommits('if (x) commit(d, x);', 'f'), ['f:1']);
  assert.deepEqual(bareCommits('if (a) y(); else commit(d, x);', 'f'), ['f:1']);
  assert.deepEqual(bareCommits('a();\n  layGripCommit(d, x);', 'f'), ['f:2']);
  assert.deepEqual(bareCommits('if (!layGripCommit(d, x)) return;\nconst ok = d.v ? layGripCommit(d, y) : commit(d, z);\nfunction layGripCommit(v) {}', 'f'), []);
  assert.deepEqual(bareCommits('if (!commit(d, x)) return;\nconst ok = commit(d, y);\nreturn commit(d, z);\nfunction commit(d, n) {}', 'f'), []);
});
