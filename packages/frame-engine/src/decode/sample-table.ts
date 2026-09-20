import * as MP4BoxNamespace from '@webav/mp4box.js';
import { readVideoCodecFromMoov } from './codec-probe.js';
import { calculateDecoderTimestampOffsetUs, type MediaEdit } from './keyframe-index.js';
import {
  childBoxes,
  describeIndexParseFailure,
  readBoxAt,
  typeAt,
  uint32,
  videoOnlyIndexHeader,
  type Mp4BoxLocation,
} from './mp4-boxes.js';

const MP4Box: typeof MP4BoxNamespace =
  (MP4BoxNamespace as unknown as { default?: typeof MP4BoxNamespace }).default ?? MP4BoxNamespace;

export interface Mp4VideoSample {
  offset: number;
  size: number;
  dts: number;
  cts: number;
  duration: number;
  timescale: number;
  isSync: boolean;
  timestampUs: number;
  durationUs: number;
  decodeIndex: number;
  presentationIndex: number;
  decodeEndIndex: number;
}

export interface Mp4VideoSampleTable {
  samples: Mp4VideoSample[];
  presentationOrder: number[];
  codec: string;
  fourcc: string;
  description: Uint8Array;
  codedWidth: number;
  codedHeight: number;
  width: number;
  height: number;
  rotationDeg: number;
  maxReorderFrames: number;
  decoderTimestampOffsetUs: number;
  presentationDurationUs: number;
  lastFrameStartUs: number;
}

export function summarizeSampleTiming(samples: readonly Mp4VideoSample[]): {
  maxReorderFrames: number;
  sampleDurationUs: number;
} {
  let maxReorderFrames = 0;
  let sampleDurationUs = 0;
  for (const sample of samples) {
    maxReorderFrames = Math.max(
      maxReorderFrames,
      Math.abs(sample.decodeIndex - sample.presentationIndex),
    );
    sampleDurationUs = Math.max(sampleDurationUs, sample.timestampUs + sample.durationUs);
  }
  return { maxReorderFrames, sampleDurationUs };
}

interface RawSample {
  offset: number;
  size: number;
  dts: number;
  cts: number;
  duration: number;
  timescale: number;
  is_sync: boolean;
}

interface ParsedTrack {
  id: number;
  timescale: number;
  duration: number;
  edits?: MediaEdit[];
  video?: { width?: number; height?: number };
}

interface ParsedInfo {
  timescale: number;
  videoTracks: ParsedTrack[];
}

function reverseBits32(value: number): number {
  let source = value >>> 0;
  let reversed = 0;
  for (let bit = 0; bit < 32; bit += 1) {
    reversed = ((reversed << 1) | (source & 1)) >>> 0;
    source >>>= 1;
  }
  return reversed >>> 0;
}

export function hevcCodecString(fourcc: string, hvcc: Uint8Array): string {
  if (hvcc.length < 13 || hvcc[0] !== 1) throw new Error('invalid or unsupported hvcC record');
  const profileSpace = ['', 'A', 'B', 'C'][(hvcc[1]! >>> 6) & 3] ?? '';
  const tier = (hvcc[1]! & 0x20) === 0 ? 'L' : 'H';
  const profileIdc = hvcc[1]! & 0x1f;
  const compatibility = reverseBits32(uint32(hvcc, 2)).toString(16).toUpperCase();
  const constraints = [...hvcc.subarray(6, 12)];
  while (constraints.at(-1) === 0) constraints.pop();
  const suffix = constraints.length
    ? `.${constraints.map(value => value.toString(16).toUpperCase().padStart(2, '0')).join('.')}`
    : '';
  return `${fourcc}.${profileSpace}${profileIdc}.${compatibility}.${tier}${hvcc[12]}${suffix}`;
}

export function avcCodecString(fourcc: string, avcc: Uint8Array): string {
  if (avcc.length < 4 || avcc[0] !== 1) throw new Error('invalid or unsupported avcC record');
  return `${fourcc}.${[...avcc.subarray(1, 4)]
    .map(value => value.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
}

function videoDescription(bytes: Uint8Array): {
  fourcc: string;
  codec: string;
  description: Uint8Array;
  codedWidth: number;
  codedHeight: number;
} {
  const moov = childBoxes(bytes, 0, bytes.byteLength).find(box => box.type === 'moov');
  if (!moov) throw new Error('moov box is missing');
  for (const trak of childBoxes(bytes, moov.dataStart, moov.end).filter(box => box.type === 'trak')) {
    const mdia = childBoxes(bytes, trak.dataStart, trak.end).find(box => box.type === 'mdia');
    if (!mdia) continue;
    const mdiaChildren = childBoxes(bytes, mdia.dataStart, mdia.end);
    const hdlr = mdiaChildren.find(box => box.type === 'hdlr');
    if (!hdlr || hdlr.dataStart + 12 > hdlr.end || typeAt(bytes, hdlr.dataStart + 8) !== 'vide') continue;
    const minf = mdiaChildren.find(box => box.type === 'minf');
    if (!minf) continue;
    const stbl = childBoxes(bytes, minf.dataStart, minf.end).find(box => box.type === 'stbl');
    if (!stbl) continue;
    const stsd = childBoxes(bytes, stbl.dataStart, stbl.end).find(box => box.type === 'stsd');
    if (!stsd || stsd.dataStart + 8 > stsd.end) continue;
    const entryCount = uint32(bytes, stsd.dataStart + 4);
    let cursor = stsd.dataStart + 8;
    for (let index = 0; index < entryCount; index += 1) {
      const entry = readBoxAt(bytes, cursor, stsd.end);
      if (!entry) throw new Error('invalid stsd video entry');
      cursor = entry.end;
      if (!['avc1', 'avc3', 'hvc1', 'hev1'].includes(entry.type)) continue;
      if (entry.dataStart + 78 > entry.end) throw new Error(`truncated ${entry.type} sample entry`);
      const codedWidth = new DataView(
        bytes.buffer, bytes.byteOffset + entry.dataStart + 24, 2,
      ).getUint16(0);
      const codedHeight = new DataView(
        bytes.buffer, bytes.byteOffset + entry.dataStart + 26, 2,
      ).getUint16(0);
      const configType = entry.type.startsWith('avc') ? 'avcC' : 'hvcC';
      const config = childBoxes(bytes, entry.dataStart + 78, entry.end)
        .find(box => box.type === configType);
      if (!config) throw new Error(`${entry.type} sample entry has no ${configType}`);
      const description = bytes.slice(config.dataStart, config.end);
      return {
        fourcc: entry.type,
        codec: configType === 'avcC'
          ? avcCodecString(entry.type, description)
          : hevcCodecString(entry.type, description),
        description,
        codedWidth,
        codedHeight,
      };
    }
  }
  throw new Error('supported video sample description not found');
}

function presentationMediaTime(edits: readonly MediaEdit[] | undefined, firstDts: number): number {
  return edits?.find(edit => edit.media_time >= 0
    && edit.media_rate_integer === 1
    && edit.media_rate_fraction === 0)?.media_time ?? firstDts;
}

export function buildVideoSampleTable(rawHeader: ArrayBuffer): Promise<Mp4VideoSampleTable> {
  const header = videoOnlyIndexHeader(rawHeader);
  return new Promise((resolve, reject) => {
    const bytes = new Uint8Array(header);
    let description: ReturnType<typeof videoDescription>;
    try {
      description = videoDescription(bytes);
    } catch (error) {
      reject(error);
      return;
    }
    const file = MP4Box.createFile();
    file.onError = message => reject(new Error(`mp4box parse error: ${message}`));
    file.onReady = rawInfo => {
      try {
        const info = rawInfo as unknown as ParsedInfo;
        const track = info.videoTracks[0];
        if (!track) throw new Error('MP4 has no video track');
        const rawSamples = file.getTrackSamplesInfo(track.id) as unknown as RawSample[];
        if (rawSamples.length === 0) throw new Error('video sample table is empty');
        const firstDts = rawSamples[0]!.dts;
        const mediaTime = presentationMediaTime(track.edits, firstDts);
        const decoderTimestampOffsetUs = calculateDecoderTimestampOffsetUs(
          firstDts, track.timescale, track.edits,
        );
        const samples = rawSamples.map((sample, decodeIndex): Mp4VideoSample => ({
          offset: sample.offset,
          size: sample.size,
          dts: sample.dts,
          cts: sample.cts,
          duration: sample.duration,
          timescale: sample.timescale,
          isSync: sample.is_sync,
          timestampUs: Math.round(((sample.cts - mediaTime) / sample.timescale) * 1e6),
          durationUs: Math.max(1, Math.round((sample.duration / sample.timescale) * 1e6)),
          decodeIndex,
          presentationIndex: -1,
          decodeEndIndex: decodeIndex,
        }));
        const presentationOrder = samples.map(sample => sample.decodeIndex).sort((left, right) => {
          const difference = samples[left]!.timestampUs - samples[right]!.timestampUs;
          return difference || left - right;
        });
        let decodeEndIndex = 0;
        presentationOrder.forEach((decodeIndex, presentationIndex) => {
          decodeEndIndex = Math.max(decodeEndIndex, decodeIndex);
          samples[decodeIndex]!.presentationIndex = presentationIndex;
          samples[decodeIndex]!.decodeEndIndex = decodeEndIndex;
        });
        for (let presentationIndex = 0; presentationIndex < presentationOrder.length - 1; presentationIndex += 1) {
          const sample = samples[presentationOrder[presentationIndex]!]!;
          const next = samples[presentationOrder[presentationIndex + 1]!]!;
          const untilNextUs = next.timestampUs - sample.timestampUs;
          if (untilNextUs > 0) sample.durationUs = Math.min(sample.durationUs, untilNextUs);
        }
        const { maxReorderFrames, sampleDurationUs } = summarizeSampleTiming(samples);
        const editDuration = track.edits?.reduce((sum, edit) => sum + edit.segment_duration, 0) ?? 0;
        const presentationDurationUs = editDuration > 0 && info.timescale > 0
          ? Math.round((editDuration / info.timescale) * 1e6)
          : sampleDurationUs;
        const lastFrameStartUs = samples[presentationOrder.at(-1)!]!.timestampUs;
        const rotationDeg = readVideoCodecFromMoov(header)?.rotationDeg ?? 0;
        const swapsDimensions = rotationDeg === 90 || rotationDeg === 270;
        resolve({
          ...description,
          width: swapsDimensions ? description.codedHeight : description.codedWidth,
          height: swapsDimensions ? description.codedWidth : description.codedHeight,
          rotationDeg,
          maxReorderFrames,
          samples,
          presentationOrder,
          decoderTimestampOffsetUs,
          presentationDurationUs: Math.max(presentationDurationUs, lastFrameStartUs + 1),
          lastFrameStartUs,
        });
      } catch (error) {
        reject(error);
      }
    };
    const buffer = header as ArrayBuffer & { fileStart: number };
    buffer.fileStart = 0;
    try {
      file.appendBuffer(buffer);
      file.flush();
    } catch (error) {
      // MP4Box は appendBuffer の中で同期 throw する。ここで受けないと素の
      // `RangeError: Invalid array length` がそのまま利用者へ出て、どの素材のどの段で
      // 失敗したのか分からない（不具合メモ 第1項: 例外スタック・最小再現が採取できなかった）。
      reject(describeIndexParseFailure(error, 'video sample table', header.byteLength));
    }
  });
}

export function sampleAtPresentationTime(
  table: Mp4VideoSampleTable,
  targetUs: number,
): Mp4VideoSample {
  const order = table.presentationOrder;
  let low = 0;
  let high = order.length - 1;
  if (targetUs <= table.samples[order[0]!]!.timestampUs) return table.samples[order[0]!]!;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (table.samples[order[middle]!]!.timestampUs <= targetUs) low = middle;
    else high = middle - 1;
  }
  const previous = table.samples[order[low]!]!;
  if (!resolveNearestFrameDefault() || low === order.length - 1) return previous;
  const next = table.samples[order[low + 1]!]!;
  return targetUs - previous.timestampUs <= next.timestampUs - targetUs ? previous : next;
}

export function resolveNearestFrameDefault(): boolean {
  const runtime = globalThis as typeof globalThis & {
    __AKARI_FRAME_ENGINE_NEAREST__?: unknown;
    process?: { env?: Record<string, string | undefined> };
  };
  const explicit = runtime.__AKARI_FRAME_ENGINE_NEAREST__
    ?? runtime.process?.env?.AKARI_FRAME_ENGINE_NEAREST;
  if (explicit === undefined || explicit === null || explicit === '') return true;
  return explicit !== false && explicit !== '0' && explicit !== 'false';
}

/** Last decode-order sample required to make every presentation sample through target available. */
export function decodeEndForPresentationSample(
  _table: Mp4VideoSampleTable,
  target: Mp4VideoSample,
): number {
  return target.decodeEndIndex;
}

export function precedingSyncSample(table: Mp4VideoSampleTable, decodeIndex: number): number {
  for (let index = decodeIndex; index >= 0; index -= 1) {
    if (table.samples[index]!.isSync) return index;
  }
  return 0;
}
