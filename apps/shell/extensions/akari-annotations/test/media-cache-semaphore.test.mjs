import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createAsyncSemaphore } from '../lib/node/async-semaphore.js';
import { configureMediaCacheConcurrency, mediaCacheConcurrency, mediaCacheExtractionLoad } from '../lib/node/media-cache.js';

// task/2026-09-02-preview-perf: media-cache の ffmpeg 起動は無制限だった。ズームアウトで
// フィルムストリップのチャンク要求が数十本まとめて届くと ffmpeg が同時に数十本 spawn され、
// 同じ Node プロセスが担うプレビューの素材配信まで詰まる。動画（サムネイル・フィルムストリップ）
// 2 本 / 波形 2 本の枠で直列化する。

function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('同時実行は limit 本まで。残りは FIFO で待ち、終了した枠から順に流れる', async () => {
    const semaphore = createAsyncSemaphore(2);
    const gates = Array.from({ length: 5 }, () => deferred());
    const started = [];
    const results = gates.map((gate, index) => semaphore.run(async () => {
        started.push(index);
        await gate.promise;
        return index;
    }));
    await tick();
    assert.deepEqual(started, [0, 1], '最初の 2 本だけ開始する');
    assert.equal(semaphore.active, 2);
    assert.equal(semaphore.waiting, 3);

    gates[1].resolve();
    await tick();
    assert.deepEqual(started, [0, 1, 2], '1 本終わると待ち行列の先頭が開始する');
    assert.equal(semaphore.active, 2);

    gates[0].resolve();
    gates[2].resolve();
    await tick();
    assert.deepEqual(started, [0, 1, 2, 3, 4]);
    gates[3].resolve();
    gates[4].resolve();
    assert.deepEqual(await Promise.all(results), [0, 1, 2, 3, 4], '戻り値はそのまま透過する');
    assert.equal(semaphore.active, 0);
    assert.equal(semaphore.waiting, 0);
});

test('task の失敗も枠を返し、呼び出し側には同じ理由で reject する', async () => {
    const semaphore = createAsyncSemaphore(1);
    const first = semaphore.run(async () => { throw new Error('extraction-failed'); });
    let secondStarted = false;
    const second = semaphore.run(async () => { secondStarted = true; return 'ok'; });
    await assert.rejects(first, /extraction-failed/);
    assert.equal(await second, 'ok');
    assert.equal(secondStarted, true);
    assert.equal(semaphore.active, 0);
});

test('同期例外を投げる task も枠を返す', async () => {
    const semaphore = createAsyncSemaphore(1);
    await assert.rejects(semaphore.run(() => { throw new Error('sync'); }), /sync/);
    assert.equal(semaphore.active, 0);
    assert.equal(await semaphore.run(async () => 1), 1);
});

test('setLimit() で上限を上げると待ち行列が即座に流れ、1 未満は 1 に丸める', async () => {
    const semaphore = createAsyncSemaphore(1);
    const gate = deferred();
    const started = [];
    const runs = [0, 1, 2].map(index => semaphore.run(async () => { started.push(index); await gate.promise; }));
    await tick();
    assert.deepEqual(started, [0]);
    semaphore.setLimit(3);
    await tick();
    assert.deepEqual(started, [0, 1, 2]);
    assert.equal(semaphore.limit, 3);
    semaphore.setLimit(0);
    assert.equal(semaphore.limit, 1, '0 以下は 1 に丸める（完全停止はさせない）');
    gate.resolve();
    await Promise.all(runs);
});

test('media-cache の既定は動画 2 本 / 波形 2 本で、テストから差し替えられる', () => {
    assert.deepEqual(mediaCacheConcurrency(), { video: 2, waveform: 2 });
    assert.deepEqual(mediaCacheExtractionLoad(), { video: { active: 0, waiting: 0 }, waveform: { active: 0, waiting: 0 } });
    assert.deepEqual(configureMediaCacheConcurrency({ video: 1 }), { video: 1, waveform: 2 });
    assert.deepEqual(configureMediaCacheConcurrency({ video: 2, waveform: 3 }), { video: 2, waveform: 3 });
    assert.deepEqual(configureMediaCacheConcurrency({ waveform: 2 }), { video: 2, waveform: 2 });
});

test('ffmpeg の起動はすべてセマフォ経由（サムネイル・フィルムストリップ・波形）', () => {
    const source = readFileSync(new URL('../src/node/media-cache.ts', import.meta.url), 'utf8');
    assert.equal(source.split('videoExtractionSemaphore.run(').length - 1, 3, 'ffprobe（チャンク probe）+ サムネイル + フィルムストリップ');
    assert.equal(source.split('waveformExtractionSemaphore.run(').length - 1, 1, '波形抽出');
    assert.ok(!source.includes("await execFileAsync(await ffmpegPath()"), 'セマフォを通らない ffmpeg 起動が残っていない');
});
