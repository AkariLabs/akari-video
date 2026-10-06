import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptionTimelineSegments, captionClockDomainOf, normalizeCaptionClock } from '../lib/caption-clock.js';
import { readInternalEdit } from '../lib/internal-model.js';

test('caption timeline maps visual, voice, both, and duplicate sources once', () => {
    const edit = {
        version: 2, output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'take', path: 'take.mp4' }, { id: 'mic', path: 'mic.wav' }],
        tracks: [
            { id: 'video', lane: 'visual', items: [{ id: 'take-1', at: 0, duration: 150,
                source: { kind: 'media', src: 'take', in: 0, out: 5 } }] },
            { id: 'voice', lane: 'audio', items: [{ id: 'mic-1', role: 'speech', at: 60, duration: 90,
                source: { kind: 'media', src: 'mic', in: 0, out: 3 } }] }
        ]
    };
    const internal = readInternalEdit(edit);
    const cuts = [{ src: 'take', in: 0, out: 5, at: 0 }];
    const cue = src => ({ id: src, start: 0, end: 1, clockDomain: 'source', clockSourceId: src });
    const visual = buildCaptionTimelineSegments(cuts);
    const voice = buildCaptionTimelineSegments([], internal);
    const both = buildCaptionTimelineSegments(cuts, internal);
    assert.deepEqual(normalizeCaptionClock([cue('take')], visual).map(row => row.start), [0]);
    assert.deepEqual(normalizeCaptionClock([cue('mic')], voice).map(row => row.start), [2]);
    assert.deepEqual(normalizeCaptionClock([cue('take'), cue('mic')], both).map(row => row.start), [0, 2]);
    edit.tracks[1].items[0].source.src = 'take';
    const duplicate = buildCaptionTimelineSegments(cuts, readInternalEdit(edit));
    assert.deepEqual(normalizeCaptionClock([cue('take')], duplicate).map(row => row.start), [0]);
    const partial = buildCaptionTimelineSegments([{ src: 'take', in: 0, out: 1, at: 0 }], readInternalEdit(edit));
    assert.deepEqual(normalizeCaptionClock([{ ...cue('take'), start: 1, end: 2 }], partial)
        .map(row => row.start), [3]);
    edit.tracks[1].items[0].source.src = 'mic';
    edit.tracks[1].items[0].role = 'sfx';
    const effects = buildCaptionTimelineSegments(cuts, readInternalEdit(edit));
    assert.deepEqual(normalizeCaptionClock([cue('mic')], effects), []);
});

test('source cue omits removed words from the preview text and restores them with the segment', () => {
    const caption = { id: 'filler', text: 'えー、本題', start: 0, end: 2,
        clockDomain: 'source', clockSourceId: 'mic', words: [
            { text: 'えー、', start: 0, end: 0.5 },
            { text: '本題', start: 0.5, end: 2 },
        ] };
    const kept = [{ kind: 'src', src: 'mic', in: 0.5, out: 2,
        outStart: 0, outEnd: 1.5, speed: 1, cutIndex: null }];
    assert.deepEqual(normalizeCaptionClock([caption], kept).map(row => row.text), ['本題']);
    assert.deepEqual(normalizeCaptionClock([caption], [{ ...kept[0], in: 0, outStart: 0, outEnd: 2 }])
        .map(row => row.text), ['えー、本題']);
});

// shell の test/preview-caption-clock-unification.test.mjs と同じ fixture（Electron 実機で観測した 7 時刻）。
const segments = [
    { kind: 'src', outStart: 0, outEnd: 3, cutIndex: 0, src: 'main', in: 2, out: 5, speed: 1 },
    { kind: 'gap', outStart: 3, outEnd: 4, cutIndex: null },
    { kind: 'src', outStart: 4, outEnd: 9, cutIndex: 1, src: 'main', in: 7, out: 12, speed: 1 }
];
const fixtureCaptions = [
    { id: 'c-0001', start: 2, end: 3, text: '残っている1本目の字幕', clockDomain: 'source' },
    { id: 'c-0002', start: 3, end: 4, text: '出力gap数値の字幕', clockDomain: 'output' },
    { id: 'c-0003', start: 4, end: 8, text: '削除区間をまたぐ字幕', clockDomain: 'source' },
    { id: 'c-0004', start: 8, end: 9, text: '残っている2本目の字幕', clockDomain: 'source' }
];

test('source/output cue は削除区間と gap をまたいで出力秒の区間になる', () => {
    const normalized = normalizeCaptionClock(fixtureCaptions, segments);
    assert.ok(normalized.every(cue => cue.clockDomain === 'output'));
    assert.deepEqual(
        normalized.map(cue => [cue.sourceCueId ?? cue.id, cue.start, cue.end, cue.text]),
        [
            ['c-0001', 0, 1, '残っている1本目の字幕'],
            ['c-0003', 2, 3, '削除区間をまたぐ字幕'],
            ['c-0002', 3, 4, '出力gap数値の字幕'],
            ['c-0003', 4, 5, '削除区間をまたぐ字幕'],
            ['c-0004', 5, 6, '残っている2本目の字幕']
        ]
    );
    // 分割された cue は id に出現番号を持ち、元 id を sourceCueId で保つ
    assert.deepEqual(normalized.filter(cue => cue.sourceCueId === 'c-0003').map(cue => cue.id),
        ['c-0003-output-1', 'c-0003-output-2']);
});

test('7 時刻の表示は出力秒だけで決まる', () => {
    const normalized = normalizeCaptionClock(fixtureCaptions, segments);
    const activeText = outputTime =>
        normalized.find(cue => cue.start <= outputTime && outputTime < cue.end)?.text ?? '';
    for (const [outputTime, expected] of [
        [0.5, '残っている1本目の字幕'], [1.5, ''], [2.5, '削除区間をまたぐ字幕'], [3.5, '出力gap数値の字幕'],
        [4.5, '削除区間をまたぐ字幕'], [5.5, '残っている2本目の字幕'], [7.5, '']
    ]) {
        assert.equal(activeText(outputTime), expected, `outputTime=${outputTime}`);
    }
});

test('legacy（time_domain 未宣言）は gap に収まるときだけ output、それ以外は source として射影する', () => {
    assert.deepEqual(
        normalizeCaptionClock([{ id: 'legacy-gap', start: 3, end: 4, clockDomain: 'legacy' }], segments)
            .map(cue => [cue.start, cue.end, cue.clockDomain]),
        [[3, 4, 'output']]
    );
    assert.deepEqual(
        normalizeCaptionClock([{ id: 'explicit-source', start: 3, end: 4, clockDomain: 'source' }], segments)
            .map(cue => [cue.start, cue.end, cue.clockDomain]),
        [[1, 2, 'output']]
    );
    assert.deepEqual(
        normalizeCaptionClock([{ id: 'legacy-src', start: 2.5, end: 3, clockDomain: 'legacy' }], segments)
            .map(cue => [cue.start, cue.end]),
        [[0.5, 1]]
    );
});

test('speed と words[] も同じ射影で切り詰める / src 指定は他ソースのセグメントへ射影しない', () => {
    const fast = [{ kind: 'src', outStart: 10, outEnd: 12, cutIndex: 0, src: 'b', in: 0, out: 4, speed: 2 }];
    const [cue] = normalizeCaptionClock([{
        id: 'w', start: 1, end: 5, clockDomain: 'source',
        words: [{ start: 1, end: 2, text: 'a' }, { start: 3.5, end: 4.5, text: 'b' }, { start: 4.5, end: 5, text: 'c' }]
    }], fast);
    assert.deepEqual([cue.start, cue.end], [10.5, 12]);
    assert.deepEqual(cue.words.map(word => [word.text, word.start, word.end]), [['a', 10.5, 11], ['b', 11.75, 12]]);
    assert.deepEqual(
        normalizeCaptionClock([{ id: 'x', start: 1, end: 5, clockDomain: 'source', clockSourceId: 'a' }], fast),
        []
    );
});

test('segments が無ければ全件そのまま output 扱い', () => {
    assert.deepEqual(
        normalizeCaptionClock([{ id: 's', start: 7, end: 8, clockDomain: 'source' }], [])
            .map(cue => [cue.id, cue.start, cue.end, cue.clockDomain]),
        [['s', 7, 8, 'output']]
    );
});

test('captionClockDomainOf は time_domain を直通し、未宣言は legacy、src は clockSourceId になる', () => {
    assert.deepEqual(captionClockDomainOf({ time_domain: 'output' }), { clockDomain: 'output' });
    assert.deepEqual(captionClockDomainOf({ time_domain: 'source', src: 'hero' }), { clockDomain: 'source', clockSourceId: 'hero' });
    assert.deepEqual(captionClockDomainOf({ time_domain: 'weird', src: '' }), { clockDomain: 'legacy' });
    assert.deepEqual(captionClockDomainOf(undefined), { clockDomain: 'legacy' });
});
