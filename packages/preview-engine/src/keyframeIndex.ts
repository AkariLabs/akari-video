// E1 の基盤: ソースのキーフレーム（sync sample）タイムスタンプ一覧を構築する。
//
// 設計: MP4Clip は内部で「後方シーク or 前方 3 秒超ジャンプは必ず直前キーフレームまで
// デコーダをリセットし、そこから対象時刻まで全フレームを歩いてデコードする」実装になっている
// （av-cliper 1.2.8 dist 実装を読み取り確認 — video frame finder の #h/#m 相当）。
// つまり「要求時刻をキーフレーム自身の cts に丸めてから tick() する」だけで、
// リセット後の歩行コストがほぼゼロになる（decode 1 フレームで即終了）。
// これは Palmier(AVFoundation) の toleranceBefore/After が「範囲内の安価なフレームで妥協する」
// のと同じ効果を、WebCodecs 環境で実現する具体的な手段になる。
//
// キーフレーム位置は MP4Clip.getFileHeaderBinData()（ftyp+moov のみ、mdat 不要）を
// mp4box.js に食わせて sync sample を抽出して得る。tick() が受け取る時刻ドメイン
// （最初の video サンプルの dts を 0 とした マイクロ秒）に合わせて正規化する。
import * as MP4BoxNS from '@webav/mp4box.js';

// esbuild の CJS/ESM 相互運用対策（bundle 環境によって named export か default 経由かがブレる）
const MP4Box: typeof MP4BoxNS =
  (MP4BoxNS as unknown as { default?: typeof MP4BoxNS }).default ?? MP4BoxNS;

export interface KeyframeIndex {
  /** 昇順ソート済み、tick() と同じマイクロ秒ドメインのキーフレーム時刻一覧 */
  keyframeTimesUs: number[];
  /** target 以下で最も近いキーフレーム時刻(us)。無ければ先頭(0)扱い */
  nearestAtOrBefore(targetUs: number): number;
  /** target との距離が最小のキーフレーム時刻(us)（前後どちらでもよい） */
  nearest(targetUs: number): number;
  /** tolerance(us) 以内にキーフレームがあるか。あれば snap 先を返す */
  withinTolerance(targetUs: number, toleranceUs: number): number | null;
}

function buildIndex(keyframeTimesUs: number[]): KeyframeIndex {
  const times = [...keyframeTimesUs].sort((a, b) => a - b);

  function nearestAtOrBefore(targetUs: number): number {
    if (times.length === 0) return 0;
    // 二分探索: target 以下で最大のもの
    let lo = 0;
    let hi = times.length - 1;
    if (targetUs < (times[0] as number)) return times[0] as number;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if ((times[mid] as number) <= targetUs) lo = mid;
      else hi = mid - 1;
    }
    return times[lo] as number;
  }

  function nearest(targetUs: number): number {
    if (times.length === 0) return 0;
    const before = nearestAtOrBefore(targetUs);
    const idx = times.indexOf(before);
    const after = idx + 1 < times.length ? (times[idx + 1] as number) : before;
    return Math.abs(after - targetUs) < Math.abs(targetUs - before) ? after : before;
  }

  function withinTolerance(targetUs: number, toleranceUs: number): number | null {
    const n = nearest(targetUs);
    return Math.abs(n - targetUs) <= toleranceUs ? n : null;
  }

  return { keyframeTimesUs: times, nearestAtOrBefore, nearest, withinTolerance };
}

/**
 * MP4 ヘッダ(ftyp+moov)バイナリからキーフレームインデックスを構築する。
 * @param headerBin MP4Clip.getFileHeaderBinData() の戻り値
 */
export async function buildKeyframeIndexFromHeader(headerBin: ArrayBuffer): Promise<KeyframeIndex> {
  return new Promise((resolve, reject) => {
    try {
      const file = MP4Box.createFile();
      file.onError = (e: string) => reject(new Error(`mp4box parse error: ${e}`));
      file.onReady = (info) => {
        try {
          const videoTrack = info.videoTracks[0];
          if (!videoTrack) {
            resolve(buildIndex([]));
            return;
          }
          const samples = file.getTrackSamplesInfo(videoTrack.id);
          if (samples.length === 0) {
            resolve(buildIndex([]));
            return;
          }
          // av-cliper 内部と同じ正規化: 先頭 video サンプルの dts を 0 とする
          const t0 = samples[0]!.dts;
          const keyframeTimesUs = samples
            .filter((s) => s.is_sync)
            .map((s) => ((s.cts - t0) / s.timescale) * 1e6);
          resolve(buildIndex(keyframeTimesUs));
        } catch (e) {
          reject(e as Error);
        }
      };
      const buf = headerBin as ArrayBuffer & { fileStart: number };
      buf.fileStart = 0;
      file.appendBuffer(buf);
      file.flush();
    } catch (e) {
      reject(e as Error);
    }
  });
}
