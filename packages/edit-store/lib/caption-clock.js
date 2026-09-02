"use strict";
/**
 * 字幕時計の共有カーネル: cue を出力秒（output clock）へ正規化する。
 *
 * shell webview（akari-preview の normalizePreviewCaptionClock）と Web UI
 * （preview-server public/app.js の updateCaption）が同じ実装で字幕を選ぶための正本
 * （docs/contract-2026-08-02-preview-parity.md §2、task/2026-09-02-preview-perf で Web UI 側を統一）。
 *
 * - captions.schema で time_domain を明示した cue（'source' / 'output'）はそのまま使う。
 * - 未宣言の legacy cue は、宣言区間全体が明示 gap に収まる場合だけ output と確定し、
 *   それ以外は後方互換の source として cut map（timeline-map の segments）で output へ射影する。
 * - source cue は各 src セグメントへ射影し、複数セグメントにまたがる cue は 1 本ずつに分割する
 *   （id は `<id>-output-<n>`、sourceCueId に元 id を残す）。words[] も同じ射影で切り詰める。
 * - segments が空なら全件 output 扱いで素通し。
 * - 戻り値は全件 clockDomain='output'。描画層は domain 判定を一切行わない。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCaptionClock = normalizeCaptionClock;
exports.captionClockDomainOf = captionClockDomainOf;
const EPSILON = 0.000001;
function normalizeCaptionClock(captions, segments) {
    const output = [];
    for (const caption of captions) {
        const legacyOutputCue = caption.clockDomain === 'legacy' && segments.some(segment => segment.kind === 'gap'
            && caption.start >= segment.outStart - EPSILON
            && caption.end <= segment.outEnd + EPSILON);
        const domain = caption.clockDomain === 'legacy'
            ? (legacyOutputCue ? 'output' : 'source')
            : caption.clockDomain;
        if (domain === 'output' || segments.length === 0) {
            output.push({ ...caption, clockDomain: 'output' });
            continue;
        }
        let occurrence = 0;
        for (const segment of segments) {
            if (segment.kind !== 'src' || segment.in === undefined || segment.out === undefined)
                continue;
            if (caption.clockSourceId !== undefined && segment.src !== caption.clockSourceId)
                continue;
            const sourceStart = Math.max(caption.start, segment.in);
            const sourceEnd = Math.min(caption.end, segment.out);
            if (!(sourceEnd - sourceStart > EPSILON))
                continue;
            const speed = typeof segment.speed === 'number' && segment.speed > 0 ? segment.speed : 1;
            const projectTime = (sourceTime) => segment.outStart + (sourceTime - (segment.in ?? 0)) / speed;
            occurrence += 1;
            const sourceCueId = caption.sourceCueId ?? caption.id;
            const words = caption.words?.flatMap(word => {
                const wordStart = Math.max(word.start, sourceStart);
                const wordEnd = Math.min(word.end, sourceEnd);
                return wordEnd - wordStart > EPSILON
                    ? [{ ...word, start: projectTime(wordStart), end: projectTime(wordEnd) }]
                    : [];
            });
            output.push({
                ...caption,
                ...(caption.id ? { id: `${caption.id}-output-${occurrence}` } : {}),
                ...(sourceCueId ? { sourceCueId } : {}),
                start: projectTime(sourceStart),
                end: projectTime(sourceEnd),
                ...(words && words.length > 0 ? { words } : { words: undefined }),
                clockDomain: 'output'
            });
        }
    }
    return output.sort((left, right) => left.start - right.start || left.end - right.end);
}
/**
 * captions.json の生 cue から clockDomain / clockSourceId を決める。
 * schema 正本の time_domain は直通し、未宣言だけ legacy 推定へ渡す（shell の loadPreviewCaptions と同じ）。
 */
function captionClockDomainOf(raw) {
    const clockDomain = raw?.time_domain === 'source' || raw?.time_domain === 'output'
        ? raw.time_domain
        : 'legacy';
    return {
        clockDomain,
        ...(typeof raw?.src === 'string' && raw.src ? { clockSourceId: raw.src } : {})
    };
}
