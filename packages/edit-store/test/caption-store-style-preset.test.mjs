import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCaptions, updateCaptionStylePresetInSource } from '../lib/caption-store.js';
import { resolveCaptionStylePreset } from '../lib/caption-style-preset.js';
import { captionDefaultSizePx, resolveCaptionLineStyleVars } from '../lib/caption-display.js';
import { scaledCaptionLook } from '../lib/caption-look-scale.js';
import { TEXTSTYLE_CATALOG } from '../lib/generated/textstyle-catalog.js';

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
  assert.equal(updated.text_style.color, row.text_style.color);
  assert.ok(updated.text_style.size_px > 0);
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

test('既存のプリセットは読み込みだけでは大きさもソースも変わらない', () => {
  const source = lines([caption('c-1', { style_preset: 'emphasis-red' })]);
  const before = resolveCaptionStylePreset(JSON.parse(source)[0],
    { 'emphasis-red': { style: { size_px: 92 } } }).record.text_style.size_px;
  assert.equal(parseCaptions(source).captions[0].textStyle.sizePx, before);
  assert.equal(source, lines([caption('c-1', { style_preset: 'emphasis-red' })]));
});

test('text_style 併存時はその直前へ追加し、テンプレが決めないツマミは残す', () => {
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
  const result = updateCaptionStylePresetInSource(source, ['c-1'], 'subtitle-news');
  assert.ok(result.source.indexOf('"style_preset"') < result.source.indexOf('"text_style"'));
  // subtitle-news が決めるのは size_px / weight / color / background。color は
  // テンプレへ明け渡し、テンプレが触らない stroke は字幕個別の指定として残す。
  assert.deepEqual(JSON.parse(result.source)[0].text_style, { stroke: { width_px: 4 } });
});

test('テンプレを覆い隠していた text_style のキーだけを落とす', () => {
  // オーナー報告 2026-09-04 の再現データ: 字幕生成の既定値が text_style に丸ごと書かれていて、
  // テンプレを当てても size_px / weight / color / stroke が全部はじかれ見た目が変わらなかった。
  const row = caption('c-1', {
    text_style: {
      size_px: 56, weight: 700, color: '#ffffff', line_height: 1.35,
      max_characters: 20, max_width_pct: 90, zone: 'bottom',
      stroke: { color: '#000000', width_px: 4 }
    }
  });
  const result = updateCaptionStylePresetInSource(lines([row]), ['c-1'], 'subtitle-standard');
  const updated = JSON.parse(result.source)[0];
  assert.equal(result.changed, 1);
  assert.equal(updated.style_preset, 'subtitle-standard');
  // 大きさだけは字幕個別の指定として残す。
  assert.deepEqual(updated.text_style, {
    size_px: 56, line_height: 1.35, max_characters: 20, max_width_pct: 90, zone: 'bottom'
  });
});

test('ドラッグで動かした位置はテンプレ適用でも残る', () => {
  // position / text_anchor はどのテンプレも決めないツマミ（= 字幕個別の意思）。
  const row = caption('c-1', {
    text_style: {
      size_px: 56, color: '#ffffff', text_anchor: 'bc', position: { y: 0.6276 }
    }
  });
  const result = updateCaptionStylePresetInSource(lines([row]), ['c-1'], 'neon');
  const updated = JSON.parse(result.source)[0];
  assert.deepEqual(updated.text_style, { size_px: 56, text_anchor: 'bc', position: { y: 0.6276 },
    ...Object.fromEntries(['shadow', 'glow'].map(key => [key, scaledCaptionLook(TEXTSTYLE_CATALOG.neon.style, 56)[key]])) });
});

test('見た目を全て明け渡しても大きさは残す', () => {
  const row = caption('c-1', {
    text_style: { size_px: 56, weight: 700, color: '#ffffff', stroke: { color: '#000000', width_px: 4 } }
  });
  const result = updateCaptionStylePresetInSource(lines([row]), ['c-1'], 'subtitle-standard');
  const updated = JSON.parse(result.source)[0];
  assert.deepEqual(updated.text_style, { size_px: 56 });
  assert.equal(updated.style_preset, 'subtitle-standard');
});

test('異なるテンプレへ当て替えても出力 px と個別指定を保ち、外しても保つ', () => {
  const catalog = {
    first: { style: { size_px: 60, reference_height_px: 720, color: '#111' } },
    second: { style: { size_px: 120, reference_height_px: 1080, color: '#222' } },
    third: { style: { size_px: 200, reference_height_px: 1440, color: '#333' } },
  };
  const initial = lines([caption('c-1', { style_preset: 'first' })]);
  const sizeAt = (source, height) => {
    const row = JSON.parse(source)[0];
    const style = resolveCaptionStylePreset(row, catalog).record.text_style;
    return resolveCaptionLineStyleVars(style, { width: 1920, height })['--caption-font-size'];
  };
  for (const height of [720, 1080, 2160]) assert.equal(sizeAt(initial, height), `${60 * height / 720}px`);
  const second = updateCaptionStylePresetInSource(initial, ['c-1'], 'second', { catalog }).source;
  const third = updateCaptionStylePresetInSource(second, ['c-1'], 'third', { catalog }).source;
  const removed = updateCaptionStylePresetInSource(third, ['c-1'], null, { catalog }).source;
  for (const source of [second, third, removed]) {
    assert.deepEqual(JSON.parse(source)[0].text_style, { size_px: 60, reference_height_px: 720 });
    for (const height of [720, 1080, 2160]) assert.equal(sizeAt(source, height), sizeAt(initial, height));
  }
});

test('縦長の無指定字幕は output の既定サイズを保ち、output 不明なら推測しない', () => {
  const source = lines([caption('c-1')]);
  const catalog = { large: { style: { size_px: 120 } } };
  const output = { width: 1080, height: 1920 };
  const applied = JSON.parse(updateCaptionStylePresetInSource(source, ['c-1'], 'large',
    { catalog, output }).source)[0];
  assert.equal(applied.text_style.size_px, 65);
  assert.equal(resolveCaptionLineStyleVars(resolveCaptionStylePreset(applied, catalog).record.text_style,
    output)['--caption-font-size'], '65px');
  const withoutOutput = JSON.parse(updateCaptionStylePresetInSource(source, ['c-1'], 'large', { catalog }).source)[0];
  assert.equal(withoutOutput.text_style, undefined);
  assert.equal(resolveCaptionStylePreset(withoutOutput, catalog).record.text_style.size_px, 120);
  assert.equal(captionDefaultSizePx({ width: 1920, height: 1080 }), 38);
});

test('基準高さなしからありへ output で換算し、output 不明なら拒否せず従来どおり当てる', () => {
  const source = lines([caption('c-1')]);
  const catalog = { scaled: { style: { size_px: 90, reference_height_px: 1080 } } };
  const output = { width: 1080, height: 1920 };
  const applied = JSON.parse(updateCaptionStylePresetInSource(source, ['c-1'], 'scaled',
    { catalog, output }).source)[0];
  assert.equal(applied.text_style.size_px, 65 * 1080 / 1920);
  assert.equal(resolveCaptionLineStyleVars(resolveCaptionStylePreset(applied, catalog).record.text_style,
    output)['--caption-font-size'], '65px');
  const withoutOutput = JSON.parse(updateCaptionStylePresetInSource(source, ['c-1'], 'scaled', { catalog }).source)[0];
  assert.equal(withoutOutput.text_style, undefined);
  assert.equal(withoutOutput.style_preset, 'scaled');
  assert.equal(JSON.parse(source)[0].text_style, undefined);
});

test('既存の個別サイズも新しい基準高さへ換算する', () => {
  const source = lines([caption('c-1', { text_style: { size_px: 56 } })]);
  const catalog = { scaled: { style: { size_px: 90, reference_height_px: 1080 } } };
  const output = { width: 1080, height: 1920 };
  const applied = JSON.parse(updateCaptionStylePresetInSource(source, ['c-1'], 'scaled',
    { catalog, output }).source)[0];
  assert.equal(applied.text_style.size_px, 56 * 1080 / 1920);
  assert.equal(resolveCaptionLineStyleVars(resolveCaptionStylePreset(applied, catalog).record.text_style,
    output)['--caption-font-size'], '56px');
  const withoutOutput = JSON.parse(updateCaptionStylePresetInSource(source, ['c-1'], 'scaled', { catalog }).source)[0];
  assert.equal(withoutOutput.text_style.size_px, 56);
});

test('同じテンプレの再適用でも、覆い隠している指定が残っていれば掃除する', () => {
  // 「効かないからもう一度押す」を changed 0 で突き返さない。
  const row = caption('c-1', { style_preset: 'subtitle-news', text_style: { color: '#ffffff', zone: 'bottom' } });
  const result = updateCaptionStylePresetInSource(lines([row]), ['c-1'], 'subtitle-news');
  assert.equal(result.changed, 1);
  assert.deepEqual(JSON.parse(result.source)[0].text_style, { zone: 'bottom', size_px: 56 });
});

test('カタログに無いテンプレ id でも元の見た目と大きさを残す', () => {
  const row = caption('c-1', { text_style: { color: '#ffffff' } });
  const result = updateCaptionStylePresetInSource(lines([row]), ['c-1'], 'not-in-catalog');
  const updated = JSON.parse(result.source)[0];
  assert.equal(updated.style_preset, 'not-in-catalog');
  assert.deepEqual(updated.text_style, { color: '#ffffff' });
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
