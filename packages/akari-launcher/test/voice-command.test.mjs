import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runVoiceCommand, checkVoiceRecording, resolveVoiceProfile, VOICE_SCRIPTS } from '../src/voice-command.mjs';

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

test('scripts は固有名詞を含まず 2 本を返す', async () => {
  const box = sandbox();
  try {
    const result = await run(['scripts'], { env: box.env });
    assert.equal(result.code, 0); assert.equal(result.json.scripts.length, 2);
    for (const script of result.json.scripts) assert.doesNotMatch(script.text, /アカリ|AKARI|Akari/);
    assert.equal(VOICE_SCRIPTS['extended-v1'].split('。').filter(Boolean).length, 8);
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
