#!/usr/bin/env node
// 同梱テキストスタイル全件の見た目比較用 fixture（ラッパー作成の検証スクリプト）。
// presets/textstyle/index.jsonl の全件を 1 秒ずつの字幕（style_preset = id・文言 = sample_text）にした 1920x1080 / 10fps の
// プロジェクトを作る。映像は ffmpeg の単色（L1 専用）。使い方: node gen-styles-fixture.mjs <出力先>
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..', '..', '..', '..');
const OUT = path.resolve(process.argv[2]);
const FPS = 10;
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
};
const rows = (await readFile(path.join(REPO, 'presets/textstyle/index.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
const SECONDS = rows.length;
const dir = path.join(OUT, 'styles');
await rm(dir, { recursive: true, force: true });
await mkdir(path.join(dir, 'assets'), { recursive: true });
run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', `color=c=0x3b4a5c:size=1920x1080:rate=${FPS}:duration=${SECONDS}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'assets', 'base.mp4')], dir);
const captions = { default_text_style: { zone: 'bottom' }, captions: rows.map((row, index) => ({
    id: `s-${String(index + 1).padStart(2, '0')}`, start: index, end: index + 1, text: row.sample_text || row.name,
    speaker: null, sourceRef: null, edited: false, src: 'a', style_preset: row.id
})) };
await writeFile(path.join(dir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
const tracks = [{ id: 'v-main', lane: 'visual', name: 'Base', items: [{
    id: 'cut-base', at: 0, duration: SECONDS * FPS, source: { kind: 'media', src: 'a', in: 0, out: SECONDS, speed: 1 }
}] }, { id: 'v-captions', lane: 'visual', name: '字幕', items: [{
    id: 'captions', name: '字幕', at: 0, duration: SECONDS * FPS, source: { kind: 'captions', path: 'captions.json' }, items: []
}] }, { id: 'a1', lane: 'audio', name: 'A1', items: [] }];
const edit = { version: 2, output: { width: 1920, height: 1080, fps: FPS }, sources: [{ id: 'a', path: 'assets/base.mp4' }], tracks };
await writeFile(path.join(dir, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
run('/usr/bin/git', ['init', '-q'], dir);
run('/usr/bin/git', ['config', 'user.email', 'textstyle-lab-crown-fixture@localhost'], dir);
run('/usr/bin/git', ['config', 'user.name', 'textstyle-lab-crown fixture'], dir);
run('/usr/bin/git', ['add', '-A'], dir);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture'], dir);
console.log(JSON.stringify({ styles: dir, count: rows.length }));
