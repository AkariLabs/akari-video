import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { evaluateGpuEligibility } from '../src/eligibility.mjs';
import { buildGpuReceipt } from '../src/receipt.mjs';
import { renderOverlaySheet } from '../../render-cut/src/rasterize.mjs';

const runtimeSource = readFileSync(new URL('../../overlay-runtime/src/vgpu-runtime.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../src/page-runtime.js', import.meta.url), 'utf8');
const fixture = name => readFileSync(new URL(`./fixtures/vgpu-${name}.html`, import.meta.url), 'utf8');
const descriptor = (name = 'stateful') => JSON.parse(fixture(name).match(/data-akari-vgpu-scene>([\s\S]*?)<\/script>/)[1]);
const plain = value => JSON.parse(JSON.stringify(value));
const html = d => `<canvas></canvas><script type="application/json" data-akari-vgpu-scene>${JSON.stringify(d)}</script>`;

function harness({ destroyable = true, failCompute = false } = {}) {
  const calls = { events: [], bindings: [], pipelines: [], outputs: [], buffers: [], pairs: [], draws: [], warnings: [] };
  const definitions = [];
  let lose, reportError;
  const gpu = { gpu: { adapterInfo: { vendor: 'apple', architecture: 'metal-3' },
    lost: new Promise(resolve => { lose = resolve; }), queue: { onSubmittedWorkDone: async () => {} } },
    onError(cb) { reportError = cb; }, settled: async () => {},
  };
  const canvas = () => ({ style: {}, width: 0, height: 0, remove() { this.removed = true; } });
  const output = options => {
    const result = { size: options.size, color: {}, disposed: false,
      resize(size) { this.size = size; }, dispose() { this.disposed = true; }, destroy() { this.disposed = true; },
    };
    calls.outputs.push(result); return result;
  };
  const storage = (_, size) => {
    const buffer = { id: calls.buffers.length, size, access: 'read-write', destroyed: false,
      read() { throw new Error('CPU readback must not be used'); },
      write(data) { calls.events.push({ type: 'zero', buffer: this.id, bytes: data.byteLength, zero: [...data].every(n => n === 0) }); },
    };
    if (destroyable) buffer.destroy = () => { buffer.destroyed = true; };
    calls.buffers.push(buffer); return buffer;
  };
  function pipeline(source, kind) {
    const index = definitions.findIndex(pass => source.endsWith(pass.wgsl));
    const definition = index < 0 ? { id: 'probe' } : definitions.splice(index, 1)[0];
    const result = { id: definition.id, source, kind,
      set(bag) {
        this.bag = bag;
        const bindings = Object.fromEntries(Object.entries(bag).map(([name, value]) =>
          [name, calls.buffers.includes(value) ? { buffer: value.id } : plain(value)]));
        calls.bindings.push({ pass: this.id, bindings });
        return this;
      },
      dispatch(...args) {
        if (failCompute) throw new Error('compute failed');
        for (const [key, value] of Object.entries(this.bag)) {
          if (key.endsWith('_in')) assert.notEqual(value, this.bag[key.replace(/_in$/, '_out')]);
        }
        calls.events.push({ type: 'dispatch', pass: this.id, step: this.bag.akari_state.step,
          time: this.bag.akari.time, dt: this.bag.akari_state.dt, args: [...args] });
      },
    };
    calls.pipelines.push(result); return result;
  }
  const window = { AkariVgpu: {
    init: async () => gpu, surface: (_, c, options) => output(options), target: (_, options) => output(options),
    sampler: () => ({}), storage,
    pingPongStorage: (_, bytes) => {
      const pair = { id: calls.pairs.length, read: storage(gpu, bytes), write: storage(gpu, bytes),
        swap() { [this.read, this.write] = [this.write, this.read]; calls.events.push({ type: 'swap', pair: this.id, read: this.read.id, write: this.write.id }); },
      };
      calls.pairs.push(pair); return pair;
    },
    pingPong: () => { throw new Error('storage textures must fail before allocation'); },
    compute: (_, source) => pipeline(source, 'compute'), effect: (_, source) => pipeline(source, 'fragment'),
    frame: (_, cb) => cb({ pass(target, shader) { calls.draws.push({ target, shader, bag: shader.bag }); } }),
  } };
  runInNewContext(runtimeSource, { window, navigator: { gpu: {} }, document: { createElement: canvas }, performance,
    console: { warn: message => calls.warnings.push(message) },
    getComputedStyle: c => ({ getPropertyValue: key => c.vars[key] ?? '' }),
  });
  function container(d = descriptor(), { hasCanvas = true } = {}) {
    definitions.push(...d.passes ?? []);
    const script = { textContent: JSON.stringify(d) }, fallback = { style: { display: 'none' } };
    return { clientWidth: 1920, clientHeight: 1080, vars: {}, canvas: hasCanvas ? canvas() : null, fallback,
      querySelectorAll: () => [script],
      querySelector(selector) { return selector === 'canvas' ? this.canvas : selector.includes('fallback') ? fallback : script; },
      appendChild(child) { this.canvas = child; },
    };
  }
  return { runtime: window.akari.vgpuRuntime, calls, container, lose, reportError: error => reportError(error) };
}

test('stateful direct seek and sequential playback dispatch and swap exactly the same steps', async () => {
  const direct = harness(), sequential = harness();
  await Promise.all([direct.runtime.probe(), sequential.runtime.probe()]);
  const a = direct.container(), b = sequential.container();
  direct.runtime.render(a, 1.5, { fps: 30 });
  for (let i = 0; i <= 45; i++) sequential.runtime.render(b, i / 30, { fps: 30 });
  assert.deepEqual(direct.calls.events, sequential.calls.events);
  const steps = direct.calls.events.filter(e => e.type === 'dispatch');
  assert.deepEqual(steps.map(e => e.pass), ['init', ...Array(45).fill('advect')]);
  assert.deepEqual(steps.slice(1).map(e => e.step), Array.from({ length: 45 }, (_, i) => i));
  assert.ok(steps.every(e => e.dt === 1 / 30));
  for (const h of [direct, sequential]) {
    const state = h.runtime.inspect(h === direct ? a : b);
    assert.equal(state.stateful, true); assert.equal(state.step, 45); assert.equal(state.replaySteps, 46);
    assert.deepEqual(plain(h.calls.draws.at(-1).bag.akari_state), { step: 45, dt: 1 / 30, pad: [0, 0] });
  }
});

test('backward seek clears both halves, initializes once and replays exactly fifteen steps', async () => {
  const h = harness(); await h.runtime.probe(); const c = h.container();
  h.runtime.render(c, 2, { fps: 30 });
  h.calls.events.length = 0;
  h.runtime.render(c, 0.5, { fps: 30 });
  assert.deepEqual(h.calls.events.slice(0, 2).map(e => ({ ...e, buffer: 0 })),
    Array(2).fill({ type: 'zero', buffer: 0, bytes: 4096, zero: true }));
  assert.equal(new Set(h.calls.events.slice(0, 2).map(e => e.buffer)).size, 2);
  assert.deepEqual(h.calls.events.filter(e => e.type === 'dispatch').map(e => [e.pass, e.step]),
    [['init', 0], ...Array.from({ length: 15 }, (_, i) => ['advect', i])]);
  assert.equal(h.runtime.inspect(c).step, 15); assert.equal(h.runtime.inspect(c).replaySteps, 77);
});

test('repeated steps only display; negative time clamps the state to zero; reset counts once', async () => {
  const h = harness(); await h.runtime.probe(); const c = h.container();
  h.runtime.render(c, -1, { fps: 30 });
  assert.equal(h.runtime.inspect(c).step, 0); assert.equal(h.runtime.inspect(c).replaySteps, 1);
  h.calls.events.length = 0;
  h.runtime.render(c, 0.01, { fps: 30 });
  assert.deepEqual(h.calls.events, []); assert.equal(h.calls.draws.at(-1).bag.akari.time, 0.01);
  h.runtime.render(c, 0.02, { fps: 30 });
  assert.equal(h.runtime.inspect(c).step, 1); assert.equal(h.runtime.inspect(c).replaySteps, 2);
});

test('replay limit fails loudly with fallback and never draws the incomplete state', async () => {
  const h = harness(); await h.runtime.probe(); const c = h.container(descriptor('stateful-limit'));
  assert.throws(() => h.runtime.render(c, 1, { fps: 30 }), { message: 'VGPU-REPLAY-LIMIT: 30 steps exceeds maxReplaySteps 5' });
  assert.equal(h.runtime.inspect(c).status, 'error'); assert.equal(c.fallback.style.display, '');
  assert.equal(h.runtime.inspect(c).drawCount, 0);
  assert.deepEqual(h.calls.events.filter(e => e.type === 'dispatch').map(e => e.pass), ['init']);
  const count = h.calls.events.length; h.runtime.render(c, 0, { fps: 30 }); assert.equal(h.calls.events.length, count);
});

test('replay limit applies to the delta per call and excludes reset', async () => {
  const h = harness(); await h.runtime.probe(); const c = h.container(descriptor('stateful-limit'));
  for (const step of [5, 10, 15, 0, 5]) h.runtime.render(c, step / 30, { fps: 30 });
  assert.equal(h.runtime.inspect(c).step, 5); assert.equal(h.runtime.inspect(c).replaySteps, 22);
  assert.equal(h.runtime.inspect(c).status, 'ready');
});

test('mount plus ninety export frames counts exactly ninety replay transitions', async () => {
  const h = harness(); await h.runtime.probe(); const c = h.container();
  h.runtime.render(c, 0, { fps: 30 });
  for (let frame = 0; frame < 90; frame++) h.runtime.render(c, frame / 30, { fps: 30 });
  assert.equal(h.runtime.inspect(c).replaySteps, 90); assert.equal(h.runtime.inspect(c).step, 89);
  assert.equal(h.calls.events.filter(e => e.type === 'dispatch' && e.pass === 'init').length, 1);
  assert.equal(h.calls.events.filter(e => e.type === 'dispatch' && e.pass === 'advect').length, 89);
});

for (const fps of [undefined, 0, -1, NaN, Infinity, '30', null]) {
  test(`stateful requires positive finite fps (${String(fps)})`, async () => {
    const h = harness(); await h.runtime.probe(); const c = h.container();
    assert.throws(() => fps === undefined ? h.runtime.render(c, 1) : h.runtime.render(c, 1, { fps }),
      { name: 'TypeError', message: 'vgpu fps is required for stateful scenes' });
    assert.equal(h.runtime.inspect(c).status, 'error'); assert.equal(c.fallback.style.display, '');
    assert.equal(h.calls.pairs.length, 0);
  });
}

test('fps is validated before lazy probe; pure still needs no fps', async () => {
  const h = harness(); const c = h.container();
  assert.throws(() => h.runtime.render(c, 1), { name: 'TypeError' });
  await h.runtime.probe(); const pure = h.container(descriptor('gradient'));
  h.runtime.render(pure, 1);
  assert.equal(h.runtime.inspect(pure).status, 'ready');
  assert.equal(h.runtime.inspect(pure).stateful, false); assert.equal(h.runtime.inspect(pure).step, null);
  assert.equal(h.runtime.inspect(pure).replaySteps, 0);
});

test('stateful prelude uses sparse state bindings, ping-pong halves and only declared params', async () => {
  const h = harness(); await h.runtime.probe(); const d = descriptor();
  d.state.unshift({ id: 'unused', kind: 'buffer', bytes: 16 });
  const c = h.container(d); c.vars['--vgpu-stir'] = '2.5';
  h.runtime.render(c, 1 / 30, { fps: 30, previewScale: 0.5 });
  const [init, compute, display] = h.calls.pipelines.filter(p => p.id !== 'probe');
  assert.match(compute.source, /@group\(0\) @binding\(2\) var<uniform> akari_state: AkariState/);
  assert.match(compute.source, /@group\(1\) @binding\(2\) var<storage, read> trail_in: array<f32>/);
  assert.match(compute.source, /@group\(1\) @binding\(3\) var<storage, read_write> trail_out: array<f32>/);
  for (const pass of [init, compute, display]) assert.doesNotMatch(pass.source, /unused_(?:in|out)|state_sampler/);
  assert.doesNotMatch(init.source, /trail_in/); assert.doesNotMatch(display.source, /trail_out/);
  assert.equal(Object.hasOwn(init.bag, 'params'), false); assert.equal(Object.hasOwn(display.bag, 'params'), false);
  assert.deepEqual(plain(compute.bag.params), { stir: 2.5 });
  assert.notEqual(compute.bag.trail_in, compute.bag.trail_out);
  assert.equal(display.bag.trail_in, compute.bag.trail_out);
  assert.deepEqual(plain(compute.bag.akari), { time: 0, aspect: 1920 / 1080, width: 1920, height: 1080, seed: 1234, pad: [1920, 1080, 1] });
  assert.deepEqual(h.calls.buffers.map(b => b.size), [16, 16, 4096, 4096]);
  h.calls.events.length = 0;
  h.runtime.render(c, 1 / 30, { fps: 30 });
  assert.equal(c.canvas.width, 1920); assert.equal(c.canvas.height, 1080);
  assert.deepEqual(h.calls.events, []); assert.equal(h.calls.buffers.length, 4);
});

test('previewScale changes only display pad and preserves every init and compute binding', async () => {
  const half = harness(), full = harness();
  await Promise.all([half.runtime.probe(), full.runtime.probe()]);
  const d = descriptor();
  const a = half.container(d), b = full.container(d);
  a.vars['--vgpu-stir'] = b.vars['--vgpu-stir'] = '2.5';
  half.runtime.render(a, 1.5, { fps: 30, previewScale: 0.5 });
  full.runtime.render(b, 1.5, { fps: 30, previewScale: 1 });
  const halfSimulation = half.calls.bindings.filter(record => record.pass !== 'display');
  const fullSimulation = full.calls.bindings.filter(record => record.pass !== 'display');
  assert.deepEqual(halfSimulation.map(record => record.pass), ['init', ...Array(45).fill('advect')]);
  assert.deepEqual(halfSimulation, fullSimulation);
  for (const record of halfSimulation) assert.deepEqual(record.bindings.akari.pad, [1920, 1080, 1]);
  const halfDisplay = half.calls.bindings.filter(record => record.pass === 'display');
  const fullDisplay = full.calls.bindings.filter(record => record.pass === 'display');
  assert.equal(halfDisplay.length, 1); assert.equal(fullDisplay.length, 1);
  const { akari: halfAkari, ...halfBindings } = halfDisplay[0].bindings;
  const { akari: fullAkari, ...fullBindings } = fullDisplay[0].bindings;
  const { pad: halfPad, ...halfUniforms } = halfAkari;
  const { pad: fullPad, ...fullUniforms } = fullAkari;
  assert.deepEqual(halfPad, [960, 540, 0.5]); assert.deepEqual(fullPad, [1920, 1080, 1]);
  assert.deepEqual(halfBindings, fullBindings); assert.deepEqual(halfUniforms, fullUniforms);
});

test('each compute pass sees the state swapped by the preceding pass, including multiple writes', async () => {
  const h = harness(); await h.runtime.probe(); const d = descriptor();
  d.state.push({ id: 'other', kind: 'buffer', bytes: 16 });
  d.passes.splice(2, 0, { id: 'second', kind: 'compute', reads: ['trail', 'other'], writes: ['other', 'trail'],
    dispatch: [1, 2, 3], wgsl: '@compute @workgroup_size(1) fn second() {}' });
  const c = h.container(d); h.runtime.render(c, 1 / 30, { fps: 30 });
  const advect = h.calls.pipelines.find(p => p.id === 'advect');
  const second = h.calls.pipelines.find(p => p.id === 'second');
  assert.equal(second.bag.trail_in, advect.bag.trail_out);
  assert.deepEqual(h.calls.events.slice(-3).map(e => e.type === 'swap' ? ['swap', e.pair] : [e.pass, e.args]),
    [['second', [1, 2, 3]], ['swap', 1], ['swap', 0]]);
});

for (const destroyable of [true, false]) {
  test(`dispose releases state buffers when destroy is available (${destroyable})`, async () => {
    const h = harness({ destroyable }); await h.runtime.probe(); const c = h.container(descriptor(), { hasCanvas: false });
    h.runtime.render(c, 1, { fps: 30 }); h.runtime.dispose(c);
    assert.equal(c.canvas.removed, true); assert.ok(h.calls.outputs.every(o => o.disposed));
    assert.ok(h.calls.buffers.every(b => b.destroyed === destroyable));
    assert.equal(h.runtime.inspect(c).step, null); assert.equal(h.runtime.inspect(c).stateful, false);
  });
}

test('partially constructed state and surface remain disposable after a compute failure', async () => {
  const h = harness({ failCompute: true }); await h.runtime.probe(); const c = h.container();
  assert.throws(() => h.runtime.render(c, 1, { fps: 30 }), /VGPU-RENDER: compute failed/);
  assert.equal(c.fallback.style.display, ''); h.runtime.dispose(c);
  assert.ok(h.calls.outputs.every(o => o.disposed)); assert.ok(h.calls.buffers.every(b => b.destroyed));
});

test('receipt counts stateful scenes and replay transitions and normalizes absent or invalid values', () => {
  const summary = buildGpuReceipt({ run: { vgpu: { overlays: 2, stateful: 1, replaySteps: 90 } } }).gpu.vgpu;
  assert.equal(summary.stateful, 1); assert.equal(summary.replaySteps, 90);
  for (const value of [undefined, null, -1, NaN, Infinity, 'invalid', {}, []]) {
    const result = buildGpuReceipt({ run: { vgpu: { stateful: value, replaySteps: value } } }).gpu.vgpu;
    assert.equal(result.stateful, 0); assert.equal(result.replaySteps, 0);
  }
  const numeric = buildGpuReceipt({ run: { vgpu: { stateful: "1", replaySteps: "90" } } }).gpu.vgpu;
  assert.equal(numeric.stateful, 1); assert.equal(numeric.replaySteps, 90);
  const result = buildGpuReceipt({ run: { vgpu: { stateful: 1.9, replaySteps: 90.9 } } }).gpu.vgpu;
  assert.equal(result.stateful, 1); assert.equal(result.replaySteps, 90);
});

const invalid = {
  'missing state': d => { delete d.state; }, 'empty state': d => { d.state = []; },
  'too much state': d => { d.state = Array.from({ length: 9 }, (_, i) => ({ id: `state${i}`, kind: 'buffer', bytes: 4 })); },
  'missing replay limit': d => { delete d.maxReplaySteps; }, 'fractional replay limit': d => { d.maxReplaySteps = 1.5; },
  'zero replay limit': d => { d.maxReplaySteps = 0; },
  'unknown write': d => { d.passes[1].writes = ['missing']; }, 'unknown read': d => { d.passes[1].reads = ['missing']; },
  'duplicate reads': d => { d.passes[1].reads = ['trail', 'trail']; }, 'duplicate writes': d => { d.passes[1].writes = ['trail', 'trail']; },
  'early fragment': d => { d.passes.reverse(); }, 'duplicate fragment': d => { d.passes.unshift({ ...d.passes.at(-1), id: 'early' }); },
  'no fragment': d => { d.passes.pop(); }, 'late init': d => { [d.passes[0], d.passes[1]] = [d.passes[1], d.passes[0]]; },
  'init reads': d => { d.passes[0].reads = ['trail']; }, 'init without writes': d => { d.passes[0].writes = []; },
  'fractional dispatch': d => { d.passes[1].dispatch = [1, 1.5, 1]; }, 'missing dispatch': d => { delete d.passes[1].dispatch; },
  'short dispatch': d => { d.passes[1].dispatch = [1, 1]; }, 'zero dispatch': d => { d.passes[1].dispatch = [1, 0, 1]; },
  'fragment dispatch': d => { d.passes.at(-1).dispatch = [1, 1, 1]; }, 'fragment writes': d => { d.passes.at(-1).writes = ['trail']; },
  'unknown top key': d => { d.unknown = 0; }, 'unknown state key': d => { d.state[0].format = 'r32float'; },
  'unknown pass key': d => { d.passes[1].scale = 1; }, 'pure inputs': d => { d.passes[1].inputs = []; },
  'invalid identifier': d => { d.state[0].id = 'not-wgsl'; }, 'numeric state identifier': d => { d.state[0].id = 1; },
  'duplicate state': d => { d.state.push(d.state[0]); }, 'unknown state kind': d => { d.state[0].kind = 'storage'; },
  'unaligned bytes': d => { d.state[0].bytes = 5; }, 'empty bytes': d => { d.state[0].bytes = 0; },
  'too many bytes': d => { d.state[0].bytes = 67108868; }, 'fractional bytes': d => { d.state[0].bytes = 4.5; },
  'texture format': d => { d.state[0] = { id: 'trail', kind: 'texture', format: 'depth32float', size: [16, 16] }; },
  'texture size': d => { d.state[0] = { id: 'trail', kind: 'texture', format: 'r32float', size: [4097, 16] }; },
  'texture dimension': d => { d.state[0] = { id: 'trail', kind: 'texture', format: 'r32float', size: [16, 1.5] }; },
  'duplicate pass': d => { d.passes[1].id = d.passes[0].id; }, 'invalid pass id': d => { d.passes[0].id = 'bad id'; },
  'unknown pass kind': d => { d.passes[1].kind = 'draw'; }, 'empty shader': d => { d.passes[1].wgsl = ' '; },
  'version': d => { d.version = 1; }, 'alpha': d => { d.alphaMode = 'opaque'; }, 'seed': d => { d.seed = null; },
  'uniforms': d => { d.uniforms.stir = [1]; }, 'null uniforms': d => { d.uniforms = null; },
};
for (const [name, mutate] of Object.entries(invalid)) {
  test(`stateful browser and eligibility validators reject ${name}`, () => {
    const h = harness(); const d = descriptor(); mutate(d);
    assert.throws(() => h.runtime.readDescriptor(h.container(d)), { name: 'TypeError' });
    const result = evaluateGpuEligibility({ edit: { overlays: [{ id: 'test', html: html(d) }] } });
    assert.equal(result.entries[0].classification, 'degraded'); assert.equal(result.entries[0].reason, 'vgpu-invalid-declaration');
  });
}

test('stateful normalization supports fragment-only scenes and omitted optional fields', async () => {
  const h = harness(); await h.runtime.probe(); const d = descriptor();
  delete d.seed; delete d.alphaMode; delete d.uniforms; d.passes = [d.passes.at(-1)];
  delete d.passes[0].reads;
  const c = h.container(d); const normalized = plain(h.runtime.readDescriptor(c));
  assert.equal(normalized.seed, 0); assert.equal(normalized.alphaMode, 'premultiplied');
  assert.deepEqual(normalized.uniforms, {}); assert.deepEqual(normalized.passes[0].reads, []); assert.deepEqual(normalized.passes[0].writes, []);
  h.runtime.render(c, 1, { fps: 30 }); assert.equal(h.runtime.inspect(c).replaySteps, 31);
});

for (const format of ['rgba16float', 'rgba8unorm', 'r32float', 'rg32float', 'rgba32float']) {
  test(`valid ${format} texture state stays eligible but fails loudly at runtime`, async () => {
    const h = harness(); await h.runtime.probe(); const d = descriptor();
    d.state[0] = { id: 'trail', kind: 'texture', format, size: [128, 72] };
    const c = h.container(d);
    assert.equal(h.runtime.readDescriptor(c).state[0].format, format);
    const entry = evaluateGpuEligibility({ edit: { overlays: [{ id: 'texture', html: html(d) }] } }).entries[0];
    assert.equal(entry.classification, 'vgpu'); assert.equal(entry.reason, 'vgpu-scene-stateful-direct');
    assert.throws(() => h.runtime.render(c, 1, { fps: 30 }), { message: 'VGPU-STATE-TEXTURE-UNSUPPORTED: vgpu 0.4.0 cannot bind storage textures; use kind:"buffer" state' });
    assert.equal(h.runtime.inspect(c).status, 'error'); assert.equal(c.fallback.style.display, '');
    assert.equal(h.runtime.inspect(c).stateful, true); assert.equal(h.runtime.inspect(c).step, null);
    assert.equal(h.calls.buffers.length, 0); h.runtime.dispose(c); assert.ok(h.calls.outputs.every(o => o.disposed));
  });
}

test('fluid declares fixed buffer sizes, nine ordered compute passes and a final display', async () => {
  const h = harness(); await h.runtime.probe(); const d = descriptor('fluid'); const c = h.container(d);
  const value = plain(h.runtime.readDescriptor(c));
  assert.deepEqual(value.state.map(r => [r.id, r.kind, r.bytes]), [
    ['velocity', 'buffer', 73728], ['dye', 'buffer', 2359296], ['pressure', 'buffer', 36864],
    ['divergence', 'buffer', 36864], ['curl', 'buffer', 36864],
  ]);
  assert.deepEqual(value.passes.map(p => p.id), ['advect-velocity', 'curl', 'vorticity', 'divergence', 'pressure-1', 'pressure-2', 'pressure-3', 'project', 'advect-dye', 'display']);
  h.runtime.render(c, 1 / 30, { fps: 30, previewScale: 0.5 });
  assert.deepEqual(h.calls.events.filter(e => e.type === 'dispatch').map(e => e.args), [...Array(8).fill([16, 9, 1]), [64, 36, 1]]);
  const bindings = h.calls.bindings.find(p => p.pass === 'vorticity').bindings;
  assert.ok(Object.hasOwn(bindings, 'velocity_in')); assert.ok(Object.hasOwn(bindings, 'curl_in'));
  assert.ok(Object.hasOwn(bindings, 'velocity_out')); assert.equal(Object.hasOwn(bindings, 'params'), false);
  assert.match(fixture('fluid'), /MIT License[\s\S]*Copyright \(c\) 2025 Vercel, Inc\./);
});

test('GPU page mount, per-frame render and summary forward fps and count runtime transitions', () => {
  const calls = [], c = {}, canvas = {};
  const runtime = { render(container, time, options) { calls.push({ container, time, options: plain(options) }); },
    inspect: container => container === c ? { status: 'ready', stateful: true, replaySteps: 90, deviceLost: false }
      : { status: 'ready', stateful: false, replaySteps: 0, deviceLost: false },
  };
  const records = new Map([['fluid', { container: c, canvas }], ['pure', { container: {} }]]);
  const start = pageSource.indexOf('          for (const value of config.spriteManifest.vgpu ?? [])');
  const end = pageSource.indexOf('          stages.three.push', start);
  runInNewContext(pageSource.slice(start, end), { seconds: 2, config: { fps: 30, spriteManifest: { vgpu: [{ id: 'fluid', start: 0.5 }] } },
    activeAt: () => true, vgpuRecords: records, vgpuRuntime: runtime, spriteCompositor: { updateSprite() {} },
  });
  assert.deepEqual(calls, [{ container: c, time: 1.5, options: { fps: 30 } }]);
  const summaryStart = pageSource.indexOf('    const vgpuSummary =');
  const summaryEnd = pageSource.indexOf('\n    } } : {};', summaryStart) + '\n    } } : {};'.length;
  const result = runInNewContext(`${pageSource.slice(summaryStart, summaryEnd)} vgpuSummary();`, {
    vgpuRecords: records, vgpuRuntime: runtime, vgpuProbe: { adapter: {}, ms: 1 },
  });
  assert.equal(result.vgpu.stateful, 1); assert.equal(result.vgpu.replaySteps, 90);
  assert.match(pageSource, /vgpuRuntime\.render\(container, 0, \{ fps: config\.fps \}\)/);
});

test('vgpu overlay sheet passes output fps without adding stateful clocks', () => {
  const sheet = renderOverlaySheet({ edit: { output: { width: 1920, height: 1080, fps: 24 }, overlays: [], sources: [], cuts: [] },
    overlays: [{ id: 'state', html: fixture('stateful'), start: 0, duration: 1 }], duration: 1, projectRoot: process.cwd() });
  assert.match(sheet, /vgpuRuntime\.render\(vgpuContainer, localSeconds, \{ fps: 24 \}\)/);
});
