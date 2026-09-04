import type { CompositedFrame } from '../types.js';

export interface EncodedVideoChunkSink {
  write(bytes: Uint8Array, chunk: {
    type: EncodedVideoChunkType;
    timestamp: number;
    duration: number | null;
    description?: Uint8Array;
  }): Promise<void> | void;
}

export interface WebCodecsH264Options {
  width: number;
  height: number;
  fps: number;
  bitrate?: number;
  /** WebCodecs の codec-specific quantizer（0〜51、小さいほど高品質）。 */
  quantizer?: number;
  keyframeIntervalFrames?: number;
  hardwareAcceleration?: HardwarePreference;
  /** 出力コーデック。クラス名は既存 API 互換のため WebCodecsH264Encoder のまま。 */
  codec?: 'h264' | 'hevc';
}

type QuantizerVideoEncoderConfig = { bitrateMode?: 'quantizer' };
type H264EncoderConfig = VideoEncoderConfig & QuantizerVideoEncoderConfig & { avc: { format: 'annexb' } };
type HevcEncoderConfig = VideoEncoderConfig & QuantizerVideoEncoderConfig & { hevc: { format: 'hevc' } };
type AkariVideoEncoderConfig = H264EncoderConfig | HevcEncoderConfig;
type AkariVideoEncoderEncodeOptions = VideoEncoderEncodeOptions & {
  avc?: { quantizer: number };
  hevc?: { quantizer: number };
};

export interface WebCodecsRateControlResolution {
  options: WebCodecsH264Options;
  rateControl: 'quantizer' | 'bitrate';
  fallbackReason: string | null;
}

export class RefusalError extends Error {
  override readonly name = 'RefusalError';
}

/**
 * H.264 High profile の level 表（ITU-T H.264 Table A-1: MaxFS = 最大マクロブロック数/フレーム、
 * MaxMBPS = 最大マクロブロック数/秒、MaxBR = 最大ビットレート kbit/s。High profile は MaxBR × 1.25）。
 *
 * Blink の VerifyCodecSupportStatic は coded_area > MaxFS(level) × 256 を isConfigSupported=false にするため、
 * 固定 'avc1.640028'（Level 4.0 = MaxFS 8192 MB）では 2560×1440（14400 MB）/ 3840×2160（32400 MB）が
 * HW / SW を問わず全 OS で拒否され「unsupported: prefer-hardware」と誤読されていた（2026-08-29 調査 §5-4、
 * Mac / Electron 39 で 'avc1.640033' なら 1440p / 4K とも true を実測）。
 * 下限を 4.0 に置くので 1080p30 以下は従来どおり 'avc1.640028'（バイト同一）。
 */
const H264_HIGH_PROFILE_BR_FACTOR = 1.25;
const H264_LEVELS: ReadonlyArray<{ level: string; idc: number; maxFs: number; maxMbps: number; maxBrKbps: number }> = [
  { level: '4.0', idc: 0x28, maxFs: 8192, maxMbps: 245_760, maxBrKbps: 20_000 },
  { level: '4.1', idc: 0x29, maxFs: 8192, maxMbps: 245_760, maxBrKbps: 50_000 },
  { level: '4.2', idc: 0x2a, maxFs: 8704, maxMbps: 522_240, maxBrKbps: 50_000 },
  { level: '5.0', idc: 0x32, maxFs: 22_080, maxMbps: 589_824, maxBrKbps: 135_000 },
  { level: '5.1', idc: 0x33, maxFs: 36_864, maxMbps: 983_040, maxBrKbps: 240_000 },
  { level: '5.2', idc: 0x34, maxFs: 36_864, maxMbps: 2_073_600, maxBrKbps: 240_000 },
  { level: '6.0', idc: 0x3c, maxFs: 139_264, maxMbps: 4_177_920, maxBrKbps: 240_000 },
  { level: '6.1', idc: 0x3d, maxFs: 139_264, maxMbps: 8_355_840, maxBrKbps: 480_000 },
  { level: '6.2', idc: 0x3e, maxFs: 139_264, maxMbps: 16_711_680, maxBrKbps: 800_000 }
];

export interface H264LevelSelection {
  level: string;
  idc: number;
  codec: string;
  macroblocks: number;
  macroblocksPerSecond: number;
}

/** 解像度・fps・ビットレートを満たす最小の High profile level を選ぶ（下限 4.0、上限 6.2 を超えれば throw）。 */
export function selectH264Level({ width, height, fps, bitrate }: { width: number; height: number; fps: number; bitrate?: number }): H264LevelSelection {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`H.264 level selection needs a positive frame size, got ${width}x${height}`);
  }
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`H.264 level selection needs a positive frame rate, got ${fps}`);
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const macroblocksPerSecond = macroblocks * fps;
  const kbps = bitrate !== undefined && bitrate > 0 ? bitrate / 1000 : 0;
  for (const entry of H264_LEVELS) {
    if (macroblocks <= entry.maxFs && macroblocksPerSecond <= entry.maxMbps && kbps <= entry.maxBrKbps * H264_HIGH_PROFILE_BR_FACTOR) {
      return {
        level: entry.level,
        idc: entry.idc,
        codec: `avc1.6400${entry.idc.toString(16).padStart(2, '0')}`,
        macroblocks,
        macroblocksPerSecond
      };
    }
  }
  throw new Error(
    `no H.264 High profile level fits ${width}x${height}@${fps}fps${kbps > 0 ? ` ${Math.round(kbps)}kbps` : ''} (max is Level 6.2)`
  );
}

/** エンコーダに渡す codec 文字列。`codec` 明示があれば形式だけ検証してそのまま使う。 */
export function h264CodecString(options: {
  width: number;
  height: number;
  fps: number;
  bitrate?: number;
  codec?: string;
}): string {
  if (options.codec !== undefined) {
    if (!/^avc[1-4]\.[0-9a-f]{6}$/i.test(options.codec)) throw new Error(`invalid H.264 codec string: ${options.codec}`);
    return options.codec;
  }
  return selectH264Level(options).codec;
}

/** HEVC Main profile の解像度・fps に合う最小 level を WebCodecs の codec 文字列で返す。 */
export function hevcEncoderCodecString({ width, height, fps }: Pick<WebCodecsH264Options, 'width' | 'height' | 'fps'>): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RefusalError(`HEVC level selection needs a positive frame size, got ${width}x${height}`);
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RefusalError(`HEVC level selection needs a positive frame rate, got ${fps}`);
  }
  const pixels = width * height;
  if (pixels <= 1920 * 1080 && fps <= 30) return 'hvc1.1.6.L120.B0';
  if ((pixels <= 1920 * 1080 && fps <= 60) || (pixels <= 2560 * 1440 && fps <= 30)) return 'hvc1.1.6.L123.B0';
  if (pixels <= 3840 * 2160 && fps <= 30) return 'hvc1.1.6.L150.B0';
  if (pixels <= 3840 * 2160 && fps <= 60) return 'hvc1.1.6.L153.B0';
  // Main-tier Level 5.2: MaxLumaPs=8,912,896 / MaxLumaSr=1,069,547,520.
  if (pixels <= 8_912_896 && pixels * fps <= 1_069_547_520) return 'hvc1.1.6.L156.B0';
  throw new RefusalError(`no HEVC Main profile level fits ${width}x${height}@${fps}fps (max is Level 5.2)`);
}

function buildEncoderConfig(options: WebCodecsH264Options): AkariVideoEncoderConfig {
  const quantizer = validateQuantizer(options.quantizer);
  const bitrate = options.bitrate ?? 8_000_000;
  if (options.codec === 'hevc') {
    return {
      codec: hevcEncoderCodecString(options),
      width: options.width,
      height: options.height,
      bitrate,
      framerate: options.fps,
      hardwareAcceleration: options.hardwareAcceleration ?? 'prefer-hardware',
      ...(quantizer !== undefined ? { bitrateMode: 'quantizer' as const } : {}),
      // 'quality' の理由は下の H.264 側と同じ（realtime は VideoToolbox 共有時にフレームを捨てる）。
      latencyMode: 'quality',
      hevc: { format: 'hevc' }
    };
  }
  // `codec` previously accepted an explicit AVC codec string at runtime. Preserve that path for
  // older JavaScript callers while the typed option now uses the shared h264/hevc vocabulary.
  const legacyCodec = typeof options.codec === 'string' && options.codec !== 'h264' ? options.codec : undefined;
  return {
    codec: h264CodecString({ width: options.width, height: options.height, fps: options.fps, bitrate, codec: legacyCodec }),
    width: options.width,
    height: options.height,
    bitrate,
    framerate: options.fps,
    hardwareAcceleration: options.hardwareAcceleration ?? 'prefer-hardware',
    ...(quantizer !== undefined ? { bitrateMode: 'quantizer' as const } : {}),
    // ファイル書き出しなので 'quality'。'realtime' は仕様上フレーム落ちを許し、実際に macOS の VideoToolbox を
    // 他セッション（プレビューの H.264 デコード・別のエンコード等）と共有すると黙ってチャンクを捨てた
    // （2026-09-02 実測 M1: 1464 中 809 欠落、同条件の 'quality' は 0 欠落、単独でも 'quality' が 26% 速い）。
    // 落ちた分は finish() の欠落検出と mp4-mux の sample count mismatch で fail closed になる。
    latencyMode: 'quality',
    avc: { format: 'annexb' }
  };
}

const MISSING_FRAME_LIST_LIMIT = 20;

/** encode() した frame 番号のうち出力 timestamp が無いものを列挙する（timestamp は encode() と同じ丸め）。 */
export function describeMissingFrames(frames: number, fps: number, outputTimestamps: ReadonlySet<number>): string {
  const missing: number[] = [];
  let omitted = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    if (outputTimestamps.has(Math.round(frame / fps * 1e6))) continue;
    if (missing.length < MISSING_FRAME_LIST_LIMIT) missing.push(frame);
    else omitted += 1;
  }
  return omitted > 0 ? `${missing.join(', ')}, … and ${omitted} more` : missing.join(', ');
}

/**
 * Direct GPU-surface export. H.264 Annex B chunks are intentionally left to a tiny
 * container mux sink, so RGBA readback and renderer-to-main raw-frame IPC are absent.
 */
export class WebCodecsH264Encoder {
  readonly config: AkariVideoEncoderConfig;
  readonly rateControl: 'quantizer' | 'bitrate';
  readonly rateControlFallbackReason: string | null;
  private readonly encoder: VideoEncoder;
  private readonly writes: Promise<void>[] = [];
  // 出力チャンクの timestamp。encode() した frame と突き合わせ、エンコーダが黙って捨てた frame を finish() で名指しする。
  private readonly outputTimestamps = new Set<number>();
  private failure: Error | null = null;
  private frameNumber = 0;
  private closed = false;
  private decoderConfigSent = false;
  private readonly queueWaiters = new Set<() => void>();

  constructor(
    private readonly sink: EncodedVideoChunkSink,
    private readonly options: WebCodecsH264Options,
    rateControlResolution?: Pick<WebCodecsRateControlResolution, 'rateControl' | 'fallbackReason'>
  ) {
    this.config = buildEncoderConfig(options);
    this.rateControl = rateControlResolution?.rateControl ?? (options.quantizer !== undefined ? 'quantizer' : 'bitrate');
    this.rateControlFallbackReason = rateControlResolution?.fallbackReason ?? null;
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        const description = this.options.codec === 'hevc' && !this.decoderConfigSent && chunk.type === 'key'
          ? copyDescription(metadata?.decoderConfig?.description)
          : undefined;
        if (description) this.decoderConfigSent = true;
        this.outputTimestamps.add(chunk.timestamp);
        this.writes.push(Promise.resolve(this.sink.write(bytes, {
          type: chunk.type,
          timestamp: chunk.timestamp,
          duration: chunk.duration,
          ...(description ? { description } : {})
        })));
      },
      error: error => {
        this.failure = error;
        this.notifyQueueWaiters();
      }
    });
    this.encoder.configure(this.config);
  }

  static async isSupported(options: WebCodecsH264Options): Promise<boolean> {
    if (typeof VideoEncoder === 'undefined') return false;
    const config = buildEncoderConfig(options);
    return (await VideoEncoder.isConfigSupported(config)).supported === true;
  }

  /** quantizer 対応を 1 回だけ確認し、非対応なら既存 bitrate config へ落として生成する。 */
  static async create(
    sink: EncodedVideoChunkSink,
    options: WebCodecsH264Options
  ): Promise<WebCodecsH264Encoder> {
    const resolution = await WebCodecsH264Encoder.resolveRateControl(options);
    return new WebCodecsH264Encoder(sink, resolution.options, resolution);
  }

  static async resolveRateControl(options: WebCodecsH264Options): Promise<WebCodecsRateControlResolution> {
    const config = buildEncoderConfig(options);
    if (options.quantizer === undefined) {
      return { options, rateControl: 'bitrate', fallbackReason: null };
    }
    let supported = false;
    if (typeof VideoEncoder !== 'undefined') {
      try {
        supported = (await VideoEncoder.isConfigSupported(config)).supported === true;
      } catch {
        supported = false;
      }
    }
    if (supported) {
      return { options, rateControl: 'quantizer', fallbackReason: null };
    }
    return {
      options: { ...options, quantizer: undefined },
      rateControl: 'bitrate',
      fallbackReason: 'quantizer-config-unsupported'
    };
  }

  get encodeQueueSize(): number {
    return this.encoder.encodeQueueSize;
  }

  async waitForQueueBelow(limit: number): Promise<void> {
    if (!Number.isFinite(limit) || limit < 0) throw new Error('WebCodecs queue limit must be a non-negative number');
    this.assertOpen();
    if (this.encoder.encodeQueueSize <= limit) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        this.encoder.removeEventListener('dequeue', check);
        this.queueWaiters.delete(check);
      };
      const check = () => {
        if (settled) return;
        if (this.failure) {
          settled = true;
          cleanup();
          reject(this.failure);
        } else if (this.closed) {
          settled = true;
          cleanup();
          reject(new Error('WebCodecs encoder is closed'));
        } else if (this.encoder.encodeQueueSize <= limit) {
          settled = true;
          cleanup();
          resolve();
        }
      };
      this.queueWaiters.add(check);
      this.encoder.addEventListener('dequeue', check);
      check();
    });
  }

  encode(frame: CompositedFrame): void {
    if (this.closed) throw new Error('WebCodecs encoder is closed');
    if (this.failure) throw this.failure;
    const timestamp = Math.round(this.frameNumber / this.options.fps * 1e6);
    const videoFrame = new VideoFrame(frame.surface.canvas, { timestamp });
    try {
      const interval = this.options.keyframeIntervalFrames ?? this.options.fps * 2;
      const keyFrame = this.frameNumber % interval === 0;
      const encodeOptions: AkariVideoEncoderEncodeOptions = this.options.quantizer === undefined
        ? { keyFrame }
        : this.options.codec === 'hevc'
          ? { keyFrame, hevc: { quantizer: this.options.quantizer } }
          : { keyFrame, avc: { quantizer: this.options.quantizer } };
      this.encoder.encode(videoFrame, encodeOptions);
      this.frameNumber += 1;
    } finally {
      videoFrame.close();
    }
  }

  async finish(): Promise<{ frames: number; outputs: number }> {
    this.assertOpen();
    await this.encoder.flush();
    await Promise.all(this.writes);
    if (this.failure) throw this.failure;
    // flush() 後に出力が encode() 回数へ届かなければエンコーダがフレームを捨てている。書き出しは全フレームが
    // 必要なので、どの frame が欠けたかを添えて fail closed にする（後段の mp4-mux の検算より先に原因を名指しする）。
    const dropped = this.frameNumber - this.writes.length;
    if (dropped > 0) {
      throw new Error(
        `WebCodecs encoder dropped ${dropped} of ${this.frameNumber} frames`
        + ` (missing frame numbers: ${describeMissingFrames(this.frameNumber, this.options.fps, this.outputTimestamps)})`
      );
    }
    this.encoder.close();
    this.closed = true;
    this.notifyQueueWaiters();
    return { frames: this.frameNumber, outputs: this.writes.length };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.encoder.close();
    this.notifyQueueWaiters();
  }

  private assertOpen(): void {
    if (this.failure) throw this.failure;
    if (this.closed) throw new Error('WebCodecs encoder is closed');
  }

  private notifyQueueWaiters(): void {
    for (const waiter of [...this.queueWaiters]) waiter();
  }
}

function validateQuantizer(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > 51) {
    throw new RangeError(`WebCodecs quantizer must be an integer from 0 to 51, got ${value}`);
  }
  return value;
}

function copyDescription(value: AllowSharedBufferSource | undefined): Uint8Array | undefined {
  if (value === undefined) return undefined;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return new Uint8Array(value.slice(0));
}
