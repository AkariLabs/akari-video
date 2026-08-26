import type { FrameMetricStage, FrameMetricsRecorder } from '../types.js';

export interface MetricSummary {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export type FrameMetricsJson = Record<FrameMetricStage, MetricSummary>;

const STAGES: readonly FrameMetricStage[] = [
  'decode',
  'copy',
  'upload',
  'shader',
  'readback',
  'sink'
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

  record(stage: FrameMetricStage, elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new Error(`invalid ${stage} metric: ${elapsedMs}`);
    }
    this.samples.get(stage)!.push(elapsedMs);
  }

  toJSON(): FrameMetricsJson {
    return Object.fromEntries(STAGES.map(stage => {
      const values = this.samples.get(stage)!;
      return [stage, {
        count: values.length,
        p50Ms: percentile(values, 50),
        p95Ms: percentile(values, 95),
        maxMs: values.length > 0 ? Math.max(...values) : null
      }];
    })) as FrameMetricsJson;
  }
}
