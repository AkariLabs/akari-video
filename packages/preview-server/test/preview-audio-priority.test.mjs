import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import vm from 'node:vm';
import { prepareFrameEngineAudioSummary, promotePreviewAudioSummaryAt, selectPreviewAudioItemsAt } from '../src/preview-audio-summary.mjs';

const source = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('priority selection: BGM, half-open intervals, unknown durations, unfinished states and stable first-use order', () => {
  const items = Object.freeze([
    { id: 'speech', kind: 'speech', at: 5, durationSec: 5, state: 'queued' },
    { id: 'future', kind: 'sfx', at: 11, state: 'queued' },
    { id: 'unknown', kind: 'narration', at: 4, state: 'generating' },
    { id: 'tie', kind: 'sfx', at: 5, durationSec: 5, state: 'queued' },
    { id: 'bed', kind: 'bgm', at: 0, durationSec: 1, state: 'queued' },
    ...['ready', 'no-audio', 'unavailable', 'failed'].map(state => ({ id: state, kind: 'bgm', state })),
  ].map(Object.freeze));
  assert.deepEqual(selectPreviewAudioItemsAt(items, 5).map(item => item.id), ['bed', 'unknown', 'tie', 'speech']);
  assert.deepEqual(selectPreviewAudioItemsAt(items, 10).map(item => item.id), ['bed', 'unknown']);
  assert.deepEqual(selectPreviewAudioItemsAt(items, -1).map(item => item.id), ['bed']);
  assert.deepEqual(selectPreviewAudioItemsAt(items, NaN), []);
  for (const durationSec of [undefined, null, 0, -1, Infinity, NaN]) {
    const item = { kind: 'sfx', at: 3, durationSec, state: 'queued' };
    assert.equal(selectPreviewAudioItemsAt([item], 2).length, 0);
    assert.equal(selectPreviewAudioItemsAt([item], 3000).length, 1);
  }
});

test('summary keeps absolute sources private and projects speech speed, regular trims and looping BGM', () => {
  const projectRoot = path.join(tmpdir(), 'priority-project');
  const result = prepareFrameEngineAudioSummary({
    output: { fps: 30 }, sources: [{ id: 'v', path: 'video.mp4' }],
    cuts: [{ id: 'cut', src: 'v', in: 4, out: 12, speed: 2 }],
    audio: { bgm: { path: 'bed.wav', out: 300 },
      sfx: [{ path: 'hit.wav', t: 7, in: 2, out: 5, lowcut_hz: 100 }],
      narration: [{ path: 'voice.wav', t: 10 }] },
  }, { projectRoot, cacheDir: path.join(projectRoot, '.akari/cache'), ffmpeg: 'fake',
    requestSidecar: () => ({ state: 'queued' }) });
  const byKind = Object.fromEntries(result.items.map(item => [item.kind, item]));
  assert.equal(byKind.speech.durationSec, 4);
  assert.equal(byKind.speech.at, 0);
  assert.equal(byKind.bgm.at, 0);
  assert.equal(byKind.bgm.durationSec, undefined);
  assert.equal(byKind.sfx.at, 7);
  assert.equal(byKind.sfx.durationSec, 3);
  assert.equal(byKind.narration.at, 10);
  assert.equal(byKind.narration.durationSec, undefined);
  assert.ok(result.priority.every(item => path.isAbsolute(item.sourcePath)));
  assert.ok(result.items.every(item => !('sourcePath' in item)));
});

// Run the actual route bodies with the same collectBody and an injected media-bin API.
// No ffmpeg or server child process is needed for this HTTP contract.
function router(summary, promote) {
  const bodyStart = source.indexOf('function collectBody(req)');
  const bodyEnd = source.indexOf('\nconst router', bodyStart);
  const routesStart = source.indexOf("  'GET /api/preview-audio/status'");
  const routesEnd = source.indexOf("  'GET /api/summary'", routesStart);
  const context = {
    Buffer, latestPreviewAudioSummary: summary, previewAudioCacheDir: path.join(tmpdir(), 'priority-cache'),
    promotePreviewAudioSummaryAt, promotePreviewAudioSidecars: promote,
    console: { error() {} }, respond: (res, status, data) => (res.result = { status, data: JSON.parse(JSON.stringify(data)) }),
  };
  const routes = vm.runInNewContext(`${source.slice(bodyStart, bodyEnd)}\n({${source.slice(routesStart, routesEnd)}})`, context);
  return async (body, method = 'POST /api/preview-audio/priority') => {
    const res = {};
    await routes[method](Readable.from([Buffer.from(body)]), res);
    return res.result;
  };
}

test('POST priority preserves final mixed key/probe first-use order and redacts its ascending response', async () => {
  const earlySource = path.join(tmpdir(), 'early.wav');
  const lateSource = path.join(tmpdir(), 'late.wav');
  const priority = [
    { kind: 'speech', id: 'late', at: 5, state: 'queued', sourcePath: lateSource },
    { kind: 'bgm', id: 'bed', at: 0, state: 'queued', key: 'bed-key' },
    { kind: 'narration', id: 'early', at: 2, state: 'generating', sourcePath: earlySource },
    { kind: 'speech', id: 'middle', at: 3, state: 'queued', key: 'middle-key' },
    { kind: 'sfx', id: 'ready', at: 4, state: 'ready', key: 'ready-key' },
  ];
  const calls = [];
  const queue = [];
  const call = router({ priority, items: priority.map(({ sourcePath, ...item }) => item) }, options => {
    calls.push(options);
    const promoted = [...options.keys, ...options.sourcePaths];
    for (const value of promoted) queue.unshift(value);
    return { promoted };
  });
  assert.deepEqual(await call('{"t":5}'), { status: 200, data: {
    promoted: ['bed-key', 'narration:early', 'middle-key', 'speech:late'],
  } });
  assert.deepEqual(queue, ['bed-key', earlySource, 'middle-key', lateSource]);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(options => options.cacheDir === path.join(tmpdir(), 'priority-cache')));
  const status = await call('', 'GET /api/preview-audio/status');
  assert.equal(status.status, 200);
  assert.ok(status.data.items.every(item => !('sourcePath' in item)));
});

test('POST priority validates JSON/time, accepts absent summary, reports only moved jobs and survives failure', async () => {
  let fail = true;
  const call = router({ priority: [{ kind: 'bgm', id: 'bed', key: 'k', state: 'queued' }] }, () => {
    if (fail) throw new Error('private source detail');
    return { promoted: [] };
  });
  for (const body of ['bad', '{}', 'null', '{"t":"3"}', '{"t":null}', '{"t":1e999}']) {
    assert.equal((await call(body)).status, 400);
  }
  assert.deepEqual(await call('{"t":0}'), { status: 500, data: { error: 'Preview audio priority failed' } });
  fail = false;
  assert.deepEqual(await call('{"t":0}'), { status: 200, data: { promoted: [] } });
  assert.deepEqual(await router(null, () => assert.fail('no summary'))('{"t":0}'), { status: 200, data: { promoted: [] } });
});

test('Web UI priority wiring debounces seeks at 300 ms and preparing playback every 10 seconds', () => {
  assert.match(app, /audioPriority: '\/api\/preview-audio\/priority'/u);
  assert.match(app, /fetch\(api.audioPriority,\s*\{\s*method: 'POST'/u);
  assert.match(app, /AUDIO_PRIORITY_DEBOUNCE_MS = 300/u);
  assert.match(app, /AUDIO_PRIORITY_INTERVAL_MS = 10_000/u);
  assert.match(app, /if \(isPlaying\) requestAudioPriority\(outputTime\)/u);
  assert.match(app, /seek\(frameEngineRequestedTime\)[\s\S]*?requestAudioPriority\(outputTime\)/u);
  const begin = app.indexOf('function requestAudioPriority(t)');
  const end = app.indexOf('\nfunction updateAudioStatus', begin);
  const code = app.slice(begin, end);
  assert.match(code, /clearTimeout\(audioPriorityTimer\)/u);
  assert.equal([...code.matchAll(/supply\?\.phase !== 'preparing'/gu)].length, 2);
  assert.match(code, /\.catch\(error => console.debug/u);
});
