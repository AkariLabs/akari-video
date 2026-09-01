import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    parseCaptions,
    regenerateCaptions,
    replaceCaptionDisplayTextLine,
    replaceCaptionLine,
    serializeCaptions
} = require('../lib/browser/caption-store.js');

const mixedCaptions = [
    {
        id: 'c-0001',
        start: 0,
        end: 1.5,
        text: 'えー、最初の字幕です。',
        speaker: null,
        sourceRef: { segment: 0 },
        edited: false,
        words: [
            { start: 0, end: 0.7, text: '最初の' },
            { start: 0.7, end: 1.5, text: '字幕です。' }
        ],
        style: 'emphasis',
        displayText: '最初の字幕です。'
    },
    {
        id: 'c-0002',
        start: 1.5,
        end: 3,
        text: '二番目の字幕です。',
        speaker: 'speaker-1',
        sourceRef: { segment: 1 },
        edited: true
    }
];

test('display_text の有無が混在してもバイト等価で round-trip する', () => {
    const source = serializeCaptions(mixedCaptions);
    const parsed = parseCaptions(source);

    assert.deepEqual(parsed.warnings, []);
    assert.equal(serializeCaptions(parsed.captions), source);
});

test('display_text が無い caption の行には display_text を追加しない', () => {
    const source = serializeCaptions(mixedCaptions);
    const lineWithoutDisplayText = source
        .split('\n')
        .find(line => line.includes('"id":"c-0002"'));

    assert.ok(lineWithoutDisplayText);
    assert.equal(lineWithoutDisplayText.includes('"display_text"'), false);
});

test('replaceCaptionDisplayTextLine は display_text だけを書き換える', () => {
    const source = serializeCaptions(mixedCaptions);
    const sourceLines = source.split('\n');
    const updated = replaceCaptionDisplayTextLine(source, 'c-0001', '読みやすい新しい整文です。');
    const updatedLines = updated.split('\n');
    const parsed = parseCaptions(updated).captions;
    const target = parsed.find(caption => caption.id === 'c-0001');

    assert.ok(target);
    assert.equal(target.displayText, '読みやすい新しい整文です。');
    assert.equal(target.text, mixedCaptions[0].text);
    assert.equal(target.edited, mixedCaptions[0].edited);
    assert.equal(updatedLines[2], sourceLines[2]);
});

test('replaceCaptionLine は text 由来の display_text を削除する', () => {
    const source = serializeCaptions(mixedCaptions);
    const updated = replaceCaptionLine(source, 'c-0001', '本文だけを書き換えます。');
    const target = parseCaptions(updated).captions.find(caption => caption.id === 'c-0001');

    assert.ok(target);
    assert.equal(target.text, '本文だけを書き換えます。');
    assert.equal(target.displayText, undefined);
    assert.equal(target.edited, true);
});

test('replaceCaptionLine は words を再導出し 1 行形式と他行 bytes を保つ', () => {
    const captions = [
        {
            id: 'c-1001', start: 0, end: 3, text: 'alpha beta gamma', speaker: null,
            sourceRef: null, edited: false, style: 'karaoke',
            words: [
                { start: 0.1, end: 0.7, text: 'alpha' },
                { start: 0.8, end: 1.6, text: 'beta' },
                { start: 1.7, end: 2.9, text: 'gamma' }
            ]
        },
        { id: 'c-1002', start: 3, end: 4, text: 'untouched', speaker: null, sourceRef: null, edited: false }
    ];
    const source = serializeCaptions(captions);
    const updated = replaceCaptionLine(source, 'c-1001', 'alpha delta gamma');
    const beforeLines = source.split('\n');
    const afterLines = updated.split('\n');
    const target = parseCaptions(updated).captions[0];

    assert.equal(afterLines.length, beforeLines.length);
    assert.equal(afterLines[2], beforeLines[2]);
    assert.deepEqual(target.words[0], captions[0].words[0]);
    assert.deepEqual(target.words[2], captions[0].words[2]);
    assert.equal(target.words[1].text, 'delta');
});

test('display_text が無い行は replaceCaptionDisplayTextLine で編集できない', () => {
    const source = serializeCaptions(mixedCaptions);

    assert.throws(
        () => replaceCaptionDisplayTextLine(source, 'c-0002', '追加はしません。'),
        /字幕 c-0002 に整文（display_text）がありません。/
    );
});

test('任意フィールドが無い既存 caption はバイト等価で round-trip する', () => {
    const captions = [{
        id: 'c-0100',
        start: 10,
        end: 12,
        text: '既存の素の字幕です。',
        speaker: null,
        sourceRef: null,
        edited: false
    }];
    const source = serializeCaptions(captions);

    assert.equal(serializeCaptions(parseCaptions(source).captions), source);
    assert.equal(source.includes('"display_text"'), false);
});

test('parseCaptions: オブジェクト形式 { default_text_style, captions } を受理し形式を報告する', () => {
    const source = JSON.stringify({
        default_text_style: { color: '#FFCC00', zone: 'top' },
        captions: [
            { id: 'c-0001', start: 1, end: 2, text: 'あ', speaker: null, sourceRef: null, edited: false }
        ]
    });
    const parsed = parseCaptions(source);
    assert.equal(parsed.captions.length, 1);
    assert.equal(parsed.captions[0].id, 'c-0001');
    assert.deepEqual(parsed.shape, {
        root: 'object',
        defaultTextStyle: { color: '#FFCC00', zone: 'top' }
    });
    // 配列形式は従来どおり
    assert.deepEqual(parseCaptions('[]').shape, { root: 'array' });
});

test('serializeCaptions: オブジェクト形式で default_text_style と 1 レコード 1 行を保持する', () => {
    const captions = parseCaptions(JSON.stringify({
        default_text_style: { color: '#FFFFFF' },
        captions: [
            { id: 'c-0001', start: 1, end: 2, text: 'あ', speaker: null, sourceRef: null, edited: false },
            { id: 'c-0002', start: 2, end: 3, text: 'い', speaker: null, sourceRef: null, edited: false }
        ]
    }));
    const source = serializeCaptions(captions.captions, captions.shape);
    const reparsed = parseCaptions(source);
    assert.deepEqual(reparsed.shape, { root: 'object', defaultTextStyle: { color: '#FFFFFF' } });
    assert.deepEqual(reparsed.captions.map(c => c.id), ['c-0001', 'c-0002']);
    // 行手術契約: 各レコードは 1 物理行（"id" を含む行がレコード数と一致）
    const idLines = source.split('\n').filter(line => line.includes('"id"'));
    assert.equal(idLines.length, 2);
    // default_text_style 行はレコード行と独立
    assert.equal(source.split('\n').filter(line => line.includes('default_text_style')).length, 1);
});

test('replaceCaptionLine: オブジェクト形式でも該当行だけ書き換え default_text_style を壊さない', () => {
    const parsed = parseCaptions(JSON.stringify({
        default_text_style: { color: '#FF0000', size_px: 44 },
        captions: [
            { id: 'c-0001', start: 1, end: 2, text: 'before', speaker: null, sourceRef: null, edited: false }
        ]
    }));
    const source = serializeCaptions(parsed.captions, parsed.shape);
    const updated = replaceCaptionLine(source, 'c-0001', 'after');
    const reparsed = parseCaptions(updated);
    assert.equal(reparsed.captions[0].text, 'after');
    assert.equal(reparsed.captions[0].edited, true);
    assert.deepEqual(reparsed.shape.defaultTextStyle, { color: '#FF0000', size_px: 44 });
});

test('regenerateCaptions: 既存がオブジェクト形式なら形式と default_text_style を保持して出力する', () => {
    const analysis = JSON.stringify({
        transcript: [{ start: 1, end: 2, text: 'gen' }]
    });
    const existing = JSON.stringify({
        default_text_style: { zone: 'bottom' },
        captions: [
            { id: 'c-0001', start: 5, end: 6, text: 'manual', speaker: null, sourceRef: null, edited: false }
        ]
    });
    const { source } = regenerateCaptions(analysis, existing);
    const reparsed = parseCaptions(source);
    assert.deepEqual(reparsed.shape, { root: 'object', defaultTextStyle: { zone: 'bottom' } });
    assert.deepEqual(reparsed.captions.map(c => c.text), ['gen', 'manual']);
    // 既存が配列形式なら従来どおり配列で出力
    const arrayOut = regenerateCaptions(analysis, '[]').source;
    assert.equal(parseCaptions(arrayOut).shape.root, 'array');
});

test('regenerateCaptions: 保持した既存字幕を含めて start 順に並ぶ（edit-lint captions.order 契約）', () => {
    const analysis = JSON.stringify({
        transcript: [
            { start: 3, end: 4, text: 'gen-line-1' },
            { start: 8, end: 9, text: 'gen-line-2' }
        ]
    });
    const existing = JSON.stringify([
        { id: 'c-0001', start: 13, end: 14, text: 'manual-late', speaker: null, sourceRef: null, edited: false },
        { id: 'c-0002', start: 5, end: 6, text: 'manual-mid', speaker: null, sourceRef: null, edited: false }
    ]);
    const { captions } = regenerateCaptions(analysis, existing);
    assert.deepEqual(captions.map(caption => caption.start), [3, 5, 8, 13]);
    // 保持行（sourceRef null 化）と生成行が混在してもソートで契約を満たす
    assert.deepEqual(captions.map(caption => caption.text),
        ['gen-line-1', 'manual-mid', 'gen-line-2', 'manual-late']);
});
