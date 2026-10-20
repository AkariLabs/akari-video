import { after } from 'node:test';
import { setLanguage } from '../../i18n/index.mjs';

setLanguage('ja');
after(() => setLanguage(undefined));
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FAL_TTS_ENGINES, DIRECT_TTS_ENGINES, ttsEngine } from '../src/tts-engines.mjs';
import { runNarrationCommand } from '../src/narration-command.mjs';

const phrase = "Here's what I learned this week.";
const collect = () => { const lines = []; return { lines, log: line => lines.push(line), logError: () => {} }; };
const profileMeta = { embedding_source_url: 'https://example.invalid/embedding', reference_text: 'sample',
  engines: { 'minimax-2.6-hd': { custom_voice_id: 'custom-1' } } };
const openapiRoot = new URL('../fixtures/narration/openapi/', import.meta.url);

function payload(id, language, extra = {}) {
  const engine = ttsEngine(id);
  return engine.buildPayload({ text: phrase, voice: engine.default_voice, profileMeta,
    audioUrl: 'https://example.invalid/reference.wav', language, ...extra });
}

test('Japanese request JSON stays byte for byte identical for every cloud engine', () => {
  const expected = {
    'gemini-tts': { prompt: phrase, voice: 'Leda', model: 'gemini-2.5-flash-tts', output_format: 'mp3', language_code: 'Japanese (Japan)' },
    'fal-qwen3': { text: phrase, language: 'Japanese', speaker_voice_embedding_file_url: profileMeta.embedding_source_url,
      reference_text: 'sample', max_new_tokens: 2048 },
    'gemini-3.1-flash-tts': { prompt: phrase, voice: 'Leda', output_format: 'mp3', language_code: 'Japanese (Japan)' },
    'elevenlabs-v3': { text: phrase, voice: 'Rachel', language_code: 'ja' },
    'minimax-2.6-hd': { prompt: phrase, language_boost: 'Japanese', output_format: 'url', voice_setting: { voice_id: 'custom-1' } },
    chatterbox: { text: phrase, voice: 'https://example.invalid/reference.wav', custom_audio_language: 'japanese' },
    'index-tts-2': { prompt: phrase, audio_url: 'https://example.invalid/reference.wav' },
    'fish-s2.1-pro': { text: phrase, reference_id: ttsEngine('fish-s2.1-pro').default_voice, format: 'mp3' },
    'fish-drama-3': { text: phrase, reference_id: ttsEngine('fish-drama-3').default_voice, format: 'mp3' },
    'gemini-3.8-flash-tts': { model: 'gemini-3.8-flash-tts', input: [{ type: 'user_input', content: [{ type: 'text', text: phrase }] }],
      response_format: { type: 'audio', mime_type: 'audio/l16', sample_rate: 24000 },
      generation_config: { speech_config: [{ voice: 'Leda' }] } },
  };
  for (const engine of [...FAL_TTS_ENGINES, ...DIRECT_TTS_ENGINES]) {
    const extra = engine.provider === 'fish-audio' ? { audioUrl: undefined } : {};
    assert.equal(JSON.stringify(payload(engine.id, 'ja', extra)), JSON.stringify(expected[engine.id]), engine.id);
    assert.equal(JSON.stringify(payload(engine.id, undefined, extra)), JSON.stringify(expected[engine.id]), `${engine.id}: implicit ja`);
    assert.equal(engine.request(expected[engine.id], 'test-key').options.body,
      JSON.stringify(expected[engine.id]), `${engine.id}: HTTP request JSON`);
  }
});

test('English request language uses fixture values and APIs without a language field omit it', () => {
  assert.equal(payload('gemini-tts', 'en').language_code, 'English (US)');
  assert.equal(payload('gemini-3.1-flash-tts', 'en').language_code, 'English (US)');
  assert.equal(payload('fal-qwen3', 'en').language, 'English');
  assert.equal(payload('elevenlabs-v3', 'en').language_code, 'en');
  assert.equal(payload('minimax-2.6-hd', 'en').language_boost, 'English');
  assert.equal(payload('chatterbox', 'en').custom_audio_language, 'english');
  assert.equal(payload('chatterbox', 'en', { audioUrl: undefined }).voice, 'english');
  for (const id of ['index-tts-2', 'fish-s2.1-pro', 'fish-drama-3', 'gemini-3.8-flash-tts']) {
    assert.equal(Object.keys(payload(id, 'en')).some(key => /language/.test(key)), false, id);
  }
  for (const id of ['gemini-tts', 'fal-qwen3', 'gemini-3.1-flash-tts', 'elevenlabs-v3', 'minimax-2.6-hd']) {
    assert.equal(Object.keys(payload(id, 'xx')).some(key => /language/.test(key)), false, `${id}: unknown language`);
  }
});

test('language values sent to fal occur in saved OpenAPI enums', () => {
  for (const [id, field] of [['gemini-tts', 'language_code'], ['fal-qwen3', 'language'],
    ['gemini-3.1-flash-tts', 'language_code'], ['minimax-2.6-hd', 'language_boost'],
    ['chatterbox', 'custom_audio_language']]) {
    const engine = ttsEngine(id);
    const fixture = JSON.parse(fs.readFileSync(new URL(engine.openapi_fixture, openapiRoot), 'utf8'));
    const ref = fixture.paths[`/${engine.endpoint}`].post.requestBody.content['application/json'].schema.$ref.split('/').at(-1);
    const property = fixture.components.schemas[ref].properties[field];
    const values = property.enum ?? property.anyOf?.flatMap(option => option.enum ?? []) ?? [];
    for (const language of ['ja', 'en']) {
      assert.ok(values.includes(payload(id, language)[field]), `${id}: ${language}`);
    }
  }
});

test('project language and --lang choose English voice and never default to VOICEVOX', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-narration-lang-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.akari'));
  fs.writeFileSync(path.join(root, '.akari', 'intake.json'), JSON.stringify({ language: 'en-US' }));
  const run = async (...flags) => {
    const io = collect();
    const result = await runNarrationCommand(['generate', '--project', root, '--text', phrase, '--dry-run', '--json', ...flags], io);
    assert.equal(result.exitCode, 0, io.lines.at(-1));
    return JSON.parse(io.lines.at(-1));
  };
  const english = await run();
  assert.equal(english.engine, 'gemini-tts');
  assert.equal(english.request.body.voice, 'Kore');
  assert.equal(english.request.body.language_code, 'English (US)');
  assert.equal((await run('--engine', 'gemini-3.1-flash-tts')).request.body.voice, 'Kore');
  assert.equal((await run('--engine', 'chatterbox')).request.body.voice, 'english');
  const fish = collect();
  assert.equal((await runNarrationCommand(['generate', '--project', root, '--engine', 'fish-s2.1-pro',
    '--text', phrase, '--dry-run', '--json'], fish)).exitCode, 2);
  assert.match(JSON.parse(fish.lines.at(-1)).error, /既定の声はありません/);
  const japanese = await run('--lang', 'ja-JP');
  assert.equal(japanese.engine, 'voicevox');
  assert.equal(japanese.request.speaker, 3);
  const override = await run('--engine', 'elevenlabs-v3', '--lang', 'ja');
  assert.equal(override.request.body.language_code, 'ja');
  assert.equal(override.request.body.voice, 'Rachel');
  fs.writeFileSync(path.join(root, '.akari', 'intake.json'), JSON.stringify({ language: 'ja' }));
  const englishOverride = await run('--lang', 'en-GB');
  assert.equal(englishOverride.engine, 'gemini-tts');
  assert.equal(englishOverride.request.body.language_code, 'English (US)');
});

test('engines list declares supported content languages', async () => {
  const io = collect();
  const result = await runNarrationCommand(['engines', '--json'], { ...io,
    engineRuntime: { env: { FAL_KEY: '' }, fetchImpl: async () => ({ ok: false }), fsImpl: { existsSync: () => false } } });
  assert.equal(result.exitCode, 0);
  const rows = JSON.parse(io.lines[0]).engines;
  assert.deepEqual(rows.find(row => row.id === 'voicevox').languages, ['ja']);
  assert.deepEqual(rows.find(row => row.id === 'irodori').languages, ['ja']);
  assert.deepEqual(rows.find(row => row.id === 'fish-s2.1-pro').languages, ['ja']);
  assert.deepEqual(rows.find(row => row.id === 'fish-drama-3').languages, ['ja']);
  for (const row of rows.filter(row => !['voicevox', 'irodori', 'fish-s2.1-pro', 'fish-drama-3'].includes(row.id))) {
    assert.ok(row.languages.includes('en'), row.id);
  }
});

test('English phrase generates through fake fetch and sends an English request without cloud access', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-narration-en-fetch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'intake.json'), JSON.stringify({ language: 'en' }));
  const previousFetch = globalThis.fetch;
  const previousFalKey = process.env.FAL_KEY;
  t.after(() => { globalThis.fetch = previousFetch;
    if (previousFalKey === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = previousFalKey; });
  process.env.FAL_KEY = 'test-only-key';
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url === 'https://fal.run/fal-ai/gemini-tts') return { ok: true, json: async () => ({ audio: { url: 'https://example.invalid/audio.mp3' } }) };
    if (url === 'https://example.invalid/audio.mp3') return { ok: true, arrayBuffer: async () => Buffer.from('fake-mp3') };
    throw new Error(`Unexpected URL: ${url}`);
  };
  const io = collect();
  const result = await runNarrationCommand(['generate', '--project', root, '--text', phrase, '--yes', '--json'], io);
  assert.equal(result.exitCode, 0, io.lines.at(-1));
  assert.equal(JSON.parse(io.lines.at(-1)).status, 'ok');
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[0].options.body).language_code, 'English (US)');
  assert.equal(JSON.parse(requests[0].options.body).voice, 'Kore');
});
