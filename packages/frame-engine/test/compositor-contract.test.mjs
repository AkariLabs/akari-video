import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { TRANSITION_TYPE_IDS } from '@akari-video/edit-store';
import { buildBaseFragment } from '../dist/index.js';

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
  assert.match(source, /if \(layers\.length === 0 && !hasLook\)[\s\S]+configureBaseDraw\(plan, null, baseProgram!\)/u);
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
  assert.match(source, /configureBaseDraw\(plan, null, baseProgram!\);\s+draw\(\);\s+this\.recordGlErrors\(synchronization\)/u);
  assert.match(source, /configureBaseDraw\(plan, this\.fbos\[0\]!, baseProgram\);\s+draw\(\);\s+this\.recordGlErrors\(synchronization\)/u);
});

test('base shaders are lazily compiled and cached per transition type', () => {
  assert.match(source, /basePrograms = new Map<ResolvedTransition\['type'\], BaseProgramState>/u);
  assert.match(source, /const cached = this\.basePrograms\.get\(type\)/u);
  assert.match(source, /createProgram\(gl, buildBaseFragment\(type\)\)/u);
  assert.match(source, /this\.basePrograms\.set\(type, state\)/u);
  assert.match(source, /for \(const value of this\.basePrograms\.values\(\)\)\s+this\.gl\.deleteProgram\(value\.program\)/u);
  for (const type of ['hard-cut', ...TRANSITION_TYPE_IDS]) {
    const fragment = buildBaseFragment(type);
    assert.doesNotMatch(fragment, /else if \(transitionType/u, type);
    if (type === 'blur') assert.match(fragment, /vec3 horizontalBlur/u);
    else assert.doesNotMatch(fragment, /vec3 horizontalBlur/u, type);
  }
  const dissolve = buildBaseFragment('dissolve');
  const fade = buildBaseFragment('fade');
  assert.match(dissolve, /uniform sampler2D dissolveNoise/u);
  assert.match(dissolve, /texelFetch\(dissolveNoise, ivec2\(ip\), 0\)\.r < amount/u);
  assert.doesNotMatch(dissolve, /fract\(/u);
  assert.doesNotMatch(fade, /dissolveNoise/u);
  assert.match(source, /gl\.R32F/u);
  assert.match(source, /gl\.RED/u);
  assert.match(source, /gl\.FLOAT/u);
  assert.match(source, /const DISSOLVE_NOISE_UNIT = 12/u);
  assert.match(source, /dissolveNoiseTextures = new Map<string, WebGLTexture>/u);
  assert.match(source, /\.\.\.this\.dissolveNoiseTextures\.values\(\)/u);
});

test('phase plate fades use unclamped limited-range YUV plates', () => {
  const black = buildBaseFragment('fade-black');
  const white = buildBaseFragment('fade-white');
  assert.match(source, /vec3 yuv709Unclamped/u);
  assert.match(source, /return clamp\(yuv709Unclamped\(y, chroma\), 0\.0, 1\.0\)/u);
  for (const fragment of [black, white]) {
    assert.match(fragment, /const float phase = 0\.2/u);
    assert.match(fragment, /vec2\(128\.0 \/ 255\.0\)/u);
    assert.match(fragment, /smoothstep\(1\.0 - phase, 1\.0, P\)/u);
    assert.match(fragment, /smoothstep\(phase, 1\.0, P\)/u);
  }
  assert.match(black, /yuv709Unclamped\(0\.0,/u);
  assert.match(white, /yuv709Unclamped\(1\.0,/u);
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
  assert.match(comparisonSource, /layerParity\?\.length !== 36/u);
  assert.match(comparisonSource, /CLASS_LIMITS/u);
  assert.match(comparisonSource, /engine-side error \(investigate\)/u);
  assert.match(comparisonSource, /if \(engineErrors\.length > 0 \|\| blendLutErrors\.length > 0\)/u);
  assert.doesNotMatch(comparisonSource, /cls === 'noise-floor' \? 'noise floor' : 'known filtergraph difference'/u);
  assert.match(transitionComparisonSource, /TRANSITION_LIMITS/u);
  assert.match(transitionComparisonSource, /noiseFloorMad/u);
  assert.doesNotMatch(transitionComparisonSource, /absoluteCap: 4/u);
  assert.match(transitionComparisonSource, /sourceFrames/u);
  assert.match(transitionComparisonSource, /engineVsIdeal\.MAD <= 4/u);
  assert.match(transitionComparisonSource, /mp4VsIdeal\.MAD \+ noiseFloorMad/u);
  assert.match(transitionComparisonSource, /idealYuv420RoundTrip/u);
  assert.match(transitionComparisonSource, /known measurement-instrument difference/u);
  assert.match(transitionComparisonSource, /floorMultiplier: 2,\s+allowance: 2/u);
  assert.match(transitionComparisonSource, /matchRate >= 0\.995/u);
  assert.match(transitionComparisonSource, /dissolveNoiseField\(WIDTH, HEIGHT\)/u);
  assert.match(transitionComparisonSource, /engine-side error \(investigate\)/u);
  assert.match(transitionComparisonSource, /if \(engineErrors\.length > 0 \|\| !dissolveNoise\.pass\)/u);
});
