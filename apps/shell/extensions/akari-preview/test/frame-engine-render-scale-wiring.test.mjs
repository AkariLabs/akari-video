import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parseRenderScaleMode, resolveRenderScale, scaledOutputSize, scaleEvaluationPlan } from '../lib/common/frame-engine-render-scale.js';

const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
const frontend = readFileSync(new URL('../lib/browser/akari-preview-frontend-module.js', import.meta.url), 'utf8');
const bootstrap = compiled.slice(compiled.lastIndexOf('frameEngineBootstrapScript()'));

test('host gives the environment priority, parses invalid values and passes the mode to initial state', () => {
  for (const token of ['frameEngineRenderScaleMode', 'AKARI_FRAME_ENGINE_RENDER_SCALE', 'akari.preview.renderScale']) {
    assert.ok(compiled.includes(token), token);
  }
  assert.match(compiled, /parseRenderScaleMode\)\(frameEngineRenderScaleOverride\s*\?\? this.preferences.get\('akari.preview.renderScale', 'auto'\)\)/u);
  assert.match(compiled, /widget.akariPreviewPlaybackRate \?\? 1,\s*frameEngineRenderScaleMode/u);
  assert.match(compiled, /initialPlaybackRate = 1, frameEngineRenderScaleMode = 'auto'/u);
  assert.match(compiled, /frameEngineSourceMode,\s*frameEngineRenderScaleMode,\s*frameEngineForceSoftware,/u);
  assert.match(frontend, /'akari.preview.renderScale':\s*\{\s*type: 'string',\s*enum: \['auto', '1', '0.5', '0.25'\],\s*default: 'auto'/u);
  assert.match(frontend, /プレビュー専用。書き出しと画像の位置・大きさには影響しません/u);
});

test('webview injects all four compiled pure functions and shares one renderOutput', () => {
  for (const name of ['parseRenderScaleMode', 'resolveRenderScale', 'scaledOutputSize', 'scaleEvaluationPlan']) {
    assert.ok(bootstrap.includes(`${name}.toString()`), name);
  }
  assert.match(bootstrap, /parseRenderScaleModeFn\(initial.frameEngineRenderScaleMode\)/u);
  assert.equal([...bootstrap.matchAll(/const renderOutput = \{ \.\.\.output \}/gu)].length, 1);
  assert.match(bootstrap, /createPreviewScheduler\(\{\s*timeline: value,\s*sources,\s*output: renderOutput,/u);
  assert.match(bootstrap, /evaluationPlanFromResolvedTimeline\(timeline, timeUs, sources, renderOutput\)/u);
  assert.match(bootstrap, /baseCompositor.compose\(bandBase, bandLayers, renderOutput,/u);
  assert.match(bootstrap, /upperCompositor.compose\(bandBase, bandLayers, renderOutput,/u);
  assert.match(bootstrap, /renderOutput.width = size.width;\s*renderOutput.height = size.height/u);
  const apply = bootstrap.slice(bootstrap.indexOf('const applyRenderScale ='), bootstrap.indexOf('applyRenderScale(autoRenderScale);'));
  assert.doesNotMatch(apply, /createPreviewScheduler|createSchedulerForTimeline|dispose\(/u);
  assert.match(apply, /scaledOutputSizeFn\(output, scale\)/u);
  assert.match(apply, /appliedRenderScale = scale;/u);
  assert.match(bootstrap, /const resolvedPlan = engine.evaluationPlanFromResolvedTimeline\(timeline, timeUs, sources, renderOutput\);[\s\S]*?const plan = scaleEvaluationPlanFn\(resolvedPlan, appliedRenderScale\);[\s\S]*?frame = await engine.evaluateFrame\(plan,/u);
  assert.match(bootstrap, /if \(reason === 'seek' && !scaleOnly\)/u);
});

test('auto observes canvas and DPR changes, cleans up, and uses one timer for resize and idle', () => {
  for (const token of ['getBoundingClientRect()', 'ResizeObserver', 'renderScaleObserver.observe(canvas)',
    "window.matchMedia('(resolution: ' + dpr + 'dppx)')", "addEventListener('change', onRenderScaleDprChange)",
    "removeEventListener('change', onRenderScaleDprChange)", 'renderScaleObserver.disconnect()',
    'resizeScaleAt = performance.now() + 100', "reason === 'seek' && !playing ? performance.now() + 250 : null",
    "noteRenderScaleActivity(playing ? 'playback' : 'seek')", 'if (!scaleOnly)',
  ]) assert.ok(bootstrap.includes(token), token);
  assert.equal([...bootstrap.matchAll(/renderScaleTimer = setTimeout\(/gu)].length, 1);
  assert.match(bootstrap, /await waitForRender\(\);\s*if \(runtimeUpdating\) await modelUpdateTail;\s*if \(disposed \|\| revision !== renderScaleRevision\) return/u);
  assert.match(bootstrap, /applyRenderScale\(renderScaleSettled \? 1 : autoRenderScale\)/u);
  assert.match(bootstrap, /if \(!playing && \(changed \|\| idleRedraw\)\) \{\s*const operation = renderFrame\(position, 'seek', performance.now\(\), true\)/u);
  assert.match(bootstrap, /if \(renderScaleMode !== 'auto'\) return/u);
});

test('developer metrics add exactly one render scale line with both dimensions and the mode', () => {
  assert.match(compiled, /this.preferences.get\('akari.developerMode', false\)/u);
  assert.match(bootstrap, /metrics.hidden = initial.frameEngineMetricsEnabled !== true/u);
  assert.equal([...bootstrap.matchAll(/'render scale        ' \+ renderScaleDescription/gu)].length, 1);
  assert.match(bootstrap, /scale \+ ' \(' \+ size.width \+ 'x' \+ size.height/u);
  assert.match(bootstrap, /' of ' \+ output.width \+ 'x' \+ output.height \+ ', ' \+ renderScaleMode \+ '\)'/u);
});

// Exercise the compiled helpers with a fake clock, as in source-selection.test.mjs.
function scaleHarness(mode = 'auto') {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const listeners = new Map();
  const queries = [];
  const plans = [];
  const output = { width: 2160, height: 2160, colorSpace: 'bt709-limited', look: {} };
  const rect = { width: 900, height: 900 };
  let resize;
  let disconnected = false;
  const context = vm.createContext({
    initial: { frameEngineRenderScaleMode: mode }, output, renderScaleDescription: '',
    parseRenderScaleModeFn: parseRenderScaleMode,
    resolveRenderScaleFn: resolveRenderScale,
    scaledOutputSizeFn: scaledOutputSize,
    scaleEvaluationPlanFn: scaleEvaluationPlan,
    canvas: { getBoundingClientRect: () => rect },
    window: {
      devicePixelRatio: 1,
      matchMedia: query => {
        const entry = { query, callback: null,
          addEventListener: (_, callback) => { entry.callback = callback; },
          removeEventListener: (_, callback) => { if (entry.callback === callback) entry.callback = null; },
        };
        queries.push(entry);
        return entry;
      },
      addEventListener: (name, callback) => listeners.set(name, callback),
    },
    ResizeObserver: class {
      constructor(callback) { resize = callback; }
      observe(canvas) { assert.equal(canvas, context.canvas); }
      disconnect() { disconnected = true; }
    },
    performance: { now: () => now },
    setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, at: now + delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    disposed: false, rendering: null, runtimeUpdating: false, modelUpdateTail: Promise.resolve(),
    position: 5, playing: false, totalDuration: 20, fps: 30, timeline: {}, sources: new Map(),
    compositor: {}, frameMetrics: {}, currentAccesses: null, lastCutIndex: null, lastPresentedSec: 0,
    measurements: { lateFrames: 0, seekLatestMs: null, seekBeforeMs: [], seekAfterMs: [], presentedAt: [] },
    scheduler: { notePresented() {} }, audioSupply: { noteRendered() {} },
    engine: {
      evaluationPlanFromResolvedTimeline: (_, timeUs, __, renderOutput) => ({ timeUs, base: [], layers: [], output: renderOutput }),
      evaluateFrame: async plan => { plans.push({ output: plan.output, width: plan.output.width, timeUs: plan.timeUs }); },
    },
    updateMetrics() {}, showError: reason => { throw reason; }, error: {},
  });
  function section(start, end) {
    const from = bootstrap.indexOf(start);
    const to = bootstrap.indexOf(end, from);
    assert.ok(from >= 0 && to > from, start);
    return bootstrap.slice(from, to);
  }
  const api = vm.runInContext([
    section('const renderScaleMode =', '// 可視 canvas'),
    section('const waitForRender =', 'scrub = new engine.ScrubController'),
    section('const scheduleRenderScaleResize =', '// 非同期 mount'),
    '({ renderFrame, noteRenderScaleActivity, renderOutput })',
  ].join('\n'), context);
  return {
    context, api, plans, output, timers, queries,
    get disconnected() { return disconnected; },
    resize(width, height = width) { Object.assign(rect, { width, height }); resize(); },
    unload() { context.disposed = true; listeners.get('beforeunload')(); },
    async draw(reason = 'seek') {
      const operation = api.renderFrame(context.position, reason);
      context.rendering = operation;
      try { await operation; }
      finally { if (context.rendering === operation) context.rendering = null; }
    },
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now && timers.delete(id)) timer.callback();
      }
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(timers.size <= 1, 'only one scale timeout may be pending');
    },
  };
}

test('auto restores full resolution once after 250 ms and resumes reduced playback/scrubbing', async () => {
  const harness = scaleHarness();
  const { api, plans, context } = harness;
  await harness.draw();
  assert.equal(api.renderOutput.width, 1080);
  await harness.advance(249);
  assert.equal(plans.length, 1);
  await harness.advance(1);
  assert.equal(api.renderOutput.width, 2160);
  assert.equal(plans.length, 2);
  assert.equal(plans[1].timeUs, 5_000_000);
  await harness.advance(1000);
  assert.equal(plans.length, 2, 'idle redraw must not schedule itself');
  context.playing = true;
  await harness.draw('playback');
  assert.equal(api.renderOutput.width, 1080);
  context.playing = false;
  api.noteRenderScaleActivity('seek');
  await harness.advance(250);
  assert.equal(api.renderOutput.width, 2160);
  await harness.draw('seek');
  assert.equal(api.renderOutput.width, 1080);
  await harness.advance(200);
  await harness.draw('seek');
  await harness.advance(100);
  assert.equal(api.renderOutput.width, 1080, 'continued scrub postpones full resolution');
  await harness.advance(150);
  assert.equal(api.renderOutput.width, 2160);
  assert.ok(plans.every(plan => plan.output === api.renderOutput));
  assert.equal(api.renderOutput.look, harness.output.look);
  assert.equal(harness.output.width, 2160);
});

test('resize and DPR changes debounce for 100 ms, retain the idle deadline and clean up', async () => {
  const harness = scaleHarness();
  await harness.draw();
  harness.resize(500);
  await harness.advance(99);
  assert.equal(harness.api.renderOutput.width, 1080);
  await harness.advance(1);
  assert.equal(harness.api.renderOutput.width, 540);
  assert.equal(harness.plans.length, 2, 'paused resize redraws immediately');
  harness.context.window.devicePixelRatio = 2;
  harness.queries[0].callback();
  assert.equal(harness.queries[0].callback, null);
  assert.equal(harness.queries[1].query, '(resolution: 2dppx)');
  await harness.advance(100);
  assert.equal(harness.api.renderOutput.width, 1080);
  await harness.advance(50);
  assert.equal(harness.api.renderOutput.width, 2160, 'resize must not postpone idle restoration');
  harness.resize(900);
  await harness.advance(100);
  assert.equal(harness.api.renderOutput.width, 2160, 'settled auto stays full resolution');
  harness.resize(500);
  harness.unload();
  assert.equal(harness.timers.size, 0);
  assert.equal(harness.disconnected, true);
  assert.equal(harness.queries.at(-1).callback, null);
});

test('manual modes never restore full resolution or react to display changes', async () => {
  for (const mode of [1, 0.5, 0.25]) {
    const harness = scaleHarness(mode);
    await harness.draw();
    harness.resize(500);
    harness.api.noteRenderScaleActivity('seek');
    await harness.advance(1000);
    assert.equal(harness.api.renderOutput.width, 2160 * mode);
    assert.equal(harness.plans.length, 1);
    assert.equal(harness.queries.length, 0);
    assert.equal(harness.timers.size, 0);
  }
});

test('a pending idle resize cannot mutate an in-flight frame and is cancelled by playback resuming', async () => {
  const harness = scaleHarness();
  let finish;
  harness.context.engine.evaluateFrame = () => new Promise(resolve => { finish = resolve; });
  const drawing = harness.draw();
  await harness.advance(250);
  assert.equal(harness.api.renderOutput.width, 1080);
  harness.context.playing = true;
  harness.api.noteRenderScaleActivity('playback');
  finish();
  await drawing;
  await harness.advance(1);
  assert.equal(harness.api.renderOutput.width, 1080);
  assert.equal(harness.timers.size, 0);
});

test('renderFrame projects with the applied scale, restores full geometry and leaves seek metrics intact on scale-only redraw', async () => {
  const harness = scaleHarness();
  const observed = [];
  const visual = { transform: { x: 160, y: -80, scale: 0.45, rotateDegrees: 0 } };
  harness.context.engine.evaluationPlanFromResolvedTimeline = (_, timeUs, __, output) => ({
    timeUs, base: [], layers: [{ kind: 'video', visual }], output,
  });
  harness.context.engine.evaluateFrame = async plan => { observed.push(plan); };
  await harness.draw();
  assert.equal(observed[0].layers[0].visual.transform.scale, 0.225);
  const metrics = harness.context.measurements;
  const seekSnapshot = { latest: metrics.seekLatestMs, before: [...metrics.seekBeforeMs], after: [...metrics.seekAfterMs] };
  await harness.advance(250);
  assert.equal(observed[1].layers[0].visual, visual);
  assert.equal(metrics.seekLatestMs, seekSnapshot.latest);
  assert.deepEqual(metrics.seekBeforeMs, seekSnapshot.before);
  assert.deepEqual(metrics.seekAfterMs, seekSnapshot.after);
  harness.context.playing = true;
  await harness.draw('playback');
  assert.equal(observed[2].layers[0].visual.transform.scale, 0.225);
  assert.ok(observed.every(plan => plan.output === harness.api.renderOutput));
  assert.equal(visual.transform.scale, 0.45);
});
