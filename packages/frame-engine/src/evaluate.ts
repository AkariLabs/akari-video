import { copyNativeYuvFrame } from './decode/native-yuv.js';
import { DirectUploadFallbackError } from './compositor/webgl2.js';
import type {
  CompositedFrame,
  CompositorLayerInput,
  CompositorBackend,
  EvaluationPlan,
  FrameMetricsRecorder,
  NativeVideoFormat,
  NativeYuvFrame,
  RotatedVideoFrame,
  StillImageBitmap,
  UploadPath,
} from './types.js';

export interface EvaluationContext {
  compositor: CompositorBackend;
  metrics: FrameMetricsRecorder;
}

export class FrameEvaluator {
  constructor(private readonly context: EvaluationContext) {}

  evaluateFrame(plan: EvaluationPlan): Promise<CompositedFrame> {
    return evaluateFrame(plan, this.context);
  }
}

/** The sole frame evaluator. Preview/export are deliberately absent from this function. */
export async function evaluateFrame(
  plan: EvaluationPlan,
  context: EvaluationContext
): Promise<CompositedFrame> {
  const decoded: VideoFrame[] = [];
  const baseFrames: Array<VideoFrame | StillImageBitmap> = [];
  const layerFrames: Array<
    | { kind?: 'media'; color: VideoFrame | StillImageBitmap; mask?: VideoFrame | null }
    | { kind: 'filter' }
  > = [];
  const maskSync: Array<{
    layerId: string;
    colorTimestamp: number;
    maskTimestamp: number;
    requestedUs: number;
  }> = [];
  try {
    for (const layer of plan.base) {
      if (layer.kind === 'image') {
        // 静止画 cut（issue #30）: デコードは無く、ビットマップは source が保持するので閉じない
        baseFrames.push(await layer.image.load());
        continue;
      }
      const decodeStarted = performance.now();
      const frame = await layer.source.decode(layer.sourceTimeUs, context.metrics, { streamId: layer.id });
      context.metrics.record('decode', performance.now() - decodeStarted);
      decoded.push(frame);
      baseFrames.push(frame);
    }
    for (const layer of plan.layers) {
      if (layer.kind === 'filter') {
        layerFrames.push({ kind: 'filter' });
        continue;
      }
      if (layer.kind === 'image') {
        if (!layer.image) throw new Error(`image layer ${layer.id} has no image source`);
        layerFrames.push({ color: await layer.image.load() });
        continue;
      }
      if (!layer.source || layer.sourceTimeUs == null) throw new Error(`video layer ${layer.id} has no source`);
      const decodeStarted = performance.now();
      const frame = await layer.source.decode(layer.sourceTimeUs, context.metrics, { streamId: `layer-${layer.id}` });
      context.metrics.record('decode', performance.now() - decodeStarted);
      decoded.push(frame);
      let mask: VideoFrame | null = null;
      if (layer.kind === 'matte' && layer.mask) {
        const maskDecodeStarted = performance.now();
        const maskFrame = await layer.mask.source.decode(
          layer.mask.sourceTimeUs,
          context.metrics,
          { streamId: `layer-${layer.id}-mask` }
        );
        context.metrics.record('decode', performance.now() - maskDecodeStarted);
        decoded.push(maskFrame);
        mask = maskFrame;
        maskSync.push({
          layerId: layer.id,
          colorTimestamp: Number(frame.timestamp ?? 0),
          maskTimestamp: Number(maskFrame.timestamp ?? 0),
          requestedUs: layer.sourceTimeUs
        });
      }
      layerFrames.push({ color: frame, mask });
    }

    const copyFrame = async (frame: VideoFrame): Promise<NativeYuvFrame | VideoFrame> => {
      if (frame.format !== 'NV12' && frame.format !== 'I420') return frame;
      const started = performance.now();
      const copied = await copyNativeYuvFrame(frame, context.metrics);
      copied.rotationDeg = (frame as RotatedVideoFrame).rotationDeg;
      context.metrics.record('copy', performance.now() - started);
      return copied;
    };
    const buildInputs = async (path: UploadPath) => {
      if (path === 'direct') return { base: baseFrames, layers: layerFrames };
      const base: Array<NativeYuvFrame | StillImageBitmap | VideoFrame> = [];
      for (const frame of baseFrames) base.push('bitmap' in frame ? frame : await copyFrame(frame));
      const layers: CompositorLayerInput[] = [];
      for (const input of layerFrames) {
        if (input.kind === 'filter') {
          layers.push(input);
          continue;
        }
        const color = 'bitmap' in input.color
          ? input.color
          : await copyFrame(input.color);
        const mask = input.mask ? await copyFrame(input.mask) : input.mask;
        layers.push({ color, mask });
      }
      return { base, layers };
    };

    let usedPath: UploadPath = context.compositor.uploadPath ?? 'copyTo';
    let inputs = await buildInputs(usedPath);
    let surface;
    try {
      surface = await context.compositor.compose(
        inputs.base,
        inputs.layers,
        plan.output,
        context.metrics,
        plan,
      );
      usedPath = context.compositor.uploadPath ?? usedPath;
    } catch (error) {
      if (!(error instanceof DirectUploadFallbackError) || usedPath !== 'direct') {
        throw error;
      }
      usedPath = 'copyTo';
      inputs = await buildInputs(usedPath);
      surface = await context.compositor.compose(
        inputs.base,
        inputs.layers,
        plan.output,
        context.metrics,
        plan,
      );
    }
    context.metrics.recordUploadPath?.(usedPath);
    const formats = decoded
      .map(frame => frame.format)
      .filter((format): format is NativeVideoFormat =>
        format === 'NV12' || format === 'I420');
    let closed = false;
    return {
      timeUs: plan.timeUs,
      surface,
      nativeFormats: formats,
      uploadPath: usedPath,
      ...(maskSync.length > 0 ? { maskSync } : {}),
      close() {
        if (closed) return;
        closed = true;
        surface.close();
      }
    };
  } finally {
    for (const frame of decoded) frame.close();
  }
}
