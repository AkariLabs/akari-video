#!/usr/bin/env node
// tl-caption-motion-clear の L1 fixture（ラッパー作成の検証スクリプト。caption-karaoke-settings の gen-fixture の写しを改変）。
// 15 秒・1280×720・暗い単色の背景。話した言葉 4 行（c-0001〜c-0004）。どの行にも text_style.color を置き、
// 動きを外したときに他の text_style が変わらないことを見られるようにする。
//   nobag = 字幕の袋なし（動きは captions.json の text_style.animation に書く）
//   bag   = 字幕の袋あり（「動き」カードは edit.json の袋 item の motion に書く）
// 映像は ffmpeg で作る（L1 専用。単体テストは使わない）。使い方: node gen-fixture.mjs <出力先>
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(process.argv[2]);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 15;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const LINES = ['動きを当てて外す一行目', '強調だけを外す二行目', '組を当てて外す三行目', '対照の四行目'];

async function project(name, withBag) {
    const dir = path.join(OUT, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
    const tracks = [{ id: 'v-main', lane: 'visual', name: 'Base', items: [{
        id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 }
    }] }, { id: 'v-captions', lane: 'visual', name: '字幕', items: withBag ? [{
        id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: []
    }] : [] }, { id: 'a1', lane: 'audio', name: 'A1', items: [] }];
    const captions = { default_text_style: { zone: 'bottom' }, captions: LINES.map((text, index) => ({
        id: `c-000${index + 1}`, start: index * 3, end: index * 3 + 2.5, text, speaker: null, sourceRef: null, edited: false, src: 'a',
        text_style: { color: '#ffeeaa' }
    })) };
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
    const edit = { version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }], tracks };
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'tl-caption-motion-clear-fixture@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'tl-caption-motion-clear fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return dir;
}
const nobag = await project('nobag', false);
const bag = await project('bag', true);
await mkdir(path.join(OUT, 'library'), { recursive: true });
console.log(JSON.stringify({ nobag, bag, library: path.join(OUT, 'library') }));
