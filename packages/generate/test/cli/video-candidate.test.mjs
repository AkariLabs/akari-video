import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runVideoCommand } from '../../src/cli/video.mjs';
import { runResumeCommand } from '../../src/cli/resume.mjs';
import { openProject } from '../../../edit-store/lib/project.js';

const fixture = new URL('../fixtures/cli-video/', import.meta.url);
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

test('動画候補は route と queue_status を meta に残し、edit を変更しない。resume も同じ候補へ書く', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gen-compare-video-node-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fixture, root, { recursive: true });
  const before = await readFile(path.join(root, 'edit.json'));
  const videoBytes = Buffer.from('stub-video-bytes');
  let submitQueueStatus;
  const fetchImpl = async (url, init) => {
    if (init?.method === 'POST') return json({ request_id: 'req-1', status_url: 'https://queue.fal.run/status', response_url: 'https://queue.fal.run/response' });
    if (String(url).includes('/status')) {
      const names = (await readdir(path.join(root, 'assets/generated/candidates/clip-a'))).filter(name => name.endsWith('.mp4.meta.json'));
      submitQueueStatus = JSON.parse(await readFile(path.join(root, 'assets/generated/candidates/clip-a', names[0]))).job.queue_status;
      return json({ status: 'COMPLETED' });
    }
    if (String(url).includes('/response')) return json({ video: { url: 'https://queue.fal.run/video' } });
    if (String(url).includes('/video')) return new Response(videoBytes);
    throw new Error('unexpected stub request');
  };
  let projectReads = 0;
  const options = { fetchImpl, resolveFalKeyImpl: () => ({ key: 'stub', key_source: 'test' }),
    probeImpl: () => ({ duration_s_actual: 1, width: 64, height: 64, has_audio: false }),
    snapshotImpl: async () => { throw new Error('candidate must not snapshot'); },
    openProjectImpl: async projectDir => { if (++projectReads > 1) throw new Error('candidate must not reopen project to replace'); return openProject(projectDir); },
    log: () => {}, errorLog: () => {}, pollIntervalMs: 0 };
  const result = await runVideoCommand([root, '--item', 'clip-a', '--model', 'fal:h3-i2v',
    '--prompt', 'A garden moves.', '--resolution', '768P', '--candidate', '--yes'], options);
  assert.equal(result.exitCode, 0);
  assert.equal(projectReads, 1);
  const directory = path.join(root, 'assets/generated/candidates/clip-a');
  const names = (await readdir(directory)).filter(name => name.endsWith('.mp4.meta.json'));
  assert.equal(names.length, 1);
  assert.match(names[0], /^fal-h3-i2v-\d+\.mp4\.meta\.json$/u);
  const metaPath = path.join(directory, names[0]);
  const meta = JSON.parse(await readFile(metaPath));
  assert.equal(meta.candidate_of, 'clip-a');
  assert.equal(meta.route, 'fal:h3-i2v');
  assert.equal(meta.kind, 'video');
  assert.equal(meta.job.queue_status, 'COMPLETED');
  assert.equal(submitQueueStatus, 'IN_QUEUE');
  assert.equal(Object.hasOwn(meta, 'placeholder'), false);
  assert.deepEqual(await readFile(path.join(root, 'edit.json')), before);
  meta.status = 'generating';
  delete meta.result;
  meta.job.queue_status = 'IN_PROGRESS';
  await writeFile(metaPath, `${JSON.stringify(meta)}\n`);
  projectReads = 0;
  const resumed = await runResumeCommand([root, '--json'], options);
  assert.equal(resumed.exitCode, 0);
  assert.equal(resumed.result[0].item, 'clip-a');
  assert.equal(resumed.result[0].status, 'done');
  assert.equal(resumed.result[0].mp4, result.result.mp4);
  assert.equal(JSON.parse(await readFile(metaPath)).status, 'done');
  assert.deepEqual(await readFile(path.join(root, 'edit.json')), before);
});

test('submit 応答の status を候補 meta の初期 queue_status に使う', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gen-compare-video-node-submit-status-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fixture, root, { recursive: true });
  let initialStatus;
  const fetchImpl = async (url, init) => {
    if (init?.method === 'POST') return json({ request_id: 'req-2', status: 'IN_PROGRESS',
      status_url: 'https://queue.fal.run/status', response_url: 'https://queue.fal.run/response' });
    if (String(url).includes('/status')) {
      const directory = path.join(root, 'assets/generated/candidates/clip-a');
      const name = (await readdir(directory)).find(row => row.endsWith('.mp4.meta.json'));
      initialStatus = JSON.parse(await readFile(path.join(directory, name))).job.queue_status;
      return json({ status: 'COMPLETED' });
    }
    if (String(url).includes('/response')) return json({ video: { url: 'https://queue.fal.run/video' } });
    return new Response(Buffer.from('stub-video'));
  };
  const result = await runVideoCommand([root, '--item', 'clip-a', '--model', 'fal:h3-i2v',
    '--prompt', 'A garden moves.', '--resolution', '768P', '--candidate', '--yes'], {
    fetchImpl, resolveFalKeyImpl: () => ({ key: 'stub', key_source: 'test' }),
    probeImpl: () => ({ duration_s_actual: 1 }), pollIntervalMs: 0,
    log: () => {}, errorLog: () => {},
  });
  assert.equal(result.exitCode, 0);
  assert.equal(initialStatus, 'IN_PROGRESS');
});

test('--from-image のログと result は従来の形を保つ', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gen-compare-video-node-from-image-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fixture, root, { recursive: true });
  const logs = [];
  const fetchImpl = async (url, init) => {
    if (init?.method === 'POST') return json({ request_id: 'req-3', status_url: 'https://queue.fal.run/status', response_url: 'https://queue.fal.run/response' });
    if (String(url).includes('/status')) return json({ status: 'COMPLETED' });
    if (String(url).includes('/response')) return json({ video: { url: 'https://queue.fal.run/video' } });
    return new Response(Buffer.from('stub-video'));
  };
  const result = await runVideoCommand([root, '--from-image', 'assets/stills/start.png', '--model', 'fal:h3-i2v',
    '--prompt', 'A garden moves.', '--resolution', '768P', '--yes'], {
    fetchImpl, resolveFalKeyImpl: () => ({ key: 'stub', key_source: 'test' }),
    probeImpl: () => ({ duration_s_actual: 1 }), pollIntervalMs: 0,
    log: line => logs.push(line), errorLog: line => logs.push(line),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.result.from_image, 'assets/stills/start.png');
  assert.deepEqual(Object.keys(result.result),
    ['from_image', 'mp4', 'duration_s_actual', 'estimate_usd', 'elapsed_s', 'meta']);
  assert.match(logs.at(-1), /^新しい素材を作りました: assets\/generated\//u);
});

test('動画の fal スタブ URL はローカル HTTP だけ受ける', async () => {
  const { falQueueFetch } = await import('../../src/cli/fal-queue.mjs');
  assert.throws(() => falQueueFetch({ AKARI_FAL_STUB_URL: 'https://example.com' }), /ローカル HTTP/u);
  const fetch = falQueueFetch({ AKARI_FAL_STUB_URL: 'http://127.0.0.1:9876' }, async url => url);
  assert.equal(await fetch('https://queue.fal.run/example'), 'http://127.0.0.1:9876/example');
  assert.throws(() => fetch('https://example.com/video'), /ローカル HTTP/u);
});
