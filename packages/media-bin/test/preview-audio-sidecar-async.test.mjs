import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PREVIEW_AUDIO_CONCURRENCY,
  ensurePreviewAudioSidecar,
  probePreviewAudioSource,
  probePreviewAudioSourceAsync,
} from '../src/preview-audio-sidecar.mjs';

// これらのテストは実バイナリではなく POSIX sh の偽 ffmpeg / ffprobe で「プロセスの起動と
// 待ち方」だけを検証する（FLAC レシピのバイト検証は speech-atempo.test.mjs が実 ffmpeg で担う）。
// 偽 ffmpeg は起動時に running/<pid> を置き、その時点の同時実行数を log へ記録してから
// sleep し、最後の引数（出力パス）へ 42 byte 超のダミーを書いて終了する。
const skipReason = process.platform === 'win32' ? 'POSIX shell fakes are not available on win32' : false;

function makeRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeBinaries(root, { ffmpegSleepSec = 1, ffmpegExit = 0 } = {}) {
  const log = path.join(root, 'ffmpeg.log');
  const running = path.join(root, 'running');
  fs.mkdirSync(running, { recursive: true });
  const ffmpeg = path.join(root, 'fake-ffmpeg');
  fs.writeFileSync(ffmpeg, [
    '#!/bin/sh',
    `touch "${running}/$$"`,
    `echo "start $$ $(ls "${running}" | wc -l | tr -d ' ')" >> "${log}"`,
    // 子の sleep には親から継承した stdout/stderr を握らせない（kill 後も close を遅らせない）。
    `sleep ${ffmpegSleepSec} </dev/null >/dev/null 2>&1`,
    'eval out=\\${$#}',
    'printf \'%s\' "fake flac payload: sixty-four bytes of filler for the size check......" > "$out"',
    `rm -f "${running}/$$"`,
    `echo "end $$" >> "${log}"`,
    ffmpegExit === 0 ? 'exit 0' : `echo "fake ffmpeg failed" >&2; exit ${ffmpegExit}`,
    '',
  ].join('\n'));
  fs.chmodSync(ffmpeg, 0o755);
  const ffprobe = path.join(root, 'fake-ffprobe');
  fs.writeFileSync(ffprobe, [
    '#!/bin/sh',
    `echo "probe $$" >> "${path.join(root, 'ffprobe.log')}"`,
    'printf \'%s\' \'{"streams":[{"sample_rate":"48000","channels":1}],"format":{"duration":"1.000000"}}\'',
    'exit 0',
    '',
  ].join('\n'));
  fs.chmodSync(ffprobe, 0o755);
  const source = path.join(root, 'source.wav');
  fs.writeFileSync(source, Buffer.alloc(4096, 1));
  return { ffmpeg, ffprobe, log, source, cacheDir: path.join(root, '.akari', 'cache') };
}

// log の各行は "start <pid> <その時点の同時実行数>" か "end <pid>"。プロセス起動が遅い環境
// （sandbox 下では sh 1 本に 100 ms 超かかる）でも壊れないよう、上限の検証は経過時間の上限
// ではなく「3 本目の start が最初の end より前か後か」という並び順で行う。
function ffmpegEvents(log) {
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => {
    const [event, pid, count] = line.split(' ');
    return { event, pid, count: Number(count) };
  });
}

function ffmpegStarts(log) {
  return ffmpegEvents(log).filter(entry => entry.event === 'start').map(entry => entry.count);
}

function startOrder(events) {
  const startIndexes = [];
  let firstEnd = -1;
  events.forEach((entry, index) => {
    if (entry.event === 'start') startIndexes.push(index);
    else if (entry.event === 'end' && firstEnd < 0) firstEnd = index;
  });
  return { startIndexes, firstEnd };
}

function requestFor(bins, overrides = {}) {
  return {
    sourcePath: bins.source, inSec: 0, outSec: 1, speed: 1,
    ffmpeg: bins.ffmpeg, ffprobe: bins.ffprobe, cacheDir: bins.cacheDir,
    ...overrides,
  };
}

test('サイドカー生成中もイベントループは止まらない（spawnSync ではなく非同期 spawn）', { skip: skipReason }, async () => {
  const root = makeRoot('akari-sidecar-async-');
  const bins = fakeBinaries(root, { ffmpegSleepSec: 1 });
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 20);
  try {
    const startedAt = Date.now();
    const result = await ensurePreviewAudioSidecar(requestFor(bins));
    const elapsed = Date.now() - startedAt;
    clearInterval(timer);
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.skipped, false);
    assert.deepEqual(Object.keys(result).sort(),
      ['channels', 'durationSec', 'key', 'ok', 'path', 'reason', 'sampleRate', 'skipped']);
    assert.equal(result.sampleRate, 48000);
    assert.equal(result.channels, 1);
    assert.equal(result.durationSec, 1);
    assert.equal(result.reason, null);
    assert.ok(elapsed >= 900, `fake ffmpeg should have slept ~1 s (elapsed ${elapsed} ms)`);
    assert.ok(ticks >= 5, `expected at least 5 timer ticks while ffmpeg ran, got ${ticks}`);
    assert.equal(fs.existsSync(result.path), true);
    assert.equal(fs.existsSync(`${result.path}.lock`), false);
    assert.deepEqual(fs.readdirSync(path.dirname(result.path)).filter(name => name.endsWith('.tmp.flac')), []);
    assert.equal(ffmpegStarts(bins.log).length, 1);
  } finally {
    clearInterval(timer);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('同一キーの同時要求は 1 本の promise に合流し ffmpeg を 1 回しか起動しない', { skip: skipReason }, async () => {
  const root = makeRoot('akari-sidecar-dedup-');
  const bins = fakeBinaries(root, { ffmpegSleepSec: 0.3 });
  try {
    const first = ensurePreviewAudioSidecar(requestFor(bins));
    const joined = ensurePreviewAudioSidecar(requestFor(bins));
    assert.equal(first, joined, 'same output path must share the pending promise');
    const [a, b] = await Promise.all([first, joined]);
    assert.equal(a.ok, true, a.reason);
    assert.equal(a, b);
    assert.equal(a.skipped, false);
    assert.equal(ffmpegStarts(bins.log).length, 1);

    // 完了後の要求は「既存 → 再利用」経路（ffmpeg 起動なし・skipped: true）。
    const again = await ensurePreviewAudioSidecar(requestFor(bins));
    assert.equal(again.ok, true, again.reason);
    assert.equal(again.skipped, true);
    assert.equal(again.path, a.path);
    assert.equal(again.key, a.key);
    assert.equal(ffmpegStarts(bins.log).length, 1);

    // 別キー（inSec 違い）は合流しない。
    const other = await ensurePreviewAudioSidecar(requestFor(bins, { inSec: 0.5 }));
    assert.equal(other.ok, true, other.reason);
    assert.notEqual(other.path, a.path);
    assert.equal(ffmpegStarts(bins.log).length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ffmpeg の同時実行は既定 2 本まで（3 キー同時要求で 3 本目は待つ）', { skip: skipReason }, async () => {
  assert.deepEqual(PREVIEW_AUDIO_CONCURRENCY, { ffmpeg: 2, ffprobe: 4 });
  const root = makeRoot('akari-sidecar-limit-');
  const bins = fakeBinaries(root, { ffmpegSleepSec: 0.5 });
  try {
    const startedAt = Date.now();
    const results = await Promise.all([0, 0.2, 0.4].map(inSec =>
      ensurePreviewAudioSidecar(requestFor(bins, { inSec }))));
    const elapsed = Date.now() - startedAt;
    for (const result of results) assert.equal(result.ok, true, result.reason);
    assert.equal(new Set(results.map(result => result.path)).size, 3);
    const starts = ffmpegStarts(bins.log);
    assert.equal(starts.length, 3);
    assert.ok(Math.max(...starts) <= 2, `at most 2 fake ffmpeg processes may overlap, saw ${starts.join(',')}`);
    const { startIndexes, firstEnd } = startOrder(ffmpegEvents(bins.log));
    assert.ok(startIndexes[1] < firstEnd, 'the first two transcodes overlap');
    assert.ok(startIndexes[2] > firstEnd, 'the third transcode starts only after one has finished');
    assert.ok(elapsed >= 900, `third transcode must wait for a slot (elapsed ${elapsed} ms)`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('concurrency オプションで上限を変えられる（3 本許可なら 3 本が重なる）', { skip: skipReason }, async () => {
  const root = makeRoot('akari-sidecar-limit-override-');
  const bins = fakeBinaries(root, { ffmpegSleepSec: 0.5 });
  try {
    const results = await Promise.all([0, 0.2, 0.4].map(inSec =>
      ensurePreviewAudioSidecar(requestFor(bins, { inSec, concurrency: { ffmpeg: 3 } }))));
    for (const result of results) assert.equal(result.ok, true, result.reason);
    const parallel = ffmpegEvents(bins.log);
    const starts = ffmpegStarts(bins.log);
    assert.equal(starts.length, 3);
    assert.equal(Math.max(...starts), 3, `all three should overlap, saw ${starts.join(',')}`);
    const { startIndexes, firstEnd } = startOrder(parallel);
    assert.ok(startIndexes[2] < firstEnd, 'with a limit of 3 every transcode starts before any finishes');

    const serial = await Promise.all([0.6, 0.8].map(inSec =>
      ensurePreviewAudioSidecar(requestFor(bins, { inSec, concurrency: { ffmpeg: 1 } }))));
    for (const result of serial) assert.equal(result.ok, true, result.reason);
    const tail = ffmpegEvents(bins.log).slice(parallel.length);
    assert.deepEqual(tail.map(entry => entry.event), ['start', 'end', 'start', 'end']);
    assert.equal(Math.max(...tail.filter(entry => entry.event === 'start').map(entry => entry.count)), 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ffmpeg 失敗・タイムアウトは throw せず reason を返し、tmp と lock を残さない', { skip: skipReason }, async () => {
  const root = makeRoot('akari-sidecar-failure-');
  try {
    const failing = fakeBinaries(path.join(root, 'fail'), { ffmpegSleepSec: 0, ffmpegExit: 3 });
    fs.mkdirSync(path.dirname(failing.ffmpeg), { recursive: true });
    const failed = await ensurePreviewAudioSidecar(requestFor(failing));
    assert.equal(failed.ok, false);
    assert.equal(failed.skipped, false);
    assert.match(failed.reason, /fake ffmpeg failed/u);
    assert.equal(typeof failed.key, 'string');
    assert.equal(failed.durationSec, 0);
    const outputDirectory = path.dirname(failed.path);
    assert.deepEqual(fs.readdirSync(outputDirectory), []);

    const slow = fakeBinaries(path.join(root, 'slow'), { ffmpegSleepSec: 2 });
    const startedAt = Date.now();
    const timedOut = await ensurePreviewAudioSidecar(requestFor(slow, { timeoutMs: { ffmpeg: 200 } }));
    const elapsed = Date.now() - startedAt;
    assert.equal(timedOut.ok, false);
    assert.match(timedOut.reason, /timed out after 200 ms/u);
    assert.ok(elapsed < 1500, `timeout must kill the transcode promptly (elapsed ${elapsed} ms)`);
    assert.deepEqual(fs.readdirSync(path.dirname(timedOut.path)), []);

    const missing = await ensurePreviewAudioSidecar(requestFor(slow, {
      inSec: 0.5, ffmpeg: path.join(root, 'missing-ffmpeg'),
    }));
    assert.equal(missing.ok, false);
    assert.match(missing.reason, /ENOENT|spawn|ffmpeg/iu);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('probePreviewAudioSourceAsync は同期版と同じ結果形を返す', { skip: skipReason }, async () => {
  const root = makeRoot('akari-sidecar-probe-');
  const bins = fakeBinaries(root);
  try {
    const sync = probePreviewAudioSource(bins.source, { ffprobe: bins.ffprobe });
    const async = await probePreviewAudioSourceAsync(bins.source, { ffprobe: bins.ffprobe });
    assert.deepEqual(async, sync);
    assert.equal(async.ok, true);
    assert.equal(async.durationSec, 1);
    assert.equal(async.bytes, 4096);

    const missingPath = path.join(root, 'missing.wav');
    const syncMissing = probePreviewAudioSource(missingPath, { ffprobe: bins.ffprobe });
    const asyncMissing = await probePreviewAudioSourceAsync(missingPath, { ffprobe: bins.ffprobe });
    assert.equal(asyncMissing.ok, false);
    assert.deepEqual(Object.keys(asyncMissing).sort(), Object.keys(syncMissing).sort());
    assert.equal(asyncMissing.path, syncMissing.path);
    assert.match(asyncMissing.reason, /ENOENT/u);

    const invalid = await probePreviewAudioSourceAsync(undefined, { ffprobe: bins.ffprobe });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.path, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
