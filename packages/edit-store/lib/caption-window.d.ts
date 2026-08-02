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
export declare function captionWindowSeconds(caption: CaptionWindowLike): {
    start: number;
    end: number;
};
/** source 秒 t に表示すべき字幕（最初にヒットしたもの）。無ければ undefined */
export declare function findActiveCaption<T extends CaptionWindowLike>(captions: readonly T[], sourceSeconds: number): T | undefined;
