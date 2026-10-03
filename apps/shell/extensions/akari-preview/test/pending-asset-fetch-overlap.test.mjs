import assert from 'node:assert/strict';
import test from 'node:test';
import { PendingAssetFetchStore } from '../lib/common/pending-asset-fetch.js';

test('同じ参照の取り寄せが重なる間は最後の end まで表示する', () => {
    const store = new PendingAssetFetchStore();
    const entry = { relativePath: 'assets/still/shared/photo.png', kind: 'image' };
    store.begin(entry);
    store.begin(entry);
    store.end(entry.relativePath);
    assert.equal(store.has(entry.relativePath), true);
    store.end(entry.relativePath);
    assert.equal(store.has(entry.relativePath), false);
});
