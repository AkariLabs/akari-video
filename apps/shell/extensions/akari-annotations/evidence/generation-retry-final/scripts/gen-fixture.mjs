#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SOURCE = path.join(REPO, 'apps', 'shell', 'extensions', 'akari-annotations', 'test', 'fixtures', 'inspector-generation');
const PROJECT = process.env.AKARI_GENERATION_PROJECT;
if (!PROJECT) throw new Error('AKARI_GENERATION_PROJECT must point to an isolated temporary project');
const FFMPEG = process.env.FFMPEG || path.join(REPO, 'packages', 'media-bin', 'vendor', 'darwin-arm64', 'ffmpeg');

const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`)));
});
const atomicJson = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
};


await mkdir(path.join(PROJECT, 'assets', 'stills'), { recursive: true });
await mkdir(path.join(PROJECT, '.akari'), { recursive: true });
await copyFile(path.join(SOURCE, 'edit.json'), path.join(PROJECT, 'edit.json'));
// connections.json はここで書き起こす（コピー元にしない）。リポジトリの .gitignore が
// `.akari/` を丸ごと無視するため、test/fixtures/ 側に置いても取り込まれず、
// 新しいクローンでは copyFile が ENOENT で落ちる。
await atomicJson(path.join(PROJECT, '.akari', 'connections.json'), {
  providers: [],
  defaults: { generate: { still: 'codex-image', video: 'fal:h3-i2v' } },
  policy: { currency: 'USD', monthly_budget: null, approval_threshold: null },
  memory: []
});

for (const [name, color] of [['a', '#d6402b'], ['b', '#1f6f8b'], ['c', '#2e8b57']]) {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360`,
    '-frames:v', '1', path.join(PROJECT, 'assets', 'stills', `${name}.png`)
  ], PROJECT);
}

for (const name of ['a', 'b', 'c']) await atomicJson(path.join(PROJECT, 'assets', 'stills', `${name}.png.meta.json`), {
  version: 1, kind: 'still', status: 'done',
  provenance: { created_at: new Date().toISOString(), tool: 'l1-inspector-generation-fixture' },
  ...(name === 'a' ? { next: {
    kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
    inputs: { prompt: 'A garden.', first_frame: { path: 'assets/stills/a.png' }, last_frame: { path: 'assets/stills/b.png' }, reference_images: [], reference_audios: [], camera: null },
    output: { duration_s: 6, resolution: '768P', audio_out: true }, updated_at: new Date().toISOString()
  } } : {})
});
await atomicJson(path.join(PROJECT, 'captions.json'), { captions: [] });

const edit = JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
// A wide failed clip and a narrow failed clip share the same source-independent placeholder binding.
edit.tracks[0].items[0].duration = 300;
edit.tracks[0].items[0].source.out = 10;
edit.tracks[0].items[1].at = 300;
edit.tracks[0].items[1].duration = 30;
edit.tracks[0].items[1].source.out = 1;
edit.tracks[0].items[2].at = 330;
await atomicJson(path.join(PROJECT, 'edit.json'), edit);
for (const [name, itemId] of [['a', 'clip-a'], ['b', 'clip-b']]) {
  const still = JSON.parse(await readFile(path.join(PROJECT, `assets/stills/${name}.png.meta.json`), 'utf8'));
  still.next ??= { kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
    inputs: { prompt: 'A garden.', first_frame: null }, output: { duration_s: 5, resolution: '768P' } };
  await atomicJson(path.join(PROJECT, `assets/stills/${name}.png.meta.json`), still);
  await atomicJson(path.join(PROJECT, `assets/generated/gen-${itemId}.mp4.meta.json`), {
    version: 1, kind: 'video', status: 'failed', model: still.next.model, inputs: still.next.inputs, output: still.next.output,
    placeholder: { path: `assets/stills/${name}.png`, item_id: itemId },
    history: [{ at: new Date().toISOString(), status: 'failed', reason: 'Local retry fixture' }]
  });
}
process.stdout.write(`${JSON.stringify({
  ok: true,
  project: '<TMP>/project',
  clips: edit.tracks?.[0]?.items?.map(item => item.id) ?? [],
  sidecars: ['a', 'b', 'c'].map(name => `assets/stills/${name}.png.meta.json`),
  captions: true
})}\n`);
