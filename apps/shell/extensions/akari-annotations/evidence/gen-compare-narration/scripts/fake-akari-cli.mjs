#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../../');
const realCli = join(root, 'packages/akari-launcher/bin/akari.mjs');
const value = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const log = entry => {
  if (process.env.AKARI_AI_NARRATION_CALLS_FILE) appendFileSync(process.env.AKARI_AI_NARRATION_CALLS_FILE,
    JSON.stringify({ at: Date.now(), ...entry }) + '\n');
};
const emit = data => process.stdout.write(JSON.stringify(data) + '\n');

log({ args });
if (args[0] !== 'narration') {
  const child = spawnSync(process.execPath, [realCli, ...args], { stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  process.exit(child.status ?? 1);
}
if (args[1] === 'engines') {
  emit({ version: 1, engines: [
    { id: 'voicevox', label: 'VOICEVOX', place: 'local',
      price: { usd_per_1000_chars: 0, verified: true },
      availability: { state: 'available', label: '使える' }, supports: { speed: true, style: false } },
    { id: 'gemini-tts', label: 'Gemini 2.5 Flash TTS', place: 'cloud', provider: 'fal',
      price: { usd_per_1000_chars: 0.04, verified: false, as_of: '2026-09-22' },
      availability: { state: 'available', label: '使える' }, supports: { speed: false, style: true } },
    { id: 'fal-qwen3', label: '自声', place: 'cloud', provider: 'fal',
      price: { usd_per_1000_chars: 0.2, verified: true, as_of: '2026-09-24' },
      availability: { state: 'available', label: '使える' }, supports: { speed: false, style: false } }
  ] });
} else if (args[1] === 'voices') {
  const engine = value('--engine');
  emit({ version: 1, engine, voices: engine === 'voicevox'
    ? [{ id: '1', label: '四国めたん', default: true }, { id: '2', label: 'ずんだもん' }]
    : engine === 'fal-qwen3' ? [{ id: 'self', label: '自声プロファイル', default: true }]
      : [{ id: 'Leda', label: 'Leda', default: true }, { id: 'Aoede', label: 'Aoede' }] });
} else if (args[1] === 'generate') {
  const engine = value('--engine');
  const project = value('--project');
  const requested = value('--out');
  if (!project || !requested || !requested.startsWith('assets/generated/candidates/')) throw new Error('candidate output missing');
  const control = JSON.parse(readFileSync(process.env.AKARI_AI_NARRATION_CONTROL_FILE, 'utf8'));
  if (engine !== 'voicevox') {
    const url = process.env.AKARI_FAL_STUB_URL;
    if (!/^http:\/\/127\.0\.0\.1:\d+\/$/u.test(url ?? '')) throw new Error('local fal stub required');
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engine, voice: value('--voice') }) });
    if (!response.ok) throw new Error('local fal stub failed');
  }
  log({ received: engine, voice: value('--speaker') ?? value('--voice'), out: requested });
  if (control.failEngine === engine) { process.stderr.write('stub model failure\n'); process.exit(2); }
  const settings = { voicevox: { seconds: 0.55, hz: 330, delay: 1700 },
    'gemini-tts': { seconds: 0.78, hz: 440, delay: 2400 },
    'fal-qwen3': { seconds: 1.02, hz: 550, delay: 3100 } };
  const spec = settings[engine];
  if (!spec) throw new Error('unexpected engine: ' + engine);
  await new Promise(resolve => { const timer = setTimeout(resolve, control.delayMs ?? spec.delay);
    process.once('SIGTERM', () => { clearTimeout(timer); process.exit(143); }); });
  const seconds = spec.seconds;
  const sampleRate = 16000; const samples = Math.round(seconds * sampleRate);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * spec.hz * i / sampleRate) * 3200), i * 2);
  const wav = Buffer.alloc(44 + pcm.length); wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  const relativePath = requested;
  const output = join(project, relativePath); mkdirSync(dirname(output), { recursive: true });
  const audio = engine === 'voicevox' ? wav : spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-f', 'mp3', 'pipe:1'],
    { input: wav, maxBuffer: 1024 * 1024 }).stdout;
  if (!audio?.length) throw new Error('stub mp3 encoding failed');
  writeFileSync(output, audio);
  emit({ version: 1, status: 'ok', id: null, path: relativePath, duration_s: seconds,
    engine, voice: value('--speaker') ?? value('--voice'), cost_usd: engine === 'voicevox' ? 0 : engine === 'gemini-tts' ? 0.003 : 0.006,
    applied: false, caption_ref: null, provenance: { provider: engine, voice: value('--speaker') ?? value('--voice') }, warnings: [] });
} else {
  throw new Error(`unexpected narration command: ${args.join(' ')}`);
}
