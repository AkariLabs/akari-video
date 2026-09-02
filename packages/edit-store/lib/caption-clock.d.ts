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
export declare function normalizeCaptionClock<T extends CaptionClockInput>(captions: readonly T[], segments: readonly CaptionClockSegment[]): OutputClockCaption<T>[];
/**
 * captions.json の生 cue から clockDomain / clockSourceId を決める。
 * schema 正本の time_domain は直通し、未宣言だけ legacy 推定へ渡す（shell の loadPreviewCaptions と同じ）。
 */
export declare function captionClockDomainOf(raw: {
    time_domain?: unknown;
    src?: unknown;
} | undefined): {
    clockDomain: CaptionClockDomain;
    clockSourceId?: string;
};
