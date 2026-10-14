import assert from 'node:assert/strict';
import test from 'node:test';
import { updateCaptionTextStyleInSource } from '../lib/caption-store.js';
import { captionValueHash } from '../lib/index.js';

const caption = style => JSON.stringify([{
  id: 'c-1', start: 0, end: 1, text: '字幕', speaker: null,
  sourceRef: null, edited: false, ...(style === undefined ? {} : { text_style: style })
}]);
const write = (source, patch) => JSON.parse(updateCaptionTextStyleInSource(source, 'c-1', patch))[0];

test('既存の複数の不正値は一つずつ直せるが新しい不正値は拒む', () => {
  const broken = caption({ color: 'red', shadow: { blur_px: 4 } });
  const color = write(broken, { color: '#ff0000' }).text_style;
  assert.equal(color.color, '#ff0000');
  assert.deepEqual(color.shadow, { blur_px: 4 });
  const shadow = write(broken, { shadow: { color: '#000000' } }).text_style;
  assert.equal(shadow.color, 'red');
  assert.equal(shadow.shadow.color, '#000000');
  assert.throws(() => write(broken, { animation: { in: { id: 'typewriter', ease: null } } }),
    /text_style\.animation/);
  assert.throws(() => write(caption({ color: '#ffffff' }),
    { animation: { in: { id: 'typewriter', ease: null } } }), /text_style\.animation/);
});

test('古い大きさ入口も行と範囲の px を同じ比で換算し色はその後に当てる', () => {
  const first = { id: 'c-1', start: 0, end: 2, text: '猫犬',
    text_style: { size_px: 38, stroke: { color: '#000000', width_px: 4 } },
    runs: [{ id: 'r-0001', from: 0, to: 1, look: { background: { color: '#ffd948', padding_px: 10 } } }] };
  const other = { id: 'c-2', start: 2, end: 4, text: '鳥' };
  const source = JSON.stringify({ default_text_style: { color: '#ffffff' }, captions: [first, other] }, null, 2);
  const written = updateCaptionTextStyleInSource(source, 'c-1', { sizePx: 72, color: '#123456' });
  const root = JSON.parse(written);
  assert.equal(root.captions[0].text_style.stroke.width_px, 7.578947);
  assert.equal(root.captions[0].runs[0].look.background.padding_px, 18.947368);
  assert.equal(root.captions[0].text_style.color, '#123456');
  assert.equal(JSON.stringify(root.captions[1]), JSON.stringify(other));
  assert.equal(JSON.stringify(root.default_text_style), JSON.stringify({ color: '#ffffff' }));
  assert.equal(updateCaptionTextStyleInSource(source, 'c-1', { sizePx: 38 }), source);
});

test('古い大きさ入口はライブラリ preset を解き範囲の出所 hash も更新する', () => {
  const runLook = { background: { color: '#ffd948', padding_px: 10 } };
  const root = { captions: [{ id: 'c-1', start: 0, end: 2, text: '猫', style_preset: 'custom',
    runs: [{ id: 'r-0001', from: 0, to: 1, look: runLook,
      style_sources: { look: { kind: 'library', id: 'custom', original_hash: 'a',
        applied_hash: captionValueHash(runLook) } } }] }] };
  const catalog = { custom: { id: 'custom', style: { size_px: 58,
    stroke: { color: '#000000', width_px: 5 } } } };
  const result = JSON.parse(updateCaptionTextStyleInSource(JSON.stringify(root), 'c-1', { sizePx: 72 }, catalog));
  assert.equal(result.captions[0].style_preset, undefined);
  assert.equal(result.captions[0].text_style.stroke.width_px, 6.206897);
  const run = result.captions[0].runs[0];
  assert.equal(run.style_sources.look.applied_hash, captionValueHash(run.look));
});

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

test('座布団 fit は他の background を保って追加でき、text 選択でキーを消す', () => {
  const source = caption({ background: { color: '#111111', width_pct: 100, mode: 'block' } });
  const frame = updateCaptionTextStyleInSource(source, 'c-1', { background: { fit: 'frame' } });
  assert.deepEqual(JSON.parse(frame)[0].text_style.background,
    { color: '#111111', width_pct: 100, mode: 'block', fit: 'frame' });
  assert.equal(updateCaptionTextStyleInSource(frame, 'c-1', { background: { fit: null } }), source);
  assert.throws(() => write(source, { background: { fit: 'foo' } }), /座布団の幅/u);
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
