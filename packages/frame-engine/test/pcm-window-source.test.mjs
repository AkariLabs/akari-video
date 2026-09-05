import assert from 'node:assert/strict';
import test from 'node:test';
import { PcmWindowSource, pcmWindowByteRange } from '../dist/audio/pcm-window-source.js';
import { pcmWindowByteRange as mediaBinRange } from '../../media-bin/src/preview-audio-sidecar.mjs';
import { deferred, expectedSamples, flush, metadata, rangeServer, sampleRate } from './pcm-window-fixture.mjs';

function fixture(t, options = {}, server = rangeServer()) {
  const buffers = [];
  const context = { createBuffer(channels, length, rate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    const buffer = { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate,
      getChannelData: channel => data[channel] };
    buffers.push(buffer);
    return buffer;
  } };
  const source = new PcmWindowSource(metadata(), server.fetchImpl, context, options);
  t.after(() => source.dispose());
  return { source, buffers, ...server };
}

test('PCM windows reproduce s16le samples across adjacent windows with zero missing or duplicate frames', async t => {
  const { source, requests } = fixture(t);
  const first = await source.window(9, 10);
  const second = await source.window(10, 13);
  const joined = new Float32Array(first.length + second.length);
  joined.set(first.getChannelData(0));
  joined.set(second.getChannelData(0), first.length);
  assert.deepEqual(joined, expectedSamples(9 * sampleRate, 4 * sampleRate));
  assert.equal(requests[0].end + 1, requests[1].start);
  assert.deepEqual(source.debug(), { fetched: 2, bytes: 4 * sampleRate * 2,
    cacheBytes: 4 * sampleRate * 4, evicted: 0, late: 0, failed: 0 });
});

test('pcmWindowByteRange matches media-bin for zero, fractional, clamped, reversed and empty ranges', () => {
  for (const meta of [metadata(), { ...metadata(), frames: 0 }, { ...metadata(), channels: 2 }]) {
    for (const [start, end] of [[0, 1], [0.00001, 0.00007], [9.99999, 10.00001],
      [119.5, 121], [120, 121], [-1, 1], [-2, -1], [2, 2], [3, 2], [NaN, 1], [0, Infinity]]) {
      assert.deepEqual(pcmWindowByteRange(meta, start, end), mediaBinRange(meta, start, end), `${start}..${end}`);
    }
  }
});

test('empty PCM windows return silence without fetching', async t => {
  const { source, requests } = fixture(t);
  const result = await source.window(120, 121);
  assert.ok(result.getChannelData(0).every(value => value === 0));
  assert.equal(requests.length, 0);
});

test('PCM rejects a full-body 200 response and cancels without reading the body', async t => {
  const server = rangeServer();
  const { source } = fixture(t, {}, { ...server, fetchImpl: url => server.fetchImpl(url) });
  await assert.rejects(source.window(0, 1), /status=200/);
  assert.equal(server.requests[0].reads, 0);
  assert.equal(server.requests[0].cancels, 1);
  assert.equal(source.debug().failed, 1);
});

test('PCM rejects 416, mismatched Content-Range and unaligned body lengths', async t => {
  for (const mode of ['416', 'start', 'unaligned']) {
    const server = rangeServer();
    const { source } = fixture(t, {}, { ...server, fetchImpl: async (url, options) => {
      const response = await server.fetchImpl(url, options);
      if (mode === '416') return server.fetchImpl(url, { headers: { Range: 'bytes=999999999-999999999' } });
      if (mode === 'start') response.headers.set('Content-Range', 'bytes 2-47999/5760000');
      if (mode === 'unaligned') response.arrayBuffer = async () => new ArrayBuffer(47999);
      return response;
    } });
    await assert.rejects(source.window(0, 1), mode === '416' ? /status=416/ : mode === 'start' ? /Content-Range/ : /frame count/);
    assert.equal(source.debug().fetched, 0);
    assert.equal(source.debug().cacheBytes, 0);
    assert.equal(source.debug().failed, 1);
  }
});

test('concurrent PCM window consumers share one fetch and can cancel independently', async t => {
  const gate = deferred();
  const { source, requests } = fixture(t, {}, rangeServer({ beforeResponse: () => gate.promise }));
  const controller = new AbortController();
  const cancelled = source.window(10, 13, controller.signal);
  const rejected = assert.rejects(cancelled, { name: 'AbortError' });
  const first = source.window(10, 13);
  const second = source.window(10, 13);
  controller.abort();
  await rejected;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].signal.aborted, false);
  gate.resolve();
  assert.equal(await first, await second);
  assert.equal(source.debug().fetched, 1);
});

test('aborted PCM fetch and body completions never update stats or cache', async t => {
  for (const stage of ['fetch', 'body']) {
    const gate = deferred();
    const server = rangeServer();
    let hold = true;
    const { source, buffers } = fixture(t, {}, { ...server, fetchImpl: async (...args) => {
      const response = await server.fetchImpl(...args);
      if (hold && stage === 'fetch') await gate.promise;
      if (hold && stage === 'body') {
        const read = response.arrayBuffer;
        response.arrayBuffer = async () => { await gate.promise; return read(); };
      }
      return response;
    } });
    const controller = new AbortController();
    const pending = source.window(10, 13, controller.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await flush();
    controller.abort();
    await rejected;
    assert.equal(server.requests[0].signal.aborted, true);
    gate.resolve();
    await flush();
    assert.deepEqual(source.debug(), { fetched: 0, bytes: 0, cacheBytes: 0, evicted: 0, late: 0, failed: 0 });
    assert.equal(buffers.length, 0);
    hold = false;
    const fresh = await source.window(10, 13);
    assert.equal(server.requests.length, 2, 'aborted response did not populate cache');
    assert.deepEqual(fresh.getChannelData(0), expectedSamples(10 * sampleRate, 3 * sampleRate));
  }
});

test('1 MiB PCM LRU evicts old windows, protects pins and refetches identical audio', async t => {
  const { source, requests } = fixture(t, { cacheBytes: 1024 * 1024 });
  const unpin = source.pin(0, 3);
  const pinned = await source.window(0, 3);
  const old = await source.window(3, 6);
  await source.window(6, 9);
  await source.window(9, 12);
  assert.equal(source.debug().evicted, 1);
  assert.equal(source.debug().cacheBytes, 3 * 3 * sampleRate * 4);
  assert.equal(await source.window(0, 3), pinned);
  assert.equal(requests.length, 4);
  const fresh = await source.window(3, 6);
  assert.notEqual(fresh, old);
  assert.deepEqual(fresh.getChannelData(0), old.getChannelData(0));
  assert.equal(requests.length, 5);
  assert.equal(source.debug().evicted, 2);
  unpin();
  await source.window(12, 15);
  assert.ok(source.debug().cacheBytes <= 1024 * 1024);
});
