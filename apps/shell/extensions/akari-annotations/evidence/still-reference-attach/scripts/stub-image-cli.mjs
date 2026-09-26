// 検証用のスタブ CLI（codex / grok / agy 共通）。本物の画像生成は呼ばない。
// - 受け取った引数と Codex app-server の turn/start の input を STUB_LOG へ 1 行 JSON で追記する
// - 指示文の「絶対パス <png>」へ、STUB_SIZE_FILE に書かれた寸法（例 1254x1254）の PNG を書く
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { deflateSync } from 'node:zlib';
import readline from 'node:readline';

const route = basename(process.argv[1]);
const log = async entry => { if (process.env.STUB_LOG) await appendFile(process.env.STUB_LOG, `${JSON.stringify({ route, ...entry })}\n`); };
const size = async () => {
  const text = process.env.STUB_SIZE_FILE ? (await readFile(process.env.STUB_SIZE_FILE, 'utf8').catch(() => '')).trim() : '';
  const [width, height] = (text || '1254x1254').split('x').map(Number);
  return { width, height };
};
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1; }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const tag = Buffer.from(name);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const check = Buffer.alloc(4); check.writeUInt32BE(crc(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, check]);
}
// 同心円の的（中央で切り抜かれたことが目で分かる絵）
function png({ width, height }) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const colors = { codex: [[40, 90, 200], [250, 250, 250]], grok: [[40, 160, 90], [250, 250, 250]], agy: [[230, 110, 40], [250, 250, 250]] }[route];
  const scan = Buffer.alloc(height * (1 + width * 3));
  const cx = width / 2, cy = height / 2, unit = Math.min(width, height) / 12;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ring = Math.floor(Math.hypot(x - cx, y - cy) / unit) % 2;
    const edge = x < 24 || y < 24 || x >= width - 24 || y >= height - 24;
    const color = edge ? [220, 40, 40] : colors[ring];
    const at = y * (1 + width * 3) + 1 + x * 3;
    scan[at] = color[0]; scan[at + 1] = color[1]; scan[at + 2] = color[2];
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(scan)), chunk('IEND', Buffer.alloc(0))]);
}
async function writeOutput(prompt) {
  const output = prompt.match(/絶対パス\s+(\S+\.png)/u)?.[1];
  if (!output) throw new Error('output path missing');
  const dims = await size();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, png(dims));
  return { output, ...dims };
}

if (route === 'codex' && process.argv[2] === 'login' && process.argv[3] === 'status') {
  console.log('Logged in using ChatGPT');
  process.exit(0);
}
if (route !== 'codex' && process.argv[2] === 'models') {
  console.log(route === 'grok' ? 'You are logged in with grok.com.' : 'Fetching available models...\ngemini-image\tGemini Image');
  process.exit(0);
}
if (route === 'codex') {
  if (process.argv[2] !== 'app-server') process.exit(2);
  await log({ args: process.argv.slice(2) });
  const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
  for await (const line of readline.createInterface({ input: process.stdin })) {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') send({ jsonrpc: '2.0', id: msg.id, result: {} });
    if (msg.method === 'thread/start') send({ jsonrpc: '2.0', id: msg.id, result: { thread: { id: 'stub-thread' } } });
    if (msg.method === 'turn/start') {
      send({ jsonrpc: '2.0', id: msg.id, result: { turn: { id: 'stub-turn' } } });
      const written = await writeOutput(msg.params.input?.find(row => row.type === 'text')?.text ?? '');
      await log({ turnStartInput: msg.params.input, wrote: written });
      send({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: msg.params.threadId, turn: { status: 'completed' } } });
    }
  }
} else {
  const prompt = process.argv[process.argv.indexOf('-p') + 1] ?? '';
  const written = await writeOutput(prompt);
  await log({ args: process.argv.slice(2), wrote: written });
  console.log(written.output);
}
