import { spawnSync } from 'node:child_process';
import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const projects = ['a-source-chroma', 'b-lut-100', 'b-lut-050', 'c-lut-pip-telop', 'd-layer-chroma', 'e-transition-lut', 'inert'];
for (const project of projects) await mkdir(join(root, project, 'media'), { recursive: true });

const ffmpeg = (...args) => {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `ffmpeg exited ${result.status}`);
};
const make = (path, filter) => ffmpeg(
  '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=10:d=2',
  '-vf', filter, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path
);

const green = join(root, 'a-source-chroma/media/green.mp4');
const pattern = join(root, 'b-lut-100/media/pattern.mp4');
const layer = join(root, 'd-layer-chroma/media/green-pip.mp4');
const red = join(root, 'c-lut-pip-telop/media/red-pip.mp4');
make(green, 'drawbox=x=0:y=0:w=iw:h=ih:color=0x00ff00:t=fill,drawbox=x=120:y=50:w=80:h=80:color=white:t=fill');
make(pattern, 'drawbox=x=0:y=0:w=iw:h=ih:color=0x406080:t=fill,drawbox=x=20:y=20:w=100:h=60:color=0xe08020:t=fill,drawbox=x=210:y=100:w=90:h=60:color=0x20a060:t=fill');
ffmpeg('-f', 'lavfi', '-i', 'color=c=0x00ff00:s=100x100:r=10:d=2', '-vf',
  'drawbox=x=30:y=30:w=40:h=40:color=white:t=fill', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', layer);
make(red, 'drawbox=x=0:y=0:w=iw:h=ih:color=0xd02020:t=fill');

for (const project of ['b-lut-050', 'c-lut-pip-telop', 'inert']) {
  await copyFile(pattern, join(root, project, 'media/pattern.mp4'));
}
await copyFile(pattern, join(root, 'e-transition-lut/media/pattern.mp4'));
await copyFile(red, join(root, 'e-transition-lut/media/red.mp4'));
await copyFile(pattern, join(root, 'd-layer-chroma/media/pattern.mp4'));

console.log(`generated ${projects.length} static projects under ${root}`);
