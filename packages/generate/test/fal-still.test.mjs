import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { falStillEstimate, falStillRequest, falStillFetch, generateFalStill } from '../src/cli/fal-still.mjs';

test('all eight aspects map to supported fal image sizes and edit uses image_urls', () => {
  const expected = {
    '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '1:1': 'square_hd',
    '4:3': 'landscape_4_3', '3:4': 'portrait_4_3', '4:5': { width: 1024, height: 1280 },
    '3:2': { width: 1536, height: 1024 }, '21:9': { width: 2016, height: 864 },
  };
  for (const [aspect, image_size] of Object.entries(expected)) {
    const request = falStillRequest({ prompt: 'hello', aspect });
    assert.deepEqual(request.body.image_size, image_size);
    assert.equal(request.body.quality, 'high');
    assert.match(request.endpoint, /flare\/text-to-image$/);
  }
  const edit = falStillRequest({ prompt: 'edit', aspect: '1:1', quality: 'medium', referenceImages: ['data:image/png;base64,abc'] });
  assert.match(edit.endpoint, /flare\/edit$/);
  assert.equal(edit.body.quality, 'medium');
  assert.deepEqual(edit.body.image_urls, ['data:image/png;base64,abc']);
  assert.deepEqual(falStillEstimate('high'), { usd: 0.0528, asOf: '2026-09-26' });
});

test('queue flow uses only the loopback stub and writes its PNG', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-fal-still-test-'));
  const dest = join(dir, 'image.png');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options?.method ?? 'GET' });
    const pathname = new URL(url).pathname;
    if (pathname.includes('/status/')) return Response.json({ status: 'COMPLETED' });
    if (pathname.includes('/response/')) return Response.json({ images: [{ url: 'http://127.0.0.1:7777/image.png' }] });
    if (pathname.endsWith('/image.png')) return new Response(png);
    return Response.json({ request_id: 'stub-1', status_url: 'http://127.0.0.1:7777/status/1', response_url: 'http://127.0.0.1:7777/response/1' });
  };
  try {
    await generateFalStill({ prompt: 'hello', aspect: '1:1', dest, key: 'stub-key',
      env: { AKARI_FAL_STUB_URL: 'http://127.0.0.1:7777' }, fetchImpl, pollIntervalMs: 0 });
    assert.deepEqual(await readFile(dest), png);
    assert.equal(calls.length, 4);
    assert(calls.every(call => new URL(call.url).origin === 'http://127.0.0.1:7777'));
    assert.equal(calls[0].method, 'POST');
    assert.throws(() => falStillFetch({ fetchImpl, env: { AKARI_FAL_STUB_URL: 'http://127.0.0.1:7777' } })('https://example.com/secret'), /スタブ以外/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
