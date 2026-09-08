"use strict";
/**
 * 文字起こしパネル（1 行 = 1 字幕の Monaco 編集）で **行数が変わる編集** をしたときの
 * 「行の差分 → 字幕操作列」への写像と、その操作に伴う時刻割り付け・id 採番。
 * task 2026-09-08-caption-line-ops（issue #66）の指示 (A) / (B) / (D)。
 *
 * ここに置くのは決定論的な純関数だけ（DOM・時刻・乱数に依存しない = 同じ入力なら同じ操作列）。
 * 実際の captions.json への書き戻しは呼び出し側が既存の外科手術関数
 * （replaceCaptionLine / insertCaptionLine / removeCaptionLine / setCaptionTimingLine）へ落とす。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPTION_LINE_DEFAULT_SECONDS = exports.CAPTION_LINE_MIN_SECONDS = void 0;
exports.diffCaptionLines = diffCaptionLines;
exports.planSplitSpans = planSplitSpans;
exports.planInsertSpans = planInsertSpans;
exports.createCaptionIdAllocator = createCaptionIdAllocator;
/** 分割後・追加後の 1 行が最低限持つ表示尺（秒）。これを割るときは操作を拒否する。 */
exports.CAPTION_LINE_MIN_SECONDS = 0.2;
/**
 * 末尾（次の字幕が無い場所）へ字幕を足すときの既定尺（秒）。
 * edit-lint の captions.short-duration（1.0 秒未満で warning）に自分から当たらない値を取る。
 */
exports.CAPTION_LINE_DEFAULT_SECONDS = 1;
/**
 * baseline（保存済みの表示行）と next（編集後の表示行）の差分を字幕操作列へ写す。
 *
 * アルゴリズムは先頭・末尾から一致行を削る古典的な差分（LCS は使わない）。中央に残った
 * 「旧 n 行 → 新 m 行」の塊を次の順に落とす:
 *   - n === 1 && m > 1  → split
 *   - n > 1  && m === 1 → merge
 *   - それ以外          → min(n, m) 組を replace（テキストが変わった行だけ）+ 余りを remove / insert
 *
 * 中央の塊は 1 つしか残らないので、split と remove のような別種の操作が 1 回の呼び出しで
 * 同時に出ることはない（連続した編集はそのたびに呼ばれる）。
 */
function diffCaptionLines(baseline, next, captions) {
    if (baseline.length !== captions.length) {
        throw new Error('字幕の行数と字幕データの件数が一致しません。');
    }
    let prefix = 0;
    while (prefix < baseline.length && prefix < next.length && baseline[prefix] === next[prefix]) {
        prefix++;
    }
    let suffix = 0;
    while (suffix < baseline.length - prefix && suffix < next.length - prefix
        && baseline[baseline.length - 1 - suffix] === next[next.length - 1 - suffix]) {
        suffix++;
    }
    const oldCount = baseline.length - prefix - suffix;
    const newCount = next.length - prefix - suffix;
    if (oldCount === 0 && newCount === 0) {
        return [];
    }
    const ids = captions.slice(prefix, prefix + oldCount).map(caption => caption.id);
    const texts = next.slice(prefix, prefix + newCount);
    if (oldCount === 1 && newCount > 1) {
        return [{ kind: 'split', id: ids[0], texts }];
    }
    if (oldCount > 1 && newCount === 1) {
        return [{ kind: 'merge', ids, text: texts[0] }];
    }
    const ops = [];
    const paired = Math.min(oldCount, newCount);
    for (let index = 0; index < paired; index++) {
        if (texts[index] !== baseline[prefix + index]) {
            ops.push({ kind: 'replace', id: ids[index], text: texts[index] });
        }
    }
    for (let index = paired; index < oldCount; index++) {
        ops.push({ kind: 'remove', id: ids[index] });
    }
    if (newCount > paired) {
        // 追加行を差し込む位置は「直前に残る既存行」で表す。塊の中で組になった行があれば
        // その最後、無ければ塊の直前（先頭挿入なら undefined）。
        const afterId = paired > 0
            ? ids[paired - 1]
            : prefix > 0 ? captions[prefix - 1].id : undefined;
        for (let index = paired; index < newCount; index++) {
            ops.push({ kind: 'insert', afterId, text: texts[index] });
        }
    }
    return ops;
}
/**
 * split の時刻割り付け（指示 B-2）。元の [start, end] を分割後テキストの **文字数比** で按分し、
 * 境界は元の区間内に収める。words があっても使わない（words の無い字幕と同じ挙動を優先する）。
 * どれか 1 つでも minSeconds を持てないときは undefined を返す（= 分割を拒否）。
 */
function planSplitSpans(start, end, texts, minSeconds = exports.CAPTION_LINE_MIN_SECONDS) {
    if (texts.length < 2 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return undefined;
    }
    const duration = end - start;
    if (duration < minSeconds * texts.length - EPSILON) {
        return undefined;
    }
    // 文字数は code point 単位で数える（サロゲートペアで比が壊れないように）。
    const weights = texts.map(text => Math.max(1, Array.from(text).length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const spans = [];
    let cursor = start;
    let consumed = 0;
    for (let index = 0; index < texts.length; index++) {
        consumed += weights[index];
        const boundary = index === texts.length - 1
            ? end
            : Math.min(end, Math.max(cursor, roundMilliseconds(start + duration * consumed / total)));
        spans.push({ start: cursor, end: boundary });
        cursor = boundary;
    }
    return spans.every(span => span.end - span.start >= minSeconds - EPSILON) ? spans : undefined;
}
/**
 * insert の時刻割り付け（指示 B-5）。直前行の end から次行の start までの隙間へ count 行を置く。
 * 隙間が count × minSeconds に足りないときは undefined を返す（= 追加を拒否）。
 * 次行が無い（末尾への追加）ときは隙間の上限が無いので CAPTION_LINE_DEFAULT_SECONDS ずつ並べる。
 */
function planInsertSpans(previousEnd, nextStart, count, minSeconds = exports.CAPTION_LINE_MIN_SECONDS) {
    if (count < 1 || !Number.isFinite(previousEnd) || previousEnd < 0) {
        return undefined;
    }
    if (nextStart === undefined) {
        return Array.from({ length: count }, (_unused, index) => ({
            start: roundMilliseconds(previousEnd + exports.CAPTION_LINE_DEFAULT_SECONDS * index),
            end: roundMilliseconds(previousEnd + exports.CAPTION_LINE_DEFAULT_SECONDS * (index + 1))
        }));
    }
    const gap = nextStart - previousEnd;
    if (!Number.isFinite(gap) || gap < minSeconds * count - EPSILON) {
        return undefined;
    }
    const slot = gap / count;
    const duration = Math.min(slot, exports.CAPTION_LINE_DEFAULT_SECONDS);
    return Array.from({ length: count }, (_unused, index) => {
        const spanStart = roundMilliseconds(previousEnd + slot * index);
        return {
            start: spanStart,
            end: Math.min(nextStart, roundMilliseconds(spanStart + duration))
        };
    });
}
/**
 * `c-0001`, `c-0002`, ... のうち既存 id と衝突しないものを順に返す採番器
 * （timeline-material-insert.ts の nextSourceId と同型: 使用済み集合 + 衝突する限り繰り上げ）。
 */
function createCaptionIdAllocator(existingIds) {
    const used = new Set(existingIds);
    let serial = 1;
    for (const id of used) {
        const match = /^c-(\d{4,})$/.exec(id);
        if (match) {
            serial = Math.max(serial, Number(match[1]) + 1);
        }
    }
    return () => {
        let candidate;
        do {
            candidate = `c-${String(serial++).padStart(4, '0')}`;
        } while (used.has(candidate));
        used.add(candidate);
        return candidate;
    };
}
const EPSILON = 1e-9;
function roundMilliseconds(value) {
    return Math.round(value * 1000) / 1000;
}
