#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import readline from 'node:readline';

const state = async () => process.env.FAKE_CODEX_STATE_FILE
  ? (await readFile(process.env.FAKE_CODEX_STATE_FILE, 'utf8').catch(() => 'ready')).trim()
  : process.env.FAKE_CODEX_MODE ?? 'ready';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1; }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const tag = Buffer.from(name);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const check = Buffer.alloc(4); check.writeUInt32BE(crc(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, check]);
}
function png(width = 160, height = 90) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const scan = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * (1 + width * 3) + 1 + x * 3;
    scan[at] = 40 + Math.round(150 * x / width); scan[at + 1] = 60 + Math.round(110 * y / height); scan[at + 2] = 180;
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(scan)), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv[2] === 'login' && process.argv[3] === 'status') {
  if (await state() === 'sleep') await sleep(7000);
  if (await state() === 'signed-out') { console.log('Sign in required: person@example.com'); process.exit(1); }
  console.log('Logged in using ChatGPT person@example.com');
  process.exit(0);
}
if (process.argv[2] !== 'app-server') process.exit(2);
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
for await (const line of readline.createInterface({ input: process.stdin })) {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: {} });
  if (msg.method === 'thread/start') send({ jsonrpc: '2.0', id: msg.id, result: { thread: { id: 'fake-thread' } } });
  if (msg.method === 'turn/start') {
    send({ jsonrpc: '2.0', id: msg.id, result: { turn: { id: 'fake-turn' } } });
    if (await state() === 'fail') {
      send({ jsonrpc: '2.0', method: 'turn/failed', params: { threadId: msg.params.threadId,
        turn: { status: 'failed', error: { message: '画像を作れません: person@example.com' } } } });
      continue;
    }
    await sleep(Number(process.env.FAKE_CODEX_DELAY_MS ?? 500));
    const prompt = msg.params.input?.[0]?.text ?? '';
    const output = prompt.match(/絶対パス\s+(\S+\.png)/u)?.[1];
    if (!output) throw new Error('output path missing');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, png());
    send({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: msg.params.threadId,
      turn: { status: 'completed' } } });
  }
}
