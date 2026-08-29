import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const compiled = readFileSync(
  path.resolve(import.meta.dirname, '../lib/browser/akari-preview-open-handler.js'),
  'utf8',
);

test('shell frame-engine state and bootstrap include capability-based source selection', () => {
  for (const token of [
    'videoSourceOriginals',
    'frameEngineSourceMode',
    'needsCodecProbe',
    'chooseSource',
    'parseSourceSelectionMode',
    'declared',
    'probeSourceCodec',
    'setForceSoftwareDecode',
    'akariFrameEngineSources',
  ]) {
    assert.match(compiled, new RegExp(token));
  }
  assert.match(compiled, /frame-engine-notice/u);
  assert.match(compiled, /AKARI_FRAME_ENGINE_SOURCE/u);
  assert.match(compiled, /AKARI_FRAME_ENGINE_FORCE_SW/u);
  assert.match(compiled, /cutSourceIds/u);
  assert.match(compiled, /not-a-cut-source/u);
});
