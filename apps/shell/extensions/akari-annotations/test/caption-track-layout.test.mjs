import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CAPTION_FRAGMENT_BREAKS_STORAGE_KEY,
    captionFragmentBlocks,
    groupCaptionDisplayCues,
    loadCaptionDisplayCueGroups,
    readCaptionFragmentBreaksVisible,
    remapCaptionSelection,
    shouldReloadCaptions
} from '../lib/common/caption-track-layout.js';

test('解決 cue を source_cue_id ごとにまとめて時刻順に並べる', () => {
    const grouped = groupCaptionDisplayCues([
        { source_cue_id: 'b', start: 4, end: 5, text: 'B' },
        { source_cue_id: 'a', start: 2, end: 4, text: '後', fragment_index: 1 },
        { source_cue_id: 'a', start: 0, end: 2, text: '前', fragment_index: 0 }
    ]);
    assert.deepEqual([...grouped.keys()], ['b', 'a']);
    assert.deepEqual(grouped.get('a')?.map(cue => cue.text), ['前', '後']);
});

test('cue 時刻を行内比率の断片ブロックへ変換する', () => {
    assert.deepEqual(captionFragmentBlocks([
        { source_cue_id: 'a', start: 10, end: 11, text: 'a', fragment_index: 0 },
        { source_cue_id: 'a', start: 11, end: 13, text: 'bc', fragment_index: 1,
            display_lines: ['b', 'c'] },
        { source_cue_id: 'a', start: 13, end: 14, text: 'd', fragment_index: 2 }
    ]), [
        { index: 0, left: 0, width: 0.25, text: 'a', folded: false },
        { index: 1, left: 0.25, width: 0.5, text: 'bc', folded: true },
        { index: 2, left: 0.75, width: 0.25, text: 'd', folded: false }
    ]);
    assert.deepEqual(captionFragmentBlocks([
        { source_cue_id: 'a', start: 1, end: 2, text: 'ab', fragment_count: 2 }
    ]), []);
});

test('解決失敗は空の cue 表へ fail-open する', async () => {
    let warnings = 0;
    const groups = await loadCaptionDisplayCueGroups(async () => {
        throw new Error('offline');
    }, () => { warnings += 1; });
    assert.equal(groups.size, 0);
    assert.equal(warnings, 1);

    const nullGroups = await loadCaptionDisplayCueGroups(async () => null, () => { warnings += 1; });
    assert.equal(nullGroups.size, 0);
    assert.equal(warnings, 2);
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
