import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const source = await readFile(path.resolve(import.meta.dirname, '../src/compositor/webgl2.ts'), 'utf8');
const comparisonSource = await readFile(path.resolve(import.meta.dirname, 'golden/layers-compare.mjs'), 'utf8');
const mattePathSource = await Promise.all([
  'src/timeline/plan.ts', 'src/evaluate.ts', 'src/compositor/webgl2.ts'
].map(file => readFile(path.resolve(import.meta.dirname, '..', file), 'utf8'))).then(values => values.join('\n'));

test('layer compositor keeps the no-FBO base path and guards projective w', () => {
  assert.match(source, /if \(layers\.length === 0\)[\s\S]+configureBaseDraw\(plan, null\)/u);
  assert.match(source, /homogeneous\.z <= 0\.000001/u);
  assert.match(source, /mix\(dst\.rgb, blend\(dst\.rgb, src\.rgb\), alpha\)/u);
  assert.match(source, /texture\(maskY, sourceUv\)\.r/u);
  assert.match(source, /src\.a \* maskA \* opacity/u);
  assert.match(source, /\['maskY', 5\]/u);
  assert.match(source, /const FBO_SCRATCH_UNIT = 9/u);
  assert.match(source, /this\.bind\(FBO_SCRATCH_UNIT, t\)/u);
});

test('frame-engine matte path has no VP8/VP9 decoder branch', () => {
  assert.doesNotMatch(mattePathSource, /libvpx|vp[89]/iu);
});

test('GPU timing uses timer queries and dispose does not lose the canvas context', () => {
  assert.match(source, /EXT_disjoint_timer_query_webgl2/u);
  assert.match(source, /TIME_ELAPSED_EXT/u);
  assert.match(source, /GPU_DISJOINT_EXT/u);
  assert.doesNotMatch(source, /WEBGL_lose_context|loseContext\(/u);
  assert.match(source, /synchronization !== 'finish'/u);
  assert.match(source, /stats\.glErrors \+= 1/u);
});

test('direct upload has RGBA shader branches and a sticky copyTo fallback', () => {
  assert.match(source, /format0 == 2[\s\S]+texture\(rgba0, q\)/u);
  assert.match(source, /yuvFormat == 2[\s\S]+texture\(lrgba, sourceUv\)/u);
  assert.match(source, /maskFormat == 2[\s\S]+texture\(maskRgba, sourceUv\)\.r/u);
  assert.match(source, /UNPACK_ALIGNMENT, 1/u);
  assert.match(source, /UNPACK_FLIP_Y_WEBGL, 0/u);
  assert.match(source, /UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0/u);
  assert.match(source, /UNPACK_COLORSPACE_CONVERSION_WEBGL/u);
  assert.match(source, /BROWSER_DEFAULT_WEBGL/u);
  assert.match(source, /gl\.texImage2D\([\s\S]+gl\.RGBA8[\s\S]+frame/u);
  assert.match(source, /this\.directUploadDisabled = true/u);
  assert.match(source, /gl\.getError\(\)/u);
  assert.match(source, /MAX_TEXTURE_IMAGE_UNITS/u);
  assert.match(source, /get uploadPath\(\): UploadPath/u);
  assert.match(source, /displayWidth/u);
  assert.match(source, /displayHeight/u);
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
