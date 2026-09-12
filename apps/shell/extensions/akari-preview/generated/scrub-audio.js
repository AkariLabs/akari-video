// このファイルは生成物です。正本は packages/preview-server/public/audio-scrub.js と mp4-audio-track.js、再生成は npm run bundle:frame-engine。
var AkariScrubAudio = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // packages/preview-server/public/audio-scrub.js
  var audio_scrub_exports = {};
  __export(audio_scrub_exports, {
    SCRUB_MODES: () => SCRUB_MODES,
    SCRUB_TUNING: () => SCRUB_TUNING,
    createScrubAudioController: () => createScrubAudioController,
    resolveBgmOffset: () => resolveBgmOffset
  });

  // packages/preview-server/public/mp4-audio-track.js
  function readType(view, offset) {
    return String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
  }
  function boxes(bytes, from = 0, to = bytes.byteLength) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const result = [];
    let offset = from;
    while (offset + 8 <= to) {
      let size = view.getUint32(offset);
      const type = readType(view, offset + 4);
      let headerSize = 8;
      if (size === 1) {
        if (offset + 16 > to) break;
        size = Number(view.getBigUint64(offset + 8));
        headerSize = 16;
      } else if (size === 0) {
        size = to - offset;
      }
      if (size < headerSize || offset + size > to) break;
      result.push({ type, start: offset, size, headerSize, body: offset + headerSize, end: offset + size });
      offset += size;
    }
    return result;
  }
  function child(bytes, parent, type) {
    return boxes(bytes, parent.body, parent.end).find((box) => box.type === type) ?? null;
  }
  function descriptor(bytes, from, to, wanted) {
    for (let start = from; start < to; start++) {
      if (bytes[start] !== wanted) continue;
      let offset = start + 1;
      let size = 0;
      let complete = false;
      for (let i = 0; i < 4 && offset < to; i++) {
        const value = bytes[offset++];
        size = size << 7 | value & 127;
        if (!(value & 128)) {
          complete = true;
          break;
        }
      }
      if (complete && size > 0 && offset + size <= to) return bytes.slice(offset, offset + size);
    }
    return null;
  }
  function parseTimescale(bytes, box, versionOneOffset, versionZeroOffset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getUint8(box.body) === 1 ? view.getUint32(box.body + versionOneOffset) : view.getUint32(box.body + versionZeroOffset);
  }
  function parseStsd(bytes, box) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entry = boxes(bytes, box.body + 8, box.end)[0];
    if (!entry) throw new Error("audio sample entry not found");
    const version = entry.body + 10 <= entry.end ? view.getUint16(entry.body + 8) : 0;
    let numberOfChannels = entry.body + 18 <= entry.end ? view.getUint16(entry.body + 16) : 0;
    let sampleRate = entry.body + 28 <= entry.end ? view.getUint32(entry.body + 24) >>> 16 : 0;
    let childOffset = entry.body + 28;
    if (version === 1) childOffset += 16;
    if (version === 2) {
      childOffset += 36;
      if (entry.body + 44 <= entry.end) {
        sampleRate = view.getFloat64(entry.body + 32);
        numberOfChannels = view.getUint32(entry.body + 40);
      }
    }
    if (entry.type !== "mp4a") {
      return { codec: entry.type, sampleRate, numberOfChannels, description: null, supported: false };
    }
    const children = boxes(bytes, childOffset, entry.end);
    const wave = children.find((item) => item.type === "wave");
    const esds = children.find((item) => item.type === "esds") ?? (wave && boxes(bytes, wave.body, wave.end).find((item) => item.type === "esds"));
    const description = esds && descriptor(bytes, esds.body + 4, esds.end, 5);
    if (!description?.length) {
      return { codec: "mp4a", sampleRate, numberOfChannels, description: null, supported: false };
    }
    let objectType = description[0] >> 3;
    if (objectType === 31 && description.length > 1) {
      objectType = 32 + ((description[0] & 7) << 3) + (description[1] >> 5);
    }
    return {
      codec: `mp4a.40.${objectType}`,
      sampleRate,
      numberOfChannels,
      description,
      supported: true
    };
  }
  function parseTable(bytes, box, width, read) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(box.body + 4);
    return Array.from({ length: count }, (_, index) => read(view, box.body + 8 + index * width));
  }
  function parseStsz(bytes, box) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const commonSize = view.getUint32(box.body + 4);
    const count = view.getUint32(box.body + 8);
    if (commonSize) return Array(count).fill(commonSize);
    return Array.from({ length: count }, (_, index) => view.getUint32(box.body + 12 + index * 4));
  }
  function expandDurations(entries, sampleCount) {
    const result = [];
    for (const entry of entries) {
      for (let i = 0; i < entry.count && result.length < sampleCount; i++) result.push(entry.delta);
    }
    if (result.length !== sampleCount) throw new Error("stts/stsz sample count mismatch");
    return result;
  }
  function readSigned64(view, offset) {
    const value = view.getBigInt64(offset);
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error("elst media_time is outside the safe integer range");
    return number;
  }
  function editOffset(bytes, trak, movieTimescale, mediaTimescale) {
    const edts = child(bytes, trak, "edts");
    const elst = edts && child(bytes, edts, "elst");
    if (!elst) return { editOffsetTicks: 0, hasEditList: false };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint8(elst.body);
    const count = view.getUint32(elst.body + 4);
    const width = version === 1 ? 20 : 12;
    let delayTicks = 0;
    let mediaTime = 0;
    for (let index = 0; index < count; index++) {
      const at = elst.body + 8 + index * width;
      const segmentDuration = version === 1 ? Number(view.getBigUint64(at)) : view.getUint32(at);
      const entryMediaTime = version === 1 ? readSigned64(view, at + 8) : view.getInt32(at + 4);
      if (entryMediaTime === -1) {
        delayTicks += segmentDuration * mediaTimescale / movieTimescale;
        continue;
      }
      if (entryMediaTime >= 0) {
        mediaTime = entryMediaTime;
        break;
      }
    }
    return { editOffsetTicks: Math.round(mediaTime - delayTicks), hasEditList: true };
  }
  function parseMp4AudioTrack(bytes) {
    const moov = boxes(bytes).find((box) => box.type === "moov");
    if (!moov) throw new Error("moov box not found");
    const mvhd = child(bytes, moov, "mvhd");
    if (!mvhd) throw new Error("mvhd box not found");
    const movieTimescale = parseTimescale(bytes, mvhd, 20, 12);
    let selected = null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const trak of boxes(bytes, moov.body, moov.end).filter((box) => box.type === "trak")) {
      const mdia = child(bytes, trak, "mdia");
      const hdlr = mdia && child(bytes, mdia, "hdlr");
      if (hdlr && readType(view, hdlr.body + 8) === "soun") {
        selected = { trak, mdia };
        break;
      }
    }
    if (!selected) throw new Error("audio track not found");
    const mdhd = child(bytes, selected.mdia, "mdhd");
    const minf = child(bytes, selected.mdia, "minf");
    const stbl = minf && child(bytes, minf, "stbl");
    if (!mdhd || !stbl) throw new Error("incomplete audio sample table");
    const tables = new Map(boxes(bytes, stbl.body, stbl.end).map((box) => [box.type, box]));
    const stsd = tables.get("stsd");
    const stts = tables.get("stts");
    const stsc = tables.get("stsc");
    const stsz = tables.get("stsz");
    const stco = tables.get("stco") ?? tables.get("co64");
    if (!stsd || !stts || !stsc || !stsz || !stco) throw new Error("incomplete audio sample table");
    const timescale = parseTimescale(bytes, mdhd, 20, 12);
    const config = parseStsd(bytes, stsd);
    const sizes = parseStsz(bytes, stsz);
    const durations = expandDurations(parseTable(bytes, stts, 8, (data, at) => ({
      count: data.getUint32(at),
      delta: data.getUint32(at + 4)
    })), sizes.length);
    const mappings = parseTable(bytes, stsc, 12, (data, at) => ({
      firstChunk: data.getUint32(at),
      samplesPerChunk: data.getUint32(at + 4)
    }));
    const wide = stco.type === "co64";
    const chunks = parseTable(bytes, stco, wide ? 8 : 4, (data, at) => wide ? Number(data.getBigUint64(at)) : data.getUint32(at));
    const samples = [];
    let sampleIndex = 0;
    let dts = 0;
    for (let chunkIndex = 0; chunkIndex < chunks.length && sampleIndex < sizes.length; chunkIndex++) {
      let mapping = mappings[0];
      for (const candidate of mappings) {
        if (candidate.firstChunk <= chunkIndex + 1) mapping = candidate;
        else break;
      }
      if (!mapping) throw new Error("stsc has no chunk mapping");
      let offset = chunks[chunkIndex];
      for (let index = 0; index < mapping.samplesPerChunk && sampleIndex < sizes.length; index++) {
        const size = sizes[sampleIndex];
        const duration = durations[sampleIndex];
        samples.push({ index: sampleIndex, offset, size, dts, duration });
        offset += size;
        dts += duration;
        sampleIndex++;
      }
    }
    if (sampleIndex !== sizes.length) throw new Error("stsc did not map every audio sample");
    const edits = editOffset(bytes, selected.trak, movieTimescale, timescale);
    return {
      ...config,
      timescale,
      ...edits,
      editOffsetSec: edits.editOffsetTicks / timescale,
      samples,
      durationSec: (dts - edits.editOffsetTicks) / timescale
    };
  }
  function contentRangeTotal(response) {
    const value = response.headers?.get?.("content-range") ?? "";
    const match = /\/(\d+)$/.exec(value);
    return match ? Number(match[1]) : null;
  }
  async function fetchRange(fetchFn, src, start, end, signal) {
    const init = { headers: { Range: `bytes=${start}-${end}` } };
    if (signal !== void 0) init.signal = signal;
    const response = await fetchFn(src, init);
    if (response.status !== 206) throw new Error(`range fetch was not honored: ${response.status}`);
    return { bytes: new Uint8Array(await response.arrayBuffer()), total: contentRangeTotal(response) };
  }
  var Mp4AudioTrack = class {
    constructor({ src, fetchFn = globalThis.fetch, now = () => globalThis.performance.now() }) {
      this.src = src;
      this.fetchFn = fetchFn;
      this.now = now;
      this.info = null;
      this.moovBytes = 0;
      this.moovLoadMs = 0;
      this.openPromise = null;
    }
    get isOpen() {
      return this.info !== null;
    }
    open() {
      if (!this.openPromise) this.openPromise = this.#open();
      return this.openPromise;
    }
    async #open() {
      const started = this.now();
      let offset = 0;
      let total = null;
      let moovHeader = null;
      while (total === null || offset < total) {
        const header = await fetchRange(this.fetchFn, this.src, offset, offset + 15);
        if (total === null) total = header.total;
        if (header.bytes.length < 8) throw new Error("truncated MP4 box header");
        const view = new DataView(header.bytes.buffer, header.bytes.byteOffset, header.bytes.byteLength);
        let size = view.getUint32(0);
        const type = readType(view, 4);
        let headerSize = 8;
        if (size === 1) {
          if (header.bytes.length < 16) throw new Error("truncated extended MP4 box header");
          size = Number(view.getBigUint64(8));
          headerSize = 16;
        } else if (size === 0) {
          if (total === null) throw new Error("unknown MP4 size");
          size = total - offset;
        }
        if (size < headerSize) throw new Error(`invalid ${type} box size`);
        if (type === "moov") {
          moovHeader = { offset, size };
          break;
        }
        offset += size;
      }
      if (!moovHeader) throw new Error("moov box not found");
      const loaded = await fetchRange(
        this.fetchFn,
        this.src,
        moovHeader.offset,
        moovHeader.offset + moovHeader.size - 1
      );
      this.moovBytes = loaded.bytes.byteLength;
      this.moovLoadMs = this.now() - started;
      this.info = parseMp4AudioTrack(loaded.bytes);
      return this;
    }
    packetsAround(tSec, { before = 1, after = 5, maxGapBytes = 0 } = {}) {
      if (!this.info) throw new Error("track is not open");
      const samples = this.info.samples;
      if (!samples.length) {
        return { packets: [], ranges: [], rawStartTick: 0, rawEndTick: 0, windowStartSec: 0, windowEndSec: 0 };
      }
      const tick = Math.max(0, tSec) * this.info.timescale + this.info.editOffsetTicks;
      let low = 0;
      let high = samples.length;
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        const sample = samples[middle];
        if (tick < sample.dts + sample.duration) high = middle;
        else low = middle + 1;
      }
      const index = Math.min(low, samples.length - 1);
      const start = Math.max(0, index - Math.max(0, before));
      const end = Math.min(samples.length, index + Math.max(0, after) + 1);
      const packets = samples.slice(start, end);
      const ranges = [];
      for (const packet of packets) {
        const previous = ranges.at(-1);
        const gapBytes = previous ? packet.offset - previous.end - 1 : Infinity;
        if (previous && gapBytes >= 0 && gapBytes <= Math.max(0, maxGapBytes)) {
          previous.end = packet.offset + packet.size - 1;
        } else ranges.push({ start: packet.offset, end: packet.offset + packet.size - 1 });
      }
      const rawStartTick = packets[0].dts;
      const last = packets.at(-1);
      const rawEndTick = last.dts + last.duration;
      return {
        packets,
        ranges,
        rawStartTick,
        rawEndTick,
        windowStartSec: (rawStartTick - this.info.editOffsetTicks) / this.info.timescale,
        windowEndSec: (rawEndTick - this.info.editOffsetTicks) / this.info.timescale
      };
    }
    packetDurationAt(tSec) {
      if (!this.info) throw new Error("track is not open");
      const samples = this.info.samples;
      if (!samples.length) return 0;
      const tick = Math.max(0, tSec) * this.info.timescale + this.info.editOffsetTicks;
      let low = 0;
      let high = samples.length;
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        const sample = samples[middle];
        if (tick < sample.dts + sample.duration) high = middle;
        else low = middle + 1;
      }
      return samples[Math.min(low, samples.length - 1)].duration / this.info.timescale;
    }
    packetsForSeconds(tSec, seconds) {
      const packetSec = this.packetDurationAt(tSec);
      return packetSec > 0 ? Math.max(1, Math.ceil(Math.max(0, seconds) / packetSec)) : 1;
    }
    decoderConfig() {
      if (!this.info) throw new Error("track is not open");
      const { codec, sampleRate, numberOfChannels, description } = this.info;
      return { codec, sampleRate, numberOfChannels, description };
    }
  };

  // packages/preview-server/public/audio-scrub.js
  var SCRUB_MODES = ["off", "on"];
  var SCRUB_TUNING = Object.freeze({
    maxCacheBytes: 8 * 1024 * 1024,
    minWindowSec: 0.15,
    maxWindowSec: 0.3,
    maxRangesPerWindow: 12,
    maxRangeGapBytes: 1024,
    leadSec: 0.05,
    minFragmentIntervalMs: 70,
    fastSpeedEnterRatio: 25,
    fastSpeedExitRatio: 18,
    velocitySamples: 5,
    timingEwmaAlpha: 0.3
  });
  var FADE_SECONDS = 5e-3;
  var SCHEDULE_LOOKAHEAD_SECONDS = 5e-3;
  var SupersededError = class extends Error {
    constructor() {
      super("scrub request superseded");
      this.name = "AbortError";
    }
  };
  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }
  function isAbortError(error) {
    return error?.name === "AbortError";
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function resolveBgmOffset(outputTime, spec, duration) {
    let offset = (Number(spec?.in) || 0) + (outputTime - (Number(spec?.t) || 0));
    if (spec?.loop !== false && duration > 0) offset = (offset % duration + duration) % duration;
    return offset >= 0 && offset < duration ? offset : null;
  }
  function createScrubAudioController(deps) {
    const audioContext = deps.audioContext;
    const video = deps.video;
    const getBgm = deps.getBgm;
    const fetchFn = deps.fetchFn ?? globalThis.fetch;
    const now = deps.now ?? (() => globalThis.performance.now());
    const AudioDecoderCtor = deps.AudioDecoderCtor ?? globalThis.AudioDecoder;
    const EncodedAudioChunkCtor = deps.EncodedAudioChunkCtor ?? globalThis.EncodedAudioChunk;
    const setTimeoutFn = deps.setTimeoutFn ?? globalThis.setTimeout;
    const clearTimeoutFn = deps.clearTimeoutFn ?? globalThis.clearTimeout;
    const requestedCacheBytes = deps.maxCacheBytes ?? deps.tuning?.maxCacheBytes ?? SCRUB_TUNING.maxCacheBytes;
    const tuning = Object.freeze({
      ...SCRUB_TUNING,
      ...deps.tuning ?? {},
      maxCacheBytes: clamp(Number(requestedCacheBytes) || 0, 0, SCRUB_TUNING.maxCacheBytes)
    });
    const AbortControllerCtor = deps.AbortControllerCtor ?? globalThis.AbortController;
    let isEnabled = deps.enabled ?? true;
    let fragmentMs = deps.fragmentMs ?? 40;
    let generation = 0;
    let prefetchGeneration = 0;
    let mainActive = null;
    let bgmActive = null;
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
    const tracks = /* @__PURE__ */ new Map();
    const decoders = /* @__PURE__ */ new Map();
    const cache = /* @__PURE__ */ new Map();
    function holdParamAt(param, at, valueAt) {
      if (typeof param.cancelAndHoldAtTime === "function") param.cancelAndHoldAtTime(at);
      else param.cancelScheduledValues?.(at);
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
        try {
          active.source.stop(active.startAt);
        } catch {
        }
        return;
      }
      holdParamAt(param, at, bufferGainAt(active, at));
      param.linearRampToValueAtTime?.(0, at + FADE_SECONDS);
      try {
        active.source.stop(at + FADE_SECONDS);
      } catch {
      }
    }
    function abortController(controller2) {
      try {
        controller2?.abort();
      } catch {
      }
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
        const intervalSec = (wallMs - lastSeekWallMs) / 1e3;
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
      const elapsedSec = (latest.wallMs - oldest.wallMs) / 1e3;
      const nextVelocity = velocityHistory.length >= 2 && elapsedSec > 1e-6 ? (latest.sourceTime - oldest.sourceTime) / elapsedSec : 0;
      velocity = nextVelocity;
      const speed = Math.abs(velocity);
      if (!fastMode && speed >= tuning.fastSpeedEnterRatio) fastMode = true;
      else if (fastMode && speed <= tuning.fastSpeedExitRatio) fastMode = false;
      return velocity;
    }
    function windowFor(track, sourceTime, speed) {
      const nextFragmentDelaySec = fastMode ? tuning.minFragmentIntervalMs / 1e3 : seekIntervalEwmaSec;
      const desiredSec = fragmentMs / 1e3 + Math.abs(speed) * nextFragmentDelaySec;
      const windowSec = desiredSec > tuning.maxWindowSec ? tuning.minWindowSec : clamp(desiredSec, tuning.minWindowSec, tuning.maxWindowSec);
      const packetSec = track.packetDurationAt(sourceTime);
      const totalPackets = packetSec > 0 ? Math.max(3, Math.round(windowSec / packetSec)) : 3;
      let packetCount = speed === 0 ? 5 : Math.max(1, totalPackets - 2);
      const maxRanges = Math.max(3, Math.floor(tuning.maxRangesPerWindow));
      const build = (count) => track.packetsAround(sourceTime, {
        ...speed < 0 ? { before: count, after: 1 } : { before: 1, after: count },
        maxGapBytes: tuning.maxRangeGapBytes
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
      const duration = Math.min(fragmentMs / 1e3, Math.max(0, buffer.duration - offset));
      if (!(duration > 0)) return false;
      const fade = Math.min(FADE_SECONDS, duration / 2);
      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();
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
        endAt: at + duration
      };
      if (kind === "bgm") bgmActive = active;
      else mainActive = active;
      return true;
    }
    function startBgm(outputTime) {
      const { node, spec } = getBgm?.() ?? {};
      const buffer = node?._buffer;
      if (!buffer || !spec) return;
      const offset = resolveBgmOffset(outputTime, spec, buffer.duration);
      if (offset !== null) startBuffer(buffer, offset, node, 1, "bgm");
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
      if (audioContext.state === "suspended") {
        try {
          await audioContext.resume();
        } catch (error) {
          lastError = errorMessage(error);
        }
      }
      const values = Array.isArray(srcs) ? srcs : [srcs];
      const pending = [];
      for (const value of values) {
        if (typeof value !== "string" || !value || tracks.has(value)) continue;
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
          throw new Error("WebCodecs audio decoder unavailable");
        }
        if (typeof AudioDecoderCtor.isConfigSupported !== "function") return true;
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
        try {
          holder.decoder.close();
        } catch {
        }
        decoders.delete(decoderKey);
        holder = null;
      }
      if (!holder || holder.decoder.state === "closed") {
        holder = { decoder: null, outputs, busy: false, error: null };
        holder.decoder = new AudioDecoderCtor({
          output(data) {
            holder.outputs.push(data);
          },
          error(error) {
            holder.error = error;
          }
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
          const range = fetched.find((item2) => packet.offset >= item2.start && packet.offset + packet.size - 1 <= item2.end);
          if (!range) throw new Error("audio packet bytes are missing");
          const at = packet.offset - range.start;
          holder.decoder.decode(new EncodedAudioChunkCtor({
            type: "key",
            timestamp: Math.round(packet.dts / track.info.timescale * 1e6),
            duration: Math.round(packet.duration / track.info.timescale * 1e6),
            data: range.bytes.slice(at, at + packet.size)
          }));
        }
        await holder.decoder.flush();
      } catch (error) {
        if (decoders.get(decoderKey) === holder) decoders.delete(decoderKey);
        for (const data of outputs) try {
          data.close();
        } catch {
        }
        throw error;
      } finally {
        holder.busy = false;
      }
      if (!isCurrent()) {
        for (const data of outputs) try {
          data.close();
        } catch {
        }
        throw new SupersededError();
      }
      if (holder.error) throw holder.error;
      outputs.sort((left, right) => left.timestamp - right.timestamp);
      if (!outputs.length) throw new Error("AudioDecoder produced no output");
      const channels = outputs[0].numberOfChannels;
      const sampleRate = outputs[0].sampleRate;
      const frames = outputs.reduce((sum, data) => sum + data.numberOfFrames, 0);
      const firstOutputTimestamp = outputs[0].timestamp;
      const buffer = audioContext.createBuffer(channels, frames, sampleRate);
      let frameOffset = 0;
      for (const data of outputs) {
        for (let plane = 0; plane < channels; plane++) {
          const values = new Float32Array(data.numberOfFrames);
          data.copyTo(values, { planeIndex: plane, format: "f32-planar" });
          buffer.getChannelData(plane).set(values, frameOffset);
        }
        frameOffset += data.numberOfFrames;
        data.close();
      }
      const outputTick = Math.round(firstOutputTimestamp / 1e6 * track.info.timescale);
      const rawStartTick = Number.isFinite(outputTick) && outputTick >= window.rawStartTick && outputTick < window.rawEndTick ? outputTick : window.rawStartTick;
      const startSec = (rawStartTick - track.info.editOffsetTicks) / track.info.timescale;
      const byteSize = buffer.numberOfChannels !== void 0 ? buffer.numberOfChannels * buffer.length * 4 : channels * frames * 4;
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
        if (item.src === src && item.startSec <= sourceTime && sourceTime + fragmentMs / 1e3 <= item.endSec + 1e-6) {
          cache.delete(key);
          cache.set(key, item);
          return item;
        }
      }
      return null;
    }
    async function startPrefetch(input, speed, entry, sourceTimeOverride = null) {
      if (speed === 0) return;
      if (!await supports(entry)) return;
      const latestUsefulTime = Math.max(0, entry.track.info.durationSec - fragmentMs / 1e3);
      const leadSec = fastMode ? tuning.minFragmentIntervalMs / 1e3 : tuning.leadSec;
      const sourceTime = clamp(
        Number.isFinite(sourceTimeOverride) ? sourceTimeOverride : input.sourceTime + speed * leadSec,
        0,
        latestUsefulTime
      );
      if (cachedWindow(input.src, sourceTime)) return;
      if (prefetchState?.src === input.src && prefetchState.direction === Math.sign(speed) && prefetchState.windowStartSec <= sourceTime && sourceTime + fragmentMs / 1e3 <= prefetchState.windowEndSec + 1e-6) return;
      const window = windowFor(entry.track, sourceTime, speed);
      if (!window.packets.length) return;
      const key = `${input.src}|${window.packets[0].index}-${window.packets.at(-1).index}`;
      if (prefetchState?.key === key) return;
      cancelPrefetch();
      const token = prefetchGeneration;
      const controller2 = typeof AbortControllerCtor === "function" ? new AbortControllerCtor() : null;
      const state = {
        key,
        controller: controller2,
        token,
        src: input.src,
        direction: Math.sign(speed),
        windowStartSec: window.windowStartSec,
        windowEndSec: window.windowEndSec
      };
      prefetchState = state;
      state.promise = decodeWindow(entry.track, window, {
        signal: controller2?.signal,
        lane: "prefetch",
        isCurrent: () => token === prefetchGeneration
      });
      void state.promise.catch(() => {
      }).finally(() => {
        if (prefetchState === state) prefetchState = null;
      });
    }
    async function runSeek(state, entry, window, cachedItem = null) {
      const isCurrent = () => state.token === generation && seekState === state;
      if (!await supports(entry) || !isCurrent()) return;
      let item = cachedItem ? await cachedItem : null;
      if (!item) {
        item = await decodeWindow(entry.track, window, {
          signal: state.controller?.signal,
          lane: "seek",
          isCurrent
        });
      }
      state.fetching = false;
      if (!isCurrent()) return;
      let latest = state.latest;
      if (audioContext.state === "suspended") await audioContext.resume();
      if (!isCurrent()) return;
      latest = state.latest;
      if (video.muted === true || !(video.volume > 0)) {
        stopFragments(false);
        return;
      }
      stopFragments(false);
      lastError = null;
      startBgm(latest.input.outputTime);
      const started = startBuffer(
        item.buffer,
        latest.input.sourceTime - item.startSec,
        audioContext.destination,
        video.volume,
        "main"
      );
      if (started) {
        const startedAtMs = now();
        const deliveryMs = Math.max(0, startedAtMs - state.dispatchedAtMs);
        deliveryEwmaMs = deliveryEwmaMs === null ? deliveryMs : deliveryEwmaMs + tuning.timingEwmaAlpha * (deliveryMs - deliveryEwmaMs);
        lastFragmentStartedAtMs = startedAtMs;
        lastStartedSourceTime = latest.input.sourceTime;
      }
      void startPrefetch(latest.input, latest.speed, entry);
    }
    function dispatchSeek(input, speed, wallMs = now()) {
      const existing = tracks.get(input.src);
      if (!existing) {
        void prepare(input.src);
        return;
      }
      if (!existing.ready || existing.failed) return;
      if (seekState?.fetching && seekState.src === input.src && seekState.windowStartSec <= input.sourceTime && input.sourceTime + fragmentMs / 1e3 <= seekState.windowEndSec + 1e-6) {
        seekState.latest = { input, speed };
        coalescedSeeks++;
        return;
      }
      invalidateSeek();
      const cached = cachedWindow(input.src, input.sourceTime);
      const prefetched = !cached && prefetchState?.src === input.src && prefetchState.windowStartSec <= input.sourceTime && input.sourceTime + fragmentMs / 1e3 <= prefetchState.windowEndSec + 1e-6 ? prefetchState : null;
      const window = cached || prefetched ? null : windowFor(existing.track, input.sourceTime, speed);
      if (!cached && !prefetched && !window.packets.length) return;
      const controller2 = !cached && !prefetched && typeof AbortControllerCtor === "function" ? new AbortControllerCtor() : null;
      const state = {
        token: generation,
        controller: controller2,
        src: input.src,
        windowStartSec: cached?.startSec ?? prefetched?.windowStartSec ?? window.windowStartSec,
        windowEndSec: cached?.endSec ?? prefetched?.windowEndSec ?? window.windowEndSec,
        latest: { input, speed },
        fetching: !cached,
        dispatchedAtMs: wallMs
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
        tuning.minFragmentIntervalMs - (wallMs - lastFragmentStartedAtMs) - lead
      );
      const existing = tracks.get(input.src);
      if (existing?.ready && !existing.failed) {
        const predicted = input.sourceTime + speed * (remaining + lead) / 1e3;
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
        return;
      }
      if (fragmentTimer !== null || fastMode && wallMs - lastFragmentStartedAtMs < tuning.minFragmentIntervalMs) {
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
    }
    const controller = {
      get enabled() {
        return isEnabled;
      },
      set enabled(value) {
        const next = Boolean(value);
        if (next === isEnabled) return;
        isEnabled = next;
        if (!next) stop();
      },
      get mode() {
        return isEnabled ? "on" : "off";
      },
      set mode(value) {
        if (!SCRUB_MODES.includes(value)) throw new TypeError(`invalid scrub audio mode: ${value}`);
        this.enabled = value === "on";
      },
      get active() {
        return isEnabled;
      },
      get lastError() {
        return lastError;
      },
      get cacheBytes() {
        return cacheBytes;
      },
      get cacheSize() {
        return cache.size;
      },
      get inFlightFetches() {
        return inFlightFetches;
      },
      get velocity() {
        return velocity;
      },
      get fastMode() {
        return fastMode;
      },
      get seekIntervalMs() {
        return seekIntervalEwmaSec * 1e3;
      },
      get deliveryMs() {
        return deliveryEwmaMs ?? 0;
      },
      get lastWindowRanges() {
        return lastWindowRanges;
      },
      get lastWindowSec() {
        return lastWindowSec;
      },
      get throttledSeeks() {
        return throttledSeeks;
      },
      get coalescedSeeks() {
        return coalescedSeeks;
      },
      get lastStartedSourceTime() {
        return lastStartedSourceTime;
      },
      get tuning() {
        return tuning;
      },
      get fragmentMs() {
        return fragmentMs;
      },
      set fragmentMs(value) {
        fragmentMs = value;
      },
      get context() {
        return audioContext;
      },
      onSeek,
      stop,
      onPlaybackPaused,
      prepare
    };
    return controller;
  }
  return __toCommonJS(audio_scrub_exports);
})();
