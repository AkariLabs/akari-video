import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runVoiceCommand, checkVoiceRecording, readFalKey, resolveVoiceProfile, VOICE_SCRIPTS } from '../src/voice-command.mjs';

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-voice-test-'));
  const env = { ...process.env, HOME: root, AKARI_HOME: path.join(root, 'akari') };
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return { root, env, cleanup };
}
async function run(args, options = {}) {
  const lines = [], errors = [];
  const result = await runVoiceCommand([...args, '--json'], { ...options, log: line => lines.push(line), logError: line => errors.push(line) });
  assert.equal(lines.length, 1, `stdout: ${lines.join('\n')}`);
  return { code: result.exitCode, json: JSON.parse(lines[0]), errors };
}
const validMeasure = { duration_s: 20, peak_db: -3, mean_db: -19, floor_db: -52 };
const validVerify = { score: 0.94, verdict: 'ok', backend: 'speech-analyzer' };
const createArgs = ['create', '--avatar', 'person', '--id', 'sample', '--label', 'サンプル', '--audio', 'dummy.wav', '--script', 'quick-v1'];
function fixtureRuntime(env, overrides = {}) {
  return { env, measureAudio: () => validMeasure, verifyScript: () => validVerify,
    convertAudio: (_source, destination) => fs.writeFileSync(destination, Buffer.from('synthetic wav')),
    ...overrides };
}
function writeMeta(env, avatar, id, overrides = {}) {
  const dir = path.join(env.AKARI_HOME, 'avatars', avatar, 'voice', id);
  fs.mkdirSync(dir, { recursive: true });
  const meta = { version: 2, profile: id, avatar, label: id, created_at: '2026-09-24T00:00:00Z',
    consent: { self_voice: true, cloud_upload: true }, reference: { file: 'ref-recording.wav', duration_s: 20,
      verification: { score: 0.9, backend: 'speech-analyzer' } }, reference_text: VOICE_SCRIPTS['quick-v1'], engines: {}, ...overrides };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, 'ref-recording.wav'), Buffer.from('RIFF synthetic'));
  return { dir, meta };
}

test('scripts は正本原稿 2 本と Google の固定同意文を返す', async () => {
  const box = sandbox();
  try {
    const result = await run(['scripts'], { env: box.env });
    assert.equal(result.code, 0); assert.equal(result.json.scripts.length, 3);
    for (const script of result.json.scripts.filter(script => script.id !== 'consent-gemini')) assert.doesNotMatch(script.text, /アカリ|AKARI|Akari/);
    const consent = result.json.scripts.find(script => script.id === 'consent-gemini');
    assert.equal(consent.locales['ja-JP'], VOICE_SCRIPTS['consent-gemini']);
    assert.equal(Object.keys(consent.locales).length, 30);
    assert.equal(VOICE_SCRIPTS['extended-v1'].split('。').filter(Boolean).length, 8);
  } finally { box.cleanup(); }
});

test('Gemini の同意録音は照合 0.8・backend・承認を通るまで送らず、両録音と voice_id を保存する', async () => {
  const box = sandbox(); let calls = 0, sent;
  try {
    box.env.GEMINI_API_KEY = 'dummy-key';
    const { dir } = writeMeta(box.env, 'person', 'sample');
    const consentFile = path.join(box.root, 'consent.wav'); fs.writeFileSync(consentFile, Buffer.from('dummy'));
    const base = ['copy', '--profile', 'sample', '--engine', 'gemini-3.8-flash-tts', '--consent-audio', consentFile];
    const mock = { env: box.env, geminiKey: 'dummy-key', measureAudio: () => ({ ...validMeasure, duration_s: 7 }),
      verifyScript: () => ({ ...validVerify, score: 0.83 }),
      convertGeminiAudio: (source, destination) => fs.copyFileSync(source, destination),
      fetchImpl: async (url, options) => { calls++; sent = { url, options }; return { ok: true, json: async () => ({ id: 'voice_dummy123' }) }; } };
    let result = await run(base, { ...mock, verifyScript: () => ({ status: 'unavailable' }) });
    assert.equal(result.code, 2); assert.equal(calls, 0);
    result = await run(base, { ...mock, verifyScript: () => ({ ...validVerify, score: 0.79 }) });
    assert.equal(result.code, 2); assert.equal(calls, 0);
    result = await run(base, mock);
    assert.equal(result.json.status, 'needs_approval'); assert.equal(result.json.reason, '見積不可'); assert.equal(calls, 0);
    result = await run([...base, '--yes'], mock);
    assert.equal(result.code, 0); assert.equal(calls, 1);
    assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/voices');
    assert.equal(sent.options.headers['x-goog-api-key'], 'dummy-key');
    const body = JSON.parse(sent.options.body);
    assert.equal(body.store, true); assert.equal(body.voice.type, 'replicated');
    assert.equal(body.voice.replicated.source_audio.data, fs.readFileSync(path.join(dir, 'ref-recording.wav')).toString('base64'));
    assert.equal(body.voice.replicated.consent_audio.data, fs.readFileSync(consentFile).toString('base64'));
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json')));
    assert.equal(meta.engines['gemini-3.8-flash-tts'].voice_id, 'voice_dummy123');
    assert.equal(meta.engines['gemini-3.8-flash-tts'].consent.verification.score, 0.83);
    assert.ok(fs.existsSync(path.join(dir, 'consent-gemini.wav')));
    const profiles = await run(['profiles'], mock);
    assert.ok(profiles.json.profiles[0].usable_engines.includes('gemini-3.8-flash-tts'));
  } finally { box.cleanup(); }
});

test('Gemini は 40 秒の正本を先頭 30 秒に制限し、9 秒の正本は送信しない', async () => {
  const box = sandbox(); let calls = 0; const conversions = [];
  try {
    box.env.GEMINI_API_KEY = 'dummy-key';
    const { dir } = writeMeta(box.env, 'person', 'sample', {
      reference: { file: 'ref-recording.wav', duration_s: 9, verification: { score: 0.9 } }
    });
    const consentFile = path.join(box.root, 'consent.wav'); fs.writeFileSync(consentFile, Buffer.from('consent'));
    const args = ['copy', '--profile', 'sample', '--engine', 'gemini-3.8-flash-tts', '--consent-audio', consentFile, '--yes'];
    const runtime = { env: box.env, measureAudio: () => ({ ...validMeasure, duration_s: 7 }),
      verifyScript: () => validVerify,
      convertGeminiAudio: (source, destination, maxDurationS, sampleRate) => {
        conversions.push({ source, maxDurationS, sampleRate }); fs.copyFileSync(source, destination);
      },
      fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ id: 'voice_dummy123' }) }; } };
    const short = await run(args, runtime);
    assert.equal(short.code, 2); assert.match(short.json.error, /10 秒以上/);
    assert.equal(calls, 0); assert.equal(conversions.length, 0);
    const metaPath = path.join(dir, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath)); meta.reference.duration_s = 40;
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    const long = await run(args, runtime);
    assert.equal(long.code, 0); assert.equal(calls, 1);
    assert.deepEqual(conversions.map(item => [item.maxDurationS, item.sampleRate]), [[null, 24000], [30, 24000]]);
    assert.equal(JSON.parse(fs.readFileSync(metaPath)).engines['gemini-3.8-flash-tts'].source_duration_s, 30);
  } finally { box.cleanup(); }
});

test('Gemini の実 ffmpeg 変換は 40 秒の正本を 30 秒・24 kHz mono 16bit にする', async () => {
  const box = sandbox();
  try {
    const { dir } = writeMeta(box.env, 'person', 'sample', {
      reference: { file: 'ref-recording.wav', duration_s: 40, verification: { score: 0.9 } }
    });
    const consentFile = path.join(box.root, 'consent.wav');
    for (const [file, seconds] of [[path.join(dir, 'ref-recording.wav'), 40], [consentFile, 7]]) {
      const created = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
        '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', file]);
      assert.equal(created.status, 0, created.stderr?.toString());
    }
    let sentSource;
    const result = await run(['copy', '--profile', 'sample', '--engine', 'gemini-3.8-flash-tts', '--consent-audio', consentFile, '--yes'], {
      env: box.env, geminiKey: 'dummy-key', measureAudio: () => ({ ...validMeasure, duration_s: 7 }), verifyScript: () => validVerify,
      fetchImpl: async (_url, options) => { sentSource = Buffer.from(JSON.parse(options.body).voice.replicated.source_audio.data, 'base64');
        return { ok: true, json: async () => ({ id: 'voice_dummy123' }) }; }
    });
    assert.equal(result.code, 0);
    const sentFile = path.join(box.root, 'sent-source.wav'); fs.writeFileSync(sentFile, sentSource);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels,codec_name:format=duration', '-of', 'json', sentFile], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    const info = JSON.parse(probe.stdout);
    assert.ok(Math.abs(Number(info.format.duration) - 30) < 0.02);
    assert.deepEqual([info.streams[0].sample_rate, info.streams[0].channels, info.streams[0].codec_name], ['24000', 1, 'pcm_s16le']);
  } finally { box.cleanup(); }
});

test('check の長さ・音量・騒音・照合閾値と unavailable', async () => {
  const runtime = { measureAudio: () => validMeasure, verifyScript: () => validVerify };
  let result = await checkVoiceRecording({ audio: 'dummy', script: 'quick-v1' }, runtime);
  assert.equal(result.pass, true); assert.equal(result.checks.noise.ok, true);
  result = await checkVoiceRecording({ audio: 'dummy', script: 'quick-v1' }, { ...runtime, measureAudio: () => ({ ...validMeasure, duration_s: 14.99, mean_db: -36 }) });
  assert.equal(result.pass, false); assert.equal(result.reasons.length, 2);
  result = await checkVoiceRecording({ audio: 'dummy', script: 'extended-v1' }, { ...runtime, measureAudio: () => ({ ...validMeasure, duration_s: 44.9 }) });
  assert.equal(result.pass, false);
  result = await checkVoiceRecording({ audio: 'dummy', script: 'quick-v1' }, { ...runtime, measureAudio: () => ({ ...validMeasure, floor_db: -40 }) });
  assert.equal(result.pass, true); assert.equal(result.checks.noise.warn, true);
  result = await checkVoiceRecording({ audio: 'dummy', script: 'quick-v1' }, { ...runtime, verifyScript: () => ({ score: 0.699, verdict: 'ng', backend: 'whisper-cpp' }) });
  assert.equal(result.pass, false);
  result = await checkVoiceRecording({ audio: 'dummy', script: 'quick-v1' }, { ...runtime, verifyScript: () => ({ status: 'unavailable' }) });
  assert.equal(result.pass, true); assert.equal(result.checks.script.ok, 'unavailable');
});

test('create は本人同意・check 合格を要求し、voice.json の既存キーを保持する', async () => {
  const box = sandbox();
  try {
    const runtime = fixtureRuntime(box.env);
    let result = await run(createArgs, runtime);
    assert.equal(result.code, 2); assert.match(result.json.error, /同意/);
    result = await run([...createArgs, '--consent-self'], { ...runtime, verifyScript: () => ({ score: 0.1, backend: 'whisper-cpp' }) });
    assert.equal(result.code, 2); assert.equal(fs.existsSync(path.join(box.env.AKARI_HOME, 'avatars')), false);
    const unavailableArgs = [...createArgs]; unavailableArgs[2] = 'offline'; unavailableArgs[4] = 'offline-sample';
    result = await run([...unavailableArgs, '--consent-self', '--consent-cloud'],
      { ...runtime, verifyScript: () => ({ status: 'unavailable' }) });
    assert.equal(result.code, 0, result.json.error);
    const unavailableMeta = JSON.parse(fs.readFileSync(path.join(box.env.AKARI_HOME, 'avatars', 'offline', 'voice', 'offline-sample', 'meta.json'), 'utf8'));
    assert.deepEqual(unavailableMeta.reference.verification, { status: 'unavailable' });
    let fetchCalls = 0;
    const copyRuntime = { env: box.env, fetchImpl: async () => { fetchCalls++; return new Response('{}'); } };
    result = await run(['copy', '--profile', 'offline-sample', '--engine', 'fal-qwen3', '--yes'], copyRuntime);
    assert.equal(result.code, 2); assert.equal(fetchCalls, 0);
    result = await run(['copy', '--profile', 'offline-sample', '--engine', 'irodori', '--irodori-url', 'http://127.0.0.1:1234'], copyRuntime);
    assert.equal(result.code, 0, result.json.error); assert.equal(fetchCalls, 1);
    const voiceDir = path.join(box.env.AKARI_HOME, 'avatars', 'person', 'voice');
    fs.mkdirSync(voiceDir, { recursive: true });
    fs.writeFileSync(path.join(voiceDir, 'voice.json'), JSON.stringify({ speaker: 3, extra: true }));
    result = await run([...createArgs, '--consent-self', '--consent-cloud'], runtime);
    assert.equal(result.code, 0, result.json.error);
    const metaFile = path.join(voiceDir, 'sample', 'meta.json');
    const wavFile = path.join(voiceDir, 'sample', 'ref-recording.wav');
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    assert.equal(meta.version, 2); assert.equal(meta.consent.cloud_upload, true);
    assert.equal(meta.reference.verification.score, 0.94); assert.deepEqual(meta.engines, {});
    assert.equal(fs.statSync(metaFile).mode & 0o777, 0o600);
    assert.equal(fs.statSync(wavFile).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(voiceDir, 'voice.json'))), { speaker: 3, extra: true, default_profile: 'sample' });
    const other = await run(['create', '--avatar', 'person', '--id', 'second', '--label', '別', '--audio', 'dummy.wav', '--script', 'quick-v1', '--consent-self'], runtime);
    assert.equal(other.code, 0); assert.equal(JSON.parse(fs.readFileSync(path.join(voiceDir, 'voice.json'))).default_profile, 'sample');
  } finally { box.cleanup(); }
});

test('rename は表示名だけを原子的に変更し、旧形式を拒否する', async () => {
  const box = sandbox();
  try {
    const { dir } = writeMeta(box.env, 'person', 'sample');
    let result = await run(['rename', '--profile', 'sample', '--label', '  新しい名前  '], { env: box.env });
    assert.equal(result.code, 0, result.json.error);
    assert.equal(result.json.label, '新しい名前');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json')));
    assert.equal(meta.label, '新しい名前'); assert.equal(meta.profile, 'sample');
    assert.equal(fs.statSync(path.join(dir, 'meta.json')).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['meta.json', 'ref-recording.wav']);
    const legacy = path.join(box.env.HOME, '.config', 'akari-video', 'voice-profiles', 'old');
    fs.mkdirSync(legacy, { recursive: true }); fs.writeFileSync(path.join(legacy, 'meta.json'), JSON.stringify({ profile: 'old', label: '旧' }));
    result = await run(['rename', '--profile', 'old', '--label', '変更'], { env: box.env });
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(legacy, 'meta.json'))).label, '旧');
  } finally { box.cleanup(); }
});

test('extend は失敗時に正本を保ち、連結後に prev・stale・警告を記録する', async () => {
  const box = sandbox();
  try {
    const { dir, meta } = writeMeta(box.env, 'person', 'sample', {
      reference: { file: 'ref-recording.wav', duration_s: 20, script_version: 'quick-v1', verification: { score: 0.9 } },
      engines: { irodori: { voice_id: 'akari-sample' }, 'fal-qwen3': { embedding_source_url: 'https://example.invalid/embedding' } },
    });
    const recording = path.join(dir, 'ref-recording.wav');
    const original = fs.readFileSync(recording);
    const args = ['extend', '--profile', 'sample', '--audio', 'extra.wav', '--script', 'extended-v1'];
    let result = await run(args, { ...fixtureRuntime(box.env), measureAudio: () => ({ ...validMeasure, duration_s: 44 }) });
    assert.equal(result.code, 2);
    assert.deepEqual(fs.readFileSync(recording), original);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'))), meta);
    assert.equal(fs.existsSync(path.join(dir, 'ref-recording.prev.wav')), false);
    const runtime = { ...fixtureRuntime(box.env), measureAudio: file => ({ ...validMeasure, duration_s: file === 'extra.wav' ? 60 : 80 }),
      concatAudio: (_first, _second, output) => fs.writeFileSync(output, Buffer.from('combined wav')),
      verifyCombined: (_file, text) => { assert.equal(text, VOICE_SCRIPTS['quick-v1'] + VOICE_SCRIPTS['extended-v1']); return validVerify; } };
    result = await run(args, runtime);
    assert.equal(result.code, 0, result.json.error);
    assert.equal(result.json.duration_s, 80);
    assert.match(result.json.warnings[0], /写しを作り直して/);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'ref-recording.prev.wav')), original);
    assert.equal(fs.statSync(path.join(dir, 'ref-recording.prev.wav')).mode & 0o777, 0o600);
    const updated = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json')));
    assert.equal(updated.reference.script_version, 'quick-v1+extended-v1');
    assert.equal(updated.reference.sha256.length, 64);
    assert.equal(updated.reference.verification.score, validVerify.score);
    assert.equal(updated.engines.irodori.stale, true);
    assert.equal(updated.engines['fal-qwen3'].stale, true);
    assert.equal(updated.reference_text, VOICE_SCRIPTS['quick-v1'] + VOICE_SCRIPTS['extended-v1']);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['meta.json', 'ref-recording.prev.wav', 'ref-recording.wav']);
    const beforeSecond = Object.fromEntries(['meta.json', 'ref-recording.prev.wav', 'ref-recording.wav']
      .map(name => [name, fs.readFileSync(path.join(dir, name))]));
    result = await run(args, runtime);
    assert.equal(result.code, 2);
    assert.deepEqual(fs.readdirSync(dir).sort(), Object.keys(beforeSecond).sort());
    for (const [name, bytes] of Object.entries(beforeSecond)) assert.deepEqual(fs.readFileSync(path.join(dir, name)), bytes);
    result = await run(['profiles'], { env: box.env });
    assert.equal(result.json.profiles[0].copies.irodori.stale, true);
    const fetchImpl = async () => new Response('{}');
    result = await run(['copy', '--profile', 'sample', '--engine', 'irodori'], { env: box.env, fetchImpl });
    assert.equal(result.code, 0, result.json.error);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'))).engines.irodori.stale, undefined);
    result = await run(['profiles'], { env: box.env });
    assert.equal(result.json.profiles[0].copies.irodori.stale, false);
    assert.equal(result.json.profiles[0].copies['fal-qwen3'].stale, true);
  } finally { box.cleanup(); }
});

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
test('extend は実 ffmpeg で異なる形式の wav を 48 kHz モノラルの 80 秒に連結する', async t => {
  if (!ffmpegAvailable) { t.skip('ffmpeg が PATH にありません'); return; }
  const box = sandbox();
  try {
    const { dir } = writeMeta(box.env, 'person', 'sample', {
      reference: { file: 'ref-recording.wav', duration_s: 20, script_version: 'quick-v1', verification: { score: 0.9 } },
    });
    const recording = path.join(dir, 'ref-recording.wav');
    const addition = path.join(box.root, 'extended.wav');
    const make = (seconds, sampleRate, channels, file) => {
      const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i',
        `sine=frequency=440:duration=${seconds}:sample_rate=${sampleRate}`, '-ac', String(channels), '-c:a', 'pcm_s16le', file]);
      assert.equal(result.status, 0, result.stderr?.toString());
    };
    make(20, 44100, 2, recording);
    make(60, 48000, 1, addition);
    const original = fs.readFileSync(recording);
    const result = await run(['extend', '--profile', 'sample', '--audio', addition, '--script', 'extended-v1'], {
      env: box.env, verifyScript: () => validVerify, verifyCombined: () => validVerify,
    });
    assert.equal(result.code, 0, result.json.error);
    const wav = fs.readFileSync(recording);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 48000);
    const data = wav.indexOf('data', 36, 'ascii');
    assert.ok(data >= 0);
    const duration = wav.readUInt32LE(data + 4) / wav.readUInt32LE(28);
    assert.ok(Math.abs(duration - 80) <= 0.2, `wav duration: ${duration}`);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json')));
    assert.ok(Math.abs(meta.reference.duration_s - 80) <= 0.2, `meta duration: ${meta.reference.duration_s}`);
    assert.ok(Math.abs(meta.reference.duration_s - duration) <= 0.002);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'ref-recording.prev.wav')), original);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['meta.json', 'ref-recording.prev.wav', 'ref-recording.wav']);
  } finally { box.cleanup(); }
});

test('鍵は環境変数・指定ファイル・新・旧の順で読み、値を JSON に出さない', async () => {
  const box = sandbox();
  try {
    const newer = path.join(box.env.AKARI_HOME, 'credentials.env');
    const older = path.join(box.env.HOME, '.config', 'akari-video', 'credentials.env');
    fs.mkdirSync(path.dirname(newer), { recursive: true }); fs.mkdirSync(path.dirname(older), { recursive: true });
    fs.writeFileSync(older, 'FAL_KEY=legacy-dummy');
    const env = { ...box.env, FAL_KEY: '' };
    assert.equal(readFalKey(env), 'legacy-dummy');
    fs.writeFileSync(newer, 'FAL_KEY=new-dummy');
    assert.equal(readFalKey(env), 'new-dummy');
    fs.rmSync(older); assert.equal(readFalKey(env), 'new-dummy');
    const explicit = path.join(box.root, 'explicit.env'); fs.writeFileSync(explicit, 'FAL_KEY=explicit-dummy');
    assert.equal(readFalKey({ ...env, AKARI_CREDENTIALS_FILE: explicit }), 'explicit-dummy');
    assert.equal(readFalKey({ ...env, AKARI_CREDENTIALS_FILE: explicit, FAL_KEY: 'environment-dummy' }), 'environment-dummy');
    writeMeta(box.env, 'person', 'sample');
    const result = await run(['copy', '--profile', 'sample', '--engine', 'fal-qwen3', '--yes'], {
      env: { ...env, AKARI_CREDENTIALS_FILE: explicit, FAL_KEY: 'environment-dummy' },
      fetchImpl: async (_url, options) => {
        assert.equal(options.headers.Authorization, 'Key environment-dummy');
        return new Response(JSON.stringify({ speaker_embedding: { url: 'https://example.invalid/embedding' } }));
      },
    });
    assert.equal(result.code, 0, result.json.error);
    for (const key of ['legacy-dummy', 'new-dummy', 'explicit-dummy', 'environment-dummy']) {
      assert.equal(JSON.stringify(result.json).includes(key), false);
      assert.equal(result.errors.join(' ').includes(key), false);
    }
  } finally { box.cleanup(); }
});

test('copy fal は同意・照合・--yes の各ガードで fetch 0 回', async () => {
  const box = sandbox();
  try {
    const { dir, meta } = writeMeta(box.env, 'person', 'sample');
    let calls = 0;
    const runtime = { env: box.env, fetchImpl: () => { calls++; throw new Error('unexpected fetch'); } };
    const copy = () => run(['copy', '--profile', 'sample', '--engine', 'fal-qwen3', '--yes'], runtime);
    meta.consent.cloud_upload = false; fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
    assert.equal((await copy()).code, 2); assert.equal(calls, 0);
    meta.consent.cloud_upload = true; meta.reference.verification = { status: 'unavailable' }; fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
    assert.equal((await copy()).code, 2); assert.equal(calls, 0);
    meta.reference.verification = { score: 0.9 }; fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
    const approval = await run(['copy', '--profile', 'sample', '--engine', 'fal-qwen3'], runtime);
    assert.equal(approval.code, 2); assert.equal(approval.json.status, 'needs_approval'); assert.equal(calls, 0);
  } finally { box.cleanup(); }
});

test('copy irodori は multipart の file と voice_id を送り、try は一時領域に保存し、delete は DELETE', async () => {
  const box = sandbox();
  try {
    const { dir } = writeMeta(box.env, 'person', 'sample');
    const calls = [];
    const wav = fakeWav(1);
    const runtime = { env: box.env, fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/speech')) return new Response(wav);
      return new Response('{}');
    } };
    let result = await run(['copy', '--profile', 'sample', '--engine', 'irodori', '--irodori-url', 'http://127.0.0.1:1234'], runtime);
    assert.equal(result.code, 0, result.json.error);
    assert.equal(calls[0].url, 'http://127.0.0.1:1234/v1/audio/voices');
    assert.equal(calls[0].init.body.get('voice_id'), 'akari-sample');
    assert.equal(calls[0].init.body.get('file').name, 'ref-recording.wav');
    result = await run(['try', '--profile', 'sample', '--engine', 'irodori', '--text', 'こんにちは', '--irodori-url', 'http://127.0.0.1:1234'], runtime);
    assert.equal(result.code, 0, result.json.error);
    assert.ok(result.json.path.startsWith(os.tmpdir())); assert.equal(result.json.duration_s, 1);
    assert.equal(JSON.parse(calls[1].init.body).voice, 'akari-sample');
    fs.rmSync(path.dirname(result.json.path), { recursive: true });
    result = await run(['delete', '--profile', 'sample', '--irodori-url', 'http://127.0.0.1:1234'], runtime);
    assert.equal(result.code, 0); assert.equal(calls[2].init.method, 'DELETE');
    assert.equal(calls[2].url, 'http://127.0.0.1:1234/v1/audio/voices/akari-sample');
    assert.equal(fs.existsSync(dir), false);
  } finally { box.cleanup(); }
});

test('profiles と resolve は新しい場所を優先し、旧形式を読み、migrate は旧を残す', async () => {
  const box = sandbox();
  try {
    const oldDir = path.join(box.env.HOME, '.config', 'akari-video', 'voice-profiles', 'owner-ja');
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'ref-recording.m4a'), 'old recording');
    fs.writeFileSync(path.join(oldDir, 'meta.json'), JSON.stringify({ profile: 'owner-ja', provider: 'fal-qwen3',
      embedding_source_url: 'https://example.invalid/embedding', reference_text: '原稿',
      reference: { original_path: '/elsewhere/original.m4a', verification: 'skipped by owner instruction (2026-07-20)' },
      consent: '本人の同意', created_at: '2026-07-20T00:00:00Z' }));
    let result = await run(['profiles'], { env: box.env });
    assert.equal(result.json.profiles.length, 1); assert.equal(result.json.profiles[0].legacy, true);
    const legacy = resolveVoiceProfile('owner-ja', box.env).meta;
    assert.equal(legacy.engines['fal-qwen3'].embedding_source_url, 'https://example.invalid/embedding');
    assert.equal(legacy.consent.legacy_record, '本人の同意');
    assert.deepEqual(legacy.reference.verification, { status: 'unavailable', legacy_record: 'skipped by owner instruction (2026-07-20)' });
    result = await run(['delete', '--profile', 'owner-ja'], { env: box.env }); assert.equal(result.code, 2);
    result = await run(['migrate-legacy', '--profile', 'owner-ja', '--avatar', 'person'], { env: box.env });
    assert.equal(result.code, 0, result.json.error); assert.equal(fs.existsSync(path.join(oldDir, 'meta.json')), true);
    const resolved = resolveVoiceProfile('owner-ja', box.env);
    assert.equal(resolved.legacy, false); assert.equal(resolved.meta.reference.file, 'ref-recording.m4a');
    assert.equal(resolved.meta.migrated_from, 'legacy');
    assert.equal(resolved.meta.consent.legacy_record, '本人の同意');
    assert.deepEqual(resolved.meta.reference.verification, { status: 'unavailable', legacy_record: 'skipped by owner instruction (2026-07-20)' });
    assert.equal(fs.readFileSync(path.join(resolved.dir, 'ref-recording.m4a'), 'utf8'), 'old recording');
    result = await run(['profiles', '--avatar', 'person'], { env: box.env });
    assert.equal(result.json.profiles.some(p => !p.legacy && p.id === 'owner-ja'), true);
    const customDir = path.join(box.env.HOME, '.config', 'akari-video', 'voice-profiles', 'custom-record');
    fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(path.join(customDir, 'ref-recording.wav'), fakeWav(1));
    const customConsent = { approved_by: 'self', recorded_at: '2026-07-20T00:00:00Z' };
    fs.writeFileSync(path.join(customDir, 'meta.json'), JSON.stringify({ profile: 'custom-record', consent: customConsent, reference: {} }));
    assert.deepEqual(resolveVoiceProfile('custom-record', box.env).meta.consent.legacy_record, customConsent);
    result = await run(['migrate-legacy', '--profile', 'custom-record', '--avatar', 'person'], { env: box.env });
    assert.equal(result.code, 0, result.json.error);
    assert.deepEqual(resolveVoiceProfile('custom-record', box.env).meta.consent.legacy_record, customConsent);
  } finally { box.cleanup(); }
});

const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
test('合成 wav の check 実計測', async t => {
  if (!ffmpeg) { t.skip('ffmpeg が無い: 実録音の音量・長さを計測できない'); return; }
  const box = sandbox();
  try {
    const file = path.join(box.root, 'synthetic.wav');
    const generated = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-filter:a', 'volume=0.3', '-ac', '1', '-ar', '48000', file]);
    assert.equal(generated.status, 0);
    const result = await checkVoiceRecording({ audio: file, script: 'quick-v1' }, { verifyScript: () => ({ status: 'unavailable' }) });
    assert.equal(result.pass, true); assert.equal(result.checks.duration.ok, true); assert.equal(result.checks.script.ok, 'unavailable');
  } finally { box.cleanup(); }
});

function fakeWav(seconds) {
  const buffer = Buffer.alloc(44 + 16000 * seconds * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40); return buffer;
}

test('fal の写しと試し読みはモック応答のみを使い、承認前には送信しない', async () => {
  const box = sandbox();
  try {
    const { dir } = writeMeta(box.env, 'person', 'sample');
    const calls = [];
    const runtime = { env: box.env, falKey: 'test-only', probeDuration: () => 1.25,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).includes('clone-voice')) return new Response(JSON.stringify({ speaker_embedding: { url: 'https://example.invalid/embedding' } }));
        if (String(url).includes('text-to-speech')) return new Response(JSON.stringify({ audio: { url: 'https://example.invalid/audio' } }));
        return new Response(Buffer.from('synthetic mp3'));
      } };
    let result = await run(['copy', '--profile', 'sample', '--engine', 'fal-qwen3', '--yes'], runtime);
    assert.equal(result.code, 0, result.json.error);
    assert.equal(calls.length, 1); assert.match(calls[0].url, /clone-voice\/1.7b$/);
    const payload = JSON.parse(calls[0].init.body);
    assert.match(payload.audio_url, /^data:audio\/wav;base64,/);
    assert.equal(payload.reference_text, VOICE_SCRIPTS['quick-v1']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'))).engines['fal-qwen3'].embedding_source_url, 'https://example.invalid/embedding');
    result = await run(['try', '--profile', 'sample', '--engine', 'fal-qwen3', '--text', 'こんにちは'], runtime);
    assert.equal(result.code, 2); assert.equal(calls.length, 1);
    result = await run(['try', '--profile', 'sample', '--engine', 'fal-qwen3', '--text', 'こんにちは', '--yes'], runtime);
    assert.equal(result.code, 0, result.json.error); assert.equal(result.json.duration_s, 1.25);
    assert.ok(result.json.path.startsWith(os.tmpdir()));
    fs.rmSync(path.dirname(result.json.path), { recursive: true });
  } finally { box.cleanup(); }
});

test('delete は彩の削除失敗時も手元を消し、fal 側が残ると警告する', async () => {
  const box = sandbox();
  try {
    const { dir } = writeMeta(box.env, 'person', 'sample', { engines: {
      irodori: { server: '127.0.0.1:1234', voice_id: 'akari-sample' },
      'fal-qwen3': { embedding_source_url: 'https://example.invalid/embedding' } } });
    let calls = 0;
    const result = await run(['delete', '--profile', 'sample'], { env: box.env, fetchImpl: async () => { calls++; return new Response('', { status: 503 }); } });
    assert.equal(result.code, 0); assert.equal(calls, 1); assert.equal(fs.existsSync(dir), false);
    assert.equal(result.json.warnings.length, 2);
  } finally { box.cleanup(); }
});
