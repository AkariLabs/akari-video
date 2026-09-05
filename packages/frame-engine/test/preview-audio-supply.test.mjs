import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreviewAudioSupply } from '../dist/index.js';
import { deferred, expectedSamples, fakeClock, flush, metadata, rangeServer, sampleRate } from './pcm-window-fixture.mjs';

function pcmDeclaration(id = 'bed', durationSec = 120, kind = 'bgm', spec = {}) {
  const meta = metadata(durationSec, `/${id}.pcm`);
  return { kind, id, url: meta.url, sourceUrl: `/${id}.wav`, spec: {
    id, sidecarState: 'ready', sidecar: { ...meta, path: meta.url, format: 'pcm-s16le',
      padBeforeSec: 0, padAfterSec: 0 }, ...spec,
  } };
}

function pcmSupply(t, { durationSec = 120, server, ...options } = {}) {
  const clock = fakeClock(t);
  const context = new FakeContext(new Map([[1, buffer(8, 80, 2)]]));
  server ??= rangeServer({ durationSec, requireRange: true });
  const warnings = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: durationSec, contextFactory: () => context,
    declarations: [pcmDeclaration('bed', durationSec)], fetchImpl: server.fetchImpl,
    nowImpl: clock.now, onWarning: message => warnings.push(message), ...options,
  });
  t.after(() => supply.dispose());
  return { supply, context, clock, warnings, ...server };
}

function assertWindowStats(supply, requests, extra = {}) {
  const successful = requests.filter(request => request.reads > 0 && !request.signal?.aborted);
  const stats = supply.debug().prefetch.windows;
  assert.equal(stats.fetched, successful.length);
  assert.equal(stats.bytes, successful.reduce((sum, request) => sum + request.bodyBytes, 0));
  for (const [key, value] of Object.entries(extra)) assert.equal(stats[key], value, key);
}

function assertPcmNode(source, startFrame) {
  const [, offset, duration] = source.starts[0];
  assert.equal(offset, 0);
  assert.equal(duration, source.buffer.length / sampleRate, 'duration remains in material seconds');
  assert.equal(source.loop, false);
  assert.deepEqual(source.buffer.getChannelData(0), expectedSamples(startFrame, source.buffer.length));
}

test('再生中の組み直しが最初の窓を待つ間に届いた次の ready も拾い、組み直しは 2 回だけ行う', async t => {
  const secondWindow = deferred();
  const server = rangeServer({ requireRange: true, beforeResponse: request => {
    if (request.url === '/voice.pcm' && request.start === sampleRate) {
      return new Promise(resolve => setTimeout(resolve, 800));
    }
    if (request.url === '/bed.pcm') return secondWindow.promise;
  } });
  const marker = { kind: 'sfx', id: 'marker', url: '/marker.wav', spec: { t: 0 } };
  const voice = pcmDeclaration('voice', 120, 'narration', { t: 0 });
  const bed = pcmDeclaration();
  const queuedVoice = { ...voice, spec: { ...voice.spec, sidecarState: 'queued', sidecar: undefined } };
  const queuedBed = { ...bed, spec: { ...bed.spec, sidecarState: 'generating', sidecar: undefined } };
  const { supply, context, clock, requests, warnings } = pcmSupply(t, {
    server, declarations: [marker, queuedVoice, queuedBed],
    fetchImpl: (url, options) => url.endsWith('.pcm') ? server.fetchImpl(url, options) : Promise.resolve(response(1)),
  });
  const resume = t.mock.method(context, 'resume');
  const markerSources = () => context.sources.filter(source => source.buffer === context.buffers.get(1));
  const stops = () => markerSources().reduce((sum, source) => sum + source.stops.length, 0);
  supply.playFrom(0);
  await flush();
  await clock.advance(3000); // cold の初回ゲートが上限で解けてから、再生中の組み直しを検証する。
  assert.equal(supply.debug().scheduled.itemCount, 1);
  context.currentTime = 0.52;
  supply.updateAudio({ declarations: [marker, voice, queuedBed] });
  await flush();
  assert.equal(requests[0].start, sampleRate, '音声時計の 0.5 秒から最初の窓を待つ');
  supply.updateAudio({ declarations: [marker, voice, bed] });
  await flush();
  supply.playbackTime(50);
  await clock.advance(799);
  assert.equal(stops(), 0, '窓待ち中も旧音源を鳴らし続ける');
  assert.equal(supply.debug().scheduled.itemCount, 1);
  await clock.advance(1);
  assert.equal(stops(), 1);
  assert.equal(supply.debug().scheduled.itemCount, 2);
  assert.ok(requests.some(request => request.url === '/bed.pcm'), '保留した更新で次の組み直しが始まる');
  assert.equal(markerSources().at(-1).stops.length, 0, '次の窓待ち中も直前の音源は止めない');
  secondWindow.resolve();
  await flush();
  const debug = supply.debug();
  assert.equal(debug.scheduled.itemCount, 3);
  assert.equal(debug.scheduled.bgm, 1);
  assert.equal(debug.scheduled.narration, 1);
  assert.equal(debug.scheduled.startAtSec, 0.5, '壁時計の fallback へ乗り換えない');
  assert.deepEqual(new Set(debug.supply.ready), new Set(['sfx:marker', 'narration:voice', 'bgm:bed']));
  assert.ok(debug.supply.bufferedUntil['bgm:bed'] > supply.position(50));
  assert.equal(debug.supply.phase, 'ready');
  assert.deepEqual(debug.scheduled.skipped, []);
  assert.equal(stops(), 2, '常時鳴る marker の stop は組み直しごとに 1 回だけ');
  assert.equal(markerSources().length, 3);
  assert.equal(resume.mock.callCount(), 3, '初回開始と組み直し 2 回だけ launch する');
  assert.deepEqual(warnings, []);
});

for (const action of ['pause', 'seek', 'dispose']) {
  test(`組み直し中の ready を保留しても ${action} 後に古い世代から再開しない`, async t => {
    const gate = deferred();
    const bed = pcmDeclaration();
    const voice = pcmDeclaration('voice', 120, 'narration', { t: 0 });
    const queued = { ...voice, spec: { ...voice.spec, sidecarState: 'queued', sidecar: undefined } };
    const server = rangeServer({ requireRange: true, beforeResponse: request =>
      request.url === '/voice.pcm' ? gate.promise : undefined });
    const { supply, context, clock, requests } = pcmSupply(t, { server, declarations: [bed, queued] });
    const resume = t.mock.method(context, 'resume');
    supply.playFrom(0);
    await flush();
    await clock.advance(3000);
    supply.updateAudio({ declarations: [bed, voice] });
    await flush();
    const replacement = { ...voice, url: '/new-voice.pcm', spec: { ...voice.spec,
      sidecar: { ...voice.spec.sidecar, path: '/new-voice.pcm' },
    } };
    supply.updateAudio({ declarations: [bed, replacement] });
    await flush();
    assert.equal(resume.mock.callCount(), 2);
    if (action === 'seek') supply.seek(30);
    else supply[action]();
    assert.ok(requests.find(request => request.url === '/voice.pcm').signal.aborted);
    const count = context.sources.length;
    gate.resolve();
    await flush();
    await clock.advance(10000);
    assert.equal(supply.debug().playing, false);
    assert.equal(context.sources.length, count);
    assert.ok(context.sources.every(source => source.stops.length === 1));
    assert.equal(resume.mock.callCount(), 2, '保留していた更新で launch しない');
    assert.equal(clock.pending(), 0);
  });
}

test('同じ tick の updateAudio は prefetch に合流し、finally と then が重なっても組み直しは 1 回だけ行う', async t => {
  const marker = { kind: 'sfx', id: 'marker', url: '/marker.wav', spec: { t: 0 } };
  const voice = { kind: 'narration', id: 'voice', url: '/voice.flac', spec: { t: 0, sidecarState: 'ready' } };
  const bed = pcmDeclaration();
  const queuedVoice = { ...voice, spec: { ...voice.spec, sidecarState: 'queued' } };
  const queuedBed = { ...bed, spec: { ...bed.spec, sidecarState: 'queued', sidecar: undefined } };
  const gate = deferred();
  const server = rangeServer({ requireRange: true });
  const { supply, context, clock, warnings } = pcmSupply(t, {
    server, declarations: [marker, queuedVoice, queuedBed],
    fetchImpl: async (url, options) => {
      if (url.endsWith('.pcm')) return server.fetchImpl(url, options);
      if (url === '/voice.flac') await gate.promise;
      return response(1);
    },
  });
  const resume = t.mock.method(context, 'resume');
  supply.playFrom(0);
  await flush();
  await clock.advance(3000);
  const original = context.sources[0];
  supply.updateAudio({ declarations: [marker, voice, queuedBed] });
  supply.updateAudio({ declarations: [marker, voice, bed] });
  await flush();
  assert.equal(supply.debug().prefetch.pending, 1);
  assert.equal(original.stops.length, 0);
  gate.resolve();
  await flush();
  assert.equal(supply.debug().scheduled.itemCount, 3);
  assert.deepEqual(new Set(supply.debug().supply.ready), new Set(['sfx:marker', 'narration:voice', 'bgm:bed']));
  assert.equal(supply.debug().supply.phase, 'ready');
  assert.equal(original.stops.length, 1);
  assert.ok(context.sources.slice(1).every(source => source.stops.length === 0));
  assert.equal(resume.mock.callCount(), 2, '初回開始と組み直し 1 回だけ launch する');
  assert.equal(context.decodeCalls, 2);
  assert.deepEqual(warnings, []);
});

test('再生前は PCM メタデータだけで ready になり、再生中は最初の窓が届くまで preparing に戻る', async t => {
  const gate = deferred();
  const server = rangeServer({ requireRange: true, beforeResponse: () => gate.promise });
  const bed = pcmDeclaration();
  const queued = { ...bed, spec: { ...bed.spec, sidecarState: 'generating', sidecar: undefined } };
  const { supply, clock, requests } = pcmSupply(t, { server, declarations: [queued] });
  assert.equal(supply.debug().supply.phase, 'preparing');
  supply.updateAudio({ declarations: [bed] });
  await flush();
  assert.deepEqual(supply.debug().supply.bufferedUntil, {});
  assert.deepEqual(supply.debug().supply.ready, ['bgm:bed']);
  assert.equal(supply.debug().supply.phase, 'ready');
  assert.equal(requests.length, 0, '再生前に窓を取得しない');
  supply.playFrom(0);
  await flush();
  await clock.advance(1500);
  assert.equal(supply.debug().playing, true);
  assert.equal(supply.debug().supply.gate.holding, true, 'playing だけでは最初の窓の hold は解けない');
  assert.equal(supply.playbackTime(1.5), 0);
  assert.deepEqual(supply.debug().supply.ready, []);
  assert.equal(supply.debug().supply.phase, 'preparing');
  gate.resolve();
  await flush();
  assert.equal(supply.debug().supply.gate.holding, false, '最初の窓の readiness で解除する');
  assert.ok(supply.debug().supply.bufferedUntil['bgm:bed'] > supply.position(0));
  assert.deepEqual(supply.debug().supply.ready, ['bgm:bed']);
  assert.equal(supply.debug().supply.phase, 'ready');
  supply.pause();
  assert.deepEqual(supply.debug().supply.bufferedUntil, {});
  assert.equal(supply.debug().supply.phase, 'ready');
});

test('updateAudio 後の sidecar 集計は現在の declarations と speech を重複排除して映す', async t => {
  const bed = pcmDeclaration();
  bed.spec.sidecar = { ...bed.spec.sidecar, skipped: true, bytes: 100 };
  const spoken = speech('spoken', 'video', '/video.mp4', { sidecar: bed.spec.sidecar, sidecarState: 'ready' });
  const { supply, requests } = pcmSupply(t, { declarations: [bed], speech: [spoken] });
  const before = supply.debug().sidecars;
  assert.deepEqual(before, { generated: 0, skipped: 1, bytes: 100 });
  const replacement = { ...bed, url: '/new-bed.pcm', spec: { ...bed.spec,
    sidecar: { ...bed.spec.sidecar, path: '/new-bed.pcm', skipped: false, bytes: 200 },
  } };
  supply.updateAudio({ declarations: [replacement] });
  assert.deepEqual(supply.debug().sidecars, { generated: 1, skipped: 1, bytes: 300 });
  supply.updateAudio({ speech: [{ ...spoken,
    sidecar: { ...spoken.sidecar, path: '/new-speech.pcm', skipped: false, bytes: 400 },
  }] });
  await flush();
  assert.deepEqual(supply.debug().sidecars, { generated: 2, skipped: 0, bytes: 600 });
  assert.deepEqual(before, { generated: 0, skipped: 1, bytes: 100 }, '以前の debug は書き換えない');
  assert.equal(requests.length, 0);
});

test('windowed PCM uses only bounded Ranges and replenishes per-item bufferedUntil without decode bytes', async t => {
  const { supply, context, clock, requests } = pcmSupply(t, {
    declarations: [pcmDeclaration(), pcmDeclaration('voice', 120, 'narration', { t: 4 })],
  });
  supply.playFrom(0);
  await flush();
  const before = supply.debug().supply.bufferedUntil;
  assert.deepEqual(before, { 'bgm:bed': 13, 'narration:voice': 14 });
  assert.ok(context.createdBuffers.length > 2);
  assert.equal(context.decodeCalls, 0);
  assert.equal(supply.debug().prefetch.decodedBytes, 0);
  context.currentTime = 4.02;
  await clock.advance(500);
  assert.deepEqual(supply.debug().supply.bufferedUntil, { 'bgm:bed': 16, 'narration:voice': 17 });
  assert.deepEqual(before, { 'bgm:bed': 13, 'narration:voice': 14 }, 'debug returns a snapshot');
  assert.ok(requests.every(request => request.range && request.bodyBytes <= (3 * sampleRate + 1) * 2));
  assert.equal(requests.filter(request => !request.range).length, 0);
  assertWindowStats(supply, requests, { evicted: 0, late: 0, failed: 0,
    cacheBytes: requests.reduce((sum, request) => sum + request.bodyBytes * 2, 0) });
});

for (const [playbackRate, rate] of [[1, 1], [1.5, 1], [1.5, 2]]) {
  test(`PCM windows are sample-contiguous at playbackRate=${playbackRate}, rate=${rate}`, async t => {
    const startFrame = 9 * sampleRate + 1;
    const { supply, context, requests } = pcmSupply(t, {
      scheduleBuilder: ({ startAtSec }) => ({ startAtSec, warnings: [], items: [{
        kind: 'bgm', id: 'bed', track: 0, timelineStartSec: 2, timelineEndSec: 32,
        delaySec: 2, sourceOffsetSec: startFrame / sampleRate, durationSec: 30,
        sourceDurationSec: 30 * playbackRate, playbackRate, loop: false, gainDb: 0,
        gainEvents: [{ offsetSec: 0, value: 0, method: 'set' }, { offsetSec: 8, value: 1, method: 'linear' }],
        envelopeEvents: [{ offsetSec: 0, value: 1, method: 'set' }, { offsetSec: 4, value: 0.5, method: 'linear' }],
      }] }),
    });
    supply.setRate(rate);
    supply.playFrom(0);
    await flush();
    assert.ok(context.sources.length >= 4);
    assert.equal(context.gains.length, 3, 'one master and one base/envelope pair for the entire item');
    assert.deepEqual(context.gains[1].gain.calls, [['set', 0, 0.02 + 2 / rate], ['linear', 1, 0.02 + 10 / rate]]);
    assert.deepEqual(context.gains[2].gain.calls, [['set', 1, 0.02 + 2 / rate], ['linear', 0.5, 0.02 + 6 / rate]]);
    let cursor = startFrame;
    let consumed = 0;
    for (const [index, source] of context.sources.entries()) {
      assert.equal(source.playbackRate.value, playbackRate * rate);
      assertPcmNode(source, cursor);
      const [when, , duration] = source.starts[0];
      assert.equal(when, 0.02 + 2 / rate + consumed / (playbackRate * rate));
      if (index > 0) {
        assert.equal(requests[index - 1].end + 1, requests[index].start, 'zero sample gap or overlap');
        const previous = context.sources[index - 1].starts[0];
        assert.ok(Math.abs((when - previous[0]) * playbackRate * rate * sampleRate - previous[2] * sampleRate) < 1e-7);
      }
      assert.equal(requests[index].start, cursor * 2);
      cursor += source.buffer.length;
      consumed += duration;
    }
  });
}

test('PCM BGM loop splits at the material end and wraps to zero with finite non-looping nodes', async t => {
  const { supply, context, requests } = pcmSupply(t, { timelineDurationSec: 130 });
  supply.playFrom(117.5);
  await flush();
  assert.ok(context.sources.length >= 3);
  assert.deepEqual(requests.slice(0, 3).map(request => [request.start / (sampleRate * 2), (request.end + 1) / (sampleRate * 2)]),
    [[117.5, 118.5], [118.5, 120], [0, 3]]);
  let materialFrame = 117.5 * sampleRate;
  let when = 0.02;
  for (const source of context.sources) {
    assertPcmNode(source, materialFrame);
    assert.ok(Math.abs(source.starts[0][0] - when) < 1e-12);
    materialFrame = (materialFrame + source.buffer.length) % (120 * sampleRate);
    when += source.starts[0][2];
  }
});

test('seek to 3000 seconds aborts old requests and starts from just one new first window', async t => {
  const old = deferred();
  const later = deferred();
  const server = rangeServer({ durationSec: 3120, requireRange: true, beforeResponse: request => {
    if (request.start === sampleRate * 2) return old.promise;
    if (request.start >= 3001 * sampleRate * 2) return later.promise;
  } });
  const { supply, context, requests } = pcmSupply(t, { durationSec: 3120, server });
  supply.playFrom(0);
  await flush();
  assert.equal(context.sources.length, 1);
  const oldRequest = requests[1];
  supply.seek(3000, true);
  assert.equal(oldRequest.signal.aborted, true);
  assert.equal(context.sources[0].stops.length, 1);
  await flush();
  assert.equal(requests[2].start, 3000 * sampleRate * 2);
  assert.equal(requests[2].bodyBytes, sampleRate * 2);
  assert.equal(context.sources.length, 2, 'first new window schedules while the second is still pending');
  assertPcmNode(context.sources[1], 3000 * sampleRate);
  assert.equal(supply.debug().supply.bufferedUntil['bgm:bed'], 3001);
  const snapshot = supply.debug().prefetch.windows;
  old.resolve();
  await flush();
  assert.deepEqual(supply.debug().prefetch.windows, snapshot);
  assert.equal(context.sources.length, 2);
  supply.dispose();
  later.resolve();
  await flush();
});

test('seek to 3000 seconds excludes ended PCM speech from required and reports ready', async t => {
  const { supply } = pcmSupply(t, {
    durationSec: 3120,
    speech: [speech('v-885-speech', 'v-885', '/v-885.mp4', {
      atSec: 10.4, durationSec: 1447.6, outSec: 1447.6, materialDurationSec: 1447.6,
      sidecar: pcmDeclaration('v-885-speech', 1447.6).spec.sidecar, sidecarState: 'ready',
    })],
  });
  supply.playFrom(10.4);
  await flush();
  assert.ok(supply.debug().supply.required.includes('speech:v-885-speech'));
  supply.seek(3000, true);
  await flush();
  const { required, ready, phase } = supply.debug().supply;
  assert.deepEqual(required, ['bgm:bed']);
  assert.ok(!ready.includes('speech:v-885-speech'));
  assert.equal(phase, 'ready');
});

test('PCM speech remains required while the current position is inside its interval', async t => {
  const { supply, context } = pcmSupply(t, {
    durationSec: 3120,
    speech: [speech('v-885-speech', 'v-885', '/v-885.mp4', {
      atSec: 10.4, durationSec: 1447.6, outSec: 1447.6, materialDurationSec: 1447.6,
      sidecar: pcmDeclaration('v-885-speech', 1447.6).spec.sidecar, sidecarState: 'ready',
    })],
  });
  supply.seek(1000);
  assert.ok(supply.debug().supply.required.includes('speech:v-885-speech'));
  supply.playFrom(0);
  await flush();
  assert.ok(!supply.debug().supply.required.includes('speech:v-885-speech'));
  context.currentTime = 10.42;
  assert.ok(supply.debug().supply.required.includes('speech:v-885-speech'),
    'playing uses the audio clock even when the last requested position is before speech');
});

test('future PCM window 500 retries after exactly five seconds without stopping scheduled audio', async t => {
  let attempts = 0;
  const server = rangeServer({ requireRange: true, beforeResponse: request => {
    if (request.start === sampleRate * 2 && ++attempts === 1) request.status = 500;
  } });
  const { supply, context, clock, requests, warnings } = pcmSupply(t, { server });
  supply.playFrom(0);
  await flush();
  assert.equal(attempts, 1);
  const playing = context.sources[0];
  assert.equal(supply.debug().supply.bufferedUntil['bgm:bed'], 1);
  assertWindowStats(supply, requests, { failed: 1, late: 0 });
  context.currentTime = 0.52;
  await clock.advance(4999);
  assert.equal(attempts, 1);
  assert.equal(playing.stops.length, 0);
  await clock.advance(1);
  assert.equal(attempts, 2);
  assert.equal(playing.stops.length, 0);
  assert.equal(supply.debug().playing, true);
  assertPcmNode(context.sources[1], sampleRate);
  assert.equal(context.sources[1].starts[0][0], 1.02);
  assert.equal(supply.debug().supply.bufferedUntil['bgm:bed'], 13);
  assertWindowStats(supply, requests, { failed: 1, late: 0 });
  assert.deepEqual(warnings, []);
});

test('late PCM arrival counts lateness and schedules only the correctly timed sample suffix', async t => {
  const gate = deferred();
  const server = rangeServer({ requireRange: true, beforeResponse: request =>
    request.start === sampleRate * 2 ? gate.promise : undefined });
  const { supply, context, requests } = pcmSupply(t, { server });
  supply.playFrom(0);
  await flush();
  context.currentTime = 2.02;
  gate.resolve();
  await flush();
  assertPcmNode(context.sources[1], 2 * sampleRate);
  assert.deepEqual(context.sources[1].starts[0], [2.02, 0, 2]);
  assert.equal(context.sources[2].starts[0][0], 4.02, 'later windows keep the original clock');
  assert.equal(context.sources[0].stops.length, 0);
  assertWindowStats(supply, requests, { late: 1, failed: 0 });
  assert.equal(supply.debug().prefetch.decodedBytes, 0);
});

test('1 MiB window cache evicts played PCM and seeking back refetches identical audible samples', async t => {
  const { supply, context, clock, requests } = pcmSupply(t, { windowCacheBytes: 1024 * 1024 });
  supply.playFrom(0);
  await flush();
  const first = context.sources[0].buffer;
  for (let second = 3; second <= 24; second += 3) {
    context.currentTime = second + 0.02;
    for (const source of context.sources) {
      const [when, , duration] = source.starts[0];
      if (source.onended && when + duration / source.playbackRate.value <= context.currentTime) {
        const end = source.onended;
        source.onended = null;
        end();
      }
    }
    await clock.advance(500);
  }
  const stats = supply.debug().prefetch.windows;
  assert.ok(stats.evicted > 0);
  const created = context.sources.length;
  supply.seek(0, true);
  assert.ok(supply.debug().prefetch.windows.cacheBytes <= 1024 * 1024, 'unpinning restores the 1 MiB limit');
  await flush();
  assert.equal(requests.filter(request => request.start === 0).length, 2);
  assert.notEqual(context.sources[created].buffer, first);
  assert.deepEqual(context.sources[created].buffer.getChannelData(0), first.getChannelData(0));
  assertPcmNode(context.sources[created], 0);
  assertWindowStats(supply, requests, { failed: 0, late: 0 });
  assert.equal(supply.debug().prefetch.decodedBytes, 0);
  supply.pause();
  assert.ok(supply.debug().prefetch.windows.cacheBytes <= 1024 * 1024);
});

for (const outcome of ['ready', 'timeout', 'superseded']) {
  test(`replan preserves old PCM audio until replacement startup is ${outcome}`, async t => {
    const oldFuture = deferred();
    const replacement = deferred();
    const server = rangeServer({ requireRange: true, beforeResponse: request => {
      if (request.start === sampleRate * 2) return oldFuture.promise;
      if (request.start === sampleRate) return replacement.promise;
    } });
    const bed = pcmDeclaration();
    const queued = { kind: 'narration', id: 'voice', url: '/voice.wav', spec: { id: 'voice', t: 0, sidecarState: 'queued' } };
    const { supply, context, clock, requests } = pcmSupply(t, { server, declarations: [bed, queued],
      fetchImpl: (url, options) => url.endsWith('.pcm') ? server.fetchImpl(url, options) : Promise.resolve(response(1)),
    });
    supply.playFrom(0);
    await flush();
    await clock.advance(3000);
    const original = context.sources[0];
    const oldRequest = requests[1];
    context.currentTime = 0.52;
    supply.updateAudio({ declarations: [bed, { ...queued, url: '/voice.flac', spec: { ...queued.spec,
      sidecarState: 'ready', sidecar: { path: '/voice.flac', durationSec: 8, padBeforeSec: 0, padAfterSec: 0 },
    } }] });
    await flush();
    assert.equal(requests[2].start, sampleRate, 'replacement starts at the pinned audio position');
    assert.equal(oldRequest.signal.aborted, false);
    assert.equal(original.stops.length, 0, 'waiting for replacement must not silence the current node');
    await clock.advance(1499);
    assert.equal(original.stops.length, 0);
    assert.equal(oldRequest.signal.aborted, false);
    if (outcome === 'superseded') {
      supply.seek(80);
      assert.equal(requests[2].signal.aborted, true);
      replacement.resolve();
      await flush();
      assert.equal(context.sources.length, 1, 'obsolete startFrom cannot schedule after seek');
      assert.equal(supply.debug().playing, false);
    } else {
      if (outcome === 'ready') replacement.resolve();
      else await clock.advance(1);
      await flush();
      assert.equal(supply.debug().playing, true);
      assert.equal(supply.debug().scheduled.startAtSec, 0.5);
      if (outcome === 'timeout') {
        assert.equal(context.sources.length, 2, 'ready FLAC starts at the 1500 ms deadline');
        replacement.resolve();
        await flush();
      }
      const pcmNodes = context.sources.filter(source => source.buffer !== context.buffers.get(1));
      assert.ok(pcmNodes.length > 1);
      assertPcmNode(pcmNodes[1], sampleRate / 2);
    }
    assert.equal(oldRequest.signal.aborted, true);
    assert.equal(original.stops.length, 1);
    const before = supply.debug().prefetch.windows;
    oldFuture.resolve();
    await flush();
    assert.deepEqual(supply.debug().prefetch.windows, before, 'old response cannot affect the new generation');
  });
}

for (const stage of ['startup', 'playing']) {
  for (const action of ['seek', 'pause', 'setRate', 'dispose']) {
    test(`${action} immediately cancels PCM ${stage} requests, nodes and refill timers`, async t => {
      const gate = deferred();
      const server = rangeServer({ requireRange: true, beforeResponse: request =>
        stage === 'startup' || request.start > 0 ? gate.promise : undefined });
      const { supply, context, clock, requests } = pcmSupply(t, { server });
      supply.playFrom(0);
      await flush();
      assert.equal(context.sources.length, stage === 'playing' ? 1 : 0);
      const pending = requests.at(-1);
      if (action === 'seek') supply.seek(30);
      else if (action === 'setRate') supply.setRate(2);
      else supply[action]();
      assert.equal(pending.signal.aborted, true, 'cancellation is synchronous');
      for (const source of context.sources) assert.equal(source.stops.length, 1);
      // Rate changes intentionally launch another generation; stop it before draining.
      if (action === 'setRate') supply.pause();
      const count = requests.length;
      const fetched = supply.debug().prefetch.windows.fetched;
      gate.resolve();
      await flush();
      await clock.advance(10000);
      assert.equal(requests.length, count);
      assert.equal(context.sources.length, stage === 'playing' ? 1 : 0);
      assert.equal(supply.debug().prefetch.windows.fetched, fetched);
      assert.equal(clock.pending(), 0);
    });
  }
}

test('mixed PCM, FLAC, SFX and source-only items keep Range and whole-file decode paths separate', async t => {
  const server = rangeServer({ requireRange: true });
  const whole = [];
  const { supply, context, requests } = pcmSupply(t, { server,
    declarations: [pcmDeclaration(),
      { kind: 'narration', id: 'flac', url: '/voice.flac', sourceUrl: '/voice.wav', spec: {
        id: 'flac', t: 0, sidecar: { path: '/voice.flac', format: 'flac', durationSec: 8, padBeforeSec: 0, padAfterSec: 0 },
      } },
      { kind: 'sfx', id: 'hit', url: '/hit.mp3', spec: { id: 'hit', t: 0 } },
      { kind: 'narration', id: 'raw', url: '/raw.wav', spec: { id: 'raw', t: 0 } }],
    fetchImpl: async (url, options) => {
      if (url.endsWith('.pcm')) return server.fetchImpl(url, options);
      assert.equal(new Headers(options?.headers).get('Range'), null);
      whole.push(url);
      return response(1);
    },
  });
  supply.playFrom(0);
  await flush();
  assert.deepEqual(whole.sort(), ['/hit.mp3', '/raw.wav', '/voice.flac']);
  assert.equal(context.decodeCalls, 3);
  assert.equal(context.sources.filter(source => source.buffer === context.buffers.get(1)).length, 3);
  assert.equal(supply.debug().scheduled.itemCount, 4);
  assert.equal(supply.debug().prefetch.decodedBytes, 3 * 80 * 2 * 4);
  assert.ok(requests.length > 1);
  assert.ok(requests.every(request => request.range && request.url === '/bed.pcm'));
  assertWindowStats(supply, requests, { failed: 0 });
});

class FakeParam {
  value = 1;
  calls = [];
  cancelScheduledValues() {}
  setValueAtTime(value, at) { this.value = value; this.calls.push(['set', value, at]); }
  linearRampToValueAtTime(value, at) { this.value = value; this.calls.push(['linear', value, at]); }
  exponentialRampToValueAtTime(value, at) {
    this.value = value;
    this.calls.push(['exponential', value, at]);
  }
}

class FakeSource {
  playbackRate = new FakeParam();
  loop = false;
  buffer = null;
  onended = null;
  starts = [];
  stops = [];
  connect() {}
  disconnect() {}
  stop(...args) { this.stops.push(args); }
  start(...args) { this.starts.push(args); }
}

class FakeGain {
  gain = new FakeParam();
  connections = [];
  disconnectCalls = 0;
  connect(target) { this.connections.push(target); }
  disconnect() { this.disconnectCalls += 1; this.connections = []; }
}

class FakeAnalyser {
  connections = [];
  connect(target) { this.connections.push(target); }
  disconnect() { this.connections = []; }
}

class FakeAudioWorkletNode {
  parameters = new Map([['ratio', new FakeParam()]]);
  connections = [];
  disconnectCalls = 0;
  constructor(context, name, options) {
    this.context = context;
    this.name = name;
    this.parameters.get('ratio').value = options?.parameterData?.ratio ?? 1;
    context.workletNodes.push(this);
  }
  connect(target) { this.connections.push(target); }
  disconnect() { this.disconnectCalls += 1; this.connections = []; }
}

class FakeBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(index) { return this.channels[index]; }
}

class FakeContext {
  currentTime = 0;
  state = 'suspended';
  destination = {};
  sources = [];
  gains = [];
  analysers = [];
  workletNodes = [];
  decodeCalls = 0;
  createdBuffers = [];
  constructor(buffers) { this.buffers = buffers; }
  async decodeAudioData(data) {
    this.decodeCalls += 1;
    const key = new Uint8Array(data)[0];
    const value = this.buffers.get(key);
    if (value instanceof Error) throw value;
    return value;
  }
  createBuffer(numberOfChannels, length, sampleRate) {
    const buffer = new FakeBuffer(numberOfChannels, length, sampleRate);
    this.createdBuffers.push(buffer);
    return buffer;
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createAnalyser() { const analyser = new FakeAnalyser(); this.analysers.push(analyser); return analyser; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}

class FakeOfflineContext {
  decodeCalls = 0;
  constructor(sampleRate, produce) { this.sampleRate = sampleRate; this.produce = produce; }
  async decodeAudioData(data) {
    this.decodeCalls += 1;
    return this.produce(this.sampleRate, data);
  }
}

/** 16bit PCM の RIFF/WAVE ヘッダ + 無音 data。長さの見積もりだけに使う。 */
function wavBytes({ sampleRate = 48000, channels = 2, frames = 150, bits = 16 } = {}) {
  const blockAlign = channels * bits / 8;
  const dataBytes = frames * blockAlign;
  const bytes = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(bytes);
  const ascii = (offset, text) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + dataBytes, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true); view.setUint16(34, bits, true);
  ascii(36, 'data'); view.setUint32(40, dataBytes, true);
  return bytes;
}

const buffer = (duration, length = 10, numberOfChannels = 2) => ({
  duration, length, numberOfChannels,
});

function response(key) {
  return {
    ok: true,
    headers: { get: name => name.toLowerCase() === 'content-length' ? '1' : null },
    arrayBuffer: async () => Uint8Array.of(key).buffer,
  };
}

async function settle() {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

test('PCM sidecars use Range windows and schedule PCM without fetching or decoding the source', async () => {
  const context = new FakeContext(new Map());
  const fetches = [];
  const sidecar = { path: '/regular.pcm', format: 'pcm-s16le', sampleRate: 24000,
    channels: 1, frames: 288000, bytesPerSample: 2, durationSec: 12, padBeforeSec: 0, padAfterSec: 0 };
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 3, contextFactory: () => context,
    fetchImpl: async (url, options) => {
      assert.ok(['/regular.pcm', '/speech.pcm'].includes(url), `unexpected fetch: ${url}`);
      const range = /^bytes=(\d+)-(\d+)$/.exec(options?.headers?.Range ?? '');
      assert.ok(range, 'every PCM request must carry a byte Range');
      const start = Number(range[1]);
      const end = Number(range[2]);
      fetches.push({ url, start, end });
      const bytes = new ArrayBuffer(end - start + 1);
      const view = new DataView(bytes);
      for (let index = 0; index < bytes.byteLength; index += 2) {
        view.setInt16(index, url === '/regular.pcm' ? 8192 : -16384, true);
      }
      return { status: 206, headers: new Headers({ 'Content-Range': `bytes ${start}-${end}/576000` }),
        arrayBuffer: async () => bytes };
    },
    declarations: [{ kind: 'bgm', id: 'bed', url: '/regular.pcm', sourceUrl: '/bed.m4a',
      spec: { id: 'bed', durationSec: 0, sidecar, sidecarState: 'ready' } }],
    speech: [speech('spoken', 'v', '/source.mp4', { inSec: 2, outSec: 3,
      sidecar: { ...sidecar, path: '/speech.pcm' }, sidecarState: 'ready',
      atempo: { path: '/legacy.flac' } })],
  });
  try {
    await supply.prime();
    await settle();
    assert.deepEqual(fetches, [], 'metadata resolution does not fetch PCM or original files');
    assert.equal(context.decodeCalls, 0);
    supply.playFrom(0);
    await settle();
    assert.equal(context.decodeCalls, 0);
    assert.deepEqual([...new Set(fetches.map(item => item.url))].sort(), ['/regular.pcm', '/speech.pcm']);
    assert.equal(context.sources.length, 3, 'BGM has two windows and speech has one');
    assert.deepEqual(context.sources.map(source => source.buffer.duration).sort(), [1, 1, 2]);
    assert.ok(context.sources.every(source => source.starts[0][1] === 0 && source.loop === false));
    assert.ok(context.sources.some(source => source.buffer.getChannelData(0)[0] === 0.25));
    assert.ok(context.sources.some(source => source.buffer.getChannelData(0)[0] === -0.5));
  } finally { supply.dispose(); }
});

function speech(id, src, url, overrides = {}) {
  return {
    id, src, url, atSec: 0, durationSec: 1, inSec: 0, outSec: 1,
    speed: 1, materialDurationSec: 1, ...overrides,
  };
}

function scheduleBuilder({ timelineDurationSec, startAtSec, audio = {} }) {
  const items = [];
  const append = (kind, id, atSec, durationSec, sourceOffsetSec, playbackRate = 1) => {
    const elapsed = Math.max(0, startAtSec - atSec);
    const delaySec = Math.max(0, atSec - startAtSec);
    const available = Math.min(durationSec - elapsed,
      timelineDurationSec - startAtSec - delaySec);
    if (!(available > 0)) return;
    items.push({
      kind, id, track: 0, timelineStartSec: startAtSec + delaySec,
      timelineEndSec: startAtSec + delaySec + available, delaySec,
      sourceOffsetSec: sourceOffsetSec + elapsed * playbackRate,
      durationSec: available, playbackRate, sourceDurationSec: available * playbackRate,
      loop: kind === 'bgm', gainDb: 0,
      gainEvents: [{ offsetSec: 0, value: 1, method: 'set' }], envelopeEvents: [],
    });
  };
  if (audio.bgm) append('bgm', audio.bgm.id ?? 'bgm', 0, timelineDurationSec, 0);
  for (const item of audio.speech ?? []) {
    append('speech', item.id, item.atSec, item.durationSec,
      item.atempo ? 0 : item.inSec, item.atempo ? 1 : item.speed);
  }
  return { startAtSec, items, warnings: [] };
}

test('同一ソースの複数 cut は一度だけ decode し、cut ごとの速度と素材尺で start する', async () => {
  const context = new FakeContext(new Map([[1, buffer(4, 100, 2)]]));
  const fetches = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 3,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async url => { fetches.push(url); return response(1); },
    speech: [
      speech('a-1', 'source-a', '/a.mp4', { durationSec: 1, outSec: 1 }),
      speech('a-2', 'source-a', '/a.mp4', {
        atSec: 1, durationSec: 1, inSec: 1, outSec: 2.15, speed: 1.15,
      }),
    ],
  });

  supply.playFrom(0);
  await settle();
  assert.deepEqual(fetches, ['/a.mp4']);
  assert.equal(context.decodeCalls, 1);
  assert.equal(context.sources.length, 2);
  assert.deepEqual(context.sources.map(source => source.playbackRate.value), [1, 1.15]);
  assert.deepEqual(context.sources.map(source => source.starts[0].slice(1)), [[0, 1], [1, 1.15]]);
  assert.equal(supply.debug().scheduled.speech, 2);
  supply.dispose();
});

test('atempo WAV は元ソースと別に decode し playbackRate 1・offset 0 で鳴らす', async () => {
  const context = new FakeContext(new Map([[1, buffer(4)], [2, buffer(1)]]));
  const fetches = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 1,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async url => {
      fetches.push(url);
      return response(url === '/fast.wav' ? 2 : 1);
    },
    speech: [speech('fast', 'source-a', '/source.mp4', {
      speed: 1.2,
      atempo: { path: '/fast.wav', durationSec: 1, generatedMs: 12.5 },
    })],
  });

  supply.playFrom(0);
  await settle();
  assert.deepEqual(fetches, ['/fast.wav']);
  assert.equal(context.sources[0].playbackRate.value, 1);
  assert.deepEqual(context.sources[0].starts[0].slice(1), [0, 1]);
  assert.deepEqual(supply.debug().speech.atempo, { items: 1, generatedMs: 12.5 });
  supply.dispose();
});

test('atempo decode 失敗は警告一行で元ソースの playbackRate 経路へ退避する', async () => {
  const context = new FakeContext(new Map([[1, buffer(4)], [2, new Error('bad wav')]]));
  const warnings = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 1,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async url => response(url === '/fast.wav' ? 2 : 1),
    onWarning: message => warnings.push(message),
    speech: [speech('fast', 'source-a', '/source.mp4', {
      speed: 1.2,
      outSec: 1.2,
      atempo: { path: '/fast.wav', durationSec: 1 },
    })],
  });

  supply.playFrom(0);
  await settle();
  assert.equal(warnings.filter(message => /speech sidecar fast unavailable/u.test(message)).length, 1);
  assert.equal(context.sources[0].playbackRate.value, 1.2);
  assert.deepEqual(supply.debug().speech.atempo, { items: 0, generatedMs: 0 });
  supply.dispose();
});

test('byte 予算を越えても buffer は捨てず、警告 1 行で全 item を鳴らし、次の再生で再 decode しない', async () => {
  const context = new FakeContext(new Map([
    [1, buffer(2, 10, 2)],
    [2, buffer(2, 10, 2)],
  ]));
  const counts = new Map();
  const warnings = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    scheduleBuilder,
    contextFactory: () => context,
    decodeCacheBytes: 100,
    onWarning: message => warnings.push(message),
    fetchImpl: async url => {
      counts.set(url, (counts.get(url) ?? 0) + 1);
      return response(url === '/a.mp4' ? 1 : 2);
    },
    speech: [
      speech('a', 'source-a', '/a.mp4'),
      speech('b', 'source-b', '/b.mp4', { atSec: 1 }),
    ],
  });
  supply.playFrom(0);
  await settle();
  // 80 + 80 = 160 bytes > 予算 100 でも両方鳴る（以前は後で使う方が黙って予定表から消えていた）
  assert.equal(context.sources.length, 2);
  assert.equal(supply.debug().prefetch.decodedBytes, 160);
  assert.equal(supply.debug().prefetch.overBudget, true);
  assert.equal(supply.debug().scheduled.skipped.length, 0);
  assert.equal(warnings.filter(message => /keeping every buffer/u.test(message)).length, 1);

  supply.pause();
  supply.playFrom(0);
  await settle();
  assert.equal([...counts.values()].reduce((sum, value) => sum + value, 0), 2, '再生ごとの再 fetch が無い');
  assert.equal(context.decodeCalls, 2, '再生ごとの再 decode が無い');
  assert.equal(context.sources.length, 4);
  supply.dispose();
});

test('展開後の見積もりが閾値を超える WAV は OfflineAudioContext で低レート・モノに落として保持する', async () => {
  const context = new FakeContext(new Map());
  const offlineContexts = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    scheduleBuilder,
    contextFactory: () => context,
    compactDecodeThresholdBytes: 1000,
    compactSampleRate: 24000,
    offlineContextFactory: sampleRate => {
      const offline = new FakeOfflineContext(sampleRate, rate => {
        const decoded = new FakeBuffer(2, 75, rate);
        decoded.channels[0].fill(0.5);
        decoded.channels[1].fill(-0.25);
        return decoded;
      });
      offlineContexts.push(offline);
      return offline;
    },
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      // 48 kHz ステレオ 150 frames → 1,200 bytes の見積もり > 閾値 1,000
      arrayBuffer: async () => wavBytes({ frames: 150 }),
    }),
    declarations: [{ kind: 'bgm', id: 'bgm', url: '/bgm.wav', spec: { path: 'bgm.wav' } }],
  });
  supply.playFrom(0);
  await settle();

  assert.equal(context.decodeCalls, 0, '等倍 decode は走らない');
  assert.equal(offlineContexts.length, 1);
  assert.equal(offlineContexts[0].sampleRate, 24000);
  const source = context.sources[0];
  assert.ok(source, 'bgm が予定される');
  assert.equal(source.buffer.numberOfChannels, 1);
  assert.equal(source.buffer.sampleRate, 24000);
  assert.ok(Math.abs(source.buffer.getChannelData(0)[0] - 0.125) < 1e-6, 'L/R の平均でモノ化');
  const debug = supply.debug();
  assert.equal(debug.prefetch.compact, 1);
  assert.equal(debug.prefetch.decodedBytes, 75 * 4);
  supply.dispose();
});

test('閾値未満の WAV は従来どおり context で等倍 decode する', async () => {
  const context = new FakeContext(new Map([[0x52, buffer(1, 10, 2)]]));
  let offlineCalls = 0;
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    scheduleBuilder,
    contextFactory: () => context,
    compactDecodeThresholdBytes: 1000,
    offlineContextFactory: () => { offlineCalls += 1; return null; },
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      // 100 frames → 800 bytes < 1,000
      arrayBuffer: async () => wavBytes({ frames: 100 }),
    }),
    declarations: [{ kind: 'bgm', id: 'bgm', url: '/bgm.wav', spec: { path: 'bgm.wav' } }],
  });
  supply.playFrom(0);
  await settle();
  assert.equal(offlineCalls, 0);
  assert.equal(context.decodeCalls, 1);
  assert.equal(supply.debug().prefetch.compact, 0);
  assert.equal(context.sources.length, 1);
  supply.dispose();
});

test('startFrom の例外は警告に落ち、starting が残らず次の playFrom で鳴る', async () => {
  const context = new FakeContext(new Map([[1, buffer(2, 10, 2)]]));
  let failOnce = true;
  const warnings = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    contextFactory: () => context,
    onWarning: message => warnings.push(message),
    scheduleBuilder: input => {
      if (failOnce) { failOnce = false; throw new Error('boom'); }
      return scheduleBuilder(input);
    },
    fetchImpl: async () => response(1),
    speech: [speech('a', 'source-a', '/a.mp4')],
  });
  supply.playFrom(0);
  await settle();
  assert.equal(supply.debug().playing, false);
  assert.ok(warnings.some(message => /audio start failed/u.test(message)));

  supply.playFrom(0);
  await settle();
  assert.equal(supply.debug().playing, true);
  assert.equal(context.sources.length, 1);
  supply.dispose();
});

test('playbackTime は空の予定表の直後は 500 ms 空けて再試行し、seek 後は即再開する', async () => {
  let clock = 0;
  let builds = 0;
  const context = new FakeContext(new Map([[1, buffer(1, 10, 2)]]));
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 10,
    contextFactory: () => context,
    nowImpl: () => clock,
    scheduleBuilder: input => {
      builds += 1;
      return input.startAtSec >= 5
        ? { startAtSec: input.startAtSec, items: [], warnings: [] }
        : scheduleBuilder(input);
    },
    fetchImpl: async () => response(1),
    speech: [speech('a', 'source-a', '/a.mp4')],
  });
  supply.playbackTime(6);
  await settle();
  assert.equal(builds, 1);
  assert.equal(supply.debug().playing, false);

  supply.playbackTime(6.1);
  await settle();
  assert.equal(builds, 1, '500 ms 以内は予定表を組み直さない');

  clock = 600;
  supply.playbackTime(6.2);
  await settle();
  assert.equal(builds, 2, '500 ms 空けば再試行する');

  supply.seek(0, false);
  supply.playbackTime(0);
  await settle();
  assert.equal(supply.debug().playing, true, 'seek 後は backoff を待たずに鳴る');
  supply.dispose();
});

test('decode 失敗は prefetch.failed に出て、5 秒空けた次の再生で再試行する', async () => {
  let clock = 0;
  let attempts = 0;
  const context = new FakeContext(new Map([[1, buffer(1, 10, 2)]]));
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    scheduleBuilder,
    contextFactory: () => context,
    nowImpl: () => clock,
    onWarning: () => {},
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, status: 404, headers: { get: () => null } }
        : response(1);
    },
    speech: [speech('a', 'source-a', '/a.mp4')],
  });
  supply.playFrom(0);
  await settle();
  assert.deepEqual(supply.debug().prefetch.failed, ['speech:a']);
  assert.equal(supply.debug().playing, false);

  supply.playFrom(0);
  await settle();
  assert.equal(attempts, 1, '5 秒以内は 404 を叩き直さない');

  clock = 5000;
  supply.playFrom(0);
  await settle();
  assert.equal(attempts, 2);
  assert.deepEqual(supply.debug().prefetch.failed, []);
  assert.equal(supply.debug().playing, true);
  supply.dispose();
});

test('音声なしソースは警告一行で全 cut を飛ばし、他ソースと BGM は継続する', async () => {
  const context = new FakeContext(new Map([
    [1, new Error('no audio track')],
    [2, buffer(2)],
    [3, buffer(2)],
  ]));
  const warnings = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async url => response(url === '/silent.mp4' ? 1 : url === '/good.mp4' ? 2 : 3),
    onWarning: message => warnings.push(message),
    declarations: [{
      kind: 'bgm', id: 'bed', url: '/bgm.wav', spec: { id: 'bed', durationSec: 0 },
    }],
    speech: [
      speech('silent-1', 'silent', '/silent.mp4'),
      speech('silent-2', 'silent', '/silent.mp4', { atSec: 1 }),
      speech('good', 'good', '/good.mp4'),
    ],
  });
  supply.playFrom(0);
  await settle();
  supply.pause();
  supply.playFrom(0);
  await settle();

  const unavailable = warnings.filter(message => /speech silent unavailable/u.test(message));
  assert.equal(unavailable.length, 1);
  const debug = supply.debug();
  assert.equal(debug.scheduled.bgm, 1);
  assert.equal(debug.scheduled.speech, 1);
  assert.equal(debug.speechDecode.sources, 2);
  assert.equal(debug.speechDecode.okSources, 1);
  assert.equal(debug.speechDecode.skippedSources, 1);
  assert.ok(debug.speechDecode.totalMs >= 0);
  assert.deepEqual(debug.speechDecode.perSource.map(item => item.ok), [false, true]);
  supply.dispose();
});

test('debug は描画時に二時計を同時採取し speech decode の形を保つ', async () => {
  const context = new FakeContext(new Map([[1, buffer(2, 12, 2)]]));
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 2,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async () => response(1),
    speech: [speech('a', 'source-a', '/a.mp4')],
  });
  supply.playFrom(0);
  await settle();
  context.currentTime = 0.52;
  supply.noteRendered(0.5);
  const debug = supply.debug();
  assert.ok(Number.isFinite(debug.driftMs));
  assert.deepEqual(Object.keys(debug.speechDecode), [
    'sources', 'okSources', 'skippedSources', 'totalMs', 'bytes', 'perSource',
  ]);
  assert.equal(debug.speechDecode.bytes, 96);
  assert.deepEqual(Object.keys(debug.speechDecode.perSource[0]), [
    'src', 'ms', 'durationSec', 'bytes', 'ok',
  ]);
  assert.deepEqual(debug.speech.atempo, { items: 0, generatedMs: 0 });
  supply.dispose();
});

test('prime は ready を待たせず全 item を同時 2 本以下で先読みし sidecar 集計を返す', async () => {
  const context = new FakeContext(new Map([[1, buffer(1)], [2, buffer(1)], [3, buffer(1)]]));
  let active = 0;
  let maxActive = 0;
  const resolvers = [];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 3,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async url => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => resolvers.push(resolve));
      active -= 1;
      return response(url.endsWith('1.flac') ? 1 : url.endsWith('2.flac') ? 2 : 3);
    },
    speech: [0, 1, 2].map(index => speech(`s-${index}`, `source-${index}`, `/source-${index}.mp4`, {
      atSec: index,
      sidecar: {
        path: `/s-${index + 1}.flac`, durationSec: 1,
        padBeforeSec: 0, padAfterSec: 0, skipped: index > 0, bytes: 100 + index,
      },
    })),
  });
  supply.prime();
  await settle();
  assert.equal(supply.debug().prefetch.pending, 3);
  assert.equal(maxActive, 2);
  while (resolvers.length) resolvers.shift()();
  await settle();
  while (resolvers.length) resolvers.shift()();
  await settle();
  const debug = supply.debug();
  assert.equal(debug.prefetch.pending, 0);
  assert.equal(debug.prefetch.items, 3);
  assert.deepEqual(debug.sidecars, { generated: 1, skipped: 2, bytes: 303 });
  supply.dispose();
});

test('sidecar 失敗時も 64 MB 以上の speech source 全体は arrayBuffer 化しない', async () => {
  const context = new FakeContext(new Map([[1, new Error('bad flac')]]));
  const warnings = [];
  let sourceArrayBufferCalls = 0;
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 1,
    scheduleBuilder,
    contextFactory: () => context,
    onWarning: message => warnings.push(message),
    fetchImpl: async url => url.endsWith('.flac') ? response(1) : ({
      ok: true,
      headers: { get: name => name.toLowerCase() === 'content-length' ? String(70 * 1024 * 1024) : null },
      arrayBuffer: async () => { sourceArrayBufferCalls += 1; return Uint8Array.of(2).buffer; },
    }),
    speech: [speech('large', 'hevc', '/large.mp4', {
      sidecar: { path: '/large.flac', durationSec: 1, padBeforeSec: 0, padAfterSec: 0 },
    })],
  });
  supply.playFrom(0);
  await settle();
  assert.equal(sourceArrayBufferCalls, 0);
  assert.equal(supply.debug().speechDecode.skippedSources, 1);
  assert.equal(supply.debug().scheduled.speech, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /speech sidecar large unavailable/u);
  supply.dispose();
});

test('SFX も item 内の第 2 GainNode で exponential envelopeEvents を適用する', async () => {
  const context = new FakeContext(new Map([[1, buffer(1)]]));
  const envelopeEvents = [
    { offsetSec: 0, value: 1, method: 'set' },
    { offsetSec: 0.5, value: 0.25, method: 'exponential' },
  ];
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 1,
    scheduleBuilder: () => ({
      startAtSec: 0,
      warnings: [],
      items: [{
        kind: 'sfx', id: 'hit', track: 0,
        timelineStartSec: 0, timelineEndSec: 1, delaySec: 0,
        sourceOffsetSec: 0, durationSec: 1, playbackRate: 1,
        sourceDurationSec: 1, loop: false, gainDb: 0,
        gainEvents: [{ offsetSec: 0, value: 1, method: 'set' }],
        envelopeEvents,
      }],
    }),
    contextFactory: () => context,
    fetchImpl: async () => response(1),
    declarations: [{
      kind: 'sfx', id: 'hit', url: '/hit.wav',
      spec: { id: 'hit', t: 0, durationSec: 1 },
    }],
  });
  supply.playFrom(0);
  await settle();

  assert.equal(context.gains.length, 3, 'master + base + envelope');
  assert.deepEqual(context.gains[2].gain.calls.map(call => call.slice(0, 2)), [
    ['set', 1],
    ['exponential', 0.25],
  ]);
  assert.equal(context.gains[2].gain.calls[1][2] - context.gains[2].gain.calls[0][2], 0.5);
  supply.dispose();
});

test('s1 setRate(2) は source・開始遅延・gain イベントを 2 倍速で予定する', async () => {
  const context = new FakeContext(new Map([[1, buffer(4)]]));
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 4,
    contextFactory: () => context,
    fetchImpl: async () => response(1),
    declarations: [{ kind: 'sfx', id: 'hit', url: '/hit.wav', spec: { id: 'hit', t: 2 } }],
    scheduleBuilder: () => ({
      startAtSec: 0,
      warnings: [],
      items: [{
        kind: 'sfx', id: 'hit', track: 0,
        timelineStartSec: 2, timelineEndSec: 3, delaySec: 2,
        sourceOffsetSec: 0, durationSec: 1, playbackRate: 1.5,
        sourceDurationSec: 1.5, loop: false, gainDb: 0,
        gainEvents: [
          { offsetSec: 0, value: 0, method: 'set' },
          { offsetSec: 0.5, value: 1, method: 'linear' },
        ],
        envelopeEvents: [],
      }],
    }),
  });

  supply.setRate(2);
  supply.playFrom(0);
  await settle();

  assert.equal(context.sources[0].playbackRate.value, 3);
  assert.equal(context.sources[0].starts[0][0], 1.02);
  assert.deepEqual(context.gains[1].gain.calls, [
    ['set', 0, 1.02],
    ['linear', 1, 1.27],
  ]);
  supply.dispose();
});

test('s2 再生中の setRate は位置を保って source を組み直し、時計を 2 倍で進める', async () => {
  const context = new FakeContext(new Map([[1, buffer(8)]]));
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 8,
    scheduleBuilder,
    contextFactory: () => context,
    fetchImpl: async () => response(1),
    speech: [speech('a', 'source-a', '/a.mp4', { durationSec: 8, outSec: 8 })],
  });
  supply.playFrom(0);
  await settle();
  context.currentTime = 0.52;
  const before = supply.position(0);

  supply.setRate(2);
  const immediatelyAfter = supply.position(before);
  await settle();
  assert.ok(Math.abs(immediatelyAfter - before) <= 1e-6);
  assert.equal(context.sources.length, 2);
  assert.equal(context.sources[0].onended, null, '前世代を停止して切り離す');

  context.currentTime = 0.54;
  const restartedAt = supply.position(before);
  context.currentTime += 1;
  assert.ok(Math.abs(supply.position(before) - restartedAt - 2) <= 1e-6);
  supply.dispose();
});

test('s3 debug は worklet 成功と不在フォールバックの pitch 保持状態を返す', async () => {
  const previousWorkletNode = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  try {
    const workletContext = new FakeContext(new Map([[1, buffer(2)]]));
    const moduleUrls = [];
    workletContext.audioWorklet = { addModule: async url => { moduleUrls.push(url); } };
    const workletSupply = createPreviewAudioSupply({
      timelineDurationSec: 2,
      scheduleBuilder,
      contextFactory: () => workletContext,
      fetchImpl: async () => response(1),
      speech: [speech('a', 'source-a', '/a.mp4')],
      pitchShiftWorkletUrl: '/preview-audio-worklet.js',
    });
    await settle();
    workletSupply.setRate(2);
    assert.deepEqual(moduleUrls, ['/preview-audio-worklet.js']);
    assert.deepEqual(
      (({ rate, pitchPreserved, stretcher }) => ({ rate, pitchPreserved, stretcher }))(workletSupply.debug()),
      { rate: 2, pitchPreserved: true, stretcher: 'worklet' }
    );
    const analyser = workletSupply.attachAnalyser();
    assert.equal(analyser, workletSupply.attachAnalyser(), '同じ AnalyserNode を再利用する');
    assert.equal(workletContext.analysers.length, 1);
    assert.equal(analyser.connections[0], workletContext.destination);
    assert.equal(workletContext.workletNodes[0].connections[0], analyser);
    workletSupply.dispose();

    const fallbackContext = new FakeContext(new Map([[1, buffer(2)]]));
    const warnings = [];
    const fallbackSupply = createPreviewAudioSupply({
      timelineDurationSec: 2,
      scheduleBuilder,
      contextFactory: () => fallbackContext,
      fetchImpl: async () => response(1),
      onWarning: message => warnings.push(message),
      speech: [speech('b', 'source-b', '/b.mp4')],
      pitchShiftWorkletUrl: '/preview-audio-worklet.js',
    });
    fallbackSupply.setRate(2);
    assert.deepEqual(
      (({ rate, pitchPreserved, stretcher }) => ({ rate, pitchPreserved, stretcher }))(fallbackSupply.debug()),
      { rate: 2, pitchPreserved: false, stretcher: 'none' }
    );
    assert.equal(warnings.filter(message => /pitch-preserving playback unavailable/u.test(message)).length, 1);
    fallbackSupply.dispose();
  } finally {
    if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = previousWorkletNode;
  }
});

test('s4 setRate(1) は worklet を外して master を destination へ直結する', async () => {
  const previousWorkletNode = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  try {
    const context = new FakeContext(new Map([[1, buffer(2)]]));
    context.audioWorklet = { addModule: async () => {} };
    const supply = createPreviewAudioSupply({
      timelineDurationSec: 2,
      scheduleBuilder,
      contextFactory: () => context,
      fetchImpl: async () => response(1),
      speech: [speech('a', 'source-a', '/a.mp4')],
      pitchShiftWorkletUrl: '/preview-audio-worklet.js',
    });
    await settle();
    const master = context.gains[0];
    supply.setRate(2);
    const worklet = context.workletNodes[0];
    assert.equal(master.connections[0], worklet);
    assert.equal(worklet.connections[0], context.destination);

    supply.setRate(1);
    assert.equal(worklet.connections.length, 0);
    assert.equal(master.connections[0], context.destination);
    assert.deepEqual(
      (({ rate, pitchPreserved, stretcher }) => ({ rate, pitchPreserved, stretcher }))(supply.debug()),
      { rate: 1, pitchPreserved: true, stretcher: 'none' }
    );
    supply.dispose();
  } finally {
    if (previousWorkletNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = previousWorkletNode;
  }
});

test('queued BGM は fetch せず 3 秒後に speech を先に鳴らし、ready 更新後は BGM だけ decode して合流する', async t => {
  const clock = fakeClock(t);
  const context = new FakeContext(new Map([[1, buffer(10)], [2, buffer(10)]]));
  const fetches = [];
  const bgm = { kind: 'bgm', id: 'bed', url: '/bed.wav', spec: { sidecarState: 'queued' } };
  const voice = speech('voice', 'video', '/video.mp4', {
    durationSec: 10, outSec: 10, sidecarState: 'ready',
    sidecar: { path: '/voice.flac', durationSec: 10, padBeforeSec: 0, padAfterSec: 0 },
  });
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 10, scheduleBuilder, contextFactory: () => context,
    nowImpl: clock.now,
    declarations: [bgm], speech: [voice],
    fetchImpl: async url => { fetches.push(url); return response(url === '/bed.flac' ? 2 : 1); },
  });
  t.after(() => supply.dispose());
  supply.playFrom(0);
  await flush();
  await clock.advance(3000);
  assert.deepEqual(fetches, ['/voice.flac']);
  assert.equal(supply.debug().playing, true);
  assert.equal(supply.debug().scheduled.speech, 1);
  assert.equal(supply.debug().prefetch.pending, 0);
  assert.deepEqual(supply.debug().prefetch.failed, []);
  assert.equal(supply.debug().supply.phase, 'preparing');
  assert.deepEqual(supply.debug().supply.pendingSidecar, ['bgm:bed']);
  context.currentTime = 2.02;
  const ready = { ...bgm, url: '/bed.flac', sourceUrl: '/bed.wav', spec: {
    sidecarState: 'ready', sidecar: { path: '/bed.flac', durationSec: 10, padBeforeSec: 0, padAfterSec: 0 },
  } };
  supply.updateAudio({ declarations: [ready], speech: [structuredClone(voice)] });
  await flush();
  assert.deepEqual(fetches, ['/voice.flac', '/bed.flac']);
  assert.equal(context.decodeCalls, 2);
  assert.equal(supply.debug().scheduled.bgm, 1);
  assert.equal(supply.debug().scheduled.speech, 1);
  assert.equal(supply.debug().scheduled.startAtSec, 2, 'replan uses the audio clock');
  assert.equal(supply.debug().supply.phase, 'ready');
  supply.updateAudio({ declarations: [structuredClone(ready)], speech: [structuredClone(voice)] });
  await flush();
  assert.equal(fetches.length, 2);
  supply.dispose();
});

test('no-audio は予定表・待ち・失敗に入らず、将来の pending は現在位置の phase を変えない', async () => {
  const context = new FakeContext(new Map());
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 10, scheduleBuilder, contextFactory: () => context,
    fetchImpl: () => assert.fail('no audio or pending sidecar must not fetch'),
    declarations: [{ kind: 'bgm', id: 'silent', url: '/silent.wav', spec: { sidecarState: 'no-audio' } }],
    speech: [speech('silent', 'silent', '/silent.mp4', { sidecarState: 'no-audio' }),
      speech('later', 'later', '/later.mp4', { atSec: 5, sidecarState: 'generating' })],
  });
  supply.playFrom(0);
  await settle();
  assert.deepEqual(supply.debug().supply.noAudio, ['bgm:silent', 'speech:silent']);
  assert.deepEqual(supply.debug().supply.required, []);
  assert.equal(supply.debug().supply.phase, 'idle');
  assert.equal(supply.debug().scheduled.itemCount, 0);
  assert.equal(supply.debug().prefetch.pending, 0);
  assert.deepEqual(supply.debug().prefetch.failed, []);
  supply.seek(5);
  assert.equal(supply.debug().supply.phase, 'preparing');
  supply.dispose();
});

test('準備中だけの空の予定表も ready 通知で拾い直し、追加・削除は警告して無視する', async t => {
  const clock = fakeClock(t);
  const context = new FakeContext(new Map([[1, buffer(10)]]));
  const warnings = [];
  const queued = speech('voice', 'video', '/video.mp4', { durationSec: 10, outSec: 10, sidecarState: 'queued' });
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 10, scheduleBuilder, contextFactory: () => context,
    nowImpl: clock.now,
    speech: [queued], onWarning: message => warnings.push(message), fetchImpl: async () => response(1),
  });
  t.after(() => supply.dispose());
  supply.playFrom(0);
  await flush();
  await clock.advance(3000); // 空の予定表を組んだ後の ready 通知を検証する。
  assert.equal(supply.debug().playing, false);
  supply.updateAudio({ speech: [{ ...queued, sidecarState: 'ready' }] });
  await flush();
  assert.equal(supply.debug().playing, true);
  assert.equal(supply.debug().supply.phase, 'ready');
  supply.updateAudio({ speech: [speech('extra', 'other', '/extra.mp4')] });
  await flush();
  assert.equal(context.decodeCalls, 1);
  assert.equal(warnings.length, 2);
  assert.equal(supply.debug().scheduled.speech, 1);
  supply.dispose();
});

test('prefetch 中の状態更新は旧 decode を無効化し、新 URL を一度だけ読む', async () => {
  const context = new FakeContext(new Map([[1, buffer(10)], [2, buffer(10)]]));
  let release;
  const fetches = [];
  const initial = { kind: 'bgm', id: 'bed', url: '/old.wav', spec: {} };
  const supply = createPreviewAudioSupply({
    timelineDurationSec: 10, scheduleBuilder, contextFactory: () => context, declarations: [initial],
    fetchImpl: async url => {
      fetches.push(url);
      if (url === '/old.wav') await new Promise(resolve => { release = resolve; });
      return response(url === '/old.wav' ? 1 : 2);
    },
  });
  supply.prime();
  await settle();
  supply.updateAudio({ declarations: [{ ...initial, url: '/new.flac', spec: { sidecarState: 'ready' } }] });
  release();
  await settle();
  supply.playFrom(0);
  await settle();
  assert.deepEqual(fetches, ['/old.wav', '/new.flac']);
  assert.equal(supply.debug().scheduled.bgm, 1);
  assert.equal(context.sources.at(-1).buffer, context.buffers.get(2));
  assert.equal(supply.debug().supply.phase, 'ready');
  supply.dispose();
});

test('warm 再生は最初の PCM 窓が 600 ms 遅れても共通時計を開始位置に保ち、冒頭を飛ばさない', async t => {
  const server = rangeServer({ requireRange: true, beforeResponse: request => {
    if (request.start === 10 * sampleRate * 2) return new Promise(resolve => setTimeout(resolve, 600));
  } });
  const { supply, context, clock, requests } = pcmSupply(t, {
    server, declarations: [pcmDeclaration('voice', 120, 'narration', { t: 0 })],
  });
  supply.prime();
  await flush();
  assert.deepEqual(supply.debug().supply.ready, ['narration:voice']);
  assert.equal(requests.length, 0, 'メタデータだけが ready で、最初の窓はまだ無い');
  supply.playFrom(10);
  assert.equal(supply.playbackTime(10.5), 10);
  assert.equal(supply.playbackTime(10.8), 10);
  assert.equal(supply.position(11), 10);
  await flush();
  await clock.advance(599);
  assert.equal(supply.playbackTime(11.5), 10);
  assert.deepEqual(supply.debug().supply.gate, { holding: true, startSec: 10, heldMs: 599, reason: 'first-window' });
  assert.equal(context.sources.length, 0);
  await clock.advance(1);
  assert.deepEqual(supply.debug().supply.gate, { holding: false, startSec: 0, heldMs: 0, reason: null });
  assert.equal(supply.debug().scheduled.startAtSec, 10);
  assertPcmNode(context.sources[0], 10 * sampleRate);
  assert.equal(supply.playbackTime(12), 10);
  context.currentTime = 0.52;
  assert.equal(supply.playbackTime(13), 10.5, '窓到着後は音声時計で開始位置から進む');
});

test('最初の PCM 窓が 5 秒遅れると、3 秒の上限でゲートを解き壁時計へ戻す', async t => {
  const server = rangeServer({ requireRange: true, beforeResponse: request => {
    if (request.start === 10 * sampleRate * 2) return new Promise(resolve => setTimeout(resolve, 5000));
  } });
  // 既存の窓待ち期限（既定 1500 ms）より先に、ゲート自身の 3 秒上限へ到達させる。
  const { supply, context, clock } = pcmSupply(t, { server, windowStartupWaitMs: 6000 });
  supply.playFrom(10);
  assert.equal(supply.playbackTime(10.5), 10);
  await flush();
  await clock.advance(2999);
  assert.equal(supply.position(13), 10);
  assert.deepEqual(supply.debug().supply.gate, { holding: true, startSec: 10, heldMs: 2999, reason: 'first-window' });
  await clock.advance(1);
  assert.equal(supply.playbackTime(13.2), 13.2);
  assert.deepEqual(supply.debug().supply.gate, { holding: false, startSec: 0, heldMs: 0, reason: null });
  assert.equal(supply.position(13.3), 13.3);
  assert.equal(context.sources.length, 0);
  await clock.advance(2000);
  assert.equal(supply.debug().playing, true);
  assert.equal(supply.debug().supply.gate.holding, false);
  assert.ok(context.sources.length > 0);
});

test('予定表を組む前の decode 待ちで上限を越えた場合は合流位置から予定する', async t => {
  const { supply, context, clock } = pcmSupply(t, {
    declarations: [{ kind: 'bgm', id: 'bed', url: '/bed.wav', spec: {} }],
    fetchImpl: async () => {
      await new Promise(resolve => setTimeout(resolve, 5000));
      return response(1);
    },
  });
  supply.playFrom(10);
  assert.equal(supply.playbackTime(10.5), 10);
  await flush();
  await clock.advance(3000);
  assert.equal(supply.playbackTime(13.2), 13.2);
  assert.equal(supply.debug().supply.gate.holding, false);
  await clock.advance(1999);
  assert.equal(supply.playbackTime(15.2), 15.2);
  await clock.advance(1);
  assert.equal(supply.debug().scheduled.startAtSec, 15.2);
  assert.equal(supply.debug().supply.gate.holding, false);
  context.currentTime = 0.52;
  assert.equal(supply.playbackTime(20), 15.7);
});

test('開始位置に required が無ければゲートを張らず fallback を返す', async t => {
  const { supply } = pcmSupply(t, {
    declarations: [pcmDeclaration('later', 120, 'narration', { t: 20 })],
  });
  supply.playFrom(10);
  assert.equal(supply.playbackTime(10.5), 10.5);
  assert.deepEqual(supply.debug().supply.required, []);
  assert.deepEqual(supply.debug().supply.gate, { holding: false, startSec: 0, heldMs: 0, reason: null });
  await flush();
});

test('required が全て decode 済みならゲートを張らず fallback を返す', async t => {
  const { supply } = pcmSupply(t, {
    declarations: [{ kind: 'bgm', id: 'bed', url: '/bed.wav', spec: {} }],
    fetchImpl: async () => response(1),
  });
  supply.prime();
  await flush();
  supply.playFrom(10);
  assert.deepEqual(supply.debug().supply.required, ['bgm:bed']);
  assert.deepEqual(supply.debug().supply.ready, ['bgm:bed']);
  assert.equal(supply.playbackTime(10.5), 10.5);
  assert.equal(supply.debug().supply.gate.holding, false);
  await flush();
});

for (const action of ['seek', 'pause']) {
  test(`hold 中の ${action} はゲートを解き、古い窓が届いても再開しない`, async t => {
    const firstWindow = deferred();
    const server = rangeServer({ requireRange: true, beforeResponse: () => firstWindow.promise });
    const { supply, context, clock, requests } = pcmSupply(t, { server });
    supply.playFrom(10);
    await flush();
    assert.equal(supply.debug().supply.gate.holding, true);
    if (action === 'seek') supply.seek(20);
    else supply.pause();
    assert.deepEqual(supply.debug().supply.gate, { holding: false, startSec: 0, heldMs: 0, reason: null });
    assert.equal(requests[0].signal.aborted, true);
    firstWindow.resolve();
    await flush();
    await clock.advance(3000);
    assert.equal(context.sources.length, 0);
    assert.equal(supply.debug().playing, false);
    assert.equal(supply.playbackTime(20.5), 20.5, '停止後の最初の呼び出しは fallback を返す');
    supply.pause();
    await flush();
  });
}

for (const action of ['seek', 'setRate']) {
  test(`hold 中の ${action} による再開は新しいゲートを張り、古い finally は解除しない`, async t => {
    const firstWindow = deferred();
    const server = rangeServer({ requireRange: true, beforeResponse: () => firstWindow.promise });
    const { supply, clock, requests } = pcmSupply(t, { server });
    supply.playFrom(10);
    await flush();
    await clock.advance(200);
    assert.deepEqual(supply.debug().supply.gate, { holding: true, startSec: 10, heldMs: 200, reason: 'first-window' });
    if (action === 'seek') supply.seek(20, true);
    else supply.setRate(1.5);
    const startSec = action === 'seek' ? 20 : 10;
    assert.equal(requests[0].signal.aborted, true);
    assert.deepEqual(supply.debug().supply.gate, { holding: true, startSec, heldMs: 0, reason: 'first-window' });
    await flush();
    assert.equal(supply.debug().supply.gate.holding, true, '旧世代の finally 後も新世代は hold する');
    assert.equal(supply.playbackTime(25), startSec);
    firstWindow.resolve();
    await flush();
    assert.equal(supply.debug().supply.gate.holding, false);
    assert.equal(supply.debug().scheduled.startAtSec, startSec);
  });
}

test('debug の gate は idle の形を保ち、sidecar 待ちは空予定表を組まず 3 秒まで hold する', async t => {
  const bed = pcmDeclaration();
  const { supply, clock } = pcmSupply(t, {
    declarations: [{ ...bed, spec: { ...bed.spec, sidecarState: 'queued', sidecar: undefined } }],
  });
  assert.deepEqual(supply.debug().supply.gate, { holding: false, startSec: 0, heldMs: 0, reason: null });
  supply.playFrom(10);
  assert.deepEqual(supply.debug().supply.gate, { holding: true, startSec: 10, heldMs: 0, reason: 'sidecar' });
  await flush();
  assert.equal(supply.debug().supply.phase, 'preparing');
  await clock.advance(2999);
  assert.deepEqual(supply.debug().supply.gate, { holding: true, startSec: 10, heldMs: 2999, reason: 'sidecar' });
  assert.equal(supply.debug().playing, false);
  assert.equal(supply.debug().scheduled.itemCount, 0);
  assert.equal(supply.playbackTime(12), 10);
  await clock.advance(1);
  assert.equal(supply.debug().playing, false);
  assert.equal(supply.debug().scheduled.itemCount, 0);
  assert.deepEqual(supply.debug().supply.gate, { holding: false, startSec: 0, heldMs: 0, reason: null });
  assert.equal(supply.playbackTime(13), 13);
});

for (const startSec of [0, 10]) {
  test(`(f) cold で 3 秒以内に sidecar が届けば narration を開始位置 ${startSec} 秒から鳴らす`, async t => {
    const marker = { kind: 'sfx', id: 'marker', url: '/marker.wav', spec: { t: startSec } };
    const voice = pcmDeclaration('voice', 120, 'narration', { t: 0 });
    const queued = { ...voice, spec: { ...voice.spec, sidecarState: 'queued', sidecar: undefined } };
    const server = rangeServer({ requireRange: true });
    const { supply, context, clock, requests } = pcmSupply(t, {
      server, declarations: [marker, queued],
      fetchImpl: (url, options) => url.endsWith('.pcm') ? server.fetchImpl(url, options) : Promise.resolve(response(1)),
    });
    supply.playFrom(startSec);
    await flush();
    await clock.advance(2000);
    assert.equal(supply.debug().playing, false);
    assert.deepEqual(supply.debug().supply.gate, { holding: true, startSec, heldMs: 2000, reason: 'sidecar' });
    assert.deepEqual(supply.debug().supply.ready, ['sfx:marker']);
    assert.equal(supply.playbackTime(startSec + 1.5), startSec);
    assert.equal(supply.position(startSec + 2), startSec);
    assert.equal(supply.debug().scheduled.itemCount, 0);
    assert.equal(context.sources.length, 0, 'ready の sfx だけで先に鳴り始めない');
    assert.equal(requests.length, 0);

    supply.updateAudio({ declarations: [marker, voice] });
    await flush();
    const debug = supply.debug();
    assert.equal(debug.playing, true);
    assert.equal(debug.supply.gate.holding, false);
    assert.equal(debug.scheduled.startAtSec, startSec);
    assert.equal(debug.scheduled.sfx, 1);
    assert.ok(debug.scheduled.narration >= 1);
    assert.deepEqual(debug.scheduled.skipped, []);
    const firstVoice = context.sources.find(source => source.buffer !== context.buffers.get(1));
    assertPcmNode(firstVoice, startSec * sampleRate);
    assert.equal(supply.playbackTime(startSec + 3), startSec);
  });
}

test('(g) cold で sidecar が 3 秒届かなければ ready の sfx だけで開始し、遅着 narration は音声位置で合流する', async t => {
  const marker = { kind: 'sfx', id: 'marker', url: '/marker.wav', spec: { t: 0 } };
  const voice = pcmDeclaration('voice', 120, 'narration', { t: 0 });
  const queued = { ...voice, spec: { ...voice.spec, sidecarState: 'queued', sidecar: undefined } };
  const server = rangeServer({ requireRange: true });
  const { supply, context, clock, requests } = pcmSupply(t, {
    server, declarations: [marker, queued],
    fetchImpl: (url, options) => url.endsWith('.pcm') ? server.fetchImpl(url, options) : Promise.resolve(response(1)),
  });
  supply.playFrom(0);
  let deadlineObserved = false;
  // 待ちタイマーより先に登録して、期限到達から予定表開始までの同期区間を見る。
  setTimeout(() => {
    assert.equal(supply.debug().supply.gate.holding, false);
    assert.equal(supply.debug().playing, false);
    assert.equal(supply.playbackTime(0), 0, 'hold 中に据え置いた開始位置の fallback で再開する');
    deadlineObserved = true;
  }, 3000);
  await flush();
  await clock.advance(2999);
  assert.equal(supply.debug().supply.gate.holding, true);
  assert.equal(supply.debug().supply.gate.reason, 'sidecar');
  assert.equal(supply.debug().playing, false);
  assert.equal(supply.debug().scheduled.itemCount, 0);
  assert.equal(supply.playbackTime(1.5), 0);
  await clock.advance(1);
  assert.equal(deadlineObserved, true);
  const started = supply.debug();
  assert.equal(started.supply.gate.holding, false);
  assert.equal(started.playing, true);
  assert.equal(started.scheduled.startAtSec, 0);
  assert.equal(started.scheduled.itemCount, 1);
  assert.equal(started.scheduled.sfx, 1);
  assert.equal(started.scheduled.narration, 0);
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].buffer, context.buffers.get(1));
  assert.equal(requests.length, 0);

  context.currentTime = 0.52;
  const joinSec = supply.playbackTime(50);
  assert.equal(joinSec, 0.5, '開始後は従来どおり音声時計を使う');
  supply.updateAudio({ declarations: [marker, voice] });
  assert.equal(supply.debug().supply.gate.holding, false);
  await flush();
  const joined = supply.debug();
  assert.equal(joined.playing, true);
  assert.equal(joined.supply.gate.holding, false);
  assert.equal(joined.scheduled.startAtSec, joinSec);
  assert.ok(joined.scheduled.startAtSec > started.scheduled.startAtSec);
  assert.equal(joined.scheduled.sfx, 1);
  assert.ok(joined.scheduled.narration >= 1);
  assert.deepEqual(joined.scheduled.skipped, []);
  assert.equal(context.sources[0].stops.length, 1, '初回の sfx は組み直しで一度だけ置き換える');
  const firstVoice = context.sources.find(source => source.buffer !== context.buffers.get(1));
  assertPcmNode(firstVoice, joinSec * sampleRate);
});

test('decode 失敗と no-audio はゲートを張る理由にしない', async t => {
  const { supply } = pcmSupply(t, {
    declarations: [
      { kind: 'bgm', id: 'failed', url: '/failed.wav', spec: {} },
      { kind: 'narration', id: 'silent', url: '/silent.wav', spec: { t: 0, sidecarState: 'no-audio' } },
    ],
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  supply.prime();
  await flush();
  assert.deepEqual(supply.debug().supply.failed, ['bgm:failed']);
  assert.deepEqual(supply.debug().supply.noAudio, ['narration:silent']);
  supply.playFrom(10);
  assert.equal(supply.debug().supply.gate.holding, false);
  assert.equal(supply.playbackTime(10.5), 10.5);
  await flush();
});

test('resume 失敗でも finally がゲートを解き、3 秒を待たず fallback を返す', async t => {
  const { supply, context } = pcmSupply(t);
  t.mock.method(context, 'resume', async () => { throw new Error('resume failed'); });
  supply.playFrom(10);
  assert.equal(supply.debug().supply.gate.holding, true);
  await flush();
  assert.deepEqual(supply.debug().supply.gate, { holding: false, startSec: 0, heldMs: 0, reason: null });
  assert.equal(supply.playbackTime(10.5), 10.5);
});
