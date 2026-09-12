import { fetchRange, Mp4AudioTrack } from './mp4-audio-track.js';

export const SCRUB_MODES = ['off', 'on'];

export const SCRUB_TUNING = Object.freeze({
  maxCacheBytes: 8 * 1024 * 1024,
  minWindowSec: 0.15,
  maxWindowSec: 0.30,
  maxRangesPerWindow: 12,
  maxRangeGapBytes: 1024,
  leadSec: 0.05,
  minFragmentIntervalMs: 70,
  fastSpeedEnterRatio: 25,
  fastSpeedExitRatio: 18,
  velocitySamples: 5,
  timingEwmaAlpha: 0.3,
});

const FADE_SECONDS = 0.005;
const SCHEDULE_LOOKAHEAD_SECONDS = 0.005;

class SupersededError extends Error {
  constructor() {
    super('scrub request superseded');
    this.name = 'AbortError';
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

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
  const requestedCacheBytes = deps.maxCacheBytes
    ?? deps.tuning?.maxCacheBytes
    ?? SCRUB_TUNING.maxCacheBytes;
  const tuning = Object.freeze({
    ...SCRUB_TUNING,
    ...(deps.tuning ?? {}),
    maxCacheBytes: clamp(Number(requestedCacheBytes) || 0, 0, SCRUB_TUNING.maxCacheBytes),
  });
  const AbortControllerCtor = deps.AbortControllerCtor ?? globalThis.AbortController;
  let isEnabled = deps.enabled ?? true;
  let fragmentMs = deps.fragmentMs ?? 40;
  let generation = 0;
  let prefetchGeneration = 0;
  let mainActive = null;
  let bgmActive = null;
  let idleTimer = null;
  let fragmentTimer = null;
  let pendingInput = null;
  let seekState = null;
  let prefetchState = null;
  let inFlightFetches = 0;
  let cacheBytes = 0;
  let velocityHistory = [];
  let velocity = 0;
  let direction = 0;
  let fastMode = false;
  let seekIntervalEwmaSec = tuning.leadSec;
  let lastSeekWallMs = null;
  let deliveryEwmaMs = null;
  let lastFragmentStartedAtMs = -Infinity;
  let lastStartedSourceTime = null;
  let lastWindowRanges = 0;
  let lastWindowSec = 0;
  let throttledSeeks = 0;
  let coalescedSeeks = 0;
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

  function abortController(controller) {
    try { controller?.abort(); } catch { /* optional AbortController implementation */ }
  }

  function cancelSeekFetch() {
    abortController(seekState?.controller);
    seekState = null;
  }

  function cancelPrefetch() {
    prefetchGeneration++;
    abortController(prefetchState?.controller);
    prefetchState = null;
  }

  function invalidateSeek() {
    generation++;
    cancelSeekFetch();
  }

  function stopFragments(invalidate = true) {
    if (invalidate) invalidateSeek();
    fadeAndStop(mainActive);
    fadeAndStop(bgmActive);
    mainActive = null;
    bgmActive = null;
  }

  function clearFragmentTimer() {
    if (fragmentTimer !== null) clearTimeoutFn(fragmentTimer);
    fragmentTimer = null;
    pendingInput = null;
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

  function updateVelocity(input, wallMs) {
    if (velocityHistory.at(-1)?.src !== input.src) {
      velocityHistory = [];
      velocity = 0;
      direction = 0;
      fastMode = false;
      seekIntervalEwmaSec = tuning.leadSec;
      lastSeekWallMs = null;
      cancelPrefetch();
    }
    if (lastSeekWallMs !== null) {
      const intervalSec = (wallMs - lastSeekWallMs) / 1000;
      if (intervalSec > 0 && intervalSec <= 0.5) {
        seekIntervalEwmaSec += tuning.timingEwmaAlpha * (intervalSec - seekIntervalEwmaSec);
      }
    }
    lastSeekWallMs = wallMs;
    const previous = velocityHistory.at(-1);
    const instantDirection = previous ? Math.sign(input.sourceTime - previous.sourceTime) : 0;
    if (direction !== 0 && instantDirection !== 0 && instantDirection !== direction) {
      cancelPrefetch();
      velocityHistory = previous ? [previous] : [];
    }
    if (instantDirection !== 0) direction = instantDirection;
    velocityHistory.push({ src: input.src, sourceTime: input.sourceTime, wallMs });
    if (velocityHistory.length > tuning.velocitySamples) velocityHistory.shift();
    const oldest = velocityHistory[0];
    const latest = velocityHistory.at(-1);
    const elapsedSec = (latest.wallMs - oldest.wallMs) / 1000;
    const nextVelocity = velocityHistory.length >= 2 && elapsedSec > 1e-6
      ? (latest.sourceTime - oldest.sourceTime) / elapsedSec : 0;
    velocity = nextVelocity;
    const speed = Math.abs(velocity);
    if (!fastMode && speed >= tuning.fastSpeedEnterRatio) fastMode = true;
    else if (fastMode && speed <= tuning.fastSpeedExitRatio) fastMode = false;
    return velocity;
  }

  function windowFor(track, sourceTime, speed) {
    const nextFragmentDelaySec = fastMode
      ? tuning.minFragmentIntervalMs / 1000
      : seekIntervalEwmaSec;
    const desiredSec = fragmentMs / 1000 + Math.abs(speed) * nextFragmentDelaySec;
    const windowSec = desiredSec > tuning.maxWindowSec
      ? tuning.minWindowSec
      : clamp(desiredSec, tuning.minWindowSec, tuning.maxWindowSec);
    const packetSec = track.packetDurationAt(sourceTime);
    const totalPackets = packetSec > 0 ? Math.max(3, Math.round(windowSec / packetSec)) : 3;
    let packetCount = speed === 0 ? 5 : Math.max(1, totalPackets - 2);
    const maxRanges = Math.max(3, Math.floor(tuning.maxRangesPerWindow));
    const build = count => track.packetsAround(sourceTime, {
      ...(speed < 0 ? { before: count, after: 1 } : { before: 1, after: count }),
      maxGapBytes: tuning.maxRangeGapBytes,
    });
    let window = build(packetCount);
    for (let attempt = 0; window.ranges.length > maxRanges && packetCount > 1 && attempt < 32; attempt++) {
      const scaled = Math.floor(packetCount * maxRanges / window.ranges.length);
      packetCount = Math.max(1, Math.min(packetCount - 1, scaled));
      window = build(packetCount);
    }
    if (window.ranges.length > maxRanges) window = build(1);
    lastWindowRanges = window.ranges.length;
    lastWindowSec = Math.max(0, window.windowEndSec - window.windowStartSec);
    return window;
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

  async function decoderFor(src, lane, config, outputs) {
    const decoderKey = `${lane}|${src}`;
    let holder = decoders.get(decoderKey);
    if (holder?.busy) {
      try { holder.decoder.close(); } catch { /* superseded decode */ }
      decoders.delete(decoderKey);
      holder = null;
    }
    if (!holder || holder.decoder.state === 'closed') {
      holder = { decoder: null, outputs, busy: false, error: null };
      holder.decoder = new AudioDecoderCtor({
        output(data) { holder.outputs.push(data); },
        error(error) { holder.error = error; },
      });
      holder.decoder.configure(config);
      decoders.set(decoderKey, holder);
    }
    holder.outputs = outputs;
    holder.error = null;
    holder.busy = true;
    return holder;
  }

  async function decodeWindow(track, window, { signal, lane, isCurrent }) {
    const key = `${track.src}|${window.packets[0].index}-${window.packets.at(-1).index}`;
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    const fetched = await Promise.all(window.ranges.map(async (range) => {
      inFlightFetches++;
      try {
        const result = await fetchRange(fetchFn, track.src, range.start, range.end, signal);
        return { ...range, bytes: result.bytes };
      } finally {
        inFlightFetches--;
      }
    }));
    if (!isCurrent()) throw new SupersededError();
    const outputs = [];
    const holder = await decoderFor(track.src, lane, track.decoderConfig(), outputs);
    const decoderKey = `${lane}|${track.src}`;
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
      if (decoders.get(decoderKey) === holder) decoders.delete(decoderKey);
      for (const data of outputs) try { data.close(); } catch { /* partial decode cleanup */ }
      throw error;
    } finally {
      holder.busy = false;
    }
    if (!isCurrent()) {
      for (const data of outputs) try { data.close(); } catch { /* superseded decode cleanup */ }
      throw new SupersededError();
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
    const byteSize = buffer.numberOfChannels !== undefined
      ? buffer.numberOfChannels * buffer.length * 4
      : channels * frames * 4;
    const item = { src: track.src, buffer, startSec, endSec: startSec + buffer.duration, byteSize };
    if (byteSize <= tuning.maxCacheBytes) {
      if (cache.has(key)) cacheBytes -= cache.get(key).byteSize;
      cache.set(key, item);
      cacheBytes += byteSize;
      while (cacheBytes > tuning.maxCacheBytes && cache.size > 1) {
        const oldestKey = cache.keys().next().value;
        cacheBytes -= cache.get(oldestKey).byteSize;
        cache.delete(oldestKey);
      }
    }
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

  async function startPrefetch(input, speed, entry, sourceTimeOverride = null) {
    if (speed === 0) return;
    if (!(await supports(entry))) return;
    const latestUsefulTime = Math.max(0, entry.track.info.durationSec - fragmentMs / 1000);
    const leadSec = fastMode ? tuning.minFragmentIntervalMs / 1000 : tuning.leadSec;
    const sourceTime = clamp(
      Number.isFinite(sourceTimeOverride) ? sourceTimeOverride : input.sourceTime + speed * leadSec,
      0,
      latestUsefulTime,
    );
    if (cachedWindow(input.src, sourceTime)) return;
    if (prefetchState?.src === input.src
      && prefetchState.direction === Math.sign(speed)
      && prefetchState.windowStartSec <= sourceTime
      && sourceTime + fragmentMs / 1000 <= prefetchState.windowEndSec + 1e-6) return;
    const window = windowFor(entry.track, sourceTime, speed);
    if (!window.packets.length) return;
    const key = `${input.src}|${window.packets[0].index}-${window.packets.at(-1).index}`;
    if (prefetchState?.key === key) return;
    cancelPrefetch();
    const token = prefetchGeneration;
    const controller = typeof AbortControllerCtor === 'function' ? new AbortControllerCtor() : null;
    const state = {
      key,
      controller,
      token,
      src: input.src,
      direction: Math.sign(speed),
      windowStartSec: window.windowStartSec,
      windowEndSec: window.windowEndSec,
    };
    prefetchState = state;
    state.promise = decodeWindow(entry.track, window, {
      signal: controller?.signal,
      lane: 'prefetch',
      isCurrent: () => token === prefetchGeneration,
    });
    void state.promise.catch(() => {
      // 投機取得は失敗・abort のどちらもユーザー向け状態を汚さない。
    }).finally(() => {
      if (prefetchState === state) prefetchState = null;
    });
  }

  async function runSeek(state, entry, window, cachedItem = null) {
    const isCurrent = () => state.token === generation && seekState === state;
    if (!(await supports(entry)) || !isCurrent()) return;
    let item = cachedItem ? await cachedItem : null;
    if (!item) {
      item = await decodeWindow(entry.track, window, {
        signal: state.controller?.signal,
        lane: 'seek',
        isCurrent,
      });
    }
    state.fetching = false;
    if (!isCurrent()) return;
    let latest = state.latest;
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (!isCurrent()) return;
    latest = state.latest;
    if (video.muted === true || !(video.volume > 0)) {
      stopFragments(false);
      armIdleTimer();
      return;
    }
    // 次の断片を出せるところまで旧断片を残し、取得・復号待ちの無音を作らない。
    stopFragments(false);
    lastError = null;
    startBgm(latest.input.outputTime);
    const started = startBuffer(
      item.buffer,
      latest.input.sourceTime - item.startSec,
      audioContext.destination,
      video.volume,
      'main',
    );
    if (started) {
      const startedAtMs = now();
      const deliveryMs = Math.max(0, startedAtMs - state.dispatchedAtMs);
      deliveryEwmaMs = deliveryEwmaMs === null
        ? deliveryMs
        : deliveryEwmaMs + tuning.timingEwmaAlpha * (deliveryMs - deliveryEwmaMs);
      lastFragmentStartedAtMs = startedAtMs;
      lastStartedSourceTime = latest.input.sourceTime;
    }
    void startPrefetch(latest.input, latest.speed, entry);
    armIdleTimer();
  }

  function dispatchSeek(input, speed, wallMs = now()) {
    const existing = tracks.get(input.src);
    if (!existing) { void prepare(input.src); return; }
    if (!existing.ready || existing.failed) return;
    if (seekState?.fetching
      && seekState.src === input.src
      && seekState.windowStartSec <= input.sourceTime
      && input.sourceTime + fragmentMs / 1000 <= seekState.windowEndSec + 1e-6) {
      seekState.latest = { input, speed };
      coalescedSeeks++;
      return;
    }
    invalidateSeek();
    const cached = cachedWindow(input.src, input.sourceTime);
    const prefetched = !cached
      && prefetchState?.src === input.src
      && prefetchState.windowStartSec <= input.sourceTime
      && input.sourceTime + fragmentMs / 1000 <= prefetchState.windowEndSec + 1e-6
      ? prefetchState : null;
    const window = cached || prefetched ? null : windowFor(existing.track, input.sourceTime, speed);
    if (!cached && !prefetched && !window.packets.length) return;
    const controller = !cached && !prefetched && typeof AbortControllerCtor === 'function'
      ? new AbortControllerCtor() : null;
    const state = {
      token: generation,
      controller,
      src: input.src,
      windowStartSec: cached?.startSec ?? prefetched?.windowStartSec ?? window.windowStartSec,
      windowEndSec: cached?.endSec ?? prefetched?.windowEndSec ?? window.windowEndSec,
      latest: { input, speed },
      fetching: !cached,
      dispatchedAtMs: wallMs,
    };
    seekState = state;
    void runSeek(state, existing, window, cached ?? prefetched?.promise).catch((error) => {
      if (state.token === generation && !isAbortError(error)) lastError = errorMessage(error);
    }).finally(() => {
      if (seekState === state) seekState = null;
    });
  }

  function queueLatestSeek(input, speed, wallMs) {
    pendingInput = { input, speed };
    const lead = Math.min(deliveryEwmaMs ?? 0, tuning.minFragmentIntervalMs / 2);
    const remaining = Math.max(
      0,
      tuning.minFragmentIntervalMs - (wallMs - lastFragmentStartedAtMs) - lead,
    );
    const existing = tracks.get(input.src);
    if (existing?.ready && !existing.failed) {
      const predicted = input.sourceTime + speed * (remaining + lead) / 1000;
      void startPrefetch(input, speed, existing, predicted);
    }
    if (fragmentTimer !== null) return;
    fragmentTimer = setTimeoutFn(() => {
      fragmentTimer = null;
      const pending = pendingInput;
      pendingInput = null;
      if (!pending || !isEnabled) return;
      dispatchSeek(pending.input, pending.speed);
    }, remaining);
  }

  function onSeek(input) {
    if (!isEnabled) return;
    const wallMs = now();
    const speed = updateVelocity(input, wallMs);
    if (input.isPlaying) {
      stop();
      return;
    }
    if (video.muted === true || !(video.volume > 0)) {
      clearFragmentTimer();
      stopFragments();
      cancelPrefetch();
      armIdleTimer();
      return;
    }
    armIdleTimer();
    if (fragmentTimer !== null
      || (fastMode && wallMs - lastFragmentStartedAtMs < tuning.minFragmentIntervalMs)) {
      throttledSeeks++;
      queueLatestSeek(input, speed, wallMs);
      return;
    }
    clearFragmentTimer();
    dispatchSeek(input, speed, wallMs);
  }

  function stop() {
    clearFragmentTimer();
    stopFragments();
    cancelPrefetch();
    clearIdleTimer();
    velocityHistory = [];
    velocity = 0;
    direction = 0;
    fastMode = false;
    seekIntervalEwmaSec = tuning.leadSec;
    lastSeekWallMs = null;
    lastFragmentStartedAtMs = -Infinity;
    lastStartedSourceTime = null;
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
    get cacheBytes() { return cacheBytes; },
    get cacheSize() { return cache.size; },
    get inFlightFetches() { return inFlightFetches; },
    get velocity() { return velocity; },
    get fastMode() { return fastMode; },
    get seekIntervalMs() { return seekIntervalEwmaSec * 1000; },
    get deliveryMs() { return deliveryEwmaMs ?? 0; },
    get lastWindowRanges() { return lastWindowRanges; },
    get lastWindowSec() { return lastWindowSec; },
    get throttledSeeks() { return throttledSeeks; },
    get coalescedSeeks() { return coalescedSeeks; },
    get lastStartedSourceTime() { return lastStartedSourceTime; },
    get tuning() { return tuning; },
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
