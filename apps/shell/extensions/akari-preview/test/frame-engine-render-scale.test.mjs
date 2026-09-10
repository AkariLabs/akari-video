import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { parseRenderScaleMode, resolveRenderScale, scaledOutputSize, scaleEvaluationPlan } from '../lib/common/frame-engine-render-scale.js';

test('parseRenderScaleMode accepts the four modes and falls back to auto', () => {
  for (const [input, expected] of [
    ['1', 1], ['0.5', 0.5], ['0.25', 0.25], ['auto', 'auto'],
    [1, 1], [0.5, 0.5], [0.25, 0.25],
    ['2', 'auto'], ['', 'auto'], [undefined, 'auto'], [null, 'auto'], [NaN, 'auto'],
  ]) assert.equal(parseRenderScaleMode(input), expected, String(input));
});

const square = (output, css, dpr = 1, mode = 'auto') => resolveRenderScale({
  mode, outputWidth: output, outputHeight: output, cssWidth: css, cssHeight: css, dpr,
});

test('auto chooses the smallest scale covering physical display dimensions, capped at one', () => {
  assert.equal(square(900, 900), 1);
  assert.equal(square(900, 1800), 1);
  assert.equal(square(2160, 900), 0.5);
  assert.equal(square(3840, 900), 0.25);
  assert.equal(square(3840, 900, 2), 0.5);
  assert.equal(square(3840, 0), 1);
  assert.equal(square(3840, 960), 0.25);
  assert.equal(square(3840, 961), 0.5);
  assert.equal(square(3840, 1921), 1);
});

test('auto covers both axes and handles a hidden canvas', () => {
  const dimensions = { mode: 'auto', outputWidth: 3840, outputHeight: 2160, cssWidth: 900, cssHeight: 600, dpr: 1 };
  assert.equal(resolveRenderScale(dimensions), 0.5);
  assert.equal(resolveRenderScale({ ...dimensions, cssHeight: 1200 }), 1);
  assert.equal(resolveRenderScale({ ...dimensions, cssWidth: 0 }), 1);
  assert.equal(resolveRenderScale({ ...dimensions, cssHeight: 0 }), 1);
});

test('manual scales remain fixed for every display size and DPR, including hidden canvases', () => {
  for (const mode of [1, 0.5, 0.25]) {
    assert.equal(square(3840, 0, 2, mode), mode);
    assert.equal(square(3840, 900, 1, mode), mode);
    assert.equal(square(900, 3840, 2, mode), mode);
  }
});

test('scaledOutputSize rounds each dimension to even pixels with a minimum of two', () => {
  assert.deepEqual(scaledOutputSize({ width: 1081, height: 1081 }, 0.5), { width: 540, height: 540 });
  assert.deepEqual(scaledOutputSize({ width: 1082, height: 1086 }, 0.5), { width: 542, height: 544 });
  assert.deepEqual(scaledOutputSize({ width: 1, height: 3 }, 0.25), { width: 2, height: 2 });
  assert.deepEqual(scaledOutputSize({ width: 2160, height: 2160 }, 0.5), { width: 1080, height: 1080 });
  const output = { width: 1920, height: 1080, colorSpace: 'bt709-limited', look: {} };
  assert.deepEqual(scaledOutputSize(output, 0.25), { width: 480, height: 270 });
  assert.deepEqual(output, { width: 1920, height: 1080, colorSpace: 'bt709-limited', look: {} });
});

function evaluationPlanFixture() {
  const source = { id: 'video-source' };
  const image = { id: 'image-source' };
  const mask = { kind: 'greyscale', source: { id: 'mask-source' }, sourceTimeUs: 123456 };
  const adjustLut = { size: 2, data: [0, 1] };
  const adjustFx = [{ type: 'blur', px: 12 }];
  const crop = { x: 0.1, y: 0.2, width: 0.8, height: 0.6 };
  const transform = { x: 160, y: -80, scale: 0.45, rotateDegrees: 30 };
  const cutVisual = {
    framing: { x: 0.1, y: 0.2, width: 0.8, height: 0.6, scale: 1.25, centerX: 0.5, centerY: 0.5 },
    transform, opacity: 0.9, adjustLut, adjustFx,
  };
  const layerStyleVisual = { ...cutVisual, layerStyle: { crop } };
  const visual = { crop, perspective: { corners: [[0, 0.1], [0.9, 0], [1, 1], [0, 1]] }, transform };
  const composite = { visual, mask, blend: 'screen', opacity: 0.9, adjustLut, adjustFx };
  return {
    timeUs: 5_000_000, frameIndex: 150, transition: { type: 'hard-cut', progress: 0 },
    output: { width: 1080, height: 1080, colorSpace: 'bt709-limited', look: { lut: adjustLut, intensity: 0.8 } },
    base: [
      { kind: 'video', id: 'cut-0', source, sourceTimeUs: 123456, visual: cutVisual },
      { kind: 'image', id: 'cut-1', image, sourceTimeUs: 0, visual: layerStyleVisual },
    ],
    layers: [
      { ...composite, kind: 'video', id: 'video', source, sourceTimeUs: 123456 },
      { ...composite, kind: 'image', id: 'image', image },
      { ...composite, kind: 'matte', id: 'matte', source, sourceTimeUs: 123456 },
      { ...composite, kind: 'video', id: 'fit-cut', source, sourceTimeUs: 123456, cutVisual },
      { ...composite, kind: 'image', id: 'layer-style-cut', image, cutVisual: layerStyleVisual },
      { kind: 'filter', id: 'filter', filter: { type: 'invert' }, corners: [[0, 0], [1, 0], [1, 1], [0, 1]], opacity: 0.7 },
    ],
  };
}

function assertUnchangedReferences(actual, original, changedKeys) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(original).sort());
  for (const key of Object.keys(original)) {
    if (!changedKeys.includes(key)) assert.equal(actual[key], original[key], `preserve ${key}`);
  }
}

test('scaleEvaluationPlan projects fit cuts and layer-style cuts without changing normalized framing or effects', () => {
  const plan = evaluationPlanFixture();
  for (const scale of [0.5, 0.25]) {
    const result = scaleEvaluationPlan(plan, scale);
    for (const [index, pixelScale] of [[0, false], [1, true]]) {
      const original = plan.base[index];
      const actual = result.base[index];
      assert.notEqual(actual, original);
      assert.notEqual(actual.visual, original.visual);
      assert.deepEqual(actual.visual.transform, {
        x: 160 * scale, y: -80 * scale, scale: pixelScale ? 0.45 * scale : 0.45, rotateDegrees: 30,
      });
      assertUnchangedReferences(actual, original, ['visual']);
      assertUnchangedReferences(actual.visual, original.visual, ['transform']);
    }
  }
});

test('scaleEvaluationPlan projects video/image/matte geometry and distinguishes both stacked cutVisual bases', () => {
  const plan = evaluationPlanFixture();
  for (const scale of [0.5, 0.25]) {
    const result = scaleEvaluationPlan(plan, scale);
    for (let index = 0; index < 5; index++) {
      const original = plan.layers[index];
      const actual = result.layers[index];
      assert.notEqual(actual, original);
      assert.notEqual(actual.visual, original.visual);
      assert.deepEqual(actual.visual.transform, { x: 160 * scale, y: -80 * scale, scale: 0.45 * scale, rotateDegrees: 30 });
      assertUnchangedReferences(actual, original, ['visual', 'cutVisual']);
      assertUnchangedReferences(actual.visual, original.visual, ['transform']);
      if (original.cutVisual) {
        assert.notEqual(actual.cutVisual, original.cutVisual);
        assert.deepEqual(actual.cutVisual.transform, {
          x: 160 * scale, y: -80 * scale, scale: index === 4 ? 0.45 * scale : 0.45, rotateDegrees: 30,
        });
        assertUnchangedReferences(actual.cutVisual, original.cutVisual, ['transform']);
      }
    }
    assert.equal(result.layers[5], plan.layers[5], 'normalized filter geometry keeps its reference');
  }
});

test('scaleEvaluationPlan preserves the input, output identity, timing and resources; full scale returns the input', () => {
  const plan = evaluationPlanFixture();
  const snapshot = structuredClone(plan);
  const freeze = value => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(freeze);
    }
  };
  freeze(plan);
  const result = scaleEvaluationPlan(plan, 0.5);
  assert.notEqual(result, plan);
  assert.notEqual(result.base, plan.base);
  assert.notEqual(result.layers, plan.layers);
  assertUnchangedReferences(result, plan, ['base', 'layers']);
  assert.deepEqual(plan, snapshot);
  assert.equal(scaleEvaluationPlan(plan, 1), plan);
});

test('scaleEvaluationPlan remains standalone when serialized for webview injection', () => {
  const project = vm.runInNewContext(`(${scaleEvaluationPlan.toString()})`);
  const plan = evaluationPlanFixture();
  const result = project(plan, 0.5);
  assert.equal(result.layers[0].visual.transform.scale, 0.225);
  assert.equal(result.base[0].visual.transform.scale, 0.45);
  assert.equal(result.base[1].visual.transform.scale, 0.225);
  assert.equal(result.output, plan.output);
  assert.equal(result.layers[0].source, plan.layers[0].source);
  assert.equal(project(plan, 1), plan);
});
