import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { insertCaptionLine } from '../lib/caption-store.js';

const schema = JSON.parse(await readFile(
  new URL('../../schemas/captions.schema.json', import.meta.url),
  'utf8'
));
const captionSchema = schema.$defs.captionRecord;
const schemaKeys = Object.keys(captionSchema.properties);
const requiredKeys = new Set(captionSchema.required);
const optionalKeys = schemaKeys.filter(key => !requiredKeys.has(key));

const optionalValues = {
  src: { field: 'src', value: 'clip-01', json: 'clip-01' },
  time_domain: { field: 'timeDomain', value: 'source', json: 'source' },
  words: {
    field: 'words',
    value: [{ start: 0, end: 1, text: 'あ' }],
    json: [{ start: 0, end: 1, text: 'あ' }]
  },
  unrecognized: {
    field: 'unrecognized',
    value: [{ start: 1, end: 1.2 }],
    json: [{ start: 1, end: 1.2 }]
  },
  style: { field: 'style', value: 'karaoke', json: 'karaoke' },
  display_text: { field: 'displayText', value: '表示テキストです。', json: '表示テキストです。' },
  display_fragments: { field: 'displayFragments', value: ['前半', '後半'], json: ['前半', '後半'] },
  style_preset: { field: 'stylePreset', value: 'subtitle-standard', json: 'subtitle-standard' },
  text_style: { field: 'textStyle', value: { color: '#ffffff' }, json: { color: '#ffffff' } }
};

const baseCaption = () => ({
  id: 'c-0001',
  start: 0,
  end: 2,
  text: '字幕です。',
  speaker: null,
  sourceRef: null,
  edited: false
});

function insert(record) {
  return JSON.parse(insertCaptionLine('[]', record))[0];
}

test('ダミー値表はスキーマの任意キーを全部覆う', () => {
  assert.deepEqual(Object.keys(optionalValues).sort(), [...optionalKeys].sort());
});

test('任意キー全部入りレコードは値まで保全する', () => {
  const record = baseCaption();
  for (const key of optionalKeys) {
    const sample = optionalValues[key];
    record[sample.field] = sample.value;
  }
  const inserted = insert(record);
  for (const key of optionalKeys) {
    assert.deepEqual(inserted[key], optionalValues[key].json, key);
  }
});

test('出力キー順はスキーマ宣言順と一致する', () => {
  const record = baseCaption();
  for (const key of optionalKeys) {
    const sample = optionalValues[key];
    record[sample.field] = sample.value;
  }
  assert.deepEqual(Object.keys(insert(record)), schemaKeys);
});

for (const key of optionalKeys) {
  test(`任意キー ${key} だけを持つレコードでも値を保全する`, () => {
    const sample = optionalValues[key];
    const inserted = insert({ ...baseCaption(), [sample.field]: sample.value });
    assert.deepEqual(inserted[key], sample.json);
  });
}

test('extra の未知キーを末尾へ元の順で保全する', () => {
  const inserted = insert({
    ...baseCaption(),
    extra: { x_future_key: { a: 1 }, x_note: 'メモ' }
  });
  assert.deepEqual(inserted.x_future_key, { a: 1 });
  assert.equal(inserted.x_note, 'メモ');
  assert.deepEqual(Object.keys(inserted).slice(-2), ['x_future_key', 'x_note']);
});

test('extra の既知キーは二重出力しない', () => {
  const source = insertCaptionLine('[]', {
    ...baseCaption(),
    textStyle: { color: '#ffffff' },
    extra: { text_style: { color: '#000000' } }
  });
  assert.equal(source.match(/"text_style"/gu)?.length, 1);
  assert.deepEqual(JSON.parse(source)[0].text_style, { color: '#ffffff' });
});

test('任意キーゼロのレコードは従来のバイト列を維持する', () => {
  assert.equal(
    insertCaptionLine('[]', baseCaption()),
    '[{ "id": "c-0001", "start": 0, "end": 2, "text": "字幕です。", "speaker": null, "sourceRef": null, "edited": false }]'
  );
});
