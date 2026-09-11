function readType(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1),
    view.getUint8(offset + 2), view.getUint8(offset + 3),
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

function parseTimescale(bytes, box, versionOneOffset, versionZeroOffset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint8(box.body) === 1
    ? view.getUint32(box.body + versionOneOffset)
    : view.getUint32(box.body + versionZeroOffset);
}

function parseStsd(bytes, box) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entry = boxes(bytes, box.body + 8, box.end)[0];
  if (!entry) throw new Error('audio sample entry not found');
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
  if (entry.type !== 'mp4a') {
    return { codec: entry.type, sampleRate, numberOfChannels, description: null, supported: false };
  }
  const children = boxes(bytes, childOffset, entry.end);
  const wave = children.find(item => item.type === 'wave');
  const esds = children.find(item => item.type === 'esds')
    ?? (wave && boxes(bytes, wave.body, wave.end).find(item => item.type === 'esds'));
  const description = esds && descriptor(bytes, esds.body + 4, esds.end, 0x05);
  if (!description?.length) {
    return { codec: 'mp4a', sampleRate, numberOfChannels, description: null, supported: false };
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
    supported: true,
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
  if (result.length !== sampleCount) throw new Error('stts/stsz sample count mismatch');
  return result;
}

function readSigned64(view, offset) {
  const value = view.getBigInt64(offset);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('elst media_time is outside the safe integer range');
  return number;
}

function editOffset(bytes, trak, movieTimescale, mediaTimescale) {
  const edts = child(bytes, trak, 'edts');
  const elst = edts && child(bytes, edts, 'elst');
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
    if (entryMediaTime >= 0) { mediaTime = entryMediaTime; break; }
  }
  return { editOffsetTicks: Math.round(mediaTime - delayTicks), hasEditList: true };
}

export function parseMp4AudioTrack(bytes) {
  const moov = boxes(bytes).find(box => box.type === 'moov');
  if (!moov) throw new Error('moov box not found');
  const mvhd = child(bytes, moov, 'mvhd');
  if (!mvhd) throw new Error('mvhd box not found');
  const movieTimescale = parseTimescale(bytes, mvhd, 20, 12);
  let selected = null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const trak of boxes(bytes, moov.body, moov.end).filter(box => box.type === 'trak')) {
    const mdia = child(bytes, trak, 'mdia');
    const hdlr = mdia && child(bytes, mdia, 'hdlr');
    if (hdlr && readType(view, hdlr.body + 8) === 'soun') { selected = { trak, mdia }; break; }
  }
  if (!selected) throw new Error('audio track not found');
  const mdhd = child(bytes, selected.mdia, 'mdhd');
  const minf = child(bytes, selected.mdia, 'minf');
  const stbl = minf && child(bytes, minf, 'stbl');
  if (!mdhd || !stbl) throw new Error('incomplete audio sample table');
  const tables = new Map(boxes(bytes, stbl.body, stbl.end).map(box => [box.type, box]));
  const stsd = tables.get('stsd');
  const stts = tables.get('stts');
  const stsc = tables.get('stsc');
  const stsz = tables.get('stsz');
  const stco = tables.get('stco') ?? tables.get('co64');
  if (!stsd || !stts || !stsc || !stsz || !stco) throw new Error('incomplete audio sample table');

  const timescale = parseTimescale(bytes, mdhd, 20, 12);
  const config = parseStsd(bytes, stsd);
  const sizes = parseStsz(bytes, stsz);
  const durations = expandDurations(parseTable(bytes, stts, 8, (data, at) => ({
    count: data.getUint32(at), delta: data.getUint32(at + 4),
  })), sizes.length);
  const mappings = parseTable(bytes, stsc, 12, (data, at) => ({
    firstChunk: data.getUint32(at), samplesPerChunk: data.getUint32(at + 4),
  }));
  const wide = stco.type === 'co64';
  const chunks = parseTable(bytes, stco, wide ? 8 : 4, (data, at) => wide
    ? Number(data.getBigUint64(at)) : data.getUint32(at));
  const samples = [];
  let sampleIndex = 0;
  let dts = 0;
  for (let chunkIndex = 0; chunkIndex < chunks.length && sampleIndex < sizes.length; chunkIndex++) {
    let mapping = mappings[0];
    for (const candidate of mappings) {
      if (candidate.firstChunk <= chunkIndex + 1) mapping = candidate;
      else break;
    }
    if (!mapping) throw new Error('stsc has no chunk mapping');
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
  if (sampleIndex !== sizes.length) throw new Error('stsc did not map every audio sample');
  const edits = editOffset(bytes, selected.trak, movieTimescale, timescale);
  return {
    ...config,
    timescale,
    ...edits,
    editOffsetSec: edits.editOffsetTicks / timescale,
    samples,
    durationSec: (dts - edits.editOffsetTicks) / timescale,
  };
}

function contentRangeTotal(response) {
  const value = response.headers?.get?.('content-range') ?? '';
  const match = /\/(\d+)$/.exec(value);
  return match ? Number(match[1]) : null;
}

export async function fetchRange(fetchFn, src, start, end) {
  const response = await fetchFn(src, { headers: { Range: `bytes=${start}-${end}` } });
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

  get isOpen() { return this.info !== null; }

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
    const loaded = await fetchRange(
      this.fetchFn, this.src, moovHeader.offset, moovHeader.offset + moovHeader.size - 1,
    );
    this.moovBytes = loaded.bytes.byteLength;
    this.moovLoadMs = this.now() - started;
    this.info = parseMp4AudioTrack(loaded.bytes);
    return this;
  }

  packetsAround(tSec, { before = 1, after = 5 } = {}) {
    if (!this.info) throw new Error('track is not open');
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
      if (previous && previous.end + 1 === packet.offset) previous.end = packet.offset + packet.size - 1;
      else ranges.push({ start: packet.offset, end: packet.offset + packet.size - 1 });
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
      windowEndSec: (rawEndTick - this.info.editOffsetTicks) / this.info.timescale,
    };
  }

  decoderConfig() {
    if (!this.info) throw new Error('track is not open');
    const { codec, sampleRate, numberOfChannels, description } = this.info;
    return { codec, sampleRate, numberOfChannels, description };
  }
}
