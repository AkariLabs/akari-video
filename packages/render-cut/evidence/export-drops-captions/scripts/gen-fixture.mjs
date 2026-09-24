// 2 回目以降の書き出しで話した言葉の字幕が消える件の再現 fixture（検証用素材）。
// 前段（osr-captions-missing）の p-plain と同じ: 1280x720・3 秒・背景 #000040。話した言葉 2 行（src 無し・座布団 赤 #ff0000）+
// 置いた文字 1 本（time_domain "output"・座布団 緑 #00ff00）。
//   p-plain … 素材 1 本（sources は assets/base.mp4 だけ）
//   p-two   … 本当に素材 2 本の案件（タイムラインが 0〜1.5 秒 = main・1.5〜3 秒 = alt を参照）。字幕は同じく src 無し
//   p-policy… p-plain と同じ素材 1 本で、captions.json に display_policy（A4 の 1 行逐次表示）を宣言したもの（字幕の新しい解決経路）
// 使い方: node gen-fixture.mjs <出力先>
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [OUT] = process.argv.slice(2);
if (!OUT) throw new Error('usage: node gen-fixture.mjs <out-dir>');
const W = 1280, H = 720, FPS = 30, SEC = 3;
const ff = (color, file) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${W}x${H}:r=${FPS}`,
  '-t', String(SEC), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
const captions = {
  default_text_style: { text_anchor: 'bc', position: { y: 0.9 }, size_px: 48, color: '#ffffff', background: { color: '#ff0000' } },
  captions: [
    { id: 'c-0001', start: 0, end: 1.5, text: '今日は朝のルーティンを紹介します', speaker: null, sourceRef: { segment: 0 }, edited: false },
    { id: 'c-0002', start: 1.5, end: 3, text: 'まずはコーヒーを淹れるところから', speaker: null, sourceRef: { segment: 1 }, edited: false },
    {
      id: 'c-0101', start: 0, end: 3, text: '置いた文字', time_domain: 'output', sourceRef: null, edited: true, speaker: null,
      text_style: { position: { x: 0.5, y: 0.25 }, text_anchor: 'mc', background: { color: '#00ff00' } },
    },
  ],
};
const captionTrack = { id: 'caption-track', lane: 'visual', items: [{ id: 'captions', at: 0, duration: SEC * FPS, source: { kind: 'captions', path: 'captions.json' }, items: [] }] };
const variants = {
  'p-plain': {
    media: { 'assets/base.mp4': '0x000040' },
    sources: [{ id: 'main', path: 'assets/base.mp4' }],
    clips: [{ id: 'main-clip', at: 0, duration: SEC * FPS, source: { kind: 'media', src: 'main', in: 0, out: SEC } }],
  },
  'p-policy': {
    policy: true,
    media: { 'assets/base.mp4': '0x000040' },
    sources: [{ id: 'main', path: 'assets/base.mp4' }],
    clips: [{ id: 'main-clip', at: 0, duration: SEC * FPS, source: { kind: 'media', src: 'main', in: 0, out: SEC } }],
  },
  'p-two': {
    media: { 'assets/base.mp4': '0x000040', 'assets/alt.mp4': '0x003000' },
    sources: [{ id: 'main', path: 'assets/base.mp4' }, { id: 'alt', path: 'assets/alt.mp4' }],
    clips: [
      { id: 'main-clip', at: 0, duration: 45, source: { kind: 'media', src: 'main', in: 0, out: 1.5 } },
      { id: 'alt-clip', at: 45, duration: 45, source: { kind: 'media', src: 'alt', in: 1.5, out: 3 } },
    ],
  },
};
for (const [name, v] of Object.entries(variants)) {
  const dir = path.join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  for (const [rel, color] of Object.entries(v.media)) ff(color, path.join(dir, rel));
  const edit = {
    version: 2, output: { width: W, height: H, fps: FPS },
    sources: v.sources,
    tracks: [{ id: 'v-main', lane: 'visual', items: v.clips }, captionTrack],
  };
  const root = v.policy ? {
    display_policy: { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1', unit_metric: 'ascii-half-other-one-v1', max_line_units: 19, minimum_fragment_duration_seconds: 0.72, locale: 'ja', lines: 1, wrap: 'multi' },
    ...captions,
  } : captions;
  writeFileSync(path.join(dir, 'captions.json'), JSON.stringify(root, null, 2) + '\n');
  writeFileSync(path.join(dir, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  const git = (...a) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'user.name=fx', '-c', 'user.email=fx@example.invalid', ...a], { cwd: dir, stdio: 'pipe' });
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'fixture');
  console.log('prepared', name);
}
