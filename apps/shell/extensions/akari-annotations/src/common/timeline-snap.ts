/**
 * タイムラインのマグネット（スナップ）核（task 2026-09-02-timeline-undo-snap-fixes）。
 *
 * 規則:
 * - 吸着先は「見えている端」だけ（クリップ・字幕・音・重ね物の始点/終点、再生ヘッド、0 秒）。
 *   単語境界・直前のクリック位置のような画面に無い点へは吸着しない。
 * - 閾値（px 換算の秒）内に候補が無ければ **そのままの値を返す**。旧実装の 0.25 秒グリッドへの
 *   フォールバック（オーナー実機 2026-09-02「変なところでマグネットが効く」の真因）は廃止。
 * - マグネット OFF の判定は呼び出し側（widget）で行い、ここには来ない。
 *
 * DOM に依存しないので node --test で検証できる。
 */

export interface SnapCandidate {
    /** 吸着先の時刻（秒）。出力軸か素材軸かは呼び出し側が揃える。 */
    time: number;
    /** 再生ヘッドなら true（ガイド線をアンバーにする）。 */
    isPlayhead?: boolean;
}

export interface SnapResolution {
    time: number;
    snapped: boolean;
    candidate?: SnapCandidate;
}

export interface SnapEdgeItem {
    kind: string;
    id: string;
    start: number;
    end: number;
}

export interface SnapExclusion {
    kind: string;
    id: string;
}

/** 永続化キー（ユーザー設定。プロジェクトを跨いで同じ値を使う）。 */
export const SNAP_ENABLED_STORAGE_KEY = 'akari.timeline.snapEnabled.v1';

/** 既定はマグネット OFF（オーナー実機 2026-09-02「つけてないのに反応する」= 起動時 ON が真因）。 */
export const SNAP_ENABLED_DEFAULT = false;

export interface SnapStorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export function readStoredSnapEnabled(storage: SnapStorageLike | undefined, fallback = SNAP_ENABLED_DEFAULT): boolean {
    try {
        const stored = storage?.getItem(SNAP_ENABLED_STORAGE_KEY);
        if (stored === '1') return true;
        if (stored === '0') return false;
    } catch {
        // storage が使えない環境（プライベートモード等）では既定値に落とす。
    }
    return fallback;
}

export function writeStoredSnapEnabled(storage: SnapStorageLike | undefined, enabled: boolean): void {
    try {
        storage?.setItem(SNAP_ENABLED_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
        // 永続化できなくても動作は続ける。
    }
}

/** 端の候補を組み立てる。除外指定（ドラッグ中の本人）の端は入れない。 */
export function collectEdgeCandidates(
    items: readonly SnapEdgeItem[],
    exclude?: SnapExclusion
): SnapCandidate[] {
    const candidates: SnapCandidate[] = [];
    for (const item of items) {
        if (exclude && item.kind === exclude.kind && item.id === exclude.id) continue;
        if (Number.isFinite(item.start)) candidates.push({ time: item.start });
        if (Number.isFinite(item.end)) candidates.push({ time: item.end });
    }
    return candidates;
}

export function nearestSnapCandidate(
    candidates: readonly SnapCandidate[],
    value: number
): SnapCandidate | undefined {
    let nearest: SnapCandidate | undefined;
    for (const candidate of candidates) {
        if (!Number.isFinite(candidate.time)) continue;
        if (nearest === undefined || Math.abs(candidate.time - value) < Math.abs(nearest.time - value)) {
            nearest = candidate;
        }
    }
    return nearest;
}

/**
 * 1 点（トリム端・字幕端など）の吸着。閾値内の最寄り候補へ吸着し、無ければ value をそのまま返す。
 * thresholdSeconds が非正・非有限なら吸着しない。
 */
export function resolveSnapTime(
    value: number,
    candidates: readonly SnapCandidate[],
    thresholdSeconds: number
): SnapResolution {
    if (!Number.isFinite(value) || !Number.isFinite(thresholdSeconds) || thresholdSeconds <= 0) {
        return { time: value, snapped: false };
    }
    const nearest = nearestSnapCandidate(candidates, value);
    if (nearest !== undefined && Math.abs(nearest.time - value) <= thresholdSeconds) {
        return { time: nearest.time, snapped: true, candidate: nearest };
    }
    return { time: value, snapped: false };
}

/**
 * 区間移動の吸着。始点と終点のどちらか近い方の候補へ寄せ、返す time は始点。
 * 閾値内に候補が無ければ start をそのまま返す。
 */
export function resolveSnapRange(
    start: number,
    duration: number,
    candidates: readonly SnapCandidate[],
    thresholdSeconds: number
): SnapResolution {
    if (!Number.isFinite(start) || !Number.isFinite(duration)
        || !Number.isFinite(thresholdSeconds) || thresholdSeconds <= 0) {
        return { time: start, snapped: false };
    }
    const end = start + duration;
    const nearestStart = nearestSnapCandidate(candidates, start);
    const nearestEnd = nearestSnapCandidate(candidates, end);
    const startDistance = nearestStart ? Math.abs(nearestStart.time - start) : Number.POSITIVE_INFINITY;
    const endDistance = nearestEnd ? Math.abs(nearestEnd.time - end) : Number.POSITIVE_INFINITY;
    const useStart = startDistance <= endDistance;
    const nearest = useStart ? nearestStart : nearestEnd;
    const distance = useStart ? startDistance : endDistance;
    if (nearest && distance <= thresholdSeconds) {
        return { time: useStart ? nearest.time : nearest.time - duration, snapped: true, candidate: nearest };
    }
    return { time: start, snapped: false };
}

/** px 閾値 → 秒。表示幅が無いときは undefined（吸着しない）。 */
export function snapThresholdSecondsFor(thresholdPx: number, stripWidthPx: number, visibleSeconds: number): number | undefined {
    if (!(stripWidthPx > 0) || !(visibleSeconds > 0) || !(thresholdPx > 0)) return undefined;
    return thresholdPx / (stripWidthPx / visibleSeconds);
}
