import { createRequire as createI18nRequire } from 'node:module';
globalThis.t = createI18nRequire(import.meta.url)('../lib/browser/transcript-text.js').t;
globalThis.assessCutOutcome = createI18nRequire(import.meta.url)('../lib/common/daihon-cut-outcome.js').assessCutOutcome;
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
process.on('exit', () => setLanguage(undefined));
import assert from 'node:assert/strict'; import test from 'node:test';
import { readAllSourceText } from './helpers/daihon-source.mjs';
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
  const source = readAllSourceText();
  assert.match(source, /INTERACTIVE_SELECTOR[^;]+\.akari-daihon-slash/u);
  assert.match(source, /t\('transcript\.daihon\.editor\.removeRemoveBreakAction'\)/u);
  assert.equal(globalThis.t('transcript.daihon.editor.removeRemoveBreakAction'), '✕ ここの区切りをやめる');
  assert.match(source, /freezeAndRemoveCaptionBoundary/u);
});
