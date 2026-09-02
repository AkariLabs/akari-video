import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AUDIO_KEYFRAME_MAX_DB,
  AUDIO_KEYFRAME_MIN_DB,
  audioKeyframeDbToLinearGain,
  audioKeyframeEffectiveGainDb,
  audioKeyframeInterpolatedGainDb,
  audioKeyframeMaximumZoom,
  audioKeyframeScrollWindow,
  audioKeyframeSeekBarHitTest,
  audioKeyframeTimeToViewPx,
  audioKeyframeViewPxToTime,
  audioKeyframeZoomWindow,
} from '../lib/common/audio-keyframe-editor-geometry.js';

const dialog = readFileSync(new URL('../src/browser/akari-audio-keyframe-dialog.ts', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');

function section(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `${startNeedle}..${endNeedle}`);
  return source.slice(start, end);
}

function closeTo(actual, expected, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ~= ${expected}`);
}

test('裁定1: キーフレーム0件は全体ゲインだけを実効dBにする', () => {
  assert.equal(audioKeyframeEffectiveGainDb([], 4, -6), -6);
});

test('裁定1: キーフレーム1件は時刻に関係なく端値を保持して全体ゲインを合算する', () => {
  const points = [{ t: 2, gainDb: -12, easing: 'linear' }];
  assert.equal(audioKeyframeEffectiveGainDb(points, 0, 3), -9);
  assert.equal(audioKeyframeEffectiveGainDb(points, 9, 3), -9);
});

test('裁定1: linear はキーフレーム間を線形補間して全体ゲインを合算する', () => {
  const points = [{ t: 0, gainDb: -20, easing: 'linear' }, { t: 10, gainDb: 0 }];
  assert.equal(audioKeyframeEffectiveGainDb(points, 2.5, 2), -13);
});

test('裁定1: hold は次の点の直前まで区間始点の値を保持する', () => {
  const points = [{ t: 0, gainDb: -18, easing: 'hold' }, { t: 4, gainDb: 0 }];
  assert.equal(audioKeyframeInterpolatedGainDb(points, 3.999), -18);
  assert.equal(audioKeyframeInterpolatedGainDb(points, 4), 0);
});

test('裁定1: ease-in-out は smoothstep で補間する', () => {
  const points = [{ t: 0, gainDb: 0, easing: 'ease-in-out' }, { t: 4, gainDb: 8 }];
  closeTo(audioKeyframeInterpolatedGainDb(points, 1), 1.25);
});

test('裁定1: MIN/MAX 境界を保ち、範囲外の点値は境界へクランプする', () => {
  const points = [{ t: 0, gainDb: -99 }, { t: 1, gainDb: 99 }];
  assert.equal(audioKeyframeInterpolatedGainDb(points, 0), AUDIO_KEYFRAME_MIN_DB);
  assert.equal(audioKeyframeInterpolatedGainDb(points, 1), AUDIO_KEYFRAME_MAX_DB);
});

test('裁定1: dB は gain = 10^(dB/20) で線形値へ変換する', () => {
  assert.equal(audioKeyframeDbToLinearGain(0), 1);
  closeTo(audioKeyframeDbToLinearGain(-20), 0.1);
});

test('裁定1: new Audio と WebAudio の source→gain→destination を配線し ducking を除外する', () => {
  assert.match(dialog, /this\.audio = new Audio\(props\.audioUri\)/u);
  assert.match(dialog, /createMediaElementSource\(this\.audio\)/u);
  assert.match(dialog, /this\.audioSource\.connect\(this\.playbackGain\)/u);
  assert.match(dialog, /this\.playbackGain\.connect\(this\.audioContext\.destination\)/u);
  assert.match(dialog, /audioKeyframeDbToLinearGain\(effectiveDb\)/u);
  assert.match(dialog, /ducking は他レーンの発話区間に依存/u);
});

test('裁定1: close と accept 共通の detach で Audio 停止と AudioContext close を行う', () => {
  const detach = section(dialog, 'protected override onBeforeDetach(', 'protected setupCanvas()');
  const dispose = section(dialog, 'protected disposePlayback()', 'protected hitTestPoint(');
  assert.match(detach, /this\.disposePlayback\(\)/u);
  assert.match(dispose, /this\.audio\.pause\(\)/u);
  assert.match(dispose, /this\.audioContext\.close\(\)/u);
});

test('裁定1: 非対応コーデックは指定の1行だけを再生状態へ表示する', () => {
  const failed = section(dialog, 'protected readonly playbackFailed', 'protected async togglePlayback()');
  assert.match(failed, /textContent = 'この形式は再生未対応'/u);
  assert.doesNotMatch(failed, /ffmpeg/iu);
});

test('裁定2: Space は再生トグルへ配線し input と select のフォーカス中は無効にする', () => {
  const keydown = section(dialog, 'protected readonly dialogKeydown', 'constructor(');
  assert.match(keydown, /event\.code === 'Space'/u);
  assert.match(keydown, /!this\.isEditorInput\(event\.target\)/u);
  assert.match(keydown, /this\.togglePlayback\(\)/u);
  assert.match(dialog, /target instanceof HTMLInputElement \|\| target instanceof HTMLSelectElement/u);
});

test('裁定2: 再生ヘッドは現在の表示秒をズーム写像して canvas 全高へ描く', () => {
  const head = section(dialog, 'protected paintPlaybackHead()', 'protected timeToCanvasPx(');
  assert.match(head, /this\.timeToCanvasPx\(this\.currentTimeSeconds\)/u);
  assert.match(head, /this\.ctx\.lineTo\(x, this\.canvasHeight\)/u);
  assert.match(dialog, /window\.requestAnimationFrame\(update\)/u);
});

test('裁定3: ズーム窓の時刻とpxは往復し、端でクランプする', () => {
  assert.equal(audioKeyframeTimeToViewPx(25, 20, 30, 800), 400);
  assert.equal(audioKeyframeTimeToViewPx(40, 20, 30, 800), 800);
  assert.equal(audioKeyframeViewPxToTime(400, 20, 30, 800), 25);
  assert.equal(audioKeyframeViewPxToTime(-1, 20, 30, 800), 20);
  assert.equal(audioKeyframeViewPxToTime(900, 20, 30, 800), 30);
});

test('裁定3: シークバー帯は上端14pxだけをヒットとする', () => {
  assert.equal(audioKeyframeSeekBarHitTest(0), true);
  assert.equal(audioKeyframeSeekBarHitTest(14), true);
  assert.equal(audioKeyframeSeekBarHitTest(14.01), false);
  assert.equal(audioKeyframeSeekBarHitTest(-1), false);
});

test('裁定3: シーク帯は本体の打点判定より先に分岐し、クリックとドラッグを同じ経路へ渡す', () => {
  const pointer = section(dialog, 'protected wirePointerEvents()', 'protected redraw()');
  assert.ok(pointer.indexOf('audioKeyframeSeekBarHitTest') < pointer.indexOf('this.hitTestPoint'));
  assert.match(pointer, /this\.activeSeekPointerId = event\.pointerId/u);
  assert.match(pointer, /this\.seekToCanvasX\(point\.x\)/u);
  assert.match(pointer, /this\.seekToCanvasX\(this\.canvasPoint\(event\)\.x\)/u);
  assert.match(pointer, /this\.points\.push\(/u);
});

test('裁定4: カーソル中心ズームはカーソル直下の時刻を固定する', () => {
  const next = audioKeyframeZoomWindow(
    { startSeconds: 0, endSeconds: 100 }, 100, 200, 800, 2, 100,
  );
  assert.deepEqual(next, { startSeconds: 12.5, endSeconds: 62.5 });
  assert.equal(audioKeyframeViewPxToTime(200, next.startSeconds, next.endSeconds, 800), 25);
});

test('裁定4: ズーム倍率は1x・100x・バケット3px相当でクランプする', () => {
  assert.equal(audioKeyframeMaximumZoom(100, 100), 3);
  assert.equal(audioKeyframeMaximumZoom(10000, 100), 100);
  const maximum = audioKeyframeZoomWindow(
    { startSeconds: 0, endSeconds: 100 }, 100, 400, 800, 1000, 4,
  );
  assert.equal(maximum.endSeconds - maximum.startSeconds, 25);
  assert.deepEqual(audioKeyframeZoomWindow(maximum, 100, 400, 800, 0.0001, 4), {
    startSeconds: 0,
    endSeconds: 100,
  });
});

test('裁定4: 水平スクロールは表示窓幅を保って全尺端で止まる', () => {
  assert.deepEqual(audioKeyframeScrollWindow({ startSeconds: 20, endSeconds: 40 }, 100, 15), {
    startSeconds: 35,
    endSeconds: 55,
  });
  assert.deepEqual(audioKeyframeScrollWindow({ startSeconds: 20, endSeconds: 40 }, 100, 999), {
    startSeconds: 80,
    endSeconds: 100,
  });
});

test('裁定4: Ctrl+wheel はズーム、Shift+wheel はスクロールへ分岐する', () => {
  const wheel = section(dialog, 'protected handleWheel(', 'protected playbackSpeed()');
  assert.match(wheel, /if \(event\.ctrlKey\)/u);
  assert.match(wheel, /audioKeyframeZoomWindow\(/u);
  assert.match(wheel, /audioKeyframeScrollWindow\(/u);
  assert.match(wheel, /this\.scheduleDetailedWaveform\(\)/u);
});

test('裁定4: 精細peaks取得は0.5秒量子化を含む既存prefetchと200ms debounceを再利用する', () => {
  assert.match(dialog, /new AudioWaveformDebounceGate\(200\)/u);
  assert.match(dialog, /audioWaveformPrefetchWindow\(\{/u);
  assert.match(dialog, /audioWaveformTierBucketCount\(\s*'T2'/u);
  assert.match(dialog, /this\.props\.fetchWaveform\(\{/u);
});

test('裁定4: 精細取得待ち中はfullPeaks由来の手持ち波形を描画し続ける', () => {
  const display = section(dialog, 'protected displayPeaks()', 'protected slicePeaks(');
  const fetch = section(dialog, 'protected fetchDetailedWaveform(', 'protected wirePlayback()');
  assert.ok(display.indexOf('this.detailedPeaksForView()') < display.indexOf('let basePeaks'));
  assert.match(display, /this\.props\.fullPeaks/u);
  assert.doesNotMatch(fetch, /fullPeaks\s*=/u);
  assert.match(fetch, /finally\(\(\) => \{/u);
});

test('裁定4: widget は audioUri と bucketCount 付きfetcherだけをpropsへ追加し既存write経路を保つ', () => {
  const open = section(widget, 'protected async openAudioKeyframeEditor(', 'protected exitAudioTrimmerMode(');
  assert.match(open, /audioUri,/u);
  assert.match(open, /fetchWaveform: async request =>/u);
  assert.match(open, /this\.annotationsService\.getClipWaveform\(\{/u);
  assert.match(open, /bucketCount: request\.bucketCount/u);
  assert.match(open, /kind: 'audio-keyframes'/u);
  assert.match(open, /kind: 'bgm-gain'/u);
});

test('裁定1: BGMを含む再生はloopを使わずソース実尺1周目で止める', () => {
  const duration = section(dialog, 'protected playbackSourceDurationSeconds()', 'protected playbackDurationSeconds()');
  assert.match(duration, /this\.props\.sourceDurationSeconds - this\.playbackSourceStartSeconds\(\)/u);
  assert.doesNotMatch(dialog, /this\.audio\.loop\s*=\s*true/u);
});
