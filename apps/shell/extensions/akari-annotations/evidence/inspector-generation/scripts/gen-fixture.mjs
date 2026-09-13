#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SOURCE = path.join(REPO, 'apps', 'shell', 'extensions', 'akari-annotations', 'test', 'fixtures', 'inspector-generation');
const PROJECT = path.join(ROOT, 'fixture', 'project');
const FFMPEG = process.env.FFMPEG || path.join(REPO, 'packages', 'media-bin', 'vendor', 'darwin-arm64', 'ffmpeg');

const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`)));
});
const atomicJson = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
};

await rm(path.join(ROOT, 'fixture'), { recursive: true, force: true });
await mkdir(path.join(PROJECT, 'assets', 'stills'), { recursive: true });
await mkdir(path.join(PROJECT, '.akari'), { recursive: true });
await copyFile(path.join(SOURCE, 'edit.json'), path.join(PROJECT, 'edit.json'));
// connections.json はここで書き起こす（コピー元にしない）。リポジトリの .gitignore が
// `.akari/` を丸ごと無視するため、test/fixtures/ 側に置いても取り込まれず、
// 新しいクローンでは copyFile が ENOENT で落ちる。
await atomicJson(path.join(PROJECT, '.akari', 'connections.json'), {
  providers: [],
  defaults: { generate: { still: 'codex-image', video: 'fal:h3-i2v' } },
  policy: { currency: 'USD', monthly_budget: null, approval_threshold: null },
  memory: []
});

for (const [name, color] of [['a', '#d6402b'], ['b', '#1f6f8b'], ['c', '#2e8b57']]) {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360`,
    '-frames:v', '1', path.join(PROJECT, 'assets', 'stills', `${name}.png`)
  ], PROJECT);
}

await atomicJson(path.join(PROJECT, 'assets', 'stills', 'c.png.meta.json'), {
  version: 1, kind: 'video', status: 'planned',
  provenance: { created_at: new Date().toISOString(), tool: 'l1-inspector-generation-fixture' }
});
await atomicJson(path.join(PROJECT, 'captions.json'), { captions: [] });

// 実カタログの正規化結果を UI で観測する。文字列 "6" は validator が Veo の既定 8 秒へ
// 正規化するため、03 で「6 秒 → 8 秒」を再現できる。
await atomicJson(path.join(PROJECT, '.akari', 'generation', 'clip-a.inputs.json'), {
  modelId: 'fal:h3-i2v',
  inputs: {
    prompt: '看板へゆっくり寄る', negative_prompt: null,
    first_frame: { path: 'assets/stills/a.png', source_id: 'still-a' },
    last_frame: null, reference_images: [], reference_audios: [], camera: null
  },
  output: { duration_s: '6', resolution: '768P', audio_out: true }
});

const edit = JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
process.stdout.write(`${JSON.stringify({
  ok: true,
  project: 'evidence/inspector-generation/fixture/project',
  clips: edit.tracks?.[0]?.items?.map(item => item.id) ?? [],
  sidecars: ['assets/stills/c.png.meta.json'],
  captions: true
})}\n`);
