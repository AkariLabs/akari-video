import assert from 'node:assert/strict';
import test from 'node:test';
import { setLanguage } from '../../i18n/index.mjs';
import { runMediaCli } from '../bin/media.mjs';
import { buildCaptionsFromTranscript } from '../src/captions/build.mjs';
import { WHISPER_FILLER_PROMPT, transcribeMedia, whisperArguments } from '../src/media/transcribe.mjs';
import { fixture } from './fixtures/transcribe-compare/helpers.mjs';
import { toolsText } from '../src/i18n.mjs';

test('English media errors and caption warnings', async () => {
  setLanguage('en');
  try {
    const errors = [];
    assert.equal(await runMediaCli(['transcribe'], { stderr: (line) => errors.push(line) }), 1);
    assert.equal(errors[0], 'transcribe: target is required');
    const result = buildCaptionsFromTranscript([
      { start: 0, end: 0.2, text: 'Hi', words: [{ start: 0, end: 0.2, text: 'Hi' }] },
      { start: 0.3, end: 0.5, text: 'There', words: [{ start: 0.3, end: 0.5, text: 'There' }] },
    ]);
    assert.ok(result.warnings.some((line) => /display time is shorter than 1s/u.test(line)));
  } finally { setLanguage(undefined); }
});

test('custom and default whisper prompts are forwarded', () => {
  assert.deepEqual(whisperArguments('model', 'input', 'ja', 'out', { whisperPrompt: 'Keep this term' }).slice(-2),
    ['--prompt', 'Keep this term']);
  assert.deepEqual(whisperArguments('model', 'input', 'en', 'out', { whisperPrompt: true }).slice(-2),
    ['--prompt', WHISPER_FILLER_PROMPT]);
});

test('transcribe help lists both prompt flags in Japanese and English', async () => {
  for (const language of ['ja', 'en']) {
    setLanguage(language);
    try {
      const output = [];
      assert.equal(await runMediaCli(['transcribe', '--help'], { stdout: (line) => output.push(line) }), 0);
      assert.match(output[0], /--whisper-prompt <text>/u);
      assert.match(output[0], /--keep-fillers/u);
    } finally { setLanguage(undefined); }
  }
});

test('missing whisper model reports an English error even for Japanese project content', async (t) => {
  const f = await fixture(t, []);
  setLanguage('en');
  try {
    await assert.rejects(transcribeMedia(f.target, {
      ...f.options, backend: 'whisper-cpp', lang: 'ja', whisperAvailable: false,
      noRecord: true,
    }), /whisper\.cpp executable or model not found/u);
  } finally { setLanguage(undefined); }
});

test('media transcribe flags select the default or custom whisper prompt', async (t) => {
  const f = await fixture(t, []);
  const output = [];
  const options = { ...f.options, whisperBin: 'fixture-whisper', whisperModel: 'fixture-model',
    backendRunner: async () => [{ start: 0, end: 1, text: 'Um' }],
    unrecognized: false, noRecord: true, stdout: (line) => output.push(JSON.parse(line)) };
  assert.equal(await runMediaCli(['transcribe', f.target, '--backend', 'whisper-cpp', '--lang', 'en', '--keep-fillers'], options), 0);
  assert.match(output.at(-1).cache.key, /-filler-prompt-words3$/u);
  assert.equal(await runMediaCli(['transcribe', f.target, '--backend', 'whisper-cpp', '--lang', 'en', '--whisper-prompt', 'Keep ums'], options), 0);
  assert.match(output.at(-1).cache.key, /-prompt-[a-f0-9]{12}-words3$/u);
});

test('English content language keeps a Japanese missing-model error under Japanese UI', async (t) => {
  const f = await fixture(t, []);
  setLanguage('ja');
  try {
    const errors = [];
    const code = await runMediaCli(['transcribe', f.target, '--backend', 'whisper-cpp', '--lang', 'en'], {
      ...f.options, whisperAvailable: false, stderr: (line) => errors.push(line), noRecord: true,
    });
    assert.equal(code, 1);
    assert.match(errors.join('\n'), /whisper\.cpp の実行ファイルまたはモデルが見つかりません/u);
  } finally { setLanguage(undefined); }
});

test('tool count labels select the correct plural form', () => {
  setLanguage('en');
  try {
    assert.equal(toolsText('tools.transcribe.notice.wordBookReplaced', { count: 1, n: 1, layers: 'project' }),
      'Word book: replaced 1 word (layers: project)');
    assert.equal(toolsText('tools.transcribe.notice.wordBookReplaced', { count: 2, n: 2, layers: 'project' }),
      'Word book: replaced 2 words (layers: project)');
  } finally { setLanguage(undefined); }
});
