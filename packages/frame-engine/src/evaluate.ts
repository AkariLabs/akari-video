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
  ResolvedCompositeLayer,
  ResolvedEvaluationLayer,
  RotatedVideoFrame,
  StillImageBitmap,
  UploadPath,
} from './types.js';

export interface EvaluationContext {
  compositor: CompositorBackend;
  metrics: FrameMetricsRecorder;
  /**
   * 合成層（video / image / matte）1 枚の準備（image load / decode / mask decode）が失敗し、その層だけを
   * 抜いて描いたときの通知。同一 layerId につき 1 回だけ呼ぶ（毎フレーム積み上がる警告にしない）。
   * base（cuts）の失敗はここを通らず、従来どおり evaluateFrame が reject する。
   */
  onLayerFailure?(layerId: string, error: unknown): void;
}

export class FrameEvaluator {
  constructor(private readonly context: EvaluationContext) {}

  evaluateFrame(plan: EvaluationPlan): Promise<CompositedFrame> {
    return evaluateFrame(plan, this.context);
  }
}

/**
 * onLayerFailure を通知済みの layerId。ホストは context をフレームごとに組み直す一方、metrics は再生 /
 * 書き出しの間ずっと同じ instance を渡すので、通知済み集合は metrics に紐づけて持つ（WeakMap なので
 * metrics と一緒に回収される）。
 */
const notifiedLayerFailures = new WeakMap<FrameMetricsRecorder, Set<string>>();

function noteLayerFailure(context: EvaluationContext, layerId: string, error: unknown): void {
  context.metrics.recordSkippedLayer?.(layerId);
  if (!context.onLayerFailure) return;
  let notified = notifiedLayerFailures.get(context.metrics);
  if (!notified) {
    notified = new Set();
    notifiedLayerFailures.set(context.metrics, notified);
  }
  if (notified.has(layerId)) return;
  notified.add(layerId);
  context.onLayerFailure(layerId, error);
}

type PreparedLayer =
  | { color: StillImageBitmap; mask?: undefined }
  | { color: VideoFrame; mask: VideoFrame | null; sourceTimeUs: number };

/**
 * 合成層 1 枚の入力を揃える。失敗は throw で呼び出し側に返し、その時点で decode 済みの frame は
 * ここで close する（呼び出し側は失敗した層の frame を一切受け取らない）。
 */
async function prepareCompositeLayer(
  layer: ResolvedCompositeLayer,
  metrics: FrameMetricsRecorder,
): Promise<PreparedLayer> {
  if (layer.kind === 'image') {
    if (!layer.image) throw new Error(`image layer ${layer.id} has no image source`);
    // 静止画のビットマップは source が保持するので閉じない（base の image cut と同じ）
    return { color: await layer.image.load() };
  }
  if (!layer.source || layer.sourceTimeUs == null) throw new Error(`video layer ${layer.id} has no source`);
  const decodeStarted = performance.now();
  const frame = await layer.source.decode(layer.sourceTimeUs, metrics, { streamId: `layer-${layer.id}` });
  metrics.record('decode', performance.now() - decodeStarted);
  const sourceTimeUs = layer.sourceTimeUs;
  if (!(layer.kind === 'matte' && layer.mask)) return { color: frame, mask: null, sourceTimeUs };
  let maskFrame: VideoFrame;
  try {
    const maskDecodeStarted = performance.now();
    maskFrame = await layer.mask.source.decode(
      layer.mask.sourceTimeUs,
      metrics,
      { streamId: `layer-${layer.id}-mask` }
    );
    metrics.record('decode', performance.now() - maskDecodeStarted);
  } catch (error) {
    // マスクが読めない層は「色だけ描く」のではなく層ごと抜く（マスク無しの人物が矩形のまま出る方が誤解を生む）
    frame.close();
    throw error;
  }
  return { color: frame, mask: maskFrame, sourceTimeUs };
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
  // compositor は layerFrames[i] と plan.layers[i] を位置で対応づけるので、抜いた層は plan 側からも外す
  const composedLayers: ResolvedEvaluationLayer[] = [];
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
        composedLayers.push(layer);
        continue;
      }
      // 層 1 枚の準備失敗はその層だけを抜き、本編と他の層は描く（失敗した層の frame は prepare 側で close 済み）
      let prepared: PreparedLayer;
      try {
        prepared = await prepareCompositeLayer(layer, context.metrics);
      } catch (error) {
        noteLayerFailure(context, layer.id, error);
        continue;
      }
      if ('bitmap' in prepared.color) {
        layerFrames.push({ color: prepared.color });
        composedLayers.push(layer);
        continue;
      }
      const frame = prepared.color;
      decoded.push(frame);
      const mask = prepared.mask;
      if (mask) {
        decoded.push(mask);
        maskSync.push({
          layerId: layer.id,
          colorTimestamp: Number(frame.timestamp ?? 0),
          maskTimestamp: Number(mask.timestamp ?? 0),
          requestedUs: prepared.sourceTimeUs
        });
      }
      layerFrames.push({ color: frame, mask });
      composedLayers.push(layer);
    }
    // 何も抜けていなければ plan をそのまま渡す（成功経路は従来と同一の object）
    const composePlan: EvaluationPlan = composedLayers.length === plan.layers.length
      ? plan
      : { ...plan, layers: composedLayers };

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
        composePlan,
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
        composePlan,
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
