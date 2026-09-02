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

export interface AudioKeyframeTimePoint {
    t: number;
}

/** クリップ下際に置く音声キーフレームのひし形マーカーを、時刻順の X 位置列で返す。 */
export function audioKeyframeMarkerPositions(
    points: readonly AudioKeyframeTimePoint[], durationSeconds: number
): number[] {
    if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds)) return [];
    return points
        .filter(point => Number.isFinite(point.t))
        .map(point => Math.max(0, Math.min(1, point.t / durationSeconds)))
        .sort((left, right) => left - right);
}

export interface AudioWaveformBandLayout {
    topPx: number;
    heightPx: number;
}

/** ラベルを避けた残り領域の中央へ、視認可能な高さで波形帯を置く。 */
export function audioWaveformBandLayout(itemHeightPx: number, labelHeightPx: number): AudioWaveformBandLayout {
    const itemHeight = Number.isFinite(itemHeightPx) ? Math.max(0, itemHeightPx) : 0;
    const labelHeight = Number.isFinite(labelHeightPx) ? Math.max(0, labelHeightPx) : 0;
    const remaining = Math.max(0, itemHeight - labelHeight);
    const heightPx = Math.max(12, Math.min(28, Math.round(remaining * 0.6)));
    const unclampedTop = labelHeight + (remaining - heightPx) / 2;
    return {
        topPx: Math.max(0, Math.min(Math.max(0, itemHeight - heightPx), unclampedTop)),
        heightPx
    };
}

export interface AudioSourceSliceWindowInput {
    inSec: number;
    displayDurationSec: number;
    speed?: number;
}

/** タイムライン表示尺を source 秒へ一度だけ換算する。 */
export function audioSourceSliceWindow(input: AudioSourceSliceWindowInput): { startSec: number; endSec: number } {
    const startSec = Number.isFinite(input.inSec) ? input.inSec : 0;
    const displayDurationSec = Number.isFinite(input.displayDurationSec)
        ? Math.max(0, input.displayDurationSec) : 0;
    const speed = input.speed !== undefined && Number.isFinite(input.speed) && input.speed > 0 ? input.speed : 1;
    return { startSec, endSec: startSec + displayDurationSec * speed };
}

export interface AudioLoopTileOptions {
    trackDurationSec: number;
    timelineDurationSec: number;
    inSec?: number;
    speed?: number;
    maxBuckets?: number;
}

/**
 * BGM の1周目だけ in から末尾までを使い、2周目以降は素材先頭へ戻す。
 * 出力バケツはタイムライン尺に比例させ、長尺でも上限を越えない。
 */
export function audioLoopTilePeaks(
    fullPeaks: readonly number[], options: AudioLoopTileOptions
): number[] {
    const { trackDurationSec, timelineDurationSec } = options;
    if (fullPeaks.length === 0 || !(trackDurationSec > 0) || !Number.isFinite(trackDurationSec)
        || !(timelineDurationSec > 0) || !Number.isFinite(timelineDurationSec)) {
        return [];
    }
    const inSec = Number.isFinite(options.inSec) ? Math.max(0, Math.min(trackDurationSec, options.inSec ?? 0)) : 0;
    const speed = options.speed !== undefined && Number.isFinite(options.speed) && options.speed > 0
        ? options.speed : 1;
    const maxBuckets = options.maxBuckets === undefined || !Number.isFinite(options.maxBuckets)
        ? 8192 : Math.max(1, Math.floor(options.maxBuckets));
    const outputLength = Math.min(
        maxBuckets,
        Math.max(1, Math.ceil(fullPeaks.length * timelineDurationSec / trackDurationSec))
    );
    const firstSpan = trackDurationSec - inSec;
    const tiled: number[] = [];
    for (let index = 0; index < outputLength; index++) {
        const timelineSec = index / outputLength * timelineDurationSec;
        const elapsedSource = timelineSec * speed;
        const sourceSec = elapsedSource < firstSpan
            ? inSec + elapsedSource
            : (elapsedSource - firstSpan) % trackDurationSec;
        const bucket = Math.min(
            fullPeaks.length - 1,
            Math.max(0, Math.floor(sourceSec / trackDurationSec * fullPeaks.length))
        );
        tiled.push(fullPeaks[bucket]);
    }
    return tiled;
}

export interface AudioClipLocalGeometryInput {
    clipStartSec: number;
    displayDurationSec: number;
    layoutViewStartSec: number;
    viewDurationSec: number;
    stripWidthPx: number;
}

/** 動画クリップと同じ -60% アンカー窓規則で、音声クリップの隠れた左側を求める。 */
export function audioClipLocalGeometry(
    input: AudioClipLocalGeometryInput
): { fullClipWidthPx: number; clipLocalOffsetPx: number } | undefined {
    if (!Number.isFinite(input.clipStartSec) || !Number.isFinite(input.layoutViewStartSec)
        || !(input.displayDurationSec > 0) || !Number.isFinite(input.displayDurationSec)
        || !(input.viewDurationSec > 0) || !Number.isFinite(input.viewDurationSec)
        || !(input.stripWidthPx > 0) || !Number.isFinite(input.stripWidthPx)) {
        return undefined;
    }
    const pxPerSecond = input.stripWidthPx / input.viewDurationSec;
    return {
        fullClipWidthPx: input.displayDurationSec * pxPerSecond,
        clipLocalOffsetPx: Math.max(
            0,
            (input.layoutViewStartSec - 0.6 * input.viewDurationSec) - input.clipStartSec
        ) * pxPerSecond
    };
}

export interface AudioWaveformSourceRectInput {
    masterWidthPx: number;
    fullClipWidthPx: number;
    clipLocalOffsetPx: number;
    visibleWidthPx: number;
}

/** マスター波形から可視 canvas へ転送する source 側の横範囲を返す。 */
export function audioWaveformSourceRect(
    input: AudioWaveformSourceRectInput
): { sourceXPx: number; sourceWidthPx: number } | undefined {
    if (!(input.masterWidthPx > 0) || !Number.isFinite(input.masterWidthPx)
        || !(input.fullClipWidthPx > 0) || !Number.isFinite(input.fullClipWidthPx)
        || !(input.visibleWidthPx > 0) || !Number.isFinite(input.visibleWidthPx)
        || !Number.isFinite(input.clipLocalOffsetPx)) {
        return undefined;
    }
    const sourceXPx = Math.max(0, Math.min(
        input.masterWidthPx,
        input.clipLocalOffsetPx / input.fullClipWidthPx * input.masterWidthPx
    ));
    const requestedWidth = input.visibleWidthPx / input.fullClipWidthPx * input.masterWidthPx;
    const sourceWidthPx = Math.max(0, Math.min(input.masterWidthPx - sourceXPx, requestedWidth));
    return sourceWidthPx > 0 ? { sourceXPx, sourceWidthPx } : undefined;
}

export interface AudioWaveformPaintState {
    sliceKey: string;
    visibleWidth: number;
    offset: number;
    bandTop: number;
    bandHeight: number;
}

/** pure スクロール等で描画入力が同じなら、既存 canvas をそのまま使う。 */
export function audioWaveformRepaintNeeded(
    previous: AudioWaveformPaintState | undefined, next: AudioWaveformPaintState
): boolean {
    return previous === undefined
        || previous.sliceKey !== next.sliceKey
        || previous.visibleWidth !== next.visibleWidth
        || previous.offset !== next.offset
        || previous.bandTop !== next.bandTop
        || previous.bandHeight !== next.bandHeight;
}
