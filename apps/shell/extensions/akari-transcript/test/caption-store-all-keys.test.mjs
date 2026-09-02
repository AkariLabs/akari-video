import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseCaptions, regenerateCaptions, serializeCaptions } = require('../lib/browser/caption-store.js');

const schema = JSON.parse(await readFile(
    new URL('../../../../../packages/schemas/captions.schema.json', import.meta.url),
    'utf8'
));
const captionSchema = schema.$defs.captionRecord;
const schemaKeys = Object.keys(captionSchema.properties);
const requiredKeys = new Set(captionSchema.required);
const optionalKeys = schemaKeys.filter(key => !requiredKeys.has(key));

const optionalValues = {
    src: 'clip-01',
    time_domain: 'source',
    words: [{ start: 0, end: 1, text: 'あ' }],
    unrecognized: [{ start: 1, end: 1.2 }],
    style: 'karaoke',
    display_text: '表示テキストです。',
    display_fragments: ['前半', '後半'],
    style_preset: 'subtitle-standard',
    text_style: { color: '#ffffff' }
};

const baseRecord = edited => ({
    id: 'c-0001',
    start: 0,
    end: 2,
    text: '字幕です。',
    speaker: null,
    sourceRef: { segment: 0 },
    edited
});

const analysisSource = JSON.stringify({
    transcript: [{ start: 0, end: 2, text: '再生成した字幕です。' }]
});

function allOptionalRecord(edited = true) {
    return Object.assign(baseRecord(edited), optionalValues);
}

function regeneratedRecord(existing) {
    return JSON.parse(regenerateCaptions(analysisSource, JSON.stringify([existing])).source)[0];
}

test('ダミー値表はスキーマの任意キーを全部覆う', () => {
    assert.deepEqual(Object.keys(optionalValues).sort(), [...optionalKeys].sort());
});

test('edited:true 温存ブランチは任意キー全部を値まで保全する', () => {
    const output = regeneratedRecord(allOptionalRecord());
    for (const key of optionalKeys) {
        assert.deepEqual(output[key], optionalValues[key], key);
    }
});

test('出力キー順はスキーマ宣言順と一致する', () => {
    assert.deepEqual(Object.keys(regeneratedRecord(allOptionalRecord())), schemaKeys);
});

test('extra の未知キーは再生成と parse → serialize の両方で保全する', () => {
    const existing = { ...baseRecord(true), x_future_key: { a: 1 }, x_note: 'メモ' };
    const regenerated = regeneratedRecord(existing);
    assert.deepEqual(regenerated.x_future_key, { a: 1 });
    assert.equal(regenerated.x_note, 'メモ');
    assert.deepEqual(Object.keys(regenerated).slice(-2), ['x_future_key', 'x_note']);

    const source = JSON.stringify([existing]);
    const roundTrip = JSON.parse(serializeCaptions(parseCaptions(source).captions))[0];
    assert.deepEqual(roundTrip.x_future_key, { a: 1 });
    assert.equal(roundTrip.x_note, 'メモ');
});

for (const [key, value] of [
    ['display_text', '古い表示テキスト'],
    ['display_fragments', ['古い', '断片']]
]) {
    test(`セグメント再構築では ${key} を落とす`, () => {
        const output = regeneratedRecord({ ...baseRecord(false), [key]: value });
        assert.equal(Object.hasOwn(output, key), false);
    });
}

for (const [key, value] of [
    ['src', 'clip-01'],
    ['time_domain', 'output'],
    ['style', 'karaoke'],
    ['style_preset', 'subtitle-standard'],
    ['text_style', { color: '#ffffff' }]
]) {
    test(`セグメント再構築でも ${key} を保つ`, () => {
        assert.deepEqual(regeneratedRecord({ ...baseRecord(false), [key]: value })[key], value);
    });
}

test('任意キー全部入りレコードは parse → serialize でバイト等価になる', () => {
    const record = allOptionalRecord();
    const serializedRecord = `{${schemaKeys.map(key =>
        `${JSON.stringify(key)}:${JSON.stringify(record[key])}`).join(',')}}`;
    const source = `[\n  ${serializedRecord}\n]\n`;
    assert.equal(serializeCaptions(parseCaptions(source).captions), source);
});
