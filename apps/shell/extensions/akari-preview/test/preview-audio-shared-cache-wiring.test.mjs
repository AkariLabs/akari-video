import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(process.env.AKARI_AUDIO_WIRING_SOURCE
  ?? new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

test('page owns one audio cache across summary rebuilds and releases it on unload', () => {
  const bootstrap = source.slice(source.indexOf('const sharedAudioCache ='), source.indexOf('const audioStatus ='));
  assert.match(bootstrap, /createPreviewAudioSharedCache\(\)/);
  assert.match(bootstrap, /sharedCache: sharedAudioCache/);
  assert.match(source, /audioSupply\.dispose\(\);\s*sharedAudioCache\.dispose\(\)/);
});

test('audio labels require a held gate or 300 ms of missing audio during playback', () => {
  const status = source.slice(source.indexOf('const updateAudioStatus ='), source.indexOf('const updateAudio ='));
  assert.match(status, /supply\?\.gate\?\.holding && supply\.gate\.heldMs >= 300/);
  assert.match(status, /statusPlaying && missingAudioSinceMs !== null/);
  assert.match(status, /performance\.now\(\) - missingAudioSinceMs >= 300/);
});
