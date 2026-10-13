import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { planCaptionLookMigration, captionRenderInputFromV1,
  TEXTSTYLE_CATALOG } from '../../../../../packages/edit-store/lib/index.js';
import { parsePreviewCaptions } from '../lib/browser/akari-preview-captions.js';
import { readCaptionsEmphasisWords } from '../lib/common/preview-emphasis-seat.js';

test('移行後の字幕をプレビュー入口へ通すと強調と runs が移行前と同じになる', () => {
  const before = { captions: [{ id: 'c-0001', src: 's1', start: 0, end: 2, text: '猫犬',
    speaker: null, sourceRef: null, edited: false,
    words: [{ text: '猫', start: 0, end: 1 }, { text: '犬', start: 1, end: 2 }],
    runs: [{ from: 1, to: 2, style: { color: '#ff0000', scale: 0.7,
      stroke: { color: '#ffffff', width_px: 6 } } }] }],
    emphasis_words: [{ id: 'e-0001', src: 's1', word: '猫', t_start: 0, t_end: 1,
      emotion: 'surprise', style_hint: 'one-char-bang' }] };
  const migrated = planCaptionLookMigration(before, TEXTSTYLE_CATALOG).next;
  const renderInput = captionRenderInputFromV1(migrated);
  assert.deepEqual(readCaptionsEmphasisWords(renderInput), readCaptionsEmphasisWords(before));
  const visualRuns = root => parsePreviewCaptions(JSON.stringify(root)).map(item =>
    item.runs?.map(run => ({ from: run.from, to: run.to, style: run.style, animation: run.animation })));
  assert.deepEqual(visualRuns(renderInput), visualRuns(before));
  const host = readFileSync(new URL('../src/node/akari-preview-service.ts', import.meta.url), 'utf8');
  const webview = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
  assert.match(host, /captionsRoot = captionRenderInputFromV1\(captionsRoot\)/u);
  assert.match(webview, /const renderSource = JSON\.stringify\(captionRenderInputFromV1\(JSON\.parse\(source\)\)\)/u);
});
