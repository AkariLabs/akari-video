import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  applyCaptionRunsToHtml, applyCaptionTextEdit, captionGraphemes,
  captionRunsRemovedNotice, rebaseCaptionRuns, resolveCaptionRuns, sliceCaptionRuns,
  splitCaptionLine, mergeCaptionLines, updateCaptionFieldsInSource,
  updateCaptionFieldsInSourceWithReport
} from '../lib/index.js';

const schema = JSON.parse(readFileSync(new URL('../../schemas/captions.schema.json', import.meta.url), 'utf8'));
const validateCaptionFile = new Ajv2020({ strict: false }).compile(schema);

test('caption schema accepts run vocabulary and rejects malformed style types', () => {
  const cue = { id: 'c-0001', start: 0, end: 2, text: '最高', speaker: null,
    sourceRef: null, edited: false, runs: [{ from: -1, to: 3, role: 'emphasis',
      style: { color: '#ff5a5f', font_weight: 900, scale: 1.3, baseline_shift_em: -0.1,
        rotate_deg: 8, letter_spacing_em: 0.05, italic: true, underline: true,
        stroke: { color: '#000', width_px: 1 } }, animation: { loop: { id: 'float' } } }] };
  assert.equal(validateCaptionFile([cue]), true, JSON.stringify(validateCaptionFile.errors));
  assert.equal(validateCaptionFile([{ ...cue, runs: [{ from: 0, to: 2, style: { scale: 'large' } }] }]), false);
  assert.equal(validateCaptionFile([{ ...cue, runs: [{ from: 0, to: 2, mystery: true }] }]), false);
});

test('runs count displayed graphemes and later fields win independently', () => {
  const text = 'A👩‍👩‍👧‍👦éB';
  assert.equal(captionGraphemes(text).length, 4);
  const values = resolveCaptionRuns(text, [
    { from: 1, to: 3, role: 'keyword', style: { color: '#f00', scale: 1.3 } },
    { from: 2, to: 4, style: { color: '#00f', rotate_deg: 8 } }
  ]);
  assert.equal(values[1].text, '👩‍👩‍👧‍👦');
  assert.deepEqual(values[2].style, { color: '#00f', scale: 1.3, rotate_deg: 8 });
  assert.equal(values[2].role, 'keyword');
});

test('runs project across manual lines and displayed wording', () => {
  const text = 'あい👋うえ';
  const run = { from: 1, to: 4, role: 'emphasis' };
  assert.deepEqual(sliceCaptionRuns(text, [run], 0, 2), [{ ...run, from: 1, to: 2 }]);
  assert.deepEqual(sliceCaptionRuns(text, [run], 2, text.length), [{ ...run, from: 0, to: 2 }]);
  const edited = applyCaptionTextEdit({ text: '最高', display_text: '最高!', start: 0, end: 1,
    runs: [{ from: 0, to: 2 }] }, '最良');
  assert.equal(edited.record.display_text, '最良!');
  assert.deepEqual(edited.record.runs, [{ from: 0, to: 2 }]);
});

test('text edits shift, stretch, replace, and remove runs', () => {
  const run = { from: 3, to: 5, role: 'emphasis' };
  assert.deepEqual(rebaseCaptionRuns('これは最高', '新新これは最高', [run]).runs,
    [{ ...run, from: 5, to: 7 }]);
  assert.deepEqual(rebaseCaptionRuns('これは最高', 'これは最良', [run]).runs, [run]);
  assert.deepEqual(rebaseCaptionRuns('これは最高', 'これは最も高', [run]).runs,
    [{ ...run, to: 6 }]);
  const removed = applyCaptionTextEdit({ text: 'これは最高', start: 0, end: 1, runs: [run] }, 'これは');
  assert.equal(Object.hasOwn(removed.record, 'runs'), false);
  assert.deepEqual(removed.removedRuns, [run]);
});

test('split and merge project run ranges', () => {
  const record = { id: 'c-0001', start: 0, end: 2, text: '最高です', speaker: null,
    sourceRef: null, edited: false, words: [
      { start: 0, end: 1, text: '最高' }, { start: 1, end: 2, text: 'です' }
    ], runs: [{ from: 1, to: 3, style: { color: '#f00' } }] };
  const source = JSON.stringify([record]);
  const split = JSON.parse(splitCaptionLine(source, 'c-0001', 1, 'c-0002'));
  assert.deepEqual(split.map(item => item.runs?.[0] && [item.runs[0].from, item.runs[0].to]),
    [[1, 2], [0, 1]]);
  const merged = JSON.parse(mergeCaptionLines(JSON.stringify(split), ['c-0001', 'c-0002']));
  assert.deepEqual(merged[0].runs.map(run => [run.from, run.to]), [[1, 3]]);
});

test('split and merge omit the runs key when no ranges remain', () => {
  const record = { id: 'c-0001', start: 0, end: 2, text: '最高です', speaker: null,
    sourceRef: null, edited: false, words: [
      { start: 0, end: 1, text: '最高' }, { start: 1, end: 2, text: 'です' }
    ], runs: [{ from: 0, to: 2, role: 'emphasis' }] };
  const split = JSON.parse(splitCaptionLine(JSON.stringify([record]), 'c-0001', 1, 'c-0002'));
  assert.deepEqual(split[0].runs, record.runs);
  assert.equal(Object.hasOwn(split[1], 'runs'), false);
  const empty = split.map(cue => ({ ...cue, runs: [] }));
  const merged = JSON.parse(mergeCaptionLines(JSON.stringify(empty), ['c-0001', 'c-0002']));
  assert.equal(Object.hasOwn(merged[0], 'runs'), false);
});

test('reporting API preserves the string API and returns removed runs for a notice', () => {
  const run = { from: 3, to: 5, role: 'emphasis' };
  const source = JSON.stringify([{ id: 'c-0001', start: 0, end: 1, text: 'これは最高',
    speaker: null, sourceRef: null, edited: false, runs: [run] }]);
  const report = updateCaptionFieldsInSourceWithReport(source, 'c-0001', { text: 'これは' });
  assert.equal(report.source, updateCaptionFieldsInSource(source, 'c-0001', { text: 'これは' }));
  assert.deepEqual(report.removedRuns, [run]);
  assert.equal(Object.hasOwn(JSON.parse(report.source)[0], 'runs'), false);
  assert.equal(captionRunsRemovedNotice(report.removedRuns, 'これは最高'),
    '文字範囲 1 件（「最高」）が外れました');
  assert.equal(captionRunsRemovedNotice([], 'これは最高'), undefined);
  assert.deepEqual(updateCaptionFieldsInSourceWithReport(source, 'c-0001', { speaker: 'A' }).removedRuns, []);
});

test('HTML decorates only selected graphemes and leaves no-run bytes intact', () => {
  const html = '<div><style>.x{color:red}</style><p class="akari-caption__line">A<span class="akari-caption__char" data-akari-char="0">👋</span>&amp;B</p></div>';
  assert.equal(applyCaptionRunsToHtml(html, 'A👋&B'), html);
  const result = applyCaptionRunsToHtml(html, 'A👋&B', [
    { from: 1, to: 3, role: 'emphasis', style: { color: '#ff0000', scale: 1.3,
      baseline_shift_em: -0.1, rotate_deg: 8, letter_spacing_em: 0.05 } }
  ]);
  assert.match(result, /data-role="emphasis"/);
  assert.match(result, /font-size:1.3em/);
  assert.match(result, /letter-spacing:0.05em/);
  assert.match(result, /translateY\(-0.07692307692307693em\) rotate\(8deg\)/);
  assert.equal((result.match(/akari-caption__run/g) ?? []).length, 2);
  assert.match(result, /<span class="akari-caption__char"[^>]*><span class="akari-caption__run"/);
});
