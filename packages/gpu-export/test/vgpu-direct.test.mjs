import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { buildGpuPage } from '../src/page-builder.mjs';
import { evaluateGpuEligibility } from '../src/eligibility.mjs';
import { buildGpuReceipt } from '../src/receipt.mjs';

const runtimeSource = readFileSync(new URL('../../overlay-runtime/src/vgpu-runtime.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../src/page-runtime.js', import.meta.url), 'utf8');
const fixture = name => readFileSync(new URL(`./fixtures/vgpu-${name}.html`, import.meta.url), 'utf8');
const descriptor = () => JSON.parse(fixture('gradient').match(/data-akari-vgpu-scene>([\s\S]*?)<\/script>/)[1]);
const plain = value => JSON.parse(JSON.stringify(value));

function harness({ unavailable = false, failDraw = false } = {}) {
  let lose, onError;
  const calls = { init: 0, draws: [], effects: [], outputs: [], warnings: [] };
  const gpu = { gpu: { adapterInfo: { vendor: 'apple', architecture: 'metal-3' },
    lost: new Promise(resolve => { lose = resolve; }), queue: { onSubmittedWorkDone: async () => {} } },
    onError(cb) { onError = cb; }, settled: async () => {},
  };
  const target = options => {
    const value = { size: options.size, color: {}, resizes: 0, disposed: false,
      resize(size) { this.size = size; this.color = {}; this.resizes++; },
      dispose() { this.disposed = true; }, destroy() { this.disposed = true; },
    };
    calls.outputs.push(value); return value;
  };
  const canvas = () => ({ style: {}, width: 0, height: 0, remove() { this.removed = true; } });
  const window = { AkariVgpu: {
    init: async () => { calls.init++; return gpu; }, surface: (_, canvas, opts) => target(opts), target: (_, opts) => target(opts),
    sampler: () => ({}), effect: (_, source) => {
      const value = { source, set(bag) { this.bag = bag; } }; calls.effects.push(value); return value;
    },
    frame: (_, cb) => cb({ pass(output, effect) {
      if (failDraw) throw new Error('draw failed');
      calls.draws.push({ output, effect, bag: effect.bag ? plain(effect.bag) : null });
    } }),
  } };
  runInNewContext(runtimeSource, { window, navigator: { gpu: unavailable ? undefined : {} },
    document: { createElement: canvas }, performance, console: { warn: message => calls.warnings.push(message) },
    getComputedStyle: container => ({ getPropertyValue: key => container.vars[key] ?? '' }),
  });
  function container(value = descriptor(), { hasCanvas = true } = {}) {
    const c = hasCanvas ? canvas() : null;
    const node = { style: { display: 'none' } };
    const script = { textContent: JSON.stringify(value) };
    return { clientWidth: 1920, clientHeight: 1080, vars: {}, canvas: c, fallback: node,
      querySelectorAll: () => [script],
      querySelector(selector) { return selector === 'canvas' ? this.canvas : selector.includes('fallback') ? node : script; },
      appendChild(child) { this.canvas = child; },
    };
  }
  return { runtime: window.akari.vgpuRuntime, container, calls, lose, reportError: error => onError(error) };
}

test('vgpu manifest carries time windows and uses the shared overlay sheet', () => {
  const built = buildGpuPage({ projectRoot: process.cwd(), duration: 3,
    edit: { output: { width: 1920, height: 1080, fps: 30 }, cuts: [], sources: [] },
    overlays: [{ id: 'neon', start: 0.5, duration: 2, z: 3, html: fixture('neon') }] });
  assert.deepEqual(built.spriteManifest.vgpu, [{ id: 'neon', start: 0.5, duration: 2, index: 0, z: 3 }]);
  assert.equal(built.spriteManifest.three.length, 0);
  assert.match(built.html, /id="akari-overlays"/);
  assert.match(built.overlaySheetHtml, /window\.akari\.vgpuRuntime/);
  assert.doesNotMatch(built.overlaySheetHtml, /window\.akari\.threeRuntime/);
});

test('probe is shared, draws twice, and releases its temporary surface', async () => {
  const h = harness();
  const p = h.runtime.probe(); assert.equal(p, h.runtime.probe());
  const result = await p;
  assert.equal(result.ok, true); assert.equal(h.calls.init, 1); assert.equal(h.calls.draws.length, 2);
  assert.deepEqual(plain(result.adapter), { vendor: 'apple', architecture: 'metal-3' });
  assert.ok(result.ms >= 0); assert.equal(h.calls.outputs[0].disposed, true);
});

for (const options of [{ unavailable: true }, { failDraw: true }]) {
  test(`probe rejects unavailable GPU / failed real draw: ${JSON.stringify(options)}`, async () => {
    const h = harness(options);
    await assert.rejects(h.runtime.probe(), /^Error: VGPU-UNAVAILABLE:/);
  });
}

test('pure render preserves output dimensions, CSS knobs and arbitrary seek time at half resolution', async () => {
  const h = harness(); await h.runtime.probe(); const c = h.container();
  c.vars['--vgpu-speed'] = '2';
  h.runtime.render(c, 1.5, { previewScale: 0.5 });
  assert.equal(c.canvas.width, 960); assert.equal(c.canvas.height, 540);
  assert.deepEqual(h.calls.draws.at(-1).bag, {
    akari: { time: 1.5, aspect: 1920 / 1080, width: 1920, height: 1080, seed: 0, pad: [960, 540, 0.5] }, params: { speed: 2 },
  });
  const effects = h.calls.effects.length, resizes = h.calls.outputs.at(-1).resizes;
  h.runtime.render(c, 7, { previewScale: 0.5 });
  h.runtime.render(c, 1.5, { previewScale: 0.5 });
  assert.equal(h.calls.outputs.at(-1).resizes, resizes); assert.equal(h.calls.effects.length, effects);
  assert.equal(h.calls.draws.at(-1).bag.akari.time, 1.5);
  h.runtime.render(c, 1.5);
  assert.equal(c.canvas.width, 1920); assert.equal(c.canvas.height, 1080);
  assert.deepEqual(h.calls.draws.at(-1).bag.akari.pad, [1920, 1080, 1]);
  assert.equal(h.runtime.inspect(c).drawCount, 4);
});

test('multi-pass textures are rebound after resize and each pass gets its own UV buffer dimensions', async () => {
  const h = harness(); await h.runtime.probe(); const d = descriptor();
  d.passes = [ { id: 'bright', wgsl: '@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1); }', scale: 0.5 },
    { ...d.passes[0], inputs: ['bright'], scale: 0.25 } ];
  const c = h.container(d, { hasCanvas: false });
  h.runtime.render(c, 2, { previewScale: 0.5 });
  const [first, last] = h.calls.draws.slice(-2);
  assert.deepEqual(first.bag.akari.pad, [480, 270, 0.5]);
  assert.deepEqual(last.bag.akari.pad, [960, 540, 0.5]);
  assert.equal(last.effect.bag.input_0, first.output.color);
  assert.equal(Object.hasOwn(first.effect.bag, 'params'), false);
  assert.match(last.effect.source, /@binding\(8\) var input_sampler/);
  h.runtime.render(c, 2);
  assert.equal(h.calls.draws.at(-1).effect.bag.input_0, first.output.color);
  h.runtime.dispose(c); assert.equal(first.output.disposed, true); assert.equal(last.output.disposed, true);
  assert.equal(c.canvas.removed, true); assert.equal(h.calls.init, 1);
});

test('invalid scale and knob arity warn once and retain declared values', async () => {
  const h = harness(); await h.runtime.probe(); const c = h.container(); c.vars['--vgpu-speed'] = '2 3';
  for (let i = 0; i < 2; i++) h.runtime.render(c, i, { previewScale: -1 });
  assert.equal(h.calls.warnings.length, 2); assert.equal(h.calls.draws.at(-1).bag.params.speed, 1);
  assert.equal(c.canvas.width, 1920);
});

test('device lost after probe is fatal even for an existing container', async () => {
  const h = harness(); await h.runtime.probe(); const c = h.container(); h.runtime.render(c, 0);
  h.lose({ message: 'removed' }); await Promise.resolve();
  assert.throws(() => h.runtime.render(c, 1), /VGPU-DEVICE-LOST: removed/);
  assert.equal(h.runtime.inspect(c).deviceLost, true); assert.equal(h.runtime.inspect(c).status, 'error');
});

test('asynchronous GPU validation failure is never reported as ready', async () => {
  const h = harness(); await h.runtime.probe(); const c = h.container(); h.runtime.render(c, 0);
  h.reportError(new Error('invalid shader'));
  assert.throws(() => h.runtime.render(c, 1), /VGPU-RENDER: invalid shader/);
  assert.equal(h.runtime.inspect(c).status, 'error');
});

const invalid = {
  version: d => { d.version = 1; }, mode: d => { d.mode = 'unknown'; }, stateful: d => { d.mode = 'stateful'; },
  alpha: d => { d.alphaMode = 'opaque'; }, seed: d => { d.seed = null; },
  unknown: d => { d.unknown = 1; }, 'pass key': d => { d.passes[0].unknown = 1; },
  'empty passes': d => { d.passes = []; }, 'bad id': d => { d.passes[0].id = 'bad id'; },
  'forward input': d => { d.passes[0].inputs = ['later']; }, 'bad scale': d => { d.passes[0].scale = 0; },
  'bad uniform': d => { d.uniforms.speed = [1]; }, 'null uniforms': d => { d.uniforms = null; },
};
for (const [name, mutate] of Object.entries(invalid)) {
  test(`browser and eligibility both reject ${name}`, () => {
    const h = harness(); const d = descriptor(); mutate(d);
    assert.throws(() => h.runtime.readDescriptor(h.container(d)), { name: 'TypeError' });
    const html = `<canvas></canvas><script type="application/json" data-akari-vgpu-scene>${JSON.stringify(d)}</script>`;
    const result = evaluateGpuEligibility({ edit: { overlays: [{ id: 'test', html }] } });
    assert.equal(result.entries[0].classification, 'degraded');
    assert.equal(result.entries[0].reason, name === 'stateful' ? 'vgpu-stateful-unsupported' : 'vgpu-invalid-declaration');
  });
}

test('vgpu force keeps pure layers direct and exposes degraded declarations honestly', () => {
  for (const [name, classification] of [['neon', 'vgpu'], ['stateful', 'dom']]) {
    const result = evaluateGpuEligibility({ edit: { overlays: [{ id: name, html: fixture(name) }] }, forceDegraded: true });
    assert.equal(result.entries[0].classification, classification);
    assert.equal(result.eligible, name === 'neon');
  }
});

test('receipt includes vgpu only for vgpu runs and normalizes its fields', () => {
  assert.equal(Object.hasOwn(buildGpuReceipt().gpu, 'vgpu'), false);
  const value = { overlays: 2, adapter: { vendor: 'apple', architecture: 'metal-3' }, previewScale: null, deviceLost: false, probeMs: 12.5 };
  assert.deepEqual(buildGpuReceipt({ run: { vgpu: value } }).gpu.vgpu, value);
  assert.deepEqual(buildGpuReceipt({ run: { vgpu: { overlays: -1, adapter: {}, probeMs: NaN } } }).gpu.vgpu,
    { overlays: 0, adapter: { vendor: '', architecture: '' }, previewScale: null, deviceLost: false, probeMs: null });
});

async function mountPage(runtime) {
  const h = harness(); const c = h.container(); c.parentElement = { style: {} };
  const overlayFrame = { contentDocument: { readyState: 'complete', querySelector: () => c }, contentWindow: { akari: { vgpuRuntime: runtime } } };
  const start = pageSource.indexOf('      const overlayFrame = document.getElementById("akari-overlays");');
  const end = pageSource.indexOf('      overlaySheetHasVideo =', start);
  return runInNewContext(`(async () => { let threeRuntime, vgpuRuntime, vgpuProbe; const threeRecords = new Map(), vgpuRecords = new Map(); ${pageSource.slice(start, end)} })()`, {
    document: { getElementById: () => overlayFrame }, CSS: { escape: x => x },
    config: { spriteManifest: { three: [], vgpu: [{ id: 'test' }] } },
    spriteCompositor: { registerSprite() {} }, vgpuDrawState: () => ({ opacity: 1 }),
  });
}

test('GPU page refuses absent or failed vgpu probe without requiring threeRuntime', async () => {
  await assert.rejects(mountPage(null), /VGPU-UNAVAILABLE/);
  await assert.rejects(mountPage({ render() {}, probe: async () => { throw new Error('VGPU-UNAVAILABLE: no adapter'); } }), /VGPU-UNAVAILABLE: no adapter/);
  await assert.rejects(mountPage({ render() {}, probe: async () => ({ ok: false }) }), /VGPU-UNAVAILABLE/);
  await mountPage({ render() {}, probe: async () => ({ ok: true }), inspect: () => ({ status: 'ready' }) });
});

test('GPU frame transfers canvas immediately after render and propagates device loss', () => {
  const start = pageSource.indexOf('          for (const value of config.spriteManifest.vgpu ?? [])');
  const end = pageSource.indexOf('          stages.three.push', start);
  const calls = []; const canvas = {}; const container = {};
  const context = { config: { spriteManifest: { vgpu: [{ id: 'v', start: 0.5 }] } }, seconds: 1.5,
    activeAt: () => true, vgpuRecords: new Map([['v', { canvas, container }]]),
    vgpuRuntime: { render(c, t) { assert.equal(c, container); assert.equal(t, 1); calls.push('render'); }, inspect: () => ({ status: 'ready' }) },
    spriteCompositor: { updateSprite(id, c) { assert.equal(id, 'v'); assert.equal(c, canvas); calls.push('upload'); } },
  };
  runInNewContext(pageSource.slice(start, end), context); assert.deepEqual(calls, ['render', 'upload']);
  context.vgpuRuntime.render = () => { throw new Error('VGPU-DEVICE-LOST: gone'); };
  assert.throws(() => runInNewContext(pageSource.slice(start, end), context), /VGPU-DEVICE-LOST/);
});

test('device loss during the probe rejects with VGPU-UNAVAILABLE', async () => {
  const h = harness(); const result = h.runtime.probe(); h.lose({ message: 'lost while probing' });
  await assert.rejects(result, /VGPU-UNAVAILABLE: VGPU-DEVICE-LOST/);
});

test('loading render initializes once, and a failed declaration shows its fallback', async () => {
  const h = harness(); const c = h.container();
  h.runtime.render(c, 0); h.runtime.render(c, 1);
  assert.equal(h.runtime.inspect(c).status, 'loading'); assert.equal(h.calls.init, 1);
  await h.runtime.probe(); h.runtime.render(c, 1);
  assert.equal(h.runtime.inspect(c).status, 'ready');
  const invalid = descriptor(); invalid.passes[0].inputs = ['main']; const bad = h.container(invalid);
  assert.throws(() => h.runtime.render(bad, 0), /VGPU-RENDER/);
  assert.equal(bad.fallback.style.display, ''); assert.equal(h.runtime.inspect(bad).status, 'error');
  h.runtime.render(bad, 1); assert.equal(h.runtime.inspect(bad).drawCount, 0);
});

test('GPU draw placement retains container translation, half scale, time window and z order', () => {
  const window = { __AKARI_GPU_CONFIG__: {} };
  class MessageChannel { constructor() { this.port1 = {}; this.port2 = { postMessage() {} }; } }
  class DOMMatrixReadOnly {
    constructor() { Object.assign(this, { a: 0.5, b: 0, c: 0, d: 0.5, e: -480, f: -270 }); }
  }
  runInNewContext(pageSource, { window, MessageChannel, DOMMatrixReadOnly, performance, console, setTimeout, clearTimeout });
  const api = window.__akariGpuDomInternals;
  const draw = api.vgpuDrawState({ ownerDocument: { defaultView: { getComputedStyle: () => ({ transform: 'matrix(.5,0,0,.5,-480,-270)', opacity: '1' }) } } });
  assert.deepEqual(plain(draw), { opacity: 1, translateX: -480, translateY: -270, scaleX: 0.5, scaleY: 0.5, rotateDeg: 0 });
  const manifest = { statics: [{ id: 'front', start: 0, duration: 2, index: 0, z: 2 }], three: [],
    vgpu: [{ id: 'v', start: 0.5, duration: 1, index: 1, z: 1 }], dom: [] };
  const records = new Map([['v', { draw }]]);
  const draws = api.orderedSpriteDraws(manifest, 1, {}, null, records);
  assert.deepEqual(plain(draws).map(value => value.id), ['v', 'front']);
  assert.equal(draws[0].scaleX, 0.5); assert.equal(draws[0].translateX, -480);
  assert.deepEqual(plain(api.orderedSpriteDraws(manifest, 1.5, {}, null, records)).map(value => value.id), ['front']);
});
