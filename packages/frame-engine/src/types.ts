import type { TransitionType } from '@akari-video/edit-store';
import type { ParsedCubeLut } from './look/cube.js';

export type TimelineTimeUs = number;
export type NativeVideoFormat = 'NV12' | 'I420';
export type UploadPath = 'direct' | 'copyTo';
export type FrameMetricStage =
  | 'decode'
  | 'tick'
  | 'copy'
  | 'copyTo'
  | 'planeCompact'
  | 'upload'
  | 'shader'
  | 'shaderGpu'
  | 'present'
  | 'readback'
  | 'pboWait'
  | 'rowFlip'
  | 'sink'
  | 'ipcWrite'
  | 'ffmpegDrain'
  | 'ffmpegClose';

export interface FrameMetricsRecorder {
  record(stage: FrameMetricStage, elapsedMs: number): void;
  recordUploadPath?(path: UploadPath): void;
}

export interface NativeNv12Frame {
  format: 'NV12';
  width: number;
  height: number;
  y: Uint8Array;
  uv: Uint8Array;
  rotationDeg?: number;
}

export interface NativeI420Frame {
  format: 'I420';
  width: number;
  height: number;
  y: Uint8Array;
  u: Uint8Array;
  v: Uint8Array;
  rotationDeg?: number;
}

export type NativeYuvFrame = NativeNv12Frame | NativeI420Frame;
export type RotatedVideoFrame = VideoFrame & { rotationDeg?: number };

/** VideoFrame.clone() drops expandos, so explicitly carry rotation metadata forward. */
export function cloneWithRotation<T extends { clone(): T }>(frame: T): T {
  const clone = frame.clone();
  (clone as unknown as RotatedVideoFrame).rotationDeg =
    (frame as unknown as RotatedVideoFrame).rotationDeg;
  return clone;
}

export interface NativeFrameSource {
  decode(
    timeUs: TimelineTimeUs,
    metrics?: FrameMetricsRecorder,
    request?: { streamId: string }
  ): Promise<VideoFrame>;
}

export interface StillImageBitmap {
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
}

export interface StillImageSource {
  load(): Promise<StillImageBitmap>;
  destroy(): void;
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

export interface ResolvedLayerVisual {
  crop: { x: number; y: number; width: number; height: number };
  perspective: { corners: readonly (readonly [number, number])[] } | null;
  transform: { x: number; y: number; scale: number; rotateDegrees: number };
}

export type ResolvedLayerBlendMode =
  | 'normal' | 'screen' | 'multiply' | 'add' | 'difference'
  | 'darken' | 'lighten' | 'overlay' | 'hardlight' | 'softlight';

export interface ResolvedLayerMask {
  kind: 'greyscale';
  source: NativeFrameSource;
  sourceTimeUs: TimelineTimeUs;
}

export interface ResolvedCompositeLayer {
  id: string;
  kind: 'video' | 'image' | 'matte';
  source?: NativeFrameSource;
  sourceTimeUs?: TimelineTimeUs;
  image?: StillImageSource;
  mask: ResolvedLayerMask | null;
  visual: ResolvedLayerVisual;
  blend: ResolvedLayerBlendMode;
  opacity: number;
}

export interface ResolvedTransition {
  type: 'hard-cut' | TransitionType;
  progress: number;
}

export interface ResolvedLook {
  lut: ParsedCubeLut;
  intensity: number;
}

export interface EvaluationPlan {
  timeUs: TimelineTimeUs;
  base: readonly ResolvedVideoLayer[];
  layers: readonly ResolvedCompositeLayer[];
  transition?: ResolvedTransition;
  output: {
    width: number;
    height: number;
    colorSpace: 'bt709-limited';
    look?: ResolvedLook | null;
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
  readonly uploadPath: UploadPath;
  readonly maskSync?: readonly {
    layerId: string;
    colorTimestamp: number;
    maskTimestamp: number;
    requestedUs: number;
  }[];
  close(): void;
}

export interface RawFrameSink {
  write(rgba: Uint8Array, frame: Pick<CompositedFrame, 'timeUs'>): Promise<void> | void;
}

export interface CompositorBackend {
  readonly kind: 'webgl2';
  readonly uploadPath?: UploadPath;
  compose(
    base: readonly (NativeYuvFrame | VideoFrame)[],
    layers: readonly {
      color: NativeYuvFrame | StillImageBitmap | VideoFrame;
      mask?: NativeYuvFrame | VideoFrame | null;
    }[],
    output: EvaluationPlan['output'],
    metrics: FrameMetricsRecorder,
    plan: EvaluationPlan
  ): Promise<GPUFrameSurface>;
  dispose(): void;
}
