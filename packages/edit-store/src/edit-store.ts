import { isTransitionType, type ReadableTransitionType, type TransitionType } from './transition-vocabulary';

export interface EditCut {
    in: number;
    out: number;
    src?: string;
    transform?: { x?: number; y?: number; scale?: number; rotate?: number };
    opacity?: number;
    speed?: number;
    transitionOut?: {
        type: ReadableTransitionType;
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
    in?: number;
    out?: number;
}

export interface EditAudioNarrationProvenance {
    provider: string;
    engine?: string;
    voice?: string;
    credit?: string;
    generated_at?: string;
    [key: string]: unknown;
}

/** audio.narration[] の legacy 投影形。 */
export interface EditAudioNarration {
    id: string;
    t: number;
    path: string;
    track?: number;
    gainDb?: number;
    in?: number;
    out?: number;
    script?: string;
    reading?: string;
    provenance?: EditAudioNarrationProvenance;
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
    track?: number;
    fadeIn?: number;
    fadeOut?: number;
    gainDb?: number;
    ducking?: boolean;
}

export type TimelineTrackKind = 'cuts' | 'layers' | 'overlays' | 'captions' | 'audio';

export interface EditTimelineTrack {
    id: string;
    kind: TimelineTrackKind;
    ref?: number;
    label?: string;
    muted?: boolean;
    hidden?: boolean;
    locked?: boolean;
}

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

export function trimCutInSource(
    source: string,
    cutIndex: number,
    nextIn: number,
    nextOut: number,
    maxOutSeconds?: number
): string {
    if (maxOutSeconds !== undefined) {
        if (!Number.isFinite(maxOutSeconds) || maxOutSeconds < 0) {
            throw new Error('クリップの実尺が不正です。');
        }
        nextOut = Math.min(nextOut, maxOutSeconds);
    }
    if (!Number.isFinite(nextIn) || !Number.isFinite(nextOut) || nextIn < 0 || nextOut < 0) {
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
        const nextAt = segment.at + (nextIn - before.cuts[cutIndex].in) / speed;
        if (nextAt < 0) {
            throw new Error('クリップの出力位置は 0 以上にしてください。');
        }
        source = writeCutAtProperty(source, cutIndex, nextAt);
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

/**
 * ソーストリマーの slip 操作: out−in（尺）と t（タイムライン位置）を固定したまま
 * in/out を同量シフトする。trimCutInSource と異なり尺そのものは変化しないため、
 * at の再計算・freezeNextImplicitCutAt（暗黙 at の凍結）は不要
 * （後続クリップのタイムライン位置に一切影響しない）。
 */
export function slipCutInSource(
    source: string,
    cutIndex: number,
    nextIn: number,
    nextOut: number,
    maxOutSeconds?: number
): string {
    if (maxOutSeconds !== undefined) {
        if (!Number.isFinite(maxOutSeconds) || maxOutSeconds < 0) {
            throw new Error('クリップの実尺が不正です。');
        }
        if (nextOut > maxOutSeconds) {
            throw new Error('クリップの out が実尺を超えています。');
        }
    }
    if (!Number.isFinite(nextIn) || !Number.isFinite(nextOut) || nextIn < 0 || nextOut < 0) {
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

export function setCutSpeedInSource(source: string, cutIndex: number, speed: number | null): string {
    if (speed !== null && (!Number.isFinite(speed) || speed <= 0)) {
        throw new Error('speed は正の数で指定してください。');
    }
    return updateArrayElementByIndex(source, 'cuts', cutIndex, 'クリップ', element => {
        const hasSpeed = hasTopLevelProperty(element, 'speed');
        if (speed === null) {
            return hasSpeed ? removeObjectProperty(element, 'speed') : element;
        }
        return hasSpeed
            ? replacePropertyValue(element, 'speed', speed, `クリップ ${cutIndex + 1}`)
            : appendNumberProperty(element, 'speed', speed);
    });
}

export function updateCutTransformInSource(
    source: string,
    cutIndex: number,
    updates: { x?: number | null; y?: number | null; scale?: number | null; rotate?: number | null }
): string {
    if (updates.x === undefined && updates.y === undefined
        && updates.scale === undefined && updates.rotate === undefined) {
        throw new Error('変更する transform フィールドを指定してください。');
    }
    for (const property of ['x', 'y', 'rotate'] as const) {
        const value = updates[property];
        if (value !== undefined && value !== null && !Number.isFinite(value)) {
            throw new Error(`transform.${property} は有限数で指定してください。`);
        }
    }
    if (updates.scale !== undefined && updates.scale !== null
        && (!Number.isFinite(updates.scale) || updates.scale <= 0)) {
        throw new Error('transform.scale は正の数で指定してください。');
    }
    return updateArrayElementByIndex(source, 'cuts', cutIndex, 'クリップ', element => {
        const hasTransform = hasTopLevelProperty(element, 'transform');
        if (!hasTransform) {
            const transform = Object.fromEntries(
                Object.entries(updates).filter((entry): entry is [string, number] =>
                    entry[1] !== undefined && entry[1] !== null)
            );
            return Object.keys(transform).length > 0
                ? appendJsonProperty(element, 'transform', transform)
                : element;
        }
        const located = locateTopLevelObjectProperty(element, 'transform');
        let transform = located.text;
        for (const property of ['x', 'y', 'scale', 'rotate'] as const) {
            const value = updates[property];
            if (value === undefined) {
                continue;
            }
            const hasProperty = hasTopLevelProperty(transform, property);
            transform = value === null
                ? (hasProperty ? removeObjectProperty(transform, property) : transform)
                : (hasProperty
                    ? replacePropertyValue(transform, property, value, `クリップ ${cutIndex + 1} の transform`)
                    : appendNumberProperty(transform, property, value));
        }
        if (Object.keys(JSON.parse(transform) as Record<string, unknown>).length === 0) {
            return removeObjectProperty(element, 'transform');
        }
        return element.slice(0, located.start) + transform + element.slice(located.end);
    });
}

export function updateCutOpacityInSource(source: string, cutIndex: number, opacity: number | null): string {
    if (opacity !== null && (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)) {
        throw new Error('opacity は 0〜1 の範囲で指定してください。');
    }
    return updateArrayElementByIndex(source, 'cuts', cutIndex, 'クリップ', element => {
        const hasOpacity = hasTopLevelProperty(element, 'opacity');
        if (opacity === null) {
            return hasOpacity ? removeObjectProperty(element, 'opacity') : element;
        }
        return hasOpacity
            ? replaceTopLevelPropertyValue(element, 'opacity', opacity, `クリップ ${cutIndex + 1}`)
            : appendNumberProperty(element, 'opacity', opacity);
    });
}

export function setCutTransitionOutInSource(
    source: string,
    cutIndex: number,
    transitionOut: {
        type: TransitionType;
        duration: number;
    } | null
): string {
    if (transitionOut !== null) {
        if (!isTransitionType(transitionOut.type)) {
            throw new Error('トランジションの種別が不正です。');
        }
        if (!Number.isFinite(transitionOut.duration) || transitionOut.duration <= 0) {
            throw new Error('トランジションの尺は正の数で指定してください。');
        }
    }
    return updateArrayElementByIndex(source, 'cuts', cutIndex, 'クリップ', element => {
        const hasTransitionOut = hasTopLevelProperty(element, 'transition_out');
        if (transitionOut === null) {
            return hasTransitionOut ? removeObjectProperty(element, 'transition_out') : element;
        }
        const value = { type: transitionOut.type, duration: transitionOut.duration };
        if (!hasTransitionOut) {
            return appendJsonProperty(element, 'transition_out', value);
        }
        // schema は transition_out に明示的な null（未設定の別表記）も許容しており、
        // 実データにも存在する。その場合は object ではないため locateTopLevelObjectProperty が
        // 例外を投げる — 一旦除去してから追記する（結果は object 直書きと同じ）。
        try {
            const located = locateTopLevelObjectProperty(element, 'transition_out');
            return element.slice(0, located.start) + JSON.stringify(value) + element.slice(located.end);
        } catch {
            return appendJsonProperty(removeObjectProperty(element, 'transition_out'), 'transition_out', value);
        }
    });
}

export interface RemoveV2TransitionOutWithHandleRetractInput {
    itemId: string;
    retractFrames: number;
    fps: number;
}

/**
 * v0.1.20 の自動のりしろ debris を、transition_out の削除と同じ 1 回の
 * byte-preserving 手術で回収する。新意味論の通常操作では trim を一切変更しない。
 */
export function removeV2TransitionOutWithHandleRetractInSource(
    source: string,
    input: RemoveV2TransitionOutWithHandleRetractInput
): string {
    const raw = JSON.parse(source) as { version?: unknown };
    if (raw.version !== 2) {
        throw new Error('v2 へ変換してから編集してください。');
    }
    if (!input.itemId) {
        throw new Error('トランジション対象のアイテム id が空です。');
    }
    if (!Number.isInteger(input.retractFrames) || input.retractFrames <= 0
        || !Number.isFinite(input.fps) || input.fps <= 0) {
        throw new Error('のりしろの復元量が不正です。');
    }

    const tracks = locateArray(source, 'tracks');
    const trackElements = splitTopLevelElements(tracks.inner);
    const matches: Array<{
        track: SourceElement;
        items: ReturnType<typeof locateArray>;
        item: SourceElement;
    }> = [];
    for (const track of trackElements) {
        let items: ReturnType<typeof locateArray>;
        try {
            items = locateArray(track.text, 'items');
        } catch {
            continue;
        }
        const item = splitTopLevelElements(items.inner)
            .find(candidate => readStringProperty(candidate.text, 'id') === input.itemId);
        if (item) matches.push({ track, items, item });
    }
    if (matches.length !== 1) {
        throw new Error(matches.length === 0
            ? `アイテム ${input.itemId} が見つかりません`
            : `アイテム ${input.itemId} が複数あります`);
    }

    const match = matches[0];
    const label = `アイテム ${input.itemId}`;
    const durationFrames = readNumberProperty(match.item.text, 'duration', label);
    if (!Number.isInteger(durationFrames) || durationFrames < input.retractFrames) {
        throw new Error(`${label} の duration を安全に復元できません。`);
    }
    const mediaSource = locateTopLevelObjectProperty(match.item.text, 'source');
    if (readStringProperty(mediaSource.text, 'kind') !== 'media') {
        throw new Error(`${label} は映像素材ではありません。`);
    }
    const sourceIn = readNumberProperty(mediaSource.text, 'in', label);
    const sourceOut = readNumberProperty(mediaSource.text, 'out', label);
    const speed = (sourceOut - sourceIn) / (durationFrames / input.fps);
    if (!Number.isFinite(speed) || speed <= 0) {
        throw new Error(`${label} の speed を安全に復元できません。`);
    }
    const nextOut = sourceOut - (input.retractFrames / input.fps) * speed;
    if (!Number.isFinite(nextOut) || nextOut < sourceIn) {
        throw new Error(`${label} の out を安全に復元できません。`);
    }
    let nextMediaSource = removeObjectProperty(mediaSource.text, 'transition_out');
    nextMediaSource = replaceNumberProperty(nextMediaSource, 'out', nextOut, label);
    let nextItem = match.item.text.slice(0, mediaSource.start)
        + nextMediaSource
        + match.item.text.slice(mediaSource.end);
    nextItem = replaceNumberProperty(nextItem, 'duration', durationFrames - input.retractFrames, label);
    const nextTrack = replaceElement(
        match.track.text,
        match.items.openIndex + 1,
        match.item,
        nextItem
    );
    return replaceElement(source, tracks.openIndex + 1, match.track, nextTrack);
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
    if (hasTopLevelProperty(element.text, 'at')) {
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
        throw new Error(`素材 ${layerId} が見つかりません`);
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
    } else if (nextTrack === null
        || (nextTrack !== undefined && normalizeTrack(before.cuts[cutIndex].track) !== nextTrack)) {
        updated = updateArrayElementByIndex(updated, 'cuts', cutIndex, 'クリップ', element =>
            writeTrackProperty(element, nextTrack, `クリップ ${cutIndex + 1}`));
    }
    assertMovedCutDoesNotOverlap(updated, cutIndex);
    return updated;
}

/**
 * クリップ移動と、移動で空になった宣言済み cuts トラックの除去を同じ候補全文へ畳む。
 * trackIds は UI が移動前の件数から特定したものだけを受け取り、他種別・使用中トラックは守る。
 */
export function moveCutAndPruneTracksInSource(
    source: string,
    cutIndex: number,
    nextAt: number,
    nextTrack?: number | null,
    trackState?: Record<string, number | null>,
    trackIds: readonly string[] = []
): { source: string; prunedTracks?: { before: EditTimelineTrack[]; after: EditTimelineTrack[] } } {
    let updated = moveCutInSource(source, cutIndex, nextAt, nextTrack, trackState);
    if (trackIds.length === 0) {
        return { source: updated };
    }
    const value = JSON.parse(updated) as {
        cuts?: Array<{ track?: number }>;
        timeline?: { tracks?: EditTimelineTrack[] };
    };
    const declared = value.timeline?.tracks;
    if (!Array.isArray(declared)) {
        return { source: updated };
    }
    const requested = new Set(trackIds);
    const occupied = new Set((Array.isArray(value.cuts) ? value.cuts : []).map(cut => normalizeTrack(cut?.track)));
    const before = declared.map(track => ({ ...track }));
    const after = before.filter(track =>
        !requested.has(track.id) || track.kind !== 'cuts' || occupied.has(track.ref ?? 0));
    if (after.length === before.length) {
        return { source: updated };
    }
    updated = writeTimelineTracksInSource(updated, after);
    return { source: updated, prunedTracks: { before, after } };
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
        const hasAt = hasTopLevelProperty(element.text, 'at');
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
    return updateArrayElementById(source, 'layers', layerId, '素材', element => {
        let next = element;
        for (const property of ['t', 'duration', 'track'] as const) {
            const value = updates[property];
            if (value === undefined) {
                continue;
            }
            const hasProperty = hasTopLevelProperty(next, property);
            if (hasProperty && readOptionalNumberProperty(next, property) === value) {
                continue;
            }
            next = hasProperty
                ? replacePropertyValue(next, property, value, `素材 ${layerId}`)
                : appendNumberProperty(next, property, value);
        }
        return next;
    });
}

export function updateLayerTransformInSource(
    source: string,
    layerId: string,
    updates: { x?: number | null; y?: number | null; scale?: number | null; rotate?: number | null }
): string {
    if (updates.x === undefined && updates.y === undefined
        && updates.scale === undefined && updates.rotate === undefined) {
        throw new Error('変更する transform フィールドを指定してください。');
    }
    for (const property of ['x', 'y', 'rotate'] as const) {
        const value = updates[property];
        if (value !== undefined && value !== null && !Number.isFinite(value)) {
            throw new Error(`transform.${property} は有限数で指定してください。`);
        }
    }
    if (updates.scale !== undefined && updates.scale !== null
        && (!Number.isFinite(updates.scale) || updates.scale <= 0)) {
        throw new Error('transform.scale は正の数で指定してください。');
    }
    return updateArrayElementById(source, 'layers', layerId, '素材', element => {
        const hasTransform = hasTopLevelProperty(element, 'transform');
        if (!hasTransform) {
            const transform = Object.fromEntries(
                Object.entries(updates).filter((entry): entry is [string, number] =>
                    entry[1] !== undefined && entry[1] !== null)
            );
            return Object.keys(transform).length > 0
                ? appendJsonProperty(element, 'transform', transform)
                : element;
        }
        const located = locateTopLevelObjectProperty(element, 'transform');
        let transform = located.text;
        for (const property of ['x', 'y', 'scale', 'rotate'] as const) {
            const value = updates[property];
            if (value === undefined) {
                continue;
            }
            const hasProperty = hasTopLevelProperty(transform, property);
            transform = value === null
                ? (hasProperty ? removeObjectProperty(transform, property) : transform)
                : (hasProperty
                    ? replacePropertyValue(transform, property, value, `素材 ${layerId} の transform`)
                    : appendNumberProperty(transform, property, value));
        }
        if (Object.keys(JSON.parse(transform) as Record<string, unknown>).length === 0) {
            return removeObjectProperty(element, 'transform');
        }
        return element.slice(0, located.start) + transform + element.slice(located.end);
    });
}

export function updateLayerOpacityInSource(source: string, layerId: string, opacity: number | null): string {
    if (opacity !== null && (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)) {
        throw new Error('opacity は 0〜1 の範囲で指定してください。');
    }
    return updateArrayElementById(source, 'layers', layerId, '素材', element => {
        const hasOpacity = hasTopLevelProperty(element, 'opacity');
        if (opacity === null) {
            return hasOpacity ? removeObjectProperty(element, 'opacity') : element;
        }
        return hasOpacity
            ? replaceTopLevelPropertyValue(element, 'opacity', opacity, `素材 ${layerId}`)
            : appendNumberProperty(element, 'opacity', opacity);
    });
}

export function updateLayerBlendInSource(source: string, layerId: string, blend: string | null): string {
    if (blend !== null && !LAYER_BLEND_MODES.includes(blend as LayerBlendMode)) {
        throw new Error('blend の値が不正です。');
    }
    return updateArrayElementById(source, 'layers', layerId, '素材', element => {
        const hasBlend = hasTopLevelProperty(element, 'blend');
        if (blend === null) {
            return hasBlend ? removeObjectProperty(element, 'blend') : element;
        }
        return hasBlend
            ? replaceTopLevelPropertyValue(element, 'blend', blend, `素材 ${layerId}`)
            : appendJsonProperty(element, 'blend', blend);
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
        throw new Error('素材の時刻または尺が不正です。');
    }
    if (nextTrack !== undefined && (!Number.isInteger(nextTrack) || nextTrack < 0)) {
        throw new Error('素材のトラックが不正です。');
    }
    const beforeArray = locateArray(source, 'layers');
    const beforeElements = splitTopLevelElements(beforeArray.inner);
    const beforeIndex = beforeElements.findIndex(element => readStringProperty(element.text, 'id') === layerId);
    if (beforeIndex < 0) {
        throw new Error(`素材 ${layerId} が見つかりません`);
    }
    const currentTrack = normalizeTrack(readOptionalNumberProperty(beforeElements[beforeIndex].text, 'track'));
    const updated = updateLayerInSource(source, layerId, {
        t: nextT,
        duration: nextDuration,
        ...(!trackState && nextTrack !== undefined && nextTrack !== currentTrack
            ? { track: nextTrack } : {})
    });
    if (trackState) {
        return applyIdTrackState(updated, 'layers', trackState, '素材');
    }
    return updated;
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
        const hasT = hasTopLevelProperty(element, 't');
        let next = hasT
            ? replacePropertyValue(element, 't', nextT, `SE ${sfxIndex + 1}`)
            : appendNumberProperty(element, 't', nextT);
        if (!trackState && nextTrack !== undefined && nextTrack !== currentTrack) {
            next = writeTrackProperty(next, nextTrack, `SE ${sfxIndex + 1}`);
        }
        return next;
    });
    if (trackState) {
        return applyIndexedTrackState(updated, 'sfx', trackState, 'SE');
    }
    return updated;
}

/**
 * SE の in/out（素材秒）を書き戻す。動画クリップのトリム（trimCutInSource）と同じ操作感に
 * 合わせ、左端ドラッグ（in の変更）は t も連動させる呼び出し側の責務で nextT を渡す。
 * null は「フィールドを削除して省略時意味論（in=0 / out=素材末尾）へ戻す」（undo 用）。
 */
export function trimSfxInSource(
    source: string,
    sfxIndex: number,
    nextIn: number | null,
    nextOut: number | null,
    nextT?: number
): string {
    if (nextIn !== null && (!Number.isFinite(nextIn) || nextIn < 0)) {
        throw new Error('SE の in が不正です。');
    }
    if (nextOut !== null && (!Number.isFinite(nextOut) || nextOut <= 0)) {
        throw new Error('SE の out が不正です。');
    }
    if (nextIn !== null && nextOut !== null && nextOut - nextIn < 0.1) {
        throw new Error('SE が短すぎます（0.1 秒未満にはできません）');
    }
    if (nextT !== undefined && (!Number.isFinite(nextT) || nextT < 0)) {
        throw new Error('SE の開始時刻が不正です。');
    }
    return updateArrayElementByIndex(source, 'sfx', sfxIndex, 'SE', element => {
        const label = `SE ${sfxIndex + 1}`;
        let next = element;
        if (nextT !== undefined) {
            next = hasTopLevelProperty(next, 't')
                ? replacePropertyValue(next, 't', nextT, label)
                : appendNumberProperty(next, 't', nextT);
        }
        if (nextIn === null) {
            next = hasTopLevelProperty(next, 'in') ? removeObjectProperty(next, 'in') : next;
        } else {
            next = hasTopLevelProperty(next, 'in')
                ? replacePropertyValue(next, 'in', nextIn, label)
                : appendNumberProperty(next, 'in', nextIn);
        }
        if (nextOut === null) {
            next = hasTopLevelProperty(next, 'out') ? removeObjectProperty(next, 'out') : next;
        } else {
            next = hasTopLevelProperty(next, 'out')
                ? replacePropertyValue(next, 'out', nextOut, label)
                : appendNumberProperty(next, 'out', nextOut);
        }
        return next;
    });
}

export function setSfxGainDbInSource(source: string, sfxIndex: number, gainDb: number | null): string {
    if (gainDb !== null && (!Number.isFinite(gainDb) || gainDb < -60 || gainDb > 12)) {
        throw new Error('gain_db は -60〜12 の範囲で指定してください。');
    }
    return updateArrayElementByIndex(source, 'sfx', sfxIndex, 'SE', element => {
        const hasGain = hasTopLevelProperty(element, 'gain_db');
        if (gainDb === null) {
            return hasGain ? removeObjectProperty(element, 'gain_db') : element;
        }
        return hasGain
            ? replacePropertyValue(element, 'gain_db', gainDb, `SE ${sfxIndex + 1}`)
            : appendNumberProperty(element, 'gain_db', gainDb);
    });
}

export function updateBgmInSource(
    source: string,
    updates: { gainDb?: number | null; fadeIn?: number | null; fadeOut?: number | null; ducking?: boolean | null }
): string {
    if (updates.gainDb === undefined && updates.fadeIn === undefined
        && updates.fadeOut === undefined && updates.ducking === undefined) {
        throw new Error('変更する BGM フィールドを指定してください。');
    }
    if (updates.gainDb !== undefined && updates.gainDb !== null
        && (!Number.isFinite(updates.gainDb) || updates.gainDb < -60 || updates.gainDb > 12)) {
        throw new Error('gain_db は -60〜12 の範囲で指定してください。');
    }
    if (updates.fadeIn !== undefined && updates.fadeIn !== null
        && (!Number.isFinite(updates.fadeIn) || updates.fadeIn < 0)) {
        throw new Error('fadeIn は 0 以上で指定してください。');
    }
    if (updates.fadeOut !== undefined && updates.fadeOut !== null
        && (!Number.isFinite(updates.fadeOut) || updates.fadeOut < 0)) {
        throw new Error('fadeOut は 0 以上で指定してください。');
    }
    if (updates.ducking !== undefined && updates.ducking !== null && typeof updates.ducking !== 'boolean') {
        throw new Error('ducking は boolean で指定してください。');
    }
    const audio = locateTopLevelObjectProperty(source, 'audio');
    const located = locateTopLevelObjectProperty(audio.text, 'bgm');
    let next = located.text;
    const apply = (property: string, value: number | boolean | null | undefined): void => {
        if (value === undefined) {
            return;
        }
        const has = hasTopLevelProperty(next, property);
        if (value === null) {
            next = has ? removeObjectProperty(next, property) : next;
            return;
        }
        next = has
            ? replacePropertyValue(next, property, value, 'bgm')
            : appendNumberProperty(next, property, value);
    };
    apply('gain_db', updates.gainDb);
    apply('fadeIn', updates.fadeIn);
    apply('fadeOut', updates.fadeOut);
    apply('ducking', updates.ducking);
    const nextAudio = audio.text.slice(0, located.start) + next + audio.text.slice(located.end);
    return source.slice(0, audio.start) + nextAudio + source.slice(audio.end);
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
    const updated = updateOverlay(source, overlayId, element => {
        let next = replaceNumberProperty(element, 'start', nextStart, `オーバーレイ ${overlayId}`);
        if (!trackState && (nextTrack === null || (nextTrack !== undefined
            && normalizeTrack(readOptionalNumberProperty(element, 'track')) !== nextTrack))) {
            next = writeTrackProperty(next, nextTrack, `オーバーレイ ${overlayId}`);
        }
        return next;
    });
    if (trackState) {
        return applyOverlayTrackState(updated, trackState);
    }
    return updated;
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

export function writeTimelineTracksInSource(source: string, tracks: EditTimelineTrack[]): string {
    const serialized = JSON.stringify(tracks);
    let timeline: { start: number; end: number; text: string };
    try {
        timeline = locateObjectProperty(source, 'timeline');
    } catch {
        const value = JSON.parse(source) as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(value, 'timeline')) {
            value.timeline = { tracks };
            return `${JSON.stringify(value, undefined, 2)}${source.endsWith('\n') ? '\n' : ''}`;
        }
        return appendJsonProperty(source, 'timeline', { tracks });
    }
    let updatedTimeline: string;
    try {
        const array = locateArray(timeline.text, 'tracks');
        updatedTimeline = timeline.text.slice(0, array.openIndex)
            + serialized
            + timeline.text.slice(array.closeIndex + 1);
    } catch {
        updatedTimeline = appendJsonProperty(timeline.text, 'tracks', tracks);
    }
    return source.slice(0, timeline.start) + updatedTimeline + source.slice(timeline.end);
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

function locateTopLevelProperty(scopeText: string, key: string): SourceElement | undefined {
    const openIndex = scopeText.indexOf('{');
    const closeIndex = openIndex >= 0 ? findMatchingBracket(scopeText, openIndex) : -1;
    if (openIndex < 0 || closeIndex < 0) {
        return undefined;
    }
    const inner = scopeText.slice(openIndex + 1, closeIndex);
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = splitTopLevelElements(inner)
        .filter(element => new RegExp(`^"${escapedKey}"\\s*:`).test(element.text));
    if (matches.length !== 1) {
        return undefined;
    }
    return {
        text: matches[0].text,
        start: openIndex + 1 + matches[0].start,
        end: openIndex + 1 + matches[0].end
    };
}

function hasTopLevelProperty(scopeText: string, key: string): boolean {
    return locateTopLevelProperty(scopeText, key) !== undefined;
}

function locateTopLevelObjectProperty(scopeText: string, key: string): { start: number; end: number; text: string } {
    const property = locateTopLevelProperty(scopeText, key);
    if (!property) {
        throw new Error(`"${key}" が見つかりません。`);
    }
    const colonIndex = property.text.indexOf(':');
    const openIndex = scopeText.indexOf('{', property.start + colonIndex + 1);
    if (openIndex < 0 || openIndex >= property.end) {
        throw new Error(`"${key}" が object ではありません。`);
    }
    const closeIndex = findMatchingBracket(scopeText, openIndex);
    return { start: openIndex, end: closeIndex + 1, text: scopeText.slice(openIndex, closeIndex + 1) };
}

function locateObjectProperty(scopeText: string, key: string): { start: number; end: number; text: string } {
    const match = new RegExp(`"${key}"\\s*:\\s*\\{`).exec(scopeText);
    if (!match) {
        throw new Error(`"${key}" が見つかりません。`);
    }
    const openIndex = scopeText.indexOf('{', match.index);
    const closeIndex = findMatchingBracket(scopeText, openIndex);
    return { start: openIndex, end: closeIndex + 1, text: scopeText.slice(openIndex, closeIndex + 1) };
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
        hasTopLevelProperty(element, 'at')
            ? replacePropertyValue(element, 'at', at, `クリップ ${cutIndex + 1}`)
            : appendNumberProperty(element, 'at', at));
}

export function updateArrayElementByIndex(
    source: string,
    key: string,
    index: number,
    label: string,
    update: (element: string) => string
): string {
    if (!Number.isInteger(index) || index < 0) {
        throw new Error(`${label}のインデックスが不正です。`);
    }
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

function writeTrackProperty(source: string, track: number | null, label: string): string {
    if (track !== null && (!Number.isInteger(track) || track < 0)) {
        throw new Error(`${label} のトラックが不正です。`);
    }
    const hasTrack = hasTopLevelProperty(source, 'track');
    if (track === null) {
        return hasTrack ? removeObjectProperty(source, 'track') : source;
    }
    return hasTrack
        ? (readOptionalNumberProperty(source, 'track') === track
            ? source : replacePropertyValue(source, 'track', track, label))
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
    const located = locateTopLevelProperty(source, property);
    if (!located) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^("${escapedProperty}"\\s*:\\s*)${JSON_NUMBER}$`);
    if (!pattern.test(located.text)) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    const updated = located.text.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
    return source.slice(0, located.start) + updated + source.slice(located.end);
}

function readNumberProperty(source: string, property: string, label: string): number {
    const value = readOptionalNumberProperty(source, property);
    if (value === undefined) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    return value;
}

function readOptionalNumberProperty(source: string, property: string): number | undefined {
    const located = locateTopLevelProperty(source, property);
    if (!located) {
        return undefined;
    }
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^"${escapedProperty}"\\s*:\\s*(${JSON_NUMBER})$`).exec(located.text);
    return match ? Number(match[1]) : undefined;
}

function normalizeTrack(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function appendNumberProperty(source: string, property: string, value: number | string | boolean): string {
    return appendJsonProperty(source, property, value);
}

function appendJsonProperty(source: string, property: string, value: unknown): string {
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

function replacePropertyValue(
    source: string,
    property: string,
    value: number | string | boolean,
    label: string
): string {
    const located = locateTopLevelProperty(source, property);
    if (!located) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
        `^("${escapedProperty}"\\s*:\\s*)(?:${JSON_NUMBER}|"(?:\\\\.|[^"\\\\])*"|true|false|null)$`
    );
    if (!pattern.test(located.text)) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    const updated = located.text.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
    return source.slice(0, located.start) + updated + source.slice(located.end);
}

function replaceTopLevelPropertyValue(
    source: string,
    property: string,
    value: number | string | boolean,
    label: string
): string {
    return replacePropertyValue(source, property, value, label);
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
        const hasTrack = hasTopLevelProperty(element.text, 'track');
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

export function updateOverlayVarInSource(
    source: string,
    overlayId: string,
    varName: string,
    nextValue: string
): string {
    if (!overlayId || !varName || typeof nextValue !== 'string') {
        throw new Error('オーバーレイのパラメータ更新値が不正です。');
    }
    return updateArrayElementById(source, 'overlays', overlayId, 'オーバーレイ', element => {
        const vars = locateTopLevelObjectProperty(element, 'vars');
        const hasVar = hasTopLevelProperty(vars.text, varName);
        if (!hasVar) {
            throw new Error(`オーバーレイ ${overlayId} のパラメータ ${varName} が見つかりません。`);
        }
        const nextVarsText = replacePropertyValue(
            vars.text,
            varName,
            nextValue,
            `オーバーレイ ${overlayId} の ${varName}`
        );
        return element.slice(0, vars.start) + nextVarsText + element.slice(vars.end);
    });
}

function replaceElement(source: string, innerOffset: number, element: SourceElement, nextText: string): string {
    const start = innerOffset + element.start;
    const end = innerOffset + element.end;
    return source.slice(0, start) + nextText + source.slice(end);
}

function readStringProperty(source: string, property: string): string | undefined {
    const located = locateTopLevelProperty(source, property);
    if (!located) {
        return undefined;
    }
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^"${escapedProperty}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"$`).exec(located.text);
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
