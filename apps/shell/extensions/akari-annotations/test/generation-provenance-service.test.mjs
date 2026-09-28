import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { generationProvenance } from '../lib/browser/inspector/generation-provenance.js';

const sourcePath = 'out/narration/n-0001.wav';
const hash = content => createHash('sha256').update(content).digest('hex');

test('採用ナレーションは sidecar が無くても同じ内容の候補 meta を読む', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-narration-provenance-'));
  try {
    const candidateDir = path.join(root, 'assets/generated/candidates/voice-frame');
    await mkdir(path.join(root, 'out/narration'), { recursive: true });
    await mkdir(candidateDir, { recursive: true });
    const audio = Buffer.from('candidate audio bytes');
    await writeFile(path.join(root, sourcePath), audio);
    const candidate = path.join(candidateDir, 'voicevox-123.wav');
    await writeFile(candidate, audio);
    const meta = { version: 1, kind: 'audio', status: 'done', candidate_of: 'voice-frame',
      route: 'voicevox', voice: 'speaker-3', model: { id: 'voicevox:tts' },
      inputs: { prompt: '前回の原稿' }, result: { sha256: hash(audio) } };
    await writeFile(`${candidate}.meta.json`, JSON.stringify(meta));
    const request = { projectRootUri: pathToFileURL(root).href, sourcePath };
    const service = new AkariAnnotationsServiceImpl();
    const adopted = (await service.readGenerationProvenance(request)).meta;
    assert.deepEqual(adopted, meta);
    const rows = Object.fromEntries(generationProvenance(adopted).rows.map(row => [row.key, row.value]));
    assert.equal(rows.prompt, '前回の原稿');
    assert.equal(rows.voice, 'speaker-3');

    await writeFile(path.join(root, sourcePath), 'different adopted audio');
    assert.deepEqual(await service.readGenerationProvenance(request), {});

    const direct = { ...meta, inputs: { prompt: '直接の sidecar' } };
    await writeFile(path.join(root, `${sourcePath}.meta.json`), JSON.stringify(direct));
    assert.deepEqual((await service.readGenerationProvenance(request)).meta, direct);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('作り方の読み口は project 外パスと sidecar の symlink 逃げを拒否する', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-provenance-boundary-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'akari-provenance-outside-'));
  try {
    await mkdir(path.join(root, 'out/narration'), { recursive: true });
    await writeFile(path.join(root, sourcePath), 'audio');
    await writeFile(path.join(outside, 'outside.meta.json'), '{}');
    const service = new AkariAnnotationsServiceImpl();
    const projectRootUri = pathToFileURL(root).href;
    await assert.rejects(service.readGenerationProvenance({ projectRootUri, sourcePath: '../outside.wav' }), /相対パス/u);
    await symlink(path.join(outside, 'outside.meta.json'), path.join(root, `${sourcePath}.meta.json`));
    await assert.rejects(service.readGenerationProvenance({ projectRootUri, sourcePath }), /プロジェクトの外/u);
    await rm(path.join(root, `${sourcePath}.meta.json`));
    await rm(path.join(root, sourcePath));
    await writeFile(path.join(outside, 'outside.wav'), 'outside audio');
    await symlink(path.join(outside, 'outside.wav'), path.join(root, sourcePath));
    await assert.rejects(service.readGenerationProvenance({ projectRootUri, sourcePath }), /プロジェクトの外/u);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
