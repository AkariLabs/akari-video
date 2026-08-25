import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');
const l1Driver = readFileSync(
  join(here, '..', 'evidence', 'transition-first-class-l1', 'scripts', 'run-l1.mjs'),
  'utf8'
);

test('webview は transition window 内だけ 2 本目の video を同期する', () => {
  assert.match(source, /id="transition-video" data-akari-transition-role="incoming"/);
  assert.match(source, /transitionWindows = \(map\.transitionWindows \|\| \[\]\)/);
  assert.match(source, /applyTransitionSegmentSource\(window\.incoming/);
  assert.match(source, /transitionVideo\.currentTime = target/);
  assert.match(source, /outgoingElement\.dataset\.akariTransitionProgress = progressText/);
  assert.match(source, /incomingElement\.dataset\.akariTransitionProgress = progressText/);
});

test('incoming video は window へ入る前に src と先頭フレームを先読みする', () => {
  assert.match(source, /preloadUpcomingTransition = timelineTime =>/);
  assert.match(source, /applyTransitionSegmentSource\(upcoming\.incoming, primeIncomingFrame\)/);
  assert.match(source, /transitionVideo\.currentTime = target/);
  assert.match(source, /preloadUpcomingTransition\(outputTime\)/);
  const calls = source.match(/preloadUpcomingTransition\(outputTime\)/g) || [];
  assert.ok(calls.length >= 2, 'rebuild と tick の双方から先読みする');
});

test('webview の 5 種は opacity / plate / clip-path の別レールへ配線される', () => {
  assert.match(source, /computeTransitionVisualFn\(window\.type, progress\)/);
  assert.match(source, /transitionVideo\.style\.clipPath = visual\.incomingClipPath/);
  assert.match(source, /transitionPlate\.style\.opacity = String\(visual\.plateOpacity\)/);
  assert.match(source, /video\.style\.opacity = String\(outgoingOpacity \* visual\.outgoingOpacity\)/);
});

test('窓音声は前後を線形クロスし二重無減衰にしない', () => {
  assert.match(source, /video\.volume = transitionAudioBaseVolume \* \(1 - progress\)/);
  assert.match(source, /transitionVideo\.volume = transitionAudioBaseVolume \* progress/);
});

test('L1 は ensureVisible と incoming ready を固定 sleep なしで待つ', () => {
  assert.match(l1Driver, /for \(let attempt = 1; attempt <= 15 && !previewConnection/);
  assert.match(l1Driver, /connectPreview\(port, 4\)/);
  assert.match(l1Driver, /waitForIncomingPreload\(\)/);
  assert.match(l1Driver, /state\.incoming\.readyState >= 1/);
  assert.doesNotMatch(l1Driver, /sleep\(5000\)/);
});
