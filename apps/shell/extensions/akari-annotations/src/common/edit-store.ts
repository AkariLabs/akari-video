export interface EditCut {
    in: number;
    out: number;
    src?: string;
}

export interface EditBeat {
    id: string;
    src?: string;
    t: number;
    kind: string;
    strength: number;
    basis?: string;
}

export interface EditOverlay {
    id: string;
    start: number;
    duration: number;
    track: number;
    payload: Record<string, unknown>;
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

export function splitCutInSource(source: string, cutIndex: number, atSeconds: number): string {
    if (!Number.isFinite(atSeconds)) {
        throw new Error('分割位置の時刻が不正です。');
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
    if (atSeconds < currentIn + 0.15 || atSeconds > currentOut - 0.15) {
        throw new Error('分割位置がクリップの端に近すぎます（両側 0.15 秒以上必要です）');
    }
    const firstText = replaceNumberProperty(element.text, 'out', atSeconds, label);
    const secondText = replaceNumberProperty(element.text, 'in', atSeconds, label);
    // 区切り文字は既存要素間の生テキスト（カンマ・改行・インデント）をそのまま再利用し、整形を保つ。
    const separator = elements.length >= 2
        ? array.inner.slice(elements[0].end, elements[1].start)
        : ', ';
    return replaceElement(source, array.openIndex + 1, element, `${firstText}${separator}${secondText}`);
}

export function deleteCutInSource(source: string, cutIndex: number): { source: string; removedText: string } {
    const array = locateArray(source, 'cuts');
    const elements = splitTopLevelElements(array.inner);
    const element = elements[cutIndex];
    if (!element) {
        throw new Error(`クリップ ${cutIndex + 1} が見つかりません`);
    }
    const innerOffset = array.openIndex + 1;
    let removeStart: number;
    let removeEnd: number;
    if (elements.length === 1) {
        // 唯一の要素: 前後の区切りが存在しないため inner 全体を空にする。
        removeStart = 0;
        removeEnd = array.inner.length;
    } else if (cutIndex === elements.length - 1) {
        // 末尾要素: 直前の区切り（前要素の終端から）ごと除去する。
        removeStart = elements[cutIndex - 1].end;
        removeEnd = element.end;
    } else {
        // 後続がある要素: 自身の開始から次要素の開始（自身の後ろの区切り込み）まで除去する。
        removeStart = element.start;
        removeEnd = elements[cutIndex + 1].start;
    }
    const nextSource = source.slice(0, innerOffset + removeStart) + source.slice(innerOffset + removeEnd);
    return { source: nextSource, removedText: element.text };
}

export function insertCutInSource(source: string, cutIndex: number, elementText: string): string {
    const array = locateArray(source, 'cuts');
    const elements = splitTopLevelElements(array.inner);
    const innerOffset = array.openIndex + 1;
    const separator = elements.length >= 2
        ? array.inner.slice(elements[0].end, elements[1].start)
        : ', ';
    if (elements.length === 0) {
        return source.slice(0, innerOffset) + elementText + source.slice(innerOffset);
    }
    if (cutIndex >= elements.length) {
        // 末尾への挿入: 最後の要素の直後に区切り + 要素を追加する。
        const insertAt = innerOffset + elements[elements.length - 1].end;
        return source.slice(0, insertAt) + separator + elementText + source.slice(insertAt);
    }
    const target = elements[cutIndex];
    if (!target) {
        throw new Error(`クリップ ${cutIndex + 1} の挿入位置が不正です`);
    }
    const insertAt = innerOffset + target.start;
    return source.slice(0, insertAt) + elementText + separator + source.slice(insertAt);
}

export function moveOverlayInSource(
    source: string,
    overlayId: string,
    nextStart: number,
    nextTrack?: number | null,
    trackState?: Record<string, number | null>
): string {
    if (!Number.isFinite(nextStart)) {
        throw new Error('オーバーレイの開始時刻が不正です。');
    }
    if (nextTrack !== undefined && nextTrack !== null && (!Number.isInteger(nextTrack) || nextTrack < 0)) {
        throw new Error('オーバーレイのトラックが不正です。');
    }
    const updated = updateOverlay(source, overlayId, element =>
        replaceNumberProperty(element, 'start', nextStart, `オーバーレイ ${overlayId}`));
    if (trackState) {
        return applyOverlayTrackState(updated, trackState);
    }
    if (nextTrack === undefined) {
        return updated;
    }
    const array = locateArray(updated, 'overlays');
    const elements = splitTopLevelElements(array.inner);
    const tracks = elements.map(element => {
        const id = readStringProperty(element.text, 'id');
        const current = readOptionalNumberProperty(element.text, 'track');
        return { id, track: id === overlayId ? (nextTrack ?? 0) : normalizeTrack(current) };
    });
    const occupied = [...new Set(tracks.map(entry => entry.track))].sort((left, right) => left - right);
    const normalized = new Map(occupied.map((track, index) => [track, index]));
    let nextInner = array.inner;
    for (let index = elements.length - 1; index >= 0; index--) {
        const element = elements[index];
        const targetTrack = normalized.get(tracks[index].track) ?? 0;
        const currentTrack = readOptionalNumberProperty(element.text, 'track');
        const hasTrack = new RegExp('"track"\\s*:').test(element.text);
        const isTarget = tracks[index].id === overlayId;
        if (isTarget && nextTrack === null && targetTrack === 0) {
            if (hasTrack) {
                const nextText = removeObjectProperty(element.text, 'track');
                nextInner = nextInner.slice(0, element.start) + nextText + nextInner.slice(element.end);
            }
            continue;
        }
        if ((!isTarget && !hasTrack && targetTrack === 0) || currentTrack === targetTrack) {
            continue;
        }
        const nextText = hasTrack
            ? replacePropertyValue(element.text, 'track', targetTrack, `オーバーレイ ${tracks[index].id ?? index + 1}`)
            : appendNumberProperty(element.text, 'track', targetTrack);
        nextInner = nextInner.slice(0, element.start) + nextText + nextInner.slice(element.end);
    }
    return updated.slice(0, array.openIndex + 1) + nextInner + updated.slice(array.closeIndex);
}

export function resizeOverlayInSource(source: string, overlayId: string, nextDuration: number): string {
    if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
        throw new Error('オーバーレイの尺は正の値にしてください。');
    }
    return updateOverlay(source, overlayId, element =>
        replaceNumberProperty(element, 'duration', nextDuration, `オーバーレイ ${overlayId}`));
}

export function insertOverlayInSource(source: string, overlay: Record<string, unknown>): string {
    const id = overlay.id;
    const start = overlay.start;
    const duration = overlay.duration;
    if (typeof id !== 'string' || !id || typeof start !== 'number' || !Number.isFinite(start)
        || typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
        throw new Error('追加するオーバーレイの形式が不正です。');
    }
    const array = locateArray(source, 'overlays');
    const elements = splitTopLevelElements(array.inner);
    if (elements.some(element => readStringProperty(element.text, 'id') === id)) {
        throw new Error(`オーバーレイ ${id} は既にあります。`);
    }
    const serialized = serializeLikeExistingElement(overlay, array.inner, elements);
    const trailingStart = elements.length > 0 ? elements[elements.length - 1].end : 0;
    const trailing = array.inner.slice(trailingStart);
    let nextInner: string;
    if (elements.length === 0) {
        const leading = array.inner.slice(0, trailingStart);
        const indent = indentationBeforeClose(array.inner);
        nextInner = `${leading}${indent}${serialized}${trailing}`;
    } else {
        const separator = separatorForAppend(array.inner, elements);
        nextInner = `${array.inner.slice(0, trailingStart)}${separator}${serialized}${trailing}`;
    }
    return source.slice(0, array.openIndex + 1) + nextInner + source.slice(array.closeIndex);
}

export function removeOverlayInSource(source: string, overlayId: string): string {
    const array = locateArray(source, 'overlays');
    const elements = splitTopLevelElements(array.inner);
    const index = elements.findIndex(element => readStringProperty(element.text, 'id') === overlayId);
    if (index < 0) {
        throw new Error(`オーバーレイ ${overlayId} が見つかりません`);
    }
    let nextInner: string;
    if (elements.length === 1) {
        nextInner = array.inner.slice(elements[0].end);
    } else if (index < elements.length - 1) {
        nextInner = array.inner.slice(0, elements[index].start) + array.inner.slice(elements[index + 1].start);
    } else {
        nextInner = array.inner.slice(0, elements[index - 1].end) + array.inner.slice(elements[index].end);
    }
    return source.slice(0, array.openIndex + 1) + nextInner + source.slice(array.closeIndex);
}

export function parseEdit(source: string): {
    cuts: EditCut[];
    overlays: EditOverlay[];
    beats?: EditBeat[];
    fps: number;
    warnings: string[];
} {
    const value = JSON.parse(source);
    if (!value || typeof value !== 'object') {
        throw new Error('編集データの形式を確認できません。');
    }
    const warnings: string[] = [];
    const cuts: EditCut[] = [];
    const overlays: EditOverlay[] = [];
    const beats: EditBeat[] = [];
    const sourceIds = new Set<string>();
    if (Array.isArray(value.sources)) {
        for (const sourceEntry of value.sources) {
            if (typeof sourceEntry?.id === 'string' && sourceEntry.id) {
                sourceIds.add(sourceEntry.id);
            }
        }
    }
    const isV1 = Array.isArray(value.sources);
    const isV0 = !isV1 && value.sources === undefined
        && value.source !== null && typeof value.source === 'object';
    if (Array.isArray(value.cuts)) {
        for (let index = 0; index < value.cuts.length; index++) {
            const input = value.cuts[index]?.in;
            const output = value.cuts[index]?.out;
            if (typeof input === 'number' && Number.isFinite(input)
                && typeof output === 'number' && Number.isFinite(output) && input < output) {
                cuts.push({
                    in: input,
                    out: output,
                    ...(typeof value.cuts[index]?.src === 'string' ? { src: value.cuts[index].src } : {})
                });
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
                overlays.push({
                    id: overlay.id,
                    start: overlay.start,
                    duration: overlay.duration,
                    track: normalizeTrack(overlay.track),
                    payload: JSON.parse(JSON.stringify(overlay)) as Record<string, unknown>
                });
                if (overlay.track !== undefined && normalizeTrack(overlay.track) !== overlay.track) {
                    warnings.push(`オーバーレイ ${overlay.id} の track が不正なため track 0 に表示します。`);
                }
            } else {
                warnings.push(`${index + 1} 番目のオーバーレイは識別情報または時刻が不正なため表示しません。`);
            }
        }
    } else if (value.overlays !== undefined) {
        warnings.push('overlays が配列ではないためオーバーレイを表示しません。');
    }

    if (Array.isArray(value.beats)) {
        const seenIds = new Set<string>();
        for (let index = 0; index < value.beats.length; index++) {
            const beat = value.beats[index];
            const validRequiredFields = beat !== null && typeof beat === 'object'
                && typeof beat.id === 'string' && /^b-\d{4}$/.test(beat.id)
                && typeof beat.kind === 'string' && beat.kind.length > 0
                && typeof beat.t === 'number' && Number.isFinite(beat.t) && beat.t >= 0
                && typeof beat.strength === 'number' && Number.isFinite(beat.strength)
                && beat.strength >= 0 && beat.strength <= 1;
            if (!validRequiredFields || seenIds.has(beat.id)) {
                warnings.push(`${index + 1} 番目の見せ場マーカーは識別情報・時刻・種類・強度のいずれかが不正なため表示しません。`);
                continue;
            }
            const hasSrc = Object.prototype.hasOwnProperty.call(beat, 'src');
            if ((hasSrc && typeof beat.src !== 'string')
                || (isV0 && hasSrc)
                || (hasSrc && (!isV1 || !sourceIds.has(beat.src)))) {
                warnings.push(`見せ場マーカー ${beat.id} の src を解決できないため表示しません。`);
                continue;
            }
            seenIds.add(beat.id);
            beats.push({
                id: beat.id,
                ...(hasSrc ? { src: beat.src } : {}),
                t: beat.t,
                kind: beat.kind,
                strength: beat.strength,
                ...(typeof beat.basis === 'string' ? { basis: beat.basis } : {})
            });
        }
    } else if (value.beats !== undefined) {
        warnings.push('beats が配列ではないため見せ場マーカーを表示しません。');
    }

    let fps = 30;
    if (value.output && typeof value.output === 'object'
        && typeof value.output.fps === 'number' && Number.isFinite(value.output.fps) && value.output.fps > 0) {
        fps = value.output.fps;
    }

    return {
        cuts,
        overlays,
        ...(Array.isArray(value.beats) ? { beats } : {}),
        fps,
        warnings
    };
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

function readOptionalNumberProperty(source: string, property: string): number | undefined {
    const pattern = new RegExp(`"${property}"\\s*:\\s*(${JSON_NUMBER})`, 'g');
    const matches = [...source.matchAll(pattern)];
    return matches.length === 1 ? Number(matches[0][1]) : undefined;
}

function normalizeTrack(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function appendNumberProperty(source: string, property: string, value: number): string {
    const closeIndex = source.lastIndexOf('}');
    if (closeIndex < 0) {
        throw new Error('オーバーレイのオブジェクトを特定できません。');
    }
    const beforeClose = source.slice(0, closeIndex);
    const trailingWhitespace = beforeClose.match(/\s*$/)?.[0] ?? '';
    const body = beforeClose.slice(0, beforeClose.length - trailingWhitespace.length);
    if (!body.trim().endsWith('{')) {
        if (source.includes('\n')) {
            const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
            const propertyIndent = source.match(/(?:^|\r?\n)([ \t]+)"[^"\r\n]+"\s*:/)?.[1] ?? '  ';
            return `${body},${lineEnding}${propertyIndent}"${property}": ${JSON.stringify(value)}${trailingWhitespace}${source.slice(closeIndex)}`;
        }
        return `${body}, "${property}": ${JSON.stringify(value)}${trailingWhitespace}${source.slice(closeIndex)}`;
    }
    return `${body}"${property}": ${JSON.stringify(value)}${trailingWhitespace}${source.slice(closeIndex)}`;
}

function replacePropertyValue(source: string, property: string, value: number, label: string): string {
    const pattern = new RegExp(`("${property}"\\s*:\\s*)(?:${JSON_NUMBER}|"(?:\\\\.|[^"\\\\])*"|true|false|null)`, 'g');
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    return source.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
}

function removeObjectProperty(source: string, property: string): string {
    const openIndex = source.indexOf('{');
    const closeIndex = openIndex >= 0 ? findMatchingBracket(source, openIndex) : -1;
    if (openIndex < 0 || closeIndex < 0) {
        throw new Error('オーバーレイのオブジェクトを特定できません。');
    }
    const inner = source.slice(openIndex + 1, closeIndex);
    const elements = splitTopLevelElements(inner);
    const index = elements.findIndex(element => new RegExp(`^"${property}"\\s*:`).test(element.text));
    if (index < 0) {
        return source;
    }
    let nextInner: string;
    if (elements.length === 1) {
        nextInner = inner.slice(elements[0].end);
    } else if (index < elements.length - 1) {
        nextInner = inner.slice(0, elements[index].start) + inner.slice(elements[index + 1].start);
    } else {
        nextInner = inner.slice(0, elements[index - 1].end) + inner.slice(elements[index].end);
    }
    return source.slice(0, openIndex + 1) + nextInner + source.slice(closeIndex);
}

function applyOverlayTrackState(source: string, trackState: Record<string, number | null>): string {
    const array = locateArray(source, 'overlays');
    const elements = splitTopLevelElements(array.inner);
    let nextInner = array.inner;
    for (let index = elements.length - 1; index >= 0; index--) {
        const element = elements[index];
        const id = readStringProperty(element.text, 'id');
        if (!id || !Object.prototype.hasOwnProperty.call(trackState, id)) {
            continue;
        }
        const track = trackState[id];
        if (track !== null && (!Number.isInteger(track) || track < 0)) {
            throw new Error(`オーバーレイ ${id} のトラックが不正です。`);
        }
        const hasTrack = new RegExp('"track"\\s*:').test(element.text);
        const nextText = track === null
            ? (hasTrack ? removeObjectProperty(element.text, 'track') : element.text)
            : (hasTrack
                ? replacePropertyValue(element.text, 'track', track, `オーバーレイ ${id}`)
                : appendNumberProperty(element.text, 'track', track));
        nextInner = nextInner.slice(0, element.start) + nextText + nextInner.slice(element.end);
    }
    return source.slice(0, array.openIndex + 1) + nextInner + source.slice(array.closeIndex);
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

function separatorForAppend(inner: string, elements: SourceElement[]): string {
    if (elements.length >= 2) {
        return inner.slice(elements[elements.length - 2].end, elements[elements.length - 1].start);
    }
    const indent = inner.slice(0, elements[0].start).match(/(?:^|\r?\n)([ \t]*)$/)?.[1] ?? '';
    const lineEnding = inner.includes('\r\n') ? '\r\n' : '\n';
    return `,${lineEnding}${indent}`;
}

function serializeLikeExistingElement(value: Record<string, unknown>, inner: string, elements: SourceElement[]): string {
    const sample = elements[0]?.text;
    if (!sample || !sample.includes('\n')) {
        return JSON.stringify(value);
    }
    const indent = inner.slice(0, elements[0].start).match(/(?:^|\r?\n)([ \t]*)$/)?.[1] ?? '';
    return JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`);
}

function indentationBeforeClose(inner: string): string {
    if (!inner.includes('\n')) {
        return '';
    }
    const lineEnding = inner.includes('\r\n') ? '\r\n' : '\n';
    const closeIndent = inner.match(/(?:\r?\n)([ \t]*)$/)?.[1] ?? '';
    return `${lineEnding}${closeIndent}  `;
}
