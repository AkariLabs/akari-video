// Adapted from packages/preview-engine/src/keyframeIndex.ts.
import * as MP4BoxNamespace from '@webav/mp4box.js';

const MP4Box: typeof MP4BoxNamespace =
  (MP4BoxNamespace as unknown as { default?: typeof MP4BoxNamespace }).default ?? MP4BoxNamespace;

export interface KeyframeIndex {
  keyframeTimesUs: number[];
  nearestAtOrBefore(targetUs: number): number;
  frameEndUs(frameStartUs: number): number | null;
  nearest(targetUs: number): number;
  withinTolerance(targetUs: number, toleranceUs: number): number | null;
}

function createIndex(
  values: readonly number[],
  frameEnds: ReadonlyMap<number, number> = new Map(),
): KeyframeIndex {
  const times = [...values].sort((left, right) => left - right);
  const nearestAtOrBefore = (targetUs: number): number => {
    if (times.length === 0) return 0;
    let low = 0;
    let high = times.length - 1;
    if (targetUs < times[0]!) return times[0]!;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (times[middle]! <= targetUs) low = middle;
      else high = middle - 1;
    }
    return times[low]!;
  };
  const nearest = (targetUs: number): number => {
    const before = nearestAtOrBefore(targetUs);
    const index = times.indexOf(before);
    const after = times[index + 1] ?? before;
    return Math.abs(after - targetUs) < Math.abs(targetUs - before) ? after : before;
  };
  return {
    keyframeTimesUs: times,
    nearestAtOrBefore,
    frameEndUs(frameStartUs) {
      return frameEnds.get(frameStartUs) ?? null;
    },
    nearest,
    withinTolerance(targetUs, toleranceUs) {
      const candidate = nearest(targetUs);
      return Math.abs(candidate - targetUs) <= toleranceUs ? candidate : null;
    }
  };
}

export async function buildKeyframeIndexFromHeader(header: ArrayBuffer): Promise<KeyframeIndex> {
  return new Promise((resolve, reject) => {
    const file = MP4Box.createFile();
    file.onError = message => reject(new Error(`mp4box parse error: ${message}`));
    file.onReady = info => {
      try {
        const track = info.videoTracks[0];
        if (!track) return resolve(createIndex([]));
        const samples = file.getTrackSamplesInfo(track.id);
        const firstDts = samples[0]?.dts ?? 0;
        const timestampUs = (sample: (typeof samples)[number]) =>
          ((sample.cts - firstDts) / sample.timescale) * 1e6;
        const frameEnds = new Map<number, number>();
        for (const sample of samples) {
          const startUs = timestampUs(sample);
          const duration = (sample as typeof sample & { duration?: number }).duration;
          if (typeof duration === 'number') {
            frameEnds.set(startUs, startUs + (duration / sample.timescale) * 1e6);
          }
        }
        resolve(createIndex(
          samples.filter(sample => sample.is_sync).map(timestampUs),
          frameEnds,
        ));
      } catch (error) {
        reject(error);
      }
    };
    const buffer = header as ArrayBuffer & { fileStart: number };
    buffer.fileStart = 0;
    file.appendBuffer(buffer);
    file.flush();
  });
}
