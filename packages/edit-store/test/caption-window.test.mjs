import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    captionFragmentWindows,
    captionSpeechWindow,
    captionWindowSeconds,
    expandCaptionDisplayFragments,
    findActiveCaption
} from '../lib/caption-window.js';

test('captionSpeechWindow: 有効語の最小最大へ前後を縮める', () => {
    const caption = { start: 0, end: 4, display_timing: 'speech-tight', words: [
        { start: 1, end: 1.5 }, { start: Number.NaN, end: 2 }, { start: 2, end: 3 }
    ] };
    assert.deepEqual(captionSpeechWindow(caption), { start: 1, end: 3 });
    assert.deepEqual(captionWindowSeconds(caption), { start: 1, end: 3 });
});

test('captionSpeechWindow: 語なしと窓いっぱいは fail-open する', () => {
    assert.equal(captionSpeechWindow({ start: 0, end: 2, display_timing: 'speech-tight' }), null);
    assert.equal(captionSpeechWindow({ start: 0, end: 2, display_timing: 'speech-tight', words: [{ start: 0, end: 2 }] }), null);
});

test('expandCaptionDisplayFragments: 断片なし speech-tight は浅いコピーの窓だけを縮める', () => {
    const caption = { id: 'c1', start: 0, end: 3, text: '本文', display_timing: 'speech-tight',
        words: [{ text: '本文', start: 1, end: 2 }] };
    const [expanded] = expandCaptionDisplayFragments([caption]);
    assert.notEqual(expanded, caption);
    assert.equal(expanded.start, 1);
    assert.equal(expanded.end, 2);
    assert.equal(expanded.words, caption.words);
    assert.equal(expanded.display_timing, 'speech-tight');
});

test('speech-tight と display_fragments は縮めた base 窓を共有する', () => {
    const windows = captionFragmentWindows({ start: 0, end: 4, text: '前後', display_fragments: ['前', '後'],
        display_timing: 'speech-tight', words: [{ text: '前', start: 1, end: 2 }, { text: '後', start: 2.5, end: 3 }] });
    assert.deepEqual(windows, [
        { text: '前', start: 1, end: 2, index: 1, count: 2 },
        { text: '後', start: 2.5, end: 3, index: 2, count: 2 }
    ]);
});

test('findActiveCaption: speech-tight の無音 padding ではヒットしない', () => {
    const captions = [{ id: 'tight', start: 0, end: 3, display_timing: 'speech-tight',
        words: [{ start: 1, end: 2 }] }];
    assert.equal(findActiveCaption(captions, 0.5), undefined);
    assert.equal(findActiveCaption(captions, 1.5)?.id, 'tight');
});

test('captionWindowSeconds: start/end がそのまま窓になる（正典形）', () => {
    assert.deepEqual(captionWindowSeconds({ start: 3, end: 4 }), { start: 3, end: 4 });
});

test('captionWindowSeconds: end 欠落は duration フォールバック（互換形）', () => {
    assert.deepEqual(captionWindowSeconds({ start: 2, duration: 1.5 }), { start: 2, end: 3.5 });
});

test('captionWindowSeconds: end があるとき duration は無視される', () => {
    assert.deepEqual(captionWindowSeconds({ start: 2, end: 5, duration: 99 }), { start: 2, end: 5 });
});

test('captionWindowSeconds: 不正値は 0 幅の窓（表示されない）', () => {
    assert.deepEqual(captionWindowSeconds({ start: 'x', end: undefined }), { start: 0, end: 0 });
    assert.deepEqual(captionWindowSeconds({}), { start: 0, end: 0 });
});

test('findActiveCaption: 半開区間 [start, end) で最初のヒットを返す', () => {
    const captions = [
        { id: 'a', start: 1, end: 2 },
        { id: 'b', start: 2, end: 3 },
        { id: 'c', start: 2.5, end: 4 }
    ];
    assert.equal(findActiveCaption(captions, 1.0)?.id, 'a');
    // end は排他: t=2 で a は終わり b が始まる
    assert.equal(findActiveCaption(captions, 2.0)?.id, 'b');
    // 重複窓は先勝ち（配列順）
    assert.equal(findActiveCaption(captions, 2.7)?.id, 'b');
    assert.equal(findActiveCaption(captions, 3.5)?.id, 'c');
    assert.equal(findActiveCaption(captions, 5.0), undefined);
});

test('captionFragmentWindows: words の語境界で無音をどちらにも含めず分割する', () => {
    const caption = {
        id: 'c1', start: 0, end: 5, text: '前半後半', display_fragments: ['前半', '後半'],
        words: [
            { text: '前半', start: -1, end: 1.8, confidence: 0.9 },
            { text: '後半', start: 2.2, end: 6, confidence: 0.8 }
        ]
    };
    assert.deepEqual(captionFragmentWindows(caption), [
        { text: '前半', start: 0, end: 1.8, index: 1, count: 2 },
        { text: '後半', start: 2.2, end: 5, index: 2, count: 2 }
    ]);
    const expanded = expandCaptionDisplayFragments([caption]);
    assert.deepEqual(expanded.map(item => ({
        id: item.id, text: item.text, start: item.start, end: item.end,
        fragmentKey: item.fragmentKey, words: item.words
    })), [
        { id: 'c1', text: '前半', start: 0, end: 1.8, fragmentKey: 'c1#f1',
            words: [{ text: '前半', start: 0, end: 1.8, confidence: 0.9 }] },
        { id: 'c1', text: '後半', start: 2.2, end: 5, fragmentKey: 'c1#f2',
            words: [{ text: '後半', start: 2.2, end: 5, confidence: 0.8 }] }
    ]);
    assert.equal(Object.hasOwn(expanded[0], 'display_fragments'), false);
});

test('captionFragmentWindows: words 無しは文字数比で連続分割し 3 断片以上を扱う', () => {
    assert.deepEqual(captionFragmentWindows({
        id: 'c1', start: 1, end: 7, text: 'abcdef', display_fragments: ['a', 'bc', 'def']
    }), [
        { text: 'a', start: 1, end: 2, index: 1, count: 3 },
        { text: 'bc', start: 2, end: 4, index: 2, count: 3 },
        { text: 'def', start: 4, end: 7, index: 3, count: 3 }
    ]);
});

test('captionFragmentWindows: 不完全 words は文字数比へフォールバックする', () => {
    assert.deepEqual(captionFragmentWindows({
        start: 0, end: 4, text: '前半後半', display_fragments: ['前半', '後半'],
        words: [{ text: '前半', start: 0.5, end: 1 }]
    })?.map(({ start, end }) => [start, end]), [[0, 2], [2, 4]]);
});

test('captionFragmentWindows: 無効な断片は null、展開は参照同一で既存挙動を保つ', () => {
    const cases = [
        { id: 'a', start: 0, end: 1, text: '本文' },
        { id: 'b', start: 0, end: 1, text: '本文', display_fragments: '本文' },
        { id: 'c', start: 0, end: 1, text: '本文', display_fragments: ['本文'] },
        { id: 'd', start: 0, end: 1, text: '本文', display_fragments: ['本', '不一致'] },
        { id: 'e', start: 0, end: 1, text: '本文', display_text: 7, display_fragments: ['本', '文'] }
    ];
    for (const caption of cases) assert.equal(captionFragmentWindows(caption), null);
    const expanded = expandCaptionDisplayFragments(cases);
    cases.forEach((caption, index) => assert.equal(expanded[index], caption));
});

test('expandCaptionDisplayFragments: display_text と id を保ち疑似 caption の表示本文だけ差し替える', () => {
    const expanded = expandCaptionDisplayFragments([{
        id: 'same', start: 0, end: 2, text: 'raw', display_text: '表示本文',
        display_fragments: ['表示', '本文']
    }]);
    assert.deepEqual(expanded.map(({ id, text, display_text, fragmentIndex, fragmentCount }) =>
        ({ id, text, display_text, fragmentIndex, fragmentCount })), [
        { id: 'same', text: '表示', display_text: '表示', fragmentIndex: 1, fragmentCount: 2 },
        { id: 'same', text: '本文', display_text: '本文', fragmentIndex: 2, fragmentCount: 2 }
    ]);
});

test('findActiveCaptions preserves input order and half-open boundaries', async () => {
    const { findActiveCaptions } = await import('../lib/caption-window.js');
    const first = { id: 'source', start: 1, end: 3 };
    const second = { id: 'output', start: 2, end: 4 };
    const next = { id: 'next', start: 3, end: 5 };
    const cues = [first, second, next];
    assert.deepEqual(findActiveCaptions([], 2), []);
    assert.deepEqual(findActiveCaptions(cues, 0), []);
    assert.deepEqual(findActiveCaptions(cues, 1), [first]);
    assert.deepEqual(findActiveCaptions(cues, 2), [first, second]);
    assert.deepEqual(findActiveCaptions(cues, 3), [second, next]);
    assert.deepEqual(findActiveCaptions([next, second], 3), [next, second]);
    assert.equal(findActiveCaption(cues, 2), first);
    assert.deepEqual(findActiveCaptions([{ start: 2, duration: 1 }], 3), []);
    assert.deepEqual(findActiveCaptions([{ ...first, display_timing: 'speech-tight', words: [{ start: 2, end: 2.5 }] }], 1), []);
});

test('captionFragmentWindows trims display text without changing source-length timing', () => {
    const text = 'When the score is high,';
    const windows = captionFragmentWindows({ start: 0, end: 23, text,
        display_fragments: ['When ', 'the score is high,'] });
    assert.deepEqual(windows, [
        { text: 'When', start: 0, end: 5, index: 1, count: 2 },
        { text: 'the score is high,', start: 5, end: 23, index: 2, count: 2 }
    ]);
});

test('expandCaptionDisplayFragments keeps source offsets while run ranges match trimmed text', () => {
    const caption = { id: 'c-space', start: 0, end: 2, text: 'When the score',
        display_fragments: ['When ', 'the score'], runs: [{ from: 9, to: 14, role: 'score' }],
        words: [
            { text: 'When ', start: 0, end: 1 },
            { text: 'the ', start: 1, end: 1.5 },
            { text: 'score', start: 1.5, end: 2 }
        ] };
    const expanded = expandCaptionDisplayFragments([caption]);
    assert.deepEqual(expanded.map(({ text, runTextStart, runTextEnd }) =>
        ({ text, runTextStart, runTextEnd })), [
        { text: 'When', runTextStart: 0, runTextEnd: 4 },
        { text: 'the score', runTextStart: 5, runTextEnd: 14 }
    ]);
    assert.deepEqual(expanded.map(item => item.words.map(word => word.text)),
        [['When'], ['the ', 'score']]);
    expanded.forEach(item => assert.equal(item.words.map(word => word.text).join(''), item.text));

    const leading = expandCaptionDisplayFragments([{ ...caption,
        display_fragments: ['When', ' the score'],
        words: [
            { text: 'When', start: 0, end: 1 },
            { text: ' the', start: 1, end: 1.5 },
            { text: ' score', start: 1.5, end: 2 }
        ] }]);
    assert.deepEqual(leading.map(({ text, runTextStart, runTextEnd }) =>
        ({ text, runTextStart, runTextEnd })), [
        { text: 'When', runTextStart: 0, runTextEnd: 4 },
        { text: 'the score', runTextStart: 5, runTextEnd: 14 }
    ]);
    assert.deepEqual(leading.map(item => item.words.map(word => word.text)),
        [['When'], ['the', ' score']]);
    leading.forEach(item => assert.equal(item.words.map(word => word.text).join(''), item.text));
});

test('expandCaptionDisplayFragments drops a whitespace-only word trimmed from a window', () => {
    const expanded = expandCaptionDisplayFragments([{
        id: 'c-space-word', start: 0, end: 2, text: 'When the score',
        display_fragments: ['When', ' the score'],
        words: [
            { text: 'When', start: 0, end: 0.5 },
            { text: ' ', start: 0.5, end: 0.6 },
            { text: 'the ', start: 0.6, end: 1.4 },
            { text: 'score', start: 1.4, end: 2 }
        ]
    }]);
    assert.deepEqual(expanded.map(item => item.words.map(word => word.text)),
        [['When'], ['the ', 'score']]);
    expanded.forEach(item => assert.equal(item.words.map(word => word.text).join(''), item.text));
});

test('expandCaptionDisplayFragments preserves original empty words while dropping trimmed whitespace words', () => {
    const words = [
        { text: '前半', start: 0, end: 1 },
        { text: '', start: 1, end: 1, marker: 'boundary' },
        { text: '後', start: 1, end: 1.5 },
        { text: '', start: 1.5, end: 1.5, marker: 'inside' },
        { text: '半', start: 1.5, end: 2 }
    ];
    const plain = expandCaptionDisplayFragments([{
        start: 0, end: 2, text: '前半後半', display_fragments: ['前半', '後半'], words
    }]);
    assert.deepEqual(plain.map(item => item.words), [
        [words[0], words[1]],
        [words[1], words[2], words[3], words[4]]
    ]);

    const spacedWords = [
        { text: 'When', start: 0, end: 0.5 },
        { text: ' ', start: 0.5, end: 1 },
        { text: '', start: 1, end: 1, marker: 'boundary' },
        { text: 'the', start: 1, end: 1.3 },
        { text: ' ', start: 1.3, end: 1.4 },
        { text: 'score', start: 1.4, end: 2 }
    ];
    const spaced = expandCaptionDisplayFragments([{
        start: 0, end: 2, text: 'When the score',
        display_fragments: ['When ', 'the score'], words: spacedWords
    }]);
    assert.deepEqual(spaced.map(item => item.words), [
        [spacedWords[0], spacedWords[2]],
        [spacedWords[2], spacedWords[3], spacedWords[4], spacedWords[5]]
    ]);
});

test('captionFragmentWindows rejects whitespace-only fragments', () => {
    const caption = { start: 0, end: 3, text: 'ab cd', display_fragments: ['ab', ' ', 'cd'] };
    assert.equal(captionFragmentWindows(caption), null);
    assert.deepEqual(expandCaptionDisplayFragments([caption]), [caption]);
});
