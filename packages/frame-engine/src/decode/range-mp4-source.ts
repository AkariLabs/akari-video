import { withTimeout } from './guard.js';
import { evaluateCodecSupport, type CodecSupport } from './codec-probe.js';
import { buildKeyframeIndexFromHeader, type KeyframeIndex } from './keyframe-index.js';
import {
  buildVideoSampleTable,
  decodeEndForPresentationSample,
  precedingSyncSample,
  sampleAtPresentationTime,
  type Mp4VideoSample,
  type Mp4VideoSampleTable,
} from './sample-table.js';

export const DEFAULT_RANGE_CACHE_BYTES = 64 * 1024 * 1024;
const INITIAL_HEADER_BYTES = 16;
const MAX_TOP_LEVEL_BOXES = 64;
const OUTPUT_GRACE_MS = 250;
// 詰まったデコーダの flush は返らないことがあるので上限を置く。健全な flush はキュー済み
// フレーム（GOP 1 本ぶん・4K でも十数枚）を吐くだけで数百 ms に収まる。実機 2026-09-05 では
// 黙ったデコーダの flush が返らず、ここが 5 s だと凍結が 4〜5 秒になった。
// decodeTimeoutMs を小さくしたテストではそちらに合わせる（min を取る）。
const DECODER_FLUSH_TIMEOUT_MS = 1_000;
// 入力を受け取ったのに dequeue が 1 回も来ない時間の上限。デコーダは 1 チャンク処理するごとに
// dequeue を発火するので、健全なら 4K HEVC でも数十 ms 間隔。これが 2 秒途切れたら死んでいる
// （実機 2026-09-05: queue=2 のまま dequeue も出力も無く、10 秒の全体 timeout まで待っていた）。
// 「遅れて出す」正当なデコーダは dequeue はすぐ発火するので、この上限には掛からない。
const DECODER_DEQUEUE_TIMEOUT_MS = 2_000;

export interface ByteRange {
  start: number;
  end: number;
}

export interface RangeFetchStats {
  requests: number;
  bytes: number;
  headerBytes: number;
  mediaBytes: number;
  maxDecodeQueueSize: number;
  fullBodyFallback: boolean;
  fullBodyBytes: number;
  maxFutureFrames: number;
  /** GOP を供給し切って出力を 250 ms 待った回数（デコーダが詰まった兆候）。 */
  graceWaits: number;
  /** target より後のフレームが先に出て「target は来ない」と即断した回数（デコーダがフレームを落とした兆候）。 */
  targetSkips: number;
  /** target が出ず sync から再シークした回数。 */
  droppedTargets: number;
}

interface CachedRange extends ByteRange {
  data: Uint8Array;
  used: number;
}

interface OpenedHeader {
  header: ArrayBuffer;
  totalBytes: number;
}

interface PreparedRangeSource {
  table: Mp4VideoSampleTable;
  keyframes: KeyframeIndex;
  totalBytes: number;
}

export interface RangeMp4SourceOptions {
  fetchImpl?: typeof fetch;
  cacheBytes?: number;
  loadTimeoutMs?: number;
  decodeTimeoutMs?: number;
  hardwareAcceleration?: HardwarePreference;
  codecSupport?: CodecSupport | null;
  /**
   * VideoDecoderConfig.optimizeForLatency。既定 false（2026-09-02）。true だと macOS の VideoToolbox が
   * 負荷時にフレームを落とす（投入済みなのに二度と出てこない）ことを実機で観測し、その 1 フレームが
   * 「GOP 末尾まで供給 → 250 ms 猶予 → flush → 失敗 → 作り直し」の連鎖を毎フレーム起こしていた。
   * 順方向の供給はデコーダの遅延ぶん（実測 +4 サンプル）を rounds で足すので、false でも seek 遅延は増えない。
   * 実験用に AKARI_FRAME_ENGINE_LOW_LATENCY=1 / globalThis.__AKARI_FRAME_ENGINE_LOW_LATENCY__ で戻せる。
   */
  optimizeForLatency?: boolean;
  onWarning?: (message: string) => void;
  onCodecSupport?: (support: CodecSupport) => void;
  onSoftwareFallbackDenied?: (support: CodecSupport) => void;
}

export function resolveOptimizeForLatencyDefault(): boolean {
  const runtime = globalThis as typeof globalThis & {
    __AKARI_FRAME_ENGINE_LOW_LATENCY__?: unknown;
    process?: { env?: Record<string, string | undefined> };
  };
  const explicit = runtime.__AKARI_FRAME_ENGINE_LOW_LATENCY__ ?? runtime.process?.env?.AKARI_FRAME_ENGINE_LOW_LATENCY;
  if (explicit === undefined || explicit === null || explicit === '') return false;
  return explicit === true || explicit === '1' || explicit === 'true';
}

function uint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

function topLevelHeader(bytes: Uint8Array, totalBytes: number, start: number): {
  type: string;
  size: number;
  headerSize: number;
} {
  if (bytes.byteLength < 8) throw new Error(`truncated MP4 box header at byte ${start}`);
  let size = uint32(bytes, 0);
  const type = String.fromCharCode(...bytes.subarray(4, 8));
  let headerSize = 8;
  if (size === 1) {
    if (bytes.byteLength < 16) throw new Error(`truncated extended-size ${type} box`);
    const large = new DataView(bytes.buffer, bytes.byteOffset + 8, 8).getBigUint64(0);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${type} box is too large`);
    size = Number(large);
    headerSize = 16;
  } else if (size === 0) {
    size = totalBytes - start;
  }
  if (size < headerSize || start + size > totalBytes) {
    throw new Error(`invalid ${type} box at byte ${start} (size ${size})`);
  }
  return { type, size, headerSize };
}

function responseTotal(response: Response, requestedStart: number): number | null {
  const contentRange = response.headers.get('content-range');
  const match = contentRange?.match(/\/([0-9]+)$/u);
  if (match) return Number(match[1]);
  const rawContentLength = response.headers.get('content-length');
  if (rawContentLength == null || rawContentLength.trim() === '') return null;
  const contentLength = Number(rawContentLength);
  if (requestedStart === 0 && response.status === 200
    && Number.isFinite(contentLength) && contentLength >= 0) {
    return contentLength;
  }
  return null;
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) throw new Error(`Range response has no body (${response.status})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < limit) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = limit - length;
      const chunk = next.value.byteLength > remaining ? next.value.subarray(0, remaining) : next.value;
      chunks.push(chunk.slice());
      length += chunk.byteLength;
      if (next.value.byteLength > remaining) break;
    }
  } finally {
    if (length >= limit) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

class HttpRangeReader {
  readonly stats: RangeFetchStats = {
    requests: 0,
    bytes: 0,
    headerBytes: 0,
    mediaBytes: 0,
    maxDecodeQueueSize: 0,
    fullBodyFallback: false,
    fullBodyBytes: 0,
    maxFutureFrames: 0,
    graceWaits: 0,
    targetSkips: 0,
    droppedTargets: 0,
  };
  private readonly fetchImpl: typeof fetch;
  private readonly onWarning?: (message: string) => void;
  private fullBody: Uint8Array | null = null;
  private fullBodyPromise: Promise<Uint8Array> | null = null;
  private fallbackWarned = false;

  constructor(readonly url: string, fetchImpl?: typeof fetch, onWarning?: (message: string) => void) {
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.onWarning = onWarning;
  }

  private warnFallback(): void {
    if (this.fallbackWarned) return;
    this.fallbackWarned = true;
    this.onWarning?.(`${this.url}: this host does not support byte ranges; loading the full source once`);
  }

  private recordBytes(bytes: number, kind: 'header' | 'media'): void {
    this.stats.bytes += bytes;
    if (kind === 'header') this.stats.headerBytes += bytes;
    else this.stats.mediaBytes += bytes;
  }

  private async loadFullBody(
    kind: 'header' | 'media',
    response?: Response,
  ): Promise<Uint8Array> {
    this.warnFallback();
    this.stats.fullBodyFallback = true;
    this.fullBodyPromise ??= (async () => {
      let fullResponse = response;
      if (!fullResponse) {
        fullResponse = await this.fetchImpl(this.url);
        this.stats.requests += 1;
        if (!fullResponse.ok) throw new Error(`full source fetch failed: ${fullResponse.status}`);
      }
      const bytes = new Uint8Array(await fullResponse.arrayBuffer());
      this.recordBytes(bytes.byteLength, kind);
      this.stats.fullBodyBytes = bytes.byteLength;
      this.fullBody = bytes;
      return bytes;
    })();
    return this.fullBodyPromise;
  }

  async read(start: number, end: number, kind: 'header' | 'media'): Promise<{
    bytes: Uint8Array;
    totalBytes: number | null;
  }> {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
      throw new Error(`invalid byte range [${start}, ${end})`);
    }
    if (this.fullBody) {
      if (start >= this.fullBody.byteLength) {
        throw new Error(`byte range starts beyond full source (${this.fullBody.byteLength})`);
      }
      return {
        bytes: this.fullBody.subarray(start, Math.min(end, this.fullBody.byteLength)),
        totalBytes: this.fullBody.byteLength,
      };
    }
    const response = await this.fetchImpl(this.url, {
      headers: { Range: `bytes=${start}-${end - 1}` },
    });
    this.stats.requests += 1;
    if (!response.ok) throw new Error(`Range fetch failed: ${response.status}`);
    if (response.status !== 206) {
      const full = await this.loadFullBody(kind, response);
      if (start >= full.byteLength) throw new Error(`byte range starts beyond full source (${full.byteLength})`);
      return { bytes: full.subarray(start, Math.min(end, full.byteLength)), totalBytes: full.byteLength };
    }
    const totalBytes = responseTotal(response, start);
    if (totalBytes == null) {
      await response.body?.cancel().catch(() => undefined);
      const full = await this.loadFullBody(kind);
      if (start >= full.byteLength) throw new Error(`byte range starts beyond full source (${full.byteLength})`);
      return { bytes: full.subarray(start, Math.min(end, full.byteLength)), totalBytes: full.byteLength };
    }
    const expectedLength = totalBytes == null ? end - start : Math.min(end, totalBytes) - start;
    const bytes = await readLimited(response, expectedLength);
    if (bytes.byteLength !== expectedLength) {
      throw new Error(`truncated Range response [${start}, ${end}): ${bytes.byteLength} bytes`);
    }
    this.recordBytes(bytes.byteLength, kind);
    return { bytes, totalBytes };
  }
}

export async function fetchMp4Header(
  url: string,
  options: { fetchImpl?: typeof fetch; initialBytes?: number; onWarning?: (message: string) => void } = {},
): Promise<OpenedHeader & { stats: RangeFetchStats }> {
  const reader = new HttpRangeReader(url, options.fetchImpl, options.onWarning);
  const opened = await scanMp4Header(reader, options.initialBytes ?? INITIAL_HEADER_BYTES);
  return { ...opened, stats: { ...reader.stats } };
}

async function scanMp4Header(
  reader: HttpRangeReader,
  initialLimit: number,
): Promise<OpenedHeader> {
  const probe = await reader.read(0, 16, 'header');
  const totalBytes = probe.totalBytes;
  if (totalBytes == null) throw new Error('Range source did not report the total MP4 size');
  const initialEnd = Math.min(totalBytes, Math.max(16, initialLimit));
  const initial = initialEnd === probe.bytes.byteLength
    ? probe.bytes
    : (await reader.read(0, initialEnd, 'header')).bytes;
  let cursor = 0;
  let ftyp: Uint8Array | null = null;
  let moov: Uint8Array | null = null;
  for (let count = 0; count < MAX_TOP_LEVEL_BOXES && cursor < totalBytes; count += 1) {
    let boxHead: Uint8Array;
    if (cursor + 16 <= initial.byteLength) {
      boxHead = initial.subarray(cursor, cursor + 16);
    } else {
      const length = Math.min(16, totalBytes - cursor);
      boxHead = (await reader.read(cursor, cursor + length, 'header')).bytes;
    }
    const box = topLevelHeader(boxHead, totalBytes, cursor);
    const readBox = async (): Promise<Uint8Array> => {
      if (cursor + box.size <= initial.byteLength) return initial.slice(cursor, cursor + box.size);
      const bytes = new Uint8Array(box.size);
      bytes.set(boxHead.subarray(0, box.headerSize), 0);
      if (box.size > box.headerSize) {
        bytes.set((await reader.read(
          cursor + box.headerSize,
          cursor + box.size,
          'header',
        )).bytes, box.headerSize);
      }
      return bytes;
    };
    if (box.type === 'ftyp') ftyp = await readBox();
    if (box.type === 'moov') {
      moov = await readBox();
      break;
    }
    cursor += box.size;
  }
  if (!moov) throw new Error('moov box not found while scanning top-level MP4 boxes');
  const headerBytes = new Uint8Array((ftyp?.byteLength ?? 0) + moov.byteLength);
  if (ftyp) headerBytes.set(ftyp, 0);
  headerBytes.set(moov, ftyp?.byteLength ?? 0);
  return { header: headerBytes.buffer, totalBytes };
}

export function mergeByteRanges(ranges: readonly ByteRange[]): ByteRange[] {
  const sorted = ranges
    .filter(range => range.end > range.start)
    .map(range => ({ ...range }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: ByteRange[] = [];
  for (const range of sorted) {
    const prior = merged.at(-1);
    if (prior && range.start <= prior.end) prior.end = Math.max(prior.end, range.end);
    else merged.push(range);
  }
  return merged;
}

export class ByteRangeCache {
  private readonly entries: CachedRange[] = [];
  private clock = 0;
  private retainedBytes = 0;

  constructor(readonly maxBytes = DEFAULT_RANGE_CACHE_BYTES) {
    if (!Number.isFinite(maxBytes) || maxBytes < 0) throw new Error('cache limit must be non-negative');
  }

  get(start: number, end: number): Uint8Array | null {
    const entry = this.entries.find(candidate => candidate.start <= start && candidate.end >= end);
    if (!entry) return null;
    entry.used = ++this.clock;
    return entry.data.subarray(start - entry.start, end - entry.start);
  }

  put(start: number, data: Uint8Array): void {
    if (data.byteLength === 0 || data.byteLength > this.maxBytes) return;
    const end = start + data.byteLength;
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index]!;
      if (entry.end <= start || entry.start >= end) continue;
      this.entries.splice(index, 1);
      this.retainedBytes -= entry.data.byteLength;
    }
    this.entries.push({ start, end, data: data.slice(), used: ++this.clock });
    this.retainedBytes += data.byteLength;
    while (this.retainedBytes > this.maxBytes) {
      let oldestIndex = 0;
      for (let index = 1; index < this.entries.length; index += 1) {
        if (this.entries[index]!.used < this.entries[oldestIndex]!.used) oldestIndex = index;
      }
      const [removed] = this.entries.splice(oldestIndex, 1);
      this.retainedBytes -= removed!.data.byteLength;
    }
  }

  get sizeBytes(): number {
    return this.retainedBytes;
  }

  clear(): void {
    this.entries.length = 0;
    this.retainedBytes = 0;
  }
}

class SharedRangeBytes {
  readonly cache: ByteRangeCache;
  readonly reader: HttpRangeReader;

  constructor(
    url: string,
    fetchImpl?: typeof fetch,
    cacheBytes = DEFAULT_RANGE_CACHE_BYTES,
    onWarning?: (message: string) => void,
  ) {
    this.cache = new ByteRangeCache(cacheBytes);
    this.reader = new HttpRangeReader(url, fetchImpl, onWarning);
  }

  async samples(samples: readonly Mp4VideoSample[]): Promise<Map<number, Uint8Array>> {
    const result = new Map<number, Uint8Array>();
    const missing: ByteRange[] = [];
    for (const sample of samples) {
      const cached = this.cache.get(sample.offset, sample.offset + sample.size);
      if (cached) result.set(sample.decodeIndex, cached);
      else missing.push({ start: sample.offset, end: sample.offset + sample.size });
    }
    const fetched: CachedRange[] = [];
    for (const range of mergeByteRanges(missing)) {
      const data = (await this.reader.read(range.start, range.end, 'media')).bytes;
      fetched.push({ ...range, data, used: 0 });
      this.cache.put(range.start, data);
    }
    for (const sample of samples) {
      if (result.has(sample.decodeIndex)) continue;
      const fetchedRange = fetched.find(range => range.start <= sample.offset
        && range.end >= sample.offset + sample.size);
      const bytes = this.cache.get(sample.offset, sample.offset + sample.size)
        ?? fetchedRange?.data.subarray(
          sample.offset - fetchedRange.start,
          sample.offset - fetchedRange.start + sample.size,
        )
        ?? null;
      if (!bytes || bytes.byteLength !== sample.size) {
        throw new Error(`sample ${sample.decodeIndex} bytes are unavailable`);
      }
      result.set(sample.decodeIndex, bytes);
    }
    return result;
  }
}

export async function selectSupportedDecoderConfig(
  table: Pick<Mp4VideoSampleTable, 'codec' | 'description' | 'codedWidth' | 'codedHeight'>,
  requested?: HardwarePreference,
  knownSupport?: CodecSupport | null,
  callbacks: {
    onCodecSupport?: (support: CodecSupport) => void;
    onSoftwareFallbackDenied?: (support: CodecSupport) => void;
    optimizeForLatency?: boolean;
  } = {},
): Promise<{ config: VideoDecoderConfig; acceleration: HardwarePreference }> {
  const base: VideoDecoderConfig = {
    codec: table.codec,
    description: table.description,
    codedWidth: table.codedWidth,
    codedHeight: table.codedHeight,
    optimizeForLatency: callbacks.optimizeForLatency ?? resolveOptimizeForLatencyDefault(),
  };
  const attempts: HardwarePreference[] = requested === 'prefer-software'
    ? ['prefer-software']
    : ['prefer-hardware', 'prefer-software'];
  const support = knownSupport ?? await evaluateCodecSupport(table.codec, {
    codedWidth: table.codedWidth,
    codedHeight: table.codedHeight,
    description: table.description as unknown as BufferSource,
  });
  if (!knownSupport) callbacks.onCodecSupport?.(support);
  for (const acceleration of attempts) {
    const supported = acceleration === 'prefer-hardware' ? support.hw : support.sw;
    if (supported) return { config: { ...base, hardwareAcceleration: acceleration }, acceleration };
  }
  if (attempts.includes('prefer-software') && !support.sw) callbacks.onSoftwareFallbackDenied?.(support);
  throw new Error(
    `Unsupported configuration for ${table.codec} after trying hardwareAcceleration [${attempts.join(', ')}]`,
  );
}

export function encodedChunkInitForSample(
  sample: Pick<Mp4VideoSample, 'isSync' | 'timestampUs' | 'durationUs'>,
  data: BufferSource,
): EncodedVideoChunkInit {
  return {
    type: sample.isSync ? 'key' : 'delta',
    timestamp: sample.timestampUs,
    duration: sample.durationUs,
    data,
  };
}

function frameCovers(frame: Pick<VideoFrame, 'timestamp' | 'duration'>, targetUs: number): boolean {
  return typeof frame.duration === 'number' && frame.duration > 0
    && targetUs >= frame.timestamp && targetUs < frame.timestamp + frame.duration;
}

class DecoderExecutionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DecoderExecutionError';
  }
}

interface OutputWaiter {
  promise: Promise<void>;
  targetUs: number;
  sampleTimestampUs: number;
  /** この待ちの間に出力された「target より後の」フレーム数（fail-fast の判定用）。 */
  laterFrames: number;
  isSettled(): boolean;
  resolve(): void;
}

/**
 * future frame の退避対象。過去（target 未満）を古い順に limit まで落とし、さらに target より先の
 * フレームが futureLimit を超える場合は遠い順に落とす（flush で GOP 残り全部が出たときに
 * デコーダ由来の surface を数十枚握り続けないため。issue #28 と同じ資源）。
 */
export function futureFrameTimestampsToEvict(
  timestamps: readonly number[],
  limit: number,
  targetUs: number,
  futureLimit: number = Number.POSITIVE_INFINITY,
): number[] {
  const evicted: number[] = [];
  let retained = timestamps.length;
  for (const timestamp of timestamps) {
    if (retained <= limit) break;
    if (timestamp >= targetUs) continue;
    evicted.push(timestamp);
    retained -= 1;
  }
  if (Number.isFinite(futureLimit)) {
    const future = timestamps
      .filter(timestamp => timestamp >= targetUs && !evicted.includes(timestamp))
      .sort((left, right) => left - right);
    for (const timestamp of future.slice(Math.max(0, Math.floor(futureLimit)))) evicted.push(timestamp);
  }
  return evicted;
}

/** target より先に保持する future frame の上限（デコーダ由来の surface を握る枚数の天井）。 */
const FUTURE_FRAME_LIMIT = 16;

class TargetFrameUnavailableError extends Error {
  constructor(readonly targetUs: number) {
    super(`target frame ${targetUs}us was not produced`);
    this.name = 'TargetFrameUnavailableError';
  }
}

export class RangeMp4Source {
  private prepared: PreparedRangeSource | null = null;
  private preparePromise: Promise<void> | null = null;
  private decoder: VideoDecoder | null = null;
  private decoderGeneration = 0;
  private decoderConfig: VideoDecoderConfig | null = null;
  private acceleration: HardwarePreference | null = null;
  private decoderError: Error | null = null;
  private decoderFailure: Promise<never> | null = null;
  private rejectDecoderFailure: ((error: Error) => void) | null = null;
  private outputWaiter: OutputWaiter | null = null;
  private activeTargetUs: number | null = null;
  private activeCandidate: VideoFrame | null = null;
  private lastOutput: VideoFrame | null = null;
  private readonly futureFrames = new Map<number, VideoFrame>();
  private currentSyncIndex = -1;
  private nextDecodeIndex = 0;
  private lastTargetUs = -1;
  private flushedSinceSeek = false;
  private destroyed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly shared: SharedRangeBytes;
  private readonly options: RangeMp4SourceOptions;

  constructor(
    readonly id: string,
    readonly src: string,
    options: RangeMp4SourceOptions = {},
    shared?: SharedRangeBytes,
    prepared?: PreparedRangeSource,
  ) {
    this.options = options;
    this.shared = shared ?? new SharedRangeBytes(
      src, options.fetchImpl, options.cacheBytes, options.onWarning,
    );
    this.prepared = prepared ?? null;
  }

  prepare(): Promise<void> {
    if (this.prepared) return Promise.resolve();
    this.preparePromise ??= this.doPrepare();
    return this.preparePromise;
  }

  private async doPrepare(): Promise<void> {
    const opened = await withTimeout(
      scanMp4Header(this.shared.reader, INITIAL_HEADER_BYTES),
      this.options.loadTimeoutMs ?? 10_000,
      `Range header ${this.id}`,
    );
    const [table, keyframes] = await Promise.all([
      buildVideoSampleTable(opened.header.slice(0)),
      buildKeyframeIndexFromHeader(opened.header.slice(0)),
    ]);
    this.prepared = { table, keyframes, totalBytes: opened.totalBytes };
  }

  async load(): Promise<void> {
    await this.prepare();
    if (!this.decoder) await this.configureDecoder();
  }

  private async configureDecoder(): Promise<void> {
    if (!this.prepared) throw new Error(`Range source ${this.id} is not prepared`);
    const selected = this.decoderConfig && this.acceleration
      ? { config: this.decoderConfig, acceleration: this.acceleration }
      : await selectSupportedDecoderConfig(
        this.prepared.table,
        this.options.hardwareAcceleration,
        this.options.codecSupport,
        {
          onCodecSupport: this.options.onCodecSupport,
          onSoftwareFallbackDenied: this.options.onSoftwareFallbackDenied,
          optimizeForLatency: this.options.optimizeForLatency,
        },
      );
    this.decoderError = null;
    this.decoderFailure = new Promise<never>((_resolve, reject) => {
      this.rejectDecoderFailure = reject;
    });
    this.decoderFailure.catch(() => undefined);
    const generation = ++this.decoderGeneration;
    this.decoder = new VideoDecoder({
      output: frame => {
        if (generation !== this.decoderGeneration) frame.close();
        else this.handleOutput(frame);
      },
      error: error => {
        if (generation !== this.decoderGeneration) return;
        const wrapped = new DecoderExecutionError(`decoder error: ${error.message}`, error);
        this.decoderError = wrapped;
        this.rejectDecoderFailure?.(wrapped);
      },
    });
    let configured = selected.config;
    try {
      this.decoder.configure(configured);
    } catch (error) {
      if (configured.optimizeForLatency !== true) {
        this.decoder.close();
        this.decoder = null;
        throw error;
      }
      const fallback = { ...configured };
      delete fallback.optimizeForLatency;
      this.options.onWarning?.(
        `${this.id}: decoder rejected optimizeForLatency; configuring once without it`,
      );
      try {
        this.decoder.configure(fallback);
        configured = fallback;
      } catch (fallbackError) {
        this.decoder.close();
        this.decoder = null;
        throw fallbackError;
      }
    }
    this.decoderConfig = configured;
    this.acceleration = selected.acceleration;
    this.currentSyncIndex = -1;
    this.nextDecodeIndex = 0;
    this.lastTargetUs = -1;
    this.flushedSinceSeek = false;
  }

  private handleOutput(frame: VideoFrame): void {
    if ((!Number.isFinite(frame.duration) || frame.duration == null || frame.duration <= 0)
      && this.prepared) {
      const timing = sampleAtPresentationTime(this.prepared.table, frame.timestamp);
      const normalized = new VideoFrame(frame, {
        timestamp: frame.timestamp,
        duration: timing.durationUs,
      });
      frame.close();
      frame = normalized;
    }
    const target = this.activeTargetUs;
    if (target == null) {
      this.storeFutureFrame(frame);
      return;
    }
    if (frame.timestamp > target) {
      this.storeFutureFrame(frame);
      // 出力は提示順なので、target より後のフレームが並べ替え窓（maxReorderFrames）を超える数だけ
      // 先に出た時点で target はもう来ない（デコーダが落とした）。猶予 250 ms と flush を待たずに
      // waiter を解いて呼び手に再シークさせる。B フレーム無しなら後続 1 枚で確定する。
      const waiter = this.outputWaiter;
      if (waiter && !waiter.isSettled()) {
        waiter.laterFrames += 1;
        const reorderWindow = this.prepared?.table.maxReorderFrames ?? 0;
        if (waiter.laterFrames > reorderWindow
          && !(this.activeCandidate && frameCovers(this.activeCandidate, waiter.targetUs))) {
          this.shared.reader.stats.targetSkips += 1;
          waiter.resolve();
        }
      }
      return;
    }
    if (!this.activeCandidate || frame.timestamp >= this.activeCandidate.timestamp) {
      this.activeCandidate?.close();
      this.activeCandidate = frame;
    } else {
      frame.close();
    }
    if (this.activeCandidate
      && (frameCovers(this.activeCandidate, this.outputWaiter?.targetUs ?? target)
        || this.activeCandidate.timestamp === this.outputWaiter?.sampleTimestampUs)) {
      this.outputWaiter?.resolve();
    }
  }

  private storeFutureFrame(frame: VideoFrame): void {
    this.futureFrames.get(frame.timestamp)?.close();
    this.futureFrames.set(frame.timestamp, frame);
    const limit = Math.max(4, (this.prepared?.table.maxReorderFrames ?? 0) + 4);
    const targetUs = this.activeTargetUs ?? this.lastTargetUs;
    for (const timestamp of futureFrameTimestampsToEvict(
      [...this.futureFrames.keys()],
      limit,
      targetUs,
      FUTURE_FRAME_LIMIT,
    )) {
      this.futureFrames.get(timestamp)?.close();
      this.futureFrames.delete(timestamp);
    }
    this.shared.reader.stats.maxFutureFrames = Math.max(
      this.shared.reader.stats.maxFutureFrames,
      this.futureFrames.size,
    );
  }

  private beginOutputWait(targetUs: number, sampleTimestampUs: number): OutputWaiter {
    let settled = false;
    let resolvePromise: () => void = () => undefined;
    const promise = new Promise<void>(resolve => { resolvePromise = resolve; });
    const waiter: OutputWaiter = {
      promise,
      targetUs,
      sampleTimestampUs,
      laterFrames: 0,
      isSettled: () => settled,
      resolve() {
        if (settled) return;
        settled = true;
        resolvePromise();
      },
    };
    this.outputWaiter = waiter;
    return waiter;
  }

  private takeActiveCandidate(): VideoFrame | null {
    const candidate = this.activeCandidate;
    this.activeCandidate = null;
    return candidate;
  }

  async decode(timeUs: number): Promise<VideoFrame> {
    const operation = () => this.decodeWithRecovery(timeUs);
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async decodeWithRecovery(timeUs: number): Promise<VideoFrame> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.decodeSerialized(timeUs);
      } catch (error) {
        if (!(error instanceof DecoderExecutionError) || attempt > 0) throw error;
        this.options.onWarning?.(`${this.id}: decoder runtime error; recreating once: ${error.message}`);
        await this.resetDecoder();
      }
    }
    throw new Error(`Range source ${this.id} decoder retry exhausted`);
  }

  private async decodeSerialized(timeUs: number): Promise<VideoFrame> {
    await this.load();
    if (this.destroyed || !this.prepared || !this.decoder) {
      throw new Error(`Range source ${this.id} is unavailable`);
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.decodeTarget(timeUs, attempt > 0);
      } catch (error) {
        if (!(error instanceof TargetFrameUnavailableError)) throw error;
        if (attempt > 0) {
          throw new Error(`clip ${this.id} returned no video frame at ${error.targetUs}us`);
        }
        this.options.onWarning?.(
          `${this.id}: target ${error.targetUs}us was not produced; reseeking from sync once`,
        );
        this.shared.reader.stats.droppedTargets += 1;
        // 落とされたのは target 1 枚だけで、flush で出た後続フレームは正しい。ここで捨てると次の
        // フレームも「投入済みなのに手元に無い」状態になり、同じ失敗を毎フレーム繰り返す
        // （実機で fps 8 に張り付いた連鎖）。future は保持したままデコーダだけ作り直す。
        await this.resetDecoder({ keepFutureFrames: true });
      }
    }
    throw new Error(`clip ${this.id} returned no video frame at ${Math.max(0, Math.floor(timeUs))}us`);
  }

  private async decodeTarget(timeUs: number, forceReseek: boolean): Promise<VideoFrame> {
    if (this.destroyed || !this.prepared || !this.decoder) {
      throw new Error(`Range source ${this.id} is unavailable`);
    }
    const table = this.prepared.table;
    const requestedTarget = Math.max(0, Math.floor(timeUs));
    const targetUs = Math.min(requestedTarget, table.lastFrameStartUs);
    if (this.lastOutput && frameCovers(this.lastOutput, targetUs)) return this.lastOutput.clone();
    const targetSample = sampleAtPresentationTime(table, targetUs);
    const buffered = this.consumeFutureFrame(targetSample.timestampUs, targetUs);
    if (buffered) return buffered;
    const syncIndex = precedingSyncSample(table, targetSample.decodeIndex);
    const forward = !forceReseek && !this.flushedSinceSeek && this.currentSyncIndex >= 0
      && targetUs > this.lastTargetUs
      && (syncIndex === this.currentSyncIndex || targetSample.decodeIndex < this.nextDecodeIndex);
    if (!forward) {
      if (this.currentSyncIndex >= 0) await this.resetDecoder();
      this.currentSyncIndex = syncIndex;
      this.nextDecodeIndex = syncIndex;
      this.flushedSinceSeek = false;
    }
    const decoder = this.decoder;
    if (!decoder) throw new Error(`Range source ${this.id} decoder reset failed`);
    const targetGopEnd = this.gopEnd(table, syncIndex);
    const minimumDecodeEnd = decodeEndForPresentationSample(table, targetSample);
    const decodeCeiling = Math.min(
      Math.max(targetGopEnd, minimumDecodeEnd),
      table.samples.length - 1,
    );
    const postTargetLimit = table.maxReorderFrames + 1;
    let postTargetSamples = 0;
    for (let index = syncIndex; index < this.nextDecodeIndex; index += 1) {
      if (table.samples[index]!.timestampUs >= targetSample.timestampUs) postTargetSamples += 1;
    }
    this.activeTargetUs = targetUs;
    this.activeCandidate?.close();
    this.activeCandidate = null;
    const waiter = this.beginOutputWait(targetUs, targetSample.timestampUs);
    let queueLimit = Math.max(
      1,
      this.gopEnd(table, this.currentSyncIndex) - this.currentSyncIndex + 1,
    );
    let outputGraceExpired = false;
    try {
      const atEnd = targetSample.timestampUs >= table.lastFrameStartUs;
      try {
        await withTimeout((async () => {
          let postTargetBudget = postTargetLimit;
          let initialRound = true;
          while (!waiter.isSettled()) {
            const roundCeiling = initialRound ? table.samples.length - 1 : decodeCeiling;
            let supplyEnd = this.nextDecodeIndex - 1;
            for (let index = this.nextDecodeIndex; index <= roundCeiling; index += 1) {
              const sample = table.samples[index]!;
              if (sample.timestampUs >= targetSample.timestampUs) {
                if (postTargetSamples >= postTargetBudget) break;
                postTargetSamples += 1;
              }
              supplyEnd = index;
            }
            const pending = this.nextDecodeIndex <= supplyEnd
              ? table.samples.slice(this.nextDecodeIndex, supplyEnd + 1)
              : [];
            const bytes = await this.shared.samples(pending);
            for (const sample of pending) {
              await this.waitForQueueBelow(decoder, queueLimit, waiter);
              if (waiter.isSettled()) break;
              if (sample.isSync && sample.decodeIndex !== this.currentSyncIndex) {
                this.currentSyncIndex = sample.decodeIndex;
                queueLimit = Math.max(
                  1,
                  this.gopEnd(table, this.currentSyncIndex) - this.currentSyncIndex + 1,
                );
              }
              const data = bytes.get(sample.decodeIndex);
              if (!data) throw new Error(`sample ${sample.decodeIndex} bytes are unavailable`);
              this.submitSample(decoder, sample, data);
              this.nextDecodeIndex = Math.max(this.nextDecodeIndex, sample.decodeIndex + 1);
            }
            while (!waiter.isSettled()) {
              const waitResult = await this.waitForTargetOrProgress(
                decoder,
                waiter,
                this.nextDecodeIndex <= decodeCeiling,
              );
              if (waitResult === 'needs-supply') break;
              if (waitResult === 'grace-expired') {
                outputGraceExpired = true;
                break;
              }
            }
            initialRound = false;
            if (waiter.isSettled() || outputGraceExpired
              || this.nextDecodeIndex > decodeCeiling) break;
            postTargetBudget += postTargetLimit;
          }
        })(), this.options.decodeTimeoutMs ?? 10_000, `Range decode ${this.id} at ${targetUs}us`);
        if (!waiter.isSettled() && outputGraceExpired) {
          // ここは「出力が止まったデコーダを立て直す」入口。その flush() 自体が
          // 永久に settle しないことがある（実機 2026-09-05: 4K HEVC のカットで
          // flush enter のまま返らず、renderFrame も返らないので再生が完全停止し、
          // 以後どこへシークしても最後に描けた秒へ引き戻される）。復旧が固まると
          // 二度と戻れないので必ず時間で切り、DecoderExecutionError にして
          // decodeWithRecovery のデコーダ作り直しへ落とす。
          await withTimeout(
            decoder.flush(),
            Math.min(this.options.decodeTimeoutMs ?? 10_000, DECODER_FLUSH_TIMEOUT_MS),
            `Range flush ${this.id} at ${targetUs}us`,
          );
          this.flushedSinceSeek = true;
        }
      } catch (error) {
        throw error instanceof DecoderExecutionError
          ? error
          : new DecoderExecutionError(`decoder did not produce target ${targetUs}us`, error);
      }
      if (this.decoderError) throw this.decoderError;
      const candidate = this.takeActiveCandidate();
      const exact = candidate && (
        frameCovers(candidate, targetUs) || candidate.timestamp === targetSample.timestampUs
      );
      if (!exact && (!atEnd || !forceReseek)) {
        candidate?.close();
        throw new TargetFrameUnavailableError(targetUs);
      }
      const prior = this.lastOutput;
      const result = candidate ?? (atEnd && prior && prior.timestamp <= targetUs
        ? prior.clone() : null);
      if (!result) throw new TargetFrameUnavailableError(targetUs);
      this.lastOutput?.close();
      this.lastOutput = result.clone();
      this.lastTargetUs = targetUs;
      return result;
    } finally {
      this.activeTargetUs = null;
      if (this.outputWaiter === waiter) this.outputWaiter = null;
      this.takeActiveCandidate()?.close();
    }
  }

  private consumeFutureFrame(sampleTimestampUs: number, targetUs: number): VideoFrame | null {
    const future = this.futureFrames.get(sampleTimestampUs);
    if (!future || (!frameCovers(future, targetUs) && future.timestamp !== sampleTimestampUs)) return null;
    this.futureFrames.delete(sampleTimestampUs);
    const result = future.clone();
    future.close();
    this.lastOutput?.close();
    this.lastOutput = result.clone();
    this.lastTargetUs = targetUs;
    return result;
  }

  private gopEnd(table: Mp4VideoSampleTable, syncIndex: number): number {
    let end = syncIndex;
    while (end + 1 < table.samples.length && !table.samples[end + 1]!.isSync) end += 1;
    return end;
  }

  private submitSample(
    decoder: VideoDecoder,
    sample: Mp4VideoSample,
    data: Uint8Array,
  ): void {
    try {
      decoder.decode(new EncodedVideoChunk(
        encodedChunkInitForSample(sample, data as unknown as BufferSource),
      ));
    } catch (error) {
      throw new DecoderExecutionError(`decode submission failed for sample ${sample.decodeIndex}`, error);
    }
    this.shared.reader.stats.maxDecodeQueueSize = Math.max(
      this.shared.reader.stats.maxDecodeQueueSize,
      decoder.decodeQueueSize,
    );
  }

  private async waitForTargetOrProgress(
    decoder: VideoDecoder,
    waiter: OutputWaiter,
    canSupply: boolean,
  ): Promise<'target-or-dequeue' | 'needs-supply' | 'grace-expired'> {
    if (waiter.isSettled()) return 'target-or-dequeue';
    if (decoder.decodeQueueSize === 0) {
      if (canSupply) return 'needs-supply';
      // GOP を供給し切り、かつ target より後のフレームが既に出ているなら、待っても target は
      // 出てこない（並べ替え中なら flush で出る）。猶予 250 ms を飛ばして flush へ進む。
      if (waiter.laterFrames > 0) return 'grace-expired';
      this.shared.reader.stats.graceWaits += 1;
      let graceTimer: ReturnType<typeof setTimeout> | null = null;
      const graceExpired = new Promise<'grace-expired'>(resolve => {
        graceTimer = setTimeout(() => resolve('grace-expired'), OUTPUT_GRACE_MS);
      });
      try {
        return await Promise.race([
          waiter.promise.then(() => 'target-or-dequeue' as const),
          graceExpired,
          this.decoderFailure ?? new Promise<never>(() => undefined),
        ]);
      } catch (error) {
        throw error instanceof DecoderExecutionError
          ? error
          : new DecoderExecutionError(`decoder output grace failed for target ${waiter.targetUs}us`, error);
      } finally {
        if (graceTimer) clearTimeout(graceTimer);
      }
    }
    let onDequeue: (() => void) | null = null;
    const dequeued = new Promise<void>(resolve => {
      onDequeue = () => {
        decoder.removeEventListener('dequeue', onDequeue!);
        resolve();
      };
      decoder.addEventListener('dequeue', onDequeue);
    });
    try {
      await withTimeout(
        Promise.race([
          waiter.promise,
          dequeued,
          this.decoderFailure ?? new Promise<never>(() => undefined),
        ]),
        Math.min(this.options.decodeTimeoutMs ?? 10_000, DECODER_DEQUEUE_TIMEOUT_MS),
        `Range decoder progress ${this.id}`,
      );
      return 'target-or-dequeue';
    } catch (error) {
      throw error instanceof DecoderExecutionError
        ? error
        : new DecoderExecutionError(`decoder made no progress for target ${waiter.targetUs}us`, error);
    } finally {
      if (onDequeue) decoder.removeEventListener('dequeue', onDequeue);
    }
  }

  private async waitForQueueBelow(
    decoder: VideoDecoder,
    limit: number,
    waiter?: OutputWaiter,
  ): Promise<void> {
    if (decoder.decodeQueueSize < limit) return;
    let onDequeue: (() => void) | null = null;
    const drained = new Promise<void>(resolve => {
      onDequeue = () => {
        if (decoder.decodeQueueSize >= limit) return;
        decoder.removeEventListener('dequeue', onDequeue!);
        resolve();
      };
      decoder.addEventListener('dequeue', onDequeue);
    });
    try {
      await withTimeout(
        Promise.race([
          drained,
          waiter?.promise ?? new Promise<never>(() => undefined),
          this.decoderFailure ?? new Promise<never>(() => undefined),
        ]),
        Math.min(this.options.decodeTimeoutMs ?? 10_000, DECODER_DEQUEUE_TIMEOUT_MS),
        `Range decoder queue ${this.id}`,
      );
    } catch (error) {
      throw error instanceof DecoderExecutionError
        ? error
        : new DecoderExecutionError(`decoder queue did not drain below ${limit}`, error);
    } finally {
      if (onDequeue) decoder.removeEventListener('dequeue', onDequeue);
    }
  }

  private async resetDecoder(options: { keepFutureFrames?: boolean } = {}): Promise<void> {
    this.decoderGeneration += 1;
    try {
      this.decoder?.close();
    } catch {
      // A decoder that invoked its error callback may already be closed.
    }
    this.decoder = null;
    this.decoderFailure = null;
    this.rejectDecoderFailure = null;
    // 出力済みの VideoFrame はデコーダを閉じても有効なので、再シークで再利用できる future は残せる。
    if (!options.keepFutureFrames) {
      for (const frame of this.futureFrames.values()) frame.close();
      this.futureFrames.clear();
    }
    await this.configureDecoder();
  }

  async fork(id: string): Promise<RangeMp4Source> {
    await this.prepare();
    if (!this.prepared) throw new Error(`Range source ${this.id} cannot be forked`);
    return new RangeMp4Source(id, this.src, this.options, this.shared, this.prepared);
  }

  get meta(): { duration: number; width: number; height: number; rotationDeg: number } {
    if (!this.prepared) throw new Error(`Range source ${this.id} is not prepared`);
    return {
      duration: this.prepared.table.presentationDurationUs,
      width: this.prepared.table.width,
      height: this.prepared.table.height,
      rotationDeg: this.prepared.table.rotationDeg,
    };
  }

  get keyframes(): KeyframeIndex | null {
    return this.prepared?.keyframes ?? null;
  }

  get decoderAcceleration(): HardwarePreference | null {
    return this.acceleration;
  }

  get stats(): RangeFetchStats {
    return { ...this.shared.reader.stats };
  }

  destroy(): void {
    this.destroyed = true;
    this.decoderGeneration += 1;
    this.decoder?.close();
    this.decoder = null;
    this.decoderFailure = null;
    this.rejectDecoderFailure = null;
    this.outputWaiter = null;
    this.activeCandidate?.close();
    this.activeCandidate = null;
    this.lastOutput?.close();
    this.lastOutput = null;
    for (const frame of this.futureFrames.values()) frame.close();
    this.futureFrames.clear();
  }
}
