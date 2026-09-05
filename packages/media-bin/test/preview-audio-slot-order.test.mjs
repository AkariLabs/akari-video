import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { resolveFfmpeg, resolveFfprobe } from '../src/index.mjs';
import {
  __testing, ensurePreviewAudioSidecar, previewAudioSidecarStatus,
  requestPreviewAudioSidecar, subscribePreviewAudioSidecarEvents,
  promotePreviewAudioSidecars,
} from '../src/preview-audio-sidecar.mjs';

const { Semaphore } = __testing;
const metadata = { durationSec: 120, sampleRate: 48000, channels: 2 };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

test('reserve は枠を消費せず FIFO の位置を確保する', async () => {
  const semaphore = new Semaphore();
  await semaphore.acquire(2);
  const slot = semaphore.reserve(2);
  let following = false;
  const next = semaphore.acquire(2).then(() => { following = true; });
  await nextTurn();
  assert.equal(following, false, '空き枠があっても未準備の札を追い越さない');
  semaphore.release();
  await nextTurn();
  assert.equal(following, false, 'release 後も札は acquire まで列に残る');
  slot.cancel();
  await next;
  // 予約が active を増やしていたら、release なしでこの 2 枠目は取れない。
  await semaphore.acquire(2);
  semaphore.release();
  semaphore.release();
});

test('遅れて acquire する先頭札の生成開始は待機済みの後続より先になる', async () => {
  const semaphore = new Semaphore();
  const slot = semaphore.reserve(2);
  const started = [];
  const b = semaphore.acquire(2).then(() => started.push('B'));
  const c = semaphore.acquire(2).then(() => started.push('C'));
  await nextTurn();
  assert.deepEqual(started, []);
  const a = (async () => { await slot.acquire(); started.push('A'); })();
  await Promise.all([a, b]);
  assert.deepEqual(started, ['A', 'B']);
  semaphore.release();
  await c;
  assert.deepEqual(started, ['A', 'B', 'C']);
  semaphore.release();
  semaphore.release();
});

test('cancel は先頭・途中の札を捨てて後続の FIFO を維持する', async () => {
  const semaphore = new Semaphore();
  const head = semaphore.reserve(1);
  const first = semaphore.reserve(1);
  const middle = semaphore.reserve(1);
  const last = semaphore.reserve(1);
  const order = [];
  const end = last.acquire().then(() => order.push('last'));
  const start = first.acquire().then(() => order.push('first'));
  middle.cancel();
  middle.cancel();
  head.cancel();
  await start;
  assert.deepEqual(order, ['first']);
  semaphore.release();
  await end;
  assert.deepEqual(order, ['first', 'last']);
  semaphore.release();
});

test('acquire 待機中の札も cancel でき、破棄済み札は取得できない', async () => {
  const semaphore = new Semaphore();
  await semaphore.acquire(1);
  const slot = semaphore.reserve(1);
  const rejected = assert.rejects(slot.acquire(), /reservation cancelled/u);
  slot.cancel();
  await rejected;
  const cancelled = semaphore.reserve(1);
  cancelled.cancel();
  await assert.rejects(cancelled.acquire(), /reservation cancelled/u);
  semaphore.release();
  await semaphore.run(1, () => 'next');
});

test('取得済み札の acquire は同じ解決済み Promise を返し二重取得しない', async () => {
  const semaphore = new Semaphore();
  const slot = semaphore.reserve(1);
  const acquired = slot.acquire();
  await acquired;
  assert.equal(slot.acquire(), acquired);
  const order = [];
  slot.acquire().then(() => order.push('acquired'));
  queueMicrotask(() => order.push('microtask'));
  await nextTurn();
  assert.deepEqual(order, ['acquired', 'microtask']);
  let nextStarted = false;
  const next = semaphore.acquire(1).then(() => { nextStarted = true; });
  slot.cancel();
  await nextTurn();
  assert.equal(nextStarted, false, '取得後の cancel は release の代わりにならない');
  semaphore.release();
  await next;
  semaphore.release();
});

test('通常の run は 2 本まで並列・3 本目は待機し例外でも枠を返す', async () => {
  const semaphore = new Semaphore();
  const gates = [deferred(), deferred(), deferred()];
  const order = [];
  let active = 0;
  let peak = 0;
  const jobs = gates.map((gate, index) => semaphore.run(2, async () => {
    order.push(index);
    peak = Math.max(peak, ++active);
    try { await gate.promise; } finally { active -= 1; }
  }));
  const failed = assert.rejects(jobs[0], /test failure/u);
  await nextTurn();
  assert.deepEqual(order, [0, 1]);
  gates[0].reject(new Error('test failure'));
  await failed;
  await nextTurn();
  assert.deepEqual(order, [0, 1, 2]);
  assert.equal(peak, 2);
  gates[1].resolve();
  gates[2].resolve();
  await Promise.all(jobs.slice(1));
  assert.equal(await semaphore.run(1, () => 'released'), 'released');
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-slot-order-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'a-narration.wav');
  fs.writeFileSync(sourcePath, 'fixture');
  const options = { sourcePath, cacheDir: root, inSec: 0, speed: 1,
    format: 'pcm-s16le', ffprobe: 'unused', concurrency: { ffmpeg: 1 } };
  const known = { ...options, outSec: metadata.durationSec };
  const directory = path.join(root, 'preview-audio');
  fs.mkdirSync(directory);
  const key = previewAudioSidecarStatus(known).key;
  return { root, options, known, directory, output: path.join(directory, `${key}.pcm`) };
}

function observeReservations(t) {
  const original = Semaphore.prototype.reserve;
  const reservations = [];
  t.mock.method(Semaphore.prototype, 'reserve', function (limit) {
    const slot = original.call(this, limit);
    const record = { semaphore: this, slot, acquisitions: 0, cancellations: 0 };
    reservations.push(record);
    return {
      acquire: () => { record.acquisitions += 1; return slot.acquire(); },
      cancel: () => { record.cancellations += 1; slot.cancel(); },
    };
  });
  return reservations;
}

for (const state of ['failed', 'no-audio', 'not-needed', 'ready', 'legacy']) {
  test(`probe 後の ${state} 経路は札を破棄して後続を進める`, { timeout: 5000 }, async t => {
    const f = fixture(t);
    if (state === 'ready' || state === 'legacy') {
      fs.writeFileSync(f.output, Buffer.alloc(48000));
      if (state === 'ready') assert.equal((await ensurePreviewAudioSidecar(f.known)).ok, true);
    }
    const reservations = observeReservations(t);
    const entered = deferred();
    const probe = deferred();
    t.after(() => probe.resolve(metadata));
    const event = deferred();
    t.after(subscribePreviewAudioSidecarEvents(value => event.resolve(value)));
    const options = { ...f.options,
      ...(state === 'not-needed' ? { decodedBytesThreshold: 64 * 1024 * 1024 } : {}),
      probeAudio: () => { entered.resolve(); return probe.promise; } };
    const status = requestPreviewAudioSidecar(options);
    assert.equal(status.state, 'queued');
    assert.equal(status.probe.pending, true);
    assert.equal(reservations.length, 0, '同期要求中には予約も probe も行わない');
    await entered.promise;
    assert.equal(reservations.length, 1);
    const reservation = reservations[0];
    let following = false;
    const next = reservation.semaphore.run(1, () => { following = true; });
    await nextTurn();
    assert.equal(following, false);
    if (state === 'failed' || state === 'no-audio') {
      probe.reject(new Error(state === 'no-audio' ? 'ffprobe: no audio stream' : 'probe failed'));
    } else {
      probe.resolve(metadata);
    }
    assert.equal((await event.promise).state, state === 'legacy' ? 'ready' : state);
    await next;
    assert.equal(reservation.acquisitions, 0);
    assert.ok(reservation.cancellations > 0);
    await nextTurn();
  });
}

test('同じ outputPath の ensure 合流は追加の札を破棄して同じ Promise を返す', async t => {
  const f = fixture(t);
  const options = { ...f.known, format: 'flac' };
  const key = previewAudioSidecarStatus(options).key;
  fs.writeFileSync(path.join(f.directory, `${key}.flac`), Buffer.alloc(64));
  const probe = deferred();
  const first = ensurePreviewAudioSidecar({ ...options, probeAudio: () => probe.promise });
  const semaphore = new Semaphore();
  const slot = semaphore.reserve(1);
  const next = semaphore.run(1, () => 'unblocked');
  const joined = ensurePreviewAudioSidecar({ ...options, slot });
  assert.equal(joined, first);
  assert.equal(await next, 'unblocked');
  probe.resolve(metadata);
  assert.equal((await first).ok, true);
});

test('probe 後の要求が既存の generating に合流すると札を破棄する', { timeout: 5000 }, async t => {
  const f = fixture(t);
  const options = { ...f.options, format: 'flac' };
  const known = { ...options, outSec: metadata.durationSec };
  const key = previewAudioSidecarStatus(known).key;
  fs.writeFileSync(path.join(f.directory, `${key}.flac`), Buffer.alloc(64));
  const existingProbe = deferred();
  const existing = ensurePreviewAudioSidecar({ ...known, probeAudio: () => existingProbe.promise });
  const reservations = observeReservations(t);
  const entered = deferred();
  const probe = deferred();
  requestPreviewAudioSidecar({ ...options, probeAudio: () => { entered.resolve(); return probe.promise; } });
  await entered.promise;
  const reservation = reservations[0];
  const next = reservation.semaphore.run(1, () => 'unblocked');
  probe.resolve(metadata);
  assert.equal(await next, 'unblocked');
  assert.equal(reservation.acquisitions, 0);
  assert.ok(reservation.cancellations > 0);
  existingProbe.resolve(metadata);
  assert.equal((await existing).ok, true);
  await nextTurn();
});

test('検証失敗時は request と ensure の内部札を破棄する', async t => {
  const f = fixture(t);
  const semaphore = new Semaphore();
  const requestSlot = semaphore.reserve(1);
  assert.equal(requestPreviewAudioSidecar({ ...f.known, speed: 0, slot: requestSlot }).state, 'invalid');
  await semaphore.run(1, () => undefined);
  const ensureSlot = semaphore.reserve(1);
  assert.equal((await ensurePreviewAudioSidecar({ ...f.known, speed: 0, slot: ensureSlot })).ok, false);
  await semaphore.run(1, () => undefined);
});

test('probe キャッシュ保存の例外でも札を破棄して後続を進める', { timeout: 5000 }, async t => {
  const f = fixture(t);
  const reservations = observeReservations(t);
  const entered = deferred();
  const probe = deferred();
  const warning = t.mock.method(console, 'warn', () => undefined);
  const status = requestPreviewAudioSidecar({ ...f.options,
    probeAudio: () => { entered.resolve(); return probe.promise; } });
  // JSON の保存先をディレクトリにして rename を失敗させる。
  fs.mkdirSync(path.join(f.directory, `probe-${status.probe.fingerprint}.json`));
  await entered.promise;
  const reservation = reservations[0];
  const next = reservation.semaphore.run(1, () => 'unblocked');
  probe.resolve(metadata);
  assert.equal(await next, 'unblocked');
  await nextTurn();
  assert.equal(reservation.acquisitions, 0);
  assert.ok(reservation.cancellations > 0);
  assert.equal(warning.mock.callCount(), 1);
});

function realBinaries() {
  try {
    const ffmpeg = resolveFfmpeg();
    const ffprobe = resolveFfprobe();
    for (const binary of [ffmpeg, ffprobe]) {
      const available = spawnSync(binary, ['-version'], { windowsHide: true });
      if (available.status !== 0) return { skip: `ffmpeg/ffprobe unavailable: ${available.error?.code ?? available.status}` };
    }
    return { ffmpeg, ffprobe, skip: false };
  } catch {
    return { skip: 'ffmpeg/ffprobe unavailable' };
  }
}

const binaries = realBinaries();

function mockSpawn(t, run) {
  const observed = t.mock.method(childProcess, 'spawn', (command, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => { child.signalCode = 'SIGKILL'; child.emit('close', null, 'SIGKILL'); };
    setImmediate(async () => {
      try {
        await run(child, command, args);
        child.exitCode = 0;
        child.emit('close', 0, null);
      } catch (error) {
        child.stderr.write(error.message);
        child.exitCode = 1;
        child.emit('close', 1, null);
      }
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { observed.mock.restore(); syncBuiltinESMExports(); });
  return observed;
}

test('短 SFX の probe キャッシュは request と status の再取得で ffprobe を起動しない',
  { timeout: 10000 }, async t => {
    const f = fixture(t);
    const observedSpawn = mockSpawn(t, async child => {
      child.stdout.write(JSON.stringify({ streams: [{ sample_rate: '48000', channels: 2 }],
        format: { duration: '0.1' } }));
    });
    const event = deferred();
    t.after(subscribePreviewAudioSidecarEvents(value => event.resolve(value)));
    const options = { ...f.options, decodedBytesThreshold: 64 * 1024 * 1024 };
    const first = requestPreviewAudioSidecar(options);
    assert.equal(first.probe.pending, true);
    assert.equal((await event.promise).state, 'not-needed');
    await nextTurn();
    assert.equal(observedSpawn.mock.callCount(), 1);
    assert.equal(observedSpawn.mock.calls[0].arguments[0], options.ffprobe);
    const cached = JSON.parse(fs.readFileSync(path.join(f.directory, `probe-${first.probe.fingerprint}.json`), 'utf8'));
    assert.ok(cached.durationSec > 0 && cached.durationSec < 1);
    for (const read of [requestPreviewAudioSidecar, previewAudioSidecarStatus]) {
      assert.deepEqual(read(options), { state: 'not-needed', key: null,
        probe: { fingerprint: first.probe.fingerprint } });
    }
    await nextTurn();
    assert.equal(observedSpawn.mock.callCount(), 1, '2 回目はキャッシュを読み spawn を増やさない');
  });

test('実 ffmpeg: 120 秒 WAV の A（probe）→ B → C は A が最初に ready になる',
  { skip: binaries.skip, timeout: 60000 }, async t => {
    const f = fixture(t);
    const sources = ['a-narration.wav', 'b-speech1.wav', 'c-speech2.wav'].map(name => path.join(f.root, name));
    for (const source of sources) {
      const result = spawnSync(binaries.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=120', '-ar', '48000', '-ac', '2', '-y', source],
      { encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
    }
    const events = [];
    t.after(subscribePreviewAudioSidecarEvents(event => events.push(event)));
    // 1 枠で完了順を決定的に検証。既定 2 枠での開始順と上限は上の純テストで固定する。
    const common = { ...f.options, ffmpeg: binaries.ffmpeg, ffprobe: binaries.ffprobe };
    assert.equal(requestPreviewAudioSidecar({ ...common, sourcePath: sources[0],
      decodedBytesThreshold: 1 }).state, 'queued');
    for (const sourcePath of sources.slice(1)) {
      assert.equal(requestPreviewAudioSidecar({ ...common, sourcePath, outSec: 120 }).state, 'queued');
    }
    const deadline = Date.now() + 30000;
    while (events.length < 3 && Date.now() < deadline) await delay(10);
    assert.deepEqual(events.map(event => event.state), ['ready', 'ready', 'ready']);
    assert.deepEqual(events.map(event => event.sourcePath), sources);
    for (const sourcePath of sources) {
      const status = previewAudioSidecarStatus({ ...common, sourcePath, outSec: 120 });
      assert.equal(status.format, 'pcm-s16le');
      assert.equal(status.frames, 120 * 24000);
    }
  });

test('実 ffmpeg: 遅い probe の A は既定 2 枠の 1 枠を予約し B → A → C で起動する',
  { skip: binaries.skip, timeout: 60000 }, async t => {
    const f = fixture(t);
    const sources = ['a-narration.wav', 'b-speech1.wav', 'c-speech2.wav'].map(name => path.join(f.root, name));
    for (const source of sources) {
      const result = spawnSync(binaries.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=120', '-ar', '48000', '-ac', '2', '-y', source],
      { encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
    }
    const starts = [];
    let active = 0;
    let peak = 0;
    const originalSpawn = childProcess.spawn;
    const observedSpawn = t.mock.method(childProcess, 'spawn', (command, args, options) => {
      const child = originalSpawn(command, args, options);
      starts.push(args[args.indexOf('-i') + 1]);
      peak = Math.max(peak, ++active);
      child.once('close', () => { active -= 1; });
      return child;
    });
    syncBuiltinESMExports();
    t.after(() => { observedSpawn.mock.restore(); syncBuiltinESMExports(); });
    const reservations = [];
    const originalReserve = Semaphore.prototype.reserve;
    t.mock.method(Semaphore.prototype, 'reserve', function (...args) {
      const slot = originalReserve.apply(this, args);
      reservations.push(slot);
      return slot;
    });
    const events = [];
    t.after(subscribePreviewAudioSidecarEvents(event => events.push(event)));
    const probe = deferred();
    const common = { ...f.options, concurrency: undefined, ffmpeg: binaries.ffmpeg, ffprobe: binaries.ffprobe };
    requestPreviewAudioSidecar({ ...common, sourcePath: sources[0], decodedBytesThreshold: 1,
      probeAudio: () => probe.promise });
    for (const sourcePath of sources.slice(1)) requestPreviewAudioSidecar({ ...common, sourcePath, outSec: 120 });
    let deadline = Date.now() + 10000;
    while (starts.length < 1 && Date.now() < deadline) await delay(1);
    const startsDuringProbe = [...starts];
    const reservationsDuringProbe = reservations.length;
    probe.resolve(metadata);
    deadline = Date.now() + 30000;
    while (events.length < 3 && Date.now() < deadline) await delay(10);
    assert.equal(reservationsDuringProbe, 3);
    assert.deepEqual(startsDuringProbe, [sources[1]], 'probe は 1 枠だけ予約し B を通す');
    assert.deepEqual(starts, [sources[1], sources[0], sources[2]]);
    assert.equal(peak, 2);
    assert.deepEqual(events.map(event => event.state), ['ready', 'ready', 'ready']);
  });

test('promote は待機札を先頭へ移し先頭・取得済み・破棄済みなら何もしない', async () => {
  const semaphore = new Semaphore();
  await semaphore.acquire(1);
  const slots = [semaphore.reserve(1), semaphore.reserve(1), semaphore.reserve(1)];
  const order = [];
  const jobs = slots.map((slot, index) => slot.acquire().then(() => order.push(index)));
  assert.equal(slots[0].promote(), false);
  assert.equal(slots[2].promote(), true);
  assert.equal(slots[2].promote(), false);
  semaphore.release();
  await jobs[2];
  assert.equal(slots[2].promote(), false);
  semaphore.release();
  await jobs[0];
  semaphore.release();
  await jobs[1];
  semaphore.release();
  assert.deepEqual(order, [2, 0, 1]);
  const cancelled = semaphore.reserve(1);
  cancelled.cancel();
  assert.equal(cancelled.promote(), false);
});

test('hold は 2 枠で B だけを通し probe 完了後は A が C より先に取得する', async () => {
  const semaphore = new Semaphore();
  const a = semaphore.reserve(2);
  a.hold();
  a.hold();
  const order = [];
  const b = semaphore.acquire(2).then(() => order.push('B'));
  const c = semaphore.acquire(2).then(() => order.push('C'));
  await b;
  await nextTurn();
  assert.deepEqual(order, ['B']);
  await a.acquire().then(() => order.push('A'));
  await nextTurn();
  assert.deepEqual(order, ['B', 'A']);
  a.hold();
  semaphore.release();
  await c;
  assert.deepEqual(order, ['B', 'A', 'C']);
  semaphore.release();
  semaphore.release();
});

test('hold は 1 枠なら probe 中の B と C を待たせる', async () => {
  const semaphore = new Semaphore();
  const a = semaphore.reserve(1);
  a.hold();
  const order = [];
  const b = semaphore.acquire(1).then(() => order.push('B'));
  const c = semaphore.acquire(1).then(() => order.push('C'));
  await nextTurn();
  assert.deepEqual(order, []);
  await a.acquire().then(() => order.push('A'));
  assert.deepEqual(order, ['A']);
  semaphore.release();
  await b;
  semaphore.release();
  await c;
  semaphore.release();
  assert.deepEqual(order, ['A', 'B', 'C']);
});

test('複数の hold は合計 1 枠だけを予約し通常札の FIFO 障壁は維持する', async () => {
  const semaphore = new Semaphore();
  const a = semaphore.reserve(2);
  const b = semaphore.reserve(2);
  const barrier = semaphore.reserve(2);
  a.hold();
  b.hold();
  const order = [];
  const c = semaphore.acquire(2).then(() => order.push('C'));
  const d = semaphore.acquire(2).then(() => order.push('D'));
  await nextTurn();
  assert.deepEqual(order, []);
  barrier.cancel();
  await c;
  await nextTurn();
  assert.deepEqual(order, ['C']);
  a.cancel();
  await nextTurn();
  assert.deepEqual(order, ['C'], '残った probe も 1 枠を予約する');
  b.cancel();
  await d;
  semaphore.release();
  semaphore.release();
});

for (const by of ['keys', 'sourcePaths']) {
  test(`昇格 API は ${by} で 3 番目を先頭にして完了順を 3 → 1 → 2 にする`,
    { timeout: 5000 }, async t => {
      const f = fixture(t);
      const sources = ['first.wav', 'second.wav', 'third.wav'].map(name => path.join(f.root, name));
      for (const sourcePath of sources) fs.writeFileSync(sourcePath, 'fixture');
      const starts = [];
      mockSpawn(t, async (child, command, args) => {
        starts.push(args[args.indexOf('-i') + 1]);
        fs.writeFileSync(args.at(-1), Buffer.alloc(480));
      });
      const events = [];
      const done = deferred();
      t.after(subscribePreviewAudioSidecarEvents(event => {
        events.push(event);
        if (events.length === 3) done.resolve();
      }));
      const probe = deferred();
      const probing = deferred();
      let probeCount = 0;
      t.after(() => probe.resolve(metadata));
      const common = { ...f.options, ffmpeg: 'mock-ffmpeg', probeAudio: () => {
        if (++probeCount === 3) probing.resolve();
        return probe.promise;
      } };
      const statuses = sources.map(sourcePath => requestPreviewAudioSidecar({ ...common, sourcePath,
        ...(by === 'keys' ? { outSec: 120 } : { decodedBytesThreshold: 1 }) }));
      const target = by === 'keys' ? statuses[2].key : sources[2];
      if (by === 'sourcePaths') await probing.promise;
      assert.deepEqual(promotePreviewAudioSidecars({ cacheDir: path.join(f.root, 'other'), [by]: [target] }),
        { promoted: [] });
      assert.deepEqual(promotePreviewAudioSidecars({ cacheDir: f.root, [by]: [target, target] }),
        { promoted: [target] });
      probe.resolve(metadata);
      await done.promise;
      assert.deepEqual(events.map(event => event.state), ['ready', 'ready', 'ready']);
      assert.deepEqual(events.map(event => event.sourcePath), [sources[2], sources[0], sources[1]]);
      assert.deepEqual(starts, [sources[2], sources[0], sources[1]]);
      assert.deepEqual(promotePreviewAudioSidecars({ cacheDir: f.root,
        keys: [events[0].key, 'missing'], sourcePaths: sources }), { promoted: [] });
      assert.deepEqual(promotePreviewAudioSidecars({ cacheDir: f.root }), { promoted: [] });
    });
}

test('昇格 API は keys → sourcePaths の入力順に移動し取得済み札を無視する',
  { timeout: 5000 }, async t => {
    const f = fixture(t);
    const sources = ['first.wav', 'second.wav', 'third.wav'].map(name => path.join(f.root, name));
    for (const sourcePath of sources) fs.writeFileSync(sourcePath, 'fixture');
    const entered = deferred();
    const gate = deferred();
    t.after(() => gate.resolve());
    const starts = [];
    mockSpawn(t, async (child, command, args) => {
      starts.push(args[args.indexOf('-i') + 1]);
      entered.resolve();
      await gate.promise;
      fs.writeFileSync(args.at(-1), Buffer.alloc(480));
    });
    const events = [];
    const done = deferred();
    t.after(subscribePreviewAudioSidecarEvents(event => {
      events.push(event);
      if (events.length === 3) done.resolve();
    }));
    const statuses = sources.map(sourcePath => requestPreviewAudioSidecar({ ...f.known, sourcePath,
      ffmpeg: 'mock-ffmpeg' }));
    const keys = [statuses[1].key, statuses[2].key];
    assert.deepEqual(promotePreviewAudioSidecars({ cacheDir: f.root, keys, sourcePaths: [sources[0]] }),
      { promoted: [...keys, sources[0]] });
    await entered.promise;
    assert.deepEqual(promotePreviewAudioSidecars({ cacheDir: f.root,
      keys: [statuses[0].key], sourcePaths: [sources[0]] }), { promoted: [] });
    gate.resolve();
    await done.promise;
    assert.deepEqual(starts, [sources[0], sources[2], sources[1]]);
    assert.deepEqual(events.map(event => event.state), ['ready', 'ready', 'ready']);
  });

test('背景 probe の hold は B だけを通し A → C へ枠を渡す',
  { timeout: 5000 }, async t => {
    const f = fixture(t);
    const sources = ['first.wav', 'second.wav', 'third.wav'].map(name => path.join(f.root, name));
    for (const sourcePath of sources) fs.writeFileSync(sourcePath, 'fixture');
    const gates = sources.map(() => deferred());
    const entered = sources.map(() => deferred());
    const probe = deferred();
    t.after(() => { probe.resolve(metadata); for (const gate of gates) gate.resolve(); });
    const starts = [];
    let active = 0;
    let peak = 0;
    mockSpawn(t, async (child, command, args) => {
      const sourcePath = args[args.indexOf('-i') + 1];
      const index = sources.indexOf(sourcePath);
      starts.push(sourcePath);
      peak = Math.max(peak, ++active);
      entered[index].resolve();
      await gates[index].promise;
      fs.writeFileSync(args.at(-1), Buffer.alloc(480));
      active -= 1;
    });
    const events = [];
    const done = deferred();
    t.after(subscribePreviewAudioSidecarEvents(event => {
      events.push(event);
      if (events.length === 3) done.resolve();
    }));
    const common = { ...f.options, concurrency: undefined, ffmpeg: 'mock-ffmpeg' };
    requestPreviewAudioSidecar({ ...common, sourcePath: sources[0],
      decodedBytesThreshold: 1, probeAudio: () => probe.promise });
    for (const sourcePath of sources.slice(1)) requestPreviewAudioSidecar({ ...common, sourcePath, outSec: 120 });
    await entered[1].promise;
    await nextTurn();
    assert.deepEqual(starts, [sources[1]]);
    probe.resolve(metadata);
    await entered[0].promise;
    await nextTurn();
    assert.deepEqual(starts, [sources[1], sources[0]]);
    gates[0].resolve();
    await entered[2].promise;
    assert.deepEqual(starts, [sources[1], sources[0], sources[2]]);
    gates[1].resolve();
    gates[2].resolve();
    await done.promise;
    assert.equal(peak, 2);
    assert.deepEqual(events.map(event => event.state), ['ready', 'ready', 'ready']);
  });

test('昇格 API は ensure の待機札も動かし失敗・完了後は台帳から外す',
  { timeout: 5000 }, async t => {
    const f = fixture(t);
    const sources = ['first.wav', 'second.wav', 'third.wav'].map(name => path.join(f.root, name));
    for (const sourcePath of sources) fs.writeFileSync(sourcePath, 'fixture');
    mockSpawn(t, async (child, command, args) => {
      if (args[args.indexOf('-i') + 1] === sources[2]) throw new Error('test generation failure');
      fs.writeFileSync(args.at(-1), Buffer.alloc(480));
    });
    const options = sources.map(sourcePath => ({ ...f.known, sourcePath, ffmpeg: 'mock-ffmpeg' }));
    const keys = options.map(value => previewAudioSidecarStatus(value).key);
    const order = [];
    const jobs = options.map((value, index) => ensurePreviewAudioSidecar(value).then(result => {
      order.push(index);
      return result;
    }));
    assert.deepEqual(promotePreviewAudioSidecars({ cacheDir: f.root, keys: [keys[2]] }), { promoted: [keys[2]] });
    const results = await Promise.all(jobs);
    assert.deepEqual(order, [2, 0, 1]);
    assert.deepEqual(results.map(result => result.ok), [true, true, false]);
    assert.deepEqual(promotePreviewAudioSidecars({ cacheDir: f.root, keys, sourcePaths: sources }), { promoted: [] });
  });
