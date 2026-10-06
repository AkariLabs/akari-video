#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(os.tmpdir(), 'tl-gpu-caption-parity-l1');
export const FPS = 30;
export const PHASES = [['10', 2], ['25', 5], ['50', 9], ['90', 16]];
export const CASES = [
  ['push-left', '左から現れる', { animation: { in: { id: 'push-left' } } }],
  ['push-right', '右から現れる', { animation: { in: { id: 'push-right' } } }],
  ['push-up', '下から現れる', { animation: { in: { id: 'push-up' } } }],
  ['push-down', '上から現れる', { animation: { in: { id: 'push-down' } } }],
  ['wipe-left', '左へ開く字幕', { animation: { in: { id: 'wipe-left' } } }],
  ['wipe-right', '右へ開く字幕', { animation: { in: { id: 'wipe-right' } } }],
  ['swing', '揺れる字幕', { animation: { in: { id: 'swing' } } }],
  ['glitch', 'ゆらぐ字幕', { animation: { in: { id: 'glitch' } } }],
  ['typewriter', '文字送りの字幕', { animation: { in: { id: 'typewriter' } } }],
  ['typewriter-out', '文字が消える字幕', { animation: { out: { id: 'typewriter' } } }],
  ['typewriter-both', '文字が出入りする', { animation: { in: { id: 'typewriter' }, out: { id: 'typewriter' } } }],
  ['stroke-inner', '内側の縁取り', { stroke_inner: { color: '#ff5a00', width_px: 3 } }],
  ['fill-gradient', '色が移る字幕', { fill_gradient: { colors: ['#fb923c', '#8b5cf6'], angle_deg: 90 } }],
  ['extrude', '押し出す字幕', { extrude: { depth_px: 5, color: '#a16207', angle_deg: 135 } }],
  ['glitch-stroke', '縁取りの揺れ', { animation: { in: { id: 'glitch' } }, stroke_inner: { color: '#ff5a00', width_px: 3 } }],
  ['typewriter-gradient', '文字送りの色', { animation: { in: { id: 'typewriter' } }, fill_gradient: { colors: ['#fb923c', '#8b5cf6'], angle_deg: 90 } }],
];

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr?.slice(-1200)}`);
}

function edit(seconds) {
  return { version: 2, output: { width: 640, height: 360, fps: FPS },
    sources: [{ id: 'base', path: 'assets/base.mp4' }],
    tracks: [
      { id: 'v-main', lane: 'visual', name: 'Base', items: [
        { id: 'cut-base', at: 0, duration: seconds * FPS,
          source: { kind: 'media', src: 'base', in: 0, out: seconds, speed: 1 } }] },
      { id: 'v-captions', lane: 'visual', name: 'Captions', items: [
        { id: 'captions', at: 0, duration: seconds * FPS,
          source: { kind: 'captions', path: 'captions.json' }, items: [] }] },
    ] };
}

async function project(name, base, seconds, captions) {
  const dir = path.join(ROOT, name);
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  await cp(base, path.join(dir, 'assets', 'base.mp4'));
  await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit(seconds), null, 2)}\n`);
  await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify({ captions }, null, 2)}\n`);
}

if (process.argv[1] && await realpath(fileURLToPath(import.meta.url)) === await realpath(process.argv[1])) {
  const ownerOnly = process.argv.includes('--owner-only');
  const extrasOnly = process.argv.includes('--extras-only');
  if (!ownerOnly && !extrasOnly) await rm(ROOT, { recursive: true, force: true });
  await mkdir(ROOT, { recursive: true });
  const base = path.join(ROOT, 'base.mp4');
  if (!ownerOnly) {
    if (!extrasOnly) run(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'color=c=0x27313f:size=640x360:rate=30:duration=11',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', base]);
    for (const [name, label, text_style] of CASES.filter(([name]) => !extrasOnly || name === 'typewriter-out' || name === 'typewriter-both')) {
      await project(name, base, 1, [{ id: name, start: 0, end: 1, text: label,
        speaker: null, sourceRef: null, edited: false, text_style }]);
    }
  }
  const owner = Array.from({ length: 10 }, (_, i) => ({ id: `c-${String(i + 1).padStart(4, '0')}`, start: i, end: i + 1,
    text: `字幕 ${i + 1}`, speaker: null, sourceRef: null, edited: false,
    text_style: { animation: { in: { id: 'glitch' } } } }));
  owner.push({ id: 'c-0011', start: 10, end: 11, text: '縁取り内側',
    speaker: null, sourceRef: null, edited: false,
    text_style: { stroke_inner: { color: '#ff5a00', width_px: 3 } } });
  if (!extrasOnly) await project('owner', base, 11, owner);
  console.log(JSON.stringify({ cases: CASES.length, ownerCaptions: owner.length }));
}
