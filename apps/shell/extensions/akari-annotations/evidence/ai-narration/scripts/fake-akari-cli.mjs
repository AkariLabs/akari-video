#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../../');
const realCli = join(root, 'packages/akari-launcher/bin/akari.mjs');
const value = name => args[args.indexOf(name) + 1];
const log = entry => {
  if (process.env.AKARI_AI_NARRATION_CALLS_FILE) appendFileSync(process.env.AKARI_AI_NARRATION_CALLS_FILE,
    JSON.stringify(entry) + '\n');
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
      availability: { state: 'available', label: '使える' }, supports: { speed: false, style: true } }
  ] });
} else if (args[1] === 'voices') {
  const engine = value('--engine');
  emit({ version: 1, engine, voices: engine === 'voicevox'
    ? [{ id: '1', label: '四国めたん', default: true }, { id: '2', label: 'ずんだもん' }]
    : [{ id: 'Leda', label: 'Leda', default: true }, { id: 'Aoede', label: 'Aoede' }] });
} else if (args[1] === 'generate') {
  const engine = value('--engine');
  if (engine !== 'voicevox') {
    log({ paidAttempt: engine });
    process.stderr.write('L1 fake CLI blocks paid narration\n');
    process.exit(2);
  }
  const project = value('--project'); const id = value('--id');
  if (!project || !id || !/^n-\d{4}$/u.test(id)) throw new Error('project/id missing');
  const seconds = Number(readFileSync(process.env.AKARI_AI_NARRATION_DURATION_FILE, 'utf8').trim());
  if (![1.5, 3.5].includes(seconds)) throw new Error('unexpected L1 duration');
  const sampleRate = 16000; const samples = Math.round(seconds * sampleRate);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 3200), i * 2);
  const wav = Buffer.alloc(44 + pcm.length); wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  const relativePath = `out/narration/${id}.wav`;
  const output = join(project, relativePath); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, wav);
  emit({ version: 1, status: 'ok', id, path: relativePath, duration_s: seconds,
    engine, voice: value('--speaker'), cost_usd: 0, applied: false, caption_ref: null,
    provenance: { provider: 'voicevox', voice: value('--speaker') }, warnings: [] });
} else {
  throw new Error(`unexpected narration command: ${args.join(' ')}`);
}
