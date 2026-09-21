import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(here), 'fixture');
const ffmpeg = process.env.AKARI_FFMPEG || 'ffmpeg';

const words = (text, start, end) => {
  const tokens = [...text];
  const step = (end - start) / tokens.length;
  return tokens.map((token, index) => ({
    start: Number((start + step * index).toFixed(3)),
    end: Number((start + step * (index + 1)).toFixed(3)),
    text: token
  }));
};
const cue = (id, start, end, text) => ({
  id, start, end, text, speaker: null, sourceRef: null, edited: false, src: 'a',
  words: words(text, start, end)
});

const captions = {
  default_text_style: { zone: 'bottom' },
  captions: [
    cue('c-0001', 0, 2, '一行目の字幕'),
    cue('c-0002', 2, 4, '二行目の字幕'),
    cue('c-0003', 4, 6, '三行目の字幕'),
    { ...cue('c-0004', 0, 6, '上に置いた文字'), time_domain: 'output', text_style: { zone: 'top', size_px: 48 } }
  ]
};

const edit = {
  version: 2,
  output: { width: 1280, height: 720, fps: 30 },
  sources: [{ id: 'a', path: 'assets/base-10s.mp4' }],
  tracks: [
    {
      id: 'v-main', lane: 'visual', name: 'Base',
      items: [{ id: 'cut-base', at: 0, duration: 180, source: { kind: 'media', src: 'a', in: 0, out: 6, speed: 1 } }]
    },
    {
      id: 'v-captions', lane: 'visual', name: '字幕',
      items: [{ id: 'captions', name: '字幕', at: 0, duration: 180, source: { kind: 'captions', path: 'captions.json' }, items: [] }]
    }
  ]
};

await mkdir(path.join(fixture, 'assets'), { recursive: true });
await writeFile(path.join(fixture, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
await writeFile(path.join(fixture, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);

const media = path.join(fixture, 'assets', 'base-10s.mp4');
let mediaReused = true;
try { await stat(media); } catch {
  mediaReused = false;
  const made = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x1e2530:size=1280x720:rate=30:duration=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', media
  ], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(made.stderr || `ffmpeg exited ${made.status}`);
}
process.stdout.write(`${JSON.stringify({ status: 'ok', cues: captions.captions.length, mediaReused })}\n`);
