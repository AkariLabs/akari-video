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
exports.captionWindowSeconds = captionWindowSeconds;
exports.captionFragmentWindows = captionFragmentWindows;
exports.expandCaptionDisplayFragments = expandCaptionDisplayFragments;
exports.findActiveCaption = findActiveCaption;
function captionWindowSeconds(caption) {
    const start = typeof caption.start === 'number' && Number.isFinite(caption.start) ? caption.start : 0;
    const duration = typeof caption.duration === 'number' && Number.isFinite(caption.duration) ? caption.duration : 0;
    const end = typeof caption.end === 'number' && Number.isFinite(caption.end) ? caption.end : start + duration;
    return { start, end };
}
/**
 * 手置き display_fragments を legacy 表示用の時間窓へ変換する。
 * 不正・単一断片は既存挙動を守るため null とし、呼び出し側で元 caption をそのまま通す。
 */
function captionFragmentWindows(caption) {
    const sourceText = caption.display_text ?? caption.text;
    const text = typeof sourceText === 'string' ? sourceText : null;
    const fragments = caption.display_fragments;
    if (text === null || text.length === 0 || !Array.isArray(fragments) || fragments.length < 2
        || fragments.some(fragment => typeof fragment !== 'string')
        || fragments.join('') !== text) {
        return null;
    }
    const window = captionWindowSeconds(caption);
    const words = Array.isArray(caption.words) ? caption.words : null;
    const validWords = words?.every(word => isCaptionFragmentWord(word)) === true
        ? words : null;
    const wordText = validWords?.map(word => word.text).join('');
    const fragmentEnds = [];
    fragments.reduce((offset, fragment) => {
        fragmentEnds.push(offset + fragment.length);
        return offset + fragment.length;
    }, 0);
    let wordLength = 0;
    const wordEnds = validWords ? validWords.map(word => (wordLength += word.text.length)) : [];
    const useWords = validWords !== null && wordText === text
        && fragmentEnds.slice(0, -1).every(end => wordEnds.includes(end));
    let characterStart = 0;
    return fragments.map((fragment, index) => {
        const characterEnd = characterStart + fragment.length;
        let start;
        let end;
        if (useWords) {
            const firstWord = characterStart === 0 ? 0 : wordEnds.indexOf(characterStart) + 1;
            const lastWord = wordEnds.indexOf(characterEnd);
            start = clamp(validWords[firstWord].start, window.start, window.end);
            end = clamp(validWords[lastWord].end, window.start, window.end);
        }
        else {
            const duration = window.end - window.start;
            start = window.start + duration * (characterStart / text.length);
            end = window.start + duration * (characterEnd / text.length);
        }
        characterStart = characterEnd;
        return { text: fragment, start, end, index: index + 1, count: fragments.length };
    });
}
/** legacy caption 配列を手置き断片単位の疑似 caption 配列へ展開する。 */
function expandCaptionDisplayFragments(captions) {
    return captions.flatMap(caption => {
        const windows = captionFragmentWindows(caption);
        if (windows === null)
            return [caption];
        let characterStart = 0;
        return windows.map(window => {
            const characterEnd = characterStart + window.text.length;
            const expanded = {
                ...caption,
                text: window.text,
                start: window.start,
                end: window.end,
                fragmentIndex: window.index,
                fragmentCount: window.count,
                fragmentKey: `${String(caption.id)}#f${window.index}`
            };
            if (Object.prototype.hasOwnProperty.call(caption, 'display_text'))
                expanded.display_text = window.text;
            if (Array.isArray(caption.words)) {
                let offset = 0;
                expanded.words = caption.words.flatMap(word => {
                    if (!isCaptionFragmentWord(word))
                        return [];
                    const wordStart = offset;
                    const wordEnd = offset + word.text.length;
                    offset = wordEnd;
                    if (wordStart < characterStart || wordEnd > characterEnd)
                        return [];
                    return [{
                            ...word,
                            start: clamp(word.start, window.start, window.end),
                            end: clamp(word.end, window.start, window.end)
                        }];
                });
            }
            delete expanded.display_fragments;
            characterStart = characterEnd;
            return expanded;
        });
    });
}
function isCaptionFragmentWord(value) {
    if (!value || typeof value !== 'object')
        return false;
    const word = value;
    return typeof word.text === 'string'
        && typeof word.start === 'number' && Number.isFinite(word.start)
        && typeof word.end === 'number' && Number.isFinite(word.end)
        && word.end >= word.start;
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
/** source 秒 t に表示すべき字幕（最初にヒットしたもの）。無ければ undefined */
function findActiveCaption(captions, sourceSeconds) {
    return captions.find(caption => {
        const window = captionWindowSeconds(caption);
        return window.start <= sourceSeconds && sourceSeconds < window.end;
    });
}
