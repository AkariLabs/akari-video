import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  PREVIEW_AUDIO_RECIPE, classifyPreviewAudioFailure, ensurePreviewAudioSidecar,
  previewAudioSidecarStatus, requestPreviewAudioSidecar,
  subscribePreviewAudioSidecarEvents, sweepPreviewAudioSidecars,
} from '../src/preview-audio-sidecar.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-audio-status-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.wav');
  fs.writeFileSync(sourcePath, 'fixture');
  const options = { sourcePath, cacheDir: root, inSec: 0, outSec: 1, speed: 1,
    ffmpeg: '/nonexistent', ffprobe: '/nonexistent' };
  const { key } = previewAudioSidecarStatus(options);
  const directory = path.join(root, 'preview-audio');
  fs.mkdirSync(directory);
  const file = suffix => path.join(directory, `${key}${suffix}`);
  const json = (suffix, data) => fs.writeFileSync(file(suffix), JSON.stringify(data));
  const metadata = { recipe: PREVIEW_AUDIO_RECIPE, key, durationSec: 1, sampleRate: 48000,
    channels: 1, bytes: 64, inSec: 0, outSec: 1, speed: 1, padBeforeSec: 0, padAfterSec: 0,
    createdAt: Date.now() };
  return { root, options, key, directory, file, json, metadata };
}

test('状態照会は missing / legacy / ready を JSON だけで判定し、既存 API も probe しない', async t => {
  const f = fixture(t);
  assert.deepEqual(previewAudioSidecarStatus(f.options), { state: 'missing', key: f.key });
  fs.writeFileSync(f.file('.flac'), Buffer.alloc(64));
  assert.equal(previewAudioSidecarStatus(f.options).state, 'legacy');
  f.json('.json', f.metadata);
  const ready = previewAudioSidecarStatus(f.options);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.bytes, 64);
  assert.equal(ready.durationSec, 1);
  assert.deepEqual(requestPreviewAudioSidecar(f.options), ready);
  const result = await ensurePreviewAudioSidecar(f.options);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.skipped, true);
  assert.equal(result.sampleRate, 48000);
  assert.equal(previewAudioSidecarStatus({ ...f.options, speed: 0 }).state, 'invalid');
});

test('no-audio は永続、failed は期限内のみ有効、素材変更は別キー', t => {
  const f = fixture(t);
  f.json('.failed.json', { key: f.key, reason: 'busy', createdAt: Date.now(), retryAfterMs: 60000 });
  assert.equal(previewAudioSidecarStatus(f.options).state, 'failed');
  assert.ok(requestPreviewAudioSidecar(f.options).retryAfterMs > 0);
  f.json('.failed.json', { key: f.key, reason: 'busy', createdAt: Date.now() - 60001, retryAfterMs: 60000 });
  assert.equal(previewAudioSidecarStatus(f.options).state, 'missing');
  f.json('.no-audio.json', { key: f.key, reason: 'no audio stream', createdAt: 0 });
  assert.equal(requestPreviewAudioSidecar(f.options).state, 'no-audio');
  fs.appendFileSync(f.options.sourcePath, 'changed');
  assert.equal(previewAudioSidecarStatus(f.options).state, 'missing');
  assert.notEqual(previewAudioSidecarStatus(f.options).key, f.key);
});

test('ffmpeg / ffprobe の音声なし実文言と一時エラーを分類する', () => {
  for (const reason of ["Stream map '0:a:0' matches no streams", "Stream map '' matches no streams.",
    'does not contain any stream', 'Output file #0 does not contain any stream', 'ffprobe: no audio stream']) {
    assert.equal(classifyPreviewAudioFailure(reason), 'no-audio', reason);
  }
  for (const reason of ['spawn EPERM', 'ENOENT', 'timed out', 'invalid audio metadata', 'Invalid data found']) {
    assert.equal(classifyPreviewAudioFailure(reason), 'transient', reason);
  }
});

test('掃除は JSON 同伴・孤児・probe を削除し、keepKeys・新しいファイル・tmp は残す', t => {
  const f = fixture(t);
  for (const suffix of ['.flac', '.json', '.no-audio.json', '.failed.json']) f.json(suffix, {});
  for (const name of ['orphan.failed.json', 'probe-old.json', 'young.json', '.hidden.json', 'work.tmp.flac', 'work.tmp.json']) {
    fs.writeFileSync(path.join(f.directory, name), '{}');
  }
  const old = new Date(Date.now() - 7200000);
  for (const name of fs.readdirSync(f.directory)) {
    if (name !== 'young.json') fs.utimesSync(path.join(f.directory, name), old, old);
  }
  sweepPreviewAudioSidecars({ cacheDir: f.root, keepKeys: [f.key], minAgeMs: 3600000 });
  assert.ok(fs.existsSync(f.file('.json')));
  assert.ok(!fs.existsSync(path.join(f.directory, 'orphan.failed.json')));
  assert.ok(!fs.existsSync(path.join(f.directory, 'probe-old.json')));
  assert.ok(fs.existsSync(path.join(f.directory, 'young.json')));
  const result = sweepPreviewAudioSidecars({ cacheDir: f.root, keepKeys: [] });
  assert.equal(result.removed, 5);
  assert.deepEqual(fs.readdirSync(f.directory).sort(), ['.hidden.json', 'work.tmp.flac', 'work.tmp.json']);
});

test('legacy の背景 probe は即返し・重複抑止・in-flight 保護・JSON 保存・イベントを行う', async t => {
  const f = fixture(t);
  fs.writeFileSync(f.file('.flac'), Buffer.alloc(64));
  let finishProbe;
  let probes = 0;
  const options = { ...f.options, probeAudio: () => {
    probes += 1;
    return new Promise(resolve => { finishProbe = resolve; });
  } };
  const events = [];
  const unsubscribe = subscribePreviewAudioSidecarEvents(event => events.push(event));
  t.after(unsubscribe);
  assert.deepEqual(requestPreviewAudioSidecar(options), { state: 'queued', key: f.key });
  assert.equal(requestPreviewAudioSidecar(options).state, 'generating');
  sweepPreviewAudioSidecars({ cacheDir: f.root, keepKeys: [] });
  assert.ok(fs.existsSync(f.file('.flac')));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(probes, 1);
  finishProbe({ durationSec: 1, sampleRate: 48000, channels: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.equal(events[0].state, 'ready');
  assert.equal(events[0].sourcePath, f.options.sourcePath);
  assert.equal(previewAudioSidecarStatus(options).state, 'ready');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(f.file('.json'), 'utf8'))).sort(), Object.keys(f.metadata).sort());
  unsubscribe();
});

test('outSec 省略は fingerprint probe JSON の尺・無音・再試行期限を読む', t => {
  const f = fixture(t);
  const { outSec, ...options } = f.options;
  const stat = fs.statSync(options.sourcePath);
  const hash = crypto.createHash('sha1').update([options.sourcePath, stat.size, stat.mtimeMs].join('|')).digest('hex');
  assert.deepEqual(previewAudioSidecarStatus(options), {
    state: 'queued', key: null, probe: { fingerprint: hash, pending: true },
  });
  const probeFile = path.join(f.directory, `probe-${hash}.json`);
  const write = data => fs.writeFileSync(probeFile, JSON.stringify(data));
  write({ durationSec: 1, sampleRate: 48000, channels: 1 });
  fs.writeFileSync(f.file('.flac'), Buffer.alloc(64));
  f.json('.json', f.metadata);
  assert.equal(requestPreviewAudioSidecar(options).state, 'ready');
  write({ error: { class: 'no-audio', reason: 'no audio stream', createdAt: 0 } });
  assert.equal(requestPreviewAudioSidecar(options).state, 'no-audio');
  write({ error: { class: 'transient', reason: 'busy', createdAt: Date.now() } });
  assert.equal(requestPreviewAudioSidecar(options).state, 'failed');
  write({ error: { class: 'transient', reason: 'busy', createdAt: 0 } });
  assert.deepEqual(previewAudioSidecarStatus(options).probe, { fingerprint: hash, pending: true });
});

test('probe JSON を削除した再要求で settled イベントが出る', { timeout: 10000 }, async t => {
  const f = fixture(t);
  const ffmpeg = path.join(f.root, 'fake-ffmpeg');
  // Fake ffmpeg output without requiring a shell or executable on Windows.
  let generations = 0;
  const mockedSpawn = t.mock.method(childProcess, 'spawn', (command, args) => {
    assert.equal(command, ffmpeg, 'probeAudio injection must avoid spawning ffprobe');
    generations += 1;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setImmediate(() => {
      fs.writeFileSync(args.at(-1), Buffer.alloc(64));
      child.emit('close', 0, null);
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { mockedSpawn.mock.restore(); syncBuiltinESMExports(); });
  const { outSec, ...request } = f.options;
  let sourceProbes = 0;
  const options = { ...request, ffmpeg, probeAudio: sourcePath => {
    if (sourcePath === path.resolve(request.sourcePath)) sourceProbes += 1;
    return { durationSec: 1, sampleRate: 48000, channels: 1 };
  } };
  const events = [];
  let finishEvent;
  t.after(subscribePreviewAudioSidecarEvents(event => {
    events.push(event);
    finishEvent?.(event);
  }));
  const nextEvent = () => new Promise(resolve => { finishEvent = resolve; });
  const firstEvent = nextEvent();
  const pending = requestPreviewAudioSidecar(options);
  assert.equal(pending.state, 'queued');
  assert.equal(pending.probe.pending, true);
  const expected = { key: f.key, state: 'ready', sourcePath: path.resolve(options.sourcePath),
    path: f.file('.flac'), durationSec: 1 };
  assert.deepEqual(await firstEvent, expected);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [expected], 'new generation must emit only once');
  assert.deepEqual(previewAudioSidecarStatus(options).probe, { fingerprint: pending.probe.fingerprint });
  assert.deepEqual(requestPreviewAudioSidecar(options).probe, { fingerprint: pending.probe.fingerprint });
  const probeFiles = fs.readdirSync(f.directory).filter(name => /^probe-.*\.json$/u.test(name));
  assert.equal(probeFiles.length, 1);
  for (const name of probeFiles) fs.rmSync(path.join(f.directory, name));
  events.length = 0;
  const secondEvent = nextEvent();
  assert.deepEqual(requestPreviewAudioSidecar(options), pending);
  assert.deepEqual(await secondEvent, expected);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [expected], 'cached ready must emit exactly once after re-probing');
  assert.equal(previewAudioSidecarStatus(options).state, 'ready');
  assert.equal(sourceProbes, 2);
  assert.equal(generations, 1, 'existing sidecar must be reused');
});

test('keepProbes は fingerprint とファイル名で指定した probe JSON を掃除から保護する', t => {
  const f = fixture(t);
  const fingerprints = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];
  for (const fingerprint of fingerprints) {
    fs.writeFileSync(path.join(f.directory, `probe-${fingerprint}.json`), '{}');
  }
  const result = sweepPreviewAudioSidecars({ cacheDir: f.root, keepKeys: [],
    keepProbes: [fingerprints[0], `probe-${fingerprints[1]}.json`] });
  assert.equal(result.removed, 1);
  assert.deepEqual(fs.readdirSync(f.directory).sort(),
    fingerprints.slice(0, 2).map(fingerprint => `probe-${fingerprint}.json`));
});

test('背景生成は JSON を書きイベントを一度配る', { skip: process.platform === 'win32' }, async t => {
  const f = fixture(t);
  const ffmpeg = path.join(f.root, 'fake-ffmpeg');
  fs.writeFileSync(ffmpeg, '#!/bin/sh\nfor arg do out="$arg"; done\nprintf "%064d" 0 > "$out"\n');
  fs.chmodSync(ffmpeg, 0o755);
  const options = { ...f.options, ffmpeg, probeAudio: () => ({ durationSec: 1, sampleRate: 48000, channels: 1 }) };
  const event = new Promise(resolve => {
    const unsubscribe = subscribePreviewAudioSidecarEvents(value => { unsubscribe(); resolve(value); });
    t.after(unsubscribe);
  });
  assert.equal(requestPreviewAudioSidecar(options).state, 'queued');
  assert.equal((await event).state, 'ready');
  assert.equal(previewAudioSidecarStatus(options).state, 'ready');
  assert.ok(fs.existsSync(f.file('.json')));
});
