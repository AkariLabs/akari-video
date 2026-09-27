import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { AkariAnnotationsServiceImpl } from '../../lib/node/akari-annotations-service.js';
import { plannedStillMeta } from '../../../../../../packages/generate/src/cli/meta-still.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const models = ['fal:h3-i2v', 'fal:kling-v3-standard-i2v', 'fal:seedance-2.0-i2v'];
const modelProfiles = [
  { model: 'fal:h3-i2v', endpoint: '/minimax/h3/image-to-video', color: 'red',
    targetDurationSec: 0.5, queueMs: 120, processingMs: 450 },
  { model: 'fal:kling-v3-standard-i2v', endpoint: '/fal-ai/kling-video/v3/standard/image-to-video', color: 'green',
    targetDurationSec: 0.75, queueMs: 180, processingMs: 650 },
  { model: 'fal:seedance-2.0-i2v', endpoint: '/bytedance/seedance-2.0/image-to-video', color: 'blue',
    targetDurationSec: 1.0, queueMs: 240, processingMs: 850 },
];
const profileByModel = new Map(modelProfiles.map(profile => [profile.model, profile]));
const profileByEndpoint = new Map(modelProfiles.map(profile => [profile.endpoint, profile]));
const sha = value => createHash('sha256').update(value).digest('hex');
const root = await mkdtemp(path.join(os.tmpdir(), 'gen-compare-video-node-l1-'));
const fixture = path.join(repo, 'packages/generate/test/fixtures/cli-video');
const events = [];
const jobs = new Map();
let failOne = false;
let server;
try {
  await cp(fixture, root, { recursive: true });
  await rm(path.join(root, 'assets/generated/done.mp4'));
  await mkdir(path.join(root, '.akari'), { recursive: true });
  const now = new Date().toISOString();
  const meta = plannedStillMeta({ prompt: '', duration_s: 6, at: now, asOf: now.slice(0, 10) });
  meta.next = { kind: 'video', status: 'planned', model: { id: models[0] },
    inputs: { prompt: 'A colored frame moves gently.', first_frame: { path: 'assets/stills/start.png' } },
    output: { duration_s: 6, resolution: '768P' }, updated_at: now };
  await writeFile(path.join(root, 'assets/stills/start.png.meta.json'), `${JSON.stringify(meta)}\n`);
  const clips = new Map();
  for (const profile of modelProfiles) {
    const target = path.join(root, `stub-${profile.model.replace(/[^A-Za-z0-9]/gu, '-')}.mp4`);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      `color=c=${profile.color}:s=64x64:d=${profile.targetDurationSec}`, '-c:v', 'mpeg4', '-y', target]);
    clips.set(profile.model, await readFile(target));
  }
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const send = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.method === 'POST') {
      for await (const _ of req) { /* consume request */ }
      const profile = profileByEndpoint.get(url.pathname);
      if (!profile) return send({ error: 'unknown endpoint' }, 404);
      const id = String(jobs.size + 1);
      const receivedAtMs = Date.now();
      const event = { id, model: profile.model, endpoint: url.pathname, color: profile.color,
        targetDurationSec: profile.targetDurationSec, processingTargetMs: profile.processingMs, receivedAtMs };
      jobs.set(id, { profile, receivedAtMs, failing: failOne && profile.model === 'fal:kling-v3-standard-i2v', event });
      events.push(event);
      return send({ request_id: id, status_url: `http://127.0.0.1:${server.address().port}/status/${id}`,
        response_url: `http://127.0.0.1:${server.address().port}/response/${id}` });
    }
    const id = url.pathname.split('/').at(-1);
    const job = jobs.get(id);
    if (!job) return send({ error: 'missing job' }, 404);
    if (url.pathname.startsWith('/status/')) {
      const elapsedMs = Date.now() - job.receivedAtMs;
      if (elapsedMs < job.profile.queueMs) return send({ status: 'IN_QUEUE' });
      if (elapsedMs < job.profile.processingMs) return send({ status: 'IN_PROGRESS' });
      if (!job.event.terminalAtMs) {
        job.event.terminalAtMs = Date.now();
        job.event.processingObservedMs = job.event.terminalAtMs - job.receivedAtMs;
      }
      return send(job.failing ? { status: 'FAILED', error: 'stub model failure' } : { status: 'COMPLETED' });
    }
    if (url.pathname.startsWith('/response/')) return send({ video: { url: `http://127.0.0.1:${server.address().port}/video/${id}` } });
    if (url.pathname.startsWith('/video/')) {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.end(clips.get(job.profile.model));
      return;
    }
    return send({ error: 'unknown' }, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.FAL_KEY = 'local-stub-key';
  process.env.AKARI_FAL_STUB_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.AKARI_GENERATE_CLI = path.join(repo, 'packages/akari-launcher/bin/akari.mjs');
  process.env.AKARI_HOME = path.join(root, 'isolated-home');
  const service = new AkariAnnotationsServiceImpl();
  const request = { projectRootUri: pathToFileURL(root).href, itemId: 'clip-a', models };
  const editPath = path.join(root, 'edit.json');
  const beforeSha256 = sha(await readFile(editPath));
  const estimate = await service.estimateVideoBatch(request);
  const run = async failing => {
    failOne = failing;
    const startEvents = events.length;
    const progress = [];
    const queueTransitions = Object.fromEntries(models.map(model => [model, []]));
    const directory = path.join(root, 'assets/generated/candidates/clip-a');
    const beforeMetas = new Set(await readdir(directory).catch(() => []));
    const sample = async () => {
      const names = (await readdir(directory).catch(() => []))
        .filter(name => name.endsWith('.mp4.meta.json') && !beforeMetas.has(name));
      for (const name of names) {
        const candidate = await readFile(path.join(directory, name), 'utf8').then(JSON.parse).catch(() => null);
        const transitions = queueTransitions[candidate?.route];
        const status = candidate?.job?.queue_status;
        if (transitions && status && transitions.at(-1)?.status !== status) transitions.push({ status, atMs: Date.now() });
      }
      const state = await service.readVideoCandidates(request).catch(() => null);
      const frameMeta = await readFile(path.join(root, 'assets/stills/start.png.meta.json'), 'utf8')
        .then(JSON.parse).catch(() => null);
      if (state && frameMeta) progress.push({ atMs: Date.now(), running: state.running,
        frameStatus: frameMeta.status, frameJob: { provider: frameMeta.job?.provider,
          routes: frameMeta.job?.routes, completed: frameMeta.job?.completed,
          candidates: frameMeta.job?.candidates, failed: frameMeta.job?.failed },
        completed: state.completed, routes: state.routes, candidates: state.candidates.length });
    };
    let sampling = Promise.resolve();
    const timer = setInterval(() => { sampling = sampling.then(sample); }, 20);
    let result;
    try { result = await service.startGenerateVideoBatch({ ...request, approved: true }); }
    finally { clearInterval(timer); await sampling; }
    const received = events.slice(startEvents);
    const metas = (await readdir(directory)).filter(name => name.endsWith('.mp4.meta.json') && !beforeMetas.has(name)).sort();
    const current = metas.map(async name => {
      const value = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
      const file = value.result?.path ? await readFile(path.join(root, value.result.path)) : null;
      const profile = profileByModel.get(value.route);
      const historyElapsed = (Date.parse(value.history?.at(-1)?.at) - Date.parse(value.job?.started_at)) / 1000;
      const status = value.job?.queue_status;
      const transitions = queueTransitions[value.route];
      if (status && transitions?.at(-1)?.status !== status) transitions.push({ status, atMs: Date.now() });
      return { route: value.route, status: value.status, queueStatus: value.job?.queue_status,
        candidateOf: value.candidate_of, placeholderAbsent: !Object.hasOwn(value, 'placeholder'),
        path: value.result?.path ?? null, durationSeconds: value.result?.duration_s_actual ?? null,
        width: value.result?.width ?? null, height: value.result?.height ?? null,
        fileBytes: file?.length ?? 0, fileMatchesModel: file ? sha(file) === sha(clips.get(value.route)) : null,
        color: profile.color, elapsedSeconds: value.result?.elapsed_s ?? Number(historyElapsed.toFixed(3)),
        elapsedSource: value.result?.elapsed_s === undefined ? 'history' : 'result',
        costUsd: value.cost?.estimate_usd ?? null, reason: value.history?.at(-1)?.reason ?? null };
    });
    const finalFrame = JSON.parse(await readFile(path.join(root, 'assets/stills/start.png.meta.json'), 'utf8'));
    return { results: result.results.map(row => ({ route: row.route, ok: row.ok })),
      received, receivedSpanMs: Math.max(...received.map(row => row.receivedAtMs)) - Math.min(...received.map(row => row.receivedAtMs)),
      progress, queueTransitions, finalFrameJob: finalFrame.job,
      metas: await Promise.all(current), editSha256: sha(await readFile(editPath)) };
  };
  const success = await run(false);
  const failure = await run(true);
  const beforeDenied = events.length;
  let denied = false;
  try { await service.startGenerateVideoBatch(request); } catch (error) { denied = /費用承認/u.test(String(error)); }
  const deniedReceives = events.length - beforeDenied;
  assert.equal(denied, true);
  assert.equal(deniedReceives, 0);
  assert.equal(success.results.filter(row => row.ok).length, 3);
  assert.equal(success.metas.length, 3);
  assert.equal(failure.results.filter(row => row.ok).length, 2);
  assert.equal(failure.results.filter(row => !row.ok).length, 1);
  assert.equal(failure.metas.length, 3);
  assert.equal(success.metas.every(row => row.status === 'done' && row.fileBytes > 0), true);
  assert.equal(failure.metas.filter(row => row.status === 'done' && row.fileBytes > 0).length, 2);
  assert.equal(success.metas.every(row => row.fileMatchesModel), true);
  assert.equal(failure.metas.filter(row => row.status === 'done').every(row => row.fileMatchesModel), true);
  for (const model of models) {
    assert.deepEqual(success.queueTransitions[model].map(row => row.status), ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']);
    assert.deepEqual(failure.queueTransitions[model].map(row => row.status), model === 'fal:kling-v3-standard-i2v'
      ? ['IN_QUEUE', 'IN_PROGRESS'] : ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED']);
  }
  assert.equal(success.finalFrameJob.completed, 3);
  assert.equal(failure.finalFrameJob.completed, 3);
  assert.equal(success.editSha256, beforeSha256);
  assert.equal(failure.editSha256, beforeSha256);
  const record = { models, modelProfiles, estimate, beforeSha256, success, failure,
    approvedFalse: { denied, stubReceives: deniedReceives } };
  await writeFile(path.join(here, 'l1-results.json'), `${JSON.stringify(record, null, 2)}\n`);
  const table = modelProfiles.map(profile => {
    const event = success.received.find(row => row.model === profile.model);
    const candidate = success.metas.find(row => row.route === profile.model);
    const transitions = success.queueTransitions[profile.model].map(row => row.status).join(' → ');
    return `| ${profile.model} | ${profile.color} | ${profile.targetDurationSec} | ${profile.processingMs} | ${event.processingObservedMs} | ${candidate.durationSeconds} | ${candidate.elapsedSeconds} | ${transitions} |`;
  }).join('\n');
  await writeFile(path.join(here, 'l1-results.md'), `# L1 node 結合\n\n` +
    `| モデル | 色 | 指定 MP4 尺 (秒) | 設定処理 ms | 実測処理 ms | 実 MP4 尺 (秒) | 候補 elapsed_s | queue_status の推移 |\n` +
    `|---|---|---:|---:|---:|---:|---:|---|\n${table}\n\n` +
    `- 3 モデルのスタブ受信間隔: ${success.receivedSpanMs} ms。成功回は 3 候補。\n` +
    `- 失敗回: Kling を固定で失敗させ、2 候補完了・1 失敗。詳細の elapsed_s と queue_status は JSON に記録。\n` +
    `- approved 無し: スタブ受信 ${deniedReceives}。\n` +
    `- edit.json sha256: ${beforeSha256} → ${failure.editSha256}。\n`);
  console.log(JSON.stringify({ success: success.results, failure: failure.results, receivedSpanMs: success.receivedSpanMs,
    approvedFalseReceives: deniedReceives, editUnchanged: failure.editSha256 === beforeSha256 }));
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
