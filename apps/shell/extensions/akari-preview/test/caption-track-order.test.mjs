import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePreviewCaptionTrackOrder, resolvePreviewItemStackOrder } from '../lib/common/caption-track-order.js';

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

test('group 字幕の描画 z は段と子の宣言順で写真より上・後続 HTML より下', () => {
    const result = resolvePreviewItemStackOrder([
        { id: 'visual', items: [
            { id: 'before', source: { kind: 'media' } },
            { id: 'canvas', source: { kind: 'group' }, items: [
                { id: 'photo', source: { kind: 'media' } },
                { id: 'caption-line', source: { kind: 'caption' } },
                { id: 'html-card', source: { kind: 'html' } }
            ] },
            { id: 'after', source: { kind: 'media' } }
        ] },
        { id: 'upper', items: [{ id: 'top', source: { kind: 'media' } }] }
    ]);
    assert.ok(result);
    const z = result.itemStackZ;
    assert.ok(z.before < z.photo && z.photo < z['caption-line']);
    assert.ok(z['caption-line'] < z['html-card'] && z['html-card'] < z.after);
    assert.ok(z.after < result.trackStackZ.upper && result.trackStackZ.upper < z.top);
});

test('段直下だけの字幕・メディアでは z の細分化をしない', () => {
    assert.equal(resolvePreviewItemStackOrder([
        { id: 'visual', items: [{ id: 'photo', source: { kind: 'media' } },
            { id: 'caption-line', source: { kind: 'caption' } }] },
        { id: 'captions', items: [{ id: 'bag', source: { kind: 'captions' } }] }
    ]), undefined);
});

test('group 内の captions 袋の行も袋の位置に重ねる', () => {
    const result = resolvePreviewItemStackOrder([{ id: 'visual', items: [
        { id: 'canvas', source: { kind: 'group' }, items: [
            { id: 'photo', source: { kind: 'media' } },
            { id: 'bag', source: { kind: 'captions' } },
            { id: 'html', source: { kind: 'html' } }
        ] }
    ] }]);
    assert.ok(result.itemStackZ.photo < result.itemStackZ.bag);
    assert.ok(result.itemStackZ.bag < result.itemStackZ.html);
});
