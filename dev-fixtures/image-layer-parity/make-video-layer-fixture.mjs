// task 2026-08-10-image-layer-parity 受け入れ条件6の回帰証跡フィクスチャ。
// 製品ソースではなく検証用フィクスチャ -- 「既存の動画レイヤー(拡張子が画像でない .mp4)」を
// 持つ最小 edit.json を1つ生成するだけのスクリプト。isImageLayerSource() は拡張子で
// 分岐するだけなので、.mp4 レイヤーはこの変更の前後でまったく同じ ffmpeg 引数になるはず
// (layers.mjs 側で新設した `isImageSource` 分岐が false のまま) -- そのことを
// 「変更前(main)/変更後 で同じ入力をレンダリングしてハッシュ一致」で実測するための入力を
// このスクリプトが作る(レンダリング自体・ハッシュ比較は呼び出し側 = report.md に記載した
// 手順で行う。2本の worktree の render-cut を両方叩く必要があるため、このスクリプト自身は
// 単一 worktree の中で完結させず、複製元の生成だけを担当する)。
//
// 使い方: node dev-fixtures/image-layer-parity/make-video-layer-fixture.mjs <出力先ディレクトリ>
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node make-video-layer-fixture.mjs <出力先ディレクトリ>');
  process.exit(1);
}

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 25;
const DURATION = 5;

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, '.akari'), { recursive: true });

ffmpeg(['-f', 'lavfi', '-i', `color=c=blue:s=${WIDTH}x${HEIGHT}:d=${DURATION}:r=${FPS}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(outDir, 'source.mp4')]);
// Non-image extension layer source (existing "video" kind PinP layer) -- must be byte-identical
// ffmpeg args before/after this task's change, since isImageLayerSource('layer.mp4') is false.
ffmpeg(['-f', 'lavfi', '-i', `color=c=lime:s=300x200:d=2:r=${FPS}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(outDir, 'layer.mp4')]);

writeFileSync(
  join(outDir, 'edit.json'),
  `${JSON.stringify({
    version: 0,
    output: { width: WIDTH, height: HEIGHT, fps: FPS },
    source: { path: 'source.mp4', proxy: null },
    cuts: [{ in: 0, out: DURATION }],
    overlays: [],
    layers: [
      {
        id: 'video-layer',
        t: 1,
        duration: 2,
        kind: 'video',
        src: 'layer.mp4',
        transform: { x: 20, y: -10, scale: 1, rotate: 0 },
      },
    ],
  }, null, 2)}\n`,
);
writeFileSync(join(outDir, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');

console.log(`fixture written to ${outDir}`);
