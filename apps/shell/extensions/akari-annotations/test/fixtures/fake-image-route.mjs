import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { resolveFfmpeg } from '../../../../../../packages/media-bin/src/index.mjs';

const WIDTH = 320;
const HEIGHT = 180;
const palettes = {
  agy: [[247, 116, 42], [255, 211, 73], [165, 50, 45]],
  grok: [[58, 176, 95], [175, 234, 92], [29, 105, 139]]
};
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const tag = Buffer.from(name);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const check = Buffer.alloc(4); check.writeUInt32BE(crc(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, check]);
}
function routePng(name) {
  const colors = palettes[name] ?? [[54, 94, 213], [98, 173, 255], [27, 51, 128]];
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH); header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(HEIGHT * (1 + WIDTH * 3));
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const stripe = (x + y) % 88 < 24;
      const center = x > 100 && x < 220 && y > 57 && y < 123;
      const color = colors[center ? 2 : stripe ? 1 : 0];
      const at = y * (1 + WIDTH * 3) + 1 + x * 3;
      pixels[at] = color[0]; pixels[at + 1] = color[1]; pixels[at + 2] = color[2];
    }
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

const route = basename(process.argv[1]);
const stateFile = process.env.FAKE_IMAGE_STATE_FILE;
const state = async () => stateFile ? (await readFile(stateFile, 'utf8').catch(() => 'ready')).trim() : 'ready';
const mode = await state();
if (process.env.FAKE_IMAGE_LOG) await appendFile(process.env.FAKE_IMAGE_LOG,
  `${JSON.stringify({ route, args: process.argv.slice(2), keys: ['FAL_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'XAI_API_KEY'].filter(name => name in process.env) })}\n`);
if (process.argv[2] === 'models') {
  if (mode === 'sleep') await sleep(7000);
  if (route === 'grok') {
    if (mode === 'transient') {
      const countFile = `${stateFile}.count`;
      const count = Number(await readFile(countFile, 'utf8').catch(() => '0')) + 1;
      await writeFile(countFile, String(count));
      console.log(count === 1 ? 'You are not authenticated. person@example.com' : 'You are logged in with grok.com. person@example.com');
    } else console.log(mode === 'signed-out' ? 'You are not authenticated. person@example.com' : 'You are logged in with grok.com. person@example.com');
    process.exit(0);
  }
  if (mode === 'signed-out') { console.error('Sign in required: person@example.com'); process.exit(1); }
  console.log('Fetching available models...\ngemini-image\tGemini Image');
  process.exit(0);
}
if (mode === 'delay') await sleep(3000);
if (mode === 'fail') { console.error('Image failed: person@example.com'); process.exit(1); }
const prompt = process.argv[process.argv.indexOf('-p') + 1];
const output = prompt.match(/絶対パス\s+(\S+\.png)/u)?.[1];
if (!output) process.exit(2);
if (mode === 'missing-png') { console.log('image_gen returned no image'); process.exit(0); }
await mkdir(dirname(output), { recursive: true });
const png = routePng(route);
if (mode === 'jpeg' || mode === 'jpeg-sibling') {
  const jpegOutput = mode === 'jpeg-sibling' ? output.replace(/\.png$/iu, '.jpg') : output;
  const temp = await mkdtemp(join(tmpdir(), 'akari-jpeg-fixture-'));
  try {
    const source = join(temp, 'source.png');
    await writeFile(source, png);
    const code = spawnSync(resolveFfmpeg(), ['-loglevel', 'error', '-y', '-i', source, '-f', 'image2', '-c:v', 'mjpeg', jpegOutput], { stdio: 'ignore' }).status;
    if (code !== 0) throw new Error(`JPEG fixture conversion failed (${code})`);
  } finally { await rm(temp, { recursive: true, force: true }); }
} else {
  await writeFile(output, png);
}
console.log(output);
