import test from 'node:test';
import assert from 'node:assert/strict';
import { writePreviewCaptionWrap, duplicatePreviewCaption } from '../lib/common/preview-caption-wrap.js';

test('wrap width write preserves text size and patches only the requested cue', () => {
  const source = JSON.stringify({ captions: [
    { id: 'c1', text_style: { size_px: 45, zone: 'bottom' } },
    { id: 'c2', text_style: { size_px: 60 } }
  ] });
  const doc = JSON.parse(writePreviewCaptionWrap(source, { captionId: 'c1', wrapWidthPct: 32,
    anchor: 'tl', position: { x: .1, y: .2 } }));
  assert.deepEqual(doc.captions[0].text_style, { size_px: 45, wrap_width_pct: 32,
    text_anchor: 'tl', position: { x: .1, y: .2 } });
  assert.deepEqual(doc.captions[1].text_style, { size_px: 60 });
});

test('invalid width and missing cue are rejected', () => {
  assert.throws(() => writePreviewCaptionWrap('[]', { captionId: 'x', wrapWidthPct: 0,
    anchor: 'tl', position: { x: 0, y: 0 } }));
  assert.throws(() => writePreviewCaptionWrap('[]', { captionId: 'x', wrapWidthPct: 20,
    anchor: 'tl', position: { x: 0, y: 0 } }), /文字が見つかりません/u);
});

test('placed text duplicate keeps the source and gives its copy a new id and position', () => {
  const source = JSON.stringify([{ id: 'c-0001', text: 'こんにちは', text_style: {
    size_px: 44, position: { x: .1, y: .2 } } }]);
  const rows = JSON.parse(duplicatePreviewCaption(source, 'c-0001',
    { anchor: 'tl', position: { x: .3, y: .4 } }));
  assert.equal(rows[0].text_style.position.x, .1);
  assert.equal(rows[1].id, 'c-0002');
  assert.equal(rows[1].text_style.size_px, 44);
  assert.deepEqual(rows[1].text_style.position, { x: .3, y: .4 });
});
