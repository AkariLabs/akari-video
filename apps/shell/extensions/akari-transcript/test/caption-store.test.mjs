import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    parseCaptions,
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

test('replaceCaptionLine は display_text を変更しない', () => {
    const source = serializeCaptions(mixedCaptions);
    const updated = replaceCaptionLine(source, 'c-0001', '本文だけを書き換えます。');
    const target = parseCaptions(updated).captions.find(caption => caption.id === 'c-0001');

    assert.ok(target);
    assert.equal(target.text, '本文だけを書き換えます。');
    assert.equal(target.displayText, mixedCaptions[0].displayText);
    assert.equal(target.edited, true);
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
