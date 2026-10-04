import assert from 'node:assert/strict';
import test from 'node:test';
import { generateCaptionOverlays, renderCaptionFragment, renderResolvedSingleLineCaption } from '../src/captions.mjs';

test('only explicit breaks create separate vertical cushions; policy fragments stay in one line', () => {
  const style = { vertical: true, background: { color: '#111111', padding_px: 14 } };
  const plain = renderCaptionFragment('一行目の文\n二行目は少し長い文',
    { vertical: true, contextStyle: style, textStyleActive: true });
  const resolved = renderResolvedSingleLineCaption('今日は天気が良いので、散歩に出かけました。',
    ['今日は天気が良いので、', '散歩に出かけました。'],
    { text_style: style, style_vars: { '--caption-vertical-max-height': '432px',
      '--caption-vertical-wrap-height': '432px' } });
  const [automatic] = generateCaptionOverlays([{ id: 'c1', start: 0, end: 2,
    text: '今日は天気が良いので、散歩に出かけました。', text_style: style }], [],
  { output: { width: 1920, height: 1080 } });
  assert.equal((plain.match(/<p class="akari-caption__line"/gu) ?? []).length, 2);
  for (const html of [resolved, automatic.html]) {
    assert.equal((html.match(/<p class="akari-caption__line"/gu) ?? []).length, 1);
  }
  for (const html of [plain, resolved, automatic.html]) {
    assert.match(html, /writing-mode:horizontal-tb;align-items:var\(--caption-align-items,center\);\}/u);
    assert.match(html, /flex-direction:row-reverse/u);
    assert.match(html, /\.akari-caption\.akari-caption--vertical \.akari-caption__plate\{flex-direction:row-reverse;align-items:flex-start;\}/u);
    assert.match(html, /height:var\(--caption-vertical-wrap-height,max-content\)/u);
  }
});
