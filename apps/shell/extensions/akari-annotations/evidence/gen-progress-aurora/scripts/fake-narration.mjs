#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const reply = value => process.stdout.write(JSON.stringify(value) + '\n');
if (args[0] !== 'narration') process.exit(2);
if (args[1] === 'engines') {
  reply({ version: 1, engines: [{ id: 'voicevox', label: 'VOICEVOX', place: 'local',
    availability: { state: 'available', label: '使える' },
    price: { usd_per_1000_chars: 0, verified: true }, default_voice: '1',
    supports: { speed: true, style: false, clone: 'none' } }] });
  process.exit(0);
}
if (args[1] === 'voices') {
  reply({ version: 1, engine: option('--engine'), voices: [{ id: '1', label: 'テストの声', default: true }] });
  process.exit(0);
}
if (args[1] !== 'generate') process.exit(2);
const root = option('--project');
const id = option('--id');
if (!root || !/^n-\d{4}$/u.test(id)) process.exit(2);
await sleep(Number(process.env.FAKE_NARRATION_DELAY_MS ?? 20000));
if (process.env.FAKE_NARRATION_STATE_FILE
    && (await readFile(process.env.FAKE_NARRATION_STATE_FILE, 'utf8')).trim() === 'fail') {
  reply({ error: '読み上げを作れませんでした' });
  process.exit(1);
}
const relativePath = `out/narration/${id}.wav`;
const target = join(root, relativePath);
await mkdir(dirname(target), { recursive: true });
const frames = 48000;
const data = Buffer.alloc(frames * 2 * 2);
const wav = Buffer.alloc(44 + data.length);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(48000 * 4, 28);
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
wav.writeUInt32LE(data.length, 40); data.copy(wav, 44);
await writeFile(target, wav);
reply({ version: 1, status: 'ok', id, path: relativePath, duration_s: 1,
  engine: 'voicevox', voice: '1', applied: false });
