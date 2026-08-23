"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.transitionProgressAt = transitionProgressAt;
exports.buildTimelineMap = buildTimelineMap;
exports.outputToSource = outputToSource;
const edit_store_1 = require("./edit-store");
function transitionProgressAt(window, outputT) {
    if (!(window.duration > 0))
        return 0;
    return Math.max(0, Math.min(1, (outputT - window.start) / window.duration));
}
function buildTimelineMap(cuts, options) {
    const usable = [];
    cuts.forEach((cut, index) => {
        if (typeof cut?.in === 'number' && Number.isFinite(cut.in)
            && typeof cut?.out === 'number' && Number.isFinite(cut.out) && cut.in < cut.out) {
            usable.push({ cut, index });
        }
    });
    const usableCuts = usable.map(entry => entry.cut);
    const trackSegments = (0, edit_store_1.computeCutTrackSegments)(usableCuts);
    // マルチトラック平坦化: 全 at/end を境界に分割し、各区間の中点で最前面トラックの
    // セグメントを勝者にする（webview computeVideoRuns と同型）。
    const trackZ = options?.trackZ ?? ((track) => -track);
    const resolved = trackSegments.map(segment => ({
        start: segment.at,
        end: segment.end,
        track: segment.track,
        cut: usableCuts[segment.index],
        cutIndex: usable[segment.index].index
    }));
    const segmentSlice = (entry, start, end, transitionOut = null) => {
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
    const transitionWindows = [];
    for (let outgoingIndex = 0; outgoingIndex < resolved.length; outgoingIndex++) {
        const outgoing = resolved[outgoingIndex];
        const transition = outgoing.cut.transitionOut;
        if (!transition || !(typeof transition.duration === 'number' && Number.isFinite(transition.duration)
            && transition.duration > 0))
            continue;
        const incoming = resolved.slice(outgoingIndex + 1).find(candidate => candidate.track === outgoing.track);
        if (!incoming)
            continue;
        const start = incoming.start;
        const actualOverlap = outgoing.end - start;
        if (!(actualOverlap > 0.000001) || actualOverlap - transition.duration > 0.000001)
            continue;
        const end = Math.min(outgoing.end, incoming.end, start + transition.duration);
        if (!(end - start > 0.000001))
            continue;
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
    const boundarySet = new Set([0, outputDuration]);
    for (const segment of resolved) {
        boundarySet.add(segment.start);
        boundarySet.add(segment.end);
    }
    const boundaries = [...boundarySet].sort((left, right) => left - right);
    const runs = [];
    for (let index = 0; index < boundaries.length - 1; index++) {
        const start = boundaries[index];
        const end = boundaries[index + 1];
        if (end - start <= 0.000001) {
            continue;
        }
        const midpoint = (start + end) / 2;
        let winner = null;
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
        }
        else {
            runs.push({ start, end, winner });
        }
    }
    const segments = runs.map(run => {
        if (!run.winner) {
            return { kind: 'gap', outStart: run.start, outEnd: run.end, cutIndex: null };
        }
        return segmentSlice(run.winner, run.start, run.end, run.winner.cut.transitionOut ?? null);
    });
    const transitionPlates = transitionWindows.flatMap(window => window.type === 'fade-black' || window.type === 'fade-white'
        ? [{
                start: window.start,
                end: window.end,
                mid: (window.start + window.end) / 2,
                color: window.type === 'fade-white' ? '#fff' : '#000',
                type: window.type
            }]
        : []);
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
function outputToSource(segments, outputT) {
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
