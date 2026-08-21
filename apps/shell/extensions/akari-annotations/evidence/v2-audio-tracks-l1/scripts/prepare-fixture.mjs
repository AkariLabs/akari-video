#!/usr/bin/env node
// v2-audio-tracks タスクの L1 実測フィクスチャ。tasks/2026-08-20-v2-audio-tracks/task.md の
// 受け入れ条件（オーナー追記）「SFX と BGM が別々の段に見える・段として入れ替えられる」を
// 実機で確認するための2フェーズ。
//   phase "separated": sfx / narration / bgm がそれぞれ独立した audio track に乗っている状態。
//     3行が別々に描画されることを確認する（オーナー実機報告のバグが直っていることの直接証拠）。
//   phase "reordered": phase "separated" と中身は同じだが、narration track と bgm track の
//     配列順を入れ替えた状態。段として入れ替えられることの証拠（render-path-unification-l1 の
//     prepare-fixture.mjs 冒頭コメントにある「Page.reload だけでは別プロジェクトへ切り替わらない
//     ため、シナリオごとに新しい Electron プロセスが要る」という既知の制約に従い、実ドラッグでは
//     なく2つの独立した起動で before/after を撮る、という同タスクが確立した手法をそのまま踏襲）。
//
// Usage: node prepare-fixture.mjs <phase:separated|reordered> <workspaceDir>

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [, , phaseArg, workspaceDir] = process.argv;
const VALID_PHASES = ['separated', 'reordered'];
if (!VALID_PHASES.includes(phaseArg) || !workspaceDir) {
  throw new Error(`usage: prepare-fixture.mjs <phase:${VALID_PHASES.join('|')}> <workspaceDir>`);
}

const projectDir = path.join(workspaceDir, 'project');

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr}`);
  }
}

function makeVideoIfMissing(filePath) {
  if (existsSync(filePath)) return;
  ffmpeg([
    '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=10:d=10',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', filePath
  ]);
}

function makeToneIfMissing(filePath, frequency, duration) {
  if (existsSync(filePath)) return;
  ffmpeg([
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
    '-c:a', 'aac', filePath
  ]);
}

const sfxTrack = {
  id: 'a-sfx', lane: 'audio', items: [
    { id: 'sfx-1', at: 30, duration: 15, role: 'sfx', source: { kind: 'media', src: 'sfx-tone', in: 0, out: 0.5 } },
    { id: 'sfx-2', at: 80, duration: 15, role: 'sfx', source: { kind: 'media', src: 'sfx-tone', in: 0, out: 0.5 } }
  ]
};
const narrationTrack = {
  id: 'a-narration', lane: 'audio', items: [
    { id: 'narration-1', at: 10, duration: 60, role: 'narration', source: { kind: 'media', src: 'narration-tone', in: 0, out: 6 } }
  ]
};
const bgmTrack = {
  id: 'a-bgm', lane: 'audio', items: [
    { id: 'bgm-1', at: 0, duration: 100, role: 'bgm', source: { kind: 'media', src: 'bgm-tone', in: 0, out: 10 } }
  ]
};
const visualTrack = {
  id: 'v-main', lane: 'visual', items: [
    { id: 'clip-1', at: 0, duration: 100, source: { kind: 'media', src: 'main', in: 0, out: 10 } }
  ]
};

const sources = [
  { id: 'main', path: 'main.mp4', proxy: null },
  { id: 'sfx-tone', path: 'sfx-tone.m4a', proxy: null },
  { id: 'narration-tone', path: 'narration-tone.m4a', proxy: null },
  { id: 'bgm-tone', path: 'bgm-tone.m4a', proxy: null }
];

// tracks[] の配列順が画面の下から上（widget の [...tracks].reverse() 規約）。
// "separated": sfx / narration / bgm の順で積む。"reordered": narration と bgm を入れ替える
// （narration が bgm より上の段になる）。中身（items の内容）は不変、配列順だけが違う。
const tracksByPhase = {
  separated: [visualTrack, sfxTrack, narrationTrack, bgmTrack],
  reordered: [visualTrack, sfxTrack, bgmTrack, narrationTrack]
};

const edit = {
  version: 2,
  output: { width: 640, height: 360, fps: 10 },
  sources,
  tracks: tracksByPhase[phaseArg]
};

await mkdir(projectDir, { recursive: true });
await mkdir(path.join(projectDir, '.akari'), { recursive: true });
await writeFile(path.join(projectDir, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');

makeVideoIfMissing(path.join(projectDir, 'main.mp4'));
makeToneIfMissing(path.join(projectDir, 'sfx-tone.m4a'), 880, 0.5);
makeToneIfMissing(path.join(projectDir, 'narration-tone.m4a'), 440, 6);
makeToneIfMissing(path.join(projectDir, 'bgm-tone.m4a'), 220, 10);

await writeFile(path.join(projectDir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
console.log(`prepared phase ${phaseArg} fixture at ${path.join(projectDir, 'edit.json')}`);
