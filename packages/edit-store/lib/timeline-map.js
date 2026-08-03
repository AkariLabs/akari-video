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
 *     のインライン注入で共有（旧インライン複製は撤去済み。gaps/tracks モードの暗黙 at にも
 *     トランジション重なりが載る = 書き込み側と同一の正本挙動へ収斂）
 *
 * モード判定は webview 実装と同一:
 *   - cuts に at 指定 or track≠0 が無い → シーケンシャル（トランジション重なり + プレート算出）
 *   - ある → マルチトラック平坦化（境界分割 + 中点勝者。既定は小さい track 番号が勝つ =
 *     webview の zForTrack フォールバックと同順。宣言トラック順を持つ呼び出し側は trackZ で上書き）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.outputToSource = exports.buildTimelineMap = exports.cutsUseGapsOrTracks = void 0;
const edit_store_1 = require("./edit-store");
function cutsUseGapsOrTracks(cuts) {
    return cuts.some(cut => cut.at !== undefined
        || (typeof cut.track === 'number' && Number.isInteger(cut.track) && cut.track !== 0));
}
exports.cutsUseGapsOrTracks = cutsUseGapsOrTracks;
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
    const gapsOrTracks = cutsUseGapsOrTracks(usableCuts);
    if (!gapsOrTracks) {
        const segments = [];
        const transitionPlates = [];
        for (let index = 0; index < trackSegments.length; index++) {
            const segment = trackSegments[index];
            const cut = usableCuts[segment.index];
            const speed = typeof cut.speed === 'number' && cut.speed > 0 ? cut.speed : 1;
            segments.push({
                kind: 'src',
                outStart: segment.at,
                outEnd: segment.end,
                cutIndex: usable[segment.index].index,
                ...(cut.src !== undefined ? { src: cut.src } : {}),
                in: cut.in,
                out: cut.out,
                speed,
                track: 0,
                transitionOut: cut.transitionOut ?? null
            });
            // プレートは fade-black / fade-white のみ（§2.6 — dissolve は尺計算のみ）。
            // 中心は「重なり適用前の自然な継ぎ目」= このセグメントの outEnd。
            if (cut.transitionOut && index < trackSegments.length - 1
                && (cut.transitionOut.type === 'fade-black' || cut.transitionOut.type === 'fade-white')) {
                const duration = cut.transitionOut.duration;
                transitionPlates.push({
                    start: segment.end - duration / 2,
                    end: segment.end + duration / 2,
                    mid: segment.end,
                    color: cut.transitionOut.type === 'fade-black' ? '#000000' : '#ffffff'
                });
            }
        }
        const totalDuration = segments.reduce((max, segment) => Math.max(max, segment.outEnd), 0);
        return { segments, totalDuration, transitionPlates, usesGapsOrTracks: false };
    }
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
        const cut = run.winner.cut;
        const speed = typeof cut.speed === 'number' && cut.speed > 0 ? cut.speed : 1;
        return {
            kind: 'src',
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
exports.buildTimelineMap = buildTimelineMap;
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
exports.outputToSource = outputToSource;
