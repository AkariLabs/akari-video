// Adapted from packages/preview-engine/src/keyframeIndex.ts.
import * as MP4BoxNamespace from '@webav/mp4box.js';

const MP4Box: typeof MP4BoxNamespace =
  (MP4BoxNamespace as unknown as { default?: typeof MP4BoxNamespace }).default ?? MP4BoxNamespace;

export interface KeyframeIndex {
  keyframeTimesUs: number[];
  lastFrameStartUs: number | null;
  decoderTimestampOffsetUs: number;
  presentationDurationUs: number | null;
  nearestAtOrBefore(targetUs: number): number;
  frameEndUs(frameStartUs: number): number | null;
  nextFrameStartUs(frameStartUs: number): number | null;
  nearest(targetUs: number): number;
  withinTolerance(targetUs: number, toleranceUs: number): number | null;
}

function createIndex(
  values: readonly number[],
  frameEnds: ReadonlyMap<number, number> = new Map(),
  nextFrameStarts: ReadonlyMap<number, number> = new Map(),
  lastFrameStartUs: number | null = null,
  decoderTimestampOffsetUs = 0,
  presentationDurationUs: number | null = null,
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
    lastFrameStartUs,
    decoderTimestampOffsetUs,
    presentationDurationUs,
    nearestAtOrBefore,
    frameEndUs(frameStartUs) {
      return frameEnds.get(frameStartUs) ?? null;
    },
    nextFrameStartUs(frameStartUs) {
      const roundedStartUs = Math.round(frameStartUs);
      return nextFrameStarts.get(roundedStartUs)
        ?? nextFrameStarts.get(roundedStartUs - 1)
        ?? nextFrameStarts.get(roundedStartUs + 1)
        ?? null;
    },
    nearest,
    withinTolerance(targetUs, toleranceUs) {
      const candidate = nearest(targetUs);
      return Math.abs(candidate - targetUs) <= toleranceUs ? candidate : null;
    }
  };
}

export interface MediaEdit {
  segment_duration: number;
  media_time: number;
  media_rate_integer: number;
  media_rate_fraction: number;
}

/**
 * Returns the difference between av-cliper's decoder timestamps and the MP4
 * presentation timeline. av-cliper subtracts the first DTS, while an edit list
 * maps the first presented CTS to time zero.
 */
export function calculateDecoderTimestampOffsetUs(
  firstDts: number,
  trackTimescale: number,
  edits: readonly MediaEdit[] | undefined,
): number {
  if (!Number.isFinite(firstDts) || !(trackTimescale > 0)) return 0;
  const mediaEdit = presentationMediaEdit(edits);
  if (!mediaEdit) return 0;
  return Math.max(
    0,
    Math.round(((mediaEdit.media_time - firstDts) / trackTimescale) * 1e6),
  );
}

function presentationMediaEdit(edits: readonly MediaEdit[] | undefined): MediaEdit | undefined {
  return edits?.find(edit => edit.media_time >= 0
    && edit.media_rate_integer === 1
    && edit.media_rate_fraction === 0);
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
        const decoderTimestampOffsetUs = calculateDecoderTimestampOffsetUs(
          firstDts,
          track.timescale,
          track.edits,
        );
        const presentationMediaTime = presentationMediaEdit(track.edits)?.media_time ?? firstDts;
        const editDuration = track.edits?.reduce((sum, edit) => sum + edit.segment_duration, 0) ?? 0;
        const presentationDurationUs = editDuration > 0 && info.timescale > 0
          ? Math.round(
            (editDuration / info.timescale) * 1e6,
          )
          : null;
        const timestampUs = (sample: (typeof samples)[number]) =>
          ((sample.cts - presentationMediaTime) / sample.timescale) * 1e6;
        let lastFrameStartUs: number | null = null;
        for (const sample of samples) {
          const startUs = Math.round(timestampUs(sample));
          lastFrameStartUs = lastFrameStartUs == null ? startUs : Math.max(lastFrameStartUs, startUs);
        }
        const presentationStarts = [...new Set(samples.map(sample => Math.round(timestampUs(sample))))]
          .sort((left, right) => left - right);
        const nextFrameStarts = new Map<number, number>();
        for (let index = 0; index < presentationStarts.length - 1; index += 1) {
          nextFrameStarts.set(presentationStarts[index]!, presentationStarts[index + 1]!);
        }
        const frameEnds = new Map<number, number>();
        for (const sample of samples) {
          const startUs = timestampUs(sample);
          const duration = (sample as typeof sample & { duration?: number }).duration;
          if (typeof duration === 'number') {
            const declaredEndUs = startUs + (duration / sample.timescale) * 1e6;
            const nextStartUs = nextFrameStarts.get(Math.round(startUs));
            frameEnds.set(
              startUs,
              nextStartUs != null && declaredEndUs > nextStartUs + 1
                ? nextStartUs
                : declaredEndUs,
            );
          }
        }
        resolve(createIndex(
          samples.filter(sample => sample.is_sync).map(timestampUs),
          frameEnds,
          nextFrameStarts,
          lastFrameStartUs,
          decoderTimestampOffsetUs,
          presentationDurationUs,
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
