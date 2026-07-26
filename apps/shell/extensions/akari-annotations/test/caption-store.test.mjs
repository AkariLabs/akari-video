import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    insertCaptionLine,
    mergeCaptionTextStyles,
    parseCaptions,
    removeCaptionLine,
    shiftCaptionLine,
    updateCaptionFieldsInSource,
    updateCaptionTextStyleInSource
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

test('配列ルートと object ルートを読み、既定スタイルと個別スタイルを保持する', () => {
    const first = { ...caption('c-0001', 0, 'first'), text_style: { color: '#fff' } };
    const arrayParsed = parseCaptions(JSON.stringify([first]));
    assert.equal(arrayParsed.defaultTextStyle, undefined);
    assert.equal(arrayParsed.captions[0].textStyle.color, '#fff');

    const objectParsed = parseCaptions(JSON.stringify({
        default_text_style: {
            color: '#112233',
            stroke: { color: '#000000', width_px: 2 },
            background: { opacity: 0.4 }
        },
        captions: [first]
    }));
    assert.deepEqual(objectParsed.defaultTextStyle, {
        color: '#112233',
        stroke: { color: '#000000', widthPx: 2 },
        background: { opacity: 0.4 }
    });
    assert.equal(objectParsed.captions[0].textStyle.color, '#fff');
});

test('既定スタイルと個別スタイルをネストもキー単位で合成する', () => {
    assert.deepEqual(
        mergeCaptionTextStyles(
            {
                color: '#111111',
                stroke: { color: '#000000', widthPx: 1 },
                background: { color: '#222222', opacity: 0.3, radiusPx: 4 },
                zone: 'bottom'
            },
            {
                color: '#FFFFFF',
                stroke: { widthPx: 3 },
                background: { radiusPx: 12 },
                zone: 'top-right'
            }
        ),
        {
            color: '#FFFFFF',
            stroke: { color: '#000000', widthPx: 3 },
            background: { color: '#222222', opacity: 0.3, radiusPx: 12 },
            zone: 'top-right'
        }
    );
    assert.equal(mergeCaptionTextStyles(undefined, undefined), undefined);
});

test('object ルートの captions 配列だけを外科編集しルート形状を保存する', () => {
    const source = JSON.stringify({
        default_text_style: { color: '#FFFFFF' },
        captions: [caption('c-0001', 0, 'one'), caption('c-0002', 2, 'two')]
    }, null, 2) + '\n';
    const untouched = source.slice(source.indexOf('    {\n      "id": "c-0002"'));
    const updated = updateCaptionFieldsInSource(source, 'c-0001', { text: 'ONE' });

    assert.equal(Array.isArray(JSON.parse(updated)), false);
    assert.equal(JSON.parse(updated).captions[0].text, 'ONE');
    assert.equal(updated.slice(updated.indexOf('    {\n      "id": "c-0002"')), untouched);
});

test('object ルートへ挿入・削除しても default_text_style とルート形状を保存する', () => {
    const source = JSON.stringify({
        default_text_style: { color: '#FFFFFF', zone: 'bottom' },
        captions: [caption('c-0001', 0, 'one'), caption('c-0003', 4, 'three')]
    }, null, 2) + '\n';
    const inserted = insertCaptionLine(source, caption('c-0002', 2, 'two'));
    assert.deepEqual(JSON.parse(inserted).captions.map(item => item.id), ['c-0001', 'c-0002', 'c-0003']);
    assert.deepEqual(JSON.parse(inserted).default_text_style, { color: '#FFFFFF', zone: 'bottom' });
    assert.equal(removeCaptionLine(inserted, 'c-0002'), source);
});

test('text_style をフィールド単位で追加・更新・削除し他フィールドと他レコードを変えない', () => {
    const first = {
        ...caption('c-0001', 0, 'one'),
        words: [{ start: 0, end: 0.5, text: 'one' }],
        style: 'karaoke',
        text_style: {
            color: '#FFFFFF',
            stroke: { color: '#000000' },
            background: { color: '#112233', radius_px: 8 }
        }
    };
    const source = JSON.stringify([first, caption('c-0002', 2, 'two')], null, 2) + '\n';
    const untouched = source.slice(source.indexOf('  {\n    "id": "c-0002"'));
    const widthAdded = updateCaptionTextStyleInSource(source, 'c-0001', {
        stroke: { widthPx: 2.5 }
    });
    const opacityAdded = updateCaptionTextStyleInSource(widthAdded, 'c-0001', {
        background: { opacity: 0.6 }
    });
    const colorRemoved = updateCaptionTextStyleInSource(opacityAdded, 'c-0001', { color: null });
    const parsed = JSON.parse(colorRemoved)[0];

    assert.deepEqual(parsed.words, first.words);
    assert.equal(parsed.style, 'karaoke');
    assert.deepEqual(parsed.text_style.stroke, { color: '#000000', width_px: 2.5 });
    assert.deepEqual(parsed.text_style.background, { color: '#112233', radius_px: 8, opacity: 0.6 });
    assert.equal('color' in parsed.text_style, false);
    assert.equal(colorRemoved.slice(colorRemoved.indexOf('  {\n    "id": "c-0002"')), untouched);
});

test('text_style とネスト object を新設し undo 相当の null で空 object ごと除去する', () => {
    const source = JSON.stringify([caption('c-0001', 0, 'one')], null, 2) + '\n';
    const added = updateCaptionTextStyleInSource(source, 'c-0001', {
        background: { opacity: 0.5 }
    });
    assert.deepEqual(JSON.parse(added)[0].text_style, { background: { opacity: 0.5 } });

    const removed = updateCaptionTextStyleInSource(added, 'c-0001', {
        background: { opacity: null }
    });
    assert.equal('text_style' in JSON.parse(removed)[0], false);
    assert.equal(removed, source);
});

test('サイズだけの初回編集は既定/8桁hex座布団へ opacity 0 を混入させない', () => {
    const source = JSON.stringify({
        default_text_style: {
            background: { color: '#FF000080', mode: 'block' }
        },
        captions: [caption('c-0001', 0, 'one')]
    }, null, 2) + '\n';

    const updated = updateCaptionTextStyleInSource(source, 'c-0001', { sizePx: 48 });
    const parsed = parseCaptions(updated);

    assert.deepEqual(JSON.parse(updated).captions[0].text_style, { size_px: 48 });
    assert.deepEqual(parsed.defaultTextStyle.background, { color: '#FF000080', mode: 'block' });
    assert.deepEqual(
        mergeCaptionTextStyles(parsed.defaultTextStyle, parsed.captions[0].textStyle).background,
        { color: '#FF000080', mode: 'block' }
    );
});

test('background.mode を単独追加・更新・削除できる', () => {
    const source = JSON.stringify([caption('c-0001', 0, 'one')], null, 2) + '\n';
    const block = updateCaptionTextStyleInSource(source, 'c-0001', {
        background: { mode: 'block' }
    });
    assert.deepEqual(JSON.parse(block)[0].text_style, { background: { mode: 'block' } });
    assert.equal(parseCaptions(block).captions[0].textStyle.background.mode, 'block');

    const removed = updateCaptionTextStyleInSource(block, 'c-0001', {
        background: { mode: null }
    });
    assert.equal(removed, source);
});

test('3字幕へ同じ絶対スタイルを順次適用しても非選択レコードはバイト不変', () => {
    const source = JSON.stringify([
        caption('c-0001', 0, 'one'),
        { ...caption('c-0002', 2, 'two'), text_style: { color: '#FFFFFF' } },
        { ...caption('c-0003', 4, 'three'), text_style: { color: '#FFD700' } },
        { ...caption('c-0004', 6, 'untouched'), text_style: { color: '#00FF00', zone: 'top' } }
    ], null, 2) + '\n';
    const untouched = source.slice(source.indexOf('  {\n    "id": "c-0004"'));
    let updated = source;
    for (const id of ['c-0001', 'c-0002', 'c-0003']) {
        updated = updateCaptionTextStyleInSource(updated, id, { color: '#3366FF' });
    }

    assert.deepEqual(
        JSON.parse(updated).slice(0, 3).map(item => item.text_style.color),
        ['#3366FF', '#3366FF', '#3366FF']
    );
    assert.equal(updated.slice(updated.indexOf('  {\n    "id": "c-0004"')), untouched);
});

test('text_style なしレコードの挿入シリアライズは従来のバイト列を維持する', () => {
    const record = caption('c-0001', 0, 'one');
    const expected = `{ "id": "c-0001", "start": 0, "end": 1, "text": "one", "speaker": null, "sourceRef": {"segment":0}, "edited": false }`;
    assert.equal(insertCaptionLine('[]', record), `[${expected}]`);
    const styled = { ...record, textStyle: { color: '#AABBCC', sizePx: 42 } };
    assert.match(insertCaptionLine('[]', styled), /"text_style": \{"color":"#AABBCC","size_px":42\}/);
});
