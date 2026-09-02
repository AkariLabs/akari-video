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
import {
    cutOverlapFrames,
    DEFAULT_CUT_ADJACENCY_FPS,
    planTransitionHandleWindow
} from './cut-adjacency';

export interface TimelineTransitionPlate {
    start: number;
    end: number;
    mid: number;
    color: string;
    type: 'fade-black' | 'fade-white';
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

/**
 * 同一トラック上の隣接 cut が同時に存在するトランジション窓。
 * outgoing / incoming は窓の範囲へ切り詰め済みで、各 in/out はその窓に対応する
 * source 秒を保持する。progress は transitionProgressAt で 0..1 に正規化する。
 */
export interface TimelineTransitionWindow {
    start: number;
    end: number;
    duration: number;
    type: NonNullable<EditCut['transitionOut']>['type'];
    outgoing: TimelineSegment;
    incoming: TimelineSegment;
}

export interface TimelineMapResult {
    segments: TimelineSegment[];
    totalDuration: number;
    transitionPlates: TimelineTransitionPlate[];
    transitionWindows: TimelineTransitionWindow[];
    usesGapsOrTracks: boolean;
}

export interface SpeechTranscriptInterval {
    start: number;
    end: number;
}

export interface SpeechKeyProjectionResult {
    intervals: Array<{ startSec: number; endSec: number }>;
    droppedShortIntervals: number;
}

/** analysis transcript の source 秒を、cuts と同じ speed/境界規則で timeline 秒へ写す。 */
export function projectSpeechKeyIntervals(
    cuts: readonly EditCut[],
    transcript: readonly SpeechTranscriptInterval[],
    options: { fps?: number; sourceId?: string } = {}
): SpeechKeyProjectionResult {
    const normalizedCuts = cuts.map(cut => ({
        ...cut,
        transitionOut: cut.transitionOut ?? (cut as EditCut & { transition_out?: EditCut['transitionOut'] }).transition_out
    }));
    const hasExplicitSources = normalizedCuts.some(cut => typeof cut.src === 'string' && cut.src.length > 0);
    if (hasExplicitSources && !options.sourceId) return { intervals: [], droppedShortIntervals: 0 };
    const map = buildTimelineMap(normalizedCuts, { fps: options.fps });
    const projected: Array<{ startSec: number; endSec: number }> = [];
    for (const segment of map.segments) {
        if (segment.kind !== 'src' || typeof segment.in !== 'number' || typeof segment.out !== 'number') continue;
        if (hasExplicitSources && segment.src !== options.sourceId) continue;
        const speed = typeof segment.speed === 'number' && segment.speed > 0 ? segment.speed : 1;
        for (const entry of transcript) {
            if (!entry || !Number.isFinite(entry.start) || !Number.isFinite(entry.end) || entry.end <= entry.start) continue;
            const sourceStart = Math.max(segment.in, entry.start);
            const sourceEnd = Math.min(segment.out, entry.end);
            if (!(sourceEnd > sourceStart)) continue;
            projected.push({
                startSec: segment.outStart + (sourceStart - segment.in) / speed,
                endSec: segment.outStart + (sourceEnd - segment.in) / speed
            });
        }
    }
    projected.sort((left, right) => left.startSec - right.startSec || left.endSec - right.endSec);
    const merged: typeof projected = [];
    for (const interval of projected) {
        const last = merged[merged.length - 1];
        if (last && interval.startSec - last.endSec < 0.35) last.endSec = Math.max(last.endSec, interval.endSec);
        else merged.push({ ...interval });
    }
    const intervals = merged.filter(interval => interval.endSec - interval.startSec >= 0.15);
    return { intervals, droppedShortIntervals: merged.length - intervals.length };
}

export function transitionProgressAt(window: TimelineTransitionWindow, outputT: number): number {
    if (!(window.duration > 0)) return 0;
    return Math.max(0, Math.min(1, (outputT - window.start) / window.duration));
}

export function buildTimelineMap(
    cuts: readonly EditCut[],
    options?: {
        trackZ?: (track: number) => number;
        fps?: number;
        handleRoom?: (cutIndex: number) => { tailSeconds?: number; headSeconds?: number } | undefined;
    }
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
        baseStart: segment.at,
        baseEnd: segment.end,
        track: segment.track,
        cut: usableCuts[segment.index],
        cutIndex: usable[segment.index].index
    }));
    const fps = options?.fps ?? DEFAULT_CUT_ADJACENCY_FPS;
    // 隠れのりしろは、フレーム量子化で突き合わせとなる境界にだけ合成する。
    // 実重なり済みの境界は一切変更せず、従来の窓計算へそのまま流す。
    for (let outgoingIndex = 0; outgoingIndex < resolved.length; outgoingIndex++) {
        const outgoing = resolved[outgoingIndex];
        const transition = outgoing.cut.transitionOut;
        if (!transition || !(typeof transition.duration === 'number' && Number.isFinite(transition.duration)
            && transition.duration > 0)) continue;
        const incoming = resolved.slice(outgoingIndex + 1).find(candidate => candidate.track === outgoing.track);
        if (!incoming || cutOverlapFrames(
            { tlEnd: outgoing.end }, { tlStart: incoming.start }, fps
        ) !== 0) continue;
        const outgoingRoom = options?.handleRoom?.(outgoing.cutIndex);
        const incomingRoom = options?.handleRoom?.(incoming.cutIndex);
        const incomingSpeed = typeof incoming.cut.speed === 'number' && incoming.cut.speed > 0
            ? incoming.cut.speed : 1;
        const plan = planTransitionHandleWindow({
            declaredSeconds: transition.duration,
            outgoingTailRoomSeconds: outgoingRoom?.tailSeconds ?? Number.POSITIVE_INFINITY,
            incomingHeadRoomSeconds: incomingRoom?.headSeconds ?? incoming.cut.in / incomingSpeed,
            outgoingDurationSeconds: outgoing.baseEnd - outgoing.baseStart,
            incomingDurationSeconds: incoming.baseEnd - incoming.baseStart
        });
        if (plan.effectiveSeconds <= 0) continue;
        const cutPoint = outgoing.end;
        outgoing.end = cutPoint + plan.halfSeconds;
        outgoing.cut = {
            ...outgoing.cut,
            transitionOut: { ...transition, duration: plan.effectiveSeconds }
        };
        incoming.start = cutPoint - plan.halfSeconds;
        incoming.cut = {
            ...incoming.cut,
            in: Math.max(0, incoming.cut.in - plan.halfSeconds * incomingSpeed)
        };
    }
    const segmentSlice = (
        entry: typeof resolved[number],
        start: number,
        end: number,
        transitionOut: EditCut['transitionOut'] | null = null
    ): TimelineSegment => {
        const cut = entry.cut;
        const speed = typeof cut.speed === 'number' && cut.speed > 0 ? cut.speed : 1;
        return {
            kind: 'src',
            outStart: start,
            outEnd: end,
            cutIndex: entry.cutIndex,
            ...(cut.src !== undefined ? { src: cut.src } : {}),
            in: cut.in + (start - entry.start) * speed,
            out: cut.in + (end - entry.start) * speed,
            speed,
            track: entry.track,
            transitionOut
        };
    };
    const transitionWindows: TimelineTransitionWindow[] = [];
    for (let outgoingIndex = 0; outgoingIndex < resolved.length; outgoingIndex++) {
        const outgoing = resolved[outgoingIndex];
        const transition = outgoing.cut.transitionOut;
        if (!transition || !(typeof transition.duration === 'number' && Number.isFinite(transition.duration)
            && transition.duration > 0)) continue;
        const incoming = resolved.slice(outgoingIndex + 1).find(candidate => candidate.track === outgoing.track);
        if (!incoming) continue;
        const start = incoming.start;
        const actualOverlap = outgoing.end - start;
        if (!(actualOverlap > 0.000001) || actualOverlap - transition.duration > 0.000001) continue;
        const end = Math.min(outgoing.end, incoming.end, start + transition.duration);
        if (!(end - start > 0.000001)) continue;
        transitionWindows.push({
            start,
            end,
            duration: end - start,
            type: transition.type,
            outgoing: segmentSlice(outgoing, start, end, transition),
            incoming: segmentSlice(incoming, start, end)
        });
    }
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
        return segmentSlice(
            run.winner,
            run.start,
            run.end,
            run.winner.cut.transitionOut ?? null
        );
    });
    const transitionPlates = transitionWindows.flatMap(window =>
        window.type === 'fade-black' || window.type === 'fade-white'
            ? [{
                start: window.start,
                end: window.end,
                mid: (window.start + window.end) / 2,
                color: window.type === 'fade-white' ? '#fff' : '#000',
                type: window.type as TimelineTransitionPlate['type']
            }]
            : []
    );
    return {
        segments,
        totalDuration: outputDuration,
        transitionPlates,
        transitionWindows,
        usesGapsOrTracks: true
    };
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

/**
 * ソース秒 → 出力秒。削除区間は次の保持区間の先頭へスナップし、素材末尾を
 * 超えた時刻は最終セグメントの終端へクランプする。
 */
export function sourceToOutput(
    segments: readonly TimelineSegment[],
    sourceT: number
): number | null {
    const sources = segments.filter(segment => segment.kind === 'src'
        && typeof segment.in === 'number'
        && typeof segment.out === 'number');
    if (sources.length === 0 || !Number.isFinite(sourceT)) {
        return null;
    }
    for (const segment of sources) {
        const start = segment.in!;
        const end = segment.out!;
        if (start <= sourceT && sourceT < end) {
            const speed = typeof segment.speed === 'number' && segment.speed > 0 ? segment.speed : 1;
            return segment.outStart + (sourceT - start) / speed;
        }
    }
    const next = sources.find(segment => segment.in! > sourceT);
    return next?.outStart ?? sources[sources.length - 1].outEnd;
}
