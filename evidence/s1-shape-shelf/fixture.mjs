// 検証専用のプロジェクト: 20 秒の無地の動画 1 本を本編に置いた edit.json v2。
// 書き出し（render-cut）が sources 空を拒否するため、下地は media にする。動画は ffmpeg で一時ディレクトリに作る。

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeFixtureProject(project) {
  await mkdir(path.join(project, 'assets'), { recursive: true });
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    'color=c=0x5b6b7a:s=1920x1080:r=30:d=20', '-pix_fmt', 'yuv420p', '-c:v', 'libx264',
    path.join(project, 'assets', 'bg.mp4')]);
  const edit = {
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'src-1', path: 'assets/bg.mp4' }],
    tracks: [
      { id: 'v1', lane: 'visual', items: [
        { id: 'bg', at: 0, duration: 600, source: { kind: 'media', src: 'src-1', in: 0, out: 20 } }] },
    ],
  };
  await writeFile(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
  await writeFile(path.join(project, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
  return path.join(project, 'edit.json');
}
