import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/node/akari-preview-service.ts', import.meta.url), 'utf8');

test('video-fx runtime is read synchronously and injected before the preview bootstrap', () => {
  assert.match(service, /videoFxJavaScript: readFileSync\(resolve\(directory, 'video-fx\.js'\), 'utf8'\)/);
  assert.match(handler, /assets\.videoFxJavaScript[\s\S]*assets\.runtimeJavaScript/);
});

test('both native transition planes opt into anonymous CORS before WebGL texImage2D', () => {
  assert.match(handler, /id="preview-video"[^>]+crossorigin="anonymous"/);
  assert.match(handler, /id="transition-video"[^>]+crossorigin="anonymous"/);
  assert.match(handler, /layerVideo\.crossOrigin = 'anonymous'/);
});

test('undeclared projects keep the rail structurally inert', () => {
  assert.match(handler, /const hasBaseVideoFx = Boolean\(videoFxConfig/);
  assert.match(handler, /hasBaseVideoFx \? mountVideoFxRail\(video, 'source'/);
  assert.match(handler, /entry\.spec\.chromaKey[\s\S]*mountVideoFxRail\(entry\.video/);
});

test('transition and layer styles are finalized before externally-clocked rail rendering', () => {
  assert.match(handler, /renderTransitionPlate\(outputTime\)[\s\S]*applyCutsMuteState\(\);[\s\S]*renderVideoFx\(outputTime\)/);
  assert.match(handler, /transitionVideoFxRail\.render\(timelineTime\)/);
  assert.match(handler, /entry\.fxRail\.render\(timelineTime\)/);
});

test('rail failure restores the honest-preview LUT/chroma badge path', () => {
  assert.match(handler, /event\.status === 'failed'/);
  assert.match(handler, /videoFxFailedIndicators\.add\('LUT'\)/);
  assert.match(handler, /videoFxFailedIndicators\.add\('クロマキー'\)/);
});

