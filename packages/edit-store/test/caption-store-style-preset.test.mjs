import assert from 'node:assert/strict';
import test from 'node:test';

import { updateCaptionStylePresetInSource } from '../lib/caption-store.js';

const caption = (id, extra = {}) => ({
  id, start: 0, end: 1, text: id, speaker: null, sourceRef: null, edited: false, ...extra
});
const lines = rows => `[
${rows.map(row => `  ${JSON.stringify(row)}`).join(',\n')}
]\n`;

test('単一行へ style_preset を追加する', () => {
  const result = updateCaptionStylePresetInSource(lines([caption('c-1')]), ['c-1'], 'subtitle-news');
  assert.equal(result.changed, 1);
  assert.equal(JSON.parse(result.source)[0].style_preset, 'subtitle-news');
});

test('複数行だけに一括適用し、非対象行はバイト同一', () => {
  const source = lines([caption('c-1'), caption('c-2'), caption('c-3')]);
  const result = updateCaptionStylePresetInSource(source, ['c-1', 'c-3'], 'subtitle-news');
  assert.equal(result.changed, 2);
  assert.equal(result.source.split('\n')[2], source.split('\n')[2]);
});

test('全行へ一括適用する', () => {
  const source = lines([caption('c-1'), caption('c-2'), caption('c-3')]);
  const result = updateCaptionStylePresetInSource(source, ['c-1', 'c-2', 'c-3'], 'subtitle-standard');
  assert.equal(result.changed, 3);
  assert.ok(JSON.parse(result.source).every(row => row.style_preset === 'subtitle-standard'));
});

test('null は style_preset キーだけを削除する', () => {
  const row = caption('c-1', { style_preset: 'subtitle-news', text_style: { color: '#abcdef' } });
  const source = lines([row]);
  const result = updateCaptionStylePresetInSource(source, ['c-1'], null);
  const updated = JSON.parse(result.source)[0];
  assert.equal(result.changed, 1);
  assert.equal(Object.hasOwn(updated, 'style_preset'), false);
  assert.deepEqual(updated.text_style, row.text_style);
});

test('既存値を置換する', () => {
  const source = lines([caption('c-1', { style_preset: 'subtitle-standard' })]);
  const result = updateCaptionStylePresetInSource(source, ['c-1'], 'subtitle-variety');
  assert.equal(result.changed, 1);
  assert.equal(JSON.parse(result.source)[0].style_preset, 'subtitle-variety');
});

test('同じ値の再適用は changed 0 で source がバイト同一', () => {
  const source = lines([caption('c-1', { style_preset: 'subtitle-news' })]);
  const result = updateCaptionStylePresetInSource(source, ['c-1'], 'subtitle-news');
  assert.deepEqual(result, { source, changed: 0 });
});

test('text_style 併存時はその直前へ追加し text_style をバイト不変にする', () => {
  const source = `[
  {
    "id": "c-1",
    "start": 0,
    "end": 1,
    "text": "caption",
    "speaker": null,
    "sourceRef": null,
    "edited": false,
    "text_style": { "color": "#abcdef", "stroke": { "width_px": 4 } }
  }
]\n`;
  const beforeStyle = source.match(/"text_style": \{[^\n]+/)[0];
  const result = updateCaptionStylePresetInSource(source, ['c-1'], 'subtitle-news');
  assert.ok(result.source.indexOf('"style_preset"') < result.source.indexOf('"text_style"'));
  assert.equal(result.source.match(/"text_style": \{[^\n]+/)[0], beforeStyle);
});

test('未知 caption id は部分適用せず throw する', () => {
  const source = lines([caption('c-1'), caption('c-2')]);
  assert.throws(
    () => updateCaptionStylePresetInSource(source, ['c-1', 'missing'], 'subtitle-news'),
    /missing.*ありません/
  );
  assert.equal(JSON.parse(source)[0].style_preset, undefined);
});

test('preset id の pattern 違反を拒否する', () => {
  assert.throws(
    () => updateCaptionStylePresetInSource(lines([caption('c-1')]), ['c-1'], 'Subtitle News'),
    /形式が不正/
  );
});

test('object ルート形式でも一括適用する', () => {
  const source = `${JSON.stringify({ version: 1, captions: [caption('c-1'), caption('c-2')] }, null, 2)}\n`;
  const result = updateCaptionStylePresetInSource(source, ['c-1', 'c-2'], 'subtitle-news');
  assert.equal(result.changed, 2);
  assert.ok(JSON.parse(result.source).captions.every(row => row.style_preset === 'subtitle-news'));
});

test('空の captionIds を拒否する', () => {
  assert.throws(
    () => updateCaptionStylePresetInSource(lines([caption('c-1')]), [], 'subtitle-news'),
    /1 件以上/
  );
});
