import { copyNativeYuvFrame } from './decode/native-yuv.js';
import type {
  CompositedFrame,
  CompositorBackend,
  EvaluationPlan,
  FrameMetricsRecorder,
  NativeVideoFormat,
  NativeYuvFrame,
  StillImageBitmap
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
  const baseNative: NativeYuvFrame[] = [];
  const layerInputs: Array<{ color: NativeYuvFrame | StillImageBitmap; mask?: NativeYuvFrame | null }> = [];
  const maskSync: Array<{
    layerId: string;
    colorTimestamp: number;
    maskTimestamp: number;
    requestedUs: number;
  }> = [];
  try {
    for (const layer of plan.base) {
      const decodeStarted = performance.now();
      const frame = await layer.source.decode(layer.sourceTimeUs, context.metrics, { streamId: layer.id });
      context.metrics.record('decode', performance.now() - decodeStarted);
      decoded.push(frame);
      const copyStarted = performance.now();
      baseNative.push(await copyNativeYuvFrame(frame, context.metrics));
      context.metrics.record('copy', performance.now() - copyStarted);
    }
    for (const layer of plan.layers) {
      if (layer.kind === 'image') {
        if (!layer.image) throw new Error(`image layer ${layer.id} has no image source`);
        layerInputs.push({ color: await layer.image.load() });
        continue;
      }
      if (!layer.source || layer.sourceTimeUs == null) throw new Error(`video layer ${layer.id} has no source`);
      const decodeStarted = performance.now();
      const frame = await layer.source.decode(layer.sourceTimeUs, context.metrics, { streamId: `layer-${layer.id}` });
      context.metrics.record('decode', performance.now() - decodeStarted);
      decoded.push(frame);
      const copyStarted = performance.now();
      const color = await copyNativeYuvFrame(frame, context.metrics);
      context.metrics.record('copy', performance.now() - copyStarted);
      let mask: NativeYuvFrame | null = null;
      if (layer.kind === 'matte' && layer.mask) {
        const maskDecodeStarted = performance.now();
        const maskFrame = await layer.mask.source.decode(
          layer.mask.sourceTimeUs,
          context.metrics,
          { streamId: `layer-${layer.id}-mask` }
        );
        context.metrics.record('decode', performance.now() - maskDecodeStarted);
        decoded.push(maskFrame);
        const maskCopyStarted = performance.now();
        mask = await copyNativeYuvFrame(maskFrame, context.metrics);
        context.metrics.record('copy', performance.now() - maskCopyStarted);
        maskSync.push({
          layerId: layer.id,
          colorTimestamp: Number(frame.timestamp ?? 0),
          maskTimestamp: Number(maskFrame.timestamp ?? 0),
          requestedUs: layer.sourceTimeUs
        });
      }
      layerInputs.push({ color, mask });
    }
    const surface = await context.compositor.compose(baseNative, layerInputs, plan.output, context.metrics, plan);
    const formats = [
      ...baseNative,
      ...layerInputs.flatMap(value => [value.color, value.mask].filter(
        (frame): frame is NativeYuvFrame => Boolean(frame && 'format' in frame)
      ))
    ]
      .map(frame => frame.format) as NativeVideoFormat[];
    let closed = false;
    return {
      timeUs: plan.timeUs,
      surface,
      nativeFormats: formats,
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
