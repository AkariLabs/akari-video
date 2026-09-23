"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KARAOKE_MIN_WORD_MATCH_RATIO = void 0;
exports.rederiveCaptionWords = rederiveCaptionWords;
exports.rebaseCaptionEmphasis = rebaseCaptionEmphasis;
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
    if (end <= start)
        return Array.from({ length: tokenCount }, () => ({ start, end: start }));
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
/** The original normalized-token route is used only when words cannot be located verbatim. */
function rederiveUnalignedWords(input) {
    const oldTokens = segmentIntoWords(input.oldText);
    const newTokens = segmentIntoWords(input.newText);
    const diff = computeDiff(oldTokens.map(normalizeKey), newTokens.map(normalizeKey));
    const keepByNewIndex = new Map();
    for (const operation of diff) {
        if (operation.kind === 'keep')
            keepByNewIndex.set(operation.newIdx, operation.oldIdx);
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
        while (newIndex + 1 < newTokens.length && !keepByNewIndex.has(newIndex + 1))
            newIndex++;
        const nextOldIndex = keepByNewIndex.get(newIndex + 1);
        const intervalEnd = nextOldIndex === undefined
            ? input.end : Math.max(previousEnd, roundMs(mappedOldTimes[nextOldIndex].start));
        result.push(...distributeInInterval(newTokens.slice(groupStart, newIndex + 1), previousEnd, intervalEnd));
        previousEnd = intervalEnd;
    }
    return {
        words: clampAndMonotonize(result, input.start, input.end),
        keptCount, derivedCount, matchRatio, degraded: false
    };
}
function rederiveCaptionWords(input) {
    const oldText = input.oldText;
    const newText = input.newText;
    const words = input.words;
    const spans = [];
    let cursor = 0;
    for (const word of words) {
        const start = oldText.indexOf(word.text, cursor);
        if (start < 0)
            return rederiveUnalignedWords(input);
        if (!Number.isFinite(word.start) || !Number.isFinite(word.end)
            || word.end <= word.start)
            return degradedWordResult(words.length);
        spans.push({ start, end: start + word.text.length });
        cursor = start + word.text.length;
    }
    const normalizedTokens = segmentIntoWords(newText);
    if (words.every(word => !/\s/u.test(word.text))
        && normalizedTokens.length === words.length && normalizedTokens.every((token, index) => normalizeKey(token) === normalizeKey(words[index].text))) {
        return {
            words: words.map((word, index) => ({ start: word.start, end: word.end, text: normalizedTokens[index] })),
            keptCount: words.length, derivedCount: 0, matchRatio: 1, degraded: false
        };
    }
    const change = changedRange(oldText, newText);
    if (!change)
        return {
            words: words.map(word => ({ start: word.start, end: word.end, text: word.text })),
            keptCount: words.length, derivedCount: 0, matchRatio: 1, degraded: false
        };
    const affected = spans.map((span, index) => ({ span, index })).filter(({ span }) => change.oldStart === change.oldEnd
        ? span.start < change.oldStart && change.oldStart < span.end
        : span.start < change.oldEnd && span.end > change.oldStart);
    const first = affected.length ? affected[0].index : spans.findIndex(span => span.start >= change.oldStart);
    const oldFrom = affected.length ? first : first < 0 ? words.length : first;
    const oldTo = affected.length ? affected[affected.length - 1].index + 1 : oldFrom;
    const keptCount = words.length - (oldTo - oldFrom);
    const oldCharacterCount = toGraphemes(oldText).length;
    const changedCharacterCount = toGraphemes(oldText.slice(change.oldStart, change.oldEnd)).length;
    const matchRatio = oldCharacterCount ? (oldCharacterCount - changedCharacterCount) / oldCharacterCount : 0;
    if (matchRatio < exports.KARAOKE_MIN_WORD_MATCH_RATIO) {
        return { words: [], keptCount, derivedCount: 0, matchRatio, degraded: true,
            changedOldRange: [oldFrom, oldTo], changedNewRange: [oldFrom, oldFrom] };
    }
    const oldStart = oldFrom < oldTo ? spans[oldFrom].start : change.oldStart;
    const oldEnd = oldFrom < oldTo ? spans[oldTo - 1].end : change.oldEnd;
    const delta = change.newEnd - change.oldEnd;
    const newStart = oldStart <= change.oldStart ? oldStart
        : oldStart >= change.oldEnd ? oldStart + delta : change.oldStart;
    const newEnd = oldEnd >= change.oldEnd ? oldEnd + delta
        : oldEnd <= change.oldStart ? oldEnd : change.newEnd;
    const replacement = newText.slice(newStart, newEnd);
    const tokens = segmentWithWhitespace(replacement.replace(/\s+$/u, ''));
    const before = words.slice(0, oldFrom).map(word => ({ start: word.start, end: word.end, text: word.text }));
    const after = words.slice(oldTo).map(word => ({ start: word.start, end: word.end, text: word.text }));
    const intervalStart = oldFrom < oldTo ? words[oldFrom].start : before[before.length - 1]?.end ?? input.start;
    const intervalEnd = oldFrom < oldTo ? words[oldTo - 1].end : after[0]?.start ?? input.end;
    let replacementWords;
    if (tokens.length && intervalEnd - intervalStart >= tokens.length * 0.001) {
        replacementWords = distributeInInterval(tokens, intervalStart, intervalEnd);
        if (replacementWords.some(word => word.end <= word.start)) {
            replacementWords = [{ start: intervalStart, end: intervalEnd, text: replacement }];
        }
    }
    else if (replacement && before.length) {
        before[before.length - 1].text += replacement;
        replacementWords = [];
    }
    else if (replacement && after.length) {
        after[0].text = replacement + after[0].text;
        replacementWords = [];
    }
    else {
        replacementWords = [];
    }
    return {
        words: [...before, ...replacementWords, ...after], keptCount,
        derivedCount: replacementWords.length, matchRatio, degraded: false,
        changedOldRange: [oldFrom, oldTo],
        changedNewRange: [oldFrom, oldFrom + replacementWords.length]
    };
}
function degradedWordResult(count) {
    return { words: [], keptCount: 0, derivedCount: 0, matchRatio: count ? 0 : 1, degraded: true };
}
function changedRange(oldText, newText) {
    if (oldText === newText)
        return undefined;
    const oldChars = toGraphemes(oldText);
    const newChars = toGraphemes(newText);
    let prefix = 0;
    while (prefix < oldChars.length && prefix < newChars.length && oldChars[prefix] === newChars[prefix])
        prefix++;
    let suffix = 0;
    while (suffix < oldChars.length - prefix && suffix < newChars.length - prefix
        && oldChars[oldChars.length - 1 - suffix] === newChars[newChars.length - 1 - suffix])
        suffix++;
    return {
        oldStart: oldChars.slice(0, prefix).join('').length,
        oldEnd: oldChars.slice(0, oldChars.length - suffix).join('').length,
        newEnd: newChars.slice(0, newChars.length - suffix).join('').length
    };
}
function segmentWithWhitespace(text) {
    const tokens = segmentIntoWords(text);
    if (!tokens.length)
        return text ? [text] : [];
    const result = [];
    let cursor = 0;
    for (const token of tokens) {
        const start = text.indexOf(token, cursor);
        result.push(text.slice(cursor, start) + token);
        cursor = start + token.length;
    }
    if (cursor < text.length)
        result[result.length - 1] += text.slice(cursor);
    return result;
}
/** Move only emphasis attached to replaced words; report entries that have no timed successor. */
function rebaseCaptionEmphasis(input) {
    const { oldWords, result } = input;
    const [oldFrom, oldTo] = result.changedOldRange ?? [0, 0];
    const [newFrom, newTo] = result.changedNewRange ?? [0, 0];
    const next = result.words.slice(newFrom, newTo);
    const change = changedRange(input.oldText, input.newText);
    const locateSpans = (text, words) => {
        const spans = [];
        let cursor = 0;
        for (const word of words) {
            const start = text.indexOf(word.text, cursor);
            if (start < 0)
                return undefined;
            spans.push({ start, end: start + word.text.length });
            cursor = start + word.text.length;
        }
        return spans;
    };
    const oldSpans = locateSpans(input.oldText, oldWords);
    const newSpans = locateSpans(input.newText, result.words);
    const mapBoundary = (position, endBoundary) => {
        if (!change || position <= change.oldStart)
            return position;
        const delta = change.newEnd - change.oldEnd;
        if (position >= change.oldEnd)
            return position + delta;
        const fraction = (position - change.oldStart) * (change.newEnd - change.oldStart)
            / (change.oldEnd - change.oldStart);
        return change.oldStart + (endBoundary ? Math.ceil(fraction) : Math.floor(fraction));
    };
    const emphasis = [];
    const removed = [];
    for (const item of input.emphasis) {
        const sourceMatches = input.src === undefined || item.src === undefined || item.src === input.src;
        const overlaps = (word) => Math.min(word.end, item.t_end) - Math.max(word.start, item.t_start) > 0.000001;
        if (result.degraded && sourceMatches && oldWords.some(overlaps)) {
            removed.push(item);
            continue;
        }
        const affected = sourceMatches && oldWords.slice(oldFrom, oldTo).some(overlaps);
        if (!affected) {
            emphasis.push(item);
            continue;
        }
        if (oldSpans && newSpans && change) {
            const selectedOld = oldWords.map((_word, index) => index).filter(index => overlaps(oldWords[index]));
            const mappedStart = mapBoundary(oldSpans[selectedOld[0]].start, false);
            const mappedEnd = mapBoundary(oldSpans[selectedOld[selectedOld.length - 1]].end, true);
            const selectedNew = result.words.filter((_word, index) => newSpans[index].start < mappedEnd && newSpans[index].end > mappedStart);
            if (selectedNew.length === 0) {
                removed.push(item);
                continue;
            }
            emphasis.push({
                ...item,
                t_start: Math.min(...selectedNew.map(word => word.start)),
                t_end: Math.max(...selectedNew.map(word => word.end)),
                ...(typeof item.word === 'string'
                    ? { word: selectedNew.map(word => word.text).join('') } : {})
            });
            continue;
        }
        const retained = oldWords.filter((word, index) => (index < oldFrom || index >= oldTo) && overlaps(word));
        if (result.degraded || (next.length === 0 && retained.length === 0)) {
            removed.push(item);
            continue;
        }
        if (next.length === 0) {
            emphasis.push(item);
            continue;
        }
        const covered = [...retained, ...next];
        emphasis.push({
            ...item,
            t_start: Math.min(...covered.map(word => word.start)),
            t_end: Math.max(...covered.map(word => word.end)),
            ...(typeof item.word === 'string'
                ? { word: [...covered].sort((a, b) => a.start - b.start).map(word => word.text).join('') }
                : {})
        });
    }
    return { emphasis, removed };
}
function transferTextChange(oldText, newText, display) {
    const change = changedRange(oldText, newText);
    if (!change)
        return { text: display, oldStart: 0, oldEnd: 0, newEnd: 0 };
    const oldPart = oldText.slice(change.oldStart, change.oldEnd);
    const replacement = newText.slice(change.oldStart, change.newEnd);
    let start;
    if (display === oldText)
        start = change.oldStart;
    else {
        const left = oldText.slice(0, change.oldStart);
        const right = oldText.slice(change.oldEnd);
        const candidates = [];
        // Extend unchanged context on both sides of every possible edit location.
        // A repeated particle is safe to replace only when one location wins uniquely.
        for (let at = 0; at <= display.length - oldPart.length; at++) {
            if (oldPart && !display.startsWith(oldPart, at))
                continue;
            let before = 0;
            while (before < left.length && before < at
                && left[left.length - 1 - before] === display[at - 1 - before])
                before++;
            let after = 0;
            const end = at + oldPart.length;
            while (after < right.length && end + after < display.length
                && right[after] === display[end + after])
                after++;
            candidates.push({ start: at, context: before + after });
        }
        const highest = Math.max(0, ...candidates.map(candidate => candidate.context));
        const best = candidates.filter(candidate => candidate.context === highest);
        if (highest === 0 || best.length !== 1)
            return undefined;
        start = best[0].start;
    }
    if (start < 0)
        return undefined;
    const text = display.slice(0, start) + replacement + display.slice(start + oldPart.length);
    return { text, oldStart: start, oldEnd: start + oldPart.length, newEnd: start + replacement.length };
}
function transferFragments(oldText, newText, fragments) {
    const display = fragments.join('');
    if (display !== oldText)
        return undefined;
    const change = transferTextChange(oldText, newText, display);
    if (!change)
        return undefined;
    const delta = change.newEnd - change.oldEnd;
    let oldBoundary = 0;
    let prior = 0;
    const next = [];
    for (const fragment of fragments.slice(0, -1)) {
        oldBoundary += fragment.length;
        const boundary = oldBoundary <= change.oldStart ? oldBoundary
            : oldBoundary >= change.oldEnd ? oldBoundary + delta
                : change.oldStart + Math.round((oldBoundary - change.oldStart)
                    * (change.newEnd - change.oldStart) / (change.oldEnd - change.oldStart));
        next.push(change.text.slice(prior, boundary));
        prior = boundary;
    }
    next.push(change.text.slice(prior));
    return next.every(Boolean) && next.join('') === change.text ? next : undefined;
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
    // The script edits raw `text`. Copy its exact character change into the displayed
    // wording only when the old changed characters can be located unambiguously.
    // Otherwise discard stale display wording and let the normal display path apply.
    if (typeof record.display_text === 'string') {
        const transferred = transferTextChange(record.text, normalizedText, record.display_text);
        if (transferred)
            next.display_text = transferred.text;
        else
            delete next.display_text;
    }
    if (Array.isArray(record.display_fragments)
        && (typeof record.display_text !== 'string' || typeof next.display_text === 'string')) {
        const oldDisplay = typeof record.display_text === 'string' ? record.display_text : record.text;
        const nextDisplay = typeof next.display_text === 'string' ? next.display_text : normalizedText;
        const fragments = transferFragments(oldDisplay, nextDisplay, record.display_fragments);
        if (fragments)
            next.display_fragments = fragments;
        else
            delete next.display_fragments;
    }
    else
        delete next.display_fragments;
    return { record: next, ...(rederive ? { rederive } : {}) };
}
