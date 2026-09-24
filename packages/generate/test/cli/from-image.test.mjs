import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runVideoCommand } from '../../src/cli/video.mjs';
import { runResumeCommand } from '../../src/cli/resume.mjs';
import { loadCatalog, findModel } from '../../src/cli/catalog.mjs';
import { writeGenerating } from '../../src/cli/meta-video.mjs';
import { makeReference } from '../../src/cli/media-ref.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const source = path.join(here, '../fixtures/cli-video');
const image = 'assets/stills/start.png';
const args = root => [root, '--from-image', image, '--prompt', 'A garden.', '--resolution', '768P'];
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-from-image-'));
  await cp(source, root, { recursive: true });
  await rm(path.join(root, 'assets/generated/done.mp4'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return root;
}
function fakeFetch(mp4) {
  return async (url, init) => {
    if (init?.method === 'POST') return response({ request_id: 'req-image', status_url: 'https://queue.fal.run/fake/status', response_url: 'https://queue.fal.run/fake/response' });
    if (String(url).includes('/status')) return response({ status: 'COMPLETED' });
    if (String(url).endsWith('/response')) return response({ video: { url: 'https://queue.fal.run/fake/video.mp4' } });
    if (String(url).endsWith('/video.mp4')) return new Response(mp4);
    throw Error(`unexpected fetch ${url}`);
  };
}
const key = () => ({ key: 'fake', key_source: 'env:FAL_KEY' });

test('--from-image は edit を開かず新しい mp4 と妥当な meta を作る', async t => {
  const root = await fixture(t);
  const before = await readFile(path.join(root, 'edit.json'));
  const mp4 = await readFile(path.join(source, 'assets/generated/done.mp4'));
  let snapshots = 0;
  const errors = [];
  const result = await runVideoCommand([...args(root), '--yes', '--json'], {
    fetchImpl: fakeFetch(mp4), resolveFalKeyImpl: key, pollIntervalMs: 0,
    openProjectImpl: () => { throw Error('edit must not open'); },
    snapshotImpl: () => { snapshots++; },
    probeImpl: () => ({ duration_s_actual: 2, has_audio: false }),
    log: () => {}, errorLog: message => errors.push(message),
  });
  assert.equal(result.exitCode, 0, errors.join('\n'));
  assert.equal(snapshots, 0);
  assert.match(result.result.mp4, /^assets\/generated\/start-video-\d+\.mp4$/u);
  assert.deepEqual(await readFile(path.join(root, 'edit.json')), before);
  const meta = JSON.parse(await readFile(path.join(root, result.result.meta), 'utf8'));
  assert.equal(meta.status, 'done');
  assert.equal(meta.kind, 'video');
  assert.equal(meta.provenance.tool, 'akari generate video --from-image');
  assert.equal(meta.inputs.first_frame.path, image);
  assert.equal(meta.inputs.first_frame.source_id, null);
  assert.equal(Object.hasOwn(meta, 'placeholder'), false);
  assert.equal(spawnSync(process.execPath, [path.join(repo, 'packages/schemas/bin/validate-generation-meta.mjs'), path.join(root, result.result.meta)]).status, 0);
});

test('--from-image の承認、排他、dry-run、パス境界', async t => {
  const root = await fixture(t);
  let fetches = 0;
  const base = { fetchImpl: () => { fetches++; throw Error('network'); }, log: () => {}, errorLog: () => {} };
  assert.equal((await runVideoCommand([...args(root), '--dry-run'], base)).exitCode, 0);
  assert.equal((await runVideoCommand(args(root), { ...base, input: { isTTY: false }, output: { isTTY: false } })).exitCode, 2);
  let confirmations = 0;
  assert.equal((await runVideoCommand(args(root), { ...base, input: { isTTY: true }, output: { isTTY: true }, confirmImpl: () => { confirmations++; return false; } })).exitCode, 2);
  assert.equal(confirmations, 1);
  assert.equal((await runVideoCommand([...args(root), '--item', 'clip-a'], base)).exitCode, 2);
  assert.equal((await runVideoCommand([root, '--from-image', '../outside.png', '--dry-run'], base)).exitCode, 2);
  assert.equal(fetches, 0);
  assert.deepEqual(await readdir(path.join(root, 'assets/generated')), []);
});

test('edit.json の無い素材だけのプロジェクトで画像 next を読み --inputs が優先する', async t => {
  const root = await fixture(t);
  await rm(path.join(root, 'edit.json'));
  await writeFile(path.join(root, `${image}.meta.json`), JSON.stringify({ next: {
    kind: 'video', status: 'planned', model: { id: 'fal:h3-i2v' },
    inputs: { prompt: 'draft prompt', first_frame: { path: image } },
    output: { duration_s: 6, resolution: '768P' },
  } }));
  const noNetwork = () => { throw Error('network'); };
  const draft = await runVideoCommand([root, '--from-image', image, '--dry-run', '--json'], {
    fetchImpl: noNetwork, log: () => {}, errorLog: () => {},
  });
  assert.equal(draft.exitCode, 0);
  assert.equal(draft.result.body.prompt, 'draft prompt');
  assert.equal(draft.result.body.duration, 6);
  const explicit = await runVideoCommand([root, '--from-image', image, '--inputs', JSON.stringify({
    inputs: { prompt: 'explicit prompt' }, output: { duration_s: 5, resolution: '768P' },
  }), '--dry-run'], { fetchImpl: noNetwork, log: () => {}, errorLog: () => {} });
  assert.equal(explicit.exitCode, 0);
  assert.equal(explicit.result.body.prompt, 'explicit prompt');
});

test('resume は from-image の generating job を edit 無変更で done にする', async t => {
  const root = await fixture(t);
  const before = await readFile(path.join(root, 'edit.json'));
  const model = findModel(await loadCatalog(), 'fal:h3-i2v');
  const metaPath = path.join(root, 'assets/generated/start-video-123.mp4.meta.json');
  const meta = writeGenerating({ metaPath, model, inputs: {
    prompt: 'A garden.', negative_prompt: null, first_frame: makeReference(root, image), last_frame: null,
    reference_images: [], reference_videos: [], reference_audios: [], source_video: null,
    camera: null, seed: null, extra: {},
  }, output: { duration_s: 5, resolution: '768P' }, cost: { estimate_usd: 0.3 },
  key_source: 'env:FAL_KEY', request_id: 'req-image', status_url: 'https://queue.fal.run/fake/status',
  response_url: 'https://queue.fal.run/fake/response', started_at: new Date().toISOString() });
  meta.provenance.tool = 'akari generate video --from-image';
  await writeFile(metaPath, JSON.stringify(meta));
  const mp4 = await readFile(path.join(source, 'assets/generated/done.mp4'));
  let snapshots = 0;
  const result = await runResumeCommand([root, '--json'], {
    fetchImpl: fakeFetch(mp4), resolveFalKeyImpl: key,
    snapshotImpl: () => { snapshots++; }, probeImpl: () => ({ duration_s_actual: 2, has_audio: false }),
    log: () => {}, errorLog: () => {},
  });
  assert.equal(result.exitCode, 0);
  assert.equal(snapshots, 0);
  assert.deepEqual(await readFile(path.join(root, 'edit.json')), before);
  assert.equal(JSON.parse(await readFile(metaPath, 'utf8')).status, 'done');
});
