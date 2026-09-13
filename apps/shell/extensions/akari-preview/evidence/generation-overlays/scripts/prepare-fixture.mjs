#!/usr/bin/env node
// generation-overlays L1 fixture (wrapper-authored verification script).
//
// 7 クリップを 4 秒ずつ並べた出力プレビュー用プロジェクト。各クリップのソースの隣に
// <path>.meta.json（生成 v0 契約 §3 のサイドカー）を置き、
// 再生ヘッドをそのクリップへ送ったときの小札・帯・シマー・編集領域の点線を実機で観る。
//
//   0- 4s still      サイドカー無しの png              → 「静止画（仮枠） · <名前>」
//   4- 8s planned    status:"planned"                  → 「planned · <名前>」
//   8-12s generating status:"generating"（started_at = 実行時刻）→ 小札 + 帯 + シマー
//  12-16s stale      status:"generating" + 古い started_at + stale_after_s:900 → 「応答なし」
//  16-20s done       status:"done"（w0 スパイクの実 meta を写す）→ 何も出さない
//  20-24s failed     status:"failed" / error.reason:"timeout" → 朱の小札
//  24-28s frames     kind:"frames" / output.fps:8 / inputs.extra.mask_rect → パラパラ + 点線
//
// Usage: node prepare-fixture.mjs <workspace> <ffmpeg> <repoRoot>
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , workspace, ffmpeg = 'ffmpeg', repoRoot] = process.argv;
if (!workspace || !repoRoot) throw new Error('usage: prepare-fixture.mjs <workspace> <ffmpeg> <repoRoot>');
const project = path.join(workspace, 'project');
const assets = path.join(project, 'assets');
await mkdir(assets, { recursive: true });

const run = (args) => {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || `ffmpeg exited ${r.status}`);
};

const CLIPS = [
  { key: 'still', name: 'ビート 1 フック', hue: '0x1d3a4f', ext: 'png' },
  { key: 'planned', name: 'ビート 2 課題', hue: '0x101010', ext: 'png' },
  { key: 'generating', name: 'ビート 3 解決', hue: '0x3a2f1d', ext: 'png' },
  { key: 'stale', name: 'ビート 4 実演', hue: '0x2f1d3a', ext: 'png' },
  { key: 'done', name: 'ビート 5 完成', hue: '0x1d4f3a', ext: 'mp4' },
  { key: 'failed', name: 'ビート 6 失敗', hue: '0x4f1d1d', ext: 'png' },
  { key: 'frames', name: 'ビート 7 犬の散歩', hue: '0x1d4f4f', ext: 'png' },
];

for (const clip of CLIPS) {
  const out = path.join(assets, `${clip.key}.${clip.ext}`);
  if (clip.ext === 'mp4') {
    run(['-f', 'lavfi', '-i', `color=c=${clip.hue}:s=1920x1080:d=6:r=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
  } else {
    run(['-f', 'lavfi', '-i', `color=c=${clip.hue}:s=1920x1080:d=1:r=1`, '-frames:v', '1', out]);
  }
}

const iso = (ms) => new Date(ms).toISOString();
const now = Date.now();

const baseModel = { id: 'fal:h3-i2v', endpoint: 'minimax/h3/image-to-video', as_of: '2026-09-12' };
const baseInputs = () => ({
  prompt: '[Tracking shot] a quiet room at dusk', negative_prompt: null,
  first_frame: null, last_frame: null,
  reference_images: [], reference_videos: [], reference_audios: [],
  source_video: null,
  camera: { notation: 'bracket', value: '[Tracking shot]', from_annotation: null },
  seed: null, extra: {},
});

const sidecars = {
  planned: {
    version: 1, kind: 'still', status: 'planned', model: baseModel, inputs: baseInputs(),
    output: { duration_s: 4, resolution: '768P', aspect: null, audio_out: null },
    cost: { estimate_usd: 0.24, actual_usd: null, unit: 'usd_per_second', source: 'estimate' },
    job: null,
    provenance: { created_at: iso(now), tool: 'akari generate video', key_source: 'env:FAL_KEY' },
    result: null,
    history: [{ at: iso(now), status: 'planned', reason: null }],
  },
  generating: {
    version: 1, kind: 'video', status: 'generating', model: baseModel, inputs: baseInputs(),
    output: { duration_s: 4, resolution: '768P', aspect: null, audio_out: null },
    cost: { estimate_usd: 0.24, actual_usd: null, unit: 'usd_per_second', source: 'estimate' },
    progress: { percent: 62, eta_s: 40 },
    job: {
      provider: 'fal', request_id: 'L1-GENERATING', status_url: null, response_url: null,
      started_at: iso(now), stale_after_s: 900,
    },
    provenance: { created_at: iso(now), tool: 'akari generate video', key_source: 'env:FAL_KEY' },
    result: null,
    history: [{ at: iso(now), status: 'generating', reason: null }],
  },
  stale: {
    version: 1, kind: 'video', status: 'generating', model: baseModel, inputs: baseInputs(),
    output: { duration_s: 4, resolution: '768P', aspect: null, audio_out: null },
    cost: { estimate_usd: 0.24, actual_usd: null, unit: 'usd_per_second', source: 'estimate' },
    job: {
      provider: 'fal', request_id: 'L1-STALE', status_url: null, response_url: null,
      started_at: iso(now - 3600 * 1000), stale_after_s: 900,
    },
    provenance: { created_at: iso(now - 3600 * 1000), tool: 'akari generate video', key_source: 'env:FAL_KEY' },
    result: null,
    history: [{ at: iso(now - 3600 * 1000), status: 'generating', reason: null }],
  },
  done: {
    version: 1, kind: 'video', status: 'done', model: baseModel,
    inputs: {
      ...baseInputs(),
      prompt: '[Tracking shot] A person stands up from a dim night desk and walks toward warm window light.',
      first_frame: { path: 'assets/still.png', sha256: null, source_id: null },
    },
    output: { duration_s: 6, resolution: '768P', aspect: null, audio_out: null },
    cost: { estimate_usd: 0.36, actual_usd: null, unit: 'usd_per_second', source: 'estimate' },
    job: {
      provider: 'fal', request_id: 'L1-DONE', status_url: null, response_url: null,
      started_at: iso(now - 400 * 1000), stale_after_s: 900,
    },
    provenance: { created_at: iso(now - 400 * 1000), tool: 'akari generate video', key_source: 'env:FAL_KEY' },
    result: {
      path: 'assets/done.mp4', sha256: null, bytes: 0, duration_s_actual: 6.592,
      width: 1344, height: 768, fps: '24/1', has_audio: true,
      expanded_prompt: 'integrated_multimodal_description: [Shot 1] ...', elapsed_s: 206,
    },
    history: [{ at: iso(now - 200 * 1000), status: 'done', reason: null }],
  },
  failed: {
    version: 1, kind: 'video', status: 'failed', model: baseModel, inputs: baseInputs(),
    output: { duration_s: 4, resolution: '768P', aspect: null, audio_out: null },
    cost: { estimate_usd: 0.24, actual_usd: null, unit: 'usd_per_second', source: 'estimate' },
    error: { reason: 'timeout', message: 'provider did not answer in time' },
    job: {
      provider: 'fal', request_id: 'L1-FAILED', status_url: null, response_url: null,
      started_at: iso(now - 1800 * 1000), stale_after_s: 900,
    },
    provenance: { created_at: iso(now - 1800 * 1000), tool: 'akari generate video', key_source: 'env:FAL_KEY' },
    result: null,
    history: [{ at: iso(now - 1700 * 1000), status: 'failed', reason: 'timeout' }],
  },
  frames: {
    version: 1, kind: 'frames', status: 'done', model: { id: 'codex-image', endpoint: 'images.edit', as_of: '2026-09-12' },
    inputs: { ...baseInputs(), extra: { fps: 8, mask_rect: { x: 0.15, y: 0.6, w: 0.22, h: 0.22 } } },
    output: { duration_s: 4, resolution: '1080p', aspect: null, audio_out: null, fps: 8 },
    cost: { estimate_usd: null, actual_usd: null, unit: null, source: 'estimate' },
    job: null,
    provenance: { created_at: iso(now), tool: 'akari generate frames', key_source: 'env:OPENAI_API_KEY' },
    result: { path: 'assets/frames.png', frames: 32, fps: 8 },
    history: [{ at: iso(now), status: 'done', reason: null }],
  },
};

for (const [key, meta] of Object.entries(sidecars)) {
  const clip = CLIPS.find(c => c.key === key);
  await writeFile(path.join(assets, `${clip.key}.${clip.ext}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`);
}

const FPS = 30, SECONDS = 4;
await writeFile(path.join(project, 'edit.json'), `${JSON.stringify({
  version: 2,
  output: { width: 1920, height: 1080, fps: FPS },
  sources: CLIPS.map(clip => ({ id: clip.key, path: `assets/${clip.key}.${clip.ext}` })),
  tracks: [{
    id: 'v-main', lane: 'visual', name: 'Base',
    items: CLIPS.map((clip, index) => ({
      id: clip.key, name: clip.name,
      at: index * SECONDS * FPS, duration: SECONDS * FPS,
      source: { kind: 'media', src: clip.key, in: 0, out: SECONDS },
    })),
  }],
}, null, 2)}\n`);

console.log(`fixture ready: ${CLIPS.length} clips / ${Object.keys(sidecars).length} sidecars`);
