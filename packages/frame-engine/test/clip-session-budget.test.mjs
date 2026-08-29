import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateLoadBudgetMs,
  RetainedSourceBytes,
} from '../dist/decode/source-bytes.js';
import { TimeoutError } from '../dist/decode/guard.js';

async function consume(stream) {
  let bytes = 0;
  for await (const chunk of stream) bytes += chunk.byteLength;
  return bytes;
}

test('retained source fetches a URL once and replays the completed Blob', async () => {
  let calls = 0;
  const source = new RetainedSourceBytes('/source.mp4', {
    fetchImpl: async () => {
      calls += 1;
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { 'content-length': '4' },
      });
    },
  });
  const first = await source.open();
  assert.equal(first.totalBytes, 4);
  assert.equal(await consume(first.stream), 4);
  const second = await source.open();
  assert.equal(await consume(second.stream), 4);
  assert.equal(calls, 1);
  assert.equal(source.getFetchCount(), 1);
});

test('default fetch is invoked with globalThis as its receiver', async () => {
  const previous = globalThis.fetch;
  let receiver;
  globalThis.fetch = function () {
    receiver = this;
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
  };
  try {
    const source = new RetainedSourceBytes('/receiver.mp4');
    assert.equal(await consume((await source.open()).stream), 3);
    assert.equal(receiver, globalThis);
  } finally {
    globalThis.fetch = previous;
  }
});

test('a cancelled first consumer still reopens the fully retained response without refetching', async () => {
  let calls = 0;
  const source = new RetainedSourceBytes('/interrupted.mp4', {
    fetchImpl: async () => {
      calls += 1;
      return new Response(new Uint8Array([1, 2, 3, 4, 5, 6]));
    },
  });
  const first = await source.open();
  const reader = first.stream.getReader();
  assert.equal((await reader.read()).done, false);
  await reader.cancel('simulated decoder failure');
  assert.equal(await consume((await source.open()).stream), 6);
  assert.equal(calls, 1);
  assert.equal(source.getFetchCount(), 1);
});

test('load budget is max(10s, bytes / 8 MiB/s)', () => {
  assert.equal(calculateLoadBudgetMs(1), 10_000);
  assert.equal(calculateLoadBudgetMs(80 * 1024 * 1024), 10_000);
  assert.equal(calculateLoadBudgetMs(160 * 1024 * 1024), 20_000);
  assert.equal(calculateLoadBudgetMs(null), 10_000);
});

test('retain budget overflow allows exactly one warned refetch', async () => {
  const warnings = [];
  let calls = 0;
  const source = new RetainedSourceBytes('/large.mp4', {
    retainBudgetBytes: 3,
    onWarning: warning => warnings.push(warning),
    fetchImpl: async () => {
      calls += 1;
      return new Response(new Uint8Array([1, 2, 3, 4, 5, 6]));
    },
  });
  assert.equal(await consume((await source.open()).stream), 6);
  assert.equal(source.isRetentionDisabled(), true);
  assert.equal(warnings.length, 1);
  assert.equal(await consume((await source.open()).stream), 6);
  assert.equal(calls, 2);
  assert.equal(source.getFetchCount(), 2);
  await assert.rejects(source.open(), /falling back to proxy is recommended/u);
  assert.equal(calls, 2);
  assert.match(warnings.join('\n'), /refetching once/u);
});

test('network body stall is budgeted and cancels the reader', async () => {
  let cancelled = false;
  const source = new RetainedSourceBytes('/stalled.mp4', {
    loadBudgetMs: 20,
    loadStallMs: 30,
    fetchImpl: async () => new Response(new ReadableStream({
      cancel() { cancelled = true; },
    })),
  });
  await assert.rejects(source.open(), TimeoutError);
  assert.equal(cancelled, true);
  assert.equal(source.getFetchCount(), 1);
});
