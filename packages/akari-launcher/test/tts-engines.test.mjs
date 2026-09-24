import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FAL_TTS_ENGINES, falTtsEngine, estimateTtsCost, MAX_REFERENCE_BYTES, referenceDataUri } from '../src/tts-engines.mjs';
import { runNarrationCommand } from '../src/narration-command.mjs';
import { runVoiceCommand } from '../src/voice-command.mjs';

const fixtures = path.resolve('packages/akari-launcher/fixtures/narration/openapi');
const added = FAL_TTS_ENGINES.filter(row => !['gemini-tts', 'fal-qwen3'].includes(row.id));
const collect = () => { const lines = []; return { lines, log: line => lines.push(line), logError: () => {} }; };

test('目録の全 payload は保存した OpenAPI required とキー名に従う', () => {
  assert.equal(added.length, 5);
  for (const engine of FAL_TTS_ENGINES) {
    const schema = JSON.parse(fs.readFileSync(path.join(fixtures, engine.openapi_fixture), 'utf8'));
    const request = schema.paths[`/${engine.endpoint}`].post.requestBody.content['application/json'].schema.$ref.split('/').at(-1);
    const input = schema.components.schemas[request];
    const payload = engine.buildPayload({ text: 'こんにちは', voice: engine.default_voice, style: '静かに',
      audioUrl: 'https://example.invalid/reference.wav', profileMeta: { embedding_source_url: 'https://example.invalid/embedding',
        reference_text: 'こんにちは', engines: { 'minimax-2.6-hd': { custom_voice_id: 'custom-1' } } } });
    for (const key of input.required ?? []) assert.ok(payload[key] !== undefined, `${engine.id}: ${key}`);
    for (const key of Object.keys(payload)) assert.ok(Object.hasOwn(input.properties, key), `${engine.id}: ${key}`);
  }
  const clone = JSON.parse(fs.readFileSync(path.join(fixtures, 'fal-ai_minimax_voice-clone.json'), 'utf8'));
  assert.deepEqual(clone.components.schemas.MinimaxVoiceCloneInput.required, ['audio_url']);
  assert.deepEqual(clone.components.schemas.MinimaxVoiceCloneOutput.required, ['custom_voice_id']);
  assert.ok(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(fixtures, 'fal-ai_index-tts-2_text-to-speech.json'), 'utf8'))
    .components.schemas.IndexTts2TextToSpeechInput.properties, 'emotional_audio_url'));
  const multilingual = JSON.parse(fs.readFileSync(path.join(fixtures, 'fal-ai_chatterbox_text-to-speech_multilingual.json'), 'utf8'));
  assert.match(multilingual.info['x-fal-metadata'].about, /Multilingual/);
  assert.equal(multilingual.components.schemas.ChatterboxTextToSpeechMultilingualInput.properties.text.maxLength, 300);
  assert.deepEqual(falTtsEngine('chatterbox').buildPayload({ text: 'こんにちは' }), { text: 'こんにちは', voice: 'japanese' });
  assert.deepEqual(falTtsEngine('chatterbox').buildPayload({ text: 'こんにちは', audioUrl: 'data:audio/wav;base64,YQ==' }),
    { text: 'こんにちは', voice: 'data:audio/wav;base64,YQ==', custom_audio_language: 'japanese' });
});

test('見積は字数・秒・不明を区別する', () => {
  assert.equal(estimateTtsCost(falTtsEngine('elevenlabs-v3'), 'あ'.repeat(1000)), 0.1);
  assert.equal(estimateTtsCost(falTtsEngine('index-tts-2'), 'あ'.repeat(50)), 0.02);
  assert.equal(estimateTtsCost(falTtsEngine('minimax-2.6-hd'), 'こんにちは'), null);
});

test('engines --json は既存 4 件の順序を保ち、新規 5 件を cloud に載せる', async () => {
  const io = collect();
  const result = await runNarrationCommand(['engines', '--json'], { ...io,
    engineRuntime: { env: { HOME: os.tmpdir(), AKARI_HOME: path.join(os.tmpdir(), 'akari-tts-empty'), FAL_KEY: '' },
      fetchImpl: async () => ({ ok: false }), fsImpl: { existsSync: () => false } } });
  assert.equal(result.exitCode, 0);
  const rows = JSON.parse(io.lines[0]).engines;
  assert.deepEqual(rows.slice(0, 4).map(row => row.id), ['voicevox', 'gemini-tts', 'irodori', 'fal-qwen3']);
  assert.deepEqual(rows.slice(4).map(row => row.id), added.map(row => row.id));
  for (const row of rows.slice(4)) {
    assert.equal(row.group, 'cloud');
    assert.equal(row.availability.state, 'unconfigured');
    assert.ok(['none', 'per-request', 'registered'].includes(row.supports.clone));
  }
});

test('新エンジンは --yes なしで HTTP 0 回、5000 字と 300 字の上限を守る', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-tts-catalog-'));
  const oldFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('unexpected HTTP'); };
    const run = async (engine, text, yes = false) => {
      const io = collect();
      const result = await runNarrationCommand(['generate', '--project', root, '--engine', engine,
        '--text', text, ...(yes ? ['--yes'] : []), '--json'], io);
      return { code: result.exitCode, value: JSON.parse(io.lines.at(-1)) };
    };
    let value = await run('minimax-2.6-hd', 'こんにちは');
    assert.equal(value.code, 2);
    assert.equal(value.value.estimate_usd, null);
    assert.equal(value.value.reason, '見積不可');
    value = await run('elevenlabs-v3', 'あ'.repeat(5001));
    assert.equal(value.code, 2);
    assert.match(value.value.error, /5000/);
    value = await run('chatterbox', 'あ'.repeat(301), true);
    assert.equal(value.code, 2);
    assert.match(value.value.error, /300/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; fs.rmSync(root, { recursive: true, force: true }); }
});

test('参照音声は同意・照合後だけ data URI で送る', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-tts-profile-'));
  const prior = { HOME: process.env.HOME, AKARI_HOME: process.env.AKARI_HOME, FAL_KEY: process.env.FAL_KEY };
  const oldFetch = globalThis.fetch;
  try {
    process.env.HOME = root; process.env.AKARI_HOME = path.join(root, 'akari'); process.env.FAL_KEY = 'mock-key';
    const dir = path.join(process.env.AKARI_HOME, 'avatars', 'person', 'voice', 'sample');
    fs.mkdirSync(dir, { recursive: true });
    const meta = { version: 2, profile: 'sample', avatar: 'person', label: 'sample',
      consent: { self_voice: true, cloud_upload: false }, reference: { file: 'ref-recording.wav', verification: { score: 0.9 } }, engines: {} };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
    fs.writeFileSync(path.join(dir, 'ref-recording.wav'), 'synthetic');
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('fal.run')) return { ok: true, json: async () => ({ audio: { url: 'https://files.invalid/result.mp3' } }) };
      if (String(url).endsWith('result.mp3')) return { ok: true, arrayBuffer: async () => Buffer.from('synthetic mp3') };
      throw new Error('unexpected HTTP');
    };
    const run = async (engine, yes = true) => {
      const io = collect();
      const result = await runNarrationCommand(['generate', '--project', root, '--engine', engine,
        '--profile', 'sample', '--text', 'こんにちは', ...(yes ? ['--yes'] : []), '--json'], io);
      return { code: result.exitCode, value: JSON.parse(io.lines.at(-1)) };
    };
    let result = await run('index-tts-2', false);
    assert.equal(result.code, 2); assert.equal(calls.length, 0);
    result = await run('index-tts-2');
    assert.equal(result.code, 2); assert.equal(calls.length, 0);
    meta.consent.cloud_upload = true; meta.reference.verification.score = 0.69;
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
    result = await run('index-tts-2');
    assert.equal(result.code, 2); assert.equal(calls.length, 0);
    meta.reference.verification.score = 0.9;
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
    delete process.env.FAL_KEY;
    result = await run('index-tts-2');
    assert.equal(result.code, 1); assert.equal(calls.length, 0);
    process.env.FAL_KEY = 'mock-key';
    result = await run('index-tts-2');
    assert.equal(result.code, 0);
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[0].init.body).audio_url, 'data:audio/wav;base64,c3ludGhldGlj');
    assert.equal(result.value.provenance.voice, 'profile:sample');
    assert.equal(result.value.provenance.endpoint, 'fal-ai/index-tts-2/text-to-speech');
    const lines = collect();
    await runVoiceCommand(['profiles', '--json'], { env: process.env, log: lines.log, logError: lines.logError });
    const usable = JSON.parse(lines.lines[0]).profiles[0].usable_engines;
    assert.ok(usable.includes('chatterbox') && usable.includes('index-tts-2'));
    assert.ok(!usable.includes('minimax-2.6-hd'));
    result = await run('chatterbox');
    assert.equal(result.code, 0);
    assert.equal(calls.length, 4);
    const chatterboxPayload = JSON.parse(calls[2].init.body);
    assert.equal(chatterboxPayload.voice, 'data:audio/wav;base64,c3ludGhldGlj');
    assert.equal(chatterboxPayload.custom_audio_language, 'japanese');
    assert.equal(calls[2].url, 'https://fal.run/fal-ai/chatterbox/text-to-speech/multilingual');
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MiniMax copy は承認前 HTTP 0 回、custom_voice_id を写しへ記録する', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-minimax-copy-'));
  const env = { HOME: root, AKARI_HOME: path.join(root, 'akari'), FAL_KEY: 'mock-key' };
  try {
    const dir = path.join(env.AKARI_HOME, 'avatars', 'person', 'voice', 'sample');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ref-recording.wav'), 'synthetic');
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ version: 2, profile: 'sample', avatar: 'person',
      consent: { self_voice: true, cloud_upload: true }, reference: { file: 'ref-recording.wav', duration_s: 20, verification: { score: 0.9 } },
      engines: {} }));
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('voice-clone')) return { ok: true, json: async () => ({ custom_voice_id: 'custom-1' }) };
      throw new Error('unexpected HTTP');
    };
    const run = async yes => {
      const io = collect();
      const result = await runVoiceCommand(['copy', '--profile', 'sample', '--engine', 'minimax-2.6-hd',
        ...(yes ? ['--yes'] : []), '--json'], { env, fetchImpl, log: io.log, logError: io.logError });
      return { code: result.exitCode, value: JSON.parse(io.lines[0]) };
    };
    let result = await run(false);
    assert.equal(result.code, 2); assert.equal(result.value.estimate_usd, null); assert.equal(calls.length, 0);
    result = await run(true);
    assert.equal(result.code, 0); assert.equal(result.value.copy.custom_voice_id, 'custom-1');
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].init.body).audio_url, 'data:audio/wav;base64,c3ludGhldGlj');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).engines['minimax-2.6-hd'].custom_voice_id, 'custom-1');
    const io = collect();
    await runVoiceCommand(['profiles', '--json'], { env, log: io.log, logError: io.logError });
    assert.ok(JSON.parse(io.lines[0]).profiles[0].usable_engines.includes('minimax-2.6-hd'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('20 MB 超の正本は narration / MiniMax copy とも fetch 0 回で exit 2', async () => {
  assert.equal(referenceDataUri(Buffer.from('wav')), 'data:audio/wav;base64,d2F2');
  assert.throws(() => referenceDataUri(Buffer.alloc(MAX_REFERENCE_BYTES + 1)), /20 MB/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-tts-oversize-'));
  const oldFetch = globalThis.fetch;
  const prior = { HOME: process.env.HOME, AKARI_HOME: process.env.AKARI_HOME, FAL_KEY: process.env.FAL_KEY };
  try {
    process.env.HOME = root; process.env.AKARI_HOME = path.join(root, 'akari'); process.env.FAL_KEY = 'mock-key';
    const dir = path.join(process.env.AKARI_HOME, 'avatars', 'person', 'voice', 'sample');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ref-recording.wav'), Buffer.alloc(MAX_REFERENCE_BYTES + 1));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ version: 2, profile: 'sample', avatar: 'person',
      consent: { self_voice: true, cloud_upload: true }, reference: { file: 'ref-recording.wav', duration_s: 20,
        verification: { score: 0.9 } }, engines: {} }));
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('unexpected HTTP'); };
    const narration = collect();
    const first = await runNarrationCommand(['generate', '--project', root, '--engine', 'index-tts-2',
      '--profile', 'sample', '--text', 'こんにちは', '--yes', '--json'], narration);
    assert.equal(first.exitCode, 2);
    assert.match(JSON.parse(narration.lines[0]).error, /20 MB/);
    const copy = collect();
    const second = await runVoiceCommand(['copy', '--profile', 'sample', '--engine', 'minimax-2.6-hd', '--yes', '--json'],
      { env: process.env, fetchImpl: globalThis.fetch, log: copy.log, logError: copy.logError });
    assert.equal(second.exitCode, 2);
    assert.match(JSON.parse(copy.lines[0]).error, /20 MB/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
