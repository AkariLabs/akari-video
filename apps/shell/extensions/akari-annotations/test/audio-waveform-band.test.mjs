import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');

function method(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `${startNeedle}..${endNeedle}`);
  return source.slice(start, end);
}

test('音声キーフレームは高さゲートとSVGに依存しない固定pxのひし形で描く', () => {
  const markers = method('protected appendAudioKeyframeMarkers(', 'protected updateBgmWaveform(');
  assert.match(source, /const AUDIO_KEYFRAME_MARKER_SIZE_PX = 6;/u);
  assert.match(markers, /width: `\$\{AUDIO_KEYFRAME_MARKER_SIZE_PX\}px`/u);
  assert.match(markers, /height: `\$\{AUDIO_KEYFRAME_MARKER_SIZE_PX\}px`/u);
  assert.match(markers, /translateX\(-50%\) rotate\(45deg\)/u);
  assert.match(markers, /pointerEvents: 'none'/u);
  assert.doesNotMatch(markers, /MIN_TRACK_HEIGHT|viewBox|preserveAspectRatio|polyline|circle/iu);
});

test('BGM はループタイル、narration は source 秒窓スライスを波形更新へ渡す', () => {
  const bgm = method('protected updateBgmWaveform(', 'protected updateNarrationWaveform(');
  const narration = method('protected updateNarrationWaveform(', 'protected updateSfxWaveform(');
  assert.match(bgm, /audioLoopTilePeaks\(peaks/u);
  assert.match(bgm, /speed: bgm\.speed/u);
  assert.match(narration, /audioSourceSliceWindow\(/u);
  assert.match(narration, /this\.sfxWaveformSlice\(/u);
  assert.match(narration, /this\.updateAudioClipWaveform\(/u);
});

test('SFX signature はズーム寸法を持たず波形更新は再利用要素でも毎パス走る', () => {
  const renderStrip = method('protected renderStrip(): void', 'protected laneBand');
  const signatureStart = renderStrip.indexOf('const audioSignature = JSON.stringify([');
  const signatureEnd = renderStrip.indexOf(']);', signatureStart);
  assert.ok(signatureStart >= 0 && signatureEnd > signatureStart);
  const signature = renderStrip.slice(signatureStart, signatureEnd);
  assert.doesNotMatch(signature, /layoutViewDuration|stripLayoutWidthPx|barWidthPx/u);
  assert.match(renderStrip, /this\.updateSfxWaveform\(/u);
  assert.doesNotMatch(renderStrip, /if \(created\) this\.updateSfxWaveform/u);
});

test('音声 canvas はラベル後の中央配置を使い固定下端貼り付けをしない', () => {
  const update = method('protected updateAudioWaveformCanvas(', 'protected audioWaveformMaster(');
  assert.match(update, /audioWaveformBandLayout\(itemHeightPx, CLIP_HEADER_HEIGHT\)/u);
  assert.match(update, /top: `\$\{band\.topPx\}px`/u);
  assert.match(update, /height: `\$\{band\.heightPx\}px`/u);
  assert.doesNotMatch(update, /itemHeightPx - WAVEFORM_BAND_HEIGHT_PX/u);
});

test('音声波形は上限付きマスターを再利用し可視 canvas へ drawImage 1回で転送する', () => {
  const clipUpdate = method('protected updateAudioClipWaveform(', 'protected updateAudioWaveformCanvas(');
  const canvasUpdate = method('protected updateAudioWaveformCanvas(', 'protected audioWaveformMaster(');
  const master = method('protected audioWaveformMaster(', 'protected audioWaveformPeakIdentity(');
  assert.match(clipUpdate, /audioClipLocalGeometry\(/u);
  assert.match(canvasUpdate, /audioWaveformRepaintNeeded\(previous, next\)/u);
  assert.match(canvasUpdate, /context\.drawImage\(/u);
  assert.doesNotMatch(canvasUpdate, /for \(/u);
  assert.match(master, /AUDIO_WAVEFORM_MASTER_CACHE_LIMIT/u);
  assert.match(master, /master\.width = peaks\.length/u);
});
