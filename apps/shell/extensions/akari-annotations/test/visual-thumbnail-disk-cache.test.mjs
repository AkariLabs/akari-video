import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { isVisualThumbnailDiskEntry, pruneThumbnailIndex, visualThumbnailCacheFileName } from '../lib/common/visual-thumbnail-disk-cache.js';

test('cache filenames match SHA-1 UTF-8 including padding boundaries and Unicode keys', () => {
  for (const key of ['', 'abc', 'テロップ🎬', '\ud800', ...[55, 56, 63, 64, 65, 1000].map(n => 'a'.repeat(n))]) {
    assert.equal(visualThumbnailCacheFileName(key), createHash('sha1').update(key).digest('hex') + '.json');
  }
});

test('pruning meets both limits in capture order without mutating the index', () => {
  const entries = [{ fileName: 'new', capturedAt: 30, size: 7 }, { fileName: 'old', capturedAt: 10, size: 3 },
    { fileName: 'middle', capturedAt: 20, size: 5 }];
  const before = structuredClone(entries);
  assert.deepEqual(pruneThumbnailIndex(entries, { maxFiles: 2, maxBytes: 100 }), ['old']);
  assert.deepEqual(pruneThumbnailIndex(entries, { maxFiles: 3, maxBytes: 7 }), ['old', 'middle']);
  assert.deepEqual(pruneThumbnailIndex(entries, { maxFiles: 0, maxBytes: 0 }), ['old', 'middle', 'new']);
  assert.deepEqual(pruneThumbnailIndex(entries), []);
  assert.deepEqual(entries, before);
  assert.equal(pruneThumbnailIndex(Array.from({ length: 401 }, (_, i) => ({ fileName: String(i), capturedAt: i, size: 1 }))).length, 1);
  assert.deepEqual(pruneThumbnailIndex([{ fileName: 'huge', capturedAt: 0, size: 64 * 1024 * 1024 + 1 }]), ['huge']);
});

test('disk entries reject malformed images, rectangles and dependency metadata', () => {
  const entry = { key: 'key', sourceKey: 'source', dependencyRevision: 0, capturedAt: 1, image: 'data:image/png;base64,YQ==',
    croppedImage: 'data:image/png;base64,Yg==', contentRect: { x: 0, y: 0, width: 10, height: 20 },
    dependencies: [{ uri: 'file:///project/title.html', mtime: 1, size: 10 }] };
  assert.ok(isVisualThumbnailDiskEntry(entry));
  for (const patch of [{ image: 'https://example.com' }, { croppedImage: {} }, { contentRect: null },
    { contentRect: { x: 0, y: 0, width: -1, height: 10 } }, { dependencies: [null] }, { capturedAt: NaN },
    { dependencyRevision: -1 }, { dependencies: [{}] }]) assert.equal(isVisualThumbnailDiskEntry({ ...entry, ...patch }), false);
});
