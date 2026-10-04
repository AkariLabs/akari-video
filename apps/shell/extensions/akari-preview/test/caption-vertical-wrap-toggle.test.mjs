import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from '../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';

const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const selection = source.slice(source.indexOf('const applyCaptionSelectionAttrs ='),
  source.indexOf('const setCaptionAltAll ='));
const update = source.slice(source.indexOf("if (message && message.type === 'akari-preview-captions-update')"),
  source.indexOf("if (message && message.type === 'akari-preview-audio-update')"));

test('caption update rebuilds handles after rendering the new writing mode', () => {
  assert.match(update, /captions = protectCaptionUpdate\(nextCaptions\);[\s\S]*renderCaption\(\);\s*applyCaptionSelectionAttrs\(\);/u);
});

test('a selected wrapped caption switches between vertical and horizontal grips', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="box"></div>');
    const kinds = await page.evaluate(selectionSource => {
      const captionSelectBox = document.getElementById('box');
      const captions = [{ id: 'c1', textStyle: { vertical: false, wrap_width_pct: 30 } }];
      const captionRows = new Map();
      const selectedCaptionIds = new Set(['c1']);
      const selectedCaptionId = 'c1';
      const captionAltAll = false;
      const syncCaptionHandleBox = () => {};
      const applyCaptionRowSelectionAttrs = () => {};
      const renderCaptionRow = () => {};
      new Function('document', 'captionSelectBox', 'captions', 'captionRows', 'selectedCaptionIds',
        'selectedCaptionId', 'captionAltAll', 'syncCaptionHandleBox', 'applyCaptionRowSelectionAttrs',
        'renderCaptionRow', `${selectionSource}\nreturn applyCaptionSelectionAttrs;`)(
        document, captionSelectBox, captions, captionRows, selectedCaptionIds, selectedCaptionId,
        captionAltAll, syncCaptionHandleBox, applyCaptionRowSelectionAttrs, renderCaptionRow)();
      const inspect = () => [...captionSelectBox.querySelectorAll('.akari-caption-handle')]
        .map(handle => handle.getAttribute('data-h'));
      const horizontal = inspect();
      captions[0] = { id: 'c1', textStyle: { vertical: true, wrap_width_pct: 53.33 } };
      const apply = new Function('document', 'captionSelectBox', 'captions', 'captionRows', 'selectedCaptionIds',
        'selectedCaptionId', 'captionAltAll', 'syncCaptionHandleBox', 'applyCaptionRowSelectionAttrs',
        'renderCaptionRow', `${selectionSource}\nreturn applyCaptionSelectionAttrs;`)(
        document, captionSelectBox, captions, captionRows, selectedCaptionIds, selectedCaptionId,
        captionAltAll, syncCaptionHandleBox, applyCaptionRowSelectionAttrs, renderCaptionRow);
      apply();
      const vertical = inspect();
      captions[0] = { id: 'c1', textStyle: { vertical: false, wrap_width_pct: 30 } };
      apply();
      return { horizontal, vertical, restored: inspect() };
    }, selection);
    for (const horizontal of [kinds.horizontal, kinds.restored]) {
      assert.ok(horizontal.includes('e') && horizontal.includes('w'));
      assert.ok(!horizontal.includes('n') && !horizontal.includes('s'));
    }
    assert.ok(kinds.vertical.includes('n') && kinds.vertical.includes('s'));
    assert.ok(!kinds.vertical.includes('e') && !kinds.vertical.includes('w'));
  } finally { await browser.close(); }
});
