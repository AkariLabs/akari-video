import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    insertCaptionLine,
    removeCaptionLine,
    shiftCaptionLine,
    updateCaptionFieldsInSource
} = require('../lib/common/caption-store.js');

const caption = (id, start, text) => ({
    id,
    start,
    end: start + 1,
    text,
    speaker: null,
    sourceRef: { segment: 0 },
    edited: false
});

test('pretty-print と語タイミング付きレコードの top-level text/speaker だけを更新する', () => {
    const source = JSON.stringify([
        {
            ...caption('c-0001', 0, '更新前'),
            words: [
                { text: '内部 text は不変', speaker: '内部 speaker も不変', start: 0, end: 0.5 }
            ]
        },
        caption('c-0002', 2, '対象外')
    ], null, 2) + '\n';
    const untouchedStart = source.indexOf('  {\n    "id": "c-0002"');

    const updated = updateCaptionFieldsInSource(source, 'c-0001', {
        text: '更新後',
        speaker: '話者A'
    });

    assert.equal(JSON.parse(updated)[0].text, '更新後');
    assert.equal(JSON.parse(updated)[0].speaker, '話者A');
    assert.equal(JSON.parse(updated)[0].edited, true);
    assert.equal(JSON.parse(updated)[0].words[0].text, '内部 text は不変');
    assert.equal(JSON.parse(updated)[0].words[0].speaker, '内部 speaker も不変');
    assert.equal(updated.slice(updated.indexOf('  {\n    "id": "c-0002"')), source.slice(untouchedStart));
});

test('pretty-print レコードの start/end/edited を対象要素内だけで更新する', () => {
    const source = JSON.stringify([caption('c-0001', 1, '対象'), caption('c-0002', 4, '対象外')], null, 2);
    const untouched = source.slice(source.indexOf('  {\n    "id": "c-0002"'));
    const updated = shiftCaptionLine(source, 'c-0001', 0.25, 0.5);

    assert.equal(JSON.parse(updated)[0].start, 1.25);
    assert.equal(JSON.parse(updated)[0].end, 2.5);
    assert.equal(JSON.parse(updated)[0].edited, true);
    assert.equal(updated.slice(updated.indexOf('  {\n    "id": "c-0002"')), untouched);
});

test('1行形式の更新・挿入・削除に後方互換がある', () => {
    const source = `[${JSON.stringify(caption('c-0001', 0, 'one'))}, ${JSON.stringify(caption('c-0003', 4, 'three'))}]`;
    const updated = updateCaptionFieldsInSource(source, 'c-0001', { text: 'ONE' });
    const inserted = insertCaptionLine(updated, caption('c-0002', 2, 'two'));
    const removed = removeCaptionLine(inserted, 'c-0002');

    assert.equal(JSON.parse(updated)[0].text, 'ONE');
    assert.deepEqual(JSON.parse(inserted).map(item => item.id), ['c-0001', 'c-0002', 'c-0003']);
    assert.equal(removed, updated);
});

test('複数行整形の既存配列へ挿入・削除しても既存レコードのテキストを変えない', () => {
    const source = JSON.stringify([caption('c-0001', 0, 'one'), caption('c-0003', 4, 'three')], null, 2) + '\n';
    const inserted = insertCaptionLine(source, caption('c-0002', 2, 'two'));
    assert.deepEqual(JSON.parse(inserted).map(item => item.id), ['c-0001', 'c-0002', 'c-0003']);
    assert.equal(removeCaptionLine(inserted, 'c-0002'), source);
});

test('複数行の空配列へ挿入でき、複数行レコードを削除できる', () => {
    const inserted = insertCaptionLine('[\n]\n', caption('c-0001', 0, 'first'));
    assert.deepEqual(JSON.parse(inserted), [caption('c-0001', 0, 'first')]);
    assert.deepEqual(JSON.parse(removeCaptionLine(inserted, 'c-0001')), []);
});
