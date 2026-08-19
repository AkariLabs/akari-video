/**
 * source↔output のタイムライン写像（パリティ契約 §2.1/§2.2 の土台、Phase 2-3 共有カーネル）。
 *
 * 書き込み側 SSOT の computeCutTrackSegments（at / track / speed / トランジション重なりの
 * カーソル意味論）の上に、再生用の出力セグメント列と写像関数を提供する。
 *
 * 消費者:
 *   - Web UI（packages/preview-server public/app.js）— edit-kernel.bundle.js（ESM）で import
 *   - shell annotations widget — computeCutTrackSegments を直接使用（従来どおり）
 *   - shell 動画面（previewBootstrapScript）— webview-kernel.js（IIFE、global: AkariEditKernel）
 *     のインライン注入で共有。v2 の絶対配置を常にマルチトラック平坦化する。
 */

import { EditCut, computeCutTrackSegments } from './edit-store';

export interface TimelineTransitionPlate {
    start: number;
    end: number;
    mid: number;
    color: string;
}
export interface TimelineSegment {
    kind: 'src' | 'gap';
    outStart: number;
    outEnd: number;
    /** 元 cuts[] のインデックス（gap は null） */
    cutIndex: number | null;
    src?: string;
    /** outStart 時点のソース秒（src のみ） */
    in?: number;
    /** outEnd 時点のソース秒（src のみ） */
    out?: number;
    speed?: number;
    track?: number;
    transitionOut?: EditCut['transitionOut'] | null;
}

export interface TimelineMapResult {
    segments: TimelineSegment[];
    totalDuration: number;
    transitionPlates: TimelineTransitionPlate[];
    usesGapsOrTracks: boolean;
}

export function buildTimelineMap(
    cuts: readonly EditCut[],
    options?: { trackZ?: (track: number) => number }
): TimelineMapResult {
    const usable: Array<{ cut: EditCut; index: number }> = [];
    cuts.forEach((cut, index) => {
        if (typeof cut?.in === 'number' && Number.isFinite(cut.in)
            && typeof cut?.out === 'number' && Number.isFinite(cut.out) && cut.in < cut.out) {
            usable.push({ cut, index });
        }
    });
    const usableCuts = usable.map(entry => entry.cut);
    const trackSegments = computeCutTrackSegments(usableCuts);
    // マルチトラック平坦化: 全 at/end を境界に分割し、各区間の中点で最前面トラックの
    // セグメントを勝者にする（webview computeVideoRuns と同型）。
    const trackZ = options?.trackZ ?? ((track: number) => -track);
    const resolved = trackSegments.map(segment => ({
        start: segment.at,
        end: segment.end,
        track: segment.track,
        cut: usableCuts[segment.index],
        cutIndex: usable[segment.index].index
    }));
    const outputDuration = resolved.reduce((max, segment) => Math.max(max, segment.end), 0);
    const boundarySet = new Set<number>([0, outputDuration]);
    for (const segment of resolved) {
        boundarySet.add(segment.start);
        boundarySet.add(segment.end);
    }
    const boundaries = [...boundarySet].sort((left, right) => left - right);
    interface Piece { start: number; end: number; winner: typeof resolved[number] | null; }
    const runs: Piece[] = [];
    for (let index = 0; index < boundaries.length - 1; index++) {
        const start = boundaries[index];
        const end = boundaries[index + 1];
        if (end - start <= 0.000001) {
            continue;
        }
        const midpoint = (start + end) / 2;
        let winner: typeof resolved[number] | null = null;
        for (const segment of resolved) {
            if (segment.start <= midpoint && segment.end > midpoint
                && (!winner || trackZ(segment.track) > trackZ(winner.track))) {
                winner = segment;
            }
        }
        const last = runs[runs.length - 1];
        const sameWinner = last
            && ((last.winner === null && winner === null)
                || (last.winner !== null && winner !== null && last.winner.cutIndex === winner.cutIndex));
        if (sameWinner && Math.abs(last.end - start) <= 0.000001) {
            last.end = end;
        } else {
            runs.push({ start, end, winner });
        }
    }
    const segments: TimelineSegment[] = runs.map(run => {
        if (!run.winner) {
            return { kind: 'gap' as const, outStart: run.start, outEnd: run.end, cutIndex: null };
        }
        const cut = run.winner.cut;
        const speed = typeof cut.speed === 'number' && cut.speed > 0 ? cut.speed : 1;
        return {
            kind: 'src' as const,
            outStart: run.start,
            outEnd: run.end,
            cutIndex: run.winner.cutIndex,
            ...(cut.src !== undefined ? { src: cut.src } : {}),
            in: cut.in + (run.start - run.winner.start) * speed,
            out: cut.in + (run.end - run.winner.start) * speed,
            speed,
            track: run.winner.track,
            transitionOut: null
        };
    });
    return { segments, totalDuration: outputDuration, transitionPlates: [], usesGapsOrTracks: true };
}

/**
 * 出力秒 → ソース秒。トランジション重なり区間（隣接 src が重なる出力時刻）は
 * 先行セグメントが勝つ（webview / 旧 Web UI の「先に終わる方を先に見る」走査と同順）。
 * gap 上は sourceT: null。末尾を超えた時刻は最終セグメントへクランプする。
 */
export function outputToSource(
    segments: readonly TimelineSegment[],
    outputT: number
): { segment: TimelineSegment | null; sourceT: number | null } {
    if (segments.length === 0) {
        return { segment: null, sourceT: null };
    }
    for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        if (outputT <= segment.outEnd || index === segments.length - 1) {
            if (segment.kind !== 'src') {
                return { segment, sourceT: null };
            }
            const speed = typeof segment.speed === 'number' && segment.speed > 0 ? segment.speed : 1;
            const clamped = Math.max(segment.outStart, Math.min(outputT, segment.outEnd));
            return { segment, sourceT: (segment.in ?? 0) + (clamped - segment.outStart) * speed };
        }
    }
    return { segment: null, sourceT: null };
}
