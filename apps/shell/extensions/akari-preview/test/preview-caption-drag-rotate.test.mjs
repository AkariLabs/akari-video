import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { persistCaptionPlateTransform } from '../src/common/caption-plate-handles.ts';
import { persistCaptionCuePosition } from '../src/common/caption-zone-write.ts';

const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../evidence/preview-caption-drag-rotate-v1/scripts/run-l1.mjs', import.meta.url), 'utf8');
const handleStart = handler.slice(handler.indexOf('const beginCaptionHandleDrag ='), handler.indexOf('const restoreLocalTransform ='));

test('handle baselines read the displayed CSS variables instead of the stale caption model', () => {
  assert.match(handleStart, /getComputedStyle\(captionPlate\)/u);
  assert.match(handleStart, /getPropertyValue\('--caption-scale'\)/u);
  assert.match(handleStart, /getPropertyValue\('--caption-rotate'\)/u);
  assert.doesNotMatch(handleStart, /caption\.textStyle\?\.(?:scale|rotate)/u);
});

test('body drag sends only the top-level cuePosition accepted by the host', () => {
  const body = handler.slice(handler.indexOf('const captionPlate = event.target.closest', handler.indexOf('const beginCaptionHandleDrag =')), handler.indexOf('new ResizeObserver(() => updateCaptionSelectBox())'));
  assert.match(body, /captionWrite\(cueId,\s*\{\s*cuePosition\s*\}\)/u);
  assert.doesNotMatch(body, /caption\.textStyle\?\.(?:scale|rotate)/u);
  assert.match(handler, /: 'cuePosition' in request\.patch\s*\? await persistCaptionCuePosition/u);
  assert.match(handler, /const hasCuePosition = cuePosition/u);
});

test('actual host writer and resolver preserve scale and rotate under a position-only patch', async () => {
  const original = JSON.stringify({ captions: [
    { id: 'c-0001', text_style: { scale: 1.25, rotate: 30, color: '#ffffff', position: { y: 0.78 } } },
    { id: 'c-0002', text_style: { scale: 2, rotate: -45 } }
  ] });
  let transformed;
  await persistCaptionPlateTransform({
    source: original, captionIds: ['c-0001'], patch: {},
    cuePosition: { captionId: 'c-0001', value: { anchor: 'bc', position: { x: 0.43, y: 0.6 } } },
    lint: async () => ({ pass: true, errors: [] }), write: async candidate => { transformed = candidate; }
  });
  const throughPlate = JSON.parse(transformed);
  assert.deepEqual(throughPlate.captions[0].text_style, {
    scale: 1.25, rotate: 30, color: '#ffffff', position: { x: 0.43, y: 0.6 }, text_anchor: 'bc'
  });

  let throughHost;
  await persistCaptionCuePosition({
    source: original, captionId: 'c-0001',
    value: { anchor: 'tc', position: { x: 0.4, y: 0.2 } },
    lint: async () => ({ pass: true, errors: [] }), write: async candidate => { throughHost = candidate; }
  });
  const saved = JSON.parse(throughHost);
  assert.deepEqual(saved.captions[0].text_style, {
    scale: 1.25, rotate: 30, color: '#ffffff', position: { x: 0.4, y: 0.2 }, text_anchor: 'tc'
  });
  assert.deepEqual(saved.captions[1], JSON.parse(original).captions[1]);
});

test('L1 runner gates watcher reloads and records both gesture orders in both modes', () => {
  assert.match(runner, /\['before', 'after'\]\.includes\(mode\)/u);
  assert.match(runner, /event\.stopImmediatePropagation\(\)/u);
  assert.match(runner, /modelBeforeBlock:styles\(window\.akari\.previewCaptions\)/u);
  assert.match(runner, /blockedPayload:styles\(event\.data\.captions\)/u);
  assert.match(runner, /window\.akari\.previewCaptions/u);
  assert.match(runner, /gate\.writes\.push\(/u);
  assert.match(runner, /const natural = await observeStyle\(id\)/u);
  assert.match(runner, /const beforeGesture = await observeStyle\(id\)/u);
  assert.match(runner, /await ensureStaleModel\('c-0001', \['rotate'\]\)/u);
  assert.match(runner, /await ensureStaleModel\('c-0001', \['scale', 'rotate'\]\)/u);
  assert.match(runner, /await ensureStaleModel\('c-0002', \['scale'\]\)/u);
  assert.match(runner, /out\.recovery = await recoverRotation\('c-0001', 30\)/u);
  assert.match(runner, /for \(let attempt = 1; attempt <= 4; attempt\+\+\)/u);
  assert.match(runner, /const pointerDelta = \(target - displayedRotate\) \* 0\.8/u);
  assert.match(runner, /rotateHandle\(id, pointerDelta, displayedRotate\)/u);
  assert.match(runner, /after\.disk\.rotate === target && parseFloat\(after\.displayed\?\.rotate\) === target/u);
  assert.match(runner, /body drag starts with saved scale 1\.25 and rotation 30/u);
  assert.match(runner, /before bundle sends stale scale\/rotate with position/u);
  assert.match(runner, /after bundle sends position-only patch/u);
  assert.match(runner, /await rotateHandle\('c-0001', 12\)/u);
  assert.match(runner, /await bodyDrag\('c-0001'\)/u);
  assert.match(runner, /await scaleHandle\('c-0002', 1\.25\)/u);
  assert.match(runner, /await bodyDrag\('c-0002'\)/u);
  assert.match(runner, /await bodyDrag\('c-0003'\)/u);
  assert.match(runner, /await rotateHandle\('c-0003', 23\)/u);
  assert.match(runner, /mode === 'before' \? 'run-log-before\.json' : 'run-log\.json'/u);
  assert.match(runner, /status: 'not-run'/u);
});
