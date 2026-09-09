import assert from 'node:assert/strict';
import test from 'node:test';
import { VisualThumbnailCache } from '../lib/common/visual-thumbnail-cache.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const job = (key, capture, priority = 0) => ({ key, priority, wanted: () => true, capture });
const until = async (predicate, timeout = 7000) => {
  const end = Date.now() + timeout;
  while (!predicate()) { assert.ok(Date.now() < end, 'deadline'); await wait(20); }
};

test('duplicate requests share one flight and cache hits return synchronously', async t => {
  const cache = new VisualThumbnailCache(() => {});
  t.after(() => cache.dispose());
  const value = { image: 'single-flight pixels' };
  let calls = 0; let release;
  const entry = job('single', () => {
    calls++;
    return new Promise(resolve => { release = resolve; });
  });
  assert.equal(cache.request(entry), undefined);
  assert.equal(cache.request(entry), undefined);
  assert.equal(cache.queued, 1);
  await until(() => release);
  assert.equal(cache.request(entry), undefined);
  assert.equal(cache.queued, 0);
  release(value);
  await until(() => cache.stats.captures === 1);
  const hits = cache.stats.hits;
  assert.equal(cache.request(entry), value);
  assert.equal(cache.stats.hits, hits + 1);
  await wait(140);
  assert.equal(calls, 1);
});

test('queued work is discarded when it is no longer wanted', async t => {
  const cache = new VisualThumbnailCache(() => {});
  t.after(() => cache.dispose());
  let wanted = true; let calls = 0;
  cache.setPaused(true);
  cache.request({
    ...job('gone', async () => { calls++; return { image: 'unwanted' }; }),
    wanted: () => wanted
  });
  assert.equal(cache.queued, 1);
  wanted = false;
  cache.setPaused(false);
  await until(() => cache.queued === 0);
  assert.equal(calls, 0);
  assert.equal(cache.stats.captures, 0);
  assert.equal(cache.size, 0);
});

test('memory accounts for full and cropped image strings plus the decoded bitmap', async t => {
  const cache = new VisualThumbnailCache(() => {});
  t.after(() => cache.dispose());
  const key = 'crop-accounting';
  const value = { image: 'full image', croppedImage: 'cropped image' };
  const entry = job(key, async () => value);
  cache.request(entry);
  await until(() => cache.stats.captures === 1);
  assert.equal(cache.request(entry), value);
  assert.equal(cache.memoryBytes,
    key.length * 2 + (value.image.length + value.croppedImage.length) * 2 + 480 * 320 * 4);
});

test('exceeding maxEntries evicts the least recently used entry', async t => {
  const cache = new VisualThumbnailCache(() => {}, 2);
  t.after(() => cache.dispose());
  let visible = true;
  const a = { ...job('a', async () => ({ image: 'a' })), wanted: () => visible };
  const b = { ...job('b', async () => ({ image: 'b' })), wanted: () => visible };
  const c = job('c', async () => ({ image: 'c' }));
  cache.request(a);
  await until(() => cache.stats.captures === 1);
  cache.request(b);
  await until(() => cache.stats.captures === 2);
  assert.deepEqual(cache.request(a), { image: 'a' });
  // Unpin the cached entries so the visible-image guard permits another capture.
  visible = false;
  cache.request(c);
  await until(() => cache.stats.captures === 3);
  assert.equal(cache.size, 2);
  cache.setPaused(true);
  assert.deepEqual(cache.request(a), { image: 'a' });
  assert.deepEqual(cache.request(c), { image: 'c' });
  assert.equal(cache.request(b), undefined);
  assert.equal(cache.queued, 1);
});
