import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/node/akari-preview-service.ts', import.meta.url), 'utf8');

test('video-fx runtime is read synchronously and injected before the preview bootstrap', () => {
  assert.match(service, /videoFx: read\('video-fx\.js'\)/);
  assert.match(handler, /assets\.videoFxJavaScriptUrl[\s\S]*assets\.runtimeJavaScriptUrl/);
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

test('double-buffer swap hides the retired FX canvas and keeps the active canvas visible', () => {
  const helperStart = handler.indexOf('const syncDoubleBufferVideoFxVisibility = () => {');
  const helperEnd = handler.indexOf('\n            };', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'double-buffer FX visibility helper is missing');
  const helper = handler.slice(helperStart, helperEnd);
  assert.match(helper, /baseVideoFxRail\.canvas\.style\.display = video\.style\.display \|\| ''/);
  assert.match(helper, /standbyVideoFxRail\.canvas\.style\.display = standbyVideo\.style\.display \|\| ''/);
  assert.match(helper, /baseVideoFxRail\.canvas\.style\.zIndex = video\.style\.zIndex \|\| ''/);
  assert.doesNotMatch(helper, /transitionVideoFxRail|stillVideoFxRail/);

  const swapStart = handler.indexOf('const activatePreloadedSegment = (index, segment, target) => {');
  const swapEnd = handler.indexOf('\n            let currentTransitionVideoSourceId = null;', swapStart);
  const swap = handler.slice(swapStart, swapEnd);
  assert.match(swap, /baseVideoFxRail = standbyVideoFxRail;[\s\S]*standbyVideoFxRail = outgoingFxRail;[\s\S]*syncDoubleBufferVideoFxVisibility\(\)/);

  const renderStart = handler.indexOf('const renderVideoFx = timelineTime => {');
  const renderEnd = handler.indexOf('\n            };', renderStart);
  const render = handler.slice(renderStart, renderEnd);
  assert.match(render, /syncDoubleBufferVideoFxVisibility\(\);[\s\S]*baseVideoFxRail\.render\(timelineTime\)/);
});

test('rail failure restores the honest-preview LUT/chroma badge path', () => {
  assert.match(handler, /event\.status === 'failed'/);
  assert.match(handler, /videoFxFailedIndicators\.add\('LUT'\)/);
  assert.match(handler, /videoFxFailedIndicators\.add\('クロマキー'\)/);
});
