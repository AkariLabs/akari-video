// 一時 HOME の VOICEVOX 音声だけで CLI 証跡を再生成する。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runNarrationCommand, resolveVoicevoxRunPath } from '../../src/narration-command.mjs';
import { runVoiceCommand, VOICE_SCRIPTS } from '../../src/voice-command.mjs';

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-voice-followups-'));
const saved = Object.fromEntries(['HOME', 'AKARI_HOME', 'AKARI_CREDENTIALS_FILE', 'FAL_KEY', 'VOICEVOX_RUN'].map(key => [key, process.env[key]]));
process.env.HOME = root;
process.env.AKARI_HOME = path.join(root, 'akari');
delete process.env.AKARI_CREDENTIALS_FILE;
delete process.env.FAL_KEY;
const engine = resolveVoicevoxRunPath();
assert.match(engine, /vv-engine[/\\]run$/);
assert.ok(fs.existsSync(engine), 'VOICEVOX のヘッドレスエンジンが必要です');
process.env.VOICEVOX_RUN = engine;

function redact(value) {
  if (typeof value === 'string') return value.replaceAll(root, '<temporary-home>').replaceAll(os.userInfo().username, '<user>');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  return value;
}
async function voice(name, args, runtime = {}) {
  const lines = [], errors = [];
  const result = await runVoiceCommand([...args, '--json'], { env: process.env, ...runtime,
    log: line => lines.push(line), logError: message => errors.push(message) });
  assert.equal(result.exitCode, 0, `${name}: ${errors.join(' ')} ${lines.join(' ')}`);
  assert.equal(lines.length, 1);
  const json = redact(JSON.parse(lines[0]));
  fs.writeFileSync(path.join(evidenceDir, `${name}.json`), `${JSON.stringify(json, null, 2)}\n`);
  return json;
}
async function synthesize(id, text) {
  const source = path.join(root, `${id}.txt`);
  fs.writeFileSync(source, text);
  const lines = [];
  const result = await runNarrationCommand(['generate', '--project', root, '--engine', 'voicevox', '--speaker', '3',
    '--speed', '0.65', '--reading-file', source, '--id', id, '--json'],
    { log: line => lines.push(line), logError: message => { throw new Error(`VOICEVOX: ${message}`); } });
  assert.equal(result.exitCode, 0, `VOICEVOX: ${lines.join(' ')}`);
  const wav = path.join(root, JSON.parse(lines[0]).path);
  const normalized = path.join(root, `${id}-normalized.wav`);
  const convert = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-af', 'volume=0.85', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', normalized]);
  assert.equal(convert.status, 0, convert.stderr?.toString());
  return normalized;
}

try {
  const quick = await synthesize('n-0001', VOICE_SCRIPTS['quick-v1']);
  const extended = await synthesize('n-0002', VOICE_SCRIPTS['extended-v1']);
  const created = await voice('create', ['create', '--avatar', 'person', '--id', 'sample', '--label', '合成テスト',
    '--audio', quick, '--script', 'quick-v1', '--consent-self']);
  assert.ok(created.meta.reference.verification.score >= 0.7);
  await voice('rename', ['rename', '--profile', 'sample', '--label', '追加録音済み']);
  await voice('copy-local-mock', ['copy', '--profile', 'sample', '--engine', 'irodori'],
    { fetchImpl: async () => new Response('{}') });
  const extendedResult = await voice('extend', ['extend', '--profile', 'sample', '--audio', extended, '--script', 'extended-v1']);
  assert.ok(extendedResult.warnings.length > 0);
  const profiles = await voice('profiles', ['profiles']);
  assert.equal(profiles.profiles[0].copies.irodori.stale, true);
  const files = fs.readdirSync(evidenceDir).filter(name => name.endsWith('.json'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(evidenceDir, file), 'utf8');
    assert.equal(content.includes(root), false);
    assert.equal(content.includes(os.userInfo().username), false);
    assert.doesNotMatch(content, /(?:\/Users\/|\/private\/|\/var\/folders\/|FAL_KEY|Key [A-Za-z0-9])/);
  }
  process.stdout.write(`Generated ${files.length} JSON files; quick and extended VOICEVOX checks passed.\n`);
} finally {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  fs.rmSync(root, { recursive: true, force: true });
}
