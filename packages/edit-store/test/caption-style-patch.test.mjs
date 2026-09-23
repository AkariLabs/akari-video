import assert from 'node:assert/strict';
import test from 'node:test';
import { updateCaptionTextStyleInSource } from '../lib/caption-store.js';

const caption = style => JSON.stringify([{
  id: 'c-1', start: 0, end: 1, text: '字幕', speaker: null,
  sourceRef: null, edited: false, ...(style === undefined ? {} : { text_style: style })
}]);
const write = (source, patch) => JSON.parse(updateCaptionTextStyleInSource(source, 'c-1', patch))[0];

test('新規 text_style に全項目を JSON 化する', () => {
  const style = write(caption(), {
    fontWeight: 700, weight: null, lineHeight: 1.3, letterSpacingEm: -0.04,
    fontFamily: 'Dela Gothic One', background: { paddingPx: 12 },
    shadow: { color: '#000000', opacity: 0.75, blurPx: 2, distancePx: 8.5, angleDeg: 45 },
    glow: { color: '#39D5FF', density: 60, spread: 12 }
  }).text_style;
  assert.deepEqual(style, {
    font_weight: 700, line_height: 1.3, letter_spacing_em: -0.04,
    font_family: 'Dela Gothic One', background: { padding_px: 12 },
    shadow: { color: '#000000', opacity: 0.75, blur_px: 2, distance_px: 8.5, angle_deg: 45 },
    glow: { color: '#39D5FF', density: 60, spread: 12 }
  });
});

test('既存 style を外科編集し null は項目を消す', () => {
  const source = caption({ color: '#FFFFFF', weight: 400,
    background: { color: '#111111', padding_px: 4 }, line_height: 1.42 });
  const changed = write(source, { fontWeight: 900, weight: null,
    lineHeight: null, background: { paddingPx: null } }).text_style;
  assert.deepEqual(changed, { color: '#FFFFFF', background: { color: '#111111' }, font_weight: 900 });
  assert.deepEqual(write(caption({ weight: 400 }), { fontWeight: 700 }).text_style,
    { font_weight: 700 });
  assert.deepEqual(write(caption({ background: { padding_px: 4 } }),
    { background: { paddingPx: null } }), JSON.parse(caption())[0]);
});

test('shadow と glow はオブジェクトごと置換・削除する', () => {
  const source = caption({ shadow: { color: '#111111', blur_px: 20 }, glow: { color: '#FFFFFF' } });
  const changed = write(source, { shadow: { color: '#000000', distancePx: 4 }, glow: null }).text_style;
  assert.deepEqual(changed, { shadow: { color: '#000000', distance_px: 4 } });
  assert.deepEqual(write(caption({ shadow: { color: '#FFFFFF' } }), { shadow: null }), JSON.parse(caption())[0]);
});

test('スキーマ外の値を拒否する', () => {
  for (const patch of [
    { fontWeight: 0 }, { fontWeight: 1001 }, { fontWeight: 600.5 },
    { weight: 99 }, { weight: 901 }, { weight: 450.5 },
    { lineHeight: 0 }, { letterSpacingEm: Infinity }, { fontFamily: '' },
    { background: { paddingPx: -1 } }, { shadow: { color: 'black' } },
    { shadow: { color: '#000000', opacity: 2 } },
    { shadow: { color: '#000000', blurPx: -1 } },
    { shadow: { color: '#000000', angleDeg: Infinity } },
    { shadow: { color: '#000000', invented: 1 } },
    { glow: { color: '#000000', density: -1 } },
    { glow: { color: '#000000', spread: NaN } },
    { glow: { color: '#000000', invented: 1 } }
  ]) assert.throws(() => write(caption(), patch), JSON.stringify(patch));
});
