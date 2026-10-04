import assert from 'node:assert/strict';
import test from 'node:test';

import { suggestFirstArgument } from '../src/first-arg-guard.mjs';
import { firstArgumentTypoError, nonInteractiveUninitializedGuidance } from '../src/messages.mjs';

const flags = ['--help', '-h', '--version', '-v'];
const commands = [
  'new', 'init', 'clean', 'store', 'world', 'media', 'voice', 'status', 'doctor',
  'capture', 'storyboard', 'update', 'decision-log', 'word-book',
];
const forbiddenWords = /\b(?:Node|monorepo|PATH|env)\b/i;
const suggest = (input, orderedFlags = flags) => suggestFirstArgument(input, { flags: orderedFlags, commands });

for (const [input, suggestion] of [
  ['--help;', '--help'], ['--helpx', '--help'], ['--hepl', '--help'],
  ['-help', '--help'], ['--verison', '--version'], ['--version=1', '--version'],
  ['capure', 'capture'], ['doctr', 'doctor'], ['storybord', 'storyboard'],
  ['doctor;', 'doctor'], ['Doctor', 'doctor'],
]) {
  test(`第 1 引数 ${input} には ${suggestion} を候補に出す`, () => {
    assert.equal(suggest(input), suggestion);
  });
}

for (const [input, suggestion] of [
  ['clen', 'clean'], ['int', 'init'], ['stats', 'status'],
  ['doct', 'doctor'], ['stoybord', 'storyboard'],
  ['doctor ', 'doctor'], ['doctor\r', 'doctor'], ['doctr\r\n', 'doctor'],
  ['--help ', '--help'], ['-h\r', '-h'],
]) {
  test(`第 1 引数 ${JSON.stringify(input)} には ${suggestion} を候補に出す`, () => {
    assert.equal(suggest(input), suggestion);
  });
}

for (const input of [
  '-', '--', '-p', '-y', '-c', '-r', '--resume', '--model', 'この動画を編集して', 'help',
  '--help', '-h', '--version', '-v', 'doctor', '動画を 編集して', 'doctor を',
  'start', 'stop', 'edit', 'exit', 'quit', 'info', 'git', 'in', 'it', 'plan', 'work',
  'meta', 'mcp', 'config', 'install', 'plugin', 'doc', 'ne', ' ', 'hello ',
]) {
  test(`第 1 引数 ${input} は素通しする`, () => {
    assert.equal(suggest(input), null);
  });
}

test('フラグの並び順を変えても候補は同じ', () => {
  assert.equal(suggest('--help;', [...flags].reverse()), '--help');
  assert.equal(suggest('-hx', [...flags].reverse()), '-h');
});

test('新しい案内文に内部向けの語を含めない', () => {
  const typo = firstArgumentTypoError('--hepl', '--help');
  assert.match(typo, /akari -- /);
  assert.doesNotMatch(typo, forbiddenWords);
  const withCarriageReturn = firstArgumentTypoError('doctor\r', 'doctor');
  assert.doesNotMatch(withCarriageReturn, /\r/);
  assert.match(withCarriageReturn, /doctor\\r/);
  const withControls = firstArgumentTypoError('doctor\r\n\t', 'doctor');
  assert.equal(withControls.split('\n').length, 2);
  assert.doesNotMatch(withControls, /\r|\t/);
  assert.match(withControls, /doctor\\r\\n\\t/);
  assert.doesNotMatch(nonInteractiveUninitializedGuidance(), forbiddenWords);
});
