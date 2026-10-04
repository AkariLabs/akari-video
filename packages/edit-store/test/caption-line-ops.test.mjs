import assert from 'node:assert/strict';
import { test } from 'node:test';

import { replaceCaptionLine } from '../lib/caption-line-ops.js';

const caption = (id, text, extra = {}) => ({
  id, start: 0, end: 3, text, speaker: null, sourceRef: null, edited: false, ...extra,
});
const sourceOf = (...captions) => `[\n  ${captions.map(JSON.stringify).join(',\n  ')}\n]\n`;

test('replaceCaptionLine removes display_text derived from text', () => {
  const source = sourceOf(caption('c-0001', 'before', { display_text: '読みやすい整文', style: 'emphasis' }));
  const result = JSON.parse(replaceCaptionLine(source, 'c-0001', 'after'))[0];
  assert.equal(result.text, 'after');
  assert.equal(result.display_text, undefined);
  assert.equal(result.style, 'emphasis');
  assert.equal(result.edited, true);
});

test('replaceCaptionLine rederives words and preserves other physical lines byte for byte', () => {
  const words = [
    { start: 0.1, end: 0.7, text: 'alpha' },
    { start: 0.8, end: 1.6, text: 'beta' },
    { start: 1.7, end: 2.9, text: 'gamma' },
  ];
  const source = sourceOf(caption('c-1001', 'alpha beta gamma', { words, style: 'karaoke' }),
    caption('c-1002', 'untouched'));
  const updated = replaceCaptionLine(source, 'c-1001', 'alpha delta gamma');
  assert.equal(updated.split('\n')[2], source.split('\n')[2]);
  const result = JSON.parse(updated)[0];
  assert.deepEqual(result.words[0], words[0]);
  assert.equal(result.words[1].text, 'delta');
  assert.deepEqual(result.words[2], words[2]);
});

test('replaceCaptionLine preserves object root and default_text_style', () => {
  const source = `{\n  "default_text_style": {"color":"#FF0000"},\n  "captions": [\n    ${JSON.stringify(caption('c-0001', 'before'))}\n  ]\n}\n`;
  const updated = replaceCaptionLine(source, 'c-0001', 'after');
  assert.equal(updated.split('\n')[1], source.split('\n')[1]);
  assert.equal(JSON.parse(updated).captions[0].text, 'after');
});

test('replaceCaptionLine preserves one-line JSON framing and untouched bytes', () => {
  const source = sourceOf(caption('c-0001', 'alpha beta gamma', {
    words: [{ start: 0, end: 1, text: 'alpha' }, { start: 1, end: 2, text: 'beta' },
      { start: 2, end: 3, text: 'gamma' }],
  }), caption('c-0002', 'untouched'));
  const updated = replaceCaptionLine(source, 'c-0001', 'alpha delta gamma');
  assert.deepEqual(updated.split('\n').slice(2), source.split('\n').slice(2));
  assert.equal(JSON.parse(updated)[0].words[1].text, 'delta');
});

test('replaceCaptionLine uses transcript error messages', () => {
  const source = sourceOf(caption('c-0001', 'before'));
  assert.throws(() => replaceCaptionLine(source, '', 'after'), /字幕の識別情報がありません。/);
  assert.throws(() => replaceCaptionLine(source, 'missing', 'after'), /字幕 missing が字幕データにありません。/);
  assert.throws(() => replaceCaptionLine(sourceOf(caption('c-0001', 'a'), caption('c-0001', 'b')),
    'c-0001', 'after'), /字幕 c-0001 が字幕データに複数あります。/);
});
