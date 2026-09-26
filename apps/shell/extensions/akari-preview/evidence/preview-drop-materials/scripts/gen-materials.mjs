#!/usr/bin/env node
// 本票の fixture: gen-fixture.mjs の spoken（1280×720・12 秒・話した言葉 4 行）に、
// 左の「プロジェクト」の素材カードとして並ぶ映像・画像・音を assets/ へ足し、空の A1 を足して git 管理にする。
// 使い方: node gen-materials.mjs <出力先ディレクトリ>（<出力先>/spoken ができる）
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2]);
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const run = (command, args, cwd) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
    return result.stdout;
};
run(process.execPath, [path.join(HERE, 'gen-fixture.mjs'), OUT]);
const dir = path.join(OUT, 'spoken');
const ff = args => run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], dir);
// 映像: 640×360（16:9）4 秒・黄色の地に白い四角。画像: 800×600（4:3）の橙。音: 3 秒の 440Hz。
ff(['-f', 'lavfi', '-i', 'color=c=0xe0b020:size=640x360:rate=30:duration=4', '-vf', 'drawbox=x=220:y=100:w=200:h=160:color=white:t=fill',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'assets/clip-yellow.mp4']);
ff(['-f', 'lavfi', '-i', 'color=c=0xe05a20:size=800x600', '-frames:v', '1', 'assets/photo-orange.png']);
ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'aac', '-b:a', '96k', 'assets/tone-440.m4a']);
const editPath = path.join(dir, 'edit.json');
const edit = JSON.parse(await readFile(editPath, 'utf8'));
edit.tracks.push({ id: 'a1', lane: 'audio', name: 'A1', items: [] });
await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
run('/usr/bin/git', ['add', '-A'], dir);
run('/usr/bin/git', ['commit', '-q', '-m', 'fixture: materials + A1'], dir);
console.log(JSON.stringify({ project: dir }));
