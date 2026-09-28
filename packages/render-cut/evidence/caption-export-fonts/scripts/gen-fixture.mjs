#!/usr/bin/env node
// caption-export-fonts の L1 fixture（ラッパー作成の検証スクリプト）。
// 字幕 1 行 = 1 書体（font_family / font_weight だけを変える）を 1 秒ずつ並べたプロジェクトを 2 つ作る:
//   legacy/   … display_policy なし（従来経路）
//   resolved/ … display_policy あり（resolved caption 経路）
// 加えて、専用の AKARI_HOME のライブラリに書体を 1 つ置く（同梱の assets/font の TTF を別名の素材として複製）。
// 使い方: node gen-fixture.mjs <出力先> <repo-root>
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(process.argv[2]);
const REPO = path.resolve(process.argv[3]);
const FPS = 30;
export const CUES = [
  { label: 'default (no font_family)', style: null },
  { label: 'Noto Sans JP 400', style: { font_family: 'Noto Sans JP', font_weight: 400 } },
  { label: 'Noto Sans JP 900', style: { font_family: 'Noto Sans JP', font_weight: 900 } },
  { label: 'Noto Serif JP 400', style: { font_family: 'Noto Serif JP', font_weight: 400 } },
  { label: 'Noto Serif JP 900', style: { font_family: 'Noto Serif JP', font_weight: 900 } },
  { label: 'M PLUS Rounded 1c 500', style: { font_family: 'M PLUS Rounded 1c', font_weight: 500 } },
  { label: 'M PLUS Rounded 1c 900', style: { font_family: 'M PLUS Rounded 1c', font_weight: 900 } },
  { label: 'BIZ UDGothic 400', style: { font_family: 'BIZ UDGothic', font_weight: 400 } },
  { label: 'BIZ UDGothic 700', style: { font_family: 'BIZ UDGothic', font_weight: 700 } },
  { label: 'Dela Gothic One', style: { font_family: 'Dela Gothic One', font_weight: 400 } },
  { label: 'Zen Maru Gothic 400', style: { font_family: 'Zen Maru Gothic', font_weight: 400 } },
  { label: 'Zen Maru Gothic 700', style: { font_family: 'Zen Maru Gothic', font_weight: 700 } },
  { label: 'Shippori Mincho', style: { font_family: 'Shippori Mincho', font_weight: 400 } },
  { label: 'DotGothic16', style: { font_family: 'DotGothic16', font_weight: 400 } },
  { label: 'Klee One', style: { font_family: 'Klee One', font_weight: 400 } },
  { label: 'library: Probe Hand', style: { font_family: 'Probe Hand', font_weight: 400 } },
  { label: 'missing: Nonexistent Font', style: { font_family: 'Nonexistent Font', font_weight: 400 } },
  { label: 'style_preset narration-caption', preset: 'narration-caption' },
];
const SECONDS = CUES.length;
const POLICY = { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1', unit_metric: 'ascii-half-other-one-v1',
  max_line_units: 19, minimum_fragment_duration_seconds: 0.72, locale: 'ja', lines: 1, wrap: 'multi' };
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
async function project(name, withPolicy) {
  const dir = path.join(OUT, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i',
    `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`, '-c:v', 'libx264', '-preset', 'ultrafast',
    '-g', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
  const captions = {
    ...(withPolicy ? { display_policy: POLICY } : {}),
    default_text_style: { zone: 'bottom', size_px: 64 },
    captions: CUES.map((cue, index) => ({
      id: `c-${String(index + 1).padStart(4, '0')}`, start: index + 0.05, end: index + 0.95,
      ...(withPolicy ? { time_domain: 'output' } : {}),
      text: '今日のまとめ Abc 123', speaker: null, sourceRef: null, edited: false, src: 'a',
      ...(cue.style ? { text_style: cue.style } : {}), ...(cue.preset ? { style_preset: cue.preset } : {}),
    })),
  };
  await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
  const edit = { version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }],
    tracks: [{ id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: SECONDS * FPS,
      source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 } }] },
    { id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS,
      source: { kind: 'captions', path: 'captions.json' }, items: [] }] },
    { id: 'a1', lane: 'audio', name: 'A1', items: [] }] };
  await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
  run('/usr/bin/git', ['init', '-q'], dir);
  run('/usr/bin/git', ['config', 'user.email', 'caption-export-fonts-fixture@localhost'], dir);
  run('/usr/bin/git', ['config', 'user.name', 'caption-export-fonts fixture'], dir);
  run('/usr/bin/git', ['add', '-A'], dir);
  run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
  return dir;
}
const legacy = await project('legacy', false);
const resolved = await project('resolved', true);
// ライブラリの書体（AKARI_HOME/assets/font/<id>/）。中身は同梱の Dela Gothic One を別名で置いたもの（検証専用）。
const home = path.join(OUT, 'akari-home-caption-export-fonts');
const fontDir = path.join(home, 'assets', 'font', 'probe-hand');
await rm(home, { recursive: true, force: true });
await mkdir(fontDir, { recursive: true });
await copyFile(path.join(REPO, 'assets/font/dela-gothic-one/DelaGothicOne-Regular.ttf'), path.join(fontDir, 'ProbeHand-Regular.ttf'));
await writeFile(path.join(fontDir, 'meta.json'), `${JSON.stringify({ id: 'probe-hand', category: 'font', title: 'Probe Hand（検証用）',
  description: 'caption-export-fonts の検証用ライブラリ書体（同梱 Dela Gothic One の複製）', tags: ['font', 'japanese', 'display'],
  license: { spdx: 'OFL-1.1', scope: 'commercial-ok', attribution_required: false } }, null, 2)}\n`);
console.log(JSON.stringify({ legacy, resolved, home, cues: CUES.map(c => c.label) }));
