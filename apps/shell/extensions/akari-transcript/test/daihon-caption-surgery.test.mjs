import assert from 'node:assert/strict'; import test from 'node:test'; import { readFile } from 'node:fs/promises';
import {
  fragmentBoundaries,
  freezeAndRemoveCaptionBoundary,
  setCaptionDisplayFragmentsInSource,
  toggleFragmentBoundary
} from '../lib/browser/daihon/daihon-caption-surgery.js';
const words = [{ text: 'あ' }, { text: 'いう' }, { text: 'え' }];
test('fragment boundary toggles round trip', () => {
  const next = toggleFragmentBoundary(words, undefined, 'あいうえ', 1);
  assert.deepEqual(next, ['あ', 'いうえ']); assert.deepEqual(fragmentBoundaries(words, next), [1]);
  assert.deepEqual(toggleFragmentBoundary(words, next, 'あいうえ', 1), []);
});
test('自動断片を凍結してクリックした境界だけ外し edited を立てる', () => {
  const text = '今日はねひたすらYouTubeの撮影を';
  const automatic = ['今日はねひたすら', 'YouTube', 'の撮影を'];
  const next = freezeAndRemoveCaptionBoundary(automatic, text, automatic[0].length);
  assert.deepEqual(next, ['今日はねひたすらYouTube', 'の撮影を']);
  const source = `[{"id":"c-1","text":${JSON.stringify(text)},"edited":false}]`;
  const record = JSON.parse(setCaptionDisplayFragmentsInSource(source, 'c-1', next))[0];
  assert.deepEqual(record.display_fragments, next);
  assert.equal(record.edited, true);
});
test('updates array and object roots while leaving other records byte-identical', () => {
  const other = '{"id":"c-2", "text":"KEEP"}';
  const source = `[\n  {"id":"c-1", "text":"あいうえ", "edited":false},\n  ${other}\n]\n`;
  const updated = setCaptionDisplayFragmentsInSource(source, 'c-1', ['あ', 'いうえ']);
  assert.match(updated, /"display_fragments"/); assert.equal(JSON.parse(updated)[0].edited, true); assert.ok(updated.includes(other));
  const object = `{\n "captions": ${source.trim()}\n}\n`;
  assert.equal(JSON.parse(setCaptionDisplayFragmentsInSource(object, 'c-1', [])).captions[0].edited, true);
});
test('appends properties at sibling indentation and leaves the closing brace on its own line', () => {
  const record = `{
    "id": "c-1",
    "text": "あいうえ",
    "words": [
      { "text": "あ", "start": 0, "end": 1 }
    ]
  }`;
  const updated = setCaptionDisplayFragmentsInSource(`[\n  ${record}\n]\n`, 'c-1', ['あ', 'いうえ']);
  assert.ok(updated.includes('    ],\n    "display_fragments": ["あ","いうえ"],\n    "edited": true\n  }'));
});
test('／自身が自動・手置き共通メニューを開き、行クリックと分離される', async () => {
  const source = await readFile(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
  assert.match(source, /INTERACTIVE_SELECTOR[^;]+\.akari-daihon-slash/u);
  assert.match(source, /✕ ここの区切りをやめる/u);
  assert.match(source, /freezeAndRemoveCaptionBoundary/u);
});
