export interface PreviewSourceClockSegment {
    kind?: 'src' | 'gap';
    outStart: number;
    outEnd: number;
    src?: string;
    in?: number;
    out?: number;
    speed?: number;
}

export interface PreviewSourceClockPosition {
    index: number;
    time: number;
    ended: boolean;
}

/** Resolve a media clock only among segments belonging to the currently active source. */
export function resolveSourceClockPosition(
    segments: readonly PreviewSourceClockSegment[],
    sourceTime: number,
    preferredIndex: number
): PreviewSourceClockPosition {
    const preferred = segments[preferredIndex];
    const preferredSourceId = preferred?.kind !== 'gap' ? preferred?.src : undefined;
    const sameSource = (segment: PreviewSourceClockSegment): boolean =>
        preferredSourceId === undefined || segment.src === preferredSourceId;
    if (preferred && preferred.kind !== 'gap' && sameSource(preferred)
        && sourceTime >= (preferred.in ?? 0) && sourceTime < (preferred.out ?? 0)) {
        return { index: preferredIndex, time: sourceTime, ended: false };
    }
    // 同一ソースのソース範囲は正規のユースでも重複しうる（同じ B ロール範囲の再利用や、
    // ほぼ同一 in/out のマット窓の並び）。「配列で最初の一致」を取ると、後方の窓を再生中に
    // クロックが一瞬 preferred の外へ出ただけで最前の窓へ吸い付き、再生ヘッドが出力時間で
    // 巻き戻る。preferredIndex に最も近い一致（同距離なら前方）を選んで後退を防ぐ。
    let hit = -1;
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (segment.kind === 'gap' || !sameSource(segment)) continue;
        if (!(sourceTime >= (segment.in ?? 0) && sourceTime < (segment.out ?? 0))) continue;
        if (hit === -1
            || Math.abs(index - preferredIndex) < Math.abs(hit - preferredIndex)
            || (Math.abs(index - preferredIndex) === Math.abs(hit - preferredIndex) && index > preferredIndex)) {
            hit = index;
        }
    }
    if (hit !== -1) {
        return { index: hit, time: sourceTime, ended: false };
    }
    if (preferred && preferred.kind !== 'gap' && sourceTime >= (preferred.out ?? 0)) {
        const nextIndex = preferredIndex + 1;
        if (nextIndex < segments.length) {
            const next = segments[nextIndex];
            return next.kind !== 'gap'
                ? { index: nextIndex, time: next.in ?? sourceTime, ended: false }
                : { index: nextIndex, time: sourceTime, ended: false };
        }
        return { index: preferredIndex, time: preferred.out ?? sourceTime, ended: true };
    }
    if (preferred && preferred.kind !== 'gap' && sourceTime < (preferred.in ?? 0)) {
        return { index: preferredIndex, time: preferred.in ?? sourceTime, ended: false };
    }
    let fallback = segments.findIndex(segment => segment.kind !== 'gap' && sameSource(segment)
        && (segment.in ?? 0) >= sourceTime);
    if (fallback === -1) {
        fallback = Math.max(0, segments.length - 1);
    }
    const fallbackSegment = segments[fallback];
    return {
        index: fallback,
        time: fallbackSegment && fallbackSegment.kind !== 'gap'
            ? fallbackSegment.in ?? sourceTime : sourceTime,
        ended: false
    };
}

/**
 * A media element briefly exposes the new source's zero/default clock while its metadata is
 * loading.  That clock must never replace the output-timeline clock at a cut boundary.
 */
export function outputTimeForSourceClock(
    segment: PreviewSourceClockSegment,
    sourceTime: number,
    previousOutputTime: number,
    sourceClockReady = true
): number {
    const minimum = Number.isFinite(segment.outStart) ? segment.outStart : 0;
    const maximum = Number.isFinite(segment.outEnd) ? Math.max(minimum, segment.outEnd) : minimum;
    const clamp = (value: number): number => Math.max(minimum, Math.min(maximum, value));
    if (!sourceClockReady || !Number.isFinite(sourceTime)) {
        return clamp(Number.isFinite(previousOutputTime) ? previousOutputTime : minimum);
    }
    const input = Number.isFinite(segment.in) ? segment.in! : 0;
    const speed = Number.isFinite(segment.speed) && segment.speed! > 0 ? segment.speed! : 1;
    return clamp(minimum + (sourceTime - input) / speed);
}
