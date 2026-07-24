import { findMatchingBracket, splitTopLevelElements, type SourceElement } from './edit-store';

export interface CaptionRecord {
    id: string;
    start: number;
    end: number;
    text: string;
    speaker: string | null;
    sourceRef: { segment: number } | null;
    edited: boolean;
}

const JSON_NUMBER = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';

export function parseCaptions(source: string): { captions: CaptionRecord[]; warnings: string[] } {
    const value = JSON.parse(source);
    if (!Array.isArray(value)) {
        throw new Error('字幕データの形式を確認できません。');
    }
    const captions: CaptionRecord[] = [];
    const warnings: string[] = [];
    const seenIds = new Set<string>();
    for (let index = 0; index < value.length; index++) {
        const caption = normalizeCaption(value[index]);
        if (!caption) {
            warnings.push(`${index + 1} 番目の字幕は時刻または内容が不正なため表示しません。`);
            continue;
        }
        if (seenIds.has(caption.id)) {
            warnings.push(`字幕 ${caption.id} が重複しているため、後の行は表示しません。`);
            continue;
        }
        seenIds.add(caption.id);
        captions.push(caption);
    }
    return { captions, warnings };
}

export function shiftCaptionLine(
    source: string,
    captionId: string,
    deltaStart: number,
    deltaEnd: number
): string {
    if (!captionId || !Number.isFinite(deltaStart) || !Number.isFinite(deltaEnd)) {
        throw new Error('字幕の調整値が不正です。');
    }
    const array = locateCaptionArray(source);
    const element = findCaptionElement(array.elements, captionId);
    const start = readCaptionNumberProperty(element.text, 'start', captionId);
    const end = readCaptionNumberProperty(element.text, 'end', captionId);
    const nextStart = start + deltaStart;
    const nextEnd = end + deltaEnd;
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd)
        || nextStart < 0 || nextEnd - nextStart < 0.15) {
        throw new Error('字幕が短すぎます（0.15 秒未満にはできません）');
    }
    let nextElement = replaceCaptionProperty(element.text, 'start', nextStart, captionId);
    nextElement = replaceCaptionProperty(nextElement, 'end', nextEnd, captionId);
    nextElement = replaceCaptionProperty(nextElement, 'edited', true, captionId);
    return replaceElement(source, array.openIndex + 1, element, nextElement);
}

export function updateCaptionFieldsInSource(
    source: string,
    captionId: string,
    updates: { text?: string; speaker?: string | null }
): string {
    if (!captionId) {
        throw new Error('字幕 ID を指定してください。');
    }
    if (updates.text === undefined && updates.speaker === undefined) {
        throw new Error('変更する字幕フィールドを指定してください。');
    }
    if (updates.text !== undefined && (typeof updates.text !== 'string' || !updates.text.trim())) {
        throw new Error('字幕のテキストは空にできません。');
    }
    if (updates.speaker !== undefined && updates.speaker !== null && typeof updates.speaker !== 'string') {
        throw new Error('字幕の話者は文字列または null で指定してください。');
    }
    const array = locateCaptionArray(source);
    const element = findCaptionElement(array.elements, captionId);
    let nextElement = element.text;
    if (updates.text !== undefined) {
        nextElement = replaceCaptionProperty(nextElement, 'text', updates.text, captionId);
    }
    if (updates.speaker !== undefined) {
        nextElement = replaceCaptionProperty(nextElement, 'speaker', updates.speaker, captionId);
    }
    nextElement = replaceCaptionProperty(nextElement, 'edited', true, captionId);
    return replaceElement(source, array.openIndex + 1, element, nextElement);
}

export function insertCaptionLine(source: string, caption: CaptionRecord): string {
    const parsed = parseCaptions(source);
    if (!normalizeCaption(caption)) {
        throw new Error('追加する字幕の形式が不正です。');
    }
    const array = locateCaptionArray(source);
    const entries = captionElementEntries(array.elements);
    if (entries.some(candidate => candidate.id === caption.id)) {
        throw new Error(`字幕 ${caption.id} は既にあります。`);
    }
    // Preserve the existing validation behavior for duplicate/ambiguous records.
    validateCaptionElements(entries, parsed.captions);
    const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
    const serialized = serializeCaption(caption);
    const before = entries.find(entry => entry.start > caption.start);
    if (before) {
        const index = entries.indexOf(before);
        const separator = whitespaceBeforeElement(array.inner, array.elements, index);
        const nextInner = array.inner.slice(0, before.element.start)
            + serialized + ',' + separator
            + array.inner.slice(before.element.start);
        return replaceArrayInner(source, array, nextInner);
    }
    if (entries.length > 0) {
        const last = entries[entries.length - 1];
        const index = array.elements.indexOf(last.element);
        const separator = whitespaceBeforeElement(array.inner, array.elements, index);
        const nextInner = array.inner.slice(0, last.element.end)
            + ',' + separator + serialized
            + array.inner.slice(last.element.end);
        return replaceArrayInner(source, array, nextInner);
    }
    return replaceArrayInner(source, array, insertIntoEmptyArray(array.inner, serialized, lineEnding));
}

export function removeCaptionLine(source: string, captionId: string): string {
    const parsed = parseCaptions(source);
    const array = locateCaptionArray(source);
    const entries = captionElementEntries(array.elements);
    validateCaptionElements(entries, parsed.captions);
    const index = entries.findIndex(entry => entry.id === captionId);
    if (index < 0) {
        throw new Error(`字幕 ${captionId} が字幕データにありません。`);
    }
    const entry = entries[index];
    let nextInner: string;
    if (entries.length === 1) {
        nextInner = array.inner.slice(0, entry.element.start) + array.inner.slice(entry.element.end);
    } else if (index < entries.length - 1) {
        nextInner = array.inner.slice(0, entry.element.start)
            + array.inner.slice(entries[index + 1].element.start);
    } else {
        nextInner = array.inner.slice(0, entries[index - 1].element.end)
            + array.inner.slice(entry.element.end);
    }
    return replaceArrayInner(source, array, nextInner);
}

function normalizeCaption(value: any): CaptionRecord | undefined {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id
        || typeof value.text !== 'string' || typeof value.edited !== 'boolean') {
        return undefined;
    }
    const start = value.start;
    const end = value.end;
    if (typeof start !== 'number' || typeof end !== 'number'
        || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
        return undefined;
    }
    const sourceRef = value.sourceRef === null
        ? null
        : Number.isInteger(value.sourceRef?.segment) && value.sourceRef.segment >= 0
            ? { segment: value.sourceRef.segment as number }
            : undefined;
    if (sourceRef === undefined || (value.speaker !== null && typeof value.speaker !== 'string')) {
        return undefined;
    }
    return {
        id: value.id,
        start,
        end,
        text: value.text,
        speaker: value.speaker,
        sourceRef,
        edited: value.edited
    };
}

interface CaptionArray {
    openIndex: number;
    closeIndex: number;
    inner: string;
    elements: SourceElement[];
}

interface CaptionElementEntry {
    id: string | undefined;
    start: number;
    element: SourceElement;
}

function locateCaptionArray(source: string): CaptionArray {
    const value = JSON.parse(source);
    if (!Array.isArray(value)) {
        throw new Error('字幕データの形式を確認できません。');
    }
    const rootStart = source.search(/\S/);
    if (rootStart < 0 || source[rootStart] !== '[') {
        throw new Error('字幕データの形式を確認できません。');
    }
    const closeIndex = findMatchingBracket(source, rootStart);
    if (source.slice(closeIndex + 1).trim()) {
        throw new Error('字幕データの形式を確認できません。');
    }
    const inner = source.slice(rootStart + 1, closeIndex);
    return {
        openIndex: rootStart,
        closeIndex,
        inner,
        elements: splitTopLevelElements(inner)
    };
}

function captionElementEntries(elements: SourceElement[]): CaptionElementEntry[] {
    return elements.map(element => {
        const value = JSON.parse(element.text);
        return {
            id: value && typeof value === 'object' && typeof value.id === 'string' ? value.id : undefined,
            start: value && typeof value === 'object' && typeof value.start === 'number'
                ? value.start : Number.POSITIVE_INFINITY,
            element
        };
    });
}

function validateCaptionElements(
    entries: CaptionElementEntry[],
    captions: CaptionRecord[]
): void {
    for (const caption of captions) {
        const matches = entries.filter(entry => entry.id === caption.id);
        if (matches.length !== 1) {
            throw new Error(matches.length === 0
                ? `字幕 ${caption.id} のレコードを特定できません。`
                : `字幕 ${caption.id} が字幕データに複数あります。`);
        }
    }
}

function findCaptionElement(elements: SourceElement[], captionId: string): SourceElement {
    const entries = captionElementEntries(elements);
    const matches = entries.filter(entry => entry.id === captionId);
    if (matches.length !== 1) {
        throw new Error(matches.length === 0
            ? `字幕 ${captionId} が字幕データにありません。`
            : `字幕 ${captionId} が字幕データに複数あります。`);
    }
    return matches[0].element;
}

function locateCaptionProperty(source: string, property: string, captionId: string): SourceElement {
    const openIndex = source.search(/\S/);
    if (openIndex < 0 || source[openIndex] !== '{') {
        throw new Error(`字幕 ${captionId} のレコードを特定できません。`);
    }
    const closeIndex = findMatchingBracket(source, openIndex);
    if (source.slice(closeIndex + 1).trim()) {
        throw new Error(`字幕 ${captionId} のレコードを特定できません。`);
    }
    const inner = source.slice(openIndex + 1, closeIndex);
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = splitTopLevelElements(inner)
        .filter(element => new RegExp(`^"${escapedProperty}"\\s*:`).test(element.text));
    if (matches.length !== 1) {
        throw new Error(`字幕 ${captionId} の ${property} プロパティを特定できません。`);
    }
    const match = matches[0];
    return {
        text: match.text,
        start: openIndex + 1 + match.start,
        end: openIndex + 1 + match.end
    };
}

function replaceCaptionProperty(
    source: string,
    property: string,
    value: number | string | boolean | null,
    captionId: string
): string {
    const located = locateCaptionProperty(source, property, captionId);
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
        `^("${escapedProperty}"\\s*:\\s*)(?:${JSON_NUMBER}|"(?:\\\\.|[^"\\\\])*"|true|false|null)`
    );
    if (!pattern.test(located.text)) {
        throw new Error(`字幕 ${captionId} の ${property} プロパティを特定できません。`);
    }
    const nextProperty = located.text.replace(pattern, (_match, prefix) =>
        `${prefix}${JSON.stringify(value)}`);
    return source.slice(0, located.start) + nextProperty + source.slice(located.end);
}

function readCaptionNumberProperty(source: string, property: string, captionId: string): number {
    const located = locateCaptionProperty(source, property, captionId);
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^"${escapedProperty}"\\s*:\\s*(${JSON_NUMBER})`).exec(located.text);
    if (!match) {
        throw new Error(`字幕 ${captionId} の ${property} プロパティを特定できません。`);
    }
    return Number(match[1]);
}

function replaceElement(source: string, innerOffset: number, element: SourceElement, nextText: string): string {
    const start = innerOffset + element.start;
    const end = innerOffset + element.end;
    return source.slice(0, start) + nextText + source.slice(end);
}

function replaceArrayInner(source: string, array: CaptionArray, nextInner: string): string {
    return source.slice(0, array.openIndex + 1) + nextInner + source.slice(array.closeIndex);
}

function whitespaceBeforeElement(inner: string, elements: SourceElement[], index: number): string {
    if (index <= 0) {
        return inner.slice(0, elements[0].start);
    }
    const between = inner.slice(elements[index - 1].end, elements[index].start);
    const commaIndex = between.indexOf(',');
    return commaIndex >= 0 ? between.slice(commaIndex + 1) : '';
}

function insertIntoEmptyArray(inner: string, serialized: string, lineEnding: string): string {
    if (!inner.includes('\n')) {
        return inner ? `${inner}${serialized}${inner}` : serialized;
    }
    const lastLineStart = inner.lastIndexOf('\n') + 1;
    const closingIndent = inner.slice(lastLineStart);
    const beforeClosingIndent = inner.slice(0, lastLineStart);
    return `${beforeClosingIndent}${closingIndent}  ${serialized}${lineEnding}${closingIndent}`;
}

function serializeCaption(caption: CaptionRecord): string {
    return `{ "id": ${JSON.stringify(caption.id)}, "start": ${JSON.stringify(caption.start)}, "end": ${JSON.stringify(caption.end)}, "text": ${JSON.stringify(caption.text)}, "speaker": ${JSON.stringify(caption.speaker)}, "sourceRef": ${JSON.stringify(caption.sourceRef)}, "edited": ${JSON.stringify(caption.edited)} }`;
}
