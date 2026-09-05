import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { computeAdjustCssVisual } from '../lib/common/adjust-css-visual.js';

const source = await readFile(path.resolve(
  import.meta.dirname,
  '../src/browser/akari-preview-open-handler.ts',
), 'utf8');

test('shell wheels-only indicator executes on DOM and is suppressed on frame-engine', () => {
  const refresh = source.match(/adjustCssApproximationActive = !frameEngineMediaIdle[\s\S]*?;/u)?.[0];
  const indicator = source.match(/const adjustApproximation = !frameEngineMediaIdle[\s\S]*?;/u)?.[0];
  assert.ok(refresh && indicator);
  const evaluate = vm.runInNewContext(`(summary, frameEngineMediaIdle) => {
    let adjustCssApproximationActive = false;
    ${refresh}
    ${indicator}
    return adjustApproximation;
  }`, { computeAdjustCssVisualFn: computeAdjustCssVisual });
  for (const seat of ['cuts', 'layers', 'filters']) {
    const summary = { [seat]: [{ adjust: { wheels: { lift: { r: 0.1 } } } }] };
    assert.deepEqual([...evaluate(summary, false)], ['色調整は近似表示']);
    assert.deepEqual([...evaluate(summary, true)], []);
    summary[seat][0].adjust.sections = { wheels: false };
    assert.deepEqual([...evaluate(summary, false)], []);
  }
});

test('shell DOM preview serializes and applies basic adjust to cuts and media layers', () => {
  assert.match(source, /const computeAdjustCssVisualFn = \(\$\{computeAdjustCssVisual\.toString\(\)\}\);/u);
  assert.match(source, /adjust: cut \? cut\.adjust : undefined/u);
  assert.match(source, /const setAdjustBaseFilter = \(element, item\) => \{\s+if \(frameEngineMediaIdle/u);
  assert.match(source, /for \(const media of \[video, stillImage\]\) \{\s+clearAdjustBaseFilter\(media\);[\s\S]+setAdjustBaseFilter\(media, segment\)/u);
  assert.match(source, /standbyPreloadReadyKey = null;\s+clearAdjustBaseFilter\(standbyVideo\);\s+setAdjustBaseFilter\(standbyVideo, segment\)/u);
  assert.match(source, /layerVideo\.style\.mixBlendMode[\s\S]+setAdjustBaseFilter\(layerVideo, layer\)/u);
  assert.match(source, /element\.style\.backdropFilter[\s\S]+setAdjustBaseFilter\(element, filter\)/u);
});

test('shell transition filter is composed after adjust and reset restores the adjust base', () => {
  assert.match(source, /setAdjustTransitionFilter\(outgoingElement, window\.outgoing, outgoingTransitionFilter\)/u);
  assert.match(source, /setAdjustTransitionFilter\(incomingElement, window\.incoming, incomingTransitionFilter\)/u);
  assert.match(source, /video\.style\.filter = video\.dataset\.akariAdjustFilter \|\| ''/u);
  assert.match(source, /transitionVideo\.style\.filter = transitionVideo\.dataset\.akariAdjustFilter \|\| ''/u);
});

test('shell per-clip LUT uses resolved summary cube text, prefers clip, and stays off the still rail', () => {
  assert.match(source, /adjust\.sections\?\.lut === false/u);
  assert.match(source, /const cubeText = \(summary\.adjustLutCubeTexts \|\| \{\}\)\[String\(segment\.id\)\]/u);
  assert.match(source, /const look = clipLook \|\| \(videoFxConfig && videoFxConfig\.look\)/u);
  assert.match(source, /\|\| firstClipLook\)\s+&& !frameEngineMediaIdle/u);
  assert.match(source, /effectsForSegment\(segment, false\)/u);
});

test('shell honest-preview indicator is conditional and suppressed on frame-engine', () => {
  assert.match(source, /adjustCssApproximationActive = !frameEngineMediaIdle[\s\S]+hasApproximation === true/u);
  assert.match(source, /!frameEngineMediaIdle && adjustCssApproximationActive\s+\? \['色調整は近似表示'\]/u);
  assert.match(source, /!frameEngineMediaIdle && summary\.videoFx\?\.look[\s\S]+clip LUT はグローバル LUT を置換/u);
});
