import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { GenerationCliManager } from '../lib/node/generation-cli.js';
import { GenerationCandidates } from '../lib/node/generation-candidates.js';
import { StillGenerationManager } from '../lib/node/still-generation.js';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { replaceVideoCandidateItem } from '../lib/common/video-candidate-replace.js';
import { applyReplacement, planReplacement } from '../../../../../packages/generate/src/cli/edit-replace.mjs';
import { plannedStillMeta } from '../../../../../packages/generate/src/cli/meta-still.mjs';
import { writeGenerating, writeQueueStatus } from '../../../../../packages/generate/src/cli/meta-video.mjs';

const temp = () => mkdtemp(path.join(os.tmpdir(), 'gen-compare-video-node-test-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test('枠 × モデルだけ排他し、異なる 3 モデルは同時起動して中止できる', async () => {
  const children = [];
  const manager = new GenerationCliManager({ env: { AKARI_GENERATE_CLI: '/stub/cli.mjs' }, spawnImpl: (_command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.exitCode = null;
    child.kill = () => { child.emit('close', 143); return true; };
    children.push({ child, args });
    return child;
  } });
  const starts = ['fal:h3-i2v', 'fal:kling-v3-standard-i2v', 'fal:seedance-2.0-i2v']
    .map(model => manager.startCandidate('/stub/project', 'clip-a', model));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children.length, 3);
  assert.ok(children.every(row => row.args.includes('--candidate')));
  const duplicate = await manager.startCandidate('/stub/project', 'clip-a', 'fal:h3-i2v');
  assert.equal(duplicate.ok, false);
  assert.equal(children.length, 3);
  const cancelled = await manager.cancelBatch('clip-a');
  assert.equal(cancelled.length, 3);
  assert.equal((await Promise.all(starts)).filter(row => row.ok).length, 0);
});

test('共通バッチは 1 失敗でも残りを実行し枠 meta に進捗と理由を残す', async t => {
  const root = await temp();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sidecarPath = path.join(root, 'frame.png.meta.json');
  const at = new Date().toISOString();
  const original = plannedStillMeta({ prompt: '', duration_s: 6, at, asOf: at.slice(0, 10) });
  const batch = new GenerationCandidates();
  const snapshots = [];
  const result = await batch.batch('clip-a', ['a', 'b', 'c'], async () => ({ sidecarPath, original, previousCandidates: 0 }),
    async route => {
      await new Promise(resolve => setTimeout(resolve, route === 'a' ? 10 : route === 'b' ? 20 : 30));
      snapshots.push(JSON.parse(await readFile(sidecarPath)).job.completed);
      return route === 'b' ? { ok: false, reason: 'stub failure' } : { ok: true, relativePath: `${route}.mp4` };
    });
  assert.equal(result.completed, 3);
  assert.equal(result.candidates.filter(row => row.ok).length, 2);
  assert.equal(snapshots[0], 0);
  assert.equal(snapshots.every((value, index) => value >= (snapshots[index - 1] ?? 0) && value <= 2), true);
  const meta = JSON.parse(await readFile(sidecarPath));
  assert.equal(meta.job.provider, 'compare');
  assert.equal(meta.job.completed, 3);
  assert.equal(meta.job.candidates, 2);
  assert.deepEqual(meta.job.failed, [{ route: 'b', reason: 'stub failure' }]);
});

test('静止画候補は meta.route を優先し、古い候補はファイル名から読める', async t => {
  const root = await temp();
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'assets/generated/candidates/clip-a');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(root, 'frame.png'), png);
  await writeFile(path.join(root, 'edit.json'), JSON.stringify({ version: 2,
    sources: [{ id: 's', path: 'frame.png' }], tracks: [{ items: [{ id: 'clip-a', source: { kind: 'media', src: 's' } }] }] }));
  for (const [name, route] of [['codex-100.png', undefined], ['other-200.png', 'grok']]) {
    await writeFile(path.join(directory, name), png);
    await writeFile(path.join(directory, `${name}.meta.json`), JSON.stringify({ candidate_of: 'clip-a', status: 'done',
      ...(route ? { route } : {}), result: { width: 1, height: 1 } }));
  }
  const manager = new StillGenerationManager(async () => '');
  const result = await manager.readStillCandidates(root, 'clip-a', false);
  assert.deepEqual(new Set(result.candidates.map(row => row.route)), new Set(['codex', 'grok']));
});

test('動画の preferred はこの動画、アプリ、従来既定の順で選び、お気に入りを別配列に返す', async t => {
  const root = await temp();
  t.after(() => rm(root, { recursive: true, force: true }));
  const prior = process.env.AKARI_HOME;
  process.env.AKARI_HOME = path.join(root, 'home');
  t.after(() => { if (prior === undefined) delete process.env.AKARI_HOME; else process.env.AKARI_HOME = prior; });
  await mkdir(path.join(root, '.akari'), { recursive: true });
  await mkdir(process.env.AKARI_HOME, { recursive: true });
  const service = new AkariAnnotationsServiceImpl();
  service.readGenerationDefaults = async () => ({ video: 'fal:h3-i2v' });
  const uri = pathToFileURL(root).href;
  assert.equal((await service.readPreferredRoutes('video', uri)).source, 'generation');
  await writeFile(path.join(process.env.AKARI_HOME, 'ai-models.json'), JSON.stringify({ version: 1,
    defaults: { video: 'fal:kling-v3-standard-i2v' }, favorites: { video: ['fal:h3-i2v'] } }));
  assert.deepEqual(await service.readPreferredRoutes('video', uri), {
    defaultModelId: 'fal:kling-v3-standard-i2v', favorites: ['fal:h3-i2v'], source: 'app' });
  await writeFile(path.join(root, '.akari/ai-models.json'), JSON.stringify({ version: 1,
    defaults: { video: 'fal:seedance-2.0-i2v' } }));
  assert.equal((await service.readPreferredRoutes('video', uri)).defaultModelId, 'fal:seedance-2.0-i2v');
});

test('採用後 item は edit-replace.mjs と長尺・短尺で一致する', () => {
  for (const actual of [4, 8]) {
    const item = { id: 'clip-a', at: 0, duration: 180,
      source: { kind: 'media', src: 'still', in: 0, out: 6, framing: { fit: 'cover' }, fx: [] } };
    const project = { edit: { sources: [{ id: 'still', path: 'frame.png' }], tracks: [{ items: [structuredClone(item)] }] } };
    const plan = planReplacement({ item, sourceEntry: project.edit.sources[0], actualDurationS: actual, cutsDurationS: 6 });
    applyReplacement(project, { itemId: 'clip-a', mp4RelativePath: 'candidate.mp4', plan });
    assert.deepEqual(replaceVideoCandidateItem(item, actual), project.edit.tracks[0].items[0]);
    assert.equal(project.edit.tracks[0].items[0].source.mute, false);
  }
});

test('動画バッチは見積合計と価格不明を返し、承認なしでは送信 0', async t => {
  const root = await temp();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'assets/stills'), { recursive: true });
  await writeFile(path.join(root, 'assets/stills/frame.png'), png);
  await writeFile(path.join(root, 'edit.json'), JSON.stringify({ version: 2, output: { fps: 30 },
    sources: [{ id: 'still', path: 'assets/stills/frame.png' }],
    tracks: [{ items: [{ id: 'clip-a', source: { kind: 'media', src: 'still', in: 0, out: 6 } }] }] }));
  const at = new Date().toISOString();
  const meta = plannedStillMeta({ prompt: '', duration_s: 6, at, asOf: at.slice(0, 10) });
  meta.next = { kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
    inputs: { prompt: 'A garden moves.', first_frame: { path: 'assets/stills/frame.png' } },
    output: { duration_s: 6, resolution: '768P' }, updated_at: at };
  await writeFile(path.join(root, 'assets/stills/frame.png.meta.json'), JSON.stringify(meta));
  const service = new AkariAnnotationsServiceImpl();
  let starts = 0;
  service.generationCli = { startCandidate: async () => { starts++; return { ok: true, stdout: '{}' }; } };
  const request = { projectRootUri: pathToFileURL(root).href, itemId: 'clip-a',
    models: ['fal:h3-i2v', 'fal:kling-v3-standard-i2v', 'fal:seedance-2.0-i2v'] };
  const estimate = await service.estimateVideoBatch(request);
  assert.deepEqual(estimate.models.map(row => row.estimateUsd), [0.36, null, 1.8204]);
  assert.equal(estimate.totalUsd, 2.1804);
  assert.equal(estimate.needs_explicit_confirm, true);
  const mixed = await service.estimateVideoBatch({ ...request,
    models: ['fal:h3-i2v', 'fal:h3-ref'] });
  assert.equal(mixed.models[0].error, undefined);
  assert.match(mixed.models[1].error, /使え|フレーム|参照/u);
  assert.equal(mixed.totalUsd, 0.36);
  await assert.rejects(() => service.startGenerateVideoBatch({ ...request,
    models: ['fal:h3-i2v', 'fal:h3-ref'], approved: true }), /fal:h3-ref/u);
  assert.equal(starts, 0);
  await assert.rejects(() => service.startGenerateVideoBatch(request), /費用承認/u);
  assert.equal(starts, 0);
  const directory = path.join(root, 'assets/generated/candidates/clip-a');
  await mkdir(directory, { recursive: true });
  const metaPath = path.join(directory, 'fal-h3-i2v-100.mp4.meta.json');
  writeGenerating({ metaPath, model: { id: 'fal:h3-i2v', endpoint: 'stub', as_of: '2026-09-12', price: { unit: 'usd_per_second' } },
    inputs: { prompt: 'move', negative_prompt: null, first_frame: null, last_frame: null,
      reference_images: [], reference_videos: [], reference_audios: [], source_video: null,
      camera: null, seed: null, extra: {} },
    output: { duration_s: 6 }, cost: { estimate_usd: 0.36 }, key_source: 'test',
    request_id: 'stub-1', status_url: 'http://127.0.0.1/status', response_url: 'http://127.0.0.1/response',
    candidate_of: 'clip-a', route: 'fal:h3-i2v', started_at: '2026-01-02T00:00:00.000Z' });
  for (const [route, filename, started_at] of [
    ['fal:seedance-2.0-i2v', 'fal-seedance-2-0-i2v-200.mp4.meta.json', '2026-01-01T00:00:00.000Z'],
    ['fal:kling-v3-standard-i2v', 'fal-kling-v3-standard-i2v-300.mp4.meta.json', '2026-01-02T00:00:00.000Z'],
  ]) writeGenerating({ metaPath: path.join(directory, filename),
    model: { id: route, endpoint: 'stub', as_of: '2026-09-12', price: { unit: 'usd_per_second' } },
    inputs: { prompt: 'move', negative_prompt: null, first_frame: null, last_frame: null,
      reference_images: [], reference_videos: [], reference_audios: [], source_video: null,
      camera: null, seed: null, extra: {} },
    output: { duration_s: 6 }, cost: { estimate_usd: 0.36 }, key_source: 'test',
    request_id: 'stub-2', status_url: 'http://127.0.0.1/status', response_url: 'http://127.0.0.1/response',
    candidate_of: 'clip-a', route, started_at });
  writeQueueStatus(metaPath, 'IN_PROGRESS');
  const pending = await service.readVideoCandidates(request);
  assert.deepEqual(pending.candidates.map(row => row.route),
    ['fal:seedance-2.0-i2v', 'fal:h3-i2v', 'fal:kling-v3-standard-i2v']);
  assert.equal(pending.candidates[1].queueStatus, 'IN_PROGRESS');
  service.generationCli.cancelBatch = async () => [];
  await service.cancelGenerateVideoBatch(request);
  assert.equal(JSON.parse(await readFile(metaPath)).status, 'failed');
});

test('node サービスは batch の CLI 待機中も候補読み口に応答する', async t => {
  const root = await temp();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'assets/stills'), { recursive: true });
  await writeFile(path.join(root, 'assets/stills/frame.png'), png);
  await writeFile(path.join(root, 'edit.json'), JSON.stringify({ version: 2,
    sources: [{ id: 'still', path: 'assets/stills/frame.png' }],
    tracks: [{ items: [{ id: 'clip-a', source: { kind: 'media', src: 'still', in: 0, out: 6 } }] }] }));
  const at = new Date().toISOString();
  const meta = plannedStillMeta({ prompt: '', duration_s: 6, at, asOf: at.slice(0, 10) });
  meta.next = { kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
    inputs: { prompt: 'Move.', first_frame: { path: 'assets/stills/frame.png' } },
    output: { duration_s: 6, resolution: '768P' }, updated_at: at };
  await writeFile(path.join(root, 'assets/stills/frame.png.meta.json'), JSON.stringify(meta));
  const service = new AkariAnnotationsServiceImpl();
  const releases = [];
  service.generationCli = { startCandidate: () => new Promise(resolve => releases.push(resolve)) };
  const request = { projectRootUri: pathToFileURL(root).href, itemId: 'clip-a',
    models: ['fal:h3-i2v', 'fal:kling-v3-standard-i2v', 'fal:seedance-2.0-i2v'] };
  const batch = service.startGenerateVideoBatch({ ...request, approved: true });
  const deadline = Date.now() + 10_000;
  while (releases.length < 3 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(releases.length, 3);
  try {
    const live = await Promise.race([
      service.readVideoCandidates(request),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('候補読み口が CLI の完了まで待たされた')), 3_000))
    ]);
    assert.equal(live.running, true);
    assert.deepEqual(live.routes, request.models);
    assert.equal(live.completed, 0);
  } finally {
    for (const release of releases) release({ ok: false, reason: 'fixture', stdout: '' });
    await batch;
  }
});
