#!/usr/bin/env node
// Continuous speech-derived captions for playback observation, with no display_policy.
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !root.includes('tl-caption-motion-render')) throw new Error('dedicated fixture root required');
const project = path.join(root, 'project');
await mkdir(path.join(project, 'assets'), { recursive: true });
await mkdir(path.join(project, '.akari'), { recursive: true });
const motionIds = ['glitch', 'glitch', 'typewriter', 'typewriter', 'glitch', 'typewriter',
  null, 'glitch', 'typewriter', 'glitch', null, 'typewriter', 'glitch', null];
const texts = [
  '最初の字幕です', '続けて同じ動き', '一文字ずつ出る', '続く文字送りです',
  'ここでグリッチ', '文字送りに戻る', '動きのない字幕', '次もグリッチです',
  'また文字が出る', 'すぐ切り替わる', '静かな一行です', '一文字ずつ確認',
  '最後の動く字幕', '締めの字幕です'
];
const fps = 30, secondsPerCue = 2;
const cues = motionIds.map((id, index) => {
  const start = index * secondsPerCue, end = start + secondsPerCue;
  const text = texts[index];
  const graphemes = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)].map(part => part.segment);
  const words = graphemes.map((char, wordIndex) => ({ text: char,
    start: start + secondsPerCue * wordIndex / graphemes.length,
    end: start + secondsPerCue * (wordIndex + 1) / graphemes.length }));
  return { id: `owner-${String(index + 1).padStart(2, '0')}`, start, end, text, src: 'a',
    speaker: null, sourceRef: null, edited: false, words,
    ...(index % 2 === 0 ? { style: 'karaoke' } : {}),
    ...(id ? { text_style: { animation: { in: { id, duration_sec: id === 'typewriter' ? 1.2 : .8 } } } } : {}) };
});
await writeFile(path.join(project, 'captions.json'), JSON.stringify({ captions: cues }, null, 2) + '\n');
const seconds = cues.length * secondsPerCue;
const edit = { version: 2, output: { width: 640, height: 360, fps },
  sources: [{ id: 'a', path: 'assets/base.mp4' }], tracks: [
    { id: 'v-main', lane: 'visual', name: 'Base', items: [{ id: 'cut-base', at: 0, duration: seconds * fps,
      source: { kind: 'media', src: 'a', in: 0, out: seconds, speed: 1 } }] },
    { id: 'v-captions', lane: 'visual', name: '字幕', items: [{ id: 'captions', name: '字幕', at: 0,
      duration: seconds * fps, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
  ] };
await writeFile(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
const video = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
  '-f', 'lavfi', '-i', `color=c=0x27313f:size=640x360:rate=${fps}:duration=${seconds}`,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(project, 'assets/base.mp4')], { encoding: 'utf8' });
if (video.status !== 0) throw new Error(video.stderr);
console.log(JSON.stringify({ cues: cues.length, animated: cues.filter(cue => cue.text_style?.animation).length,
  seconds, karaoke: cues.filter(cue => cue.style === 'karaoke').length }));
