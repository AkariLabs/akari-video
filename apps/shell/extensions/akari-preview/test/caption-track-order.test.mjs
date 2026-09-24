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

test('袋形の字幕トラックを宣言済みとして解決する', () => {
    const result = resolvePreviewCaptionTrackOrder([
        { id: 'v-main' },
        {
            id: 'caption-bag',
            items: [
                { source: { kind: 'html' } },
                { source: { kind: 'captions' } }
            ]
        },
        { id: 'v-front' }
    ], true);
    assert.deepEqual(result.tracks.map(track => track.id), ['v-main', 'caption-bag', 'v-front']);
    assert.equal(result.captionTrackId, 'caption-bag');
});

test('字幕が無ければ未宣言トラックを補完しない', () => {
    const result = resolvePreviewCaptionTrackOrder([{ id: 'v-main' }], false);
    assert.deepEqual(result, { tracks: [{ id: 'v-main', z: 0 }] });
});

test('段直下の caption item だけなら従来の暗黙字幕段を使う', () => {
    const result = resolvePreviewCaptionTrackOrder([
        { id: 'visual', items: [{ source: { kind: 'caption' } }] }
    ], true);
    assert.equal(result.captionTrackId, 't-captions-implied');
    assert.deepEqual(result.tracks, [
        { id: 'visual', z: 0 }, { id: 't-captions-implied', z: 1 }
    ]);
});

test('group の子の caption item は親の段を使う', () => {
    const result = resolvePreviewCaptionTrackOrder([
        { id: 'back' },
        { id: 'canvas', items: [{ source: { kind: 'group' }, items: [
            { source: { kind: 'group' }, items: [{ source: { kind: 'caption' } }] }
        ] }] }
    ], true);
    assert.equal(result.captionTrackId, 'canvas');
    assert.deepEqual(result.tracks.map(track => track.z), [0, 1]);
});
