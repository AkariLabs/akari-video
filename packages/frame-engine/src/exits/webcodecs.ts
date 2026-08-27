import type { CompositedFrame } from '../types.js';

export interface EncodedVideoChunkSink {
  write(bytes: Uint8Array, chunk: { type: EncodedVideoChunkType; timestamp: number; duration: number | null }): Promise<void> | void;
}

export interface WebCodecsH264Options {
  width: number;
  height: number;
  fps: number;
  bitrate?: number;
  keyframeIntervalFrames?: number;
  hardwareAcceleration?: HardwarePreference;
}

/**
 * Direct GPU-surface export. H.264 Annex B chunks are intentionally left to a tiny
 * container mux sink, so RGBA readback and renderer-to-main raw-frame IPC are absent.
 */
export class WebCodecsH264Encoder {
  readonly config: VideoEncoderConfig & { avc: { format: 'annexb' } };
  private readonly encoder: VideoEncoder;
  private readonly writes: Promise<void>[] = [];
  private failure: Error | null = null;
  private frameNumber = 0;
  private closed = false;

  constructor(
    private readonly sink: EncodedVideoChunkSink,
    private readonly options: WebCodecsH264Options
  ) {
    this.config = {
      codec: 'avc1.640028',
      width: options.width,
      height: options.height,
      bitrate: options.bitrate ?? 8_000_000,
      framerate: options.fps,
      hardwareAcceleration: options.hardwareAcceleration ?? 'prefer-hardware',
      latencyMode: 'realtime',
      avc: { format: 'annexb' }
    };
    this.encoder = new VideoEncoder({
      output: chunk => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        this.writes.push(Promise.resolve(this.sink.write(bytes, {
          type: chunk.type,
          timestamp: chunk.timestamp,
          duration: chunk.duration
        })));
      },
      error: error => { this.failure = error; }
    });
    this.encoder.configure(this.config);
  }

  static async isSupported(options: WebCodecsH264Options): Promise<boolean> {
    if (typeof VideoEncoder === 'undefined') return false;
    const config: VideoEncoderConfig & { avc: { format: 'annexb' } } = {
      codec: 'avc1.640028',
      width: options.width,
      height: options.height,
      bitrate: options.bitrate ?? 8_000_000,
      framerate: options.fps,
      hardwareAcceleration: options.hardwareAcceleration ?? 'prefer-hardware',
      latencyMode: 'realtime',
      avc: { format: 'annexb' }
    };
    return (await VideoEncoder.isConfigSupported(config)).supported === true;
  }

  get encodeQueueSize(): number {
    return this.encoder.encodeQueueSize;
  }

  encode(frame: CompositedFrame): void {
    if (this.closed) throw new Error('WebCodecs encoder is closed');
    if (this.failure) throw this.failure;
    const timestamp = Math.round(this.frameNumber / this.options.fps * 1e6);
    const videoFrame = new VideoFrame(frame.surface.canvas, { timestamp });
    try {
      const interval = this.options.keyframeIntervalFrames ?? this.options.fps * 2;
      this.encoder.encode(videoFrame, { keyFrame: this.frameNumber % interval === 0 });
      this.frameNumber += 1;
    } finally {
      videoFrame.close();
    }
  }

  async finish(): Promise<{ frames: number }> {
    if (this.closed) throw new Error('WebCodecs encoder is closed');
    await this.encoder.flush();
    await Promise.all(this.writes);
    if (this.failure) throw this.failure;
    this.encoder.close();
    this.closed = true;
    return { frames: this.frameNumber };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.encoder.close();
  }
}
