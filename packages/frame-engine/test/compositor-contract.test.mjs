import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { TRANSITION_TYPE_IDS } from '@akari-video/edit-store';
import {
  applyHomography, buildBaseFragment, cutLayerStyleBox, cutLayerStyleSourceUv, forwardInverse,
  invertMat3, isDirectUploadableFormat
} from '../dist/index.js';

const source = await readFile(path.resolve(import.meta.dirname, '../src/compositor/webgl2.ts'), 'utf8');
const comparisonSource = await readFile(path.resolve(import.meta.dirname, 'golden/layers-compare.mjs'), 'utf8');
const goldenRendererSource = await readFile(path.resolve(import.meta.dirname, 'golden/renderer.ts'), 'utf8');
const goldenElectronMainSource = await readFile(path.resolve(import.meta.dirname, 'golden/main.cjs'), 'utf8');
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
  assert.match(source, /texture\(maskY, matteUv\)\.r/u);
  assert.match(source, /vec2 colorUv = unrotate\(sourceUv, layerRotation\)/u);
  assert.match(source, /vec2 matteUv = unrotate\(sourceUv, maskRotation\)/u);
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

test('Electron golden serves and identifies both alpha-intake H.264 fixtures', () => {
  for (const name of ['matte-alpha.color.mp4', 'matte-alpha.mask.mp4']) {
    const escaped = name.replaceAll('.', '\\.');
    assert.match(goldenElectronMainSource, new RegExp(`frame-engine://fixture/${escaped}`));
    assert.match(goldenElectronMainSource, new RegExp(`url\\.pathname === '/${escaped}'`));
  }
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

test('filter compositor uses an analytic quad and the cached sampler3D path', () => {
  assert.match(source, /const FILTER_FRAGMENT/u);
  assert.match(source, /smoothstep\(-edgePx \* 0\.5, edgePx \* 0\.5, distancePx\)/u);
  assert.match(source, /edgeDistance\(corners\[0\], corners\[1\], p\)/u);
  assert.match(source, /vec3 saturation709/u);
  assert.match(source, /this\.lookTexture\(layer\.filter\.lut\)/u);
  assert.match(source, /if \(input\.kind === 'filter'\)/u);
  assert.match(source, /edgePx'\), 2\)/u);
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
  assert.match(source, /yuvFormat == 2[\s\S]+texture\(lrgba, colorUv\)/u);
  assert.match(source, /maskFormat == 2[\s\S]+texture\(maskRgba, matteUv\)\.r/u);
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

test('direct VideoFrame upload accepts native and packed RGB formats only', () => {
  for (const format of [null, 'NV12', 'I420', 'RGBA', 'BGRA', 'RGBX', 'BGRX']) {
    assert.equal(isDirectUploadableFormat(format), true, String(format));
  }
  for (const format of ['I422', 'I444', 'NV12A', 'I420A']) {
    assert.equal(isDirectUploadableFormat(format), false, format);
  }
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

// ---- issue #39: layer-style cuts on the base path use the layer program's box ----------------------

test('base shader samples layer-style cuts through crop / box per input and leaves the fit path intact (issue #39)', () => {
  for (const index of [0, 1]) {
    assert.match(source, new RegExp(`uniform int layerStyle${index};`, 'u'));
    assert.match(source, new RegExp(`uniform vec4 crop${index};`, 'u'));
    assert.match(source, new RegExp(`uniform vec2 box${index};`, 'u'));
    const sampler = source.slice(source.indexOf(`vec4 sample${index}(vec2 p)`), source.indexOf(`vec4 sample${index}(vec2 p)`) + 900);
    assert.match(sampler, new RegExp(`if \\(layerStyle${index} == 1\\) \\{\\s+vec2 local = inverseBox\\(p, transform${index}, box${index}\\);`, 'u'));
    assert.match(sampler, new RegExp(`q = crop${index}\\.xy \\+ local \\* crop${index}\\.zw;`, 'u'));
    assert.match(sampler, new RegExp(`\\} else \\{\\s+vec2 canvasPoint = inverseVisual\\(p, transform${index}, framing${index}\\);`, 'u'));
    assert.match(sampler, new RegExp(`q = canvasToSource\\(canvasPoint, sourceSize${index}\\);`, 'u'));
  }
  assert.match(source, /vec2 inverseBox\(vec2 p, vec4 transform, vec2 box\) \{[\s\S]+?return pixel \/ box \+ 0\.5;\s+\}/u);
  // the fit path's arithmetic is byte-identical to before: same statements, same order
  assert.match(source, /vec2 inverseVisual\(vec2 p, vec4 transform, vec4 framing\) \{\s+vec2 pixel = \(p - 0\.5\) \* outputSize - transform\.xy;\s+float angle = transform\.w;\s+pixel = mat2\(cos\(angle\), -sin\(angle\), sin\(angle\), cos\(angle\)\) \* pixel;\s+pixel \/= transform\.z;\s+vec2 local = pixel \/ outputSize \+ 0\.5;\s+return framing\.xy \+ local \* framing\.zw;\s+\}/u);
  assert.match(source, /private setCut\(\s+u: CutUniforms,\s+v: ResolvedCutVisual,\s+source: \{ width: number; height: number \},\s+\)/u);
  assert.match(source, /if \(v\.layerStyle\) \{\s+const box = cutLayerStyleBox\(v, source\.width, source\.height\);\s+this\.gl\.uniform1i\(u\.layerStyle, 1\);/u);
  assert.match(source, /this\.gl\.uniform1i\(u\.layerStyle, 0\);/u);
  assert.match(source, /sizes\[index\] = this\.uploadStillBaseTexture\(/u);
  assert.match(source, /this\.setCut\(baseProgram\.cutUniforms\[1\]!, plan\.base\[0\]!\.visual, sizes\[0\]!\)/u);
  for (const type of ['hard-cut', 'dissolve', 'reveal-down']) {
    const fragment = buildBaseFragment(type);
    assert.match(fragment, /if \(layerStyle0 == 1\)/u, type);
    assert.match(fragment, /if \(layerStyle1 == 1\)/u, type);
  }
});

test('layer-style cut box matches the layer program forwardInverse on identical inputs (issue #39)', () => {
  const cases = [
    { crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, transform: { x: 0, y: 0, scale: 2, rotateDegrees: 0 }, src: [1920, 1080], out: [1920, 1080] },
    { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, transform: { x: 0, y: 0, scale: 2, rotateDegrees: 0 }, src: [1920, 1080], out: [1920, 1080] },
    { crop: { x: 0, y: 0.122, width: 0.78, height: 0.78 }, transform: { x: 0, y: 0, scale: 1.282051, rotateDegrees: 0 }, src: [3840, 2160], out: [3840, 2160] },
    { crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 }, transform: { x: 37, y: -21, scale: 0.75, rotateDegrees: 23 }, src: [3840, 2160], out: [1280, 720] },
    { crop: { x: 0, y: 0, width: 1, height: 1 }, transform: { x: -100, y: 50, scale: 1.5, rotateDegrees: -90 }, src: [1080, 1920], out: [1920, 1080] },
    { crop: { x: 0.3, y: 0.05, width: 0.2, height: 0.9 }, transform: { x: 4.5, y: 300, scale: 3.3, rotateDegrees: 200 }, src: [640, 360], out: [1920, 1080] },
  ];
  const fullFraming = { x: 0, y: 0, width: 1, height: 1, scale: 1, centerX: 0.5, centerY: 0.5 };
  for (const [caseIndex, entry] of cases.entries()) {
    const [srcW, srcH] = entry.src;
    const [outW, outH] = entry.out;
    const cutVisual = { framing: fullFraming, transform: entry.transform, opacity: 1, layerStyle: { crop: entry.crop } };
    const layerVisual = { crop: entry.crop, perspective: null, transform: entry.transform };
    const columnMajor = forwardInverse(layerVisual, srcW, srcH, outW, outH);
    const inverse = [columnMajor[0], columnMajor[3], columnMajor[6], columnMajor[1], columnMajor[4], columnMajor[7], columnMajor[2], columnMajor[5], columnMajor[8]];
    const forward = invertMat3(inverse);
    // (1) box size, position, and rotation: forward-map the crop-local unit square corners through the
    // layer program and compare with the base path's centre + Rot(±box/2) corners.
    const box = cutLayerStyleBox(cutVisual, srcW, srcH);
    assert.ok(Math.abs(box.width - entry.crop.width * srcW * entry.transform.scale) < 1e-9);
    assert.ok(Math.abs(box.height - entry.crop.height * srcH * entry.transform.scale) < 1e-9);
    const angle = entry.transform.rotateDegrees * Math.PI / 180;
    const c = Math.cos(angle), s = Math.sin(angle);
    const centre = [outW / 2 + entry.transform.x, outH / 2 + entry.transform.y];
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
      const layerCorner = applyHomography(forward, u, v);
      const bx = (u - 0.5) * box.width, by = (v - 0.5) * box.height;
      const baseCorner = [centre[0] + c * bx - s * by, centre[1] + s * bx + c * by];
      assert.ok(Math.abs(layerCorner[0] - baseCorner[0]) < 1e-2 && Math.abs(layerCorner[1] - baseCorner[1]) < 1e-2,
        `case ${caseIndex} corner (${u},${v}): layer ${layerCorner} vs base ${baseCorner}`);
    }
    // (2) per-pixel inverse mapping: every sampled output pixel resolves to the same source UV (or is
    // outside the box on both sides).
    let inside = 0;
    for (let py = 0.5; py < outH; py += outH / 24) {
      for (let px = 0.5; px < outW; px += outW / 32) {
        const local = applyHomography(inverse, px, py);
        const layerInside = local[0] >= 0 && local[0] <= 1 && local[1] >= 0 && local[1] <= 1;
        const layerUv = layerInside ? [entry.crop.x + local[0] * entry.crop.width, entry.crop.y + local[1] * entry.crop.height] : null;
        const baseUv = cutLayerStyleSourceUv(cutVisual, srcW, srcH, outW, outH, px, py);
        if (layerUv === null || baseUv === null) {
          // float32 rounding may disagree only on the exact box edge
          const edge = Math.min(Math.abs(local[0]), Math.abs(local[0] - 1), Math.abs(local[1]), Math.abs(local[1] - 1));
          assert.ok(layerUv === baseUv || edge < 1e-4, `case ${caseIndex} pixel (${px},${py}): layer ${layerUv} vs base ${baseUv}`);
          continue;
        }
        inside += 1;
        assert.ok(Math.abs(layerUv[0] - baseUv[0]) < 1e-5 && Math.abs(layerUv[1] - baseUv[1]) < 1e-5,
          `case ${caseIndex} pixel (${px},${py}): layer ${layerUv} vs base ${baseUv}`);
      }
    }
    assert.ok(inside > 0, `case ${caseIndex} sampled no pixel inside the box`);
  }
});
