export interface EditCut {
    in: number;
    out: number;
}

export interface EditOverlay {
    id: string;
    start: number;
    duration: number;
}

export interface SourceElement {
    text: string;
    start: number;
    end: number;
}

const JSON_NUMBER = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';

export function findMatchingBracket(source: string, openIndex: number): number {
    const opening = source[openIndex];
    if (opening !== '[' && opening !== '{') {
        throw new Error('対応する括弧を探す開始位置が不正です。');
    }
    const stack: string[] = [opening];
    let inString = false;
    let escaped = false;
    for (let index = openIndex + 1; index < source.length; index++) {
        const character = source[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }
        if (character === '"') {
            inString = true;
        } else if (character === '[' || character === '{') {
            stack.push(character);
        } else if (character === ']' || character === '}') {
            const expected = character === ']' ? '[' : '{';
            if (stack.pop() !== expected) {
                throw new Error('JSON の括弧の対応を確認できません。');
            }
            if (stack.length === 0) {
                return index;
            }
        }
    }
    throw new Error('JSON の閉じ括弧が見つかりません。');
}

export function splitTopLevelElements(innerText: string): SourceElement[] {
    const ranges: Array<{ start: number; end: number }> = [];
    let start = 0;
    let squareDepth = 0;
    let braceDepth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < innerText.length; index++) {
        const character = innerText[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }
        if (character === '"') {
            inString = true;
        } else if (character === '[') {
            squareDepth++;
        } else if (character === ']') {
            squareDepth--;
        } else if (character === '{') {
            braceDepth++;
        } else if (character === '}') {
            braceDepth--;
        } else if (character === ',' && squareDepth === 0 && braceDepth === 0) {
            ranges.push({ start, end: index });
            start = index + 1;
        }
    }
    ranges.push({ start, end: innerText.length });

    const elements: SourceElement[] = [];
    for (const range of ranges) {
        const raw = innerText.slice(range.start, range.end);
        const leading = raw.search(/\S/);
        if (leading < 0) {
            continue;
        }
        const trailing = raw.length - raw.trimEnd().length;
        const elementStart = range.start + leading;
        const elementEnd = range.end - trailing;
        elements.push({
            text: innerText.slice(elementStart, elementEnd),
            start: elementStart,
            end: elementEnd
        });
    }
    return elements;
}

export function trimCutInSource(source: string, cutIndex: number, nextIn: number, nextOut: number): string {
    if (!Number.isFinite(nextIn) || !Number.isFinite(nextOut)) {
        throw new Error('クリップの時刻が不正です。');
    }
    if (nextOut - nextIn < 0.15) {
        throw new Error('クリップが短すぎます（0.15 秒未満にはできません）');
    }
    const array = locateArray(source, 'cuts');
    const elements = splitTopLevelElements(array.inner);
    const element = elements[cutIndex];
    if (!element) {
        throw new Error(`クリップ ${cutIndex + 1} が見つかりません`);
    }
    const label = `クリップ ${cutIndex + 1}`;
    const currentIn = readNumberProperty(element.text, 'in', label);
    const currentOut = readNumberProperty(element.text, 'out', label);
    let nextText = element.text;
    if (currentIn !== nextIn) {
        nextText = replaceNumberProperty(nextText, 'in', nextIn, label);
    }
    if (currentOut !== nextOut) {
        nextText = replaceNumberProperty(nextText, 'out', nextOut, label);
    }
    return replaceElement(source, array.openIndex + 1, element, nextText);
}

export function reorderCutsInSource(source: string, fromIndex: number, toIndex: number): string {
    const array = locateArray(source, 'cuts');
    const elements = splitTopLevelElements(array.inner);
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
        || fromIndex < 0 || fromIndex >= elements.length || toIndex < 0 || toIndex >= elements.length) {
        throw new Error('クリップの並べ替え位置が範囲外です。');
    }
    if (fromIndex === toIndex) {
        return source;
    }
    const reordered = elements.map(element => element.text);
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    // Keep every separator at its original slot. Only element bodies move, so commas,
    // newlines, indentation, and all text outside cuts remain byte-for-byte identical.
    let nextInner = array.inner.slice(0, elements[0].start);
    for (let index = 0; index < elements.length; index++) {
        nextInner += reordered[index];
        nextInner += index + 1 < elements.length
            ? array.inner.slice(elements[index].end, elements[index + 1].start)
            : array.inner.slice(elements[index].end);
    }
    return source.slice(0, array.openIndex + 1) + nextInner + source.slice(array.closeIndex);
}

export function moveOverlayInSource(source: string, overlayId: string, nextStart: number): string {
    if (!Number.isFinite(nextStart)) {
        throw new Error('オーバーレイの開始時刻が不正です。');
    }
    return updateOverlay(source, overlayId, element =>
        replaceNumberProperty(element, 'start', nextStart, `オーバーレイ ${overlayId}`));
}

export function resizeOverlayInSource(source: string, overlayId: string, nextDuration: number): string {
    if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
        throw new Error('オーバーレイの尺は正の値にしてください。');
    }
    return updateOverlay(source, overlayId, element =>
        replaceNumberProperty(element, 'duration', nextDuration, `オーバーレイ ${overlayId}`));
}

export function parseEdit(source: string): { cuts: EditCut[]; overlays: EditOverlay[]; fps: number; warnings: string[] } {
    const value = JSON.parse(source);
    if (!value || typeof value !== 'object') {
        throw new Error('編集データの形式を確認できません。');
    }
    const warnings: string[] = [];
    const cuts: EditCut[] = [];
    const overlays: EditOverlay[] = [];
    if (Array.isArray(value.cuts)) {
        for (let index = 0; index < value.cuts.length; index++) {
            const input = value.cuts[index]?.in;
            const output = value.cuts[index]?.out;
            if (typeof input === 'number' && Number.isFinite(input)
                && typeof output === 'number' && Number.isFinite(output) && input < output) {
                cuts.push({ in: input, out: output });
            } else {
                warnings.push(`${index + 1} 番目のクリップは時刻が不正なため表示しません。`);
            }
        }
    } else if (value.cuts !== undefined) {
        warnings.push('cuts が配列ではないためクリップを表示しません。');
    }
    if (Array.isArray(value.overlays)) {
        const seenIds = new Set<string>();
        for (let index = 0; index < value.overlays.length; index++) {
            const overlay = value.overlays[index];
            if (typeof overlay?.id === 'string' && overlay.id
                && typeof overlay.start === 'number' && Number.isFinite(overlay.start)
                && typeof overlay.duration === 'number' && Number.isFinite(overlay.duration) && overlay.duration > 0) {
                if (seenIds.has(overlay.id)) {
                    warnings.push(`オーバーレイ ${overlay.id} が重複しているため、後の要素は表示しません。`);
                    continue;
                }
                seenIds.add(overlay.id);
                overlays.push({ id: overlay.id, start: overlay.start, duration: overlay.duration });
            } else {
                warnings.push(`${index + 1} 番目のオーバーレイは識別情報または時刻が不正なため表示しません。`);
            }
        }
    } else if (value.overlays !== undefined) {
        warnings.push('overlays が配列ではないためオーバーレイを表示しません。');
    }

    let fps = 30;
    if (value.output && typeof value.output === 'object'
        && typeof value.output.fps === 'number' && Number.isFinite(value.output.fps) && value.output.fps > 0) {
        fps = value.output.fps;
    }

    return { cuts, overlays, fps, warnings };
}

function locateArray(source: string, key: 'cuts' | 'overlays'): {
    openIndex: number;
    closeIndex: number;
    inner: string;
} {
    const match = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(source);
    if (!match) {
        throw new Error(`edit.json に ${key} 配列がありません。`);
    }
    const openIndex = source.indexOf('[', match.index);
    const closeIndex = findMatchingBracket(source, openIndex);
    return { openIndex, closeIndex, inner: source.slice(openIndex + 1, closeIndex) };
}

function replaceNumberProperty(source: string, property: string, value: number, label: string): string {
    const pattern = new RegExp(`("${property}"\\s*:\\s*)${JSON_NUMBER}`, 'g');
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    return source.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
}

function readNumberProperty(source: string, property: string, label: string): number {
    const pattern = new RegExp(`"${property}"\\s*:\\s*(${JSON_NUMBER})`, 'g');
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    return Number(matches[0][1]);
}

function updateOverlay(source: string, overlayId: string, update: (element: string) => string): string {
    const array = locateArray(source, 'overlays');
    const elements = splitTopLevelElements(array.inner);
    const matches = elements.filter(element => readStringProperty(element.text, 'id') === overlayId);
    if (matches.length !== 1) {
        throw new Error(matches.length === 0
            ? `オーバーレイ ${overlayId} が見つかりません`
            : `オーバーレイ ${overlayId} が複数あります`);
    }
    const element = matches[0];
    return replaceElement(source, array.openIndex + 1, element, update(element.text));
}

function replaceElement(source: string, innerOffset: number, element: SourceElement, nextText: string): string {
    const start = innerOffset + element.start;
    const end = innerOffset + element.end;
    return source.slice(0, start) + nextText + source.slice(end);
}

function readStringProperty(source: string, property: string): string | undefined {
    const match = new RegExp(`"${property}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(source);
    if (!match) {
        return undefined;
    }
    try {
        return JSON.parse(`"${match[1]}"`);
    } catch {
        return match[1];
    }
}
