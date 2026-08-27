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

  toJSON(): FrameMetricsJson {
    return {
      ...Object.fromEntries(STAGES.map(stage => {
      const values = this.samples.get(stage)!;
      return [stage, {
        count: values.length,
        p50Ms: percentile(values, 50),
        p95Ms: percentile(values, 95),
        maxMs: values.length > 0 ? Math.max(...values) : null
      }];
      })),
      uploadPath: this.uploadPath,
      uploadPathCounts: { ...this.uploadPathCounts },
    } as FrameMetricsJson;
  }
}
