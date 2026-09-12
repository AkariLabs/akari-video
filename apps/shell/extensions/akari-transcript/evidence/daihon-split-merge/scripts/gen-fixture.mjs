#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const FIXTURE = path.join(ROOT, 'fixture', 'project');
const FFMPEG = process.env.FFMPEG || path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
// 時刻は T1 カーネル（roundMs = 小数 3 桁）と同じ丸めで作る。浮動小数の誤差が残ると
// 「挿入語以外の語の時刻がバイト不変」を 1e-15 の差で落とす。
const round = value => Math.round(value * 1000) / 1000;
const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const tokens = text => [...segmenter.segment(text)].map(part => part.segment);
const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; }); child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1200)}`)));
});
const atomicWrite = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp-${process.pid}`; await writeFile(temporary, value); await rename(temporary, file); };

const definitions = [
  { id: 'c-0001', text: '分割できる最初の字幕', domain: 'source' },
  { id: 'c-0002', text: '結合ペア前半です', domain: 'source' },
  { id: 'c-0003', text: '結合ペア後半です', domain: 'source' },
  { id: 'c-0004', text: '出力時間の別行です', domain: 'output' },
  { id: 'c-0005', text: '非連続選択の確認行', domain: 'source' },
  { id: 'c-0006', text: 'もう一つ分割対象です', domain: 'source' }
];
let cursor = 1;
const captions = definitions.map((definition, segment) => {
  const start = round(cursor);
  const tokenTexts = tokens(definition.text);
  const words = tokenTexts.map((text, index) => ({ text, start: round(start + index * .45), end: round(start + index * .45 + .32) }));
  assert(tokenTexts.join('') === definition.text, `${definition.id}: token join mismatch`);
  assert(JSON.stringify(tokenTexts) === JSON.stringify(words.map(word => word.text)), `${definition.id}: words do not match tokens`);
  assert(words.slice(1).every((word, index) => word.start - words[index].end >= .1), `${definition.id}: word gap is less than 0.1 seconds`);
  const end = round(words.at(-1).end + .08); cursor = round(end + .72);
  return { id: definition.id, start, end, text: definition.text, speaker: null,
    sourceRef: { segment }, edited: true, time_domain: definition.domain, words };
});
const insertTarget = captions.find(caption => caption.id === 'c-0005');
const insertAt = 3;
const insertWord = '新語';
assert(insertTarget, 'c-0005: insertion target is missing');
const originalTokens = insertTarget.words.map(word => word.text);
assert(JSON.stringify(originalTokens) === JSON.stringify(['非', '連続', '選択', 'の', '確認', '行']), 'c-0005: unexpected source tokens');
const insertedText = originalTokens.slice(0, insertAt + 1).join('') + insertWord + originalTokens.slice(insertAt + 1).join('');
const expectedInsertedTokens = [...originalTokens.slice(0, insertAt + 1), insertWord, ...originalTokens.slice(insertAt + 1)];
assert(JSON.stringify(tokens(insertedText)) === JSON.stringify(expectedInsertedTokens), 'c-0005: inserted word is not one token');
const seconds = Math.ceil(captions.at(-1).end + 1); const media = path.join(FIXTURE, 'assets', 'base.mp4');
await mkdir(path.dirname(media), { recursive: true });
if (!await exists(media)) await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#27313f:s=320x180:r=30', '-t', String(seconds), '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42', '-pix_fmt', 'yuv420p', media], FIXTURE);
const edit = { version: 2, output: { width: 320, height: 180, fps: 30 }, sources: [{ id: 'main', path: 'assets/base.mp4' }], tracks: [
  { id: 'v-main', lane: 'visual', items: [{ id: 'main-clip', at: 0, duration: seconds * 30, source: { kind: 'media', src: 'main', in: 0, out: seconds } }] },
  { id: 'overlay', lane: 'visual', items: [{ id: 'anchored', at: 30, duration: 51, source: { kind: 'html', path: 'box.html' }, anchor: { caption: 'c-0001' } }] },
  { id: 'captions', lane: 'visual', content: { from: 'captions.json' } }
] };
await atomicWrite(path.join(FIXTURE, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
await atomicWrite(path.join(FIXTURE, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
await atomicWrite(path.join(FIXTURE, 'box.html'), '<!doctype html><style>body{margin:0;background:transparent}.box{margin:20px;border:3px solid #ffc74a;height:130px}</style><div class="box"></div>\n');
if (!await exists(path.join(FIXTURE, '.git'))) { await run('/usr/bin/git', ['init', '-q'], FIXTURE); await run('/usr/bin/git', ['config', 'user.email', 'fixture@localhost'], FIXTURE); await run('/usr/bin/git', ['config', 'user.name', 'Daihon Fixture'], FIXTURE); }
await run('/usr/bin/git', ['add', 'captions.json', 'edit.json', 'box.html'], FIXTURE);
const dirty = await new Promise(resolve => { const child = spawn('/usr/bin/git', ['diff', '--cached', '--quiet'], { cwd: FIXTURE }); child.once('close', code => resolve(code !== 0)); });
if (dirty) await run('/usr/bin/git', ['commit', '-qm', '台本分割結合 fixture'], FIXTURE);
process.stdout.write(`${JSON.stringify({ ok: true, rows: captions.length, splitRows: 3, mergePairs: 2, anchor: 'c-0001' })}\n`);
