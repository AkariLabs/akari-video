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

export const AUDIO_LOUDNESS_RED = '#ef4444';
export const AUDIO_LOUDNESS_YELLOW = '#facc15';
export const AUDIO_LOUDNESS_BASE = '#fff';

export interface AudioLoudnessKeyframe {
    readonly t: number;
    readonly gainDb?: number;
    readonly gain_db?: number;
    readonly easing?: string | Record<string, string>;
}

export interface AudioLoudnessEnvelope {
    readonly gainDb?: number;
    readonly keyframes?: readonly AudioLoudnessKeyframe[];
    readonly fadeInSeconds?: number;
    readonly fadeOutSeconds?: number;
    readonly durationSeconds: number;
    readonly bucketStartSeconds?: number;
    readonly bucketDurationSeconds?: number;
    readonly keyframeFrames?: boolean;
    readonly fps?: number;
}

function finiteNumberOr(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function loudnessKeyframeGainDb(point: AudioLoudnessKeyframe): number {
    return finiteNumberOr(point.gainDb, finiteNumberOr(point.gain_db, 0));
}

function loudnessKeyframeTimeSeconds(point: AudioLoudnessKeyframe, envelope: AudioLoudnessEnvelope): number {
    if (!Number.isFinite(point.t)) return 0;
    return envelope.keyframeFrames && envelope.fps !== undefined && Number.isFinite(envelope.fps) && envelope.fps > 0
        ? point.t / envelope.fps : point.t;
}

/**
 * T10 エディタと同じく hold は区間始点の値を保持し、それ以外は時刻順の線形補間とする。
 * キーフレーム範囲外は最寄りの端値を保持する。
 */
function audioLoudnessKeyframeDb(envelope: AudioLoudnessEnvelope, atSeconds: number): number {
    const points = (envelope.keyframes ?? [])
        .filter(point => Number.isFinite(point.t))
        .map(point => ({
            t: loudnessKeyframeTimeSeconds(point, envelope),
            gainDb: loudnessKeyframeGainDb(point),
            easing: point.easing
        }))
        .sort((left, right) => left.t - right.t);
    if (points.length === 0) return 0;
    if (atSeconds <= points[0].t) return points[0].gainDb;
    const last = points[points.length - 1];
    if (atSeconds >= last.t) return last.gainDb;
    for (let index = 1; index < points.length; index++) {
        const end = points[index];
        if (atSeconds >= end.t) continue;
        const start = points[index - 1];
        if (start.easing === 'hold') return start.gainDb;
        const span = end.t - start.t;
        if (!(span > 0)) return end.gainDb;
        const progress = (atSeconds - start.t) / span;
        return start.gainDb + (end.gainDb - start.gainDb) * progress;
    }
    return last.gainDb;
}

function audioLoudnessFadeDb(envelope: AudioLoudnessEnvelope, atSeconds: number): number {
    const duration = finiteNumberOr(envelope.durationSeconds, 0);
    if (!(duration > 0)) return 0;
    const fadeIn = Math.max(0, finiteNumberOr(envelope.fadeInSeconds, 0));
    const fadeOut = Math.max(0, finiteNumberOr(envelope.fadeOutSeconds, 0));
    let multiplier = 1;
    if (fadeIn > 0 && atSeconds < fadeIn) multiplier = Math.min(multiplier, atSeconds / fadeIn);
    if (fadeOut > 0 && atSeconds > duration - fadeOut) {
        multiplier = Math.min(multiplier, (duration - atSeconds) / fadeOut);
    }
    return multiplier > 0 ? 20 * Math.log10(multiplier) : Number.NEGATIVE_INFINITY;
}

/**
 * バケット中央時刻の実効 dB から赤 / 黄 / 現行白を返す。
 * ducking は他レーンの発話区間に依存する動的値で、この素材単体のマスターへ固定できないため除外する。
 */
export function audioLoudnessBucketColors(
    peaks: readonly number[], envelope: AudioLoudnessEnvelope
): string[] {
    const duration = Math.max(0, finiteNumberOr(envelope.durationSeconds, 0));
    const bucketStart = finiteNumberOr(envelope.bucketStartSeconds, 0);
    const bucketDuration = Math.max(0, finiteNumberOr(envelope.bucketDurationSeconds, duration));
    const gainDb = finiteNumberOr(envelope.gainDb, 0);
    return peaks.map((peak, bucket) => {
        const atSeconds = peaks.length > 0
            ? bucketStart + (bucket + 0.5) / peaks.length * bucketDuration : bucketStart;
        const peakDb = Number.isFinite(peak) && peak > 0
            ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY;
        const effectiveDb = peakDb + gainDb
            + audioLoudnessKeyframeDb(envelope, atSeconds)
            + audioLoudnessFadeDb(envelope, atSeconds);
        if (effectiveDb >= -3 - 1e-9) return AUDIO_LOUDNESS_RED;
        if (effectiveDb >= -9 - 1e-9) return AUDIO_LOUDNESS_YELLOW;
        return AUDIO_LOUDNESS_BASE;
    });
}

function stableEasingKey(easing: AudioLoudnessKeyframe['easing']): string | undefined {
    if (typeof easing === 'string') return easing;
    if (!easing) return undefined;
    return JSON.stringify(Object.keys(easing).sort().map(key => [key, easing[key]]));
}

/** master canvas の再利用キー。描画に効く envelope 内容と peaks 識別をすべて含める。 */
export function audioWaveformMasterKey(
    peakIdentity: string | number,
    sliceKey: string,
    heightPx: number,
    envelope: AudioLoudnessEnvelope
): string {
    const keyframes = (envelope.keyframes ?? []).map(point => ({
        t: finiteNumberOr(point.t, 0),
        gainDb: loudnessKeyframeGainDb(point),
        easing: stableEasingKey(point.easing)
    })).sort((left, right) => left.t - right.t);
    return JSON.stringify([
        peakIdentity, sliceKey, heightPx,
        finiteNumberOr(envelope.gainDb, 0),
        keyframes,
        Math.max(0, finiteNumberOr(envelope.fadeInSeconds, 0)),
        Math.max(0, finiteNumberOr(envelope.fadeOutSeconds, 0)),
        Math.max(0, finiteNumberOr(envelope.durationSeconds, 0)),
        finiteNumberOr(envelope.bucketStartSeconds, 0),
        Math.max(0, finiteNumberOr(envelope.bucketDurationSeconds, envelope.durationSeconds)),
        envelope.keyframeFrames === true,
        finiteNumberOr(envelope.fps, 0)
    ]);
}

export type AudioWaveformTier = 'T0' | 'T1' | 'T2';

export interface AudioWaveformWindow {
    readonly startSeconds: number;
    readonly endSeconds: number;
}

/** 省略値と明示 200 は既存挙動を保ち、それ以外だけ 4000 / 秒あたり200へ丸める。 */
export function clampWaveformBucketCount(
    requestedBucketCount: number | undefined,
    durationSeconds: number
): number {
    if (requestedBucketCount === undefined || requestedBucketCount === 200) return 200;
    if (!Number.isFinite(requestedBucketCount) || requestedBucketCount <= 0) return 200;
    const requested = Math.max(1, Math.floor(requestedBucketCount));
    const durationLimit = Number.isFinite(durationSeconds) && durationSeconds > 0
        ? Math.max(1, Math.ceil(durationSeconds * 200)) : 4000;
    return Math.min(4000, requested, durationLimit);
}

/** 各ティアの契約どおり、全尺 20/s または可視窓 200/s から取得数を決める。 */
export function audioWaveformTierBucketCount(
    tier: AudioWaveformTier,
    fullDurationSeconds: number,
    windowDurationSeconds = fullDurationSeconds
): number {
    if (tier === 'T0') return 200;
    const duration = tier === 'T1' ? fullDurationSeconds : windowDurationSeconds;
    if (!Number.isFinite(duration) || !(duration > 0)) return 1;
    const bucketsPerSecond = tier === 'T1' ? 20 : 200;
    return Math.min(4000, Math.max(1, Math.ceil(duration * bucketsPerSecond)));
}

/** 1 バケットが 3px を超えたときだけ次のティアへ進む（3px ちょうどでは進まない）。 */
export function nextAudioWaveformTier(
    currentTier: AudioWaveformTier,
    displayWidthPx: number,
    displayedBucketCount: number
): AudioWaveformTier {
    if (currentTier === 'T2' || !(displayWidthPx > 0) || displayedBucketCount <= 0
        || displayWidthPx / displayedBucketCount <= 3) {
        return currentTier;
    }
    return currentTier === 'T0' ? 'T1' : 'T2';
}

/** 可視 source 窓を 0.5 秒グリッドへ外向きに量子化し、素材実尺へクランプする。 */
export function quantizeAudioWaveformWindow(
    startSeconds: number,
    endSeconds: number,
    fullDurationSeconds: number,
    quantumSeconds = 0.5
): AudioWaveformWindow {
    const duration = Number.isFinite(fullDurationSeconds) ? Math.max(0, fullDurationSeconds) : 0;
    const quantum = Number.isFinite(quantumSeconds) && quantumSeconds > 0 ? quantumSeconds : 0.5;
    const start = Number.isFinite(startSeconds) ? Math.max(0, Math.min(duration, startSeconds)) : 0;
    const end = Number.isFinite(endSeconds) ? Math.max(start, Math.min(duration, endSeconds)) : start;
    const quantizedStart = Math.max(0, Math.floor(start / quantum) * quantum);
    const quantizedEnd = Math.min(duration, Math.ceil(end / quantum) * quantum);
    return {
        startSeconds: quantizedStart,
        endSeconds: Math.max(quantizedStart, quantizedEnd)
    };
}

export interface AudioWaveformVisibleSourceWindowInput {
    readonly clipStartSeconds: number;
    readonly displayDurationSeconds: number;
    readonly sourceStartSeconds: number;
    readonly sourceEndSeconds: number;
    readonly viewStartSeconds: number;
    readonly viewEndSeconds: number;
}

/** タイムライン可視域とクリップの交差を source 秒窓へ線形写像する。 */
export function audioWaveformVisibleSourceWindow(
    input: AudioWaveformVisibleSourceWindowInput
): AudioWaveformWindow | undefined {
    if (!Number.isFinite(input.clipStartSeconds)
        || !(input.displayDurationSeconds > 0) || !Number.isFinite(input.displayDurationSeconds)
        || !Number.isFinite(input.sourceStartSeconds) || !Number.isFinite(input.sourceEndSeconds)
        || !(input.sourceEndSeconds > input.sourceStartSeconds)
        || !Number.isFinite(input.viewStartSeconds) || !Number.isFinite(input.viewEndSeconds)) {
        return undefined;
    }
    const clipEnd = input.clipStartSeconds + input.displayDurationSeconds;
    const visibleStart = Math.max(input.clipStartSeconds, input.viewStartSeconds);
    const visibleEnd = Math.min(clipEnd, input.viewEndSeconds);
    if (!(visibleEnd > visibleStart)) return undefined;
    const sourceSpan = input.sourceEndSeconds - input.sourceStartSeconds;
    return {
        startSeconds: input.sourceStartSeconds
            + (visibleStart - input.clipStartSeconds) / input.displayDurationSeconds * sourceSpan,
        endSeconds: input.sourceStartSeconds
            + (visibleEnd - input.clipStartSeconds) / input.displayDurationSeconds * sourceSpan
    };
}

export interface AudioLoopWaveformVisibleWindowPlan {
    readonly visibleSourceWindow: AudioWaveformWindow;
    readonly sourceOriginTimelineSeconds: number;
    readonly sourceSecondsPerTimelineSecond: number;
}

/** BGM の現在のループ周回を source 窓へ写す。周回境界をまたぐ窓は T1 継続へ安全に倒す。 */
export function audioLoopWaveformVisibleWindowPlan(
    timelineDurationSeconds: number,
    sourceDurationSeconds: number,
    viewStartSeconds: number,
    viewEndSeconds: number,
    speed = 1
): AudioLoopWaveformVisibleWindowPlan | undefined {
    if (!(timelineDurationSeconds > 0) || !Number.isFinite(timelineDurationSeconds)
        || !(sourceDurationSeconds > 0) || !Number.isFinite(sourceDurationSeconds)
        || !Number.isFinite(viewStartSeconds) || !Number.isFinite(viewEndSeconds)
        || !(speed > 0) || !Number.isFinite(speed)) {
        return undefined;
    }
    const visibleStart = Math.max(0, viewStartSeconds);
    const visibleEnd = Math.min(timelineDurationSeconds, viewEndSeconds);
    if (!(visibleEnd > visibleStart)) return undefined;
    const elapsedSourceStart = visibleStart * speed;
    const cycleIndex = Math.floor(elapsedSourceStart / sourceDurationSeconds);
    const sourceStart = elapsedSourceStart - cycleIndex * sourceDurationSeconds;
    const sourceEnd = sourceStart + (visibleEnd - visibleStart) * speed;
    if (sourceEnd > sourceDurationSeconds + 1e-9) return undefined;
    return {
        visibleSourceWindow: {
            startSeconds: sourceStart,
            endSeconds: Math.min(sourceDurationSeconds, sourceEnd)
        },
        sourceOriginTimelineSeconds: cycleIndex * sourceDurationSeconds / speed,
        sourceSecondsPerTimelineSecond: speed
    };
}

function waveformWindowKey(window: AudioWaveformWindow): string {
    return `${window.startSeconds.toFixed(3)}-${window.endSeconds.toFixed(3)}`;
}

/** T0 の既存キーは呼び出し側に残し、T1/T2 だけ契約形式を組み立てる。 */
export function audioWaveformTierCacheKey(
    path: string,
    tier: Exclude<AudioWaveformTier, 'T0'>,
    window: AudioWaveformWindow,
    bucketCount: number
): string {
    return `sfxwave:${path}:${tier}:${waveformWindowKey(window)}:${bucketCount}`;
}

interface AudioWaveformTierLruEntry<T> {
    readonly tier: AudioWaveformTier;
    readonly value: T;
}

/** T2 を最優先、次に T1 を古い順で捨てる決定的 LRU。widget の T0 常駐 Map は対象外。 */
export class AudioWaveformTierLru<T> {
    protected readonly values = new Map<string, AudioWaveformTierLruEntry<T>>();

    constructor(readonly limit = 200) {}

    get size(): number {
        return this.values.size;
    }

    get(key: string): T | undefined {
        const entry = this.values.get(key);
        if (!entry) return undefined;
        this.values.delete(key);
        this.values.set(key, entry);
        return entry.value;
    }

    set(key: string, tier: AudioWaveformTier, value: T): void {
        this.values.delete(key);
        this.values.set(key, { tier, value });
        while (this.values.size > Math.max(1, this.limit)) {
            this.evictOne();
        }
    }

    delete(key: string): boolean {
        return this.values.delete(key);
    }

    has(key: string): boolean {
        return this.values.has(key);
    }

    keys(): string[] {
        return [...this.values.keys()];
    }

    protected evictOne(): void {
        const entries = [...this.values.entries()];
        const candidate = entries.find(([, entry]) => entry.tier === 'T2')
            ?? entries.find(([, entry]) => entry.tier === 'T1')
            ?? entries[0];
        if (candidate) this.values.delete(candidate[0]);
    }
}

export interface AudioWaveformDebounceDecision {
    readonly shouldFetch: boolean;
    readonly waitMs?: number;
    readonly pendingChanged: boolean;
}

/** Date.now を注入してテストできる、T2 の trailing-edge 200ms 判定器。 */
export class AudioWaveformDebounceGate {
    protected pendingKey: string | undefined;
    protected readyAtMs = 0;
    protected requestedKey: string | undefined;

    constructor(readonly delayMs = 200) {}

    consider(key: string, nowMs: number): AudioWaveformDebounceDecision {
        if (this.requestedKey === key) {
            return { shouldFetch: false, pendingChanged: false };
        }
        if (this.pendingKey !== key) {
            this.pendingKey = key;
            this.readyAtMs = nowMs + this.delayMs;
            return { shouldFetch: false, waitMs: this.delayMs, pendingChanged: true };
        }
        if (nowMs < this.readyAtMs) {
            return { shouldFetch: false, waitMs: this.readyAtMs - nowMs, pendingChanged: false };
        }
        this.pendingKey = undefined;
        this.requestedKey = key;
        return { shouldFetch: true, pendingChanged: false };
    }

    release(key: string): void {
        if (this.requestedKey === key) this.requestedKey = undefined;
    }
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

/** ラベルを避けた残り領域の 90% を使い、上下 1px 以上を残して中央へ波形帯を置く。 */
export function audioWaveformBandLayout(itemHeightPx: number, labelHeightPx: number): AudioWaveformBandLayout {
    const itemHeight = Number.isFinite(itemHeightPx) ? Math.max(0, itemHeightPx) : 0;
    const labelHeight = Number.isFinite(labelHeightPx) ? Math.max(0, labelHeightPx) : 0;
    const remaining = Math.max(0, itemHeight - labelHeight);
    const scaledHeight = Math.round(remaining * 0.9);
    // 固定の上限は設けない。十分な領域がある場合だけ、上下 1px の余白を優先する。
    const heightPx = Math.max(12, remaining >= 14 ? Math.min(scaledHeight, remaining - 2) : scaledHeight);
    const unclampedTop = labelHeight + (remaining - heightPx) / 2;
    const maximumTop = Math.max(0, itemHeight - heightPx - 1);
    const minimumTop = Math.min(maximumTop, labelHeight + 1);
    return {
        topPx: Math.max(0, Math.min(maximumTop, Math.max(minimumTop, unclampedTop))),
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
