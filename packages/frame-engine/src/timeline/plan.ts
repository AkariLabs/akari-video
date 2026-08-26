import { outputToSource } from '@akari-video/edit-store';
import type { TimelineMapResult, TimelineSegment } from '@akari-video/edit-store';
import type { EvaluationPlan, NativeFrameSource, TimelineTimeUs } from '../types.js';

export type TimelineSourceRegistry = ReadonlyMap<string, NativeFrameSource>;

/** Converts the edit-store SSOT's resolved hard-cut winner into an evaluation plan. */
export function evaluationPlanFromTimelineMap(
  timelineMap: TimelineMapResult,
  timeUs: TimelineTimeUs,
  sources: TimelineSourceRegistry,
  output: EvaluationPlan['output']
): EvaluationPlan {
  const outputSeconds = timeUs / 1e6;
  const resolved = outputToSource(timelineMap.segments, outputSeconds);
  const layers = resolved.segment?.kind === 'src' && resolved.sourceT != null
    ? [layerFromSegment(resolved.segment, resolved.sourceT, sources)]
    : [];
  return {
    timeUs,
    layers,
    transition: { type: 'hard-cut' },
    output
  };
}

function layerFromSegment(
  segment: TimelineSegment,
  sourceSeconds: number,
  sources: TimelineSourceRegistry
): EvaluationPlan['layers'][number] {
  if (!segment.src) throw new Error(`resolved cut ${segment.cutIndex ?? 'unknown'} has no src`);
  const source = sources.get(segment.src);
  if (!source) throw new Error(`no frame source registered for ${segment.src}`);
  return {
    id: `cut-${segment.cutIndex ?? 'unknown'}`,
    source,
    sourceTimeUs: Math.round(sourceSeconds * 1e6)
  };
}
