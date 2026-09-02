import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCaptionStylePresets,
  mergePresetTextStyle,
  parseCaptions,
  resolveCaptionStylePreset,
  TEXTSTYLE_CATALOG,
} from '../lib/index.js';
import { mergeCaptionTextStyles } from '../../render-cut/src/captions.mjs';

const preset = {
  id: 'sample',
  name: 'Sample',
  category: 'subtitle',
  style: {
    color: '#ffffff',
    size_px: 56,
    stroke: { color: '#000000', width_px: 4 },
    animation: { in: { id: 'fade-up' }, out: { id: 'soft-fade' } },
  },
};
const catalog = { sample: preset };

test('record text_style が preset より高い優先順位で解決される', () => {
  const input = { id: 'c-0001', style_preset: 'sample', text_style: { color: '#ff0000' } };
  const resolved = resolveCaptionStylePreset(input, catalog);
  assert.equal(resolved.resolved, true);
  assert.deepEqual(resolved.record.text_style, {
    ...preset.style,
    color: '#ff0000',
  });
});

test('default < preset < record の全優先順を既存 merge と組み合わせて保つ', () => {
  const resolved = resolveCaptionStylePreset({
    style_preset: 'sample',
    text_style: { color: '#ff0000' },
  }, catalog).record;
  const effective = mergeCaptionTextStyles(
    { color: '#00ff00', size_px: 30, weight: 400 },
    resolved.text_style,
  );
  assert.equal(effective.color, '#ff0000');
  assert.equal(effective.size_px, 56);
  assert.equal(effective.weight, 400);
});

test('stroke はキー単位で上書きする', () => {
  assert.deepEqual(
    mergePresetTextStyle(preset.style, { stroke: { width_px: 9 } }).stroke,
    { color: '#000000', width_px: 9 },
  );
});

test('animation は in/loop/out のスロット単位で上書きする', () => {
  assert.deepEqual(
    mergePresetTextStyle(preset.style, {
      animation: { in: { id: 'zoom-pop' }, loop: { id: 'float' } },
    }).animation,
    {
      in: { id: 'zoom-pop' },
      loop: { id: 'float' },
      out: { id: 'soft-fade' },
    },
  );
});

test('解決後も style_preset キーを残す', () => {
  const resolved = resolveCaptionStylePreset({ style_preset: 'sample' }, catalog);
  assert.equal(resolved.record.style_preset, 'sample');
});

test('未知 id は record の参照を保ち unresolved に載せる', () => {
  const record = { id: 'c-0001', style_preset: 'missing' };
  const direct = resolveCaptionStylePreset(record, catalog);
  assert.equal(direct.record, record);
  assert.equal(direct.resolved, false);
  const root = [record];
  const applied = applyCaptionStylePresets(root, catalog);
  assert.equal(applied.root, root);
  assert.equal(applied.root[0], record);
  assert.deepEqual(applied.unresolved, ['missing']);
});

test('caption-store parseCaptions は inspector 用 textStyle に解決値を反映する', () => {
  const parsed = parseCaptions(JSON.stringify([{
    id: 'c-0001', start: 0, end: 1, text: '字幕', speaker: null,
    sourceRef: null, edited: false, style_preset: 'subtitle-standard',
    text_style: { color: '#ffee00' },
  }]));
  assert.equal(parsed.captions[0].textStyle.color, '#ffee00');
  assert.equal(parsed.captions[0].textStyle.sizePx, 56);
  assert.deepEqual(parsed.captions[0].textStyle.stroke, { color: '#000000', widthPx: 4 });
});

test('style_preset 無しの配列ルートは入力参照をそのまま返す', () => {
  const root = [{ id: 'c-0001', text_style: { color: '#ffffff' } }];
  assert.equal(applyCaptionStylePresets(root, catalog).root, root);
});

test('style_preset 無しの object ルートは入力参照をそのまま返す', () => {
  const root = { default_text_style: { color: '#ffffff' }, captions: [{ id: 'c-0001' }] };
  assert.equal(applyCaptionStylePresets(root, catalog).root, root);
});

test('配列ルートの captions を解決する', () => {
  const root = [{ id: 'c-0001', style_preset: 'sample' }];
  const applied = applyCaptionStylePresets(root, catalog);
  assert.notEqual(applied.root, root);
  assert.equal(applied.root[0].text_style.size_px, 56);
});

test('object ルートの captions だけを写像し default_text_style は触らない', () => {
  const defaultTextStyle = { color: '#00ff00' };
  const root = {
    default_text_style: defaultTextStyle,
    metadata: { keep: true },
    captions: [{ id: 'c-0001', style_preset: 'sample' }],
  };
  const applied = applyCaptionStylePresets(root, catalog);
  assert.notEqual(applied.root, root);
  assert.equal(applied.root.default_text_style, defaultTextStyle);
  assert.equal(applied.root.metadata, root.metadata);
  assert.equal(applied.root.captions[0].text_style.color, '#ffffff');
});

test('同じ未知 id は unresolved で重複しない', () => {
  const applied = applyCaptionStylePresets([
    { style_preset: 'missing' },
    { style_preset: 'missing' },
  ], catalog);
  assert.deepEqual(applied.unresolved, ['missing']);
});

test('ReadonlyMap カタログを受理する', () => {
  const record = { style_preset: 'sample' };
  const resolved = resolveCaptionStylePreset(record, new Map([['sample', preset]]));
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.record.text_style.color, '#ffffff');
});

for (const [id, item] of Object.entries(TEXTSTYLE_CATALOG)) {
  test(`${id}: render-cut merge と 2 種の上書きで同値`, () => {
    for (const override of [
      {
        color: '#abcdef',
        stroke: { width_px: 2 },
        animation: { out: { id: 'soft-fade' } },
      },
      {
        background: { radius_px: 7 },
        shadow: { color: '#123456', opacity: 0.25 },
        position: { x: 0.2 },
      },
    ]) {
      const resolved = resolveCaptionStylePreset({ style_preset: id, text_style: override }, TEXTSTYLE_CATALOG);
      assert.deepEqual(resolved.record.text_style, mergeCaptionTextStyles(item.style, override));
    }
  });
}
