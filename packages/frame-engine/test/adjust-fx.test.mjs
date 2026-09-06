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
  assert.deepEqual(normalizeAdjustFx([{ id: 'glow' }, { id: 'blur' }, { id: 'toString' }], undefined, warnings), [{ id: 'blur', px: 8 }]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /unknown effect id "glow"/);
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
  const adjust = { fx: [{ id: 'glow' }, { id: 'blur' }, { id: 'blur' }] };
  const plan = buildResolvedTimelinePlan([{ ...cut, id: 'main', adjust }], { layers: [{ ...layer, adjust }], onWarning: w => warnings.push(w) });
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /cut main:.*glow/);
  assert.match(warnings[2], /layer layer-1:.*glow/);
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

test('legacy timeline-map plans omit frameIndex and upload grain seed zero', async () => {
  const recorder = recordingCompositor();
  try {
    const timeline = buildResolvedTimelinePlan([cut]);
    const plan = evaluationPlanFromTimelineMap(timeline.map, 1000000, sources, output);
    assert.equal(Object.hasOwn(plan, 'frameIndex'), false);
    const [draw] = await recorder.render(plan);
    assert.deepEqual(draw.frameIndex, [0]);
  } finally { recorder.compositor.dispose(); }
});

test('builder frameIndex drives identical grain seeds on retry and different seeds on adjacent frames', async () => {
  const recorder = recordingCompositor();
  try {
    const adjust = { fx: [{ id: 'grain' }] };
    const timeline = buildResolvedTimelinePlan([
      { ...cut, adjust, transitionOut: { type: 'fade', duration: 0.5 } }, { ...cut, adjust },
    ], { fps: 30, layers: [{ ...layer, adjust }] });
    for (const [timeUs, nextTimeUs, expected] of [[1000000, 1033333, 30], [1700000, 1733333, 51]]) {
      const seedsAt = async time => {
        const draws = await recorder.render(evaluate(timeline, time));
        assert.deepEqual(draws[0].fxCount0, [1]);
        if (time > 1500000) assert.deepEqual(draws[0].fxCount1, [1]);
        assert.deepEqual(draws[1].fxCount, [1]);
        return [draws[0].frameIndex[0], draws[1].frameIndex[0]];
      };
      const first = await seedsAt(timeUs);
      const next = await seedsAt(nextTimeUs);
      assert.deepEqual(first, [expected, expected]);
      assert.deepEqual(next, [expected + 1, expected + 1]);
      assert.notDeepEqual(first, next);
      assert.deepEqual(await seedsAt(timeUs), first);
      assert.deepEqual(await seedsAt(timeUs + 1), first);
    }
  } finally { recorder.compositor.dispose(); }
});

// Records the actual compositor's uniform uploads and draw boundaries; it does not rasterize GLSL.
function recordingCompositor() {
  let active;
  let framebuffers = 0;
  const uniforms = new Map();
  const draws = [];
  const gl = new Proxy({}, {
    get(_target, key) {
      if (key === 'createFramebuffer') return () => ({ framebuffer: ++framebuffers });
      if (key.startsWith('create')) return () => ({});
      if (key === 'getParameter') return () => 32;
      if (key === 'getAttribLocation') return () => 0;
      if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
      if (key === 'getExtension') return () => null;
      if (key === 'getUniformLocation') return (program, name) => ({ program, name });
      if (key === 'useProgram') return program => { active = program; };
      if (key.startsWith('uniform')) return (location, ...values) => {
        const state = uniforms.get(location.program) ?? {};
        state[location.name] = values.map(value => ArrayBuffer.isView(value) ? [...value] : value);
        uniforms.set(location.program, state);
      };
      if (key === 'drawArrays') return () => draws.push(structuredClone(uniforms.get(active)));
      return () => {};
    },
  });
  const compositor = new WebGL2Compositor({ getContext: () => gl }, { synchronization: 'flush' });
  const frame = { format: 'NV12', width: 2, height: 2, y: new Uint8Array(4), uv: new Uint8Array(2) };
  return {
    draws,
    compositor,
    framebuffers: () => framebuffers,
    async render(plan) {
      draws.length = 0;
      const surface = await compositor.compose(plan.base.map(() => frame), plan.layers.map(() => ({
        kind: 'video', color: frame,
      })), output, new FrameMetrics(), plan);
      surface.close();
      return draws;
    },
  };
}

test('compositor uploads independent ordered fx on transition A/B and resets stale effects', async () => {
  const recorder = recordingCompositor();
  try {
    const timeline = buildResolvedTimelinePlan([
      { ...cut, transitionOut: { type: 'fade', duration: 0.5 }, adjust: { fx: [{ id: 'grain', amount: 0.75 }, { id: 'blur', px: 12 }] } },
      { ...cut, adjust: { fx: [{ id: 'sharpen' }, { id: 'vignette', amount: -0.5 }] } },
    ]);
    const [draw] = await recorder.render({ ...evaluate(timeline, 1750000), frameIndex: 42 });
    assert.deepEqual(draw.fxCount0, [2]);
    assert.deepEqual(draw.fxCount1, [2]);
    assert.deepEqual(draw['fxKinds0[0]'][0], [3, 2, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(draw['fxKinds1[0]'][0], [4, 1, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(draw['fxParams0[0]'][0].slice(0, 8), [0.75, 1, 0, 0, 12, 0, 0, 0]);
    assert.deepEqual(draw.fxSpatial0, [1, -1]);
    assert.deepEqual(draw.fxSpatial1, [0, -1]);
    assert.deepEqual(draw.frameIndex, [42]);
    const clean = { ...evaluate(timeline, 1750000), frameIndex: 7 };
    clean.base = clean.base.map(base => ({ ...base, visual: { ...base.visual, adjustFx: undefined } }));
    const [reset] = await recorder.render(clean);
    for (const suffix of ['0', '1']) {
      assert.deepEqual(reset[`fxCount${suffix}`], [0]);
      assert.deepEqual(reset[`fxKinds${suffix}[0]`][0], Array(8).fill(0));
      assert.deepEqual(reset[`fxParams${suffix}[0]`][0], Array(32).fill(0));
      assert.deepEqual(reset[`fxSpatial${suffix}`], [-1, -1]);
    }
    assert.deepEqual(reset.frameIndex, [7]);
  } finally { recorder.compositor.dispose(); }
});

test('compositor keeps both spatial stages in declaration order and resets each layer', async () => {
  const recorder = recordingCompositor();
  try {
    for (const ids of [['blur', 'grain', 'sharpen'], ['sharpen', 'vignette', 'blur']]) {
      const timeline = buildResolvedTimelinePlan([], { layers: [
        { ...layer, adjust: { fx: ids.map(id => ({ id })) } },
        { ...layer, id: 'clean' },
      ] });
      const draws = await recorder.render({ ...evaluate(timeline), frameIndex: 19 });
      assert.deepEqual(draws[0].fxCount, [3]);
      assert.deepEqual(draws[0].fxSpatial, [0, 2]);
      assert.deepEqual(draws[0]['fxKinds[0]'][0].slice(0, 3), ids[0] === 'blur' ? [2, 3, 4] : [4, 1, 2]);
      assert.deepEqual(draws[0].frameIndex, [19]);
      assert.deepEqual(draws[0].fxSourceDimensions, [2, 2]);
      assert.deepEqual(draws[1].fxCount, [0]);
      assert.deepEqual(draws[1].fxSpatial, [-1, -1]);
      assert.deepEqual(draws[1]['fxKinds[0]'][0], Array(8).fill(0));
      assert.equal(recorder.framebuffers(), 2);
    }
  } finally { recorder.compositor.dispose(); }
});

test('zero-strength effects bypass spatial taps and no-fx count uses the identity branch', async () => {
  const recorder = recordingCompositor();
  try {
    const fx = [{ id: 'blur', px: 0 }, { id: 'sharpen', amount: 0 }, { id: 'vignette', amount: 0 }, { id: 'grain', amount: 0 }];
    const timeline = buildResolvedTimelinePlan([{ ...cut, adjust: { fx } }], { layers: [{ ...layer, adjust: { fx } }] });
    const draws = await recorder.render(evaluate(timeline));
    for (const [draw, suffixes] of [[draws[0], ['0', '1']], [draws[1], ['']]]) {
      for (const suffix of suffixes) {
        assert.deepEqual(draw[`fxCount${suffix}`], [0]);
        assert.deepEqual(draw[`fxSpatial${suffix}`], [-1, -1]);
      }
    }
  } finally { recorder.compositor.dispose(); }
});

test('grain frame uniform is stable across seek/retry order and wraps as uint32', async () => {
  const recorder = recordingCompositor();
  try {
    const timeline = buildResolvedTimelinePlan([{ ...cut, adjust: { fx: [{ id: 'grain' }] } }], {
      layers: [{ ...layer, adjust: { fx: [{ id: 'grain' }] } }],
    });
    for (const frameIndex of [100, 2, 100, 0x100000001]) {
      const draws = await recorder.render({ ...evaluate(timeline), frameIndex });
      assert.deepEqual(draws[0].frameIndex, [frameIndex >>> 0]);
      assert.deepEqual(draws[1].frameIndex, [frameIndex >>> 0]);
    }
  } finally { recorder.compositor.dispose(); }
});
