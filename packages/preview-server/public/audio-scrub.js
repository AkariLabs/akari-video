import { fetchRange, Mp4AudioTrack } from './mp4-audio-track.js';

export const SCRUB_MODES = ['off', 'on'];

const FADE_SECONDS = 0.005;
const SCHEDULE_LOOKAHEAD_SECONDS = 0.005;
const WINDOW_CACHE_SIZE = 8;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function resolveBgmOffset(outputTime, spec, duration) {
  let offset = (Number(spec?.in) || 0) + (outputTime - (Number(spec?.t) || 0));
  if (spec?.loop !== false && duration > 0) offset = ((offset % duration) + duration) % duration;
  return offset >= 0 && offset < duration ? offset : null;
}

export function createScrubAudioController(deps) {
  const audioContext = deps.audioContext;
  const video = deps.video;
  const getBgm = deps.getBgm;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => globalThis.performance.now());
  const AudioDecoderCtor = deps.AudioDecoderCtor ?? globalThis.AudioDecoder;
  const EncodedAudioChunkCtor = deps.EncodedAudioChunkCtor ?? globalThis.EncodedAudioChunk;
  const setTimeoutFn = deps.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? globalThis.clearTimeout;
  const idleSuspendMs = deps.idleSuspendMs ?? 30000;
  let isEnabled = deps.enabled ?? true;
  let fragmentMs = deps.fragmentMs ?? 40;
  let generation = 0;
  let mainActive = null;
  let bgmActive = null;
  let idleTimer = null;
  let lastError = null;
  const tracks = new Map();
  const decoders = new Map();
  const cache = new Map();

  function holdParamAt(param, at, valueAt) {
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at);
    else param.cancelScheduledValues?.(at);
    // ramp の開始点を明示し、audio thread へ届くまでに値が飛ぶのを防ぐ。
    param.setValueAtTime?.(valueAt ?? param.value, at);
  }

  function bufferGainAt(active, at) {
    if (at < active.startAt || at >= active.endAt) return 0;
    if (at < active.fadeInEnd) {
      return active.peak * (at - active.startAt) / (active.fadeInEnd - active.startAt);
    }
    if (at < active.fadeOutStart) return active.peak;
    return active.peak * (active.endAt - at) / (active.endAt - active.fadeOutStart);
  }

  function fadeAndStop(active) {
    if (!active) return;
    const at = audioContext.currentTime + SCHEDULE_LOOKAHEAD_SECONDS;
    if (at >= active.fadeOutStart) return;
    const param = active.gain.gain;
    if (at <= active.startAt) {
      param.cancelScheduledValues?.(0);
      param.setValueAtTime?.(0, 0);
      try { active.source.stop(active.startAt); } catch { /* already stopped */ }
      return;
    }
    holdParamAt(param, at, bufferGainAt(active, at));
    param.linearRampToValueAtTime?.(0, at + FADE_SECONDS);
    try { active.source.stop(at + FADE_SECONDS); } catch { /* already stopped */ }
  }

  function stopFragments(invalidate = true) {
    if (invalidate) generation++;
    fadeAndStop(mainActive);
    fadeAndStop(bgmActive);
    mainActive = null;
    bgmActive = null;
  }

  function clearIdleTimer() {
    if (idleTimer !== null) clearTimeoutFn(idleTimer);
    idleTimer = null;
  }

  function armIdleTimer() {
    clearIdleTimer();
    idleTimer = setTimeoutFn(() => {
      idleTimer = null;
      if (isEnabled && audioContext.state === 'running') {
        Promise.resolve(audioContext.suspend()).catch(() => {});
      }
    }, idleSuspendMs);
  }

  function startBuffer(buffer, target, destination, peak, kind) {
    const offset = Math.max(0, target);
    const duration = Math.min(fragmentMs / 1000, Math.max(0, buffer.duration - offset));
    if (!(duration > 0)) return false;
    const fade = Math.min(FADE_SECONDS, duration / 2);
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    // start(when) が when の直前フレームへ切り下げられても、automation 前の
    // AudioParam 既定値 1 を 1 サンプルだけ通さない。
    gain.gain.value = 0;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(destination);
    const at = audioContext.currentTime + SCHEDULE_LOOKAHEAD_SECONDS;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + fade);
    gain.gain.setValueAtTime(peak, at + duration - fade);
    gain.gain.linearRampToValueAtTime(0, at + duration);
    source.start(at, offset, duration);
    const active = {
      source,
      gain,
      peak,
      startAt: at,
      fadeInEnd: at + fade,
      fadeOutStart: at + duration - fade,
      endAt: at + duration,
    };
    if (kind === 'bgm') bgmActive = active;
    else mainActive = active;
    return true;
  }

  function startBgm(outputTime) {
    const { node, spec } = getBgm?.() ?? {};
    const buffer = node?._buffer;
    if (!buffer || !spec) return;
    const offset = resolveBgmOffset(outputTime, spec, buffer.duration);
    if (offset !== null) startBuffer(buffer, offset, node, 1, 'bgm');
  }

  function entryFor(src) {
    let entry = tracks.get(src);
    if (entry) return entry;
    const track = new Mp4AudioTrack({ src, fetchFn, now });
    entry = { track, ready: false, failed: false, supportPromise: null, supported: null };
    tracks.set(src, entry);
    entry.openPromise = track.open().then(() => {
      entry.ready = true;
    }, (error) => {
      entry.failed = true;
      lastError = errorMessage(error);
    });
    return entry;
  }

  async function prepare(srcs) {
    const values = Array.isArray(srcs) ? srcs : [srcs];
    const pending = [];
    for (const value of values) {
      if (typeof value !== 'string' || !value || tracks.has(value)) continue;
      pending.push(entryFor(value).openPromise);
    }
    await Promise.all(pending);
  }

  async function supports(entry) {
    if (entry.supported !== null) return entry.supported;
    if (entry.supportPromise) return entry.supportPromise;
    entry.supportPromise = (async () => {
      const config = entry.track.decoderConfig();
      if (!entry.track.info.supported) return false;
      if (!AudioDecoderCtor || !EncodedAudioChunkCtor) {
        throw new Error('WebCodecs audio decoder unavailable');
      }
      if (typeof AudioDecoderCtor.isConfigSupported !== 'function') return true;
      const result = await AudioDecoderCtor.isConfigSupported(config);
      return Boolean(result?.supported);
    })().then((supported) => {
      entry.supported = supported;
      if (!supported) lastError = `unsupported audio codec: ${entry.track.info.codec}`;
      return supported;
    }, (error) => {
      entry.supported = false;
      lastError = errorMessage(error);
      return false;
    });
    return entry.supportPromise;
  }

  async function decoderFor(src, config, outputs) {
    let holder = decoders.get(src);
    if (holder?.busy) {
      try { holder.decoder.close(); } catch { /* superseded decode */ }
      decoders.delete(src);
      holder = null;
    }
    if (!holder || holder.decoder.state === 'closed') {
      holder = { decoder: null, outputs, busy: false, error: null };
      holder.decoder = new AudioDecoderCtor({
        output(data) { holder.outputs.push(data); },
        error(error) { holder.error = error; },
      });
      holder.decoder.configure(config);
      decoders.set(src, holder);
    }
    holder.outputs = outputs;
    holder.error = null;
    holder.busy = true;
    return holder;
  }

  async function decodeWindow(track, window) {
    const key = `${track.src}|${window.packets[0].index}-${window.packets.at(-1).index}`;
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const fetched = await Promise.all(window.ranges.map(async (range) => {
      const result = await fetchRange(fetchFn, track.src, range.start, range.end);
      return { ...range, bytes: result.bytes };
    }));
    const outputs = [];
    const holder = await decoderFor(track.src, track.decoderConfig(), outputs);
    try {
      for (const packet of window.packets) {
        const range = fetched.find(item => (
          packet.offset >= item.start && packet.offset + packet.size - 1 <= item.end
        ));
        if (!range) throw new Error('audio packet bytes are missing');
        const at = packet.offset - range.start;
        holder.decoder.decode(new EncodedAudioChunkCtor({
          type: 'key',
          timestamp: Math.round(packet.dts / track.info.timescale * 1e6),
          duration: Math.round(packet.duration / track.info.timescale * 1e6),
          data: range.bytes.slice(at, at + packet.size),
        }));
      }
      await holder.decoder.flush();
    } catch (error) {
      if (decoders.get(track.src) === holder) decoders.delete(track.src);
      for (const data of outputs) try { data.close(); } catch { /* partial decode cleanup */ }
      throw error;
    } finally {
      holder.busy = false;
    }
    if (holder.error) throw holder.error;
    outputs.sort((left, right) => left.timestamp - right.timestamp);
    if (!outputs.length) throw new Error('AudioDecoder produced no output');
    const channels = outputs[0].numberOfChannels;
    const sampleRate = outputs[0].sampleRate;
    const frames = outputs.reduce((sum, data) => sum + data.numberOfFrames, 0);
    const firstOutputTimestamp = outputs[0].timestamp;
    const buffer = audioContext.createBuffer(channels, frames, sampleRate);
    let frameOffset = 0;
    for (const data of outputs) {
      for (let plane = 0; plane < channels; plane++) {
        const values = new Float32Array(data.numberOfFrames);
        data.copyTo(values, { planeIndex: plane, format: 'f32-planar' });
        buffer.getChannelData(plane).set(values, frameOffset);
      }
      frameOffset += data.numberOfFrames;
      data.close();
    }
    const outputTick = Math.round(firstOutputTimestamp / 1e6 * track.info.timescale);
    const rawStartTick = Number.isFinite(outputTick)
      && outputTick >= window.rawStartTick && outputTick < window.rawEndTick
      ? outputTick : window.rawStartTick;
    const startSec = (rawStartTick - track.info.editOffsetTicks) / track.info.timescale;
    const item = { src: track.src, buffer, startSec, endSec: startSec + buffer.duration };
    cache.set(key, item);
    while (cache.size > WINDOW_CACHE_SIZE) cache.delete(cache.keys().next().value);
    return item;
  }

  function cachedWindow(src, sourceTime) {
    for (const [key, item] of cache) {
      if (item.src === src
        && item.startSec <= sourceTime
        && sourceTime + fragmentMs / 1000 <= item.endSec + 1e-6) {
        cache.delete(key);
        cache.set(key, item);
        return item;
      }
    }
    return null;
  }

  async function runSeek(input, token, entry) {
    if (!(await supports(entry)) || token !== generation) return;
    let item = cachedWindow(input.src, input.sourceTime);
    if (!item) {
      const window = entry.track.packetsAround(input.sourceTime);
      if (!window.packets.length) return;
      item = await decodeWindow(entry.track, window);
    }
    if (token !== generation) return;
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (token !== generation) return;
    if (video.muted === true || !(video.volume > 0)) { armIdleTimer(); return; }
    lastError = null;
    startBgm(input.outputTime);
    startBuffer(item.buffer, input.sourceTime - item.startSec, audioContext.destination, video.volume, 'main');
    armIdleTimer();
  }

  function onSeek(input) {
    if (!isEnabled) return;
    stopFragments();
    const token = generation;
    if (input.isPlaying) { clearIdleTimer(); return; }
    if (video.muted === true || !(video.volume > 0)) { armIdleTimer(); return; }
    armIdleTimer();
    const existing = tracks.get(input.src);
    if (!existing) { void prepare(input.src); return; }
    if (!existing.ready || existing.failed) return;
    void runSeek(input, token, existing).catch((error) => {
      if (token === generation) lastError = errorMessage(error);
    });
  }

  function stop() {
    stopFragments();
    clearIdleTimer();
  }

  function onPlaybackPaused() {
    if (isEnabled) armIdleTimer();
  }

  const controller = {
    get enabled() { return isEnabled; },
    set enabled(value) {
      const next = Boolean(value);
      if (next === isEnabled) return;
      isEnabled = next;
      if (!next) stop();
    },
    get mode() { return isEnabled ? 'on' : 'off'; },
    set mode(value) {
      if (!SCRUB_MODES.includes(value)) throw new TypeError(`invalid scrub audio mode: ${value}`);
      this.enabled = value === 'on';
    },
    get active() { return isEnabled; },
    get lastError() { return lastError; },
    get fragmentMs() { return fragmentMs; },
    set fragmentMs(value) { fragmentMs = value; },
    get context() { return audioContext; },
    onSeek,
    stop,
    onPlaybackPaused,
    prepare,
  };
  return controller;
}
