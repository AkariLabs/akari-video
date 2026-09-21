#!/usr/bin/env node
// L1 fixture（ラッパーが検証用に用意する素材）: 生成状態 6 種の映像 item + サイドカー。
//   静止画（サイドカー無し） / planned / generating（progress 62） / stale / done（動画） / failed
// generating は「今」起動した job、stale は stale_after_s を超えた job として毎回書き直す
// （固定日付だと実行日によって generating が stale に化けるため）。
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const FIXTURE_ROOT = path.join(ROOT, 'fixture');
const FIXTURE = path.join(FIXTURE_ROOT, 'project');
const GENERATED = path.join(FIXTURE, 'assets', 'generated');
// done の meta.json は w0 スパイク（lab/2026-09-13-w0-spikes）の実物を写したもの。
// 公開リポ側の写し（指示 5 のテスト fixture）を出所にして、作業機の外部パスを証跡へ残さない。
const DONE_META_SOURCE = path.join(
  ROOT, '..', '..', 'test', 'fixtures', 'generation-states', 'assets', 'generated', 'done.mp4.meta.json'
);
const FFMPEG = process.env.FFMPEG || path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FPS = 30;
const CLIP_FRAMES = 60;
const exists = async file => { try { await stat(file); return true; } catch { return false; } };
const atomicWrite = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, value);
  await rename(temporary, file);
};
const writeJson = (file, value) => atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`)));
});

const STATES = [
  { id: 'still', file: 'still.png', color: '#2c6e8a' },
  { id: 'planned', file: 'planned.png', color: '#3a3f4a' },
  { id: 'generating', file: 'generating.png', color: '#7a6a24' },
  { id: 'stale', file: 'stale.png', color: '#6a5a2a' },
  { id: 'done', file: 'done.mp4', color: '#2e4a5e' },
  { id: 'failed', file: 'failed.png', color: '#7a2f24' },
  { id: 'next-first-last', file: 'next-first-last.png', color: '#24789a' },
  { id: 'next-first', file: 'next-first.png', color: '#a07020' },
  { id: 'next-prompt', file: 'next-prompt.png', color: '#34304a' }
];

await rm(FIXTURE_ROOT, { recursive: true, force: true });
await mkdir(GENERATED, { recursive: true });

for (const state of STATES) {
  const target = path.join(GENERATED, state.file);
  if (state.file.endsWith('.mp4')) {
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${state.color}:s=320x180:r=${FPS}`,
      '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '42',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target
    ], GENERATED);
  } else {
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${state.color}:s=320x180`,
      '-frames:v', '1', target
    ], GENERATED);
  }
}

const now = Date.now();
const iso = ms => new Date(ms).toISOString();
// 静止画（still.png）はサイドカーを置かない — meta が無くても「静止画」バッジが出ることの実証。
await writeJson(path.join(GENERATED, 'planned.png.meta.json'), {
  version: 1, kind: 'still', status: 'planned',
  provenance: { created_at: iso(now), tool: 'l1-fixture' }
});
await writeJson(path.join(GENERATED, 'generating.png.meta.json'), {
  version: 1, kind: 'still', status: 'generating', progress: 62,
  job: { provider: 'fal', request_id: 'l1-generating', started_at: iso(now), stale_after_s: 900 }
});
await writeJson(path.join(GENERATED, 'stale.png.meta.json'), {
  version: 1, kind: 'still', status: 'generating',
  job: { provider: 'fal', request_id: 'l1-stale', started_at: iso(now - 1000 * 1000), stale_after_s: 900 }
});
await writeJson(path.join(GENERATED, 'failed.png.meta.json'), {
  version: 1, kind: 'still', status: 'failed',
  history: [{ at: iso(now), status: 'failed', reason: 'timeout' }]
});

// path と sha256 を生成したフィクスチャへ合わせる。
if (!await exists(DONE_META_SOURCE)) throw new Error(`done の meta.json が見つかりません: ${DONE_META_SOURCE}`);
await cp(DONE_META_SOURCE, path.join(GENERATED, 'done.mp4.meta.json'));
const doneMeta = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(GENERATED, 'done.mp4.meta.json'), 'utf8'));
doneMeta.result.path = 'assets/generated/done.mp4';
doneMeta.inputs.first_frame.path = 'assets/generated/still.png';
doneMeta.inputs.last_frame.path = 'assets/generated/planned.png';
doneMeta.result.sha256 = createHash('sha256').update(await readFile(path.join(GENERATED, 'done.mp4'))).digest('hex');
for (const frame of [doneMeta.inputs.first_frame, doneMeta.inputs.last_frame]) {
  if (frame.sha256 !== undefined) {
    frame.sha256 = createHash('sha256').update(await readFile(path.join(FIXTURE, frame.path))).digest('hex');
  }
}
// 証跡に外部 URL・provider の request id を残さない。
doneMeta.job.status_url = null;
doneMeta.job.response_url = null;
doneMeta.result.expanded_prompt = '(省略)';
await writeJson(path.join(GENERATED, 'done.mp4.meta.json'), doneMeta);

// 単体テストと同じ next 3 種。L1 の実画像に合わせて hash を実測し直す。
for (const name of ['next-first-last', 'next-first', 'next-prompt']) {
  const meta = JSON.parse(await readFile(path.join(path.dirname(DONE_META_SOURCE), `${name}.png.meta.json`), 'utf8'));
  if (name === 'next-first-last') meta.next.inputs.first_frame.path = 'assets/generated/next-first-last.png';
  if (name === 'next-first') meta.next.inputs.first_frame.path = 'assets/generated/next-first.png';
  for (const frame of [meta.next.inputs.first_frame, meta.next.inputs.last_frame]) {
    if (frame?.path) frame.sha256 = createHash('sha256').update(await readFile(path.join(FIXTURE, frame.path))).digest('hex');
  }
  meta.result.sha256 = createHash('sha256').update(await readFile(path.join(GENERATED, `${name}.png`))).digest('hex');
  await writeJson(path.join(GENERATED, `${name}.png.meta.json`), meta);
}

const edit = {
  version: 2,
  output: { width: 640, height: 360, fps: FPS },
  sources: STATES.map(state => ({ id: state.id, path: `assets/generated/${state.file}` })),
  tracks: [{
    id: 'video', lane: 'visual', name: '生成状態',
    items: STATES.map((state, index) => ({
      id: `clip-${state.id}`, name: state.file,
      at: index * CLIP_FRAMES, duration: CLIP_FRAMES,
      source: { kind: 'media', src: state.id, in: 0, out: CLIP_FRAMES / FPS }
    }))
  }]
};
await writeJson(path.join(FIXTURE, 'edit.json'), edit);
await writeJson(path.join(FIXTURE, 'captions.json'), { captions: [] });
await run('/usr/bin/git', ['init'], FIXTURE);
await run('/usr/bin/git', ['config', 'user.email', 'generation-states-fixture@localhost'], FIXTURE);
await run('/usr/bin/git', ['config', 'user.name', 'Generation States Fixture'], FIXTURE);
await run('/usr/bin/git', ['add', 'edit.json', 'captions.json'], FIXTURE);
await run('/usr/bin/git', ['commit', '-m', '生成状態 L1 fixture'], FIXTURE);

process.stdout.write(`${JSON.stringify({
  ok: true,
  states: STATES.map(state => state.id),
  sidecars: STATES.filter(state => state.id !== 'still').map(state => state.file),
  stillWithoutSidecar: 'still.png',
  clipFrames: CLIP_FRAMES,
  fps: FPS
})}\n`);
