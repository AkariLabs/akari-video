export type TimelineTimeUs = number;
export type NativeVideoFormat = 'NV12' | 'I420';
export type FrameMetricStage = 'decode' | 'copy' | 'upload' | 'shader' | 'readback' | 'sink';

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
  decode(timeUs: TimelineTimeUs): Promise<VideoFrame>;
}

export interface ResolvedVideoLayer {
  id: string;
  source: NativeFrameSource;
  sourceTimeUs: TimelineTimeUs;
}

export interface ResolvedTransition {
  type: 'hard-cut';
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
    metrics: FrameMetricsRecorder
  ): Promise<GPUFrameSurface>;
  dispose(): void;
}
