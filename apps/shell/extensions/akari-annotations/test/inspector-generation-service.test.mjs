import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

test('validateGenerationInputs は packages/generate の結果をそのまま返す', async () => {
  const service = new AkariAnnotationsServiceImpl();
  const request = {
    modelId: 'fal:h3-i2v',
    inputs: { prompt: 'move', first_frame: { path: 'still.png' }, reference_images: [], reference_videos: [], reference_audios: [], extra: {} },
    output: { duration_s: 6, resolution: '768P', audio_out: true }
  };
  const actual = await service.validateGenerationInputs(request);
  const catalog = await service.readGenerationCatalog();
  const direct = await import('../../../../../packages/generate/src/validate-inputs.mjs');
  assert.deepEqual(actual, direct.validateInputs({ ...request, model: catalog.models.find(row => row.id === request.modelId) }));
});

test('startGenerateVideo は approved true 以外では spawn 前に拒否する', async () => {
  const service = new AkariAnnotationsServiceImpl();
  let starts = 0;
  service.generationCli = { start: async () => { starts += 1; return { ok: true, stdout: '' }; } };
  await assert.rejects(() => service.startGenerateVideo({ projectRootUri: 'file:///tmp/project', itemId: 'clip' }), /費用承認/);
  assert.equal(starts, 0);
  assert.equal((await service.startGenerateVideo({ projectRootUri: 'file:///tmp/project', itemId: 'clip', approved: true })).ok, true);
  assert.equal(starts, 1);
});

test('writeGenerationDraft は .akari/generation/<item>.inputs.json を書く', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-generation-service-'));
  try {
    await writeFile(path.join(root, 'edit.json'), '{}\n');
    await writeFile(path.join(root, 'captions.json'), '{}\n');
    const before = await Promise.all(['edit.json', 'captions.json'].map(file => stat(path.join(root, file))));
    const service = new AkariAnnotationsServiceImpl();
    const result = await service.writeGenerationDraft({ projectRootUri: pathToFileURL(root).toString(), itemId: 'clip-a', modelId: 'fal:h3-i2v', inputs: { prompt: 'move' }, output: { duration_s: 6 } });
    assert.equal(result.path, '.akari/generation/clip-a.inputs.json');
    const parsed = JSON.parse(await readFile(path.join(root, result.path), 'utf8'));
    assert.deepEqual(parsed, { modelId: 'fal:h3-i2v', inputs: { prompt: 'move' }, output: { duration_s: 6 } });
    const after = await Promise.all(['edit.json', 'captions.json'].map(file => stat(path.join(root, file))));
    assert.deepEqual(after.map(entry => entry.mtimeMs), before.map(entry => entry.mtimeMs));
  } finally { await rm(root, { recursive: true, force: true }); }
});
