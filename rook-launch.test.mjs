import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReview, parseKnight, reviewerArgs, knightArgs, commandLine } from './tools/rook-launch.mjs';

test('review arguments: three positionals, optional --from clone branch, a real commit id', () => {
  assert.deepEqual(parseReview(['abc1234', 'b.txt', 'r.jsonl']), { sha: 'abc1234', brief: 'b.txt', out: 'r.jsonl', from: null });
  assert.deepEqual(parseReview(['abc1234', 'b.txt', 'r.jsonl', '--from', 'C:/clone', 'king/x']).from, { clone: 'C:/clone', branch: 'king/x' });
  assert.throws(() => parseReview(['abc1234', 'b.txt']), /usage: review/);
  assert.throws(() => parseReview(['abc1234', 'b.txt', 'r.jsonl', '--from', 'C:/clone']), /usage: review/);
  assert.throws(() => parseReview(['--from', 'C:/clone', 'x', 'abc1234', 'b.txt', 'r.jsonl']), /usage: review/);
  assert.throws(() => parseReview(['HEAD', 'b.txt', 'r.jsonl']), /not a commit id/);
});

test('knight arguments: four positionals, report ends in .txt, log sits next to it', () => {
  assert.deepEqual(parseKnight(['b.txt', 'runs/k.txt', 'knight/x', 'abc1234']), { brief: 'b.txt', report: 'runs/k.txt', branch: 'knight/x', sha: 'abc1234', log: 'runs/k.log' });
  assert.throws(() => parseKnight(['b.txt', 'k.txt', 'knight/x']), /usage: knight/);
  assert.throws(() => parseKnight(['b.txt', 'k.md', 'knight/x', 'abc1234']), /must end in \.txt/);
  assert.throws(() => parseKnight(['b.txt', 'k.txt', 'knight/x', 'main']), /not a commit id/);
});

test('the reviewer command line has the WORKFLOW.md flags, the git denies and the extras folder', () => {
  const line = commandLine('claude2.cmd', reviewerArgs('E:/Project B/extras'));
  assert.equal(line, 'claude2.cmd -p --agent reviewer --model claude-opus-5-5 --effort medium --permission-mode dontAsk --max-budget-usd 6 '
    + '--add-dir "E:/Project B/extras" --disallowedTools Agent "Bash(git commit:*)" "Bash(git push:*)" "Bash(git add:*)" "Bash(git checkout:*)" '
    + '"Bash(git switch:*)" "Bash(git stash:*)" "Bash(git restore:*)" "Bash(git pull:*)" --output-format stream-json --verbose');
});

test('the Knight command line has the builder profile, its clone, the git folder and Playwright', () => {
  const line = commandLine('codex.cmd', knightArgs('E:/runs/k.txt', 'E:/x y/ProjectD-rowan', 'C:/Users/me'));
  assert.equal(line, 'codex.cmd exec -p builder -C "E:/x y/ProjectD-rowan" --add-dir "E:/x y/ProjectD-rowan-git" '
    + '--add-dir C:/Users/me/AppData/Local/ms-playwright -o E:/runs/k.txt -');
});

test('commandLine refuses a double quote', () => {
  assert.throws(() => commandLine('x', ['a"b']), /double quote/);
});
