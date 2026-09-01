import { FILMSTRIP_CHUNK_SECONDS } from './akari-annotations-protocol';

/**
 * sourceT（ソース秒）が属するチャンク index。`floor(sourceT / FILMSTRIP_CHUNK_SECONDS)`。
 * チャンク境界はソース時刻の等間隔グリッドで、クリップの in/out やトリムに依存しない。
 */
export function filmstripChunkIndexFor(sourceT: number): number {
    return Math.max(0, Math.floor(sourceT / FILMSTRIP_CHUNK_SECONDS));
}

export interface FilmstripChunkPlan {
    chunkStartSeconds: number;
    chunkDurationSeconds: number;
}

/**
 * chunkIndex の担当区間を素材の実尺（durationSeconds）へクランプする。
 * 末尾チャンクは `FILMSTRIP_CHUNK_SECONDS` 未満になりうる。開始秒が実尺以上なら
 * （範囲外の chunkIndex）undefined を返す。
 */
export function planFilmstripChunk(durationSeconds: number, chunkIndex: number): FilmstripChunkPlan | undefined {
    const chunkStartSeconds = chunkIndex * FILMSTRIP_CHUNK_SECONDS;
    if (!(durationSeconds > 0) || chunkStartSeconds >= durationSeconds) {
        return undefined;
    }
    return {
        chunkStartSeconds,
        chunkDurationSeconds: Math.min(FILMSTRIP_CHUNK_SECONDS, durationSeconds - chunkStartSeconds)
    };
}

/**
 * peaks（bucketCount 個、クリップ全区間 [in,out) を等間隔に表す）のうち、
 * クリップのローカル px 位置（0 = クリップの見かけ上の先頭）が指すバケツ index。
 * フィルムストリップの `sourceT = segment.in + (i/totalCellCount) * sourceSpan` と同じ
 * 「クリップのローカル位置を線形にソース区間へ写像する」考え方を、セルではなく
 * バケツ単位で行う。
 */
export function waveformBucketForLocalPx(localPx: number, fullClipWidthPx: number, bucketCount: number): number {
    if (!(fullClipWidthPx > 0) || bucketCount <= 0) {
        return 0;
    }
    return Math.min(bucketCount - 1, Math.max(0, Math.floor(localPx / fullClipWidthPx * bucketCount)));
}

/** -48 dB を床にした固定対数スケールへ peak (0..1) を写す。 */
export function waveformHeightForPeak(peak: number): number {
    if (!Number.isFinite(peak) || peak <= 0) return 0;
    return Math.max(0, Math.min(1, 1 + 20 * Math.log10(Math.max(peak, 1e-4)) / 48));
}

export interface AudioKeyframeGeometryPoint {
    t: number;
    gainDb: number;
}

export interface AudioKeyframeBand {
    duration: number;
    width: number;
    height: number;
}

/** 音声キーフレームを -24..+12 dB の帯座標へ写し、時刻順の折れ線点を返す。 */
export function keyframePolyline(
    points: readonly AudioKeyframeGeometryPoint[],
    band: AudioKeyframeBand
): Array<{ x: number; y: number }> {
    if (!(band.duration > 0) || !(band.width > 0) || !(band.height > 0)) return [];
    return points
        .filter(point => Number.isFinite(point.t) && Number.isFinite(point.gainDb))
        .map(point => ({
            x: Math.max(0, Math.min(band.width, point.t / band.duration * band.width)),
            y: (12 - Math.max(-24, Math.min(12, point.gainDb))) / 36 * band.height
        }))
        .sort((left, right) => left.x - right.x);
}
