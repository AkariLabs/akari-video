import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { setLanguage } from '@akari-video/i18n';
import { TRANSITION_VOCABULARY } from '@akari-video/edit-store';
import { previewBootstrapScript } from '../lib/browser/preview-script-bootstrap.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const source = readHandlerSource();
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

test('webview kernel へ fps と静止画の無限 handle room を渡す', () => {
  assert.match(source, /buildTimelineMap\(timelineCuts, \{[\s\S]*trackZ: track => track,[\s\S]*fps,/u);
  assert.match(source, /handleRoom: cutIndex => imageSources\[String\(timelineCuts\[cutIndex\]\?\.src\)\]/u);
  assert.match(source, /tailSeconds: Number\.POSITIVE_INFINITY, headSeconds: Number\.POSITIVE_INFINITY/u);
});

test('transition の source seek は trim の in/out へクランプせず窓の自然延長を使う', () => {
  const compositeStart = source.indexOf('const renderTransitionComposite');
  const compositeEnd = source.indexOf('const tick =', compositeStart);
  const composite = source.slice(compositeStart, compositeEnd);
  assert.match(composite, /window\.incoming\.in \+ \(timelineTime - window\.start\) \* incomingSpeed/u);
  assert.doesNotMatch(composite, /Math\.min\([^\n]*(?:window\.incoming\.out|segment\.out)/u);
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

test('未知・近似なし種別は表示言語のラベルへ配線される', () => {
  assert.match(source, /id="transition-fallback-label"/);
  assert.match(source, /transitionLabels\[window\.type\] \|\| String\(window\.type\)/);
  assert.match(source, /translate\(`inspector\.transitionFields\.preset\.\$\{entry\.id\.replace\(/);
  assert.match(source, /getLanguage\(\)/);
  assert.match(source, /transitionFallbackLabel\.textContent = visual\.fallbackLabel/);
  assert.match(source, /transitionFallbackLabel\.dataset\.akariTransitionFallback/);
});

test('webview に渡す切り替え名は両言語で正本と一致する', () => {
  const presets = readFileSync(join(here, '../../../../../presets/transitions/index.jsonl'), 'utf8')
    .trim().split(/\r?\n/u).map(JSON.parse);
  try {
    for (const language of ['ja', 'en']) {
      setLanguage(language);
      const match = previewBootstrapScript().match(/const transitionLabels = (\{[^\n]+\});/u);
      assert.ok(match);
      const labels = JSON.parse(match[1]);
      assert.deepEqual(TRANSITION_VOCABULARY.map(entry => labels[entry.id]),
        presets.map(preset => language === 'ja' ? preset.name : preset.i18n.en.name));
    }
  } finally { setLanguage(undefined); }
});

test('UI 言語の reload 後は新しい webview スクリプトに切り替え名を焼き直す', () => {
  const settings = readFileSync(join(here, '../../akari-surfaces/src/browser/akari-settings-dialog.ts'), 'utf8');
  assert.match(settings, /window\.localStorage\.setItem\('akari\.ui\.language', value\);[\s\S]*?this\.windows\.reload\(\);/u);
  assert.match(source, /widget\.setHTML\(this\.prepareHtml\(/u);
  assert.match(source, /<script>\$\{webviewScriptText\(previewBootstrapScript\(\)\)\}<\/script>/u);
  const labels = () => JSON.parse(previewBootstrapScript().match(/const transitionLabels = (\{[^\n]+\});/u)[1]);
  const presets = readFileSync(join(here, '../../../../../presets/transitions/index.jsonl'), 'utf8')
    .trim().split(/\r?\n/u).map(JSON.parse);
  try {
    setLanguage('ja');
    const beforeReload = labels();
    setLanguage('en');
    const afterReload = labels();
    assert.notDeepEqual(afterReload, beforeReload);
    assert.deepEqual(TRANSITION_VOCABULARY.map(entry => afterReload[entry.id]),
      presets.map(preset => preset.i18n.en.name));
  } finally { setLanguage(undefined); }
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
