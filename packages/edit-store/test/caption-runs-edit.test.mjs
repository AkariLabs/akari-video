import test from 'node:test';
import assert from 'node:assert/strict';
import { setCaptionRunStyle, setCaptionRunRole, removeCaptionRun, captionRunStyleFromLook } from '../lib/caption-runs.js';
import { updateCaptionRunsInSource, updateCaptionFieldsInSourceWithReport,
    captionEmphasisRemovedNotice, captionEditNotices, parseCaptions } from '../lib/caption-store.js';

test('書記素の範囲を更新し、同じ範囲の run は増やさず重なりの順を守る', () => {
    const text = 'A👩‍👩‍👧‍👦B';
    const first = setCaptionRunStyle(text, undefined, 1, 2, { color: '#ff0000' });
    const second = setCaptionRunRole(text, first, 1, 2, 'emphasis');
    const third = setCaptionRunStyle(text, second, 1, 2, { scale: 1.3 });
    assert.deepEqual(third, [{ from: 1, to: 2, role: 'emphasis', style: { color: '#ff0000', scale: 1.3 } }]);
    assert.throws(() => setCaptionRunStyle(text, third, 1, 4, { italic: true }), /文字範囲/);
    assert.deepEqual(removeCaptionRun(third, 0), []);
});

test('runs だけを最小差分で書き換え、外すと property を除く', () => {
    const source = '{\n  "captions": [\n    {"id":"a", "text":"最高", "other": {"x": 1}}\n  ],\n  "default_text_style": {}\n}\n';
    const styled = updateCaptionRunsInSource(source, 'a', { kind: 'style', from: 0, to: 2, style: { color: '#ff0000' } });
    assert.match(styled, /"other": \{"x": 1\}/);
    assert.equal(JSON.parse(styled).captions[0].runs.length, 1);
    const removed = updateCaptionRunsInSource(styled, 'a', { kind: 'remove', index: 0 });
    assert.equal(removed, source);
    assert.deepEqual(JSON.parse(updateCaptionRunsInSource(removed, 'a', { kind: 'insert', index: 0,
        run: { from: 0, to: 2, style: { color: '#ff0000' } } })).captions[0].runs,
    JSON.parse(styled).captions[0].runs);
});

test('見た目から run 語彙のみ写し、使えない項目を報告する', () => {
    assert.deepEqual(captionRunStyleFromLook({ color: '#ff0000', fontWeight: 900, shadow: {}, sizePx: 45 }),
        { style: { color: '#ff0000', font_weight: 900 }, omitted: ['shadow', 'sizePx'] });
    assert.deepEqual(captionRunStyleFromLook({ size_px: 76, weight: 700, letter_spacing_em: 0.1,
        stroke: { color: '#ffffff', width_px: 2 }, background: { color: '#000000' } }, 38),
        { style: { scale: 2, font_weight: 700, letter_spacing_em: 0.1,
            stroke: { color: '#ffffff', width_px: 2 } }, omitted: ['background'] });
});

test('文字編集の結果に外れた範囲が含まれる', () => {
    const source = JSON.stringify({ captions: [{ id: 'a', text: 'これは最高です', edited: false,
        runs: [{ from: 3, to: 5, style: { color: '#ff0000' } }] }] });
    const result = updateCaptionFieldsInSourceWithReport(source, 'a', { text: 'これはです' });
    assert.equal(result.removedRuns.length, 1);
    assert.deepEqual(result.removedEmphasis, []);
    assert.deepEqual(captionEditNotices(result, 'これは最高です'), ['文字範囲 1 件（「最高」）が外れました']);
    assert.equal(captionEmphasisRemovedNotice([{ id: 'e1', word: '最高', t_start: 1, t_end: 2 }]),
        '強調 1 件（「最高」）が外れました');
});

test('インスペクター用の読み取りでも display_text と runs を保持する', () => {
    const source = JSON.stringify({ captions: [{ id: 'c-0001', start: 0, end: 2,
        text: 'これは最高です', display_text: 'これは最高です', speaker: null,
        sourceRef: null, edited: true, runs: [{ from: 3, to: 5, role: 'emphasis',
            style: { color: '#f26666' } }] }] });
    const caption = parseCaptions(source).captions[0];
    assert.equal(caption.displayText, 'これは最高です');
    assert.deepEqual(caption.runs, [{ from: 3, to: 5, role: 'emphasis', style: { color: '#f26666' } }]);
});
