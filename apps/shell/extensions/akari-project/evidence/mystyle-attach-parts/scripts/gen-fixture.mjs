#!/usr/bin/env node
// マイスタイル「効果音・画面効果・装飾」部品（attach）の L1 fixture（ラッパー作成の検証スクリプト。mystyle-motion-part の gen-fixture を改変）。
// 話した言葉 5 行（c-0001〜c-0005・0 / 3 / 6 / 9 / 12 秒から 2.5 秒ずつ・15 秒・1280×720・30fps）。
//   anchored/     = 手順 0（BEFORE）用: html 装飾を c-0002（全体）と c-0003（全体）へアンカー。効果音 sfx-c2 は c-0002 の頭（90 フレーム）にアンカー無しで置く
//   anchored-sfx/ = 手順 0（BEFORE）用: anchored/ と同じで、効果音 sfx-c2 にもアンカーを手で書く（音声のアンカー）
//   spoken/       = 手順 3（AFTER）用: c-0001 に見た目 + 動き。効果音（0 フレーム）と html 装飾（0〜75 フレーム）をアンカー無しで置いておき、
//                   実機の右クリック「字幕にひも付ける…」で c-0001 にひも付ける。素材はライブラリ（library/audio/sfx-pop・library/overlay/deco-frame）の
//                   参照（.akari/asset-references.json に記帳・宣言パス assets/<category>/<id>/<file>・プロジェクトに実体なし）
//   library/      = 上の 2 素材の実体（AFTER はこれを隔離した作業場の library/ へ写す）
// 映像・効果音は ffmpeg で作る（L1 専用。単体テストは使わない）。使い方: node gen-fixture.mjs <出力先>
import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'mystyle-attach-parts-l1', 'fixture'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FPS = 30, SECONDS = 15;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const SPOKEN = ['今日は朝のルーティンを紹介します', 'まずはコーヒーを淹れるところから', '豆は挽きたてが一番おいしい', 'お湯は少し冷ましてから注ぎます', 'ここがいちばん大事'];
export const SOURCE_STYLE = {
    color: '#FFD400', size_px: 52, font_weight: 900,
    stroke: { color: '#D12B2B', width_px: 5 },
    background: { color: '#1E3A8A', opacity: 0.85, radius_px: 12, mode: 'block' },
    animation: { in: { id: 'fade-up', duration_sec: 0.6 } }
};
export const DECO_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;background:transparent}
.deco{position:absolute;left:4%;top:6%;width:22%;height:12%;border:6px solid #FF3D7F;border-radius:14px;box-sizing:border-box;background:rgba(255,61,127,.18)}
</style></head><body><div class="deco" data-deco="frame"></div></body></html>
`;

async function project(name, { anchored, sfxAnchor = false, library = false }) {
    const dir = path.join(OUT, name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.join(dir, 'assets'), { recursive: true });
    await mkdir(path.join(dir, 'overlays'), { recursive: true });
    run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', `color=c=0x27313f:size=1280x720:rate=${FPS}:duration=${SECONDS}`,
        '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`, '-shortest',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
    run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'lavfi', '-i', 'sine=frequency=1320:sample_rate=48000:duration=0.4', '-af', 'afade=t=out:st=0.25:d=0.15',
        '-ac', '2', path.join(dir, 'assets', 'pop.wav')], dir);
    await writeFile(path.join(dir, 'overlays', 'deco.html'), DECO_HTML);
    const deco = anchored
        ? [{ id: 'deco-c2', at: 90, duration: 75, anchor: { caption: 'c-0002', duration: 'caption' }, source: { kind: 'html', path: 'overlays/deco.html' } },
            { id: 'deco-c3', at: 180, duration: 75, anchor: { caption: 'c-0003', duration: 'caption' }, source: { kind: 'html', path: 'overlays/deco.html' } }]
        : [{ id: 'deco-a', at: 0, duration: 75, source: { kind: 'html', path: library ? 'assets/overlay/deco-frame/deco.html' : 'overlays/deco.html' } }];
    const sfx = anchored
        ? [{ id: 'sfx-c2', at: 90, duration: 12, role: 'sfx', gain_db: 0, ...(sfxAnchor ? { anchor: { caption: 'c-0002', duration: 'own' } } : {}), source: { kind: 'media', src: 'pop' } }]
        : [{ id: 'sfx-a', at: 0, duration: 12, role: 'sfx', gain_db: 0, source: { kind: 'media', src: 'pop' } }];
    const tracks = [{ id: 'v-main', lane: 'visual', name: 'Base', items: [{
        id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 }
    }] }, { id: 'v-deco', lane: 'visual', name: '装飾', items: deco },
    { id: 'v-captions', lane: 'visual', name: '字幕', items: [{
        id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: []
    }] }, { id: 'a1', lane: 'audio', name: 'A1', items: sfx }];
    const captions = { default_text_style: { zone: 'bottom' }, captions: SPOKEN.map((text, index) => ({
        id: `c-000${index + 1}`, start: index * 3, end: index * 3 + 2.5, text, speaker: null, sourceRef: null, edited: false, src: 'a',
        ...(index === 0 && !anchored ? { text_style: SOURCE_STYLE } : {})
    })) };
    await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
    const edit = { version: 2, output: { width: 1280, height: 720, fps: FPS },
        sources: [{ id: 'a', path: 'assets/base.mp4' }, { id: 'pop', path: library ? 'assets/audio/sfx-pop/pop.wav' : 'assets/pop.wav' }], tracks };
    if (library) {
        await rm(path.join(dir, 'assets', 'pop.wav'));
        await rm(path.join(dir, 'overlays'), { recursive: true });
        await mkdir(path.join(dir, '.akari'), { recursive: true });
        await writeFile(path.join(dir, '.akari', 'asset-references.json'), `${JSON.stringify({ version: 0, references: [
            { id: 'sfx-pop', category: 'audio' }, { id: 'deco-frame', category: 'overlay' }] }, null, 2)}\n`);
    }
    await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
    run('/usr/bin/git', ['init', '-q'], dir);
    run('/usr/bin/git', ['config', 'user.email', 'mystyle-fixture@localhost'], dir);
    run('/usr/bin/git', ['config', 'user.name', 'mystyle fixture'], dir);
    run('/usr/bin/git', ['add', '-A'], dir);
    run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
    return dir;
}

const anchored = await project('anchored', { anchored: true });
const anchoredSfx = await project('anchored-sfx', { anchored: true, sfxAnchor: true });
const spoken = await project('spoken', { anchored: false, library: true });
// ライブラリの実体（効果音・装飾）
const LIB = path.join(OUT, 'library');
await rm(LIB, { recursive: true, force: true });
const meta = (id, category, title, file) => ({ id, category, title, description: `${title}（L1 fixture）`, tags: ['l1-fixture'], requires: [],
    provenance: { origin: 'mystyle-attach-parts L1 fixture' }, author: 'fixture',
    license: { spdx: 'MIT', scope: 'commercial-ok', attribution_required: false, ai_training_allowed: true }, price: null });
await mkdir(path.join(LIB, 'audio', 'sfx-pop'), { recursive: true });
await cp(path.join(anchored, 'assets', 'pop.wav'), path.join(LIB, 'audio', 'sfx-pop', 'pop.wav'));
await writeFile(path.join(LIB, 'audio', 'sfx-pop', 'meta.json'), `${JSON.stringify(meta('sfx-pop', 'audio', 'ポンという効果音', 'pop.wav'), null, 2)}\n`);
await mkdir(path.join(LIB, 'overlay', 'deco-frame'), { recursive: true });
await writeFile(path.join(LIB, 'overlay', 'deco-frame', 'deco.html'), DECO_HTML);
await writeFile(path.join(LIB, 'overlay', 'deco-frame', 'meta.json'), `${JSON.stringify(meta('deco-frame', 'overlay', 'ピンクの枠', 'deco.html'), null, 2)}\n`);
console.log(JSON.stringify({ anchored, anchoredSfx, spoken, library: LIB }));
