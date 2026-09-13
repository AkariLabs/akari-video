#!/usr/bin/env node
// caption-line-style-parity L1 fixture (wrapper-authored verification script).
// Owner-shaped project: display_policy (max_line_units 14 / lines 1 / wrap multi).
//
// 2 groups of cues:
//   c-0001..c-0004  text_style = presets/textstyle/<id>.json の style をそのまま inline
//                   （= applyCaptionStylePresets が展開した後の形）。本票が直した経路。
//   c-0005..c-0008  style_preset だけを書いた形。shell の display_policy 経路は
//                   akari-preview-service.ts が applyCaptionStylePresets を通さないため
//                   style_preset が無視される（本票のファイル境界外 = 申し送り）。
// Usage: node prepare-fixture.mjs <workspace> <ffmpeg> <repoRoot>
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , workspace, ffmpeg = 'ffmpeg', repoRoot] = process.argv;
if (!workspace || !repoRoot) throw new Error('usage: prepare-fixture.mjs <workspace> <ffmpeg> <repoRoot>');
const project = path.join(workspace, 'project');
await mkdir(path.join(project, 'assets'), { recursive: true });

const video = spawnSync(ffmpeg, [
  '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-f', 'lavfi', '-i', 'color=c=0x20242c:s=1920x1080:d=20:r=30',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(project, 'source.mp4'),
], { encoding: 'utf8' });
if (video.status !== 0) throw new Error(video.stderr || `ffmpeg exited ${video.status}`);

const PRESETS = ['subtitle-news', 'subtitle-variety', 'neon', 'verdict-badge'];
const styles = {};
for (const id of PRESETS) {
  styles[id] = JSON.parse(await readFile(path.join(repoRoot, 'presets/textstyle', `${id}.json`), 'utf8'));
}
const captions = [];
PRESETS.forEach((id, index) => {
  captions.push({
    id: `c-000${index + 1}`, src: 'a', start: index * 2 + 0.3, end: index * 2 + 1.9,
    text: styles[id].sample_text, speaker: null, sourceRef: null, edited: false,
    text_style: styles[id].style,
  });
});
PRESETS.forEach((id, index) => {
  captions.push({
    id: `c-000${index + 5}`, src: 'a', start: index * 2 + 10.3, end: index * 2 + 11.9,
    text: styles[id].sample_text, speaker: null, sourceRef: null, edited: false,
    style_preset: id,
  });
});

await writeFile(path.join(project, 'captions.json'), `${JSON.stringify({
  display_policy: {
    mode: 'single_line_sequential',
    algorithm: 'a4-ja-two-fragment-v1',
    unit_metric: 'ascii-half-other-one-v1',
    max_line_units: 14,
    minimum_fragment_duration_seconds: 0.72,
    locale: 'ja',
    lines: 1,
    wrap: 'multi',
  },
  captions,
}, null, 2)}\n`);

await writeFile(path.join(project, 'edit.json'), `${JSON.stringify({
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 'a', path: 'source.mp4' }],
  tracks: [
    {
      id: 'v-main', lane: 'visual', name: 'Base',
      items: [{ id: 'cut-base', at: 0, duration: 600, source: { kind: 'media', src: 'a', in: 0, out: 20 } }],
    },
    {
      id: 'v-captions', lane: 'visual', name: '字幕',
      items: [{
        id: 'captions', name: '字幕', at: 0, duration: 600,
        source: { kind: 'captions', path: 'captions.json' }, items: [],
      }],
    },
  ],
}, null, 2)}\n`);

console.log('fixture ready');
