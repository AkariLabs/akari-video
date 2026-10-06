import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { readHandlerSource } from './helpers/handler-source.mjs';

const require = createRequire(import.meta.url);
const { captionPlaybackStallMs } = require('../lib/common/caption-playback-watchdog.js');

test('hidden webview uses a shorter playback watchdog interval for CSS caption motion', () => {
  assert.equal(captionPlaybackStallMs('visible'), 400);
  assert.equal(captionPlaybackStallMs('hidden'), 120);
  const source = readHandlerSource();
  assert.match(source, /captionPlaybackStallMsFn\(document\.visibilityState\)/u);
  assert.match(source, /\}, 100\);/u);
});
