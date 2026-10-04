import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { launchBrowser } from '../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';

const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const selection = source.slice(source.indexOf('const applyCaptionSelectionAttrs ='),
  source.indexOf('const setCaptionAltAll ='));
const update = source.slice(source.indexOf("if (message && message.type === 'akari-preview-captions-update')"),
  source.indexOf("if (message && message.type === 'akari-preview-audio-update')"));
const selectBoxUpdate = source.slice(source.indexOf('const updateCaptionSelectBox ='),
  source.indexOf('const selectCaption ='));

test('caption update retains motion replay and updates the selected box after rendering', () => {
  assert.match(update, /captions = protectCaptionUpdate\(nextCaptions\);[\s\S]*renderCaption\(\);\s*resumeCaptionMotionAfterRender\(\);[\s\S]*updateCaptionSelectBox\(\);/u);
});

test('selected box rebuilds handles only when the writing direction disagrees', () => {
  const captions = [{ id: 'c1', textStyle: { vertical: false, wrap_width_pct: 30 } }];
  let handleKinds = new Set(['e', 'w']);
  let rebuilds = 0;
  const handleBox = { querySelector: selector => handleKinds.has(selector.match(/data-h="(\w+)"/u)?.[1]) ? {} : null };
  const captionSelectBox = { querySelector: selector => selector === '.akari-caption-handle-box' ? handleBox : null };
  const refresh = new Function('captionSelectBox', 'selectedCaptionId', 'selectedCaption', 'window',
    'captions', 'outputTime', 'syncCaptionHandleBox', 'updateCaptionMultiSelectBoxes',
    'captionVisualRect', 'updateCaptionSelectBoxForRect', 'applyCaptionSelectionAttrs',
    'captionGestureCount', 'selectionDragActive', `${selectBoxUpdate}\nreturn updateCaptionSelectBox;`)(
    captionSelectBox, 'c1', () => captions[0],
    { AkariEditKernel: { findActiveCaptions: rows => rows } }, captions, 0,
    () => {}, () => {}, () => ({}), () => {}, () => {
      rebuilds++;
      handleKinds = new Set(captions[0].textStyle.vertical ? ['n', 's'] : ['e', 'w']);
    }, 0, false);
  refresh();
  assert.equal(rebuilds, 0);
  captions[0].textStyle.vertical = true;
  refresh();
  assert.equal(rebuilds, 1);
  refresh();
  assert.equal(rebuilds, 1);
  captions[0].textStyle.vertical = false;
  refresh();
  assert.equal(rebuilds, 2);
  refresh();
  assert.equal(rebuilds, 2);
});

test('a selected wrapped caption switches between vertical and horizontal grips',
  { skip: process.env.AKARI_TEST_BROWSER_MULTI_PROCESS !== '1' }, async () => {
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
