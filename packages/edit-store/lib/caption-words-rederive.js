"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KARAOKE_MIN_WORD_MATCH_RATIO = void 0;
exports.rederiveCaptionWords = rederiveCaptionWords;
exports.applyCaptionTextEdit = applyCaptionTextEdit;
exports.KARAOKE_MIN_WORD_MATCH_RATIO = 0.5;
function segmenterConstructor() {
    if (typeof Intl === 'undefined')
        return undefined;
    return Intl.Segmenter;
}
function toGraphemes(text) {
    try {
        const Segmenter = segmenterConstructor();
        if (Segmenter) {
            const segmenter = new Segmenter(undefined, { granularity: 'grapheme' });
            return Array.from(segmenter.segment(text), item => item.segment);
        }
    }
    catch {
        // Array.from is the final, code-point-safe fallback.
    }
    return Array.from(text);
}
function segmentIntoWords(text) {
    try {
        const Segmenter = segmenterConstructor();
        if (Segmenter) {
            const segmenter = new Segmenter(undefined, { granularity: 'word' });
            const tokens = [];
            for (const item of segmenter.segment(text)) {
                if (item.isWordLike || /\S/.test(item.segment)) {
                    tokens.push(item.segment);
                }
            }
            if (tokens.length > 0)
                return tokens;
        }
    }
    catch {
        // Fall through to grapheme segmentation.
    }
    return toGraphemes(text).filter(token => /\S/.test(token));
}
function normalizeKey(text) {
    // eslint-disable-next-line no-control-regex
    return text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\p{C}]/gu, '');
}
function roundMs(value) {
    return Math.round(value * 1000) / 1000;
}
function computeDiff(oldKeys, newKeys) {
    const rows = oldKeys.length + 1;
    const columns = newKeys.length + 1;
    const dp = Array.from({ length: rows }, () => new Array(columns).fill(0));
    for (let oldIndex = 1; oldIndex < rows; oldIndex++) {
        for (let newIndex = 1; newIndex < columns; newIndex++) {
            dp[oldIndex][newIndex] = oldKeys[oldIndex - 1] === newKeys[newIndex - 1]
                ? dp[oldIndex - 1][newIndex - 1] + 1
                : Math.max(dp[oldIndex - 1][newIndex], dp[oldIndex][newIndex - 1]);
        }
    }
    const operations = [];
    let oldIndex = oldKeys.length;
    let newIndex = newKeys.length;
    while (oldIndex > 0 || newIndex > 0) {
        if (oldIndex > 0 && newIndex > 0
            && oldKeys[oldIndex - 1] === newKeys[newIndex - 1]) {
            operations.push({ kind: 'keep', oldIdx: oldIndex - 1, newIdx: newIndex - 1 });
            oldIndex--;
            newIndex--;
        }
        else if (newIndex > 0
            && (oldIndex === 0 || dp[oldIndex][newIndex - 1] >= dp[oldIndex - 1][newIndex])) {
            operations.push({ kind: 'insert', newIdx: newIndex - 1 });
            newIndex--;
        }
        else {
            operations.push({ kind: 'delete', oldIdx: oldIndex - 1 });
            oldIndex--;
        }
    }
    return operations.reverse();
}
function mapWordTimesToTokens(words, tokenCount, start, end) {
    if (tokenCount === 0)
        return [];
    if (words.length === tokenCount) {
        return words.map(word => ({
            start: Math.max(start, Math.min(end, word.start)),
            end: Math.max(start, Math.min(end, word.end))
        }));
    }
    if (end <= start) {
        return Array.from({ length: tokenCount }, () => ({ start, end: start }));
    }
    const ratio = words.length / tokenCount;
    return Array.from({ length: tokenCount }, (_, index) => {
        const word = words[Math.min(Math.floor(index * ratio), words.length - 1)];
        return {
            start: roundMs(Math.max(start, Math.min(end, word.start))),
            end: roundMs(Math.max(start, Math.min(end, word.end)))
        };
    });
}
function distributeInInterval(tokens, start, end) {
    const duration = Math.max(0, end - start);
    const weights = tokens.map(token => /^[\p{P}\p{Z}]+$/u.test(token)
        ? 0.001
        : Math.max(1, toGraphemes(token).length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = start;
    return tokens.map((text, index) => {
        const tokenStart = roundMs(cursor);
        cursor += duration * (totalWeight > 0 ? weights[index] / totalWeight : 1 / tokens.length);
        const tokenEnd = index === tokens.length - 1 ? roundMs(end) : roundMs(cursor);
        return { start: tokenStart, end: Math.max(tokenStart, tokenEnd), text };
    });
}
function clampAndMonotonize(words, start, end) {
    let previousEnd = start;
    return words.map(word => {
        const wordStart = roundMs(Math.max(previousEnd, Math.min(word.start, end)));
        const wordEnd = roundMs(Math.max(wordStart, Math.min(word.end, end)));
        previousEnd = wordEnd;
        return { start: wordStart, end: wordEnd, text: word.text };
    });
}
function rederiveCaptionWords(input) {
    const oldTokens = segmentIntoWords(input.oldText);
    const newTokens = segmentIntoWords(input.newText);
    const diff = computeDiff(oldTokens.map(normalizeKey), newTokens.map(normalizeKey));
    const keepByNewIndex = new Map();
    for (const operation of diff) {
        if (operation.kind === 'keep') {
            keepByNewIndex.set(operation.newIdx, operation.oldIdx);
        }
    }
    const keptCount = keepByNewIndex.size;
    const matchRatio = oldTokens.length === 0 ? 0 : keptCount / oldTokens.length;
    const derivedCount = newTokens.length - keptCount;
    if (matchRatio < exports.KARAOKE_MIN_WORD_MATCH_RATIO) {
        return { words: [], keptCount, derivedCount, matchRatio, degraded: true };
    }
    const mappedOldTimes = mapWordTimesToTokens(input.words, oldTokens.length, input.start, input.end);
    const result = [];
    let previousEnd = input.start;
    for (let newIndex = 0; newIndex < newTokens.length; newIndex++) {
        const oldIndex = keepByNewIndex.get(newIndex);
        if (oldIndex !== undefined) {
            const timing = mappedOldTimes[oldIndex];
            const wordStart = Math.max(previousEnd, roundMs(timing.start));
            const wordEnd = Math.max(wordStart, roundMs(timing.end));
            result.push({ start: wordStart, end: wordEnd, text: newTokens[newIndex] });
            previousEnd = wordEnd;
            continue;
        }
        const groupStart = newIndex;
        while (newIndex + 1 < newTokens.length && !keepByNewIndex.has(newIndex + 1)) {
            newIndex++;
        }
        const nextOldIndex = keepByNewIndex.get(newIndex + 1);
        const intervalEnd = nextOldIndex === undefined
            ? input.end
            : Math.max(previousEnd, roundMs(mappedOldTimes[nextOldIndex].start));
        result.push(...distributeInInterval(newTokens.slice(groupStart, newIndex + 1), previousEnd, intervalEnd));
        previousEnd = intervalEnd;
    }
    return {
        words: clampAndMonotonize(result, input.start, input.end),
        keptCount,
        derivedCount,
        matchRatio,
        degraded: false
    };
}
function applyCaptionTextEdit(record, newText) {
    const normalizedText = newText.normalize('NFC').trim();
    if (!normalizedText) {
        throw new Error('字幕のテキストは空にできません。');
    }
    if (normalizedText === record.text) {
        return { record };
    }
    const next = { ...record, text: normalizedText, edited: true };
    let rederive;
    if (Array.isArray(record.words) && record.words.length > 0) {
        rederive = rederiveCaptionWords({
            oldText: record.text,
            newText: normalizedText,
            words: record.words,
            start: record.start,
            end: record.end
        });
        if (rederive.degraded) {
            delete next.words;
        }
        else {
            next.words = rederive.words;
        }
    }
    delete next.display_text;
    delete next.display_fragments;
    return { record: next, ...(rederive ? { rederive } : {}) };
}
