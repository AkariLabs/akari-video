import { copyNativeYuvFrame } from './decode/native-yuv.js';
import type {
  CompositedFrame,
  CompositorBackend,
  EvaluationPlan,
  FrameMetricsRecorder,
  NativeVideoFormat,
  NativeYuvFrame
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
  if (plan.transition && plan.transition.type !== 'hard-cut') {
    throw new Error(`unsupported Phase 1a transition: ${plan.transition.type}`);
  }
  const decoded: VideoFrame[] = [];
  const native: NativeYuvFrame[] = [];
  try {
    for (const layer of plan.layers) {
      const decodeStarted = performance.now();
      const frame = await layer.source.decode(layer.sourceTimeUs);
      context.metrics.record('decode', performance.now() - decodeStarted);
      decoded.push(frame);
      const copyStarted = performance.now();
      native.push(await copyNativeYuvFrame(frame));
      context.metrics.record('copy', performance.now() - copyStarted);
    }
    const surface = await context.compositor.compose(native, plan.output, context.metrics);
    const formats = native.map(frame => frame.format) as NativeVideoFormat[];
    let closed = false;
    return {
      timeUs: plan.timeUs,
      surface,
      nativeFormats: formats,
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
