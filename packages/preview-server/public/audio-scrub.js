export const SCRUB_MODES = ['off', 'A', 'B', 'C'];

const FADE_SECONDS = 0.005;
const SCHEDULE_LOOKAHEAD_SECONDS = 0.005;
const WINDOW_CACHE_SIZE = 8;

function readType(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1),
    view.getUint8(offset + 2), view.getUint8(offset + 3)
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
  return boxes(bytes, parent.body, parent.end).find(box => box.type === type) ?? null;
}

function descriptor(bytes, from, to, wanted) {
  // ES_Descriptor / DecoderConfigDescriptor は各々に固定フィールドを持つため、
  // 未知 descriptor も含めて目的タグの境界候補を走査する。
  for (let start = from; start < to; start++) {
    if (bytes[start] !== wanted) continue;
    let offset = start + 1;
    let size = 0;
    let complete = false;
    for (let i = 0; i < 4 && offset < to; i++) {
      const value = bytes[offset++];
      size = (size << 7) | (value & 0x7f);
      if (!(value & 0x80)) { complete = true; break; }
    }
    if (complete && size > 0 && offset + size <= to) return bytes.slice(offset, offset + size);
  }
  return null;
}

function parseMdhd(bytes, box) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(box.body);
  return version === 1 ? view.getUint32(box.body + 20) : view.getUint32(box.body + 12);
}

function parseStsd(bytes, box) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = boxes(bytes, box.body + 8, box.end);
  const mp4a = entries.find(entry => entry.type === 'mp4a');
  if (!mp4a) throw new Error('mp4a sample entry not found');
  const numberOfChannels = view.getUint16(mp4a.body + 16);
  const sampleRate = view.getUint32(mp4a.body + 24) >>> 16;
  const esds = boxes(bytes, mp4a.body + 28, mp4a.end).find(entry => entry.type === 'esds');
  if (!esds) throw new Error('esds box not found');
  const description = descriptor(bytes, esds.body + 4, esds.end, 0x05);
  if (!description?.length) throw new Error('AudioSpecificConfig not found');
  let objectType = description[0] >> 3;
  if (objectType === 31 && description.length > 1) objectType = 32 + ((description[0] & 7) << 3) + (description[1] >> 5);
  return {
    codec: `mp4a.40.${objectType}`,
    sampleRate,
    numberOfChannels,
    description,
  };
}

function parseStts(bytes, box) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(box.body + 4);
  const result = [];
  for (let i = 0; i < count; i++) {
    const at = box.body + 8 + i * 8;
    result.push({ count: view.getUint32(at), delta: view.getUint32(at + 4) });
  }
  return result;
}

function parseStsc(bytes, box) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(box.body + 4);
  const result = [];
  for (let i = 0; i < count; i++) {
    const at = box.body + 8 + i * 12;
    result.push({ firstChunk: view.getUint32(at), samplesPerChunk: view.getUint32(at + 4) });
  }
  return result;
}

function parseStsz(bytes, box) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const commonSize = view.getUint32(box.body + 4);
  const count = view.getUint32(box.body + 8);
  if (commonSize) return Array(count).fill(commonSize);
  return Array.from({ length: count }, (_, i) => view.getUint32(box.body + 12 + i * 4));
}

function parseChunkOffsets(bytes, box) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(box.body + 4);
  const wide = box.type === 'co64';
  return Array.from({ length: count }, (_, i) => wide
    ? Number(view.getBigUint64(box.body + 8 + i * 8))
    : view.getUint32(box.body + 8 + i * 4));
}

function expandDurations(stts, sampleCount) {
  const result = [];
  for (const entry of stts) {
    for (let i = 0; i < entry.count && result.length < sampleCount; i++) result.push(entry.delta);
  }
  if (result.length !== sampleCount) throw new Error('stts/stsz sample count mismatch');
  return result;
}

export function parseMp4AudioTrack(bytes) {
  const moov = boxes(bytes).find(box => box.type === 'moov');
  if (!moov) throw new Error('moov box not found');
  let selected = null;
  for (const trak of boxes(bytes, moov.body, moov.end).filter(box => box.type === 'trak')) {
    const mdia = child(bytes, trak, 'mdia');
    const hdlr = mdia && child(bytes, mdia, 'hdlr');
    if (hdlr && readType(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), hdlr.body + 8) === 'soun') {
      selected = { trak, mdia };
      break;
    }
  }
  if (!selected) throw new Error('audio track not found');
  const mdhd = child(bytes, selected.mdia, 'mdhd');
  const minf = child(bytes, selected.mdia, 'minf');
  const stbl = minf && child(bytes, minf, 'stbl');
  if (!mdhd || !stbl) throw new Error('incomplete audio sample table');
  const byType = new Map(boxes(bytes, stbl.body, stbl.end).map(box => [box.type, box]));
  const stsd = byType.get('stsd');
  const stts = byType.get('stts');
  const stsc = byType.get('stsc');
  const stsz = byType.get('stsz');
  const stco = byType.get('stco') ?? byType.get('co64');
  if (!stsd || !stts || !stsc || !stsz || !stco) throw new Error('incomplete audio sample table');

  const timescale = parseMdhd(bytes, mdhd);
  const config = parseStsd(bytes, stsd);
  const sizes = parseStsz(bytes, stsz);
  const durations = expandDurations(parseStts(bytes, stts), sizes.length);
  const chunks = parseChunkOffsets(bytes, stco);
  const mappings = parseStsc(bytes, stsc);
  const samples = [];
  let sampleIndex = 0;
  let dts = 0;
  for (let chunkIndex = 0; chunkIndex < chunks.length && sampleIndex < sizes.length; chunkIndex++) {
    let mapping = mappings[0];
    for (const candidate of mappings) {
      if (candidate.firstChunk <= chunkIndex + 1) mapping = candidate;
      else break;
    }
    let offset = chunks[chunkIndex];
    for (let i = 0; i < mapping.samplesPerChunk && sampleIndex < sizes.length; i++) {
      const size = sizes[sampleIndex];
      const duration = durations[sampleIndex];
      samples.push({ index: sampleIndex, offset, size, dts, duration });
      offset += size;
      dts += duration;
      sampleIndex++;
    }
  }
  if (sampleIndex !== sizes.length) throw new Error('stsc did not map every audio sample');
  return {
    ...config,
    timescale,
    samples,
    elstIgnored: Boolean(child(bytes, selected.trak, 'edts')),
  };
}

function contentRangeTotal(response) {
  const value = response.headers?.get?.('content-range') ?? '';
  const match = /\/(\d+)$/.exec(value);
  return match ? Number(match[1]) : null;
}

async function fetchRange(fetchFn, src, start, end) {
  const response = await fetchFn(src, { headers: { Range: `bytes=${start}-${end}` } });
  // 200 応答を受理すると巨大な mdat を全量読むため、前処理なしという契約を守れない。
  if (response.status !== 206) throw new Error(`range fetch was not honored: ${response.status}`);
  return { bytes: new Uint8Array(await response.arrayBuffer()), total: contentRangeTotal(response) };
}

export class Mp4AudioTrack {
  constructor({ src, fetchFn = globalThis.fetch, now = () => globalThis.performance.now() }) {
    this.src = src;
    this.fetchFn = fetchFn;
    this.now = now;
    this.info = null;
    this.moovBytes = 0;
    this.moovLoadMs = 0;
    this.openPromise = null;
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
      if (header.bytes.length < 8) throw new Error('truncated MP4 box header');
      const view = new DataView(header.bytes.buffer, header.bytes.byteOffset, header.bytes.byteLength);
      let size = view.getUint32(0);
      const type = readType(view, 4);
      let headerSize = 8;
      if (size === 1) {
        if (header.bytes.length < 16) throw new Error('truncated extended MP4 box header');
        size = Number(view.getBigUint64(8));
        headerSize = 16;
      } else if (size === 0) {
        if (total === null) throw new Error('unknown MP4 size');
        size = total - offset;
      }
      if (size < headerSize) throw new Error(`invalid ${type} box size`);
      if (type === 'moov') { moovHeader = { offset, size }; break; }
      offset += size;
    }
    if (!moovHeader) throw new Error('moov box not found');
    const loaded = await fetchRange(this.fetchFn, this.src, moovHeader.offset, moovHeader.offset + moovHeader.size - 1);
    this.moovBytes = loaded.bytes.byteLength;
    this.moovLoadMs = this.now() - started;
    this.info = parseMp4AudioTrack(loaded.bytes);
    return this;
  }

  packetsAround(tSec, count = 3) {
    if (!this.info) throw new Error('track is not open');
    const samples = this.info.samples;
    if (!samples.length) return { packets: [], ranges: [], windowStartSec: 0, windowEndSec: 0 };
    const tick = Math.max(0, tSec) * this.info.timescale;
    let index = samples.findIndex(sample => tick < sample.dts + sample.duration);
    if (index < 0) index = samples.length - 1;
    const before = Math.floor((count - 1) / 2);
    const start = Math.max(0, Math.min(samples.length - count, index - before));
    const packets = samples.slice(start, Math.min(samples.length, start + count));
    const ranges = [];
    for (const packet of packets) {
      const previous = ranges.at(-1);
      if (previous && previous.end + 1 === packet.offset) previous.end = packet.offset + packet.size - 1;
      else ranges.push({ start: packet.offset, end: packet.offset + packet.size - 1 });
    }
    const first = packets[0];
    const last = packets.at(-1);
    return {
      packets,
      ranges,
      windowStartSec: first.dts / this.info.timescale,
      windowEndSec: (last.dts + last.duration) / this.info.timescale,
    };
  }
}

function emptyRecord(seq, mode, input, arrivedPerfMs, arrivedCtxSec) {
  return {
    seq, mode, outputTime: input.outputTime, sourceTime: input.sourceTime, src: input.src,
    arrivedPerfMs, arrivedCtxSec,
    mainStartedCtxSec: null, mainStartedPerfMs: null, seekCompleteMs: null,
    fetchMs: null, bytes: null, decodeMs: null, cacheHit: null,
    bgmStartedCtxSec: null, bgmOffsetSec: null, skipped: null, error: null,
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function resolveBgmOffset(outputTime, spec, duration) {
  let offset = (Number(spec?.in) || 0) + (outputTime - (Number(spec?.t) || 0));
  if (spec?.loop !== false && duration > 0) offset = ((offset % duration) + duration) % duration;
  return offset >= 0 && offset < duration ? offset : null;
}

function sameMediaSource(media, src) {
  let expected = src;
  try { expected = new URL(src, globalThis.document?.baseURI).href; } catch { /* compare original value */ }
  return media.currentSrc === expected || media.src === expected || media.currentSrc === src || media.src === src;
}

function waitForSeek(media, target, sourceChanged) {
  let cancel = () => {};
  const promise = new Promise((resolve) => {
    let loaded = !sourceChanged;
    let seeked = false;
    const cleanup = () => {
      media.removeEventListener('loadeddata', onLoaded);
      media.removeEventListener('seeked', onSeeked);
      media.removeEventListener('error', finish);
    };
    const finish = () => { cleanup(); resolve(); };
    cancel = finish;
    const ready = () => {
      if (loaded && seeked && Math.abs(media.currentTime - target) <= 0.25) finish();
    };
    const onLoaded = () => { loaded = true; ready(); };
    const onSeeked = () => { seeked = true; ready(); };
    media.addEventListener('loadeddata', onLoaded);
    media.addEventListener('seeked', onSeeked);
    media.addEventListener('error', finish, { once: true });
  });
  return { promise, cancel };
}

function waitForPlaying(media, timeoutMs = 100) {
  let finish;
  const promise = new Promise((resolve) => {
    let timer = null;
    const cleanup = () => {
      media.removeEventListener('playing', onPlaying);
      if (timer !== null) clearTimeout(timer);
    };
    finish = (started = false) => { cleanup(); resolve(started); };
    const onPlaying = () => finish(true);
    media.addEventListener('playing', onPlaying, { once: true });
    timer = setTimeout(() => finish(true), timeoutMs);
  });
  return { promise, cancel: () => finish(false) };
}

export function createScrubAudioController(deps) {
  const audioContext = deps.audioContext;
  const video = deps.video;
  const getBgm = deps.getBgm;
  const getMainGain = deps.getMainGain;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = deps.now ?? (() => globalThis.performance.now());
  const createAudioElement = deps.createAudioElement ?? (() => document.createElement('audio'));
  const AudioDecoderCtor = deps.AudioDecoderCtor ?? globalThis.AudioDecoder;
  const EncodedAudioChunkCtor = deps.EncodedAudioChunkCtor ?? globalThis.EncodedAudioChunk;
  let mode = 'off';
  let fragmentMs = 40;
  let sequence = 0;
  let generation = 0;
  let hiddenAudio = null;
  let hiddenGain = null;
  let mainActive = null;
  let bgmActive = null;
  let lastMediaStop = null;
  let pendingSeekCancel = null;
  let generationReason = 'stop';
  const seeks = [];
  const tracks = new Map();
  const decoders = new Map();
  const cache = new Map();
  const summaryExtra = {};

  function holdParamAt(param, at, valueAt) {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(at);
    } else {
      param.cancelScheduledValues?.(at);
    }
    // ramp は直前イベントから補間するため、at に明示的なアンカーが無いと
    // audio thread へ届いた瞬間に値が飛び、seek 到達時のクリックになる。
    param.setValueAtTime?.(valueAt ?? param.value, at);
  }

  function mediaGainAt(active, at) {
    if (active.fadeInAt === null || active.fadeInAt === undefined) return active.beforeFadeValue ?? active.gain.gain.value;
    if (at >= active.fadeInEnd) return 1;
    if (at <= active.fadeInAt) return 0;
    return (at - active.fadeInAt) / (active.fadeInEnd - active.fadeInAt);
  }

  function bufferGainAt(active, at) {
    if (at < active.startAt || at >= active.endAt) return 0;
    if (at < active.fadeInEnd) return (at - active.startAt) / (active.fadeInEnd - active.startAt);
    if (at < active.fadeOutStart) return 1;
    return (active.endAt - at) / (active.endAt - active.fadeOutStart);
  }

  function fadeMediaAndPause(active) {
    if (active.stopping) return active.settled;
    active.stopping = true;
    let resolveSettled;
    active.settled = new Promise(resolve => { resolveSettled = resolve; });
    const param = active.gain?.gain;
    if (!param) {
      active.media.pause();
      resolveSettled();
      return active.settled;
    }
    const at = audioContext.currentTime + SCHEDULE_LOOKAHEAD_SECONDS;
    holdParamAt(param, at, mediaGainAt(active, at));
    param.linearRampToValueAtTime?.(0, at + FADE_SECONDS);
    setTimeout(() => {
      active.media.pause();
      if (active.restoreGain) param.setValueAtTime?.(1, audioContext.currentTime);
      resolveSettled();
    }, (SCHEDULE_LOOKAHEAD_SECONDS + FADE_SECONDS) * 1000);
    return active.settled;
  }

  function fadeAndStop(active, reason = 'stop') {
    if (!active) return;
    if (active.media) {
      if (active.media === video && reason === 'seek') {
        // seek の fade → pause は audio-declick が同じ gain 上で担当する。
        // ここで automation を重ねると既存 ramp の途中値を飛ばしてしまう。
        active.stopping = true;
        return;
      }
      fadeMediaAndPause(active);
      if (active.kind === 'B') lastMediaStop = active;
      return;
    }
    // main thread で「今」に置いた automation は audio thread 到達時には過去になり得る。
    // 少し先を基準にして断片の頭・尻の ramp を確実に実行させる。
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

  function stopActive(invalidate = true, reason = 'stop') {
    if (invalidate) {
      generationReason = reason;
      generation++;
    }
    pendingSeekCancel?.();
    pendingSeekCancel = null;
    fadeAndStop(mainActive, reason);
    fadeAndStop(bgmActive, reason);
    mainActive = null;
    bgmActive = null;
  }

  async function ensureRunning() {
    if (audioContext.state === 'suspended') await audioContext.resume();
  }

  function startBuffer(buffer, target, destination, record, kind = 'main') {
    const duration = Math.min(fragmentMs / 1000, Math.max(0, buffer.duration - target));
    if (!(duration > 0)) return false;
    const fade = Math.min(FADE_SECONDS, duration / 2);
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(destination);
    // audio thread から見て過去の ramp にならないよう、開始を少し先へ予約する。
    const at = audioContext.currentTime + SCHEDULE_LOOKAHEAD_SECONDS;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(1, at + fade);
    gain.gain.setValueAtTime(1, at + duration - fade);
    gain.gain.linearRampToValueAtTime(0, at + duration);
    source.start(at, target, duration);
    const active = {
      source,
      gain,
      startAt: at,
      fadeInEnd: at + fade,
      fadeOutStart: at + duration - fade,
      endAt: at + duration,
    };
    if (kind === 'bgm') {
      bgmActive = active;
      record.bgmStartedCtxSec = at;
      record.bgmOffsetSec = target;
    } else {
      mainActive = active;
      record.mainStartedCtxSec = at;
      record.mainStartedPerfMs = now();
    }
    return true;
  }

  function startBgm(record) {
    const { node, spec } = getBgm?.() ?? {};
    const buffer = node?._buffer;
    if (!buffer || !spec) return 'no-buffer';
    const offset = resolveBgmOffset(record.outputTime, spec, buffer.duration);
    if (offset === null) return 'gap';
    return startBuffer(buffer, offset, node, record, 'bgm') ? null : 'gap';
  }

  function markSuperseded(record) {
    if (!record.skipped && !record.mainStartedCtxSec && !record.bgmStartedCtxSec) record.skipped = 'superseded';
  }

  async function runA(record, token) {
    const started = now();
    const waiter = waitForSeek(video, record.sourceTime, !sameMediaSource(video, record.src));
    pendingSeekCancel = waiter.cancel;
    await waiter.promise;
    if (pendingSeekCancel === waiter.cancel) pendingSeekCancel = null;
    record.seekCompleteMs = now() - started;
    if (token !== generation) { markSuperseded(record); return; }
    await ensureRunning();
    if (token !== generation) { markSuperseded(record); return; }
    startBgm(record);
    const gain = getMainGain?.();
    const param = gain?.gain;
    if (param) holdParamAt(param, audioContext.currentTime, 0);
    const playingWaiter = param ? waitForPlaying(video) : null;
    const active = {
      media: video,
      kind: 'A',
      gain,
      restoreGain: Boolean(param),
      beforeFadeValue: param ? 0 : null,
      fadeInAt: null,
      fadeInEnd: null,
    };
    mainActive = active;
    if (playingWaiter) pendingSeekCancel = playingWaiter.cancel;
    await video.play();
    if (playingWaiter) {
      const startedPlaying = await playingWaiter.promise;
      if (pendingSeekCancel === playingWaiter.cancel) pendingSeekCancel = null;
      if (!startedPlaying || token !== generation) { fadeAndStop(active, generationReason); markSuperseded(record); return; }
      const at = audioContext.currentTime + SCHEDULE_LOOKAHEAD_SECONDS;
      param.setValueAtTime(0, at);
      param.linearRampToValueAtTime(1, at + FADE_SECONDS);
      active.fadeInAt = at;
      active.fadeInEnd = at + FADE_SECONDS;
      record.mainStartedCtxSec = at;
      record.mainStartedPerfMs = now();
    } else {
      if (token !== generation) { fadeAndStop(active, generationReason); markSuperseded(record); return; }
      record.mainStartedCtxSec = audioContext.currentTime;
      record.mainStartedPerfMs = now();
    }
    setTimeout(() => {
      if (mainActive === active) {
        fadeAndStop(active, 'natural');
        mainActive = null;
      }
    }, fragmentMs);
  }

  function ensureHiddenAudio() {
    if (hiddenAudio) return;
    hiddenAudio = createAudioElement();
    hiddenAudio.preload = 'auto';
    hiddenAudio.crossOrigin = 'anonymous';
    const source = audioContext.createMediaElementSource(hiddenAudio);
    hiddenGain = audioContext.createGain();
    source.connect(hiddenGain);
    hiddenGain.connect(audioContext.destination);
  }

  async function runB(record, token) {
    ensureHiddenAudio();
    const started = now();
    const previousActive = lastMediaStop;
    if (previousActive?.settled) await previousActive.settled;
    if (token !== generation) { markSuperseded(record); return; }
    const sourceChanged = !sameMediaSource(hiddenAudio, record.src);
    const waiter = waitForSeek(hiddenAudio, record.sourceTime, sourceChanged);
    pendingSeekCancel = waiter.cancel;
    if (sourceChanged) hiddenAudio.src = record.src;
    hiddenAudio.volume = video.volume;
    hiddenAudio.currentTime = record.sourceTime;
    await waiter.promise;
    if (pendingSeekCancel === waiter.cancel) pendingSeekCancel = null;
    record.seekCompleteMs = now() - started;
    if (token !== generation) { markSuperseded(record); return; }
    await ensureRunning();
    if (token !== generation) { markSuperseded(record); return; }
    const beforePlay = audioContext.currentTime;
    hiddenGain.gain.cancelScheduledValues(beforePlay);
    hiddenGain.gain.setValueAtTime(0, beforePlay);
    startBgm(record);
    const playingWaiter = waitForPlaying(hiddenAudio);
    const active = {
      media: hiddenAudio,
      kind: 'B',
      gain: hiddenGain,
      beforeFadeValue: 0,
      fadeInAt: null,
      fadeInEnd: null,
    };
    mainActive = active;
    pendingSeekCancel = playingWaiter.cancel;
    await hiddenAudio.play();
    const startedPlaying = await playingWaiter.promise;
    if (pendingSeekCancel === playingWaiter.cancel) pendingSeekCancel = null;
    if (!startedPlaying || token !== generation) { fadeAndStop(active); markSuperseded(record); return; }
    const at = audioContext.currentTime + SCHEDULE_LOOKAHEAD_SECONDS;
    hiddenGain.gain.setValueAtTime(0, at);
    hiddenGain.gain.linearRampToValueAtTime(1, at + FADE_SECONDS);
    active.fadeInAt = at;
    active.fadeInEnd = at + FADE_SECONDS;
    record.mainStartedCtxSec = at;
    record.mainStartedPerfMs = now();
    mainActive = active;
    setTimeout(() => {
      if (mainActive === active) {
        fadeAndStop(active, 'natural');
        mainActive = null;
      }
    }, fragmentMs);
  }

  async function trackFor(src) {
    let track = tracks.get(src);
    if (!track) {
      track = new Mp4AudioTrack({ src, fetchFn, now });
      tracks.set(src, track);
    }
    await track.open();
    summaryExtra.moovBytes = track.moovBytes;
    summaryExtra.moovLoadMs = track.moovLoadMs;
    summaryExtra.elstIgnored = track.info.elstIgnored || undefined;
    return track;
  }

  async function decoderFor(src, config, outputs) {
    let holder = decoders.get(src);
    if (holder?.busy) {
      try { holder.decoder.close(); } catch { /* superseded decode */ }
      holder = null;
    }
    if (!holder || holder.decoder.state === 'closed') {
      if (!AudioDecoderCtor || !EncodedAudioChunkCtor) throw new Error('WebCodecs audio decoder unavailable');
      if (typeof AudioDecoderCtor.isConfigSupported === 'function') {
        const support = await AudioDecoderCtor.isConfigSupported(config);
        if (!support.supported) throw new Error(`unsupported audio decoder: ${config.codec}`);
      }
      holder = { decoder: null, outputs, busy: false };
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

  async function decodeWindow(track, window, record) {
    const key = `${track.src}|${window.packets[0].index}-${window.packets.at(-1).index}`;
    if (cache.has(key)) {
      const hit = cache.get(key);
      cache.delete(key);
      cache.set(key, hit);
      record.fetchMs = 0;
      record.bytes = 0;
      record.decodeMs = 0;
      record.cacheHit = true;
      return hit;
    }
    record.cacheHit = false;
    const fetchStarted = now();
    let byteCount = 0;
    const fetched = [];
    for (const range of window.ranges) {
      const result = await fetchRange(fetchFn, track.src, range.start, range.end);
      byteCount += result.bytes.byteLength;
      fetched.push({ ...range, bytes: result.bytes });
    }
    record.fetchMs = now() - fetchStarted;
    record.bytes = byteCount;
    const config = {
      codec: track.info.codec,
      sampleRate: track.info.sampleRate,
      numberOfChannels: track.info.numberOfChannels,
      description: track.info.description,
    };
    summaryExtra.decoderConfig = {
      ...config,
      description: Array.from(config.description),
    };
    const outputs = [];
    const holder = await decoderFor(track.src, config, outputs);
    const decodeStarted = now();
    try {
      for (const packet of window.packets) {
        const range = fetched.find(item => packet.offset >= item.start && packet.offset + packet.size - 1 <= item.end);
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
    record.decodeMs = now() - decodeStarted;
    outputs.sort((a, b) => a.timestamp - b.timestamp);
    if (!outputs.length) throw new Error('AudioDecoder produced no output');
    const channels = outputs[0].numberOfChannels;
    const sampleRate = outputs[0].sampleRate;
    const frames = outputs.reduce((sum, data) => sum + data.numberOfFrames, 0);
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
    const item = { src: track.src, buffer, startSec: window.windowStartSec, endSec: window.windowEndSec };
    cache.set(key, item);
    while (cache.size > WINDOW_CACHE_SIZE) cache.delete(cache.keys().next().value);
    return item;
  }

  async function runC(record, token) {
    const track = await trackFor(record.src);
    let decoded = null;
    let cacheKey = null;
    for (const [key, item] of cache) {
      if (item.src === record.src && record.sourceTime >= item.startSec && record.sourceTime < item.endSec) {
        decoded = item;
        cacheKey = key;
        break;
      }
    }
    if (decoded) {
      cache.delete(cacheKey);
      cache.set(cacheKey, decoded);
      record.fetchMs = 0;
      record.bytes = 0;
      record.decodeMs = 0;
      record.cacheHit = true;
    } else {
      const window = track.packetsAround(record.sourceTime, 3);
      if (!window.packets.length) { record.skipped = 'gap'; return; }
      decoded = await decodeWindow(track, window, record);
    }
    if (token !== generation) { markSuperseded(record); return; }
    await ensureRunning();
    if (token !== generation) { markSuperseded(record); return; }
    startBgm(record);
    const offset = Math.max(0, record.sourceTime - decoded.startSec);
    if (!startBuffer(decoded.buffer, offset, audioContext.destination, record)) record.skipped = 'gap';
  }

  function onSeek(input) {
    if (mode === 'off') return;
    stopActive(false, 'seek');
    generationReason = 'seek';
    const token = ++generation;
    const record = emptyRecord(++sequence, mode, input, now(), audioContext.currentTime);
    seeks.push(record);
    if (input.isPlaying) { record.skipped = 'playing'; return; }
    const run = mode === 'A' ? runA(record, token) : mode === 'B' ? runB(record, token) : runC(record, token);
    Promise.resolve(run).catch((error) => {
      if (token !== generation) { markSuperseded(record); return; }
      record.error = errorMessage(error);
      record.skipped ??= 'error';
    });
  }

  return {
    get mode() { return mode; },
    set mode(value) {
      if (!SCRUB_MODES.includes(value)) throw new TypeError(`invalid scrub audio mode: ${value}`);
      if (mode !== value) stopActive(true, 'stop');
      mode = value;
      const src = video?.currentSrc || video?.src;
      if (mode === 'C' && src) trackFor(src).catch(error => { summaryExtra.openError = errorMessage(error); });
    },
    get active() { return mode !== 'off'; },
    get fragmentMs() { return fragmentMs; },
    set fragmentMs(value) {
      if (!Number.isFinite(value) || value <= 0) throw new TypeError('fragmentMs must be positive');
      fragmentMs = value;
    },
    idleMs: 150,
    onSeek,
    stop() { stopActive(true, 'stop'); },
    stats() {
      return {
        mode,
        fragmentMs,
        seeks: seeks.map(record => ({ ...record })),
        summary: {
          count: seeks.length,
          played: seeks.filter(record => record.mainStartedCtxSec !== null || record.bgmStartedCtxSec !== null).length,
          skipped: seeks.filter(record => record.skipped !== null).length,
          errors: seeks.filter(record => record.error !== null).length,
          ...summaryExtra,
        },
      };
    },
    reset() { seeks.length = 0; },
    get context() { return audioContext; },
  };
}
