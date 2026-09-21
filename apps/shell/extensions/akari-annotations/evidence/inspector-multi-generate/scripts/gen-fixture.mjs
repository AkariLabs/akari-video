#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const FFMPEG = process.env.FFMPEG || path.join(REPO, 'packages/media-bin/vendor', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(Error(`${command}: ${code}: ${stderr}`)));
});
const json = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

export async function createFixture(project) {
  await mkdir(path.join(project, 'assets/stills'), { recursive: true });
  await mkdir(path.join(project, '.akari'), { recursive: true });
  await copyFile(path.join(REPO, 'apps/shell/extensions/akari-annotations/test/fixtures/inspector-generation/edit.json'), path.join(project, 'edit.json'));
  await json(path.join(project, '.akari/connections.json'), {
    providers: [], defaults: { generate: { still: 'codex-image', video: 'fal:h3-i2v' } },
    policy: { currency: 'USD', monthly_budget: null, approval_threshold: null }, memory: []
  });
  for (const [name, color] of [['a', '#d6402b'], ['b', '#1f6f8b'], ['c', '#2e8b57']]) {
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360`,
      '-frames:v', '1', path.join(project, 'assets/stills', `${name}.png`)]);
    await json(path.join(project, 'assets/stills', `${name}.png.meta.json`), {
      version: 1, kind: 'still', status: 'done',
      ...(name !== 'c' ? { next: { kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
        inputs: { prompt: `Garden ${name}.`, first_frame: { path: `assets/stills/${name}.png` }, last_frame: null,
          reference_images: [], reference_videos: [], reference_audios: [], camera: null },
        output: { duration_s: 6, resolution: '768P', audio_out: true }, updated_at: new Date().toISOString()
      } } : {})
    });
  }
  await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#604ca1:s=640x360:r=30',
    '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(project, 'fake-result.mp4')]);
  // caption-source-map resolves src against edit.sources[].id, not the file path.
  // Source-local 0–4 seconds maps to timeline 0–4 (a) and 6–10 (b).
  // The fake CLI replaces paths but preserves these source IDs.
  await json(path.join(project, 'captions.json'), { captions: [
    { id: 'caption-a', src: 'still-a', start: 0, end: 4, text: '字幕その一', speaker: null, sourceRef: null, edited: false, time_domain: 'source' },
    { id: 'caption-b', src: 'still-b', start: 0, end: 4, text: '字幕その二', speaker: null, sourceRef: null, edited: false, time_domain: 'source' }
  ] });
  const edit = JSON.parse(await readFile(path.join(project, 'edit.json'), 'utf8'));
  return { clips: edit.tracks[0].items.map(item => item.id), planned: ['clip-a', 'clip-b'], still: 'clip-c', captions: ['caption-a', 'caption-b'] };
}
if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) {
  if (!process.argv[2]) throw Error('Usage: gen-fixture.mjs <empty temporary project directory>');
  console.log(JSON.stringify(await createFixture(path.resolve(process.argv[2]))));
}
