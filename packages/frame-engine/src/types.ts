export type TimelineTimeUs = number;
export type NativeVideoFormat = 'NV12' | 'I420';
export type FrameMetricStage =
  | 'decode'
  | 'tick'
  | 'copy'
  | 'copyTo'
  | 'planeCompact'
  | 'upload'
  | 'shader'
  | 'shaderGpu'
  | 'readback'
  | 'pboWait'
  | 'rowFlip'
  | 'sink'
  | 'ipcWrite'
  | 'ffmpegDrain'
  | 'ffmpegClose';

export interface FrameMetricsRecorder {
  record(stage: FrameMetricStage, elapsedMs: number): void;
}

export interface NativeNv12Frame {
  format: 'NV12';
  width: number;
  height: number;
  y: Uint8Array;
  uv: Uint8Array;
}

export interface NativeI420Frame {
  format: 'I420';
  width: number;
  height: number;
  y: Uint8Array;
  u: Uint8Array;
  v: Uint8Array;
}

export type NativeYuvFrame = NativeNv12Frame | NativeI420Frame;

export interface NativeFrameSource {
  decode(
    timeUs: TimelineTimeUs,
    metrics?: FrameMetricsRecorder,
    request?: { streamId: string }
  ): Promise<VideoFrame>;
}

export interface ResolvedFraming {
  /** Normalized source window after the source has been fitted to the output canvas. */
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  centerX: number;
  centerY: number;
}

export interface ResolvedCutVisual {
  framing: ResolvedFraming;
  transform: {
    x: number;
    y: number;
    scale: number;
    rotateDegrees: number;
  };
  opacity: number;
}

export interface ResolvedVideoLayer {
  id: string;
  source: NativeFrameSource;
  sourceTimeUs: TimelineTimeUs;
  visual: ResolvedCutVisual;
}

export interface ResolvedTransition {
  type: 'hard-cut' | 'dissolve' | 'fade-black' | 'fade-white' | 'reveal-down' | 'reveal-up';
  progress: number;
}

export interface EvaluationPlan {
  timeUs: TimelineTimeUs;
  layers: readonly ResolvedVideoLayer[];
  transition?: ResolvedTransition;
  output: {
    width: number;
    height: number;
    colorSpace: 'bt709-limited';
  };
}

export interface GPUFrameSurface {
  readonly canvas: HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readRgba(): Promise<Uint8Array>;
  recordSink(elapsedMs: number): void;
  close(): void;
}

export interface CompositedFrame {
  readonly timeUs: TimelineTimeUs;
  readonly surface: GPUFrameSurface;
  readonly nativeFormats: readonly NativeVideoFormat[];
  close(): void;
}

export interface RawFrameSink {
  write(rgba: Uint8Array, frame: Pick<CompositedFrame, 'timeUs'>): Promise<void> | void;
}

export interface CompositorBackend {
  readonly kind: 'webgl2';
  compose(
    frames: readonly NativeYuvFrame[],
    output: EvaluationPlan['output'],
    metrics: FrameMetricsRecorder,
    plan: EvaluationPlan
  ): Promise<GPUFrameSurface>;
  dispose(): void;
}
