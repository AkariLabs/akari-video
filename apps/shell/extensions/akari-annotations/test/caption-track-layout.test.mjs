import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CAPTION_FRAGMENT_BREAKS_STORAGE_KEY,
    captionFragmentTicks,
    readCaptionFragmentBreaksVisible,
    remapCaptionSelection,
    shouldReloadCaptions
} from '../lib/common/caption-track-layout.js';

test('断片の内側境界を字幕幅に対する位置へ変換する', () => {
    assert.deepEqual(captionFragmentTicks({
        start: 10,
        end: 14,
        text: 'abcd',
        display_fragments: ['a', 'bc', 'd']
    }), [
        { index: 1, position: 0.25, seconds: 11 },
        { index: 2, position: 0.75, seconds: 13 }
    ]);
    assert.deepEqual(captionFragmentTicks({
        start: 1, end: 1, text: 'ab', display_fragments: ['a', 'b']
    }), []);
    assert.deepEqual(captionFragmentTicks({
        start: 1, end: 2, text: 'ab', display_fragments: ['ab']
    }), []);
});

test('語時刻が使える断片境界は source 秒を保ち、重複境界を除く', () => {
    assert.deepEqual(captionFragmentTicks({
        start: 0,
        end: 3,
        text: 'abc',
        display_fragments: ['a', 'b', 'c'],
        words: [
            { text: 'a', start: 0, end: 1 },
            { text: 'b', start: 1, end: 1 },
            { text: 'c', start: 1, end: 3 }
        ]
    }), [{ index: 1, position: 1 / 3, seconds: 1 }]);
});

test("区切り表示は既定 ON で、文字列 'false' のときだけ OFF", () => {
    assert.equal(readCaptionFragmentBreaksVisible(), true);
    assert.equal(readCaptionFragmentBreaksVisible({ getItem: () => null }), true);
    assert.equal(readCaptionFragmentBreaksVisible({ getItem: key => {
        assert.equal(key, CAPTION_FRAGMENT_BREAKS_STORAGE_KEY);
        return 'false';
    } }), false);
    assert.equal(readCaptionFragmentBreaksVisible({ getItem: () => 'FALSE' }), true);
    assert.equal(readCaptionFragmentBreaksVisible({ getItem: () => { throw new Error('blocked'); } }), true);
});

test('選択は残存 id を維持し、結合先へ寄せて重複を除く', () => {
    const previous = [
        { id: 'a', start: 0, end: 2 },
        { id: 'b', start: 2, end: 4 },
        { id: 'keep', start: 5, end: 6 }
    ];
    const next = [
        { id: 'merged', start: 0, end: 4 },
        { id: 'keep', start: 5, end: 6 }
    ];
    assert.deepEqual(remapCaptionSelection(previous, next, ['b', 'keep', 'a', 'b']), ['merged', 'keep']);
});

test('分割では重なり最大の先頭候補へ寄せ、重なりゼロは落とす', () => {
    assert.deepEqual(remapCaptionSelection(
        [{ id: 'old', start: 0, end: 4 }, { id: 'gone', start: 8, end: 9 }],
        [{ id: 'left', start: 0, end: 2 }, { id: 'right', start: 2, end: 4 }],
        ['old', 'gone']
    ), ['left']);
});

test('本文の同一バイトだけ reload を省く', () => {
    assert.equal(shouldReloadCaptions(undefined, undefined), true);
    assert.equal(shouldReloadCaptions('same', 'same'), false);
    assert.equal(shouldReloadCaptions('same', 'different'), true);
    assert.equal(shouldReloadCaptions(undefined, 'source'), true);
});
