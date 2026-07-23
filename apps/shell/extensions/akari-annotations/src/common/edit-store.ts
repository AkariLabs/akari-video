export interface EditCut {
    in: number;
    out: number;
    src?: string;
    speed?: number;
    transitionOut?: {
        type: 'dissolve' | 'fade-black' | 'fade-white';
        duration: number;
    };
    at?: number;
    track?: number;
}

export interface EditSource {
    id: string;
    path: string;
    proxy: string | null;
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

export type LayerBlendMode =
    | 'normal' | 'screen' | 'multiply' | 'add' | 'difference'
    | 'darken' | 'lighten' | 'overlay' | 'hardlight' | 'softlight';

export interface EditLayer {
    id: string;
    t: number;
    duration: number;
    kind: 'baked' | 'video';
    src: string;
    track?: number;
    preset?: string;
    transform?: { x?: number; y?: number; scale?: number; rotate?: number };
    opacity?: number;
    blend?: LayerBlendMode;
    chromaKey?: { color: string; similarity?: number; blend?: number };
}

export interface EditAudioSfx {
    id: string;
    t: number;
    duration: number;
    path: string;
    track?: number;
    gainDb?: number;
}

export interface CutTrackSegment {
    index: number;
    track: number;
    at: number;
    duration: number;
    end: number;
}

export interface EditAudioBgm {
    id: 'bgm';
    path: string;
    fadeIn?: number;
    fadeOut?: number;
    gainDb?: number;
    ducking?: boolean;
}

export const DECLARED_SFX_DURATION_SECONDS = 1;

export interface SourceElement {
    text: string;
    start: number;
    end: number;
}

const JSON_NUMBER = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
const LAYER_BLEND_MODES: readonly LayerBlendMode[] = [
    'normal', 'screen', 'multiply', 'add', 'difference',
    'darken', 'lighten', 'overlay', 'hardlight', 'softlight'
];

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

export function computeCutTrackSegments(cuts: readonly EditCut[]): CutTrackSegment[] {
    const cursorByTrack = new Map<number, number>();
    const previousIndexByTrack = new Map<number, number>();
    const segments: CutTrackSegment[] = [];
    cuts.forEach((cut, index) => {
        const track = typeof cut.track === 'number' && Number.isInteger(cut.track) && cut.track >= 0 ? cut.track : 0;
        const speed = typeof cut.speed === 'number' && cut.speed > 0 ? cut.speed : 1;
        const duration = Math.max(0, cut.out - cut.in) / speed;
        const cursor = cursorByTrack.get(track) ?? 0;
        const hasExplicitAt = typeof cut.at === 'number' && Number.isFinite(cut.at) && cut.at >= 0;
        const previousIndex = previousIndexByTrack.get(track);
        const transitionOverlap = !hasExplicitAt && previousIndex !== undefined
            ? cuts[previousIndex].transitionOut?.duration ?? 0 : 0;
        const at = hasExplicitAt ? cut.at! : cursor - transitionOverlap;
        const end = at + duration;
        cursorByTrack.set(track, end);
        previousIndexByTrack.set(track, index);
        segments.push({ index, track, at, duration, end });
    });
    return segments;
}

export function trimCutInSource(source: string, cutIndex: number, nextIn: number, nextOut: number): string {
    if (!Number.isFinite(nextIn) || !Number.isFinite(nextOut)) {
        throw new Error('クリップの時刻が不正です。');
    }
    if (nextOut - nextIn < 0.15) {
        throw new Error('クリップが短すぎます（0.15 秒未満にはできません）');
    }
    const before = readCutsForSurgery(source);
    source = freezeNextImplicitCutAt(source, cutIndex, before);
    if (before.cuts[cutIndex] && before.cuts[cutIndex].in !== nextIn) {
        const segment = before.segments[cutIndex];
        const speed = typeof before.cuts[cutIndex].speed === 'number' && before.cuts[cutIndex].speed! > 0
            ? before.cuts[cutIndex].speed! : 1;
        source = writeCutAtProperty(source, cutIndex, segment.at + (nextIn - before.cuts[cutIndex].in) / speed);
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
    let secondText = replaceNumberProperty(element.text, 'in', atSeconds, label);
    if (/"at"\s*:/.test(element.text)) {
        const before = readCutsForSurgery(source);
        const speed = typeof before.cuts[cutIndex].speed === 'number' && before.cuts[cutIndex].speed! > 0
            ? before.cuts[cutIndex].speed! : 1;
        secondText = replacePropertyValue(
            secondText, 'at', before.segments[cutIndex].at + (atSeconds - currentIn) / speed, label
        );
    }
    // 区切り文字は既存要素間の生テキスト（カンマ・改行・インデント）をそのまま再利用し、整形を保つ。
    const separator = elements.length >= 2
        ? array.inner.slice(elements[0].end, elements[1].start)
        : ', ';
    return replaceElement(source, array.openIndex + 1, element, `${firstText}${separator}${secondText}`);
}

export function deleteCutInSource(source: string, cutIndex: number): { source: string; removedText: string } {
    source = freezeNextImplicitCutAt(source, cutIndex, readCutsForSurgery(source));
    return removeArrayElementByIndex(source, 'cuts', cutIndex);
}

function removeArrayElementByIndex(source: string, key: string, index: number): { source: string; removedText: string } {
    const array = locateArray(source, key);
    const elements = splitTopLevelElements(array.inner);
    const element = elements[index];
    if (!element) {
        throw new Error(`${key} の ${index + 1} 番目の要素が見つかりません`);
    }
    const innerOffset = array.openIndex + 1;
    let removeStart: number;
    let removeEnd: number;
    if (elements.length === 1) {
        // 唯一の要素: 前後の区切りが存在しないため inner 全体を空にする。
        removeStart = 0;
        removeEnd = array.inner.length;
    } else if (index === elements.length - 1) {
        // 末尾要素: 直前の区切り（前要素の終端から）ごと除去する。
        removeStart = elements[index - 1].end;
        removeEnd = element.end;
    } else {
        // 後続がある要素: 自身の開始から次要素の開始（自身の後ろの区切り込み）まで除去する。
        removeStart = element.start;
        removeEnd = elements[index + 1].start;
    }
    const nextSource = source.slice(0, innerOffset + removeStart) + source.slice(innerOffset + removeEnd);
    return { source: nextSource, removedText: element.text };
}

export function insertCutInSource(source: string, cutIndex: number, elementText: string): string {
    return insertArrayElementByIndex(source, 'cuts', cutIndex, elementText);
}

function insertArrayElementByIndex(source: string, key: string, index: number, elementText: string): string {
    const array = locateArray(source, key);
    const elements = splitTopLevelElements(array.inner);
    const innerOffset = array.openIndex + 1;
    const separator = elements.length >= 2
        ? array.inner.slice(elements[0].end, elements[1].start)
        : ', ';
    if (elements.length === 0) {
        return source.slice(0, innerOffset) + elementText + source.slice(innerOffset);
    }
    if (index >= elements.length) {
        // 末尾への挿入: 最後の要素の直後に区切り + 要素を追加する。
        const insertAt = innerOffset + elements[elements.length - 1].end;
        return source.slice(0, insertAt) + separator + elementText + source.slice(insertAt);
    }
    const target = elements[index];
    if (!target) {
        throw new Error(`${key} の ${index + 1} 番目の挿入位置が不正です`);
    }
    const insertAt = innerOffset + target.start;
    return source.slice(0, insertAt) + elementText + separator + source.slice(insertAt);
}

export function deleteLayerByIdInSource(
    source: string, layerId: string
): { source: string; removedText: string; layerIndex: number } {
    const array = locateArray(source, 'layers');
    const elements = splitTopLevelElements(array.inner);
    const layerIndex = elements.findIndex(element => readStringProperty(element.text, 'id') === layerId);
    if (layerIndex < 0) {
        throw new Error(`レイヤー ${layerId} が見つかりません`);
    }
    return { ...removeArrayElementByIndex(source, 'layers', layerIndex), layerIndex };
}

export function deleteLayerInSource(source: string, layerIndex: number): { source: string; removedText: string } {
    return removeArrayElementByIndex(source, 'layers', layerIndex);
}

export function insertLayerInSource(source: string, layerIndex: number, elementText: string): string {
    return insertArrayElementByIndex(source, 'layers', layerIndex, elementText);
}

export function deleteSfxInSource(source: string, sfxIndex: number): { source: string; removedText: string } {
    return removeArrayElementByIndex(source, 'sfx', sfxIndex);
}

export function insertSfxInSource(source: string, sfxIndex: number, elementText: string): string {
    return insertArrayElementByIndex(source, 'sfx', sfxIndex, elementText);
}

export function moveCutInSource(
    source: string,
    cutIndex: number,
    nextAt: number,
    nextTrack?: number | null,
    trackState?: Record<string, number | null>
): string {
    if (!Number.isFinite(nextAt) || nextAt < 0) {
        throw new Error('クリップの開始時刻が不正です。');
    }
    if (nextTrack !== undefined && nextTrack !== null && (!Number.isInteger(nextTrack) || nextTrack < 0)) {
        throw new Error('クリップのトラックが不正です。');
    }
    const before = readCutsForSurgery(source);
    if (!before.cuts[cutIndex]) {
        throw new Error(`クリップ ${cutIndex + 1} が見つかりません`);
    }
    let updated = freezeNextImplicitCutAt(source, cutIndex, before);
    updated = writeCutAtProperty(updated, cutIndex, nextAt);
    if (trackState) {
        updated = applyIndexedTrackState(updated, 'cuts', trackState, 'クリップ');
    } else if (nextTrack !== undefined && normalizeTrack(before.cuts[cutIndex].track) !== (nextTrack ?? 0)) {
        updated = normalizeMovedTrack(updated, 'cuts', cutIndex, nextTrack, 'クリップ');
    }
    assertMovedCutDoesNotOverlap(updated, cutIndex);
    return updated;
}

export function setCutAtValuesInSource(
    source: string, entries: Array<{ cutIndex: number; at: number | null }>
): string {
    const updates = new Map(entries.map(entry => [entry.cutIndex, entry.at]));
    for (const [index, value] of updates) {
        if (!Number.isInteger(index) || index < 0 || (value !== null && (!Number.isFinite(value) || value < 0))) {
            throw new Error('クリップの詰め位置が不正です。');
        }
    }
    const array = locateArray(source, 'cuts');
    const elements = splitTopLevelElements(array.inner);
    const texts = elements.map((element, index) => {
        if (!updates.has(index)) {
            return element.text;
        }
        const at = updates.get(index)!;
        const hasAt = /"at"\s*:/.test(element.text);
        return at === null
            ? (hasAt ? removeObjectProperty(element.text, 'at') : element.text)
            : (hasAt
                ? replacePropertyValue(element.text, 'at', at, `クリップ ${index + 1}`)
                : appendNumberProperty(element.text, 'at', at));
    });
    return rebuildArrayElements(source, array, elements, texts);
}

export function updateLayerInSource(
    source: string,
    layerId: string,
    updates: { t?: number; duration?: number; track?: number }
): string {
    return updateArrayElementById(source, 'layers', layerId, 'レイヤー', element => {
        let next = element;
        for (const property of ['t', 'duration', 'track'] as const) {
            const value = updates[property];
            if (value === undefined) {
                continue;
            }
            const hasProperty = new RegExp(`"${property}"\\s*:`).test(next);
            next = hasProperty
                ? replacePropertyValue(next, property, value, `レイヤー ${layerId}`)
                : appendNumberProperty(next, property, value);
        }
        return next;
    });
}

export function moveLayerInSource(
    source: string,
    layerId: string,
    nextT: number,
    nextDuration: number,
    nextTrack?: number,
    trackState?: Record<string, number | null>
): string {
    if (!Number.isFinite(nextT) || nextT < 0 || !Number.isFinite(nextDuration) || nextDuration < 0.15) {
        throw new Error('レイヤーの時刻または尺が不正です。');
    }
    if (nextTrack !== undefined && (!Number.isInteger(nextTrack) || nextTrack < 0)) {
        throw new Error('レイヤーのトラックが不正です。');
    }
    const beforeArray = locateArray(source, 'layers');
    const beforeElements = splitTopLevelElements(beforeArray.inner);
    const beforeIndex = beforeElements.findIndex(element => readStringProperty(element.text, 'id') === layerId);
    if (beforeIndex < 0) {
        throw new Error(`レイヤー ${layerId} が見つかりません`);
    }
    const currentTrack = normalizeTrack(readOptionalNumberProperty(beforeElements[beforeIndex].text, 'track'));
    const updated = updateLayerInSource(source, layerId, { t: nextT, duration: nextDuration });
    if (trackState) {
        return applyIdTrackState(updated, 'layers', trackState, 'レイヤー');
    }
    if (nextTrack === undefined || nextTrack === currentTrack) {
        return updated;
    }
    const array = locateArray(updated, 'layers');
    const elements = splitTopLevelElements(array.inner);
    const index = elements.findIndex(element => readStringProperty(element.text, 'id') === layerId);
    return normalizeMovedTrack(updated, 'layers', index, nextTrack, 'レイヤー');
}

export function moveSfxInSource(
    source: string,
    sfxIndex: number,
    nextT: number,
    nextTrack?: number,
    trackState?: Record<string, number | null>
): string {
    if (!Number.isFinite(nextT) || nextT < 0) {
        throw new Error('SE の開始時刻が不正です。');
    }
    if (nextTrack !== undefined && (!Number.isInteger(nextTrack) || nextTrack < 0)) {
        throw new Error('SE のトラックが不正です。');
    }
    const beforeArray = locateArray(source, 'sfx');
    const beforeElements = splitTopLevelElements(beforeArray.inner);
    const currentElement = beforeElements[sfxIndex];
    if (!currentElement) {
        throw new Error(`SE ${sfxIndex + 1} が見つかりません`);
    }
    const currentTrack = normalizeTrack(readOptionalNumberProperty(currentElement.text, 'track'));
    const updated = updateArrayElementByIndex(source, 'sfx', sfxIndex, 'SE', element => {
        const hasT = /"t"\s*:/.test(element);
        return hasT ? replacePropertyValue(element, 't', nextT, `SE ${sfxIndex + 1}`) : appendNumberProperty(element, 't', nextT);
    });
    if (trackState) {
        return applyIndexedTrackState(updated, 'sfx', trackState, 'SE');
    }
    if (nextTrack === undefined || nextTrack === currentTrack) {
        return updated;
    }
    return normalizeMovedTrack(updated, 'sfx', sfxIndex, nextTrack, 'SE');
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
    sources?: EditSource[];
    overlays: EditOverlay[];
    beats?: EditBeat[];
    layers: EditLayer[];
    audioSfx: EditAudioSfx[];
    audioBgm?: EditAudioBgm;
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
    const layers: EditLayer[] = [];
    const audioSfx: EditAudioSfx[] = [];
    let audioBgm: EditAudioBgm | undefined;
    const sources: EditSource[] = [];
    const sourceIds = new Set<string>();
    if (Array.isArray(value.sources)) {
        for (const sourceEntry of value.sources) {
            if (typeof sourceEntry?.id === 'string' && sourceEntry.id) {
                sourceIds.add(sourceEntry.id);
            }
            if (typeof sourceEntry?.id === 'string' && sourceEntry.id
                && typeof sourceEntry.path === 'string' && sourceEntry.path
                && (sourceEntry.proxy === null || typeof sourceEntry.proxy === 'string')) {
                sources.push({
                    id: sourceEntry.id,
                    path: sourceEntry.path,
                    proxy: sourceEntry.proxy
                });
            }
        }
    }
    const isV1 = Array.isArray(value.sources);
    const isV0 = !isV1 && value.sources === undefined
        && value.source !== null && typeof value.source === 'object';
    if (Array.isArray(value.cuts)) {
        for (let index = 0; index < value.cuts.length; index++) {
            const rawCut = value.cuts[index];
            const input = rawCut?.in;
            const output = rawCut?.out;
            const hasSrc = rawCut !== null && typeof rawCut === 'object'
                && Object.prototype.hasOwnProperty.call(rawCut, 'src');
            if ((isV1 && !hasSrc)
                || (hasSrc && typeof rawCut.src !== 'string')
                || (isV0 && hasSrc)
                || (hasSrc && (!isV1 || !sourceIds.has(rawCut.src)))) {
                warnings.push(`${index + 1} 番目のクリップの src を解決できないため表示しません。`);
                continue;
            }
            if (typeof input === 'number' && Number.isFinite(input)
                && typeof output === 'number' && Number.isFinite(output) && input < output) {
                let speed: number | undefined;
                if (rawCut.speed !== undefined) {
                    if (typeof rawCut.speed === 'number' && Number.isFinite(rawCut.speed) && rawCut.speed > 0) {
                        speed = rawCut.speed;
                    } else {
                        warnings.push(`${index + 1} 番目のクリップの speed が不正なため 1 として扱います。`);
                    }
                }
                let transitionOut: EditCut['transitionOut'];
                if (rawCut.transition_out !== undefined && rawCut.transition_out !== null) {
                    const transition = rawCut.transition_out;
                    const validType = transition?.type === 'dissolve'
                        || transition?.type === 'fade-black'
                        || transition?.type === 'fade-white';
                    const validDuration = typeof transition?.duration === 'number'
                        && Number.isFinite(transition.duration) && transition.duration > 0;
                    if (transition && typeof transition === 'object' && !Array.isArray(transition)
                        && validType && validDuration) {
                        transitionOut = { type: transition.type, duration: transition.duration };
                    } else {
                        warnings.push(`${index + 1} 番目のクリップの transition_out が不正なため無視します。`);
                    }
                }
                let at: number | undefined;
                if (rawCut.at !== undefined) {
                    if (typeof rawCut.at === 'number' && Number.isFinite(rawCut.at) && rawCut.at >= 0) {
                        at = rawCut.at;
                    } else {
                        warnings.push(`${index + 1} 番目のクリップの at が不正なため無視します。`);
                    }
                }
                const track = normalizeTrack(rawCut.track);
                if (rawCut.track !== undefined && track !== rawCut.track) {
                    warnings.push(`${index + 1} 番目のクリップの track が不正なため track 0 に表示します。`);
                }
                cuts.push({
                    in: input,
                    out: output,
                    ...(typeof rawCut.src === 'string' ? { src: rawCut.src } : {}),
                    ...(speed !== undefined ? { speed } : {}),
                    ...(transitionOut ? { transitionOut } : {}),
                    ...(at !== undefined ? { at } : {}),
                    ...(rawCut.track !== undefined ? { track } : {})
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

    if (Array.isArray(value.layers)) {
        const seenIds = new Set<string>();
        for (let index = 0; index < value.layers.length; index++) {
            const layer = value.layers[index];
            const valid = layer !== null && typeof layer === 'object'
                && typeof layer.id === 'string' && layer.id.length > 0
                && typeof layer.t === 'number' && Number.isFinite(layer.t) && layer.t >= 0
                && typeof layer.duration === 'number' && Number.isFinite(layer.duration) && layer.duration > 0
                && (layer.kind === 'baked' || layer.kind === 'video')
                && typeof layer.src === 'string' && layer.src.length > 0;
            if (!valid) {
                warnings.push(`${index + 1} 番目のレイヤーは識別情報・時刻・種類のいずれかが不正なため表示しません。`);
                continue;
            }
            if (seenIds.has(layer.id)) {
                warnings.push(`レイヤー ${layer.id} が重複しているため、後の要素は表示しません。`);
                continue;
            }
            seenIds.add(layer.id);
            const track = normalizeTrack(layer.track);
            if (layer.track !== undefined && track !== layer.track) {
                warnings.push(`${index + 1} 番目のレイヤーの track が不正なため track 0 に表示します。`);
            }
            let preset: string | undefined;
            if (layer.preset !== undefined && layer.preset !== null) {
                if (typeof layer.preset === 'string') {
                    preset = layer.preset;
                } else {
                    warnings.push(`レイヤー ${layer.id} の preset が不正なため無視します。`);
                }
            }
            let transform: EditLayer['transform'];
            if (layer.transform !== undefined && layer.transform !== null) {
                const rawTransform = layer.transform;
                const validTransform = typeof rawTransform === 'object' && !Array.isArray(rawTransform)
                    && (rawTransform.x === undefined
                        || (typeof rawTransform.x === 'number' && Number.isFinite(rawTransform.x)))
                    && (rawTransform.y === undefined
                        || (typeof rawTransform.y === 'number' && Number.isFinite(rawTransform.y)))
                    && (rawTransform.scale === undefined
                        || (typeof rawTransform.scale === 'number'
                            && Number.isFinite(rawTransform.scale) && rawTransform.scale > 0))
                    && (rawTransform.rotate === undefined
                        || (typeof rawTransform.rotate === 'number' && Number.isFinite(rawTransform.rotate)));
                if (validTransform) {
                    transform = {
                        ...(rawTransform.x !== undefined ? { x: rawTransform.x } : {}),
                        ...(rawTransform.y !== undefined ? { y: rawTransform.y } : {}),
                        ...(rawTransform.scale !== undefined ? { scale: rawTransform.scale } : {}),
                        ...(rawTransform.rotate !== undefined ? { rotate: rawTransform.rotate } : {})
                    };
                } else {
                    warnings.push(`レイヤー ${layer.id} の transform が不正なため無視します。`);
                }
            }
            let opacity: number | undefined;
            if (layer.opacity !== undefined && layer.opacity !== null) {
                if (typeof layer.opacity === 'number' && Number.isFinite(layer.opacity)
                    && layer.opacity >= 0 && layer.opacity <= 1) {
                    opacity = layer.opacity;
                } else {
                    warnings.push(`レイヤー ${layer.id} の opacity が不正なため無視します。`);
                }
            }
            let blend: LayerBlendMode | undefined;
            if (layer.blend !== undefined && layer.blend !== null) {
                if (typeof layer.blend === 'string'
                    && LAYER_BLEND_MODES.includes(layer.blend as LayerBlendMode)) {
                    blend = layer.blend as LayerBlendMode;
                } else {
                    warnings.push(`レイヤー ${layer.id} の blend が不正なため無視します。`);
                }
            }
            let chromaKey: EditLayer['chromaKey'];
            if (layer.chroma_key !== undefined && layer.chroma_key !== null) {
                const rawChromaKey = layer.chroma_key;
                const validChromaKey = typeof rawChromaKey === 'object' && !Array.isArray(rawChromaKey)
                    && typeof rawChromaKey.color === 'string' && rawChromaKey.color.length > 0
                    && (rawChromaKey.similarity === undefined
                        || (typeof rawChromaKey.similarity === 'number' && Number.isFinite(rawChromaKey.similarity)
                            && rawChromaKey.similarity >= 0 && rawChromaKey.similarity <= 1))
                    && (rawChromaKey.blend === undefined
                        || (typeof rawChromaKey.blend === 'number' && Number.isFinite(rawChromaKey.blend)
                            && rawChromaKey.blend >= 0 && rawChromaKey.blend <= 1));
                if (validChromaKey) {
                    chromaKey = {
                        color: rawChromaKey.color,
                        ...(rawChromaKey.similarity !== undefined ? { similarity: rawChromaKey.similarity } : {}),
                        ...(rawChromaKey.blend !== undefined ? { blend: rawChromaKey.blend } : {})
                    };
                } else {
                    warnings.push(`レイヤー ${layer.id} の chroma_key が不正なため無視します。`);
                }
            }
            layers.push({
                id: layer.id,
                t: layer.t,
                duration: layer.duration,
                kind: layer.kind,
                src: layer.src,
                ...(layer.track !== undefined ? { track } : {}),
                ...(preset !== undefined ? { preset } : {}),
                ...(transform !== undefined ? { transform } : {}),
                ...(opacity !== undefined ? { opacity } : {}),
                ...(blend !== undefined ? { blend } : {}),
                ...(chromaKey !== undefined ? { chromaKey } : {})
            });
        }
    } else if (value.layers !== undefined) {
        warnings.push('layers が配列ではないためレイヤーを表示しません。');
    }

    if (value.audio !== undefined && (value.audio === null || typeof value.audio !== 'object' || Array.isArray(value.audio))) {
        warnings.push('audio が object ではないため SE/BGM を表示しません。');
    } else if (value.audio && typeof value.audio === 'object') {
        if (Array.isArray(value.audio.sfx)) {
            for (let index = 0; index < value.audio.sfx.length; index++) {
                const sfx = value.audio.sfx[index];
                if (sfx === null || typeof sfx !== 'object'
                    || typeof sfx.path !== 'string' || sfx.path.length === 0
                    || typeof sfx.t !== 'number' || !Number.isFinite(sfx.t) || sfx.t < 0) {
                    warnings.push(`${index + 1} 番目の SE は時刻または素材が不正なため表示しません。`);
                    continue;
                }
                let gainDb: number | undefined;
                if (sfx.gain_db !== undefined && sfx.gain_db !== null) {
                    if (typeof sfx.gain_db === 'number' && Number.isFinite(sfx.gain_db)
                        && sfx.gain_db >= -60 && sfx.gain_db <= 12) {
                        gainDb = sfx.gain_db;
                    } else {
                        warnings.push(`${index + 1} 番目の SE の gain_db が不正なため無視します。`);
                    }
                }
                audioSfx.push({
                    id: `sfx-${index}`,
                    t: sfx.t,
                    duration: DECLARED_SFX_DURATION_SECONDS,
                    path: sfx.path,
                    ...(sfx.track !== undefined ? { track: normalizeTrack(sfx.track) } : {}),
                    ...(gainDb !== undefined ? { gainDb } : {})
                });
                if (sfx.track !== undefined && normalizeTrack(sfx.track) !== sfx.track) {
                    warnings.push(`${index + 1} 番目の SE の track が不正なため track 0 に表示します。`);
                }
            }
        }
        const bgm = value.audio.bgm;
        if (bgm !== undefined && bgm !== null) {
            if (typeof bgm === 'object' && !Array.isArray(bgm)
                && typeof bgm.path === 'string' && bgm.path.length > 0) {
                let gainDb: number | undefined;
                if (bgm.gain_db !== undefined && bgm.gain_db !== null) {
                    if (typeof bgm.gain_db === 'number' && Number.isFinite(bgm.gain_db)
                        && bgm.gain_db >= -60 && bgm.gain_db <= 12) {
                        gainDb = bgm.gain_db;
                    } else {
                        warnings.push('bgm の gain_db が不正なため無視します。');
                    }
                }
                let ducking: boolean | undefined;
                if (bgm.ducking !== undefined && bgm.ducking !== null) {
                    if (typeof bgm.ducking === 'boolean') {
                        ducking = bgm.ducking;
                    } else {
                        warnings.push('bgm の ducking が不正なため無視します。');
                    }
                }
                audioBgm = {
                    id: 'bgm',
                    path: bgm.path,
                    ...(typeof bgm.fadeIn === 'number' && Number.isFinite(bgm.fadeIn) && bgm.fadeIn >= 0
                        ? { fadeIn: bgm.fadeIn } : {}),
                    ...(typeof bgm.fadeOut === 'number' && Number.isFinite(bgm.fadeOut) && bgm.fadeOut >= 0
                        ? { fadeOut: bgm.fadeOut } : {}),
                    ...(gainDb !== undefined ? { gainDb } : {}),
                    ...(ducking !== undefined ? { ducking } : {})
                };
            } else {
                warnings.push('bgm の path が不正なため表示しません。');
            }
        }
    }

    let fps = 30;
    if (value.output && typeof value.output === 'object'
        && typeof value.output.fps === 'number' && Number.isFinite(value.output.fps) && value.output.fps > 0) {
        fps = value.output.fps;
    }

    return {
        cuts,
        ...(isV1 ? { sources } : {}),
        overlays,
        ...(Array.isArray(value.beats) ? { beats } : {}),
        layers,
        audioSfx,
        ...(audioBgm ? { audioBgm } : {}),
        fps,
        warnings
    };
}

function locateArray(source: string, key: string): {
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

function readCutsForSurgery(source: string): { cuts: EditCut[]; segments: CutTrackSegment[]; rawCuts: unknown[] } {
    const value = JSON.parse(source) as { cuts?: unknown[] };
    if (!Array.isArray(value.cuts)) {
        throw new Error('edit.json に cuts 配列がありません。');
    }
    const cuts = value.cuts.map((raw, index) => {
        if (!raw || typeof raw !== 'object') {
            throw new Error(`クリップ ${index + 1} の形式が不正です。`);
        }
        const cut = raw as Record<string, unknown>;
        if (typeof cut.in !== 'number' || !Number.isFinite(cut.in)
            || typeof cut.out !== 'number' || !Number.isFinite(cut.out) || cut.out <= cut.in) {
            throw new Error(`クリップ ${index + 1} の時刻が不正です。`);
        }
        return {
            in: cut.in,
            out: cut.out,
            ...(typeof cut.speed === 'number' ? { speed: cut.speed } : {}),
            ...(typeof cut.at === 'number' ? { at: cut.at } : {}),
            ...(typeof cut.track === 'number' ? { track: cut.track } : {}),
            ...(cut.transition_out && typeof cut.transition_out === 'object'
                ? { transitionOut: cut.transition_out as EditCut['transitionOut'] } : {})
        } satisfies EditCut;
    });
    return { cuts, segments: computeCutTrackSegments(cuts), rawCuts: value.cuts };
}

function freezeNextImplicitCutAt(
    source: string,
    cutIndex: number,
    before: ReturnType<typeof readCutsForSurgery>
): string {
    const target = before.segments[cutIndex];
    if (!target) {
        throw new Error(`クリップ ${cutIndex + 1} が見つかりません`);
    }
    for (let index = cutIndex + 1; index < before.cuts.length; index++) {
        if (before.segments[index].track !== target.track) {
            continue;
        }
        const raw = before.rawCuts[index] as Record<string, unknown>;
        return Object.prototype.hasOwnProperty.call(raw, 'at')
            ? source : writeCutAtProperty(source, index, before.segments[index].at);
    }
    return source;
}

function writeCutAtProperty(source: string, cutIndex: number, at: number): string {
    return updateArrayElementByIndex(source, 'cuts', cutIndex, 'クリップ', element =>
        /"at"\s*:/.test(element)
            ? replacePropertyValue(element, 'at', at, `クリップ ${cutIndex + 1}`)
            : appendNumberProperty(element, 'at', at));
}

function updateArrayElementByIndex(
    source: string,
    key: string,
    index: number,
    label: string,
    update: (element: string) => string
): string {
    const array = locateArray(source, key);
    const elements = splitTopLevelElements(array.inner);
    const element = elements[index];
    if (!element) {
        throw new Error(`${label} ${index + 1} が見つかりません`);
    }
    return replaceElement(source, array.openIndex + 1, element, update(element.text));
}

function updateArrayElementById(
    source: string,
    key: string,
    id: string,
    label: string,
    update: (element: string) => string
): string {
    const array = locateArray(source, key);
    const elements = splitTopLevelElements(array.inner);
    const matches = elements.filter(element => readStringProperty(element.text, 'id') === id);
    if (matches.length !== 1) {
        throw new Error(matches.length === 0 ? `${label} ${id} が見つかりません` : `${label} ${id} が複数あります`);
    }
    return replaceElement(source, array.openIndex + 1, matches[0], update(matches[0].text));
}

function rebuildArrayElements(
    source: string,
    array: ReturnType<typeof locateArray>,
    elements: SourceElement[],
    texts: string[]
): string {
    if (elements.length === 0) {
        return source;
    }
    let nextInner = array.inner.slice(0, elements[0].start);
    for (let index = 0; index < elements.length; index++) {
        nextInner += texts[index];
        nextInner += index + 1 < elements.length
            ? array.inner.slice(elements[index].end, elements[index + 1].start)
            : array.inner.slice(elements[index].end);
    }
    return source.slice(0, array.openIndex + 1) + nextInner + source.slice(array.closeIndex);
}

function applyIndexedTrackState(
    source: string,
    key: string,
    trackState: Record<string, number | null>,
    label: string
): string {
    const array = locateArray(source, key);
    const elements = splitTopLevelElements(array.inner);
    const texts = elements.map((element, index) => {
        if (!Object.prototype.hasOwnProperty.call(trackState, String(index))) {
            return element.text;
        }
        return writeTrackProperty(element.text, trackState[String(index)], `${label} ${index + 1}`);
    });
    return rebuildArrayElements(source, array, elements, texts);
}

function applyIdTrackState(
    source: string,
    key: string,
    trackState: Record<string, number | null>,
    label: string
): string {
    const array = locateArray(source, key);
    const elements = splitTopLevelElements(array.inner);
    const texts = elements.map((element, index) => {
        const id = readStringProperty(element.text, 'id');
        if (!id || !Object.prototype.hasOwnProperty.call(trackState, id)) {
            return element.text;
        }
        return writeTrackProperty(element.text, trackState[id], `${label} ${id || index + 1}`);
    });
    return rebuildArrayElements(source, array, elements, texts);
}

function normalizeMovedTrack(
    source: string,
    key: string,
    targetIndex: number,
    nextTrack: number | null,
    label: string
): string {
    const array = locateArray(source, key);
    const elements = splitTopLevelElements(array.inner);
    if (!elements[targetIndex]) {
        throw new Error(`${label} ${targetIndex + 1} が見つかりません`);
    }
    const tracks = elements.map((element, index) => index === targetIndex
        ? (nextTrack ?? 0) : normalizeTrack(readOptionalNumberProperty(element.text, 'track')));
    const occupied = [...new Set(tracks)].sort((left, right) => left - right);
    const normalized = new Map(occupied.map((track, index) => [track, index]));
    const texts = elements.map((element, index) => {
        const targetTrack = normalized.get(tracks[index]) ?? 0;
        const isTarget = index === targetIndex;
        if (isTarget && nextTrack === null && targetTrack === 0) {
            return writeTrackProperty(element.text, null, `${label} ${index + 1}`);
        }
        const hasTrack = /"track"\s*:/.test(element.text);
        const currentTrack = readOptionalNumberProperty(element.text, 'track');
        if ((!isTarget && !hasTrack && targetTrack === 0) || currentTrack === targetTrack) {
            return element.text;
        }
        return writeTrackProperty(element.text, targetTrack, `${label} ${index + 1}`);
    });
    return rebuildArrayElements(source, array, elements, texts);
}

function writeTrackProperty(source: string, track: number | null, label: string): string {
    if (track !== null && (!Number.isInteger(track) || track < 0)) {
        throw new Error(`${label} のトラックが不正です。`);
    }
    const hasTrack = /"track"\s*:/.test(source);
    if (track === null) {
        return hasTrack ? removeObjectProperty(source, 'track') : source;
    }
    return hasTrack
        ? replacePropertyValue(source, 'track', track, label)
        : appendNumberProperty(source, 'track', track);
}

function assertMovedCutDoesNotOverlap(source: string, cutIndex: number): void {
    const { segments } = readCutsForSurgery(source);
    const moved = segments[cutIndex];
    if (!moved) {
        throw new Error(`クリップ ${cutIndex + 1} が見つかりません`);
    }
    if (segments.some(segment => segment.index !== cutIndex && segment.track === moved.track
        && moved.at < segment.end && segment.at < moved.end)) {
        throw new Error('同じクリップトラック内で区間が重なっています。');
    }
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
