import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DIRECT_TTS_ENGINES, estimateTtsCost, parseGeminiAudio, pcmToWav } from '../src/tts-engines.mjs';
import { runNarrationCommand } from '../src/narration-command.mjs';
import { listProfiles } from '../src/voice-command.mjs';

const fish = DIRECT_TTS_ENGINES[0];
const gemini = DIRECT_TTS_ENGINES[1];
const collect = () => { const lines = []; return { lines, log: line => lines.push(line), logError: () => {} }; };

test('Fish と Gemini の URL・認証・入力・見積・WAV 変換', () => {
  const fishPayload = fish.buildPayload({ text: 'こんにちは', voice: fish.default_voice, style: 'whispering' });
  assert.deepEqual(fishPayload, { text: '[whispering] こんにちは', reference_id: fish.default_voice, format: 'mp3' });
  assert.equal(fish.buildPayload({ text: 'こんにちは', voice: fish.default_voice,
    style: '[sad][whispering]' }).text, '[sad][whispering] こんにちは');
  const fishRequest = fish.request(fishPayload, 'dummy-fish-key');
  assert.equal(fishRequest.url, 'https://api.fish.audio/v1/tts');
  assert.equal(fishRequest.options.headers.Authorization.replace('dummy-fish-key', '<masked>'), 'Bearer <masked>');
  assert.equal(fishRequest.options.headers.model, 's2.1-pro');
  assert.deepEqual(JSON.parse(fishRequest.options.body), fishPayload);
  assert.equal(estimateTtsCost(fish, 'あ'.repeat(1000)), 0.045);

  const geminiPayload = gemini.buildPayload({ text: 'こんにちは', voice: 'Leda', style: 'softly' });
  assert.equal(gemini.voices.length, 30);
  assert.equal(gemini.voices[0].id, 'Leda');
  assert.equal(geminiPayload.model, 'gemini-3.8-flash-tts');
  assert.equal(geminiPayload.input[0].content[0].annotations[0].style, 'softly');
  assert.deepEqual(geminiPayload.response_format, { type: 'audio', mime_type: 'audio/l16', sample_rate: 24000 });
  assert.deepEqual(geminiPayload.generation_config.speech_config, [{ voice: 'Leda' }]);
  const geminiRequest = gemini.request(geminiPayload, 'dummy-google-key');
  assert.equal(geminiRequest.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(geminiRequest.options.headers['x-goog-api-key'].replace('dummy-google-key', '<masked>'), '<masked>');
  assert.deepEqual(JSON.parse(geminiRequest.options.body), geminiPayload);
  assert.equal(estimateTtsCost(gemini, 'あ'.repeat(50)), 0.00225);
  const pcm = Buffer.from([0, 0, 1, 0]);
  const wav = pcmToWav(pcm);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.deepEqual(parseGeminiAudio({ steps: [{ type: 'model_output', content: [{ type: 'audio',
    data: pcm.toString('base64'), mime_type: 'audio/l16' }] }] }), wav);
  assert.deepEqual(parseGeminiAudio({ steps: [{ type: 'model_output', content: [{ type: 'audio',
    data: wav.toString('base64'), mime_type: 'audio/wav' }] }] }), wav);
});

test('直接 API は鍵なしで unconfigured、--yes なしで HTTP 0 回', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-direct-tts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prior = { HOME: process.env.HOME, AKARI_HOME: process.env.AKARI_HOME,
    FISH_AUDIO_API_KEY: process.env.FISH_AUDIO_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  t.after(() => { for (const [name, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  } });
  process.env.HOME = root; process.env.AKARI_HOME = path.join(root, 'home');
  process.env.FISH_AUDIO_API_KEY = ''; process.env.GEMINI_API_KEY = '';
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected HTTP'); };
  const env = { HOME: root, AKARI_HOME: path.join(root, 'home'), FISH_AUDIO_API_KEY: '', GEMINI_API_KEY: '' };
  const io = collect();
  const listed = await runNarrationCommand(['engines', '--json'], { ...io,
    engineRuntime: { env, fetchImpl: async () => ({ ok: false }), fsImpl: { existsSync: () => false } } });
  assert.equal(listed.exitCode, 0);
  const rows = JSON.parse(io.lines[0]).engines;
  assert.deepEqual(rows.slice(-2).map(row => row.availability), [
    { state: 'unconfigured', label: 'Fish Audio の鍵を登録' },
    { state: 'unconfigured', label: 'Google AI の鍵を登録' },
  ]);
  fs.mkdirSync(env.AKARI_HOME, { recursive: true });
  fs.writeFileSync(path.join(env.AKARI_HOME, 'credentials.env'),
    'FISH_AUDIO_API_KEY=dummy-fish-key\nGEMINI_API_KEY=dummy-google-key\n', { mode: 0o600 });
  const withKeys = collect();
  await runNarrationCommand(['engines', '--json'], { ...withKeys,
    engineRuntime: { env, fetchImpl: async () => ({ ok: false }), fsImpl: { existsSync: () => false } } });
  assert.deepEqual(JSON.parse(withKeys.lines[0]).engines.slice(-2).map(row => row.availability.state),
    ['available', 'available']);
  for (const engine of [fish.id, gemini.id]) {
    const output = collect();
    const result = await runNarrationCommand(['generate', '--project', root, '--engine', engine, '--text', 'こんにちは', '--json'], output);
    assert.equal(result.exitCode, 2);
    assert.equal(JSON.parse(output.lines.at(-1)).status, 'needs_approval');
  }
  const unsupported = collect();
  const clone = await runNarrationCommand(['generate', '--project', root, '--engine', gemini.id,
    '--profile', 'sample', '--text', 'こんにちは', '--yes', '--json'], unsupported);
  assert.equal(clone.exitCode, 2);
  assert.match(JSON.parse(unsupported.lines.at(-1)).error, /声プロファイルが見つかりません/);
  assert.equal(calls, 0);
});

test('直接 API の合成はモック応答だけを使い、provider と model を記録する', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-direct-generate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prior = { HOME: process.env.HOME, AKARI_HOME: process.env.AKARI_HOME,
    FISH_AUDIO_API_KEY: process.env.FISH_AUDIO_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  const oldFetch = globalThis.fetch;
  t.after(() => { for (const [name, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  } globalThis.fetch = oldFetch; });
  process.env.HOME = root; process.env.AKARI_HOME = path.join(root, 'home');
  process.env.FISH_AUDIO_API_KEY = 'dummy-fish-key'; process.env.GEMINI_API_KEY = 'dummy-google-key';
  const requests = [];
  const wav = pcmToWav(Buffer.alloc(48000));
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('fish.audio')) return { ok: true, arrayBuffer: async () => Buffer.from('dummy mp3') };
    return { ok: true, json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio',
      mime_type: 'audio/l16', data: wav.subarray(44).toString('base64') }] }] }) };
  };
  const dry = collect();
  assert.equal((await runNarrationCommand(['generate', '--project', root, '--engine', fish.id,
    '--text', 'こんにちは', '--dry-run', '--json'], dry)).exitCode, 0);
  assert.equal(requests.length, 0);
  assert.equal(JSON.parse(dry.lines.at(-1)).request.headers.Authorization, 'Bearer ***configured***');
  for (const engine of [fish.id, gemini.id]) {
    const io = collect();
    const result = await runNarrationCommand(['generate', '--project', root, '--engine', engine,
      '--text', 'こんにちは', '--yes', '--json'], io);
    assert.equal(result.exitCode, 0, io.lines.at(-1));
    const output = JSON.parse(io.lines.at(-1));
    assert.equal(output.provenance.provider, engine === fish.id ? 'fish-audio' : 'google-ai');
    assert.equal(output.provenance.model, engine === fish.id ? 's2.1-pro' : 'gemini-3.8-flash-tts');
    assert.equal(output.provenance.price_verified, true);
    if (engine === gemini.id) assert.equal(fs.readFileSync(path.join(root, output.path)).toString('ascii', 0, 4), 'RIFF');
  }
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer dummy-fish-key');
  assert.equal(requests[1].options.headers['x-goog-api-key'], 'dummy-google-key');
});

test('Gemini の登録済み voice_id を interactions の speech_config に指定する', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-gemini-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prior = { HOME: process.env.HOME, AKARI_HOME: process.env.AKARI_HOME, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  const oldFetch = globalThis.fetch;
  t.after(() => { for (const [name, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  } globalThis.fetch = oldFetch; });
  process.env.HOME = root; process.env.AKARI_HOME = path.join(root, 'home'); process.env.GEMINI_API_KEY = 'dummy-google-key';
  const dir = path.join(process.env.AKARI_HOME, 'avatars', 'person', 'voice', 'sample'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ version: 2, label: 'sample',
    consent: { self_voice: true, cloud_upload: true }, reference: { verification: { score: 0.9 } },
    engines: { 'gemini-3.8-flash-tts': { voice_id: 'voice_dummy123' } } }));
  const io = collect(); let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected HTTP'); };
  assert.equal((await runNarrationCommand(['generate', '--project', root, '--engine', gemini.id,
    '--profile', 'sample', '--text', 'こんにちは', '--dry-run', '--json'], io)).exitCode, 0);
  assert.deepEqual(JSON.parse(io.lines.at(-1)).request.body.generation_config.speech_config, [{ voice: 'voice_dummy123' }]);
  assert.equal(calls, 0);
  const requests = []; const audio = pcmToWav(Buffer.alloc(48000));
  globalThis.fetch = async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: true,
    json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'audio',
      mime_type: 'audio/l16', data: audio.subarray(44).toString('base64') }] }] }) }; };
  const generated = collect();
  assert.equal((await runNarrationCommand(['generate', '--project', root, '--engine', gemini.id,
    '--profile', 'sample', '--text', 'こんにちは', '--yes', '--json'], generated)).exitCode, 0);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body.generation_config.speech_config, [{ voice: 'voice_dummy123' }]);
  assert.equal(JSON.parse(generated.lines.at(-1)).provenance.voice, 'profile:sample');
});

test('Fish 参照音声は同意・照合と --yes を通った場合だけ MessagePack で送る', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-direct-clone-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prior = { HOME: process.env.HOME, AKARI_HOME: process.env.AKARI_HOME, FISH_AUDIO_API_KEY: process.env.FISH_AUDIO_API_KEY };
  const oldFetch = globalThis.fetch;
  t.after(() => { for (const [name, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  } globalThis.fetch = oldFetch; });
  process.env.HOME = root; process.env.AKARI_HOME = path.join(root, 'home'); process.env.FISH_AUDIO_API_KEY = 'dummy-fish-key';
  const dir = path.join(process.env.AKARI_HOME, 'avatars', 'person', 'voice', 'sample');
  fs.mkdirSync(dir, { recursive: true });
  const meta = { version: 2, label: 'sample', consent: { self_voice: true, cloud_upload: false },
    reference: { file: 'ref.wav', verification: { score: 0.9 } }, reference_text: '録音原稿', engines: {} };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, 'ref.wav'), 'dummy recording');
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true,
    arrayBuffer: async () => Buffer.from('dummy mp3') }; };
  const run = async yes => { const io = collect(); const result = await runNarrationCommand(['generate', '--project', root,
    '--engine', fish.id, '--profile', 'sample', '--text', 'こんにちは', ...(yes ? ['--yes'] : []), '--json'], io);
    return { code: result.exitCode, output: JSON.parse(io.lines.at(-1)) }; };
  assert.equal((await run(false)).code, 2);
  assert.equal((await run(true)).code, 2);
  assert.equal(calls.length, 0);
  meta.consent.cloud_upload = true; meta.reference.verification.score = 0.69;
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  assert.equal((await run(true)).code, 2); assert.equal(calls.length, 0);
  meta.reference.verification.score = 0.9;
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  assert.ok(listProfiles(process.env).find(row => row.id === 'sample').usable_engines.includes(fish.id));
  assert.equal((await run(true)).code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers['Content-Type'], 'application/msgpack');
  assert.ok(Buffer.isBuffer(calls[0].options.body));
  assert.ok(calls[0].options.body.includes(Buffer.from('dummy recording')));
  assert.ok(calls[0].options.body.includes(Buffer.from('録音原稿')));
});
