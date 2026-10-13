import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CAPTION_FRAGMENT_BREAKS_STORAGE_KEY,
    captionFragmentBlocks,
    groupCaptionDisplayCues,
    loadCaptionDisplayCueGroups,
    readCaptionFragmentBreaksVisible,
    renderAfterCaptionStateChange,
    remapCaptionSelection,
    sameCaptionDisplayCueGroups,
    shouldInvalidateVisualForPath,
    shouldReloadCaptions,
    writeCaptionFragmentBreaksVisible
} from '../lib/common/caption-track-layout.js';

test('字幕と編集の保存通知は汎用ビジュアル再描画を起こさない', () => {
    const edit = '/project/edit.json';
    const captions = '/project/captions.json';
    for (const path of [edit, captions, '/project/.akari/history/1.json',
        '/project/.akari/lint.json', '/project/assets/.image.json.tmp']) {
        assert.equal(shouldInvalidateVisualForPath(path, edit, captions), false, path);
    }
    assert.equal(shouldInvalidateVisualForPath('/project/assets/cover.png', edit, captions), true);
});

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

test("区切り表示は 'true' / 'false' を保存し、保存失敗を描画から隔離する", () => {
    const writes = [];
    writeCaptionFragmentBreaksVisible({ setItem: (key, value) => writes.push([key, value]) }, false);
    writeCaptionFragmentBreaksVisible({ setItem: (key, value) => writes.push([key, value]) }, true);
    assert.deepEqual(writes, [
        [CAPTION_FRAGMENT_BREAKS_STORAGE_KEY, 'false'],
        [CAPTION_FRAGMENT_BREAKS_STORAGE_KEY, 'true']
    ]);
    assert.doesNotThrow(() => writeCaptionFragmentBreaksVisible({
        setItem: () => { throw new Error('blocked'); }
    }, false));
    assert.doesNotThrow(() => writeCaptionFragmentBreaksVisible(undefined, true));
});

test('表示断片の RPC を待たずに描き、結果が違うときだけ再描画する', async () => {
    const order = [];
    let finish;
    const pending = renderAfterCaptionStateChange(
        () => order.push('render'),
        () => {
            order.push('resolve');
            return new Promise(resolve => { finish = changed => { order.push('resolved'); resolve(changed); }; });
        },
        () => true
    );
    assert.deepEqual(order, ['render', 'resolve']);
    finish(false);
    await pending;
    assert.deepEqual(order, ['render', 'resolve', 'resolved']);
    await renderAfterCaptionStateChange(() => order.push('render'), async () => true);
    assert.deepEqual(order.slice(-2), ['render', 'render']);
});

test('追い越しと styleOnly でも最後の状態を描く', async () => {
    let release;
    let current = true;
    let scheduled = 0;
    const first = renderAfterCaptionStateChange(() => { scheduled++; },
        () => new Promise(resolve => { release = resolve; }), () => current);
    current = false;
    await renderAfterCaptionStateChange(() => { scheduled++; });
    release(true);
    await first;
    assert.equal(scheduled, 2);
});

test('表示 cue の同一内容を見分ける', () => {
    const first = new Map([['c1', [{ text: '同じ', start: 0, end: 1 }]]]);
    const same = new Map([['c1', [{ text: '同じ', start: 0, end: 1 }]]]);
    const changed = new Map([['c1', [{ text: '変更', start: 0, end: 1 }]]]);
    assert.equal(sameCaptionDisplayCueGroups(first, same), true);
    assert.equal(sameCaptionDisplayCueGroups(first, changed), false);
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
