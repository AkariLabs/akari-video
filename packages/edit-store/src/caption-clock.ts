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

import { projectCaptionWords } from './caption-display';
import type { CaptionRun } from './caption-runs';
export { buildCaptionTimelineSegments } from './caption-timeline';

export type CaptionClockDomain = 'source' | 'output' | 'legacy';

export interface CaptionClockWord {
    start: number;
    end: number;
}

export interface CaptionClockInput {
    id?: string;
    start: number;
    end: number;
    clockDomain: CaptionClockDomain;
    /** source cue が属するソース id（captions.json の src）。無ければ全 src セグメントへ射影する。 */
    clockSourceId?: string;
    sourceCueId?: string;
    words?: readonly CaptionClockWord[];
    /** Original captions.json body, retained when the displayed words were cut. */
    originalSourceText?: string;
}

/** timeline-map の TimelineSegment の部分集合（字幕射影に要る欄だけ）。 */
export interface CaptionClockSegment {
    kind: 'src' | 'gap';
    outStart: number;
    outEnd: number;
    src?: string;
    in?: number;
    out?: number;
    speed?: number;
}

export type OutputClockCaption<T extends CaptionClockInput> = Omit<T, 'clockDomain'> & {
    clockDomain: 'output';
    sourceCueId?: string;
};

const EPSILON = 0.000001;

function rebaseDisplayedRuns(oldText: string, newText: string, runs: readonly CaptionRun[]): CaptionRun[] {
    const graphemes = (text: string): string[] => {
        const Segmenter = Reflect.get(Intl, 'Segmenter') as (new (locale: string | undefined,
            options: { granularity: 'grapheme' }) => { segment(value: string): Iterable<{ segment: string }> }) | undefined;
        return typeof Segmenter === 'function'
            ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment)
            : Array.from(text);
    };
    const before = graphemes(oldText);
    const after = graphemes(newText);
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix
        && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
    const oldEnd = before.length - suffix;
    const newEnd = after.length - suffix;
    const delta = newEnd - oldEnd;
    return runs.flatMap(run => {
        if (run.to <= prefix) return [run];
        if (run.from >= oldEnd) return [{ ...run, from: run.from + delta, to: run.to + delta }];
        if (run.from >= prefix && run.to <= oldEnd && newEnd === prefix) return [];
        const from = run.from < prefix ? run.from : prefix;
        const to = run.to > oldEnd ? run.to + delta : newEnd;
        return from < to ? [{ ...run, from, to }] : [];
    });
}

export function normalizeCaptionClock<T extends CaptionClockInput>(
    captions: readonly T[],
    segments: readonly CaptionClockSegment[]
): OutputClockCaption<T>[] {
    const output: OutputClockCaption<T>[] = [];
    for (const caption of captions) {
        const legacyOutputCue = caption.clockDomain === 'legacy' && segments.some(segment =>
            segment.kind === 'gap'
            && caption.start >= segment.outStart - EPSILON
            && caption.end <= segment.outEnd + EPSILON
        );
        const domain = caption.clockDomain === 'legacy'
            ? (legacyOutputCue ? 'output' : 'source')
            : caption.clockDomain;
        if (domain === 'output' || segments.length === 0) {
            output.push({ ...caption, clockDomain: 'output' } as OutputClockCaption<T>);
            continue;
        }
        const cue = caption as CaptionClockInput & { text?: string; displayText?: string;
            runs?: readonly CaptionRun[] };
        const sourceSegments = segments.filter(segment => segment.kind === 'src'
            && segment.in !== undefined && segment.out !== undefined
            && (caption.clockSourceId === undefined || segment.src === caption.clockSourceId));
        const projected = typeof cue.text === 'string' && cue.words?.length
            ? projectCaptionWords({ text: cue.text, display_text: cue.displayText ?? cue.text,
                words: cue.words, src: cue.clockSourceId }, sourceSegments.map(segment => ({
                src: segment.src, in: segment.in, out: segment.out
            }))) : null;
        if (projected && !projected.renderable) continue;
        const projectedRuns = projected?.changed && cue.runs
            ? rebaseDisplayedRuns(cue.displayText ?? cue.text ?? '', projected.displayText, cue.runs)
            : cue.runs;
        let occurrence = 0;
        for (const segment of sourceSegments) {
            const sourceStart = Math.max(caption.start, segment.in!);
            const sourceEnd = Math.min(caption.end, segment.out!);
            if (!(sourceEnd - sourceStart > EPSILON)) continue;
            const speed = typeof segment.speed === 'number' && segment.speed > 0 ? segment.speed : 1;
            const projectTime = (sourceTime: number): number =>
                segment.outStart + (sourceTime - (segment.in ?? 0)) / speed;
            occurrence += 1;
            const sourceCueId = caption.sourceCueId ?? caption.id;
            const words = (projected?.words ?? caption.words)?.flatMap(word => {
                const wordStart = Math.max(word.start, sourceStart);
                const wordEnd = Math.min(word.end, sourceEnd);
                return wordEnd - wordStart > EPSILON
                    ? [{ ...word, start: projectTime(wordStart), end: projectTime(wordEnd) }]
                    : [];
            });
            output.push({
                ...caption,
                ...(projected?.changed ? {
                    text: projected.displayText,
                    originalSourceText: cue.text,
                    ...(cue.displayText !== undefined ? { displayText: projected.displayText } : {}),
                    ...(cue.runs ? { runs: projectedRuns } : {})
                } : {}),
                ...(caption.id ? { id: `${caption.id}-output-${occurrence}` } : {}),
                ...(sourceCueId ? { sourceCueId } : {}),
                start: projectTime(sourceStart),
                end: projectTime(sourceEnd),
                ...(words && words.length > 0 ? { words } : { words: undefined }),
                clockDomain: 'output'
            } as OutputClockCaption<T>);
        }
    }
    return output.sort((left, right) => left.start - right.start || left.end - right.end);
}

/**
 * captions.json の生 cue から clockDomain / clockSourceId を決める。
 * schema 正本の time_domain は直通し、未宣言だけ legacy 推定へ渡す（shell の loadPreviewCaptions と同じ）。
 */
export function captionClockDomainOf(
    raw: { time_domain?: unknown; src?: unknown } | undefined
): { clockDomain: CaptionClockDomain; clockSourceId?: string } {
    const clockDomain: CaptionClockDomain = raw?.time_domain === 'source' || raw?.time_domain === 'output'
        ? raw.time_domain
        : 'legacy';
    return {
        clockDomain,
        ...(typeof raw?.src === 'string' && raw.src ? { clockSourceId: raw.src } : {})
    };
}
