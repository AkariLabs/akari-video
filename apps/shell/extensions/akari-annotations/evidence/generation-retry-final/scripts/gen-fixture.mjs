#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SOURCE = path.join(REPO, 'apps', 'shell', 'extensions', 'akari-annotations', 'test', 'fixtures', 'inspector-generation');
const PROJECT = process.env.AKARI_GENERATION_PROJECT;
if (!PROJECT) throw new Error('AKARI_GENERATION_PROJECT must point to an isolated temporary project');
const FFMPEG = process.env.FFMPEG || path.join(REPO, 'packages', 'media-bin', 'vendor', 'darwin-arm64', 'ffmpeg');
const { readEditV2 } = await import(pathToFileURL(path.join(REPO, 'packages/edit-store/lib/edit-v2.js')));
const { validateGenerationMeta } = await import(pathToFileURL(path.join(REPO, 'packages/generate/src/cli/meta-validate.mjs')));
const createdAt = new Date().toISOString();
const inputs = overrides => ({ prompt: 'A garden.', negative_prompt: null, first_frame: null, last_frame: null,
  reference_images: [], reference_videos: [], reference_audios: [], source_video: null, camera: null, seed: null, extra: {}, ...overrides });
const reference = async file => ({ path: file, sha256: createHash('sha256').update(await readFile(path.join(PROJECT, file))).digest('hex') });
const metaBase = (kind, status) => ({
  version: 1, kind, status, model: { id: kind === 'still' ? 'codex-image' : 'fal:h3-i2v', as_of: '2026-09-12' },
  inputs: inputs(), output: { duration_s: 5 }, cost: { estimate_usd: 0, unit: 'USD', source: 'estimate' },
  job: { provider: 'fake', started_at: createdAt, stale_after_s: 900 },
  provenance: { created_at: createdAt, tool: 'l1-generation-retry-final-fixture' }, history: []
});
const result = async (file, duration) => ({ ...await reference(file), bytes: (await readFile(path.join(PROJECT, file))).length,
  duration_s_actual: duration });

const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', reject);
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr.slice(-1600)}`)));
});
const atomicJson = async (file, value) => {
  if (file.endsWith('.meta.json')) {
    const validation = validateGenerationMeta(value);
    if (!validation.ok) throw new Error(`${file}: ${validation.errors.join('; ')}`);
  }
  if (path.basename(file) === 'edit.json') readEditV2(value);
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
  ...metaBase('still', 'done'), result: await result(`assets/stills/${name}.png`, 0),
  ...(name === 'a' ? { next: {
    kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
    inputs: inputs({ first_frame: await reference('assets/stills/a.png'), last_frame: await reference('assets/stills/b.png') }),
    output: { duration_s: 6, resolution: '768P', audio_out: true }, updated_at: new Date().toISOString()
  } } : {})
});
await atomicJson(path.join(PROJECT, 'captions.json'), { captions: [] });

const edit = JSON.parse(await readFile(path.join(PROJECT, 'edit.json'), 'utf8'));
// A wide failed clip and a narrow failed clip share the same source-independent placeholder binding.
// Keep the retry clip wide enough after adding the final-quality clip (H3 max: 15 seconds).
edit.tracks[0].items[0].duration = 450;
edit.tracks[0].items[0].source.out = 15;
edit.tracks[0].items[1].at = 450;
edit.tracks[0].items[1].duration = 30;
edit.tracks[0].items[1].source.out = 1;
edit.tracks[0].items[2].at = 480;
const finalQuality = {
  itemId: 'clip-final', sourcePath: 'assets/generated/gen-clip-final.mp4',
  originalPath: 'assets/stills/final.png', draftResolution: '480P', selectedResolution: '768P', modelId: 'fal:h3-i2v'
};
await copyFile(path.join(PROJECT, 'assets/stills/c.png'), path.join(PROJECT, finalQuality.originalPath));
const originalNext = {
  kind: 'video', status: 'planned', model: { id: finalQuality.modelId },
  inputs: inputs({ prompt: 'A garden in the wind.', first_frame: await reference(finalQuality.originalPath), seed: 42 }),
  output: { duration_s: 5, resolution: finalQuality.selectedResolution, audio_out: true }, updated_at: new Date().toISOString()
};
await atomicJson(path.join(PROJECT, `${finalQuality.originalPath}.meta.json`), {
  ...metaBase('still', 'done'), result: await result(finalQuality.originalPath, 0), next: originalNext
});
await mkdir(path.join(PROJECT, 'assets/generated'), { recursive: true });
await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#2e8b57:s=854x480:r=30',
  '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(PROJECT, finalQuality.sourcePath)], PROJECT);
await atomicJson(path.join(PROJECT, `${finalQuality.sourcePath}.meta.json`), {
  ...metaBase('video', 'done'), inputs: originalNext.inputs,
  output: { ...originalNext.output, resolution: finalQuality.draftResolution },
  placeholder: { ...await reference(finalQuality.originalPath), item_id: finalQuality.itemId },
  result: { ...await result(finalQuality.sourcePath, 5), width: 854, height: 480, fps: '30/1', has_audio: false }
});
edit.sources.push({ id: 'video-final', path: finalQuality.sourcePath });
edit.tracks[0].items.push({ id: finalQuality.itemId, at: 660, duration: 150,
  source: { kind: 'media', src: 'video-final', in: 0, out: 5 } });
await atomicJson(path.join(PROJECT, 'edit.json'), edit);
for (const [name, itemId] of [['a', 'clip-a'], ['b', 'clip-b']]) {
  const still = JSON.parse(await readFile(path.join(PROJECT, `assets/stills/${name}.png.meta.json`), 'utf8'));
  still.next ??= { kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
    inputs: inputs(), output: { duration_s: 5, resolution: '768P' }, updated_at: createdAt };
  await atomicJson(path.join(PROJECT, `assets/stills/${name}.png.meta.json`), still);
  await atomicJson(path.join(PROJECT, `assets/generated/gen-${itemId}.mp4.meta.json`), {
    ...metaBase('video', 'failed'), inputs: still.next.inputs, output: still.next.output,
    placeholder: { ...await reference(`assets/stills/${name}.png`), item_id: itemId },
    history: [{ at: new Date().toISOString(), status: 'failed', reason: 'Local retry fixture' }]
  });
}
process.stdout.write(`${JSON.stringify({
  ok: true,
  project: '<TMP>/project',
  clips: edit.tracks?.[0]?.items?.map(item => item.id) ?? [],
  sidecars: ['a', 'b', 'c'].map(name => `assets/stills/${name}.png.meta.json`),
  captions: true,
  finalQuality
})}\n`);
