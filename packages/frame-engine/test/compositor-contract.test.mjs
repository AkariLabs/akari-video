import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const source = await readFile(path.resolve(import.meta.dirname, '../src/compositor/webgl2.ts'), 'utf8');
const comparisonSource = await readFile(path.resolve(import.meta.dirname, 'golden/layers-compare.mjs'), 'utf8');

test('layer compositor keeps the no-FBO base path and guards projective w', () => {
  assert.match(source, /if \(layers\.length === 0\)[\s\S]+configureBaseDraw\(plan, null\)/u);
  assert.match(source, /homogeneous\.z <= 0\.000001/u);
  assert.match(source, /mix\(dst\.rgb, blend\(dst\.rgb, src\.rgb\), alpha\)/u);
});

test('GPU timing uses timer queries and dispose does not lose the canvas context', () => {
  assert.match(source, /EXT_disjoint_timer_query_webgl2/u);
  assert.match(source, /TIME_ELAPSED_EXT/u);
  assert.match(source, /GPU_DISJOINT_EXT/u);
  assert.doesNotMatch(source, /WEBGL_lose_context|loseContext\(/u);
});

test('failed PBO fence allocation releases its bound buffer', () => {
  const failure = source.slice(source.indexOf('if (!fence)'), source.indexOf('this.gl.flush()', source.indexOf('if (!fence)')));
  assert.match(failure, /bindBuffer\(this\.gl\.PIXEL_PACK_BUFFER, null\)/u);
  assert.match(failure, /deleteBuffer\(pbo\)/u);
});

test('cross-engine comparison uses midpoint extraction and fail-closed class limits', () => {
  assert.match(comparisonSource, /\(frameNumber \+ 0\.5\) \/ FPS/u);
  assert.match(comparisonSource, /CLASS_LIMITS/u);
  assert.match(comparisonSource, /engine-side error \(investigate\)/u);
  assert.match(comparisonSource, /if \(engineErrors\.length > 0\)/u);
  assert.doesNotMatch(comparisonSource, /cls === 'noise-floor' \? 'noise floor' : 'known filtergraph difference'/u);
});
