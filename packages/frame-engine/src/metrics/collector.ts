import type {
  FrameMetricStage,
  FrameMetricsRecorder,
  UploadPath,
} from '../types.js';

export interface MetricSummary {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export type FrameMetricsJson = Record<FrameMetricStage, MetricSummary> & {
  uploadPath: UploadPath | null;
  uploadPathCounts: Record<UploadPath, number>;
  /** 準備に失敗して抜いた合成層の累積数（層 × フレーム）。既存キーは変えず additive に足す。 */
  skippedLayers: number;
};

const STAGES: readonly FrameMetricStage[] = [
  'decode',
  'tick',
  'copy',
  'copyTo',
  'planeCompact',
  'upload',
  'shader',
  'shaderGpu',
  'present',
  'readback',
  'pboWait',
  'rowFlip',
  'sink',
  'ipcWrite',
  'ffmpegDrain',
  'ffmpegClose'
];

// Math.max(...values) passes one argument per sample and overflows the stack past roughly 125k
// arguments (measured on Node 22). record() appends once per frame per stage, so any export longer
// than about 69 minutes at 30fps crosses that line -- and toJSON() runs after every frame is
// already encoded, so the throw would discard a finished export at the last step. A loop has no
// such ceiling. percentile's [...values] is an array spread, which is not argument-bound.
function maxOf(values: readonly number[]): number {
  let max = -Infinity;
  for (const value of values) {
    if (value > max) max = value;
  }
  return max;
}

function percentile(values: readonly number[], value: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * value / 100) - 1));
  return sorted[index] ?? null;
}

export class FrameMetrics implements FrameMetricsRecorder {
  private readonly samples = new Map<FrameMetricStage, number[]>(
    STAGES.map(stage => [stage, []])
  );
  private uploadPath: UploadPath | null = null;
  private readonly uploadPathCounts: Record<UploadPath, number> = {
    direct: 0,
    copyTo: 0,
  };
  private skippedLayers = 0;

  record(stage: FrameMetricStage, elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new Error(`invalid ${stage} metric: ${elapsedMs}`);
    }
    this.samples.get(stage)!.push(elapsedMs);
  }

  recordUploadPath(path: UploadPath): void {
    this.uploadPath = path;
    this.uploadPathCounts[path] += 1;
  }

  recordSkippedLayer(_layerId: string): void {
    this.skippedLayers += 1;
  }

  toJSON(): FrameMetricsJson {
    return {
      ...Object.fromEntries(STAGES.map(stage => {
      const values = this.samples.get(stage)!;
      return [stage, {
        count: values.length,
        p50Ms: percentile(values, 50),
        p95Ms: percentile(values, 95),
        maxMs: values.length > 0 ? maxOf(values) : null
      }];
      })),
      uploadPath: this.uploadPath,
      uploadPathCounts: { ...this.uploadPathCounts },
      skippedLayers: this.skippedLayers,
    } as FrameMetricsJson;
  }
}
