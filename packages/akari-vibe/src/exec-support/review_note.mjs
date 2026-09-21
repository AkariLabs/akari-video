import { editStore } from '../edit-store.mjs';
import { view } from '../v2/model.mjs';
import { targetItem } from '../ops/_knobs.mjs';

const NOTE_WORD = String.raw`(?:メモ|めも|memo)`;
const NOTE_MISRECOGNITION = String.raw`(?:メモリ|めもり)`;
const TASK_WORD = String.raw`(?:タスク|たすく)`;
const END_PUNCTUATION = String.raw`[\s、。，．,.!！?？]*$`;
const SUFFIX_SEPARATOR = String.raw`[\s、。，．,.!！?？]*`;
const SUFFIX_BOUNDARY = String.raw`[\s、。，．,.!！?？]+`;
const NOTE_ACTION = String.raw`(?:しておいてください|しておいて|しといて|して|お願いします|お願い|っておいてください|っておいて|っといて|っとく)`;
const TASK_ACTION = String.raw`${TASK_WORD}に(?:しといて|して(?:おいて(?:ください)?)?|入れといて|入れて(?:おいて(?:ください)?)?|追加して)`;
const PREFIX = new RegExp(
    String.raw`^(?:${NOTE_WORD}(?:して)?|${NOTE_MISRECOGNITION}(?:して(?:おいて)?)?|${TASK_WORD}にして)[\s、,]+`, 'iu');
const SUFFIXES = [
    new RegExp(String.raw`${SUFFIX_BOUNDARY}あとで(?:直して|直しといて)${END_PUNCTUATION}`, 'iu'),
    new RegExp(String.raw`${SUFFIX_SEPARATOR}(?:って|と|を|だ?から)\s*書いといて${END_PUNCTUATION}`, 'iu'),
    new RegExp(String.raw`${SUFFIX_SEPARATOR}(?:って|と|を|だ?から)\s*(?:${NOTE_WORD}(?:${NOTE_ACTION})?|${NOTE_MISRECOGNITION}(?:しておいてください|しておいて|しといて|して|お願いします|お願い))${END_PUNCTUATION}`, 'iu'),
    new RegExp(String.raw`${SUFFIX_SEPARATOR}${NOTE_WORD}${NOTE_ACTION}${END_PUNCTUATION}`, 'iu'),
    new RegExp(String.raw`${SUFFIX_SEPARATOR}${NOTE_MISRECOGNITION}(?:しておいてください|しておいて|しといて|して|お願いします|お願い)${END_PUNCTUATION}`, 'iu'),
    new RegExp(String.raw`${SUFFIX_SEPARATOR}(?:って|と|を|だ?から)\s*${TASK_ACTION}${END_PUNCTUATION}`, 'iu'),
    new RegExp(String.raw`${SUFFIX_SEPARATOR}${TASK_ACTION}${END_PUNCTUATION}`, 'iu'),
];
const EMPTY_BODY = /^[\s、。，．,.!！?？…・:：;；"'“”‘’「」『』（）()［］\[\]【】〈〉《》]*$/u;
const DEICTIC_ONLY = /^[\s、。，．,.!！?？…・:：;；"'“”‘’「」『』（）()［］\[\]【】〈〉《》]*(?:ここら辺|この辺|ここ|そこ|これ|それ|あれ)[\s、。，．,.!！?？…・:：;；"'“”‘’「」『』（）()［］\[\]【】〈〉《》]*$/u;
const CLOSING_BRACKET = new Map([
    ['「', '」'], ['『', '』'], ['（', '）'], ['(', ')'], ['［', '］'], ['[', ']'],
    ['【', '】'], ['〈', '〉'], ['《', '》'], ['“', '”'], ['‘', '’'],
]);

function insideBrackets(text, index) {
    const stack = [];
    for (let i = 0; i < index; i++) {
        const closing = CLOSING_BRACKET.get(text[i]);
        if (closing) stack.push(closing);
        else if (text[i] === stack.at(-1)) stack.pop();
    }
    return stack.length > 0;
}

export function noteBodyFrom(rawText) {
    if (typeof rawText !== 'string') return rawText;
    let body = rawText;
    let changed = false;
    const prefix = PREFIX.exec(body);
    if (prefix && !insideBrackets(body, prefix.index)) {
        body = body.slice(prefix[0].length);
        changed = true;
    }
    for (const suffix of SUFFIXES) {
        const match = suffix.exec(body);
        if (!match || insideBrackets(body, match.index)) continue;
        body = body.slice(0, match.index);
        changed = true;
        break;
    }
    if (!changed) return rawText;
    body = body.trim();
    return EMPTY_BODY.test(body) || DEICTIC_ONLY.test(body) ? rawText : body;
}

export function readReview(source) {
    if (source == null) return { version: 0, annotations: [] };
    if (typeof source !== 'string') throw new Error('reviewSource が文字列ではない');
    const review = JSON.parse(source);
    if (review?.version !== 0 || !Array.isArray(review.annotations)) {
        throw new Error('review.json の version / annotations が未対応（既存データを保持）');
    }
    return review;
}
export function validBox(box) {
    return Array.isArray(box) && box.length === 4 && box.every(Number.isFinite)
        && box.every(v => v >= 0 && v <= 1) && box[0] + box[2] <= 1 && box[1] + box[3] <= 1;
}
export function regionOf(env, segment) {
    const { ctx = {} } = env;
    if (ctx.stroke == null) return null;
    let reason;
    if (!validBox(ctx.stroke)) reason = '描線 bbox が正規化範囲外';
    else if (ctx.strokeCut != null && ctx.strokeCut !== segment.index + 1) reason = '描線のカットと再生位置が異なる';
    else if (ctx.strokeSpace === 'source') return { box: [...ctx.stroke] };
    else if (ctx.strokeSpace != null) reason = '描線の座標系を source へ変換できない';
    else {
        // Lab's synthetic full-frame bbox has an identity mapping only without
        // crop / transform / animation / parent transforms. Never guess inverses.
        const location = editStore.locate(env.edit, segment.itemId);
        const nodes = [segment.raw, ...(location?.ancestors ?? [])];
        if (nodes.some(n => n.crop || n.transform || n.keyframes || n.perspective)
            || segment.source.crop || segment.source.transform) reason = 'crop / transform 等の逆写像が未実装';
        else {
            env.log.push('review_note region: lab の無変形・全面 bbox を source 正規化座標として使用（実プレビューの逆写像は未接続）');
            return { box: [...ctx.stroke] };
        }
    }
    env.log.push(`review_note region → 変換不可（${reason}）。本文と時間アンカーは記録`);
    return null;
}
export function refsOf(item, log) {
    if (!item) return null;
    // refs has no item-id vocabulary in the contract. Preserve the real resource
    // reference; name the exact item in the log instead of inventing target syntax.
    log.push(`review_note 対象 item=${item.id}`);
    if (item.source.src) return [{ src: item.source.src }];
    if (item.source.path) return [{ path: item.source.path }];
    log.push('review_note refs: item 固有参照が契約に無いため定義元 edit.json を参照');
    return [{ path: 'edit.json' }];
}
