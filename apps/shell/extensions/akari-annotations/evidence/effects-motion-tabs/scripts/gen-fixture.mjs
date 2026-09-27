#!/usr/bin/env node
// effects-motion-tabs の L1 fixture（ラッパー作成の検証スクリプト。caption-panels-followups の gen-fixture の写しを改変）。
// 15 秒・1280×720。話した言葉 5 行（c-0001〜c-0005・words[] 付き）。今の効果 5 種を 1 行ずつ当ててある
// （c-0001 影 / c-0002 浮き出し / c-0003 ネオン / c-0004 袋文字 / c-0005 なし。値は基点の captionEffectPatch と同じ）。
//   bag   = 字幕の袋（source.kind: captions）あり
//   nobag = 袋なし（字幕の段に袋を置かない）
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
const SPOKEN = ['今日は朝のルーティンを紹介します', 'まずはコーヒーを淹れるところから', '豆は挽きたてが一番おいしい', 'お湯は少し冷ましてから注ぎます', 'ここがいちばん大事'];
const STROKE = { color: '#000000', width_px: 1.5 };
export const EFFECT_STYLES = [
    { effect: 'shadow', style: { stroke: STROKE, shadow: { color: '#000000', opacity: 0.75, distance_px: 8.5, angle_deg: 45, blur_px: 2 } } },
    { effect: 'raised', style: { stroke: STROKE, shadow: { color: '#000000', opacity: 0.6, distance_px: 4, angle_deg: 90, blur_px: 14 } } },
    { effect: 'neon', style: { stroke: STROKE, glow: { color: '#39D5FF', density: 60, spread: 12 } } },
    { effect: 'outline', style: { stroke: { color: '#000000', width_px: 6 } } },
    { effect: 'none', style: null }
];

// 語ごとの表示（カラオケ等）・強調（対象語）の L1 用に words[] を付ける（4 文字ずつ・尺を等分）。
function words(text, start, end) {
    const chunks = text.match(/.{1,4}/gu);
    const step = (end - start) / chunks.length;
    return chunks.map((chunk, i) => ({ start: +(start + i * step).toFixed(3), end: +(start + (i + 1) * step).toFixed(3), text: chunk }));
}

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
    const captions = { default_text_style: { zone: 'bottom' }, captions: SPOKEN.map((text, index) => ({
        id: `c-000${index + 1}`, start: index * 3, end: index * 3 + 2.5, text, speaker: null, sourceRef: null, edited: false, src: 'a',
        words: words(text, index * 3, index * 3 + 2.5),
        ...(EFFECT_STYLES[index].style ? { text_style: EFFECT_STYLES[index].style } : {})
    })) };
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
    const edit = { version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }], tracks };
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'effects-motion-tabs-fixture@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'effects-motion-tabs fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return dir;
}
const bag = await project('bag', true);
const nobag = await project('nobag', false);
await mkdir(path.join(OUT, 'library'), { recursive: true });
console.log(JSON.stringify({ bag, nobag, library: path.join(OUT, 'library') }));
