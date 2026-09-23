// 字幕の座布団の幅（background.fit）検証用 fixture。1280x720・2 秒・背景 #000040・字幕 2 本
// （0〜1 秒「短い」/ 1〜2 秒「これは少し長めの字幕の行です」・size_px 48・下中央）。
// 使い方: node gen-fixture.mjs <出力先> <before|after>
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [OUT, PHASE = 'after'] = process.argv.slice(2);
const W = 1280, H = 720, FPS = 30, SEC = 2;
const common = {
  'p-none': { color: '#ff0000' },
  'p-w100': { color: '#ff0000', width_pct: 100 },
  'p-pad16': { color: '#ff0000', padding_px: 16 },
  'p-block': { color: '#ff0000', mode: 'block' },
};
const after = {
  'p-frame': { color: '#ff0000', fit: 'frame' },
  'p-frame-pad16': { color: '#ff0000', padding_px: 16, fit: 'frame' },
  'p-frame-block': { color: '#ff0000', mode: 'block', fit: 'frame' },
  'p-frame-w100': { color: '#ff0000', width_pct: 100, fit: 'frame' },
  'p-text': { color: '#ff0000', fit: 'text' },
};
const variants = PHASE === 'before' ? common : { ...common, ...after };
for (const [name, background] of Object.entries(variants)) {
  const dir = path.join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0x000040:s=${W}x${H}:r=${FPS}`,
    '-t', String(SEC), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(dir, 'assets', 'base.mp4')]);
  const captions = {
    default_text_style: { text_anchor: 'bc', position: { y: 0.9 }, size_px: 48, color: '#ffffff', background },
    captions: [
      { id: 'c-0001', start: 0, end: 1, text: '短い', speaker: null, sourceRef: null, edited: false },
      { id: 'c-0002', start: 1, end: 2, text: 'これは少し長めの字幕の行です', speaker: null, sourceRef: null, edited: false },
    ],
  };
  const edit = {
    version: 2, output: { width: W, height: H, fps: FPS },
    sources: [{ id: 'main', path: 'assets/base.mp4' }],
    tracks: [
      { id: 'v-main', lane: 'visual', items: [{ id: 'main-clip', at: 0, duration: SEC * FPS, source: { kind: 'media', src: 'main', in: 0, out: SEC } }] },
      { id: 'caption-track', lane: 'visual', items: [{ id: 'captions', at: 0, duration: SEC * FPS, source: { kind: 'captions', path: 'captions.json' }, items: [] }] },
    ],
  };
  writeFileSync(path.join(dir, 'captions.json'), JSON.stringify(captions, null, 2) + '\n');
  writeFileSync(path.join(dir, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  const git = (...a) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'user.name=fx', '-c', 'user.email=fx@example.invalid', ...a], { cwd: dir, stdio: 'pipe' });
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'fixture');
  console.log('prepared', name);
}
