// Adapted from packages/preview-engine/src/keyframeIndex.ts.
import * as MP4BoxNamespace from '@webav/mp4box.js';
import { describeIndexParseFailure, videoOnlyIndexHeader } from './mp4-boxes.js';

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
 * 索引済みのキーフレーム時刻から最大キーフレーム間隔（秒）を出す。長い GOP はシークのたびに
 * 直前のキーフレームから復号し直すことになり、プレビューのカット切り替えとスクラブが遅くなる
 * （不具合メモ 第3項: 原本のまま再生していた区間が約 1fps になった）。
 *
 * 索引は全ソースで既に作っているので追加の読み取りは発生しない。末尾の扱いは
 * edit-lint の source.proxy-long-gop と同じく「最後のキーフレームから素材末尾まで」も
 * 1 区間として数える（末尾に長い GOP がある素材を見逃さないため）。
 * キーフレームが 1 枚も無い / 素材尺が不明なときは undefined（判定しない）。
 */
export function maxKeyframeIntervalSeconds(index: KeyframeIndex): number | undefined {
  const times = index.keyframeTimesUs;
  if (!Array.isArray(times) || times.length === 0) return undefined;
  let maxUs = 0;
  for (let position = 1; position < times.length; position += 1) {
    const gap = times[position]! - times[position - 1]!;
    if (gap > maxUs) maxUs = gap;
  }
  const endUs = index.presentationDurationUs ?? index.lastFrameStartUs;
  if (endUs != null && Number.isFinite(endUs)) {
    const tailGap = endUs - times[times.length - 1]!;
    if (tailGap > maxUs) maxUs = tailGap;
  } else if (times.length < 2) {
    // キーフレーム 1 枚で末尾も分からなければ間隔は測れない。
    return undefined;
  }
  return maxUs / 1e6;
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

export async function buildKeyframeIndexFromHeader(rawHeader: ArrayBuffer): Promise<KeyframeIndex> {
  // 索引に要るのは映像 trak だけ。非映像 trak はここで隠す（呼び出し側に任せると経路が
  // 1 本抜ける。不具合メモ 第19項の再発防止）。隠すのはヘッダーのコピーだけなので、映像の
  // バイトオフセット・原本・音声ミックス経路は変わらない。
  const header = videoOnlyIndexHeader(rawHeader);
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
    try {
      file.appendBuffer(buffer);
      file.flush();
    } catch (error) {
      // MP4Box は appendBuffer の中で同期 throw する。ここで受けないと素の
      // `RangeError: Invalid array length` がそのまま利用者へ出て、どの素材のどの段で
      // 失敗したのか分からない（不具合メモ 第1項: 例外スタック・最小再現が採取できなかった）。
      reject(describeIndexParseFailure(error, 'keyframe index', header.byteLength));
    }
  });
}
