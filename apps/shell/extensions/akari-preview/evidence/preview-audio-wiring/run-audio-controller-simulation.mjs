#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../../src/browser/akari-preview-open-handler.ts');
const records = [];

function record(step, data) {
  const entry = { at: new Date().toISOString(), step, ...data };
  records.push(entry);
  console.log(`[${step}]`, JSON.stringify(data));
}

function assert(condition, message, data = {}) {
  if (!condition) {
    record(`FAIL: ${message}`, data);
    throw new Error(message);
  }
}

function hostTemplate(source) {
  const start = source.indexOf('protected hostAdapterScript(): string {');
  const end = source.indexOf('protected previewBootstrapScript', start);
  const method = source.slice(start, end);
  const returnStart = method.indexOf('return `') + 'return `'.length;
  const returnEnd = method.lastIndexOf('`;');
  assert(start >= 0 && end > start && returnEnd > returnStart, 'hostAdapterScript template extraction failed');
  return method.slice(returnStart, returnEnd);
}

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener({ type });
  }
}

class FakeGain {
  constructor() {
    this.gain = { value: 1 };
  }

  connect() {}
  disconnect() {}
}

class FakeSource {
  constructor(context) {
    this.context = context;
    this.loop = false;
    this.onended = null;
  }

  connect() {}
  disconnect() {}

  start(when, offset = 0, duration) {
    this.context.starts.push({ when, offset, duration, loop: this.loop, bufferDuration: this.buffer.duration });
  }

  stop(when) {
    this.context.stops.push({ when });
  }
}

class FakeAudioContext {
  static instances = [];

  constructor() {
    this.state = 'suspended';
    this.currentTime = 10;
    this.destination = {};
    this.starts = [];
    this.stops = [];
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    return new FakeGain();
  }

  createBufferSource() {
    return new FakeSource(this);
  }

  async decodeAudioData(value) {
    return { duration: value.duration };
  }

  async resume() {
    this.state = 'running';
  }

  async close() {
    this.state = 'closed';
  }
}

function sandboxFor(summary) {
  const video = new FakeEventTarget();
  video.volume = 1;
  video.muted = false;
  video.paused = true;
  const wrapper = { clientWidth: 640 };
  const stage = { style: {} };
  const windowTarget = new FakeEventTarget();
  windowTarget.__akariPreview = { summary, editPath: 'fixture/edit.json' };
  windowTarget.akari = undefined;
  windowTarget.dispatchEvent = () => true;
  const warnings = [];
  const infos = [];
  const fakeConsole = {
    warn: (...values) => warnings.push(values.map(String).join(' ')),
    info: (...values) => infos.push(values),
    error: (...values) => warnings.push(values.map(String).join(' '))
  };
  const durations = new Map([
    ['bgm', 1.5],
    ['sfx-1', 0.3],
    ['n-0001', 2]
  ]);
  const sandbox = {
    window: windowTarget,
    document: {
      fullscreenElement: null,
      getElementById: id => ({ 'preview-video': video, 'preview-wrapper': wrapper, 'overlay-stage': stage }[id]),
      exitFullscreen: async () => undefined,
      documentElement: { requestFullscreen: async () => undefined }
    },
    acquireVsCodeApi: () => ({ postMessage: () => undefined }),
    ResizeObserver: class { observe() {} },
    AudioContext: FakeAudioContext,
    fetch: async src => {
      const id = src.includes('missing') ? 'missing' : src.split('/').pop().replace('.wav', '');
      const normalizedId = id === 'sfx' ? 'sfx-1' : id === 'narration' ? 'n-0001' : id;
      if (normalizedId === 'missing') return { ok: false, status: 404, arrayBuffer: async () => ({ duration: 0 }) };
      return { ok: true, status: 200, arrayBuffer: async () => ({ duration: durations.get(normalizedId) }) };
    },
    performance: { now: () => 0 },
    console: fakeConsole,
    Map,
    Promise,
    Number,
    Math,
    Array,
    Object,
    String,
    Error,
    Uint8Array,
    atob: value => value
  };
  windowTarget.window = windowTarget;
  return { sandbox, video, warnings, infos };
}

async function main() {
  const source = await readFile(sourcePath, 'utf8');
  const script = hostTemplate(source);
  const summary = {
    output: { width: 320, height: 180, fps: 30 },
    overlays: [],
    cuts: [{ in: 0, out: 6 }],
    audio: {
      bgm: { id: 'bgm', src: 'fixture/audio/bgm.wav', gainDb: -18, ducking: true },
      sfx: [
        { id: 'sfx-1', src: 'fixture/audio/sfx.wav', t: 1, gainDb: -6 },
        { id: 'sfx-missing', src: 'fixture/audio/missing.wav', t: 3.5, gainDb: 0 }
      ],
      narration: [{ id: 'n-0001', src: 'fixture/audio/narration.wav', t: 2, gainDb: 0 }]
    }
  };
  FakeAudioContext.instances = [];
  const run = sandboxFor(summary);
  vm.runInNewContext(script, run.sandbox, { filename: 'hostAdapterScript.generated.js' });
  const controller = run.sandbox.window.akari.previewAudio;
  await controller.setTimelineDuration(6);
  const decoded = controller.debugState();
  record('simulated-audio-decoded', decoded);
  assert(decoded.decoded.bgm && decoded.decoded.sfx.length === 1 && decoded.decoded.narration.length === 1,
    'individual decode degradation failed', { decoded, warnings: run.warnings });
  assert(run.warnings.some(message => message.includes('sfx-missing') && message.includes('fetch/decode failed')),
    'missing file warning was not emitted', { warnings: run.warnings });

  run.video.paused = false;
  await controller.playFrom(0);
  const scheduled = controller.debugState();
  record('simulated-audio-scheduled', {
    ...scheduled,
    starts: FakeAudioContext.instances[0].starts
  });
  assert(scheduled.contextState === 'running', 'AudioContext resume did not run', scheduled);
  assert(scheduled.active.bgm === 1 && scheduled.active.sfx === 1 && scheduled.active.narration === 1,
    'BGM/SFX/narration were not all scheduled', scheduled);
  assert(scheduled.duckGainDb === 0, 'BGM was ducked outside narration', scheduled);

  controller.tick(2.2, true);
  const ducked = controller.debugState();
  const expectedLinear = Math.pow(10, (-18 - 12) / 20);
  record('simulated-bgm-ducked', { ...ducked, expectedLinear });
  assert(ducked.duckGainDb === -12, 'narration interval did not apply fixed -12dB', ducked);
  assert(Math.abs(ducked.bgmGainLinear - expectedLinear) < 0.00001,
    'ducked BGM linear gain is incorrect', { ducked, expectedLinear });

  run.video.volume = 0.4;
  controller.tick(2.3, true);
  const volumeGain = controller.debugState().masterGainLinear;
  run.video.muted = true;
  controller.tick(2.4, true);
  const mutedGain = controller.debugState().masterGainLinear;
  record('simulated-master-gain-mirror', { volumeGain, mutedGain });
  assert(Math.abs(volumeGain - 0.4) < 0.0001 && mutedGain === 0,
    'video volume/mute mirror is incorrect', { volumeGain, mutedGain });
  controller.pause();

  const contextsBeforeNoAudio = FakeAudioContext.instances.length;
  const noAudio = sandboxFor({ output: { width: 320, height: 180, fps: 30 }, overlays: [], cuts: [] });
  vm.runInNewContext(script, noAudio.sandbox, { filename: 'hostAdapterScript.no-audio.generated.js' });
  const noAudioState = noAudio.sandbox.window.akari.previewAudioDebug();
  record('simulated-no-audio-regression', {
    state: noAudioState,
    contextsBeforeNoAudio,
    contextsAfterNoAudio: FakeAudioContext.instances.length
  });
  assert(noAudioState.disabled === true && FakeAudioContext.instances.length === contextsBeforeNoAudio,
    'audio-less preview created or changed supplemental audio state', noAudioState);

  record('ALL-PASS', {
    source: 'hostAdapterScript extracted from edited TypeScript',
    decoded: { bgm: 1, sfx: 1, narration: 1 },
    duckGainDb: ducked.duckGainDb,
    missingFileSkipped: true,
    noAudioContextForAudioLessProject: true
  });
  await writeFile(path.join(here, 'simulation-run-log.json'), JSON.stringify({ records, warnings: run.warnings }, null, 2));
}

main().catch(async error => {
  console.error(error);
  await writeFile(path.join(here, 'simulation-run-log.json'), JSON.stringify({ records, error: String(error) }, null, 2)).catch(() => undefined);
  process.exitCode = 1;
});
