import assert from 'node:assert/strict';
import test from 'node:test';
import { effectiveMyStyleLook, myStyleLookPatch, myStyleApplyNotice, placedMyStyleTextStyle, unsupportedMyStyleLookFields } from '../lib/browser/my-style-look.js';
import { parseCaptions } from '../../../../../packages/edit-store/lib/caption-store.js';

test('実効の見た目を解決し、位置と動きを保存しない', () => {
  const look = effectiveMyStyleLook({ color: '#ffffff', stroke: { color: '#000000', widthPx: 2 },
    zone: 'bottom', position: { y: 0.8 } }, { color: '#ff1744', stroke: { widthPx: 6 },
    background: { color: '#111111', opacity: 0.7 }, animation: { in: { id: 'pop' } }, textAnchor: 'tc' });
  assert.deepEqual(look, { color: '#ff1744', stroke: { color: '#000000', width_px: 6 },
    background: { color: '#111111', opacity: 0.7 }, shadow: null, glow: null });
  assert.deepEqual(myStyleLookPatch({ color: '#ff1744', stroke: { width_px: 6 }, zone: 'top' }),
    { color: '#ff1744', stroke: { widthPx: 6 } });
  assert.deepEqual(unsupportedMyStyleLookFields({ color: '#ff1744', italic: true,
    background: { opacity: 0.5, width_pct: 60 } }), ['italic', 'background.width_pct']);
});

test('未対応部品と見た目項目の名前を 1 行で知らせ、未対応が無ければ通知しない', () => {
  assert.equal(myStyleApplyNotice([{ kind: 'look', text_style: { color: '#fff', italic: true,
    background: { width_pct: 60 } } }, { kind: 'motion' }]),
  '動き・斜体・座布団の幅 は v0 では当てません。見た目を当てました。');
  assert.equal(myStyleApplyNotice([{ kind: 'look', text_style: { color: '#fff' } }]), undefined);
  assert.equal(myStyleApplyNotice([{ kind: 'camera' }]), 'カメラ は v0 では当てません。');
  assert.deepEqual(placedMyStyleTextStyle({ position: { y: .4625 }, textAnchor: 'tc' },
    { color: '#ff1744', shadow: null }),
  { position: { y: .4625 }, textAnchor: 'tc', color: '#ff1744', shadow: { color: '#000000', opacity: 0 } });
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
