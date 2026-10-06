import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mixOrder, sha256 } from '../lib/common/asset-mix-order.js';
import { labAssetUrl, mergeAssetCatalogViews } from '../lib/common/asset-catalog-view.js';
import { rankLibraryShelfItems, rankRecentLibraryItems } from '../lib/common/library-source-view.js';

// 取り決めの試験ベクタ 5 本。
const vectors = [
    { count: 20, free: [0,1,2,3,4,5,6,7,8,9], expected: [0,1,8,9,6,10,4,7,13,19,16,2,15,18,5,14,3,17,11,12] },
    { count: 20, free: [5,17], expected: [0,1,8,9,6,10,4,7,13,19,5,17,16,2,15,18,14,3,11,12] },
    { count: 15, free: [], expected: [0,1,8,9,6,10,4,7,13,2,5,14,3,11,12] },
    { count: 5, free: [0,1,2,3,4], expected: [0,1,4,2,3] },
    { count: 30, free: [3,11,22,29], expected: [0,24,1,8,23,28,9,6,10,3,29,22,4,7,13,19,16,2,21,15,18,26,20,5,14,17,27,25,11,12] }
];
const id = n => `vec-${String(n).padStart(2, '0')}`;
const items = vector => Array.from({ length: vector.count }, (_, n) => ({
    category: 'overlay', id: id(n), key: `overlay/${id(n)}`, title: id(n), tags: [],
    tier: vector.free.includes(n) ? 'free' : 'pro'
}));

for (const [index, vector] of vectors.entries()) {
    test(`mixOrder vector ${index + 1}`, () => {
        const input = items(vector);
        assert.deepEqual(mixOrder(input, { screen: 12, minFree: 3 }).map(item => item.id), vector.expected.map(id));
        assert.deepEqual(input.map(item => item.id), Array.from({ length: vector.count }, (_, n) => id(n)));
    });
}

test('sha256 matches Node for UTF-8 and SHA block boundaries', () => {
    for (const value of ['', 'overlay/one', '日本語', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), '長'.repeat(80)]) {
        assert.equal(sha256(value), createHash('sha256').update(value, 'utf8').digest('hex'), value);
    }
});

test('mergeAssetCatalogViews uses the mixed order', () => {
    const input = items(vectors[0]);
    assert.deepEqual(mergeAssetCatalogViews([], input).map(item => item.id), vectors[0].expected.map(id));
});

test('library ranking uses mixed order only for otherwise equal items', () => {
    const ordered = mixOrder(items(vectors[0]));
    const ranked = rankLibraryShelfItems(items(vectors[0]));
    assert.deepEqual(ranked.map(item => item.id), ordered.map(item => item.id));
    const favorite = { ...ordered.at(-1), favorite: true };
    assert.equal(rankLibraryShelfItems([...ordered.slice(0, -1), favorite])[0].id, favorite.id);
    assert.deepEqual(rankRecentLibraryItems(ordered).map(item => item.key),
        [...ordered].map(item => item.key).sort((a, b) => a.localeCompare(b)));
});

test('Lab URL uses a single asset page unless a legacy product ID exists', () => {
    assert.equal(labAssetUrl(undefined, { category: 'overlay', id: 'telop-base-cue-card-hands' }),
        'https://akari.video/lab/viewer#overlay/telop-base-cue-card-hands');
    assert.equal(labAssetUrl(undefined, { category: 'text style', id: 'a/b', product_id: '' }),
        'https://akari.video/lab/viewer#text%20style/a%2Fb');
    assert.equal(labAssetUrl(undefined, { category: 'overlay', id: 'card', product_id: 'old pack' }),
        'https://akari.video/lab/asset.html?' + 'id=old%20pack');
});
