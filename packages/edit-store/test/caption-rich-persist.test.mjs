import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCaptions, insertCaptionLine, mergeCaptionTextStyles,
  updateCaptionTextStyleInSource, updateCaptionFieldsInSource,
  updateCaptionRunsInSource, updateCaptionStylePresetInSource,
  splitCaptionLine, mergeCaptionLines, shiftCaptionLine,
  setCaptionTimingLine, applyWordBookToCaptionsInSource
} from '../lib/caption-store.js';

const rich = {
  fill: { type: 'gradient', angle_deg: 90, stops: [
    { at: 0, color: '#ff0000' }, { at: 100, color: '#0000ff' }
  ] },
  strokes: [
    { color: '#000000', width_px: 2 },
    { color: '#ffffff', width_px: 4, offset_x: 1, offset_y: -1 }
  ]
};
const row = (id, start = 0, text = '文字') => ({ id, start, end: start + 1, text,
  speaker: null, sourceRef: null, edited: false, text_style: { color: '#ffffff', size_px: 56, ...rich } });
const source = () => JSON.stringify([row('a'), row('b', 1, '別文')]);
const style = (text, index = 0) => JSON.parse(text)[index].text_style;
const preserved = value => { assert.deepEqual(value.fill, rich.fill); assert.deepEqual(value.strokes, rich.strokes); };

test('parseCaptions and default_text_style preserve rich fields', () => {
  const parsed = parseCaptions(JSON.stringify({ default_text_style: rich, captions: [row('a')] }));
  assert.deepEqual(parsed.captions[0].textStyle.fill, rich.fill);
  assert.deepEqual(parsed.captions[0].textStyle.strokes, rich.strokes);
  assert.deepEqual(parsed.defaultTextStyle.fill, rich.fill);
  assert.deepEqual(parsed.defaultTextStyle.strokes, rich.strokes);
});

test('insertCaptionLine and parsed duplicate preserve rich fields', () => {
  const parsed = parseCaptions(source()).captions[0];
  const inserted = insertCaptionLine(source(), { ...parsed, id: 'c', start: 2, end: 3 });
  preserved(style(inserted, 2));
});

test('mergeCaptionTextStyles preserves rich fields', () => {
  const parsed = parseCaptions(source()).captions[0].textStyle;
  const merged = mergeCaptionTextStyles({ color: '#aaaaaa' }, parsed);
  assert.deepEqual(merged.fill, rich.fill);
  assert.deepEqual(merged.strokes, rich.strokes);
});

test('invalid rich field is ignored without discarding its sibling', () => {
  const invalidFill = JSON.stringify([{ ...row('a'), text_style: {
    color: '#ffffff', fill: { type: 'gradient', stops: [] }, strokes: rich.strokes
  } }]);
  const first = parseCaptions(invalidFill).captions[0].textStyle;
  assert.equal(Object.hasOwn(first, 'fill'), false);
  assert.deepEqual(first.strokes, rich.strokes);
  const invalidStrokes = JSON.stringify([{ ...row('a'), text_style: {
    size_px: 56, fill: rich.fill, strokes: [{ color: 'broken', width_px: -1 }]
  } }]);
  const second = parseCaptions(invalidStrokes).captions[0].textStyle;
  assert.equal(second.sizePx, 56);
  assert.deepEqual(second.fill, rich.fill);
  assert.equal(Object.hasOwn(second, 'strokes'), false);
});

test('style patches including color preserve rich fields', () => {
  const patches = [
    ['size', { sizePx: 48 }], ['font', { fontFamily: 'Arial' }],
    ['weight', { fontWeight: 700 }], ['stroke', { stroke: { color: '#abcdef', widthPx: 3 } }],
    ['shadow', { shadow: { color: '#000000', blurPx: 2 } }],
    ['glow', { glow: { color: '#ffffff', spread: 2 } }],
    ['background', { background: { color: '#000000' } }],
    ['zone', { zone: 'top' }], ['color', { color: '#123456' }]
  ];
  for (const [name, patch] of patches) {
    const result = updateCaptionTextStyleInSource(source(), 'a', patch);
    preserved(style(result));
    assert.equal(style(result, 1).fill.type, 'gradient', name);
  }
  assert.equal(style(updateCaptionTextStyleInSource(source(), 'a', { color: '#123456' })).color, '#123456');
});

test('field, run, preset, timing, word book, split and merge paths preserve rich fields', () => {
  preserved(style(updateCaptionFieldsInSource(source(), 'a', { text: '打ち直し' })));
  const runSource = JSON.stringify([{ ...row('a'), runs: [{ from: 0, to: 1, role: 'emphasis' }] }]);
  preserved(style(updateCaptionRunsInSource(runSource, 'a', { kind: 'remove', index: 0 })));
  preserved(style(updateCaptionStylePresetInSource(source(), ['a'], null).source));
  preserved(style(shiftCaptionLine(source(), 'a', 0.1, 0.1)));
  preserved(style(setCaptionTimingLine(source(), 'a', 0, 1.1, 'source', true)));
  preserved(style(applyWordBookToCaptionsInSource(source(), [{ id: 'a', text: '改' }])));
  const splitSource = JSON.stringify([{ ...row('a', 0, '文字'), words: [
    { start: 0, end: 0.5, text: '文' }, { start: 0.5, end: 1, text: '字' }
  ] }]);
  const split = splitCaptionLine(splitSource, 'a', 1, 'c');
  preserved(style(split)); preserved(style(split, 1));
  preserved(style(mergeCaptionLines(source(), ['a', 'b'])));
});
