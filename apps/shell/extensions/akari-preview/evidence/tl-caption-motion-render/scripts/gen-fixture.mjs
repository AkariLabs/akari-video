#!/usr/bin/env node
// Generate both caption routes in an isolated directory supplied by the caller.
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CAPTION_ANIMATION_RECIPES } from '../../../../../../../packages/render-cut/src/captions.mjs';
import { isCaptionMotionSupported } from '../../../../../../../packages/gpu-export/src/eligibility.mjs';

const root = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !path.basename(root).includes('tl-caption-motion-render')) throw new Error('dedicated output directory required');
const presets = { fade: 'fade-in-out', 'slide-up': 'slide-up', 'slide-down': 'slide-down', 'slide-left': 'slide-left', 'slide-right': 'slide-right', scale: 'zoom-in-out', wipe: 'wipe-right', pop: 'pop', zoom: 'zoom-in-out', twirl: 'spin-in', pulse: 'heartbeat', float: 'float', spin: 'spin-in', blink: 'flash', jiggle: 'jitter' };
const combos = [
  ['simple', 'fade', null, 'fade'], ['smart', 'slide-up', 'float', 'slide-up'],
  ['fun', 'pop', 'pulse', 'pop'], ['corp', 'wipe', null, 'wipe'],
  ['relax', 'fade', 'float', 'fade'], ['typewriter', 'typewriter', null, 'fade']
];
const rows = [
  ...Object.keys(CAPTION_ANIMATION_RECIPES).map(id => ({ key: `id:${id}`, animation: { in: { id,
    ...(['retro-flicker', 'news-ticker', 'marquee-left', 'crawl-up'].includes(id) ? { duration_sec: 1.2 } : {}) } } })),
  ...['in', 'loop', 'out'].flatMap(slot => Object.entries(presets).filter(([id]) => slot === 'loop' ? ['pulse', 'float', 'spin', 'blink', 'jiggle'].includes(id) : !['pulse', 'float', 'spin', 'blink', 'jiggle'].includes(id)).map(([id, mapped]) => ({ key: `preset:${slot}:${id}`, animation: { [slot]: { id: mapped, ...(slot === 'loop' ? { duration_sec: 3 } : {}) } } }))),
  ...combos.map(([key, entrance, loop, exit]) => ({ key: `combo:${key}`, animation: { in: { id: presets[entrance] || entrance, duration_sec: key === 'typewriter' ? 1.4 : key === 'corp' ? 1.2 : .4 }, ...(loop ? { loop: { id: presets[loop], duration_sec: 3 } } : {}), out: { id: presets[exit], duration_sec: .6 } } }))
];
const richStyle = { size_px: 38, fill: { type: 'gradient', angle_deg: 180, stops: [
  { at: 0, color: '#ffed8a' }, { at: 100, color: '#75d6ff' }
] }, strokes: [{ color: '#101827', width_px: 3 }, { color: '#ffffff', width_px: 1.5 }] };
const allRows = [{ key: 'owner:glitch', animation: { in: { id: 'glitch' } } }, { key: 'owner:typewriter', animation: { in: { id: 'typewriter', duration_sec: 1.4 } } }, ...rows,
  { key: 'rich:typewriter', animation: { in: { id: 'typewriter', duration_sec: 1.4 } }, style: richStyle }];
const sourceRows = process.argv.includes('--eligible-only') ? allRows.filter(row => isCaptionMotionSupported(row.animation).supported)
  : process.argv.includes('--unsupported-only') ? allRows.filter(row => !isCaptionMotionSupported(row.animation).supported) : allRows;
const selectedKeys = process.argv.find(arg => arg.startsWith('--keys='))?.slice(7).split(',');
const selectedRows = selectedKeys ? sourceRows.filter(row => selectedKeys.includes(row.key)) : sourceRows;
if (selectedKeys && selectedRows.length !== selectedKeys.length) throw new Error('unknown or duplicate row key');
const chunkStart = Number(process.argv.find(arg => arg.startsWith('--start='))?.slice(8) ?? 0);
const chunkCount = Number(process.argv.find(arg => arg.startsWith('--count='))?.slice(8) ?? selectedRows.length);
const testRows = process.argv.includes('--probe-only') ? selectedRows.slice(0, 2) : selectedRows.slice(chunkStart, chunkStart + chunkCount);
if (!Number.isInteger(chunkStart) || !Number.isInteger(chunkCount) || chunkStart < 0 || chunkCount < 1 || !testRows.length) throw new Error('invalid chunk');
const fps = 30;
const text = '字幕を一文字ずつ表示します';
for (const policy of [false, true]) {
  const project = path.join(root, policy ? 'policy' : 'legacy', 'project');
  await mkdir(path.join(project, 'assets'), { recursive: true });
  await mkdir(path.join(project, '.akari'), { recursive: true });
  const cues = testRows.flatMap((row, index) => [true, false].map((animated, variant) => {
    const start = (index * 2 + variant) * 3;
    return { id: `c-${index}-${variant}`, start, end: start + 3, text, speaker: null, sourceRef: null, edited: false,
      ...(animated || row.style ? { text_style: { ...(row.style ?? {}), ...(animated ? { animation: row.animation } : {}) } } : {}) };
  }));
  const seconds = cues.length * 3;
  const rootCaptions = { ...(policy ? { display_policy: { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1', unit_metric: 'ascii-half-other-one-v1', max_line_units: 20, minimum_fragment_duration_seconds: .72, locale: 'ja', lines: 1, wrap: 'multi' } } : {}), captions: cues };
  await writeFile(path.join(project, 'captions.json'), JSON.stringify(rootCaptions, null, 2) + '\n');
  const edit = { version: 2, output: { width: 640, height: 360, fps }, sources: [{ id: 'a', path: 'assets/base.mp4' }], tracks: [
    { id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: seconds * fps, source: { kind: 'media', src: 'a', in: 0, out: seconds, speed: 1 } }] },
    { id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0, duration: seconds * fps, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
  ] };
  await writeFile(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  const out = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', `color=c=0x27313f:size=640x360:rate=${fps}:duration=${seconds}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(project, 'assets/base.mp4')], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(out.stderr);
}
const label = process.argv.find(arg => arg.startsWith('--label='))?.slice(8) || '';
await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ fps, text, chunkStart, label, rows: testRows }, null, 2) + '\n');
console.log(JSON.stringify({ rows: testRows.length, secondsPerVariant: testRows.length * 6 }));
