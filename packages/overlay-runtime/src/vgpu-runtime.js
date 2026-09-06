// Declarative, externally clocked WebGPU overlays. No per-container device or clock.
window.akari = window.akari || {};
window.akari.vgpuRuntime = (() => {
  const SELECTOR = 'script[type="application/json"][data-akari-vgpu-scene]';
  const PRELUDE = `struct AkariUniforms { time: f32, aspect: f32, width: f32, height: f32, seed: f32, pad: vec3f };
@group(0) @binding(0) var<uniform> akari: AkariUniforms;
fn akari_uv(pos: vec4f) -> vec2f { return pos.xy / vec2f(akari.pad.x, akari.pad.y); }
`;
  const instances = new WeakMap();
  const failedContainers = new WeakSet();
  const warnings = new Set();
  let gpu, sharedSampler, probePromise, initializationError, gpuError;
  let adapter = { vendor: '', architecture: '' };
  let deviceLost = false;
  let lostReason = '';

  function warnOnce(key, message) {
    if (warnings.has(key)) return;
    warnings.add(key);
    console.warn(message);
  }
  function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  }
  function keys(value, allowed, label) {
    if (!object(value)) throw new TypeError(`${label} must be an object`);
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) throw new TypeError(`${label}: unsupported key ${key}`);
    }
  }
  function readDescriptor(container) {
    const scripts = container.querySelectorAll(SELECTOR);
    if (!scripts.length) return null;
    if (scripts.length !== 1) throw new TypeError('vgpu requires exactly one declaration');
    let value;
    try { value = JSON.parse(scripts[0].textContent); }
    catch { throw new TypeError('vgpu declaration must be valid JSON'); }
    if (object(value) && value.mode === 'stateful') return validateVgpuStatefulDescriptor(value);
    keys(value, ['version', 'mode', 'alphaMode', 'seed', 'uniforms', 'passes'], 'vgpu');
    if (value.version !== 0) throw new TypeError('vgpu version must be 0');
    if (value.mode !== 'pure') throw new TypeError('vgpu mode must be pure');
    if (value.alphaMode !== undefined && value.alphaMode !== 'premultiplied') throw new TypeError('vgpu alphaMode must be premultiplied');
    if (value.seed !== undefined && !Number.isFinite(value.seed)) throw new TypeError('vgpu seed must be finite');
    const uniforms = value.uniforms === undefined ? {} : value.uniforms;
    if (!object(uniforms)) throw new TypeError('vgpu uniforms must be an object');
    for (const [key, uniform] of Object.entries(uniforms)) {
      if (!Number.isFinite(uniform) && !(Array.isArray(uniform) && uniform.length >= 2
        && uniform.length <= 4 && uniform.every(Number.isFinite))) throw new TypeError(`vgpu uniform ${key} must be f32 or vec2f/3f/4f`);
    }
    if (!Array.isArray(value.passes) || !value.passes.length) throw new TypeError('vgpu passes must be nonempty');
    const seen = new Set();
    const passes = value.passes.map((pass) => {
      keys(pass, ['id', 'wgsl', 'inputs', 'scale'], 'vgpu pass');
      if (typeof pass.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(pass.id) || seen.has(pass.id)) throw new TypeError('vgpu pass id must be valid and unique');
      if (typeof pass.wgsl !== 'string' || !pass.wgsl.trim()) throw new TypeError('vgpu pass wgsl must be nonempty');
      const inputs = pass.inputs === undefined ? [] : pass.inputs;
      if (!Array.isArray(inputs) || inputs.length > 8 || inputs.some(id => typeof id !== 'string' || !seen.has(id))) throw new TypeError('vgpu inputs must reference up to 8 earlier passes');
      if (pass.scale !== undefined && (!Number.isFinite(pass.scale) || pass.scale <= 0)) throw new TypeError('vgpu pass scale must be positive');
      seen.add(pass.id);
      return { ...pass, inputs, scale: pass.scale === undefined ? 1 : pass.scale };
    });
    return { ...value, alphaMode: 'premultiplied', seed: value.seed === undefined ? 0 : value.seed, uniforms, passes };
  }
  function validateVgpuStatefulDescriptor(value) {
    keys(value, ['version', 'mode', 'alphaMode', 'seed', 'maxReplaySteps', 'uniforms', 'state', 'passes'], 'vgpu');
    if (value.version !== 0) throw new TypeError('vgpu version must be 0');
    if (value.alphaMode !== undefined && value.alphaMode !== 'premultiplied') throw new TypeError('vgpu alphaMode must be premultiplied');
    if (value.seed !== undefined && !Number.isFinite(value.seed)) throw new TypeError('vgpu seed must be finite');
    if (!Number.isInteger(value.maxReplaySteps) || value.maxReplaySteps < 1) throw new TypeError('vgpu maxReplaySteps must be a positive integer');
    const uniforms = value.uniforms === undefined ? {} : value.uniforms;
    if (!object(uniforms)) throw new TypeError('vgpu uniforms must be an object');
    for (const [key, uniform] of Object.entries(uniforms)) {
      if (!Number.isFinite(uniform) && !(Array.isArray(uniform) && uniform.length >= 2
        && uniform.length <= 4 && uniform.every(Number.isFinite))) throw new TypeError(`vgpu uniform ${key} must be f32 or vec2f/3f/4f`);
    }
    if (!Array.isArray(value.state) || value.state.length < 1 || value.state.length > 8) throw new TypeError('vgpu state must contain 1 to 8 resources');
    const stateIds = new Set();
    const state = value.state.map(resource => {
      keys(resource, resource?.kind === 'buffer' ? ['id', 'kind', 'bytes'] : ['id', 'kind', 'format', 'size'], 'vgpu state');
      if (typeof resource.id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(resource.id) || stateIds.has(resource.id)) throw new TypeError('vgpu state id must be valid and unique');
      if (resource.kind === 'buffer') {
        if (!Number.isInteger(resource.bytes) || resource.bytes <= 0 || resource.bytes > 67108864 || resource.bytes % 4 !== 0) throw new TypeError('vgpu buffer bytes must be a positive multiple of 4 up to 67108864');
      } else if (resource.kind === 'texture') {
        if (!['rgba16float', 'rgba8unorm', 'r32float', 'rg32float', 'rgba32float'].includes(resource.format)) throw new TypeError('vgpu state texture format is unsupported');
        if (!Array.isArray(resource.size) || resource.size.length !== 2 || !resource.size.every(n => Number.isInteger(n) && n > 0 && n <= 4096)) throw new TypeError('vgpu state texture size must contain two positive integers up to 4096');
      } else throw new TypeError('vgpu state kind must be buffer or texture');
      stateIds.add(resource.id);
      return { ...resource };
    });
    if (!Array.isArray(value.passes) || !value.passes.length) throw new TypeError('vgpu passes must be nonempty');
    const seen = new Set();
    let computing = false;
    const passes = value.passes.map((pass, index) => {
      keys(pass, pass?.kind === 'fragment' ? ['id', 'kind', 'wgsl', 'reads', 'writes'] : ['id', 'kind', 'wgsl', 'reads', 'writes', 'dispatch'], 'vgpu pass');
      if (typeof pass.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(pass.id) || seen.has(pass.id)) throw new TypeError('vgpu pass id must be valid and unique');
      if (typeof pass.wgsl !== 'string' || !pass.wgsl.trim()) throw new TypeError('vgpu pass wgsl must be nonempty');
      if (!['init', 'compute', 'fragment'].includes(pass.kind)) throw new TypeError('vgpu pass kind must be init, compute or fragment');
      const reads = pass.reads === undefined ? [] : pass.reads;
      const writes = pass.writes === undefined ? [] : pass.writes;
      for (const list of [reads, writes]) {
        if (!Array.isArray(list) || list.some(id => typeof id !== 'string' || !stateIds.has(id)) || new Set(list).size !== list.length) throw new TypeError('vgpu reads/writes must reference unique state ids');
      }
      if (pass.kind === 'fragment') {
        if (index !== value.passes.length - 1 || writes.length) throw new TypeError('vgpu fragment must be last and cannot write state');
      } else {
        if (index === value.passes.length - 1) throw new TypeError('vgpu requires one final fragment');
        if (!Array.isArray(pass.dispatch) || pass.dispatch.length !== 3 || !pass.dispatch.every(n => Number.isInteger(n) && n >= 1)) throw new TypeError('vgpu dispatch must contain three positive integers');
        if (pass.kind === 'init' && (computing || reads.length || !writes.length)) throw new TypeError('vgpu init must precede compute, write state and have no reads');
        if (pass.kind === 'compute') computing = true;
      }
      seen.add(pass.id);
      return { ...pass, reads, writes };
    });
    return { ...value, alphaMode: 'premultiplied', seed: value.seed === undefined ? 0 : value.seed, uniforms, state, passes };
  }
  function fallback(container, visible) {
    const node = container.querySelector('[data-akari-vgpu-fallback]');
    if (node) node.style.display = visible ? '' : 'none';
  }
  function assertDevice() {
    if (deviceLost) throw new Error(`VGPU-DEVICE-LOST: ${lostReason}`);
    if (gpuError) throw new Error(`VGPU-RENDER: ${gpuError.message ?? gpuError}`);
  }
  function probe() {
    if (probePromise) return probePromise;
    probePromise = (async () => {
      const started = performance.now(); // Diagnostics only; never used as shader time.
      let output;
      try {
        if (!navigator.gpu || !window.AkariVgpu) throw new Error('WebGPU or vendor runtime unavailable');
        gpu = await window.AkariVgpu.init();
        gpu.gpu.lost.then(info => {
          deviceLost = true;
          lostReason = info?.message || info?.reason || 'device lost';
        });
        gpu.onError(error => { gpuError = error; });
        const info = gpu.gpu.adapterInfo ?? (await navigator.gpu.requestAdapter())?.info;
        adapter = { vendor: String(info?.vendor ?? ''), architecture: String(info?.architecture ?? '') };
        output = window.AkariVgpu.surface(gpu, document.createElement('canvas'), {
          size: [64, 64], autoResize: false, dpr: 1, alphaMode: 'premultiplied',
        });
        const shader = window.AkariVgpu.effect(gpu, '@fragment fn fs_main() -> @location(0) vec4f { return vec4f(0.25, 0.5, 0.75, 1.0); }');
        for (let i = 0; i < 2; i++) {
          window.AkariVgpu.frame(gpu, f => f.pass(output, shader));
          await gpu.gpu.queue.onSubmittedWorkDone();
          await gpu.settled();
          assertDevice();
        }
        sharedSampler = window.AkariVgpu.sampler(gpu, { minFilter: 'linear', magFilter: 'linear' });
        return { ok: true, adapter: { ...adapter }, ms: performance.now() - started };
      } catch (error) {
        initializationError = new Error(`VGPU-UNAVAILABLE: ${error.message ?? error}`);
        throw initializationError;
      } finally { output?.dispose(); }
    })();
    return probePromise;
  }
  function createInstance(container, descriptor) {
    let canvas = container.querySelector('canvas');
    const ownsCanvas = !canvas;
    if (!canvas) { canvas = document.createElement('canvas'); container.appendChild(canvas); }
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    const instance = { canvas, ownsCanvas, descriptor, passes: [], output: null, width: 0, height: 0, previewScale: 1, drawCount: 0 };
    instances.set(container, instance); // Also makes partially created resources disposable.
    instance.output = window.AkariVgpu.surface(gpu, canvas, {
      size: [1, 1], autoResize: false, dpr: 1, alphaMode: 'premultiplied', colorSpace: 'srgb',
    });
    if (descriptor.mode === 'stateful') {
      createStatefulInstance(instance);
      fallback(container, false);
      return instance;
    }
    for (const [index, pass] of descriptor.passes.entries()) {
      const inputs = pass.inputs.map((_, i) => `@group(1) @binding(${i}) var input_${i}: texture_2d<f32>;`).join('\n');
      const source = PRELUDE + inputs + (inputs ? '\n@group(1) @binding(8) var input_sampler: sampler;\n' : '') + pass.wgsl;
      const record = { ...pass, effect: window.AkariVgpu.effect(gpu, source), target: null,
        hasParams: /var\s*<\s*uniform\s*>\s*params\b/.test(pass.wgsl) };
      instance.passes.push(record);
      if (index !== descriptor.passes.length - 1) record.target = window.AkariVgpu.target(gpu, { size: [1, 1] });
    }
    fallback(container, false);
    return instance;
  }
  function statefulSource(descriptor, pass) {
    let source = PRELUDE + `struct AkariState { step: f32, dt: f32, pad: vec2f };
@group(0) @binding(2) var<uniform> akari_state: AkariState;
`;
    for (const [i, resource] of descriptor.state.entries()) {
      if (pass.reads.includes(resource.id)) source += resource.kind === 'buffer'
        ? `@group(1) @binding(${2 * i}) var<storage, read> ${resource.id}_in: array<f32>;\n`
        : `@group(1) @binding(${2 * i}) var ${resource.id}_in: texture_2d<f32>;\n`;
      if (pass.writes.includes(resource.id)) source += resource.kind === 'buffer'
        ? `@group(1) @binding(${2 * i + 1}) var<storage, read_write> ${resource.id}_out: array<f32>;\n`
        : `@group(1) @binding(${2 * i + 1}) var ${resource.id}_out: texture_storage_2d<${resource.format}, write>;\n`;
    }
    if (descriptor.state.some(resource => resource.kind === 'texture' && pass.reads.includes(resource.id))) {
      source += '@group(2) @binding(0) var state_sampler: sampler;\n';
    }
    return source + pass.wgsl;
  }
  function createStatefulInstance(instance) {
    const { descriptor } = instance;
    instance.currentStep = -1;
    instance.replaySteps = 0;
    instance.state = new Map();
    if (descriptor.state.some(resource => resource.kind === 'texture')) {
      throw new Error('VGPU-STATE-TEXTURE-UNSUPPORTED: vgpu 0.4.0 cannot bind storage textures; use kind:"buffer" state');
    }
    for (const resource of descriptor.state) {
      instance.state.set(resource.id, window.AkariVgpu.pingPongStorage(gpu, resource.bytes));
    }
    for (const pass of descriptor.passes) {
      const source = statefulSource(descriptor, pass);
      instance.passes.push({ ...pass,
        effect: pass.kind === 'fragment' ? window.AkariVgpu.effect(gpu, source) : window.AkariVgpu.compute(gpu, source),
        hasParams: /var\s*<\s*uniform\s*>\s*params\b/.test(pass.wgsl),
      });
    }
  }
  function renderStateful(instance, localTimeSeconds, fps, params, renderWidth, renderHeight) {
    const { descriptor, width, height, previewScale: scale } = instance;
    const dt = 1 / fps;
    const targetStep = Math.max(0, Math.round(localTimeSeconds * fps));
    function bind(pass, time, step) {
      const bindings = {
        akari: { time, aspect: width / height, width, height, seed: descriptor.seed,
          pad: pass.kind === 'fragment' ? [renderWidth, renderHeight, scale] : [width, height, 1] },
        akari_state: { step, dt, pad: [0, 0] },
      };
      if (pass.hasParams) bindings.params = params;
      for (const id of pass.reads) bindings[id + '_in'] = instance.state.get(id).read;
      for (const id of pass.writes) bindings[id + '_out'] = instance.state.get(id).write;
      pass.effect.set(bindings);
    }
    function dispatch(pass, time, step) {
      bind(pass, time, step);
      pass.effect.dispatch(...pass.dispatch);
      for (const id of pass.writes) instance.state.get(id).swap();
    }
    if (instance.currentStep < 0 || targetStep < instance.currentStep) {
      for (const resource of descriptor.state) {
        const pair = instance.state.get(resource.id);
        const zero = new Uint8Array(resource.bytes);
        pair.read.write(zero);
        pair.write.write(zero);
      }
      for (const pass of instance.passes) if (pass.kind === 'init') dispatch(pass, 0, 0);
      instance.currentStep = 0;
      instance.replaySteps++;
    }
    const steps = targetStep - instance.currentStep;
    if (steps > descriptor.maxReplaySteps) {
      throw new Error('VGPU-REPLAY-LIMIT: ' + steps + ' steps exceeds maxReplaySteps ' + descriptor.maxReplaySteps);
    }
    for (let n = instance.currentStep; n < targetStep; n++) {
      for (const pass of instance.passes) if (pass.kind === 'compute') dispatch(pass, n * dt, n);
      instance.currentStep = n + 1;
      instance.replaySteps++;
    }
    const display = instance.passes[instance.passes.length - 1];
    bind(display, localTimeSeconds, instance.currentStep);
    window.AkariVgpu.frame(gpu, f => f.pass(instance.output, display.effect));
  }
  function render(container, localTimeSeconds, options = {}) {
    assertDevice();
    if (failedContainers.has(container)) return;
    try {
      if (initializationError) throw initializationError;
      let instance = instances.get(container);
      const descriptor = instance?.descriptor ?? readDescriptor(container);
      if (!descriptor) return;
      if (descriptor.mode === 'stateful' && (!Number.isFinite(options.fps) || options.fps <= 0)) {
        throw new TypeError('vgpu fps is required for stateful scenes');
      }
      if (!gpu || !sharedSampler) { probe().catch(() => { failedContainers.add(container); fallback(container, true); }); return; }
      if (!Number.isFinite(localTimeSeconds)) throw new TypeError('vgpu time must be finite');
      const width = Math.max(0, Math.round(container.clientWidth)) || instance?.width;
      const height = Math.max(0, Math.round(container.clientHeight)) || instance?.height;
      if (!width || !height) return;
      let scale = options.previewScale === undefined ? 1 : options.previewScale;
      if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
        warnOnce('scale', '[akari-vgpu] invalid previewScale; using 1'); scale = 1;
      }
      instance ??= createInstance(container, descriptor);
      const renderWidth = Math.max(1, Math.round(width * scale));
      const renderHeight = Math.max(1, Math.round(height * scale));
      if (instance.width !== width || instance.height !== height || instance.previewScale !== scale) {
        instance.canvas.width = renderWidth; instance.canvas.height = renderHeight;
        instance.output.resize([renderWidth, renderHeight]);
        for (const pass of instance.passes) pass.target?.resize([
          Math.max(1, Math.round(renderWidth * pass.scale)), Math.max(1, Math.round(renderHeight * pass.scale)),
        ]);
        instance.width = width; instance.height = height; instance.previewScale = scale;
      }
      const params = { ...descriptor.uniforms };
      const style = getComputedStyle(container);
      for (const [key, value] of Object.entries(params)) {
        const raw = style.getPropertyValue('--vgpu-' + key).trim();
        if (!raw) continue;
        const numbers = raw.split(/[\s,]+/).map(Number);
        if (numbers.length === (Array.isArray(value) ? value.length : 1) && numbers.every(Number.isFinite)) {
          params[key] = Array.isArray(value) ? numbers : numbers[0];
        } else warnOnce('uniform:' + key, `[akari-vgpu] invalid --vgpu-${key}; using declaration`);
      }
      if (descriptor.mode === 'stateful') {
        renderStateful(instance, localTimeSeconds, options.fps, params, renderWidth, renderHeight);
        assertDevice();
        instance.drawCount++;
        return;
      }
      const targets = new Map(instance.passes.map(pass => [pass.id, pass.target]));
      for (const pass of instance.passes) {
        const size = pass.target?.size ?? [renderWidth, renderHeight];
        const bindings = { akari: { time: localTimeSeconds, aspect: width / height, width, height,
          seed: descriptor.seed, pad: [size[0], size[1], scale] } };
        if (pass.hasParams) bindings.params = params;
        for (const [i, id] of pass.inputs.entries()) bindings['input_' + i] = targets.get(id).color;
        if (pass.inputs.length) bindings.input_sampler = sharedSampler;
        pass.effect.set(bindings);
      }
      window.AkariVgpu.frame(gpu, f => {
        for (const pass of instance.passes) f.pass(pass.target ?? instance.output, pass.effect);
      });
      assertDevice();
      instance.drawCount++;
    } catch (error) {
      failedContainers.add(container);
      fallback(container, true);
      // Preview catches this; export must never encode a silently missing layer.
      if (error instanceof TypeError && error.message === 'vgpu fps is required for stateful scenes') throw error;
      throw /^VGPU-/.test(error.message) ? error : new Error(`VGPU-RENDER: ${error.message ?? error}`);
    }
  }
  function inspect(container) {
    const instance = instances.get(container);
    const status = deviceLost || gpuError || initializationError || failedContainers.has(container) ? 'error'
      : instance?.drawCount ? 'ready' : container.querySelector(SELECTOR) ? 'loading' : 'idle';
    return { status, adapter: { ...adapter }, passes: instance?.passes.length ?? 0,
      previewScale: instance?.previewScale ?? null, drawCount: instance?.drawCount ?? 0, deviceLost,
      stateful: instance?.descriptor.mode === 'stateful',
      step: instance?.currentStep >= 0 ? instance.currentStep : null, replaySteps: instance?.replaySteps ?? 0 };
  }
  function dispose(container) {
    const instance = instances.get(container);
    if (!instance) return;
    instance.output?.dispose();
    for (const pass of instance.passes) pass.target?.destroy();
    for (const pair of instance.state?.values() ?? []) {
      for (const buffer of [pair.read, pair.write]) if (typeof buffer.destroy === 'function') buffer.destroy();
    }
    if (instance.ownsCanvas) instance.canvas.remove();
    instances.delete(container);
  }
  return Object.freeze({ render, inspect, dispose, probe, readDescriptor });
})();

// Register with current hosts, or queue until a script-only host boots its registry.
(() => {
  const entry = { id: "vgpu", selector: 'script[type="application/json"][data-akari-vgpu-scene]',
    ...window.akari.vgpuRuntime };
  if (window.akari.runtimes) window.akari.runtimes.register(entry);
  else (window.akari.pendingRuntimes ??= []).push(entry);
})();
