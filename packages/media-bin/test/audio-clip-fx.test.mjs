import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  PREVIEW_AUDIO_RECIPE,
  buildAudioClipFxFilters,
  buildPreviewAudioFilterChain,
  ensurePreviewAudioSidecar,
  previewAudioSidecarKey,
} from '../src/preview-audio-sidecar.mjs';

const baseKeyInput = {
  sourcePath: 'C:/project/audio/hit.wav', size: 1234, mtimeMs: 5678,
  inSec: 1, outSec: 5, speed: 1, padBeforeSec: 0, padAfterSec: 0,
};

test('preview recipe is v2', () => {
  assert.equal(PREVIEW_AUDIO_RECIPE, 'preview-audio-flac-v2');
});

test('clip FX chain orders trim, two-stage lowcut, denoise, then rubberband', () => {
  assert.deepEqual(buildPreviewAudioFilterChain({
    ...baseKeyInput,
    clipFx: {
      speed: 2, pitch_semitones: 12, formant: 'preserve',
      denoise: { method: 'fft', strength: 0.6 }, lowcut_hz: 120,
    },
  }), [
    'atrim=start=1:end=5',
    'asetpts=PTS-STARTPTS',
    'highpass=f=120:p=2',
    'highpass=f=120:p=2',
    'afftdn=nr=57.6:nf=-30',
    'rubberband=tempo=2:pitch=2:formant=preserved:pitchq=quality',
  ]);
});

test('fft denoise coefficient follows 12 + strength * 76', () => {
  assert.deepEqual(buildAudioClipFxFilters({ denoise: { method: 'fft', strength: 0.25 } }), [
    'afftdn=nr=31:nf=-30',
  ]);
});

test('nlm denoise coefficient follows 0.00001 + strength * 0.0002', () => {
  assert.deepEqual(buildAudioClipFxFilters({ denoise: { method: 'nlm', strength: 1 } }), [
    'anlmdn=s=0.00021',
  ]);
});

test('rubberband pitch uses 2^(semitones/12)', () => {
  assert.match(buildAudioClipFxFilters({ pitch_semitones: -12 })[0], /pitch=0\.5/u);
});

test('formant shift maps to rubberband shifted vocabulary', () => {
  assert.match(buildAudioClipFxFilters({ pitch_semitones: 1, formant: 'shift' })[0], /formant=shifted/u);
});

test('identical sidecar input and filter chain has a stable cache key', () => {
  const options = { ...baseKeyInput, clipFx: { speed: 2, pitch_semitones: 0 } };
  assert.equal(previewAudioSidecarKey(options), previewAudioSidecarKey(structuredClone(options)));
});

test('identical input reuses the cached sidecar without regenerating it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'akari-preview-clip-fx-cache-'));
  try {
    const sourcePath = join(root, 'hit.wav');
    const cacheDir = join(root, 'cache');
    writeFileSync(sourcePath, 'source');
    const stat = statSync(sourcePath);
    const options = {
      sourcePath, cacheDir, inSec: 1, outSec: 5, speed: 2,
      padBeforeSec: 0, padAfterSec: 0, clipFx: { speed: 2, lowcut_hz: 80 },
    };
    const key = previewAudioSidecarKey({ ...options, size: stat.size, mtimeMs: stat.mtimeMs });
    const outputDirectory = join(cacheDir, 'preview-audio');
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(join(outputDirectory, `${key}.flac`), 'cached-sidecar');
    let probes = 0;
    const probeAudio = () => {
      probes += 1;
      return { durationSec: 2, sampleRate: 48000, channels: 2 };
    };
    const first = await ensurePreviewAudioSidecar({ ...options, ffmpeg: 'must-not-run', probeAudio });
    const second = await ensurePreviewAudioSidecar({ ...options, ffmpeg: 'must-not-run', probeAudio });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.skipped, true);
    assert.equal(second.skipped, true);
    assert.equal(first.path, second.path);
    // The first probe persists metadata as JSON, so cache reuse needs only one probe.
    assert.equal(probes, 1);
    assert.equal(existsSync(join(outputDirectory, `${key}.json`)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('changing only the filter chain changes the cache key', () => {
  const first = previewAudioSidecarKey({ ...baseKeyInput, clipFx: { speed: 2 } });
  const second = previewAudioSidecarKey({ ...baseKeyInput, clipFx: { speed: 2, lowcut_hz: 80 } });
  assert.notEqual(first, second);
});
