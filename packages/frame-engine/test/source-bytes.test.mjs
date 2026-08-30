import assert from 'node:assert/strict';
import test from 'node:test';

import { RetainedSourceBytes } from '../dist/decode/source-bytes.js';

async function bytesOf(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(...chunk);
  return chunks;
}

test('every open replays the same complete retained bytes after one fetch', async () => {
  const expected = [1, 3, 5, 7, 9];
  const source = new RetainedSourceBytes('/complete.mp4', {
    fetchImpl: async () => new Response(new Uint8Array(expected), {
      headers: { 'content-length': String(expected.length) },
    }),
  });

  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(await bytesOf((await source.open()).stream), expected);
  }
  assert.equal(source.getFetchCount(), 1);
});

test('concurrent opens await one fill and all replay complete bytes', async () => {
  const expected = [2, 4, 6, 8];
  let release;
  const body = new ReadableStream({
    start(controller) {
      release = () => {
        controller.enqueue(new Uint8Array(expected));
        controller.close();
      };
    },
  });
  const source = new RetainedSourceBytes('/concurrent.mp4', {
    fetchImpl: async () => new Response(body, {
      headers: { 'content-length': String(expected.length) },
    }),
  });

  const opens = [source.open(), source.open(), source.open()];
  release();
  const opened = await Promise.all(opens);
  assert.deepEqual(await Promise.all(opened.map(value => bytesOf(value.stream))), [
    expected,
    expected,
    expected,
  ]);
  assert.equal(source.getFetchCount(), 1);
});

test('truncated content-length rejects without retaining a partial Blob', async () => {
  const warnings = [];
  const source = new RetainedSourceBytes('/truncated.mp4', {
    onWarning: warning => warnings.push(warning),
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-length': '5' },
    }),
  });

  await assert.rejects(source.open(), /does not match content-length/u);
  await assert.rejects(source.open(), /retained source bytes are unavailable/u);
  assert.equal(source.getFetchCount(), 1);
  assert.match(warnings.join('\n'), /does not match content-length/u);
});
