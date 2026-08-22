import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePreviewCaptionTrackOrder } from '../lib/common/caption-track-order.js';

test('字幕トラック未宣言ならタイムラインと同じく表示専用の最上段へ補完する', () => {
    const result = resolvePreviewCaptionTrackOrder([
        { id: 'v-main' },
        { id: 'v-overlay' },
        { id: 'v-telop' }
    ], true);
    assert.deepEqual(result.tracks, [
        { id: 'v-main', z: 0 },
        { id: 'v-overlay', z: 1 },
        { id: 'v-telop', z: 2 },
        { id: 't-captions-implied', z: 3 }
    ]);
    assert.equal(result.captionTrackId, 't-captions-implied');
});

test('宣言済み字幕トラックの位置と ID は変更しない', () => {
    const result = resolvePreviewCaptionTrackOrder([
        { id: 'v-main' },
        { id: 'captions', content: { from: 'captions.json' } },
        { id: 'v-front' }
    ], true);
    assert.deepEqual(result.tracks.map(track => track.id), ['v-main', 'captions', 'v-front']);
    assert.equal(result.captionTrackId, 'captions');
});

test('字幕が無ければ未宣言トラックを補完しない', () => {
    const result = resolvePreviewCaptionTrackOrder([{ id: 'v-main' }], false);
    assert.deepEqual(result, { tracks: [{ id: 'v-main', z: 0 }] });
});
