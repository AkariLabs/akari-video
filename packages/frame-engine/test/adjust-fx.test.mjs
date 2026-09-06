import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  normalizeAdjustFx, isAdjustFxIdentity, resolveAdjustFx, resolveAdjustLut,
  buildResolvedTimelinePlan, evaluationPlanFromResolvedTimeline, evaluationPlanFromTimelineMap,
  WebGL2Compositor, FrameMetrics,
} from '../dist/index.js';

const vignette = { id: 'vignette', amount: 0.5, midpoint: 0.5, roundness: 0, feather: 0.5 };
const output = { width: 1920, height: 1080, colorSpace: 'bt709-limited' };
const video = { async decode() { throw new Error('plan must not decode'); } };
const image = { async load() { throw new Error('plan must not load'); }, destroy() {} };
const sources = new Map([['main.mp4', video], ['image.png', image], ['mask.mp4', video]]);
const cut = { src: 'main.mp4', in: 0, out: 2 };
const layer = { id: 'layer-1', src: 'main.mp4', t: 0, duration: 2 };
const evaluate = (plan, time = 500000) => evaluationPlanFromResolvedTimeline(plan, time, sources, output);

test('fx normalize fills the exact vignette defaults', () => {
  assert.deepEqual(normalizeAdjustFx([{ id: 'vignette' }]), [vignette]);
});
test('fx normalize fills blur, grain and sharpen defaults in declaration order', () => {
  assert.deepEqual(normalizeAdjustFx([{ id: 'sharpen' }, { id: 'blur' }, { id: 'grain' }]), [
    { id: 'sharpen', amount: 0.5 }, { id: 'blur', px: 8 }, { id: 'grain', amount: 0.3, size: 1 },
  ]);
});
test('fx normalize clamps every parameter at both boundaries', () => {
  for (const [value, expected] of [[-100, [-1, 0, -1, 0, 0, 0, 0.5, 0]], [100, [1, 1, 1, 1, 50, 1, 4, 1]]]) {
    const result = normalizeAdjustFx([
      { id: 'vignette', amount: value, midpoint: value, roundness: value, feather: value },
      { id: 'blur', px: value }, { id: 'grain', amount: value, size: value }, { id: 'sharpen', amount: value },
    ]);
    assert.deepEqual(result.flatMap(({ id, ...params }) => Object.values(params)), expected);
  }
});
test('fx normalize replaces nonfinite and nonnumeric parameters with defaults', () => {
  for (const value of [NaN, Infinity, -Infinity, null, '1']) {
    assert.deepEqual(normalizeAdjustFx([{ id: 'blur', px: value }]), [{ id: 'blur', px: 8 }]);
    assert.deepEqual(normalizeAdjustFx([{ id: 'vignette', amount: value, midpoint: value, roundness: value, feather: value }]), [vignette]);
    assert.deepEqual(normalizeAdjustFx([{ id: 'grain', amount: value, size: value }]), [{ id: 'grain', amount: 0.3, size: 1 }]);
  }
});
test('fx normalize drops unknown ids and returns diagnostic strings through warnings', () => {
  const warnings = [];
  assert.deepEqual(normalizeAdjustFx([{ id: 'unknown_effect' }, { id: 'blur' }, { id: 'toString' }], undefined, warnings), [{ id: 'blur', px: 8 }]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /unknown effect id "unknown_effect"/);
  assert.match(warnings[1], /toString/);
});
test('fx normalize keeps the first duplicate and warns without changing effect order', () => {
  const warnings = [];
  assert.deepEqual(normalizeAdjustFx([{ id: 'blur', px: 3 }, { id: 'grain' }, { id: 'blur', px: 20 }], undefined, warnings), [
    { id: 'blur', px: 3 }, { id: 'grain', amount: 0.3, size: 1 },
  ]);
  assert.match(warnings[0], /adjust\.fx\.duplicate-id/);
});
test('fx normalize bypasses only sections.fx false, without warnings', () => {
  const warnings = [];
  assert.deepEqual(normalizeAdjustFx([{ id: 'unknown' }], { fx: false }, warnings), []);
  assert.deepEqual(warnings, []);
  for (const sections of [undefined, null, {}, { fx: true }, { basic: false }]) {
    assert.deepEqual(normalizeAdjustFx([{ id: 'vignette' }], sections), [vignette]);
  }
});
test('fx normalize tolerates missing and malformed declarations', () => {
  for (const fx of [undefined, null, [], {}, 'blur', [null, [], {}, 1]]) assert.deepEqual(normalizeAdjustFx(fx), []);
});
test('fx normalize limits input to eight entries and reports overflow', () => {
  const warnings = [];
  assert.deepEqual(normalizeAdjustFx([...Array(8).fill({ id: 'blur' }), { id: 'grain' }], undefined, warnings), [{ id: 'blur', px: 8 }]);
  assert.ok(warnings.some(w => w.includes('adjust.fx.max-items')));
});
test('fx normalize is deterministic, nonmutating and returns fresh parameter objects', () => {
  const input = Object.freeze([Object.freeze({ id: 'vignette', amount: -0.75 }), Object.freeze({ id: 'blur', px: 0 })]);
  const first = normalizeAdjustFx(input);
  assert.deepEqual(first, normalizeAdjustFx(input));
  first[0].amount = 1;
  assert.equal(normalizeAdjustFx(input)[0].amount, -0.75);
});
test('fx identity includes absence, empty arrays and zero strength for all effects', () => {
  for (const fx of [undefined, null, [], [{ id: 'blur', px: 0 }], [
    { id: 'vignette', amount: 0, feather: 0 }, { id: 'grain', amount: 0, size: 4 }, { id: 'sharpen', amount: 0 },
  ]]) assert.equal(isAdjustFxIdentity(fx), true);
});
test('fx identity excludes defaults, negative vignette and any nonzero strength', () => {
  for (const id of ['blur', 'grain', 'sharpen', 'vignette']) assert.equal(isAdjustFxIdentity([{ id }]), false);
  assert.equal(isAdjustFxIdentity([{ id: 'vignette', amount: -0.1 }]), false);
  assert.equal(isAdjustFxIdentity([{ id: 'blur', px: 1e-10 }]), false);
});
test('fx resolver omits empty and disabled effects and leaves LUT baking separate', () => {
  for (const adjust of [undefined, null, {}, { fx: [] }, { fx: [{ id: 'blur' }], sections: { fx: false } }]) {
    assert.equal(resolveAdjustFx(adjust), undefined);
  }
  assert.deepEqual(resolveAdjustFx({ fx: [{ id: 'vignette' }] }), [vignette]);
  assert.equal(resolveAdjustLut({ fx: [{ id: 'blur' }] }), undefined);
  const adjust = { basic: { exposure: 0.5 } };
  assert.deepEqual(resolveAdjustLut({ ...adjust, fx: [{ id: 'blur' }] }).data, resolveAdjustLut(adjust).data);
});
test('plan carries fx on fit-basis, layer-style and still image cuts', () => {
  for (const extra of [{}, { crop: { x: 0, y: 0, w: 0.5, h: 1 } }, { src: 'image.png' }]) {
    const plan = buildResolvedTimelinePlan([{ ...cut, ...extra, adjust: { fx: [{ id: 'vignette' }] } }]);
    assert.deepEqual(plan.cuts[0].adjustFx, [vignette]);
    assert.strictEqual(evaluate(plan).base[0].visual.adjustFx, plan.cuts[0].adjustFx);
    assert.ok(!Object.hasOwn(evaluate(plan).base[0].visual, 'adjustLut'));
  }
});
test('plan carries independent fx on both sides of a cut transition', () => {
  const plan = buildResolvedTimelinePlan([
    { ...cut, transitionOut: { type: 'fade', duration: 0.5 }, adjust: { fx: [{ id: 'blur' }] } },
    { ...cut, adjust: { fx: [{ id: 'grain' }] } },
  ]);
  const frame = evaluate(plan, 1750000);
  assert.equal(frame.base.length, 2);
  assert.deepEqual(frame.base.map(b => b.visual.adjustFx[0].id), ['blur', 'grain']);
});
test('plan carries fx on video, baked, image and matte layers', () => {
  for (const extra of [{}, { kind: 'baked' }, { src: 'image.png' }, { kind: 'matte', mask: 'mask.mp4' }]) {
    const plan = buildResolvedTimelinePlan([], { layers: [{ ...layer, ...extra, adjust: { fx: [{ id: 'sharpen' }, { id: 'blur' }] } }] });
    assert.deepEqual(evaluate(plan).layers[0].adjustFx, [{ id: 'sharpen', amount: 0.5 }, { id: 'blur', px: 8 }]);
    assert.strictEqual(evaluate(plan, 1000000).layers[0].adjustFx, plan.layerAdjustFx[0]);
  }
});
test('plan reports unknown and duplicate fx once per owner while building', () => {
  const warnings = [];
  const adjust = { fx: [{ id: 'unknown_effect' }, { id: 'blur' }, { id: 'blur' }] };
  const plan = buildResolvedTimelinePlan([{ ...cut, id: 'main', adjust }], { layers: [{ ...layer, adjust }], onWarning: w => warnings.push(w) });
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /cut main:.*unknown_effect/);
  assert.match(warnings[2], /layer layer-1:.*unknown_effect/);
  evaluate(plan);
  evaluate(plan, 1000000);
  assert.equal(warnings.length, 4);
});
test('fx absence, empty arrays and disabled fx produce byte-identical evaluation plans', () => {
  for (const extra of [{}, { crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 } }]) {
    const make = adjust => buildResolvedTimelinePlan([{ ...cut, ...extra, ...(adjust ? { adjust } : {}) }], {
      layers: [{ ...layer, ...extra, ...(adjust ? { adjust } : {}) }],
    });
    const before = make();
    for (const adjust of [{}, { fx: [] }, { fx: [{ id: 'grain' }], sections: { fx: false } }]) {
      const after = make(adjust);
      assert.ok(!Object.hasOwn(after.cuts[0], 'adjustFx'));
      assert.ok(!Object.hasOwn(after, 'layerAdjustFx'));
      for (const time of [0, 500000, 1500000, 2000000]) {
        assert.deepEqual(evaluate(after, time), evaluate(before, time));
        assert.equal(JSON.stringify(evaluate(after, time)), JSON.stringify(evaluate(before, time)));
      }
    }
  }
});

test('no-fx evaluation bytes match the pre-fx plan apart from frame metadata, including existing color adjustment', () => {
  // Frozen from the pre-fx evaluator at four times, for fit-basis and cropped cut/layer pairs.
  // Comparing two variants of the new evaluator alone would miss a shared regression.
  for (const [adjust, expected] of [
    [undefined, '5c62be3d2e4d3fede8c9dfcaea9318019050028c43b3ad5f5bcfed9a50e0a3da'],
    [{ basic: { exposure: 0.5 } }, '2fae6d584f93d7830adda0503b5a73154768cf971ee0612ba56547f999dea8bf'],
  ]) {
    for (const fx of [undefined, [], [{ id: 'grain' }]]) {
      const frames = [];
      const effective = fx === undefined ? adjust
        : { ...adjust, fx, ...(fx.length ? { sections: { fx: false } } : {}) };
      for (const extra of [{}, { crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 } }]) {
        const withAdjust = { ...extra, ...(effective ? { adjust: effective } : {}) };
        const plan = buildResolvedTimelinePlan([{ ...cut, ...withAdjust }], {
          layers: [{ ...layer, ...withAdjust }],
        });
        for (const time of [0, 500000, 1500000, 2000000]) {
          // Only the newly required metadata is excluded; keep the frozen visual baseline.
          const { frameIndex, ...frame } = evaluate(plan, time);
          assert.equal(frameIndex, Math.round(time / 1e6 * plan.fps));
          frames.push(frame);
        }
      }
      assert.equal(createHash('sha256').update(JSON.stringify(frames)).digest('hex'), expected);
    }
  }
});

test('resolved plan rounds output time to nonnegative frame indices at multiple frame rates', () => {
  for (const [fps, points] of [
    [30, [[-1000000, 0], [0, 0], [16666, 0], [16667, 1], [33333, 1], [500000, 15], [1000000, 30]]],
    [24, [[62500, 2], [500000, 12], [1000000, 24]]],
    [30000 / 1001, [[1001000, 30], [2002000, 60]]],
  ]) {
    const timeline = buildResolvedTimelinePlan([cut], { fps });
    for (const [timeUs, expected] of points) assert.equal(evaluate(timeline, timeUs).frameIndex, expected);
  }
});

test('transition plan uses the same output frame rounding as the normal branch', () => {
  const timeline = buildResolvedTimelinePlan([
    { ...cut, transitionOut: { type: 'fade', duration: 0.5 } }, cut,
  ], { fps: 30 });
  const normal = buildResolvedTimelinePlan([cut], { fps: 30 });
  for (const [timeUs, expected] of [[1600000, 48], [1750000, 53], [1900000, 57]]) {
    const frame = evaluate(timeline, timeUs);
    assert.equal(frame.base.length, 2);
    assert.equal(frame.frameIndex, expected);
    assert.equal(frame.frameIndex, evaluate(normal, timeUs).frameIndex);
  }
});

test('resolved plan falls back to frame zero for invalid fps in both branches', () => {
  const timeline = buildResolvedTimelinePlan([
    { ...cut, transitionOut: { type: 'fade', duration: 0.5 } }, cut,
  ]);
  for (const fps of [0, -30, NaN, Infinity, -Infinity, undefined]) {
    for (const timeUs of [1000000, 1750000]) {
      assert.equal(evaluate({ ...timeline, fps }, timeUs).frameIndex, 0);
    }
  }
});

test('grain follows output frames while source playback is frozen', () => {
  const timeline = buildResolvedTimelinePlan([{ ...cut, freeze: { at_sec: 0.5, duration_sec: 1 } }], { fps: 30 });
  const first = evaluate(timeline, 750000);
  const second = evaluate(timeline, 1000000);
  assert.equal(first.frameIndex, 23);
  assert.equal(second.frameIndex, 30);
  assert.equal(first.base[0].sourceTimeUs, 500000);
  assert.equal(first.base[0].sourceTimeUs, second.base[0].sourceTimeUs);
});

test('legacy timeline-map plans omit frameIndex and bypass fx prep', async () => {
  const recorder = recordingCompositor();
  try {
    const timeline = buildResolvedTimelinePlan([cut]);
    const plan = evaluationPlanFromTimelineMap(timeline.map, 1000000, sources, output);
    assert.equal(Object.hasOwn(plan, 'frameIndex'), false);
    const draws = await recorder.render(plan);
    assert.equal(draws.length, 1);
    assert.deepEqual(draws[0].hasFx0, [0]);
    assert.equal(recorder.framebuffers(), 2);
  } finally { recorder.compositor.dispose(); }
});

// Records real compositor draws and rejects sampler/attachment feedback; no GLSL rasterization.
function recordingCompositor(frameSize = { width: 2, height: 2 }, options = {}, still = false) {
  let active, target = null, textureUnit = 0, viewport;
  let framebuffers = 0, textureId = 0;
  const uniforms = new Map(), bindings = new Map(), attachments = new Map(), shaders = new Map();
  const draws = [], copies = [], allocations = [], calls = [], deletedPrograms = [];
  const gl = new Proxy({}, {
    get(_target, key) {
      calls.push(key);
      if (key === 'NO_ERROR') return 0;
      if (/^[A-Z][A-Z0-9_]+$/u.test(key)) return key;
      if (key === 'createFramebuffer') return () => ({ framebuffer: ++framebuffers });
      if (key === 'createTexture') return () => ({ texture: ++textureId });
      if (key.startsWith('create')) return () => ({});
      if (key === 'getParameter') return () => 32;
      if (key === 'getAttribLocation') return () => 0;
      if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
      if (key === 'getExtension') return () => null;
      if (key === 'getError') return () => 0;
      if (key === 'getUniformLocation') return (program, name) => ({ program, name });
      if (key === 'deleteProgram') return program => deletedPrograms.push(program);
      if (key === 'useProgram') return program => { active = program; };
      if (key === 'shaderSource') return (shader, source) => { shader.source = source; };
      if (key === 'attachShader') return (program, shader) => { shaders.set(program, (shaders.get(program) ?? '') + shader.source); };
      if (key === 'activeTexture') return unit => { textureUnit = Number(String(unit).replace('TEXTURE0', '')); };
      if (key === 'bindTexture') return (kind, texture) => { if (kind === 'TEXTURE_2D') bindings.set(textureUnit, texture); };
      if (key === 'bindFramebuffer') return (_kind, value) => { target = value; };
      if (key === 'framebufferTexture2D') return (_a, _b, _c, texture) => { attachments.set(target, texture); };
      if (key === 'viewport') return (...values) => { viewport = values; };
      if (key === 'texImage2D') return (...values) => allocations.push({ texture: bindings.get(textureUnit), values });
      if (key === 'copyTexSubImage2D') return () => copies.push({ from: attachments.get(target), to: bindings.get(textureUnit), drawIndex: draws.length });
      if (key.startsWith('uniform')) return (location, ...values) => {
        if (!location) return;
        assert.strictEqual(location.program, active, 'uniform belongs to active program');
        const state = uniforms.get(location.program) ?? {};
        state[location.name] = values.map(value => ArrayBuffer.isView(value) ? [...value] : value);
        uniforms.set(location.program, state);
      };
      if (key === 'drawArrays') return () => {
        const state = uniforms.get(active);
        const specialization = shaders.get(active).match(/#define FX_KIND (\d+)/u);
        if (specialization) assert.deepEqual(state.fxKind, [Number(specialization[1])], 'pass uses its specialized program');
        const attachment = attachments.get(target);
        if (attachment) for (const [, sampler] of shaders.get(active).matchAll(/uniform sampler2D (\w+);/gu)) {
          assert.notStrictEqual(bindings.get(state[sampler]?.[0] ?? 0), attachment, 'feedback: ' + sampler);
        }
        draws.push({ ...structuredClone(state), program: active, target, attachment, viewport, bindings: new Map(bindings) });
      };
      return () => {};
    },
  });
  const compositor = new WebGL2Compositor({ getContext: () => gl }, { synchronization: 'flush', ...options });
  const frame = still ? { bitmap: {}, ...frameSize }
    : { format: 'NV12', ...frameSize, y: new Uint8Array(4), uv: new Uint8Array(2) };
  return {
    draws, copies, allocations, calls, compositor, shaders, deletedPrograms,
    framebuffers: () => framebuffers,
    async render(plan) {
      draws.length = 0; copies.length = 0;
      const surface = await compositor.compose(plan.base.map(() => frame), plan.layers.map(() => ({
        kind: 'video', color: frame,
      })), plan.output, new FrameMetrics(), plan);
      surface.close();
      return draws;
    },
  };
}

const effectDraws = draws => draws.filter(draw => draw.fxKind);

test('specialized FX programs compile lazily, refresh uniforms across frames and crops, and dispose once', async () => {
  const recorder = recordingCompositor({ width: 1920, height: 1080 });
  const programs = () => [...recorder.shaders].filter(([, shader]) => shader.includes('#define FX_KIND '));
  try {
    await recorder.render(evaluate(buildResolvedTimelinePlan([cut])));
    assert.equal(programs().length, 0, 'no effects means no effect programs');
    const cached = new Map();
    for (const [index, crop] of [undefined, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, undefined].entries()) {
      const timeline = buildResolvedTimelinePlan([], { layers: [{ ...layer, crop, adjust: { fx: [
        { id: 'blur', px: 20 }, { id: 'vignette' }, { id: 'grain' },
      ] } }] });
      recorder.calls.length = 0;
      const effects = effectDraws(await recorder.render({ ...evaluate(timeline), frameIndex: 42 + index }));
      assert.deepEqual(effects.map(draw => draw.fxKind[0]), [2, 2, 1, 3]);
      assert.equal(programs().length, 3, 'H/V share one Gaussian; unused effects stay uncompiled');
      const size = crop ? [960, 540] : [1920, 1080];
      for (const draw of effects) {
        const kind = draw.fxKind[0];
        if (cached.has(kind)) assert.strictEqual(draw.program, cached.get(kind));
        else cached.set(kind, draw.program);
        assert.deepEqual(draw.allocationSize, [1920, 1080]);
        assert.deepEqual(draw.workSize, size);
        assert.deepEqual(draw.cropSize, size);
        assert.deepEqual(draw.frameIndex, [42 + index]);
        assert.equal(draw.source.length, 1);
        assert.equal(draw.original.length, 1);
        assert.notEqual(draw.source[0], draw.original[0]);
        assert.ok(draw.bindings.get(draw.source[0]));
        assert.ok(draw.bindings.get(draw.original[0]));
      }
      if (index) assert.equal(recorder.calls.includes('compileShader'), false);
    }
  } finally { recorder.compositor.dispose(); }
  recorder.compositor.dispose();
  for (const [program] of programs()) {
    assert.equal(recorder.deletedPrograms.filter(deleted => deleted === program).length, 1);
  }
});

const group2Defaults = [
  { id: 'glow', intensity: 0.5, radius: 20, threshold: 0.7, warmth: 0 },
  { id: 'clarity', amount: 0.3, radius: 10 }, { id: 'dehaze', amount: 0.3 },
  { id: 'denoise', amount: 0.3 }, { id: 'motion_blur', px: 10, angle: 0 },
];
test('group two normalizes exact defaults, clamps each parameter and replaces invalid numbers', () => {
  const bounds = { glow: [[0, 1], [0, 100], [0, 1], [-1, 1]], clarity: [[-1, 1], [1, 50]],
    dehaze: [[-1, 1]], denoise: [[0, 1]], motion_blur: [[0, 100], [-180, 180]] };
  for (const effect of group2Defaults) {
    const { id, ...params } = effect;
    assert.deepEqual(normalizeAdjustFx([{ id }]), [effect]);
    for (const [index, key] of Object.keys(params).entries()) {
      for (const [value, expected] of [[-1000, bounds[id][index][0]], [1000, bounds[id][index][1]]]) {
        assert.deepEqual(normalizeAdjustFx([{ id, [key]: value }]), [{ ...effect, [key]: expected }]);
      }
      for (const value of [NaN, Infinity, -Infinity, null, '1']) {
        assert.deepEqual(normalizeAdjustFx([{ id, [key]: value }]), [effect]);
      }
    }
    const strength = id === 'glow' ? 'intensity' : id === 'motion_blur' ? 'px' : 'amount';
    assert.equal(isAdjustFxIdentity([{ ...effect, [strength]: 0 }]), true);
    assert.equal(isAdjustFxIdentity([{ id }]), false);
    assert.equal(isAdjustFxIdentity([{ ...effect, [strength]: 1e-10 }]), false);
  }
  for (const id of ['clarity', 'dehaze']) assert.equal(isAdjustFxIdentity([{ id, amount: -0.3 }]), false);
});

test('group two runs exact ordered passes with snapshots of each composite input on cuts and layers', async () => {
  const recorder = recordingCompositor({ width: 1920, height: 1080 });
  const fx = [{ id: 'grain' }, ...group2Defaults];
  try {
    for (const timeline of [buildResolvedTimelinePlan([{ ...cut, adjust: { fx } }]),
      buildResolvedTimelinePlan([], { layers: [{ ...layer, adjust: { fx } }] })]) {
      const draws = await recorder.render(evaluate(timeline));
      const effects = effectDraws(draws);
      assert.deepEqual(effects.map(draw => draw.fxKind[0]), [3, 5, 2, 2, 6, 2, 2, 7, 8, 9, 10]);
      const [glowInput, clarityInput] = recorder.copies;
      assert.strictEqual(glowInput.from, effects[0].attachment, 'glow snapshots the preceding grain output');
      assert.strictEqual(clarityInput.from, effects[4].attachment, 'clarity snapshots the preceding glow output');
      assert.strictEqual(draws[glowInput.drawIndex - 1], effects[0]);
      assert.strictEqual(draws[clarityInput.drawIndex - 1], effects[4]);
      assert.strictEqual(glowInput.to, clarityInput.to, 'composite input storage is reused');
      assert.strictEqual(effects[4].bindings.get(14), glowInput.to);
      assert.strictEqual(effects[7].bindings.get(14), clarityInput.to);
      assert.deepEqual(effects[4].params, [0.5, 20, 0.7, 0]);
      assert.deepEqual(effects[7].params, [0.3, 0, 0, 0]);
      assert.ok(Math.abs(effects.at(-1).direction[0] - 10 / 1920) < 1e-9);
      assert.equal(effects.at(-1).direction[1], 0);
      assert.equal(recorder.framebuffers(), 4);
    }
  } finally { recorder.compositor.dispose(); }
});

test('group two zero strengths and disabled sections use the direct path without allocating fx', async () => {
  const recorder = recordingCompositor();
  try {
    const zero = group2Defaults.map(effect => ({ ...effect,
      [effect.id === 'glow' ? 'intensity' : effect.id === 'motion_blur' ? 'px' : 'amount']: 0 }));
    for (const adjust of [{ fx: zero }, { fx: group2Defaults, sections: { fx: false } }]) {
      const timeline = buildResolvedTimelinePlan([{ ...cut, adjust }], { layers: [{ ...layer, adjust }] });
      assert.equal((await recorder.render(evaluate(timeline))).length, 3);
      assert.equal(recorder.framebuffers(), 2);
    }
  } finally { recorder.compositor.dispose(); }
});

test('group two preserves transition sources and converts output-pixel radii and directional length', async () => {
  const recorder = recordingCompositor({ width: 1920, height: 1080 });
  try {
    const timeline = buildResolvedTimelinePlan([
      { ...cut, transitionOut: { type: 'fade', duration: 0.5 }, adjust: { fx: [
        { id: 'glow', radius: 100, warmth: -1 }, { id: 'motion_blur', px: 100, angle: 90 },
      ] } },
      { ...cut, adjust: { fx: [{ id: 'clarity', amount: -0.5, radius: 50 }, { id: 'glow', radius: 0 }] } },
    ]);
    const halfOutput = { ...output, width: 960, height: 540 };
    const plan = evaluationPlanFromResolvedTimeline(timeline, 1750000, sources, halfOutput);
    const draws = await recorder.render(plan);
    const effects = effectDraws(draws);
    assert.deepEqual(effects.map(draw => draw.fxKind[0]), [5, 2, 2, 6, 10, 2, 2, 7, 5, 2, 2, 6]);
    assert.deepEqual(effects[1].viewport, [0, 0, 240, 135]);
    assert.deepEqual(effects[1].tapCount, [13]);
    const weights = effects[1]['gaussianWeights[0]'][0];
    assert.ok(Math.abs(weights[1] / weights[0] - Math.exp(-0.5 / (12.5 / 2) ** 2)) < 1e-7);
    assert.ok(Math.abs(effects[4].direction[0]) < 1e-9);
    assert.ok(Math.abs(effects[4].direction[1] - 50 / 540) < 1e-8);
    assert.deepEqual(effects[7].params, [-0.5, 0, 0, 0]);
    assert.deepEqual(effects[9].tapCount, [0]);
    assert.deepEqual(effects[10].tapCount, [0]);
    assert.equal(effects[9]['gaussianWeights[0]'][0][0], 1);
    const final = draws.at(-1);
    assert.deepEqual(final.hasFx0, [1]);
    assert.deepEqual(final.hasFx1, [1]);
    assert.notStrictEqual(final.bindings.get(6), final.bindings.get(7));
    assert.equal(recorder.framebuffers(), 4);
  } finally { recorder.compositor.dispose(); }
});

test('grain seeds follow output frame indices across transitions, retries and uint32 wrap', async () => {
  const recorder = recordingCompositor();
  try {
    const adjust = { fx: [{ id: 'grain' }] };
    const timeline = buildResolvedTimelinePlan([
      { ...cut, adjust, transitionOut: { type: 'fade', duration: 0.5 } }, { ...cut, adjust },
    ], { fps: 30, layers: [{ ...layer, adjust }] });
    for (const [timeUs, expected, count] of [[1000000, 30, 2], [1033333, 31, 2], [1700000, 51, 3], [1733333, 52, 3], [1700000, 51, 3]]) {
      const draws = effectDraws(await recorder.render(evaluate(timeline, timeUs)));
      assert.equal(draws.length, count);
      for (const draw of draws) assert.deepEqual(draw.frameIndex, [expected]);
    }
    for (const frameIndex of [100, 2, 100, 0x100000001, undefined]) {
      const draws = effectDraws(await recorder.render({ ...evaluate(timeline), frameIndex }));
      assert.equal(draws.length, 2);
      for (const draw of draws) assert.deepEqual(draw.frameIndex, [frameIndex >>> 0]);
    }
  } finally { recorder.compositor.dispose(); }
});

test('transition A/B run independent ordered passes, retain distinct snapshots and reset stale results', async () => {
  const recorder = recordingCompositor();
  try {
    const timeline = buildResolvedTimelinePlan([
      { ...cut, transitionOut: { type: 'fade', duration: 0.5 }, adjust: { fx: [{ id: 'grain', amount: 0.75 }, { id: 'blur', px: 12 }] } },
      { ...cut, adjust: { fx: [{ id: 'sharpen' }, { id: 'vignette', amount: -0.5 }] } },
    ]);
    const draws = await recorder.render({ ...evaluate(timeline, 1750000), frameIndex: 42 });
    assert.deepEqual(effectDraws(draws).map(draw => draw.fxKind[0]), [3, 2, 2, 4, 1]);
    assert.equal(draws.filter(draw => draw.sourceFormat).length, 2);
    assert.equal(recorder.copies.length, 2);
    assert.notStrictEqual(recorder.copies[0].to, recorder.copies[1].to);
    const final = draws.at(-1);
    assert.deepEqual(final.hasFx0, [1]);
    assert.deepEqual(final.hasFx1, [1]);
    assert.strictEqual(final.bindings.get(6), recorder.copies[0].to);
    assert.strictEqual(final.bindings.get(7), recorder.copies[1].to);
    assert.deepEqual(final.viewport, [0, 0, output.width, output.height]);
    const clean = evaluate(timeline, 1750000);
    clean.base = clean.base.map(base => ({ ...base, visual: { ...base.visual, adjustFx: undefined } }));
    const reset = await recorder.render(clean);
    assert.equal(reset.length, 1);
    assert.deepEqual(reset[0].hasFx0, [0]);
    assert.deepEqual(reset[0].hasFx1, [0]);
  } finally { recorder.compositor.dispose(); }
});

test('layers run spatial passes in declaration order and reuse exactly two fx FBOs', async () => {
  const recorder = recordingCompositor();
  try {
    for (const ids of [['blur', 'grain', 'sharpen'], ['sharpen', 'vignette', 'blur']]) {
      const timeline = buildResolvedTimelinePlan([], { layers: [
        { ...layer, adjust: { fx: ids.map(id => ({ id })) } }, { ...layer, id: 'clean' },
      ] });
      const draws = await recorder.render({ ...evaluate(timeline), frameIndex: 19 });
      assert.deepEqual(effectDraws(draws).map(draw => draw.fxKind[0]), ids[0] === 'blur' ? [2, 2, 3, 4] : [4, 1, 2, 2]);
      const composites = draws.filter(draw => draw.hasFx);
      assert.deepEqual(composites.map(draw => draw.hasFx[0]), [1, 0]);
      assert.deepEqual(effectDraws(draws)[0].workSize, [2, 2]);
      assert.equal(recorder.framebuffers(), 4); // two composite + two shared fx FBOs
    }
    const fxAllocations = recorder.allocations.filter(entry => entry.values[3] === output.width && entry.values[4] === output.height);
    assert.equal(fxAllocations.length, 4, 'fixed-output render does not reallocate composite or fx targets');
  } finally { recorder.compositor.dispose(); }
});

test('zero strength, absent, empty and disabled effects never allocate or draw fx prep', async () => {
  const recorder = recordingCompositor();
  try {
    const zero = [{ id: 'blur', px: 0 }, { id: 'sharpen', amount: 0 }, { id: 'vignette', amount: 0 }, { id: 'grain', amount: 0 }];
    for (const adjust of [undefined, { fx: [] }, { fx: zero }, { fx: [{ id: 'blur' }], sections: { fx: false } }]) {
      const timeline = buildResolvedTimelinePlan([{ ...cut, adjust }], { layers: [{ ...layer, adjust }] });
      const draws = await recorder.render(evaluate(timeline));
      assert.equal(draws.length, 3); // base, layer, output copy only
      assert.deepEqual(draws[0].hasFx0, [0]);
      assert.deepEqual(draws[1].hasFx, [0]);
      assert.equal(recorder.framebuffers(), 2);
    }
  } finally { recorder.compositor.dispose(); }
});

test('large blur reduces H viewport, expands V and leaves mask/blending on the final layer', async () => {
  const recorder = recordingCompositor({ width: 3840, height: 2160 });
  try {
    const timeline = buildResolvedTimelinePlan([], { layers: [{ ...layer, crop: { x: 0.25, y: 0, w: 0.5, h: 1 },
      adjust: { basic: { exposure: 0.5 }, fx: [{ id: 'blur', px: 50 }, { id: 'grain' }] } }] });
    const draws = await recorder.render(evaluate(timeline));
    const prep = draws.find(draw => draw.sourceFormat);
    assert.deepEqual(prep.cropRect, [0.25, 0, 0.5, 1]);
    assert.deepEqual(prep.hasAdjustLut, [1]);
    assert.deepEqual(prep.viewport, [0, 0, 1920, 1080]);
    const [h, v, grain] = effectDraws(draws);
    assert.deepEqual(h.viewport, [0, 0, 480, 270]);
    assert.deepEqual(v.viewport, [0, 0, 1920, 1080]);
    assert.ok(h.tapCount[0] <= 16 && v.tapCount[0] <= 16);
    assert.deepEqual(h.direction, [1 / 480, 0]);
    assert.deepEqual(v.direction, [0, 1 / 270]);
    assert.deepEqual(grain.inputSize, [1920, 1080]);
    assert.deepEqual(draws.find(draw => draw.hasFx).hasFx, [1]);
  } finally { recorder.compositor.dispose(); }
});

test('1080p still base runs each timed stage once and reuses all warm FX resources', async () => {
  const stages = [];
  const recorder = recordingCompositor({ width: 1920, height: 1080 }, { passTimer: stage => stages.push(stage) }, true);
  try {
    const timeline = buildResolvedTimelinePlan([{ ...cut, adjust: { fx: [
      { id: 'blur', px: 20 }, { id: 'vignette' }, { id: 'grain' },
    ] } }]);
    const plan = evaluate(timeline);
    await recorder.render(plan);
    stages.length = 0;
    recorder.calls.length = 0;
    const allocations = recorder.allocations.length;
    const draws = await recorder.render(plan);
    assert.deepEqual(stages, ['base-prepare', null, 'prep', 'blur-h', 'blur-v', 'vignette', 'grain', null,
      'snapshot-copy', null, 'base-draw', null]);
    assert.equal(draws.length, 6);
    assert.equal(recorder.copies.length, 1);
    assert.equal(recorder.allocations.length, allocations);
    for (const call of ['bufferData', 'vertexAttribPointer', 'compileShader', 'getUniformLocation',
      'texImage2D', 'copyTexImage2D', 'generateMipmap', 'finish', 'readPixels', 'createQuery', 'beginQuery']) {
      assert.equal(recorder.calls.includes(call), false, `warm path must not call ${call}`);
    }
    const [h, v] = effectDraws(draws);
    assert.deepEqual(h.viewport, [0, 0, 960, 540]);
    assert.deepEqual(h.inputSize, [1920, 1080]);
    assert.deepEqual(v.viewport, [0, 0, 1920, 1080]);
    assert.deepEqual(v.inputSize, [960, 540]);
    assert.deepEqual(h.tapCount, [10]);
    assert.deepEqual(v.tapCount, [10]);
    assert.deepEqual(h['gaussianWeights[0]'], v['gaussianWeights[0]']);
    assert.strictEqual(draws.at(-1).bindings.get(6), recorder.copies[0].to);
  } finally { recorder.compositor.dispose(); }
});

test('a YUV cut after an even-pass layer never samples a stale fx attachment during prep', async () => {
  const recorder = recordingCompositor();
  try {
    const layers = buildResolvedTimelinePlan([], { layers: [{ ...layer, adjust: { fx: [{ id: 'blur' }] } }] });
    await recorder.render(evaluate(layers));
    const cuts = buildResolvedTimelinePlan([{ ...cut, adjust: { fx: [{ id: 'grain' }] } }]);
    const draws = await recorder.render(evaluate(cuts));
    assert.equal(effectDraws(draws).length, 1);
    assert.deepEqual(draws.at(-1).hasFx0, [1]);
    assert.equal(recorder.framebuffers(), 4);
  } finally { recorder.compositor.dispose(); }
});
