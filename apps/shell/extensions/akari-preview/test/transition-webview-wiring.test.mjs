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

test('webview の 29 種は正準 previewKind から opacity / transform / clip / mask へ配線される', () => {
  assert.match(source, /const transitionVocabulary = \$\{JSON\.stringify\(TRANSITION_VOCABULARY\)\}/);
  assert.match(source, /transitionDefinition\?\.previewKind \|\| 'fallback'/);
  assert.match(source, /incomingElement\.style\.clipPath = visual\.incomingClipPath/);
  assert.match(source, /visual\.outgoingTransform/);
  assert.match(source, /visual\.incomingMask/);
  assert.match(source, /transitionPlate\.style\.opacity = String\(visual\.plateOpacity\)/);
  assert.match(source, /video\.style\.opacity = String\(outgoingOpacity \* visual\.outgoingOpacity\)/);
  assert.match(source, /visual\.engine === 'directional-blur'/);
  assert.match(source, /visual\.engine === 'pixelize'/);
  assert.match(source, /visual\.engine === 'noise-dissolve'/);
  assert.match(source, /url\(#akari-transition-hblur\)/);
  assert.match(source, /url\(#akari-transition-dissolve\)/);
  assert.match(source, /drawTransitionPixelize\(/);
});

test('未知・近似なし種別は合成領域の日本語ラベルへ配線される', () => {
  assert.match(source, /id="transition-fallback-label"/);
  assert.match(source, /transitionDefinition\?\.labelJa \|\| String\(window\.type\)/);
  assert.match(source, /transitionFallbackLabel\.textContent = visual\.fallbackLabel/);
  assert.match(source, /transitionFallbackLabel\.dataset\.akariTransitionFallback/);
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

test('L1 reveal は移動量 50% と outgoing 前面の paint 順まで検査する', () => {
  assert.match(l1Driver, /points\[1\]\.outgoing\.height \* 0\.5/u);
  assert.match(l1Driver, /-points\[1\]\.outgoing\.height \* 0\.5/u);
  assert.match(l1Driver, /points\[1\]\.paint\.bottom\.slice\(0, 2\).*preview-video.*transition-video/u);
  assert.match(l1Driver, /points\[1\]\.paint\.top\.slice\(0, 2\).*preview-video.*transition-video/u);
  assert.match(l1Driver, /document\.elementsFromPoint/u);
});

test('L1 fade plate は非対称式を p=0.1 / 0.5 / 0.9 の全点で検査する', () => {
  assert.match(l1Driver, /progress \/ 0\.18/u);
  assert.match(l1Driver, /\(1 - progress\) \/ 0\.7/u);
  assert.match(l1Driver, /\[0\.1, 0\.5, 0\.9\]\.entries\(\)/u);
  assert.match(l1Driver, /fadePlateOpacity\(progress\)/u);
  assert.match(l1Driver, /0\.005/u);
  assert.doesNotMatch(l1Driver, /plate\.opacity >= 0\.95/u);
});

test('L1 dissolve は不透明な両層と incoming ノイズフィルタを検査する', () => {
  assert.match(l1Driver, /point\.outgoing\.opacity, 1/u);
  assert.match(l1Driver, /point\.incoming\.opacity, 1/u);
  assert.match(l1Driver, /point\.outgoing\.filter, ''/u);
  assert.match(l1Driver, /akari-transition-dissolve/u);
});
