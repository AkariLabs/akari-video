import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { replaceVideoInEdit } from '../lib/browser/inspector/ai-video-candidates-panel.js';

test('done の枠は候補 meta を変えず、別ファイルの下書きと進捗で同じ列へ作り直す', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-regenerate-'));
  try {
    const candidateDir = path.join(root, 'assets/generated/candidates/clip-a');
    await mkdir(candidateDir, { recursive: true });
    const oldPath = 'assets/generated/candidates/clip-a/old.mp4';
    const nextPath = 'assets/generated/candidates/clip-a/new.mp4';
    const edit = { version: 2, output: { fps: 30 }, sources: [{ id: 'gen-clip-a-video', path: oldPath }],
      tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'clip-a', at: 0, duration: 180,
        source: { kind: 'media', src: 'gen-clip-a-video', in: 0, out: 6 } }] }] };
    await writeFile(path.join(root, 'edit.json'), JSON.stringify(edit));
    await writeFile(path.join(root, oldPath), 'old video');
    const oldMeta = { version: 1, kind: 'video', status: 'done', candidate_of: 'clip-a', route: 'fal:h3-i2v',
      model: { id: 'fal:h3-i2v' }, inputs: { prompt: 'old prompt', first_frame: null,
        reference_images: [], reference_videos: [], reference_audios: [], extra: {} },
      output: { duration_s: 6, resolution: '768P', audio_out: true },
      job: { provider: 'fal', started_at: '2026-09-27T00:00:00Z' }, result: { duration_s_actual: 6 } };
    const oldMetaPath = path.join(root, `${oldPath}.meta.json`);
    await writeFile(oldMetaPath, JSON.stringify(oldMeta));
    const digest = text => createHash('sha256').update(text).digest('hex');
    const originalHash = digest(await readFile(oldMetaPath));
    const service = new AkariAnnotationsServiceImpl();
    const request = { projectRootUri: pathToFileURL(root).toString(), itemId: 'clip-a' };
    await service.writeGenerationDraft({ ...request, modelId: 'fal:h3-i2v',
      inputs: { ...oldMeta.inputs, prompt: 'revised prompt' }, output: oldMeta.output });
    assert.equal(digest(await readFile(oldMetaPath)), originalHash);
    const draftPath = path.join(root, '.akari/generation/clip-a.inputs.json');
    assert.equal(JSON.parse(await readFile(draftPath)).inputs.prompt, 'revised prompt');
    let sent;
    service.generationCli = {
      startCandidateWithInputs: async (_root, _itemId, modelId, inputsPath) => {
        sent = JSON.parse(await readFile(inputsPath));
        await writeFile(path.join(root, nextPath), 'new video');
        await writeFile(path.join(root, `${nextPath}.meta.json`), JSON.stringify({ ...oldMeta,
          inputs: sent.inputs, route: modelId, job: { started_at: '2026-09-28T00:00:00Z' } }));
        return { ok: true, stdout: `${JSON.stringify({ mp4: nextPath, elapsed_s: 1, estimate_usd: 0.36 })}\n` };
      }
    };
    const batch = await service.startGenerateVideoBatch({ ...request, models: ['fal:h3-i2v'], approved: true });
    assert.equal(batch.candidates[0].relativePath, nextPath);
    assert.equal(sent.inputs.prompt, 'revised prompt');
    assert.equal(digest(await readFile(oldMetaPath)), originalHash);
    const progress = JSON.parse(await readFile(path.join(root, '.akari/generation/clip-a.compare.meta.json')));
    assert.equal(progress.job.provider, 'compare');
    assert.equal(progress.job.candidates, 2);
    const candidates = await service.readVideoCandidates(request);
    assert.deepEqual(candidates.candidates.map(candidate => candidate.relativePath), [nextPath, oldPath]);
    const before = structuredClone(edit);
    replaceVideoInEdit(edit, 'clip-a', { ...candidates.candidates[0], durationSeconds: 6 });
    assert.equal(edit.sources[0].path, nextPath);
    // The timeline's one committed mutation restores this prior snapshot on one undo.
    assert.equal(before.sources[0].path, oldPath);
  } finally { await rm(root, { recursive: true, force: true }); }
});
