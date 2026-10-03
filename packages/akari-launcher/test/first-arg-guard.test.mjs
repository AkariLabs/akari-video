import assert from 'node:assert/strict';
import test from 'node:test';

import { suggestFirstArgument } from '../src/first-arg-guard.mjs';
import { firstArgumentTypoError, nonInteractiveUninitializedGuidance } from '../src/messages.mjs';

const commands = ['capture', 'doctor', 'storyboard', 'decision-log', 'word-book'];
const forbiddenWords = /\b(?:Node|monorepo|PATH|env)\b/i;

for (const [input, suggestion] of [
  ['--help;', '--help'], ['--helpx', '--help'], ['--hepl', '--help'],
  ['-help', '--help'], ['--verison', '--version'], ['--version=1', '--version'],
  ['capure', 'capture'], ['doctr', 'doctor'], ['storybord', 'storyboard'],
  ['doctor;', 'doctor'], ['Doctor', 'doctor'],
]) {
  test(`第 1 引数 ${input} には ${suggestion} を候補に出す`, () => {
    assert.equal(suggestFirstArgument(input, commands), suggestion);
  });
}

for (const input of [
  '-', '--', '-p', '-y', '-c', '-r', '--resume', '--model', 'この動画を編集して', 'help',
  '--help', '-h', '--version', '-v', 'doctor', '動画を 編集して', 'doctor を',
]) {
  test(`第 1 引数 ${input} は素通しする`, () => {
    assert.equal(suggestFirstArgument(input, commands), null);
  });
}

test('新しい案内文に内部向けの語を含めない', () => {
  assert.doesNotMatch(firstArgumentTypoError('--hepl', '--help'), forbiddenWords);
  assert.doesNotMatch(nonInteractiveUninitializedGuidance(), forbiddenWords);
});
