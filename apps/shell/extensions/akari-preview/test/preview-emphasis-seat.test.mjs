import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    readCaptionsEmphasisWords,
    readLegacyEditEmphasisWords,
    resolvePreviewEmphasisWords
} from '../lib/common/preview-emphasis-seat.js';

const captionsSeat = [{
    id: 'e-0001',
    word: '最高',
    emotion: 'joy',
    t_start: 1,
    t_end: 1.4
}];
const legacySeat = [{
    id: 'e-0002',
    word: '従来',
    emotion: 'emphasis',
    t_start: 2,
    t_end: 2.4
}];

test('v2 は captions.json object ルートの emphasis_words がプレビューモデル入力に届く', () => {
    const captionsValue = readCaptionsEmphasisWords({ captions: [], emphasis_words: captionsSeat });
    const legacyValue = readLegacyEditEmphasisWords({ version: 2, tracks: [] });

    assert.equal(captionsValue, captionsSeat);
    assert.equal(legacyValue, undefined);
    assert.equal(resolvePreviewEmphasisWords(captionsValue, legacyValue), captionsSeat);
});

test('v0/v1 は captions.json に席がなければ edit.json emphasis_words へ後方互換フォールバックする', () => {
    for (const version of [0, 1]) {
        const captionsValue = readCaptionsEmphasisWords([]);
        const legacyValue = readLegacyEditEmphasisWords({ version, emphasis_words: legacySeat });

        assert.equal(captionsValue, undefined);
        assert.equal(legacyValue, legacySeat);
        assert.equal(resolvePreviewEmphasisWords(captionsValue, legacyValue), legacySeat);
    }
});

test('両席が在るとき captions.json 側だけを採用しマージしない', () => {
    const captionsValue = readCaptionsEmphasisWords({ captions: [], emphasis_words: captionsSeat });
    const legacyValue = readLegacyEditEmphasisWords({ version: 1, emphasis_words: legacySeat });

    assert.equal(resolvePreviewEmphasisWords(captionsValue, legacyValue), captionsSeat);
    assert.deepEqual(resolvePreviewEmphasisWords([], legacyValue), []);
});

test('席の優先順ヘルパーが RPC・直接読取・loadPreviewModel まで配線されている', async () => {
    const handlerSource = await readFile(
        new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url),
        'utf8'
    );
    const serviceSource = await readFile(
        new URL('../src/node/akari-preview-service.ts', import.meta.url),
        'utf8'
    );

    assert.match(handlerSource, /legacyEmphasisWords\s*=\s*readLegacyEditEmphasisWords\(rawEdit\)/u);
    assert.match(handlerSource, /const emphasisWords = this\.normalizeEmphasisWords\(resolvePreviewEmphasisWords\(\s*loadedCaptions\.emphasisWords,\s*legacyEmphasisWords/u);
    assert.match(handlerSource, /const emphasisWords = readCaptionsEmphasisWords\(root\)/u);
    assert.match(handlerSource, /emphasisWords:\s*resolved\.emphasisWords/u);
    assert.match(handlerSource, /captions:\s*outputCaptions,\s*emphasisWords,\s*summary:/u);
    assert.doesNotMatch(handlerSource, /normalizeEmphasisWords\(internal\.declaration\.emphasisWords\)/u);

    assert.match(serviceSource, /const captionsEmphasisWords = readCaptionsEmphasisWords\(captionsRoot\)/u);
    assert.match(serviceSource, /const legacyEmphasisWords = readLegacyEditEmphasisWords\(rawEdit\)/u);
    assert.match(serviceSource, /resolvePreviewEmphasisWords\(captionsEmphasisWords, legacyEmphasisWords\)/u);
    assert.match(serviceSource, /return \{ schema: resolved\.schema, captions: resolved\.display_cues, emphasisWords \}/u);
});
