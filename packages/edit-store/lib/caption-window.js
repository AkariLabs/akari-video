"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.findActiveCaption = exports.captionWindowSeconds = void 0;
function captionWindowSeconds(caption) {
    const start = typeof caption.start === 'number' && Number.isFinite(caption.start) ? caption.start : 0;
    const duration = typeof caption.duration === 'number' && Number.isFinite(caption.duration) ? caption.duration : 0;
    const end = typeof caption.end === 'number' && Number.isFinite(caption.end) ? caption.end : start + duration;
    return { start, end };
}
exports.captionWindowSeconds = captionWindowSeconds;
/** source 秒 t に表示すべき字幕（最初にヒットしたもの）。無ければ undefined */
function findActiveCaption(captions, sourceSeconds) {
    return captions.find(caption => {
        const window = captionWindowSeconds(caption);
        return window.start <= sourceSeconds && sourceSeconds < window.end;
    });
}
exports.findActiveCaption = findActiveCaption;
