#!/usr/bin/env node
// caption-karaoke-settings の L1 fixture（ラッパー作成の検証スクリプト。effects-motion-tabs の gen-fixture の写しを改変）。
// 15 秒・1280×720・暗い単色の背景。話した言葉 5 行（c-0001〜c-0005・words[] 付き・字幕の袋あり）。
//   c-0001 style karaoke（かな・漢字）
//   c-0002 style なし・words[] あり（render-cut / プレビューとも既定でカラオケ扱いになるか）
//   c-0003 style karaoke（英字・空白・絵文字の混在）
//   c-0004 style karaoke（かな・漢字）
//   c-0005 style pop（対照）
// 使い方: node gen-fixture.mjs <出力先> [variant...]
//   variant = plain（設定なし）/ JSON ファイル（{ name, patch: { "c-0001": { text_style: {...} } , ... }, default_text_style: {...} }）
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(process.argv[2]);
const VARIANTS = process.argv.slice(3).length ? process.argv.slice(3) : ['plain'];
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 15;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
export const LINES = [
    { text: 'カラオケの色を確かめる', style: 'karaoke' },
    { text: 'スタイル無しの語の時刻', style: null },
    { text: 'Hi 世界🎤テスト', style: 'karaoke' },
    { text: '今日は朝のルーティン', style: 'karaoke' },
    { text: '対照のポップ表示です', style: 'pop' }
];
const seg = new Intl.Segmenter('ja', { granularity: 'grapheme' });
// 語 = 4 書記素ずつ・尺を等分（絵文字 1 個 = 1 書記素）
function words(text, start, end) {
    const g = [...seg.segment(text)].map(s => s.segment);
    const chunks = [];
    for (let i = 0; i < g.length; i += 4) chunks.push(g.slice(i, i + 4).join(''));
    const step = (end - start) / chunks.length;
    return chunks.map((chunk, i) => ({ start: +(start + i * step).toFixed(3), end: +(start + (i + 1) * step).toFixed(3), text: chunk }));
}

async function project(name, variant) {
    const dir = path.join(OUT, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
    const tracks = [{ id: 'v-main', lane: 'visual', name: 'Base', items: [{
        id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 }
    }] }, { id: 'v-captions', lane: 'visual', name: '字幕', items: [{
        id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: []
    }] }, { id: 'a1', lane: 'audio', name: 'A1', items: [] }];
    const captions = { default_text_style: { zone: 'bottom', ...(variant.default_text_style ?? {}) }, captions: LINES.map((line, index) => {
        const id = `c-000${index + 1}`;
        const patch = variant.patch?.[id] ?? {};
        return {
            id, start: index * 3, end: index * 3 + 2.5, text: line.text, speaker: null, sourceRef: null, edited: false, src: 'a',
            words: words(line.text, index * 3, index * 3 + 2.5),
            ...(line.style ? { style: line.style } : {}),
            ...patch
        };
    }) };
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
    const edit = { version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }], tracks };
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'caption-karaoke-settings-fixture@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'caption-karaoke-settings fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return dir;
}
const made = {};
for (const v of VARIANTS) {
    const variant = v === 'plain' ? { name: 'plain' } : JSON.parse(await readFile(v, 'utf8'));
    made[variant.name] = await project(variant.name, variant);
}
await mkdir(path.join(OUT, 'library'), { recursive: true });
console.log(JSON.stringify(made));
