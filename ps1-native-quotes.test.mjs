import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';

function nativeQuoteLines(source) {
  const lines = source.replace(/`\r?\n\s*/g, ' ').split(/\r?\n/).filter((line) => !/^\s*#/.test(line));
  const tainted = new Set();
  const hasQuote = (text) => [...text.matchAll(/'(?:''|[^'])*'|"(?:`[\s\S]|""|[^"`])*"/g)]
    .some(([s]) => s[0] === "'" ? s.includes('"') : /`"|""/.test(s.slice(1, -1))) || /\[char\]\s*34\b/i.test(text);
  const unsafe = (text) => hasQuote(text) || [...text.matchAll(/\$(\w+)/g)].some(([, name]) => tainted.has(name.toLowerCase()));
  // shortcut: direct native calls and variable assignments only; use an AST if scripts start constructing commands dynamically.
  for (let size = -1; size !== tainted.size;) {
    size = tainted.size;
    for (const line of lines) {
      const assignment = line.match(/^\s*\$(\w+)\s*=\s*(.*)/);
      if (assignment && unsafe(assignment[2])) tainted.add(assignment[1].toLowerCase());
    }
  }
  return lines.filter((line) => {
    const call = line.match(/(?:^|[;|(=])\s*(?:&\s+(?:\$[\w:]+|'[^']*'|"[^"]*"|\S+)|[\w.\\/:\-]+\.exe|\w+)\s+(.+)/i);
    return call && !/^\s*(?:if|elseif|else|foreach|for|while|switch|return|throw|exit|function|param)\b/i.test(call[0]) && unsafe(call[1]);
  });
}

test('tools PowerShell scripts never pass embedded double quotes to native executables (PS 5.1)', () => {
  assert.equal(nativeQuoteLines(`$task = '"node.exe" "agent.mjs"'\nschtasks.exe /Create /TR $task`).length, 1);
  assert.equal(nativeQuoteLines('& $node -e \'console.log("broken")\'').length, 1);
  assert.equal(nativeQuoteLines('& node.exe "say `"hello`""').length, 1);
  assert.equal(nativeQuoteLines('git commit -m \'Fix "usage"\'').length, 1);
  assert.deepEqual(nativeQuoteLines('$shortcut.Arguments = \'"node.exe" "agent.mjs"\'\n& $node --version'), []);
  for (const file of readdirSync(new URL('./tools/', import.meta.url)).filter((f) => f.endsWith('.ps1'))) {
    assert.deepEqual(nativeQuoteLines(readFileSync(new URL('./tools/' + file, import.meta.url), 'utf8')), [], `${file}: pass quote-bearing arguments through a script/file instead`);
  }
});
