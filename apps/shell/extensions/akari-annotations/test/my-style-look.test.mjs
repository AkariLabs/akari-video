import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveMyStyleLook, myStyleLookPatch, myStyleApplyNotice, placedMyStyleTextStyle,
  unsupportedMyStyleLookFields, replaceMyStyleLookInSource, appendMyStyleUsage,
  myStyleOutputHeight, newMyStyleSlug } from '../lib/browser/my-style-look.js';
import { parseCaptions } from '../../../../../packages/edit-store/lib/caption-store.js';
import { resolveCaptionReferenceScale, scaleCaptionPx, captionTextShadowValue } from '../../../../../packages/edit-store/lib/caption-display.js';

test('実効の見た目を解決し、位置と動きを保存しない', () => {
  const look = effectiveMyStyleLook({ color: '#ffffff', stroke: { color: '#000000', widthPx: 2 },
    zone: 'bottom', position: { y: 0.8 } }, { color: '#ff1744', stroke: { widthPx: 6 },
    background: { color: '#111111', opacity: 0.7, widthPct: 40 },
    animation: { in: { id: 'pop' } }, textAnchor: 'tc', layout: { mode: 'reference-pixel' } }, 1920);
  assert.deepEqual(look, { color: '#ff1744', stroke: { color: '#000000', width_px: 6 },
    background: { color: '#111111', opacity: 0.7 },
    shadow: { color: '#000000', opacity: 0 }, glow: { color: '#000000', density: 0 },
    reference_height_px: 1920 });
  assert.deepEqual(myStyleLookPatch({ color: '#ff1744', stroke: { width_px: 6 }, zone: 'top' }),
    { color: '#ff1744', stroke: { widthPx: 6 } });
  assert.deepEqual(unsupportedMyStyleLookFields({ color: '#ff1744', italic: true,
    background: { opacity: 0.5, width_pct: 60 } }), ['italic', 'background.width_pct']);
});

test('効果無しを保存して、当て先の既定 glow も実効値で無効化する', () => {
  const look = effectiveMyStyleLook(undefined, { color: '#ff1744' }, 1920);
  assert.deepEqual(look.stroke, { width_px: 0 });
  assert.deepEqual(look.background, { opacity: 0 });
  assert.deepEqual(look.shadow, { color: '#000000', opacity: 0 });
  assert.deepEqual(look.glow, { color: '#000000', density: 0 });
  const source = JSON.stringify({ default_text_style: { glow: { color: '#ff00ff', density: 50 } },
    captions: [{ id: 'one', start: 0, end: 1, text: '字幕', speaker: null, sourceRef: null,
      edited: false, text_style: { color: '#fff' } }] });
  const updated = replaceMyStyleLookInSource(source, ['one'], look);
  const effective = parseCaptions(updated).captions[0].textStyle;
  assert.equal(effective.glow.density, 0);
  assert.equal(effective.glow.color, '#000000');
  assert.match(captionTextShadowValue(effective.shadow && { color: effective.shadow.color,
    opacity: effective.shadow.opacity }, { color: effective.glow.color,
    density: effective.glow.density }), /rgba\(0,0,0,0\)/);
});

test('置換後の default layout と cue layout を事前に検出し、置いた文字も拒否する', () => {
  const layout = { mode: 'reference-pixel', reference_width_px: 1920, reference_height_px: 1080,
    left_px: 261, width_px: 1120, bottom_px: 29, text_align: 'center', max_lines: 1 };
  const look = { color: '#f00', reference_height_px: 1920 };
  const source = JSON.stringify({ default_text_style: { layout }, captions: [
    { id: 'one', text_style: { color: '#fff' } }, { id: 'two', text_style: { color: '#fff' } }
  ] });
  assert.throws(() => replaceMyStyleLookInSource(source, ['one', 'two'], look), /layout.*基準高さ/);
  assert.throws(() => placedMyStyleTextStyle({ position: { y: .5 } }, look,
    { layout: { mode: 'reference-pixel' } }), /layout.*基準高さ/);
});

test('未対応部品と見た目項目の名前を 1 行で知らせ、未対応が無ければ通知しない', () => {
  assert.equal(myStyleApplyNotice([{ kind: 'look', text_style: { color: '#fff', italic: true,
    background: { width_pct: 60 } } }, { kind: 'motion' }]),
  '動き・斜体・座布団の幅 は v0 では当てません。見た目を当てました。');
  assert.equal(myStyleApplyNotice([{ kind: 'look', text_style: { color: '#fff' } }]), undefined);
  assert.equal(myStyleApplyNotice([{ kind: 'camera' }]), 'カメラ は v0 では当てません。');
  assert.deepEqual(placedMyStyleTextStyle({ position: { y: .4625 }, textAnchor: 'tc' },
    { color: '#ff1744', shadow: null }),
  { position: { y: .4625 }, textAnchor: 'tc', color: '#ff1744' });
});

test('look は余分な効果を消し、位置・動き・任意欄を保ち、プリセットも同時に外す', () => {
  const source = JSON.stringify({ captions: [{ id: 'one', style_preset: 'neon', text_style: {
    color: '#fff', glow: { color: '#f0f' }, animation: { in: { id: 'pop' } },
    position: { y: 0.3 }, zone: 'top', other: 'keep' } }] });
  const updated = replaceMyStyleLookInSource(source, ['one'], {
    color: '#f00', size_px: 80, reference_height_px: 1920, animation: { in: { id: 'bad' } },
    stroke: { color: '#fff', width_px: 4, other: 2 }
  });
  const cue = JSON.parse(updated).captions[0];
  assert.equal('style_preset' in cue, false);
  assert.deepEqual(cue.text_style, { animation: { in: { id: 'pop' } }, position: { y: 0.3 },
    zone: 'top', other: 'keep', color: '#f00', size_px: 80, reference_height_px: 1920,
    stroke: { color: '#fff', width_px: 4 } });
  assert.equal(myStyleOutputHeight('{"output":{"height":1920}}'), 1920);
  assert.equal(scaleCaptionPx(80, resolveCaptionReferenceScale(
    { reference_height_px: 1920 }, { width: 1920, height: 1080 })), 45);
  assert.deepEqual(placedMyStyleTextStyle({ position: { y: 0.4 }, glow: { color: '#fff' } },
    { color: '#f00', reference_height_px: 1920 }),
  { position: { y: 0.4 }, color: '#f00', referenceHeightPx: 1920 });
});

test('利用台帳は既存の行を保持して追記する', () => {
  const entry = { caption_ids: ['one', 'two'], style_uid: '01K5ZXY1234ABCDEFGHJKMNPQRS',
    revision: 2, parts: ['look'], applied_at: '2026-09-24T00:00:00.000Z' };
  const first = appendMyStyleUsage(undefined, entry);
  const second = appendMyStyleUsage(first, { ...entry, caption_ids: ['three'] });
  assert.deepEqual(JSON.parse(second), { version: 1, entries: [entry, { ...entry, caption_ids: ['three'] }] });
});

test('保存 ID は名前から読める slug を作る', () => {
  assert.match(newMyStyleSlug('Vintage Blue'), /^vintage-blue-[a-f0-9]{8}$/);
  assert.match(newMyStyleSlug('強調'), /^my-style-[a-f0-9]{8}$/);
});

test('同梱プリセット解決後の値も実効の見た目に入る', () => {
  const root = { default_text_style: { color: '#ffffff' }, captions: [{ id: 'one', start: 0, end: 1,
    text: '文字', speaker: null, sourceRef: null, edited: false, style_preset: 'subtitle-variety',
    text_style: { color: '#ff1744', position: { y: 0.7 } } }] };
  const parsed = parseCaptions(JSON.stringify(root));
  const look = effectiveMyStyleLook(parsed.defaultTextStyle, parsed.captions[0].textStyle);
  assert.equal(look.color, '#ff1744');
  assert.equal(look.weight, 700);
  assert.equal('position' in look, false);
});
