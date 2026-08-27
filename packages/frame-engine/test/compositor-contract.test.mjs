import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const source = await readFile(path.resolve(import.meta.dirname, '../src/compositor/webgl2.ts'), 'utf8');
const comparisonSource = await readFile(path.resolve(import.meta.dirname, 'golden/layers-compare.mjs'), 'utf8');
const goldenRendererSource = await readFile(path.resolve(import.meta.dirname, 'golden/renderer.ts'), 'utf8');
const transitionComparisonSource = await readFile(
  path.resolve(import.meta.dirname, 'golden/transitions-compare.mjs'),
  'utf8',
);
const mattePathSource = await Promise.all([
  'src/timeline/plan.ts', 'src/evaluate.ts', 'src/compositor/webgl2.ts'
].map(file => readFile(path.resolve(import.meta.dirname, '..', file), 'utf8'))).then(values => values.join('\n'));

test('layer compositor keeps the no-FBO base path and guards projective w', () => {
  assert.match(source, /if \(layers\.length === 0 && !hasLook\)[\s\S]+configureBaseDraw\(plan, null\)/u);
  const directPath = source.slice(
    source.indexOf('if (layers.length === 0 && !hasLook)'),
    source.indexOf('this.ensureFbos(output.width, output.height)'),
  );
  assert.doesNotMatch(directPath, /this\.bind\(0, this\.baseTextures\[0\]!\)/u);
  assert.match(source, /homogeneous\.z <= 0\.000001/u);
  assert.match(source, /mix\(dst\.rgb, blend\(dst\.rgb, src\.rgb\), alpha\)/u);
  assert.match(source, /texture\(maskY, sourceUv\)\.r/u);
  assert.match(source, /src\.a \* maskA \* opacity/u);
  assert.match(source, /\['maskY', 5\]/u);
  assert.match(source, /const FBO_SCRATCH_UNIT = 9/u);
  assert.match(source, /this\.bind\(FBO_SCRATCH_UNIT, t\)/u);
});

test('golden transition and look sections fail on GL errors and expose readable expectations', () => {
  assert.match(goldenRendererSource, /transitionStats = \{\s+glErrors:/u);
  assert.match(goldenRendererSource, /lookStats = \{\s+glErrors:/u);
  assert.match(goldenRendererSource, /expectedDetail:/u);
  assert.match(goldenRendererSource, /expected,\s+expectedDetail/u);
  assert.match(goldenRendererSource, /axis=\$\{expectedDetail\.axis\}, bSide=/u);
});

test('transition golden samples resolve the same timeline frame grid as render-cut comparison', () => {
  for (const value of [goldenRendererSource, transitionComparisonSource]) {
    assert.match(value, /function transitionOutputTimeSeconds/u);
    assert.match(value, /0\.6 \* \(transitionIndex \+ 1\) \+ 0\.4 \* u/u);
    assert.match(value, /0\.6 \+ u \* 0\.4/u);
  }
  assert.match(goldenRendererSource, /buildResolvedTimelinePlan\(\s+transitionsEdit\.cuts/u);
  assert.match(goldenRendererSource, /evaluationPlanFromResolvedTimeline\(/u);
  assert.match(goldenRendererSource, /plan\.transition\?\.type !== id/u);
  assert.match(goldenRendererSource, /Math\.abs\(plan\.transition\.progress - u\) >= 1e-6/u);
  assert.match(goldenRendererSource, /plan\.base\s+\.map\(layer => Math\.round\(layer\.sourceTimeUs \* FPS \/ 1e6\)\)/u);
});

test('transition vocabulary is generated from the shared table and look is a final sampler3D pass', () => {
  assert.match(source, /TRANSITION_VOCABULARY\.map\(\(entry, index\) => \[entry\.id, index \+ 1\]\)/u);
  assert.match(source, /export const TRANSITION_BLUR_MAX_TAPS = 65/u);
  assert.match(source, /uniform sampler3D lut/u);
  assert.match(source, /gl\.RGBA16F/u);
  assert.match(source, /gl\.HALF_FLOAT/u);
  assert.match(source, /const LUT_UNIT = 11/u);
  assert.match(source, /layers\.length === 0 && !hasLook/u);
  assert.match(source, /this\.lookTexture\(look\.lut\)/u);
  assert.match(source, /\.\.\.this\.ownedLookTextures/u);
  assert.match(source, /draw\(\);\s+this\.recordGlErrors\(synchronization\);[\s\S]{0,300}this\.bind\(0, this\.baseTextures\[0\]!\)/u);
  assert.match(source, /configureBaseDraw\(plan, null\);\s+draw\(\);\s+this\.recordGlErrors\(synchronization\)/u);
  assert.match(source, /configureBaseDraw\(plan, this\.fbos\[0\]!\);\s+draw\(\);\s+this\.recordGlErrors\(synchronization\)/u);
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
