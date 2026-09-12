/**
 * 字幕ウィンドウ判定（どの字幕が source 秒 t に表示されるか）の共有カーネル。
 *
 * 正典は captions.schema.json: start/end は必須の絶対 source 秒。end 欠落資産への互換として
 * duration フォールバック（start + duration）だけを許す（旧 Web UI captionWindow の挙動を正本化）。
 * 窓は [start, end) の半開区間。
 *
 * 消費者:
 *   - Web UI（packages/preview-server public/app.js — updateCaption / 字幕クリック）
 *   - shell webview（previewBootstrapScript — renderCaption / ㉓ 字幕クリック選択。
 *     webview-kernel.js 経由で注入）
 */
export interface CaptionWindowLike {
    start?: unknown;
    end?: unknown;
    duration?: unknown;
}
export interface CaptionFragmentLike extends CaptionWindowLike {
    id?: unknown;
    text?: unknown;
    display_text?: unknown;
    display_fragments?: unknown;
    words?: unknown;
}
export interface CaptionFragmentWindow {
    text: string;
    start: number;
    end: number;
    index: number;
    count: number;
}
export declare function captionWindowSeconds(caption: CaptionWindowLike): {
    start: number;
    end: number;
};
/**
 * 手置き display_fragments を legacy 表示用の時間窓へ変換する。
 * 不正・単一断片は既存挙動を守るため null とし、呼び出し側で元 caption をそのまま通す。
 */
export declare function captionFragmentWindows(caption: CaptionFragmentLike): CaptionFragmentWindow[] | null;
/** legacy caption 配列を手置き断片単位の疑似 caption 配列へ展開する。 */
export declare function expandCaptionDisplayFragments<T extends CaptionFragmentLike>(captions: readonly T[]): Array<T & {
    fragmentIndex?: number;
    fragmentCount?: number;
    fragmentKey?: string;
}>;
/** source 秒 t に表示すべき字幕（最初にヒットしたもの）。無ければ undefined */
export declare function findActiveCaption<T extends CaptionWindowLike>(captions: readonly T[], sourceSeconds: number): T | undefined;
