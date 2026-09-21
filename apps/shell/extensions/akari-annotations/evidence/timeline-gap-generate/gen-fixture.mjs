import { cp, mkdir, writeFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../../../../', import.meta.url));
export async function createFixture(project) {
  await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
  await mkdir(path.join(project, 'assets'), { recursive: true });
  const vendor = path.join(repo, 'packages/media-bin/vendor', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const ffmpeg = process.env.AKARI_FFMPEG_BIN || ((await stat(vendor).catch(() => null))?.isFile() ? vendor : 'ffmpeg');
  for (const [id, color] of [['a', '0x235caa'], ['b', '0xb95835']]) {
    await promisify(execFile)(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360:r=30`,
      '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(project, `assets/${id}.mp4`)]);
  }
  const edit = { version: 2, output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: 'a', path: 'assets/a.mp4' }, { id: 'b', path: 'assets/b.mp4' }],
    tracks: [{ id: 'video', lane: 'visual', name: '映像', items: [
      { id: 'left', name: '動画A', at: 0, duration: 90, source: { kind: 'media', src: 'a', in: 0, out: 3 } },
      { id: 'right', name: '動画B', at: 210, duration: 90, source: { kind: 'media', src: 'b', in: 0, out: 3 } }
    ] }] };
  await writeFile(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2) + '\n');
  await writeFile(path.join(project, 'captions.json'), '{"captions":[]}\n');
  return { edit, ffmpeg };
}
