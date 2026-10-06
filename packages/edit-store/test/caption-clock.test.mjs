import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptionTimelineSegments, captionClockDomainOf, normalizeCaptionClock } from '../lib/caption-clock.js';
import { readInternalEdit } from '../lib/internal-model.js';
import { projectLegacyEdit, removeCutAudioLinked, splitAtFrame, splitCutAudio } from '../lib/index.js';

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

test('linked, muted, and visually represented audio never creates caption source ranges', () => {
    const item = { id: 'voice', role: 'speech', at: 0, duration: 30,
        source: { kind: 'media', src: 'main', in: 0, out: 1 } };
    const doc = { version: 2, output: { width: 320, height: 180, fps: 30 },
        sources: [{ id: 'main', path: 'main.mp4' }], tracks: [
            { id: 'video', lane: 'visual', items: [] },
            { id: 'audio', lane: 'audio', items: [item] }
        ] };
    const ranges = (value, cuts = []) => buildCaptionTimelineSegments(cuts, value, { fps: 30 });
    assert.equal(ranges(doc).length, 1);
    assert.deepEqual(ranges(doc), ranges(readInternalEdit(doc)));
    doc.tracks[0].items = [{ id: 'visual', at: 0, duration: 30,
        source: { kind: 'media', src: 'main', in: 0, out: 1 } }];
    const visualCut = [{ src: 'main', in: 0, out: 1, at: 0 }];
    assert.equal(ranges(doc, visualCut).length, 1);
    assert.deepEqual(ranges(readInternalEdit(doc), visualCut), ranges(doc, visualCut));
    doc.tracks[0].items = [];
    for (const field of ['link', 'mute']) {
        item[field] = field === 'link' ? 'visual' : true;
        assert.deepEqual(ranges(doc), [], field);
        assert.deepEqual(ranges(readInternalEdit(doc)), [], `${field} internal`);
        delete item[field];
    }
    doc.tracks[1].muted = true;
    assert.deepEqual(ranges(doc), []);
    assert.deepEqual(ranges(readInternalEdit(doc)), []);
    delete doc.tracks[1].muted;
    delete item.source.out;
    assert.deepEqual(ranges(doc), ranges(readInternalEdit(doc)));
    assert.deepEqual(ranges(doc), []);
});

test('同じ素材の声は映像未使用区間だけ字幕へ足し、link 付きは足さない', () => {
    const doc = { version: 2, output: { width: 320, height: 180, fps: 30 },
        sources: [{ id: 'main', path: 'main.mp4' }], tracks: [
            { id: 'video', lane: 'visual', items: [{ id: 'clip', at: 0, duration: 30,
                source: { kind: 'media', src: 'main', in: 0, out: 1 } }] },
            { id: 'audio', lane: 'audio', items: [{ id: 'voice', role: 'speech', at: 30, duration: 60,
                source: { kind: 'media', src: 'main', in: 0, out: 2 } }] }
        ] };
    const cuts = [{ src: 'main', in: 0, out: 1, at: 0 }];
    const unlinked = buildCaptionTimelineSegments(cuts, doc);
    assert.deepEqual(unlinked.map(segment => [segment.in, segment.out]), [[0, 1], [1, 2]]);
    assert.deepEqual(buildCaptionTimelineSegments(cuts, readInternalEdit(doc))
        .map(segment => [segment.in, segment.out]), [[0, 1], [1, 2]]);
    doc.tracks[1].items[0].link = 'clip';
    assert.deepEqual(buildCaptionTimelineSegments(cuts, doc).map(segment => [segment.in, segment.out]), [[0, 1]]);
    doc.tracks[0].items = [];
    assert.deepEqual(buildCaptionTimelineSegments([], doc), []);
});

test('分離音声の C / C\' と同素材の独立音声 D は字幕の重複と欠落を分ける', () => {
    const base = () => ({ version: 2, output: { width: 320, height: 180, fps: 30 },
        sources: [{ id: 'take', path: 'take.mp4' }, { id: 'broll', path: 'broll.mp4' }],
        tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'clip', at: 0, duration: 300,
            source: { kind: 'media', src: 'take', in: 0, out: 10 } }] }] });
    const broll = (at, duration, out) => ({ id: 'br', at, duration,
        source: { kind: 'media', src: 'broll', in: 0, out } });
    const visual = doc => doc.tracks.find(track => track.lane === 'visual');
    const cues = [
        { id: 'before', src: 'take', start: 1, end: 2, text: 'まえ', clockDomain: 'source', clockSourceId: 'take' },
        { id: 'after', src: 'take', start: 6, end: 7, text: 'あと', clockDomain: 'source', clockSourceId: 'take' },
    ];
    const captionTimes = doc => {
        const internal = readInternalEdit(doc);
        const cuts = projectLegacyEdit(internal).cuts;
        const segments = buildCaptionTimelineSegments(cuts, internal, { fps: 30 });
        return normalizeCaptionClock(cues, segments).map(row => [row.start, row.end, row.text]);
    };

    // C: 分離して分割し、右の映像だけを外すと右の声は link 解除される。
    let c = splitCutAudio(base(), { cutId: 'clip', hasAudio: true }).document;
    c = splitAtFrame(c, 150, { itemIds: ['clip'] }).edit;
    const right = visual(c).items.find(item => item.id !== 'clip');
    c = removeCutAudioLinked(c, { target: 'cut-only', cutId: right.id });
    visual(c).items.push(broll(150, 150, 5));
    assert.deepEqual(c.tracks.find(track => track.lane === 'audio').items.map(item => item.link), ['clip', undefined]);
    assert.deepEqual(captionTimes(c), [[1, 2, 'まえ'], [6, 7, 'あと']]);

    // C': link 付きの声は映像の後ろが残っていても字幕区間を増やさない。
    const cPrime = splitCutAudio(base(), { cutId: 'clip', hasAudio: true }).document;
    visual(cPrime).items[0].duration = 150;
    visual(cPrime).items[0].source.out = 5;
    visual(cPrime).items.push(broll(150, 150, 5));
    assert.deepEqual(captionTimes(cPrime), [[1, 2, 'まえ']]);

    // D: 同素材でも link の無い声は映像で覆われない区間だけを補う。
    const d = base();
    visual(d).items[0].duration = 90;
    visual(d).items[0].source.out = 3;
    visual(d).items.push(broll(90, 210, 7));
    d.tracks.push({ id: 'a', lane: 'audio', items: [{ id: 'voice', role: 'speech', at: 0, duration: 300,
        source: { kind: 'media', src: 'take', in: 0, out: 10 } }] });
    assert.deepEqual(captionTimes(d), [[1, 2, 'まえ'], [6, 7, 'あと']]);
});

test('a middle word cut gives every occurrence the same full display text and rebased runs', () => {
    const segments = [
        { kind: 'src', src: 'main', in: 0, out: 1, outStart: 0, outEnd: 1 },
        { kind: 'src', src: 'main', in: 2, out: 3, outStart: 1, outEnd: 2 }
    ];
    const cue = { id: 'middle', start: 0, end: 3, clockDomain: 'source', clockSourceId: 'main',
        text: '今日は、えー、本題', words: [
            { text: '今日は、', start: 0, end: 1 },
            { text: 'えー、', start: 1, end: 2 },
            { text: '本題', start: 2, end: 3 }
        ] };
    const result = normalizeCaptionClock([cue], segments);
    assert.deepEqual(result.map(row => row.text), ['今日は、本題', '今日は、本題']);
    assert.deepEqual(result.map(row => row.originalSourceText), [cue.text, cue.text]);
    const withRuns = { ...cue, text: 'えー本題', words: [
        { text: 'えー', start: 1, end: 2 }, { text: '本題', start: 2, end: 3 }
    ], runs: [{ from: 2, to: 4, style: { color: '#ff0000' } }] };
    assert.deepEqual(normalizeCaptionClock([withRuns], [segments[1]]).map(row => row.runs),
        [[{ from: 0, to: 2, style: { color: '#ff0000' } }]]);
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
