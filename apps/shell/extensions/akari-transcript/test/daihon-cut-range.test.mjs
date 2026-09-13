import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
    CUT_RANGE_MAGNET_TOL_SEC,
    CUT_RANGE_MIN_SEC,
    CUT_RANGE_NEIGHBOR_PAD_SEC,
    CUT_RANGE_PAD_SEC,
    CUT_RANGE_TICK_SEC,
    CUT_RANGE_WINDOW_MIN_SEC,
    CUT_RANGE_ZOOM_MAX_SEC,
    CUT_RANGE_ZOOM_MIN_SEC,
    clampCutRange,
    cutRangeBounds,
    cutRangeMagnets,
    cutRangeIsSpeech,
    cutRangeNeighborWords,
    cutRangePreviewSpans,
    cutRangeRatio,
    cutRangeReadout,
    cutRangeTicks,
    cutRangeTime,
    cutRangeWaveWindow,
    cutRangeWindow,
    cutRangeWindowBounds,
    cutRangeWordIntrusion,
    cutRangeWordBands,
    cutRangeZoomSpan,
    defaultCutRange,
    moveCutRangeEdge,
    resampleCutRangePeaks,
    snapToMagnet
} from '../lib/common/daihon-cut-range.js';

const silence = { kind: 'silence', start: 1, end: 2, limitStart: 0.5, limitEnd: 2.5 };
const word = { kind: 'word', start: 1.2, end: 1.65, limitStart: 1, limitEnd: 2 };

test('範囲の余白は 0.4 秒', () => assert.equal(CUT_RANGE_PAD_SEC, 0.4));
test('近傍語の余白は 0.5 秒', () => assert.equal(CUT_RANGE_NEIGHBOR_PAD_SEC, 0.5));
test('自然窓の最低幅は 4 秒', () => assert.equal(CUT_RANGE_WINDOW_MIN_SEC, 4));
test('ズーム範囲は 2〜12 秒', () => assert.deepEqual([CUT_RANGE_ZOOM_MIN_SEC, CUT_RANGE_ZOOM_MAX_SEC], [2, 12]));
test('目盛り間隔は 0.5 秒', () => assert.equal(CUT_RANGE_TICK_SEC, 0.5));
test('最小カット幅は 0.05 秒', () => assert.equal(CUT_RANGE_MIN_SEC, 0.05));
test('磁石の許容距離は 0.08 秒', () => assert.equal(CUT_RANGE_MAGNET_TOL_SEC, 0.08));
test('可動域は窓全体で、狭い窓は最小幅を保証する', () => {
    assert.deepEqual(cutRangeWindowBounds({ start: 1, end: 2 }), { lo: 1, hi: 2 });
    assert.deepEqual(cutRangeWindowBounds({ start: 1, end: 1.01 }), { lo: 1, hi: 1.05 });
});
test('磁石は秒順に重複を畳み、同秒は無音を優先する', () => assert.deepEqual(
    cutRangeMagnets([{ start: 2, end: 3 }], [{ text: '語', start: 1, end: 2 }]),
    [{ seconds: 1, kind: 'word' }, { seconds: 2, kind: 'silence' }, { seconds: 3, kind: 'silence' }]
));
test('磁石は最寄りへ吸着し Shift で解除する', () => {
    const magnets = [{ seconds: 2, kind: 'silence' }, { seconds: 2.1, kind: 'word' }];
    assert.deepEqual(snapToMagnet(2.04, magnets), { seconds: 2, magnet: magnets[0] });
    assert.deepEqual(snapToMagnet(2.04, magnets, 0.08, true), { seconds: 2.04, magnet: null });
});
test('語への食い込みは各語との重なりを合計する', () => assert.equal(
    cutRangeWordIntrusion({ from: 1.5, to: 3.25 }, [{ text: 'a', start: 1, end: 2 }, { text: 'b', start: 3, end: 4 }]), 0.75
));

test('無音の可動域は前後 0.4 秒へ広がる', () => assert.deepEqual(cutRangeBounds(silence), { lo: 0.6, hi: 2.4 }));
test('無音の可動域は前後の行の端で止まる', () => assert.deepEqual(
    cutRangeBounds({ ...silence, limitStart: 0.8, limitEnd: 2.2 }), { lo: 0.8, hi: 2.2 }
));
test('語の可動域は前後 0.4 秒', () => assert.deepEqual(cutRangeBounds(word), { lo: 1, hi: 2 }));
test('語の可動域の開始は行境界で止まる', () => assert.deepEqual(
    cutRangeBounds({ ...word, limitStart: 1.1 }), { lo: 1.1, hi: 2 }
));
test('語の可動域の終了は行境界で止まる', () => assert.deepEqual(
    cutRangeBounds({ ...word, limitEnd: 1.9 }), { lo: 1, hi: 1.9 }
));

test('無音の既定範囲は頭を 0.15 秒残す', () => assert.deepEqual(defaultCutRange(silence, 0.15), { from: 1.15, to: 2 }));
test('語の既定範囲は発話区間そのもの', () => assert.deepEqual(defaultCutRange(word, 0.15), { from: 1.2, to: 1.65 }));
test('残す秒数が広すぎても無音内で最小幅を確保する', () => assert.deepEqual(defaultCutRange(silence, 2), { from: 1.95, to: 2 }));
test('負の残す秒数は無音先頭に丸める', () => assert.deepEqual(defaultCutRange(silence, -1), { from: 1, to: 2 }));
test('選択範囲を可動域へ収める', () => assert.deepEqual(clampCutRange({ from: 0, to: 3 }, { lo: 1, hi: 2 }), { from: 1, to: 2 }));
test('狭すぎる選択範囲を最小幅へ広げる', () => assert.deepEqual(clampCutRange({ from: 1.5, to: 1.51 }, { lo: 1, hi: 2 }), { from: 1.5, to: 1.55 }));
test('可動域自体が最小幅未満なら全体を返す', () => assert.deepEqual(clampCutRange({ from: 1, to: 2 }, { lo: 1, hi: 1.02 }), { from: 1, to: 1.02 }));
test('開始つまみは可動域の外へ出ない', () => assert.deepEqual(moveCutRangeEdge({ from: 1.2, to: 1.8 }, 'from', 0, { lo: 1, hi: 2 }), { from: 1, to: 1.8 }));
test('開始つまみは終了つまみを越えない', () => assert.deepEqual(moveCutRangeEdge({ from: 1.2, to: 1.8 }, 'from', 2, { lo: 1, hi: 2 }), { from: 1.75, to: 1.8 }));
test('終了つまみは可動域の外へ出ない', () => assert.deepEqual(moveCutRangeEdge({ from: 1.2, to: 1.8 }, 'to', 3, { lo: 1, hi: 2 }), { from: 1.2, to: 2 }));
test('終了つまみは開始つまみを越えない', () => assert.deepEqual(moveCutRangeEdge({ from: 1.2, to: 1.8 }, 'to', 0, { lo: 1, hi: 2 }), { from: 1.2, to: 1.25 }));
test('非有限値でつまみを動かしても現状を保つ', () => assert.deepEqual(moveCutRangeEdge({ from: 1.2, to: 1.8 }, 'to', NaN, { lo: 1, hi: 2 }), { from: 1.2, to: 1.8 }));

test('近傍語は入力を時刻順へコピーソートして探す', () => assert.deepEqual(
    cutRangeNeighborWords({ ...silence, start: 3, end: 4 }, [
        { text: '次', start: 5, end: 6 }, { text: '前', start: 1, end: 2 }
    ]),
    { previous: { text: '前', start: 1, end: 2 }, next: { text: '次', start: 5, end: 6 } }
));
test('近傍語は対象と重なる語を飛ばす', () => assert.deepEqual(
    cutRangeNeighborWords({ ...silence, start: 3, end: 4 }, [
        { text: '前', start: 1, end: 2 }, { text: '対象', start: 3, end: 4 }, { text: '次', start: 5, end: 6 }
    ]),
    { previous: { text: '前', start: 1, end: 2 }, next: { text: '次', start: 5, end: 6 } }
));
test('近傍語が無ければ undefined', () => assert.deepEqual(cutRangeNeighborWords(silence, []), {}));
test('境界に接する語は近傍語になる', () => assert.deepEqual(
    cutRangeNeighborWords({ ...silence, start: 3, end: 4 }, [
        { text: '前', start: 2, end: 3 }, { text: '次', start: 4, end: 5 }
    ]),
    { previous: { text: '前', start: 2, end: 3 }, next: { text: '次', start: 4, end: 5 } }
));
test('全行相当の語を渡しても対象の直前と直後だけを近傍語に選ぶ', () => assert.deepEqual(
    cutRangeNeighborWords({ ...silence, start: 3, end: 4 }, [
        { text: '遠い前', start: 0, end: 0.5 }, { text: '直前', start: 2, end: 3 },
        { text: '直後', start: 4, end: 5 }, { text: '遠い後', start: 8, end: 9 }
    ]),
    { previous: { text: '直前', start: 2, end: 3 }, next: { text: '直後', start: 4, end: 5 } }
));
test('全行相当の語を渡しても自然窓は直前と直後の語だけで決まる', () => assert.deepEqual(
    cutRangeWindow({ kind: 'silence', start: 3, end: 4, limitStart: 2.5, limitEnd: 4.5 }, [
        { text: '遠い前', start: 0, end: 0.5 }, { text: '直前', start: 2, end: 3 },
        { text: '直後', start: 4, end: 5 }, { text: '遠い後', start: 8, end: 9 }
    ]),
    { start: 1.5, end: 5.5 }
));

test('自然窓は前の語の start − 0.5 から次の語の end + 0.5', () => assert.deepEqual(
    cutRangeWindow({ kind: 'silence', start: 3, end: 4, limitStart: 2.5, limitEnd: 4.5 }, [
        { text: '前', start: 1, end: 2 }, { text: '次', start: 5, end: 6 }
    ]), { start: 0.5, end: 6.5 }
));
test('前後語が無い自然窓は対象前後 0.5 秒から最低 4 秒へ広がる', () => assert.deepEqual(
    cutRangeWindow({ kind: 'silence', start: 3, end: 4, limitStart: 2.5, limitEnd: 4.5 }, []),
    { start: 1.5, end: 5.5 }
));
test('最低 4 秒への拡張は自然窓の中心を保つ', () => assert.deepEqual(
    cutRangeWindow({ kind: 'silence', start: 3, end: 4, limitStart: 2.5, limitEnd: 4.5 }, [
        { text: '前', start: 2, end: 2.5 }, { text: '次', start: 4.5, end: 5 }
    ]), { start: 1.5, end: 5.5 }
));
test('zoom 2 秒を対象中心に表示する', () => assert.deepEqual(
    cutRangeWindow({ kind: 'word', start: 10, end: 11, limitStart: 9, limitEnd: 12 }, [], { zoom: 2 }),
    { start: 9.5, end: 11.5 }
));
test('zoom は最小 2 秒へクランプする', () => assert.deepEqual(
    cutRangeWindow({ kind: 'word', start: 10, end: 11, limitStart: 9, limitEnd: 12 }, [], { zoom: 0.5 }),
    { start: 9.5, end: 11.5 }
));
test('zoom は最大 12 秒へクランプする', () => assert.deepEqual(
    cutRangeWindow({ kind: 'word', start: 10, end: 11, limitStart: 9, limitEnd: 12 }, [], { zoom: 20 }),
    { start: 4.5, end: 16.5 }
));
test('zoom が可動域より狭ければ窓を広げて可動域を含める', () => assert.deepEqual(
    cutRangeWindow({ kind: 'word', start: 5, end: 8, limitStart: 4, limitEnd: 9 }, [], { zoom: 2 }),
    { start: 4.6, end: 8.4 }
));
test('0 秒より前へ出る自然窓は幅を保って右へ動かす', () => assert.deepEqual(
    cutRangeWindow({ kind: 'silence', start: 0.2, end: 0.5, limitStart: 0, limitEnd: 0.9 }, []),
    { start: 0, end: 4 }
));
test('非有限 zoom は自然窓として扱う', () => assert.deepEqual(
    cutRangeWindow({ kind: 'silence', start: 3, end: 4, limitStart: 2.5, limitEnd: 4.5 }, [], { zoom: NaN }),
    { start: 1.5, end: 5.5 }
));
test('波形窓は自然窓と 12 秒窓の和集合', () => assert.deepEqual(
    cutRangeWaveWindow({ kind: 'word', start: 10, end: 11, limitStart: 9, limitEnd: 12 }, []),
    { start: 4.5, end: 16.5 }
));

test('ズームインは 1.25 で割る', () => assert.equal(cutRangeZoomSpan(10, 'in'), 8));
test('ズームアウトは 1.25 倍する', () => assert.equal(cutRangeZoomSpan(4, 'out'), 5));
test('ズームインは 2 秒で止まる', () => assert.equal(cutRangeZoomSpan(2, 'in'), 2));
test('ズームアウトは 12 秒で止まる', () => assert.equal(cutRangeZoomSpan(12, 'out'), 12));
test('ズーム幅は小数第 2 位へ丸める', () => assert.equal(cutRangeZoomSpan(3.33, 'out'), 4.16));
test('非有限ズーム幅は 4 秒に戻す', () => assert.equal(cutRangeZoomSpan(Infinity, 'in'), 4));

test('目盛りは窓内の 0.5 秒刻み', () => assert.deepEqual(
    cutRangeTicks({ start: 0.25, end: 2.25 }).map(tick => tick.seconds), [0.5, 1, 1.5, 2]
));
test('整数秒の目盛りは major かつ小数 1 桁ラベル', () => assert.deepEqual(
    cutRangeTicks({ start: 0.5, end: 1.5 }).map(({ seconds, major, label }) => ({ seconds, major, label })),
    [{ seconds: 0.5, major: false, label: '' }, { seconds: 1, major: true, label: '1.0' }, { seconds: 1.5, major: false, label: '' }]
));
test('目盛り比率は窓に対する位置', () => assert.deepEqual(
    cutRangeTicks({ start: 0, end: 2 }).map(tick => tick.ratio), [0, 0.25, 0.5, 0.75, 1]
));
test('目盛りの step を変更できる', () => assert.deepEqual(
    cutRangeTicks({ start: 0, end: 2 }, 1).map(tick => tick.seconds), [0, 1, 2]
));
test('不正な step なら目盛りは空', () => assert.deepEqual(cutRangeTicks({ start: 0, end: 2 }, 0), []));
test('幅ゼロの窓なら目盛りは空', () => assert.deepEqual(cutRangeTicks({ start: 2, end: 2 }), []));

const bandTarget = { kind: 'word', start: 2.2, end: 2.8, limitStart: 1, limitEnd: 4 };
const bandWords = [
    { text: '左', start: 1, end: 2 }, { text: '対象', start: 2, end: 3 }, { text: '右', start: 3, end: 4 }
];
test('語帯は窓で左右をクリップして比率を返す', () => assert.deepEqual(
    cutRangeWordBands(bandTarget, bandWords, { start: 1.5, end: 3.5 }),
    [
        { text: '左', start: 1, end: 2, ratio: 0, widthRatio: 0.25, role: 'context' },
        { text: '対象', start: 2, end: 3, ratio: 0.25, widthRatio: 0.5, role: 'target' },
        { text: '右', start: 3, end: 4, ratio: 0.75, widthRatio: 0.25, role: 'context' }
    ]
));
test('窓と接するだけの語帯は含めない', () => assert.deepEqual(
    cutRangeWordBands(bandTarget, bandWords, { start: 4, end: 5 }), []
));
test('幅ゼロの窓なら語帯は空', () => assert.deepEqual(
    cutRangeWordBands(bandTarget, bandWords, { start: 2, end: 2 }), []
));
test('語帯は DaihonCutRangeWord として発話判定へそのまま渡せる', () => {
    const bands = cutRangeWordBands(bandTarget, bandWords, { start: 1.5, end: 3.5 });
    assert.equal(cutRangeIsSpeech(2.5, bands), true);
    assert.equal(cutRangeIsSpeech(4.1, bands), false);
});
test('発話区間の内部と端は発話', () => assert.deepEqual(
    [1, 1.5, 2].map(seconds => cutRangeIsSpeech(seconds, [{ text: '語', start: 1, end: 2 }])), [true, true, true]
));
test('発話区間の外は無音', () => assert.equal(cutRangeIsSpeech(2.01, [{ text: '語', start: 1, end: 2 }]), false));

test('波形の恒等再標本化', () => assert.deepEqual(
    resampleCutRangePeaks([1, 2, 3, 4], { start: 0, end: 4 }, { start: 0, end: 4 }, 4), [1, 2, 3, 4]
));
test('波形を縮小すると重なるバケットの最大値を取る', () => assert.deepEqual(
    resampleCutRangePeaks([1, 2, 3, 4], { start: 0, end: 4 }, { start: 0, end: 4 }, 2), [2, 4]
));
test('波形の一部を拡大する', () => assert.deepEqual(
    resampleCutRangePeaks([1, 2, 3, 4], { start: 0, end: 4 }, { start: 1, end: 3 }, 2), [2, 3]
));
test('波形ソースの範囲外は 0', () => assert.deepEqual(
    resampleCutRangePeaks([1, 2, 3, 4], { start: 0, end: 4 }, { start: -2, end: 6 }, 4), [0, 2, 4, 0]
));
test('空の波形は空配列', () => assert.deepEqual(resampleCutRangePeaks([], { start: 0, end: 4 }, { start: 0, end: 4 }, 4), []));
test('出力数が 0 以下なら空配列', () => assert.deepEqual(resampleCutRangePeaks([1], { start: 0, end: 1 }, { start: 0, end: 1 }, 0), []));
test('ソース幅が 0 なら空配列', () => assert.deepEqual(resampleCutRangePeaks([1], { start: 1, end: 1 }, { start: 0, end: 1 }, 1), []));

test('無音の正の残しは従来どおり残す秒数を表示する', () => assert.equal(cutRangeReadout(silence, { from: 1.15, to: 1.6 }), '切る 0.45 秒 · 残す 0.15 秒 · 1.15–1.60'));
test('無音の頭より前へ出た範囲は食い込み秒数を表示する', () => assert.equal(cutRangeReadout(silence, { from: 0.6, to: 2 }), '切る 1.40 秒 · 食い込み 0.40 秒 · 0.60–2.00'));
test('無音の頭ちょうどは負のゼロにせず残す 0.00 秒を表示する', () => assert.equal(cutRangeReadout(silence, { from: 1, to: 1.5 }), '切る 0.50 秒 · 残す 0.00 秒 · 1.00–1.50'));
test('語の読み値には切る秒数だけが入る', () => assert.equal(cutRangeReadout(word, { from: 1.23, to: 1.68 }), '切る 0.45 秒 · 1.23–1.68'));
test('語を渡した読み値は食い込みを表示する', () => assert.equal(
    cutRangeReadout(silence, { from: 0.9, to: 1.12 }, [{ text: '前', start: 0.8, end: 1 }]),
    '切る 0.22 秒 · 食い込み 0.10 秒 · 0.90–1.12 · 語に食い込み 0.10 秒'
));

test('オーナー実データで窓全体を動かせ、無音末尾へ吸着する', async () => {
    const fixture = new URL('./fixtures/daihon-cut-range-free/', import.meta.url);
    const silenceRaw = JSON.parse(await readFile(new URL('silences-owner.json', fixture), 'utf8'));
    const captionRaw = JSON.parse(await readFile(new URL('captions-owner.json', fixture), 'utf8'));
    const words = captionRaw.captions.flatMap(caption => caption.words ?? []).sort((a, b) => a.start - b.start || a.end - b.end);
    const target = { kind: 'silence', start: 8.61, end: 11.3, limitStart: 5.2, limitEnd: 14.14 };
    const view = cutRangeWindow(target, words);
    const bounds = cutRangeWindowBounds(view);
    assert.deepEqual(view, { start: 6.39, end: 13.12 });
    assert.deepEqual(bounds, { lo: 6.39, hi: 13.12 });
    const selection = defaultCutRange(target, 0.15);
    assert.equal(moveCutRangeEdge(selection, 'to', 11.1, bounds).to, 11.1);
    const detected = silenceRaw.silences.map(([start, end]) => ({ start, end }));
    assert.equal(cutRangeWordIntrusion(selection, words, detected), 0);
    assert.doesNotMatch(cutRangeReadout(target, selection, words, detected), /語に食い込み/u);
    assert.equal(cutRangeWordIntrusion({ from: 8.7, to: 11.9 }, words, detected), 0.54);
    assert.match(cutRangeReadout(target, { from: 8.7, to: 11.9 }, words, detected), /語に食い込み 0\.54 秒/u);
    assert.ok(cutRangeWordIntrusion(selection, words) > 0);
    const magnets = cutRangeMagnets(detected, words);
    assert.deepEqual(snapToMagnet(11.25, magnets), { seconds: 11.3, magnet: { seconds: 11.3, kind: 'silence' } });
    assert.deepEqual(snapToMagnet(11.25, magnets, 0.08, true), { seconds: 11.25, magnet: null });
    assert.deepEqual(snapToMagnet(11.1, magnets), { seconds: 11.1, magnet: null });
    assert.match(cutRangeReadout(target, { from: 8.7, to: 11.25 }, words), /語に食い込み/u);
});
test('秒から比率への変換は範囲内で往復する', () => assert.equal(cutRangeTime(cutRangeRatio(2, { start: 1, end: 3 }), { start: 1, end: 3 }), 2));
test('秒から比率への変換は 0..1 に収める', () => assert.deepEqual([-1, 4].map(value => cutRangeRatio(value, { start: 1, end: 3 })), [0, 1]));
test('幅ゼロの窓の比率は 0', () => assert.equal(cutRangeRatio(3, { start: 2, end: 2 }), 0));
test('比率から秒への変換は 0..1 に収める', () => assert.deepEqual([-1, 2].map(value => cutRangeTime(value, { start: 1, end: 3 })), [1, 3]));
test('切らずに聞く範囲は選択の前後を含む', () => assert.deepEqual(cutRangePreviewSpans({ from: 2, to: 3 }, { start: 1, end: 4 }, 'intact'), [{ from: 1.2, to: 3.8 }]));
test('切らずに聞く範囲は窓で切り詰める', () => assert.deepEqual(cutRangePreviewSpans({ from: 1.2, to: 3.8 }, { start: 1, end: 4 }, 'intact'), [{ from: 1, to: 4 }]));
test('詰めた結果は前半と後半の二段に分ける', () => assert.deepEqual(cutRangePreviewSpans({ from: 2, to: 3 }, { start: 1, end: 4 }, 'tightened'), [{ from: 1.2, to: 2 }, { from: 3, to: 3.8 }]));
test('詰めた結果の幅ゼロ断片は落とす', () => assert.deepEqual(cutRangePreviewSpans({ from: 1, to: 3 }, { start: 1, end: 4 }, 'tightened'), [{ from: 3, to: 3.8 }]));
