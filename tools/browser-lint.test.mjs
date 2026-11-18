import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('retro38ck: prompt assertions use the shared said(re); direct reads may only decrease', () => {
  const source = readFileSync(new URL('../browser.test.mjs', import.meta.url), 'utf8');
  const count = [...source.matchAll(/assert\.\w+\(await prompt\(\)/g)].length;
  assert.ok(count <= 751, `${count} direct prompt assertions (limit 751): use said(re)`);
  assert.ok(/^const said = async \(re\)/m.test(source), 'use said(re) at file scope');
  assert.equal([...source.matchAll(/const said = async /g)].length, 1, 'use said(re) from file scope');
});

test('TODO 232: unwaited browser assertion reads may only decrease', () => {
  const source = readFileSync(new URL('../browser.test.mjs', import.meta.url), 'utf8');
  const count = source.split(/\r?\n/).filter((line) => /assert.*\(await .*\.(textContent|inputValue|isChecked)\(/.test(line)).length;
  const cap = 1326;
  assert.ok(count <= cap, `${count} unwaited browser assertion reads (cap ${cap}). For new reads use await expect(loc).toHaveText(...)-style waits. Lowering the cap is fine.`);
});
