#!/usr/bin/env node
// caption-rich-looks の L1 fixture（ラッパー作成の検証スクリプト。effects-motion-tabs の gen-fixture の写しを改変）。
// 16 秒・1280×720。字幕 8 行（c-0001〜c-0008・2 秒ずつ）。
//   plain  = 字幕に見た目の指定なし（編集パネルのカードで 7 種を当てる L1 用。c-0008 は既存カードの比較用）
//   styled = 新しい 7 種の見た目を captions.json に直接書いたもの（../fixtures/captions.json と同じ値。c-0008 は指定なし）
// 映像は ffmpeg で作る（L1 専用。単体テストは使わない）。使い方: node gen-fixture.mjs <出力先>
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 16;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
// 新しい 7 枚（カード id・字幕の文字）。c-0008 は既存の効果（袋文字 太）を当てて見た目が変わらないことの比較に使う
export const LOOKS = [
    { id: 'ol-double-black', text: '二重縁 黒と白' },
    { id: 'ol-double-color', text: '二重縁 白と色' },
    { id: 'fill-sunset', text: 'グラデ 夕焼け' },
    { id: 'fill-ocean', text: 'グラデ 海の色' },
    { id: 'fill-rainbow', text: 'グラデ 虹の色' },
    { id: 'ex-gold', text: '立体の文字 金' },
    { id: 'ex-silver', text: '立体の文字 銀灰' },
    { id: 'ol-thick', text: '既存 袋文字 太' }
];
export const midTime = index => index * 2 + 1.2;

async function project(out, name, styled) {
    const dir = path.join(out, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
    const styles = styled
        ? JSON.parse(await readFile(path.join(HERE, '..', 'fixtures', 'captions.json'), 'utf8')).captions.map(c => c.text_style)
        : [];
    const tracks = [{ id: 'v-main', lane: 'visual', name: 'Base', items: [{
        id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 }
    }] }, { id: 'v-captions', lane: 'visual', name: '字幕', items: [{
        id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: []
    }] }, { id: 'a1', lane: 'audio', name: 'A1', items: [] }];
    const captions = { default_text_style: { zone: 'bottom', size_px: 64 }, captions: LOOKS.map((look, index) => ({
        id: `c-000${index + 1}`, start: index * 2, end: index * 2 + 1.9, text: look.text, speaker: null, sourceRef: null, edited: false, src: 'a',
        ...(styles[index] ? { text_style: styles[index] } : {})
    })) };
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
    const edit = { version: 2, output: { width: 1280, height: 720, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }], tracks };
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'caption-rich-looks-fixture@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'caption-rich-looks fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return dir;
}
if (import.meta.url === `file://${process.argv[1]}`) {
    const OUT = path.resolve(process.argv[2]);
    const plain = await project(OUT, 'plain', false);
    const styled = await project(OUT, 'styled', true);
    await mkdir(path.join(OUT, 'library'), { recursive: true });
    console.log(JSON.stringify({ plain, styled, library: path.join(OUT, 'library') }));
}
