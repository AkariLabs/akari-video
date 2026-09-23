import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compareNarrationText, normalizeVerifyText, runNarrationCommand, verifyLanguage } from '../src/narration-command.mjs';

const collect = () => { const lines = []; return { lines, log: line => lines.push(line), logError: () => {} }; };

test('NFKC、句読点・記号・空白除去、英字小文字化', () => {
  assert.equal(normalizeVerifyText(' ＡＢＣ、 １２！　カナ-'), 'abc12カナ');
});

test('CLI 起動時に akari-tools を静的 import しない', async () => {
  const source = await readFile(new URL('../src/narration-command.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import\s+.*akari-tools/m);
  assert.match(source, /await import\(pathToFileURL\(modulePath\)\.href\)/);
});

test('期待文が日本語を含むと ja、英語・数字だけなら auto', () => {
  for (const text of ['なかじま', 'カタカナ', '漢字', 'ｶﾀｶﾅ', 'AKARI 漢字']) assert.equal(verifyLanguage(text), 'ja');
  for (const text of ['AKARI Video', '123, ABC', '']) assert.equal(verifyLanguage(text), 'auto');
});

test('文字単位の一致率と連続した差分を復元する', () => {
  const exact = compareNarrationText('こんにちは。', 'こんにちは');
  assert.deepEqual(exact, { score: 1, verdict: 'ok', diffs: [] });
  const mismatch = compareNarrationText('こんにちはなかじまりょうまです', 'こんにちは中島良馬です');
  assert.equal(mismatch.verdict, 'ng');
  assert.deepEqual(mismatch.diffs, [{ expected: 'なかじまりょうま', heard: '中島良馬' }]);
  assert.deepEqual(compareNarrationText('AB', 'A').diffs, [{ expected: 'b', heard: '' }]);
  assert.deepEqual(compareNarrationText('A', 'AB').diffs, [{ expected: '', heard: 'b' }]);
});

test('verdict の境界は 0.9 / 0.7', () => {
  assert.equal(compareNarrationText('abcdefghij', 'abcdefghiX').verdict, 'ok');
  assert.equal(compareNarrationText('abcdefghij', 'abcdefgXYZ').verdict, 'check');
  assert.equal(compareNarrationText('abcdefghij', 'abcdefWXYZ').verdict, 'ng');
});

test('backend 無しは exit 3 と理由付き unavailable', async () => {
  const output = collect();
  const result = await runNarrationCommand(['verify', '--project', '.', '--check-backend', '--json'], {
    ...output, verifyRuntime: { speechAnalyzerAvailable: () => false, resolveWhisper: () => null }
  });
  assert.equal(result.exitCode, 3);
  assert.equal(JSON.parse(output.lines[0]).status, 'unavailable');
  assert.match(JSON.parse(output.lines[0]).reason, /backend/);
});

test('transcribe モジュールが無い場合、verify と --check-backend は exit 3 unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-verify-missing-'));
  try {
    for (const extra of [['--check-backend'], ['--audio', 'unused.wav', '--text', 'こんにちは']]) {
      const output = collect();
      const result = await runNarrationCommand(['verify', '--project', root, ...extra, '--json'], {
        ...output, verifyRuntime: { resolveTranscribeModulePath: () => null }
      });
      assert.equal(result.exitCode, 3);
      assert.equal(JSON.parse(output.lines[0]).status, 'unavailable');
      assert.match(JSON.parse(output.lines[0]).reason, /同梱/);
    }
    const output = collect();
    const result = await runNarrationCommand(['verify', '--project', root, '--check-backend', '--json'], {
      ...output, verifyRuntime: { resolveTranscribeModulePath: () => join(root, 'broken.mjs') }
    });
    assert.equal(result.exitCode, 3);
    assert.equal(JSON.parse(output.lines[0]).status, 'unavailable');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cloud backend は受け付けず、明示 whisper が無ければ exit 3', async () => {
  const invalid = collect();
  assert.equal((await runNarrationCommand(['verify', '--project', '.', '--check-backend', '--backend', 'cloud:groq', '--json'], invalid)).exitCode, 2);
  const missing = collect();
  assert.equal((await runNarrationCommand(['verify', '--project', '.', '--check-backend', '--backend', 'whisper', '--json'], {
    ...missing, verifyRuntime: { speechAnalyzerAvailable: () => true, resolveWhisper: () => null }
  })).exitCode, 3);
  assert.equal(JSON.parse(missing.lines[0]).status, 'unavailable');
});

test('verify は一時コピーを聞き取り、プロジェクトには書かず、明示 --record だけ追記する', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-verify-test-'));
  try {
    await mkdir(join(root, 'out', 'narration'), { recursive: true });
    await writeFile(join(root, 'out', 'narration', 'n-0001.wav'), 'fake-audio');
    const edit = JSON.stringify({ audio: { narration: [{ id: 'n-0001', path: 'out/narration/n-0001.wav',
      script: 'こんにちは', reading: 'こんにちは', provenance: { engine: 'voicevox', voice: 'speaker:3' } }] } });
    await writeFile(join(root, 'edit.json'), edit);
    const captions = JSON.stringify({ captions: [{ id: 'c-0001', text: 'こんにちは' }] });
    await writeFile(join(root, 'captions.json'), captions);
    let copied;
    const languages = [];
    const runtime = { speechAnalyzerAvailable: () => true, resolveWhisper: () => null,
      transcribeMedia: async (audio, options) => {
        copied = audio;
        assert.equal(options.noRecord, true);
        assert.equal(options.wordBook, false);
        languages.push(options.lang);
        assert.equal(audio.startsWith(root), false);
        assert.equal(await readFile(audio, 'utf8'), 'fake-audio');
        return { backend: 'speech-analyzer', segments: [{ text: 'こんにちは' }] };
      } };
    const run = async extras => {
      const output = collect();
      const command = await runNarrationCommand(['verify', '--project', root, '--id', 'n-0001', '--json', ...extras], { ...output, verifyRuntime: runtime });
      assert.equal(command.exitCode, 0);
      return JSON.parse(output.lines[0]);
    };
    const result = await run([]);
    assert.equal(result.score, 1); assert.equal(result.verdict, 'ok'); assert.equal(result.backend, 'speech-analyzer');
    assert.equal(await readFile(join(root, 'edit.json'), 'utf8'), edit);
    assert.equal(await readFile(join(root, 'captions.json'), 'utf8'), captions);
    assert.equal((await readdir(root)).includes('analysis'), false);
    assert.equal((await readdir(root)).includes('.akari'), false);
    await assert.rejects(readFile(copied));
    const direct = collect();
    assert.equal((await runNarrationCommand(['verify', '--project', root, '--audio', 'out/narration/n-0001.wav',
      '--text', 'こんにちは', '--reading', 'こんにちは', '--json'], { ...direct, verifyRuntime: runtime })).exitCode, 0);
    assert.equal(JSON.parse(direct.lines[0]).reading, 'こんにちは');
    const english = collect();
    assert.equal((await runNarrationCommand(['verify', '--project', root, '--audio', 'out/narration/n-0001.wav',
      '--text', 'Hello 123', '--json'], { ...english, verifyRuntime: runtime })).exitCode, 0);
    assert.deepEqual(languages, ['ja', 'ja', 'auto']);
    const recordDir = join(root, 'calibration');
    await run(['--record', recordDir]); await run(['--record', recordDir]);
    const lines = (await readFile(join(recordDir, 'narration-verify.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);
    assert.deepEqual(Object.keys(JSON.parse(lines[0])), ['expected', 'reading', 'heard', 'score', 'verdict', 'engine', 'voice', 'backend', 'generated_at']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
