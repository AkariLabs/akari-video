"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findMatchingBracket = findMatchingBracket;
exports.splitTopLevelElements = splitTopLevelElements;
exports.computeCutTrackSegments = computeCutTrackSegments;
exports.trimCutInSource = trimCutInSource;
exports.slipCutInSource = slipCutInSource;
exports.setCutSpeedInSource = setCutSpeedInSource;
exports.updateCutTransformInSource = updateCutTransformInSource;
exports.updateCutOpacityInSource = updateCutOpacityInSource;
exports.setCutTransitionOutInSource = setCutTransitionOutInSource;
exports.reorderCutsInSource = reorderCutsInSource;
exports.splitCutInSource = splitCutInSource;
exports.deleteCutInSource = deleteCutInSource;
exports.insertCutInSource = insertCutInSource;
exports.deleteLayerByIdInSource = deleteLayerByIdInSource;
exports.deleteLayerInSource = deleteLayerInSource;
exports.insertLayerInSource = insertLayerInSource;
exports.deleteSfxInSource = deleteSfxInSource;
exports.insertSfxInSource = insertSfxInSource;
exports.moveCutInSource = moveCutInSource;
exports.setCutAtValuesInSource = setCutAtValuesInSource;
exports.updateLayerInSource = updateLayerInSource;
exports.updateLayerTransformInSource = updateLayerTransformInSource;
exports.updateLayerOpacityInSource = updateLayerOpacityInSource;
exports.updateLayerBlendInSource = updateLayerBlendInSource;
exports.moveLayerInSource = moveLayerInSource;
exports.moveSfxInSource = moveSfxInSource;
exports.trimSfxInSource = trimSfxInSource;
exports.setSfxGainDbInSource = setSfxGainDbInSource;
exports.updateBgmInSource = updateBgmInSource;
exports.moveOverlayInSource = moveOverlayInSource;
exports.resizeOverlayInSource = resizeOverlayInSource;
exports.insertOverlayInSource = insertOverlayInSource;
exports.removeOverlayInSource = removeOverlayInSource;
exports.parseEdit = parseEdit;
exports.writeTimelineTracksInSource = writeTimelineTracksInSource;
exports.updateArrayElementByIndex = updateArrayElementByIndex;
exports.updateOverlayVarInSource = updateOverlayVarInSource;
const JSON_NUMBER = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
const LAYER_BLEND_MODES = [
    'normal', 'screen', 'multiply', 'add', 'difference',
    'darken', 'lighten', 'overlay', 'hardlight', 'softlight'
];
function findMatchingBracket(source, openIndex) {
    const opening = source[openIndex];
    if (opening !== '[' && opening !== '{') {
        throw new Error('対応する括弧を探す開始位置が不正です。');
    }
    const stack = [opening];
    let inString = false;
    let escaped = false;
    for (let index = openIndex + 1; index < source.length; index++) {
        const character = source[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            }
            else if (character === '\\') {
                escaped = true;
            }
            else if (character === '"') {
                inString = false;
            }
            continue;
        }
        if (character === '"') {
            inString = true;
        }
        else if (character === '[' || character === '{') {
            stack.push(character);
        }
        else if (character === ']' || character === '}') {
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
function splitTopLevelElements(innerText) {
    const ranges = [];
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
            }
            else if (character === '\\') {
                escaped = true;
            }
            else if (character === '"') {
                inString = false;
            }
            continue;
        }
        if (character === '"') {
            inString = true;
        }
        else if (character === '[') {
            squareDepth++;
        }
        else if (character === ']') {
            squareDepth--;
        }
        else if (character === '{') {
            braceDepth++;
        }
        else if (character === '}') {
            braceDepth--;
        }
        else if (character === ',' && squareDepth === 0 && braceDepth === 0) {
            ranges.push({ start, end: index });
            start = index + 1;
        }
    }
    ranges.push({ start, end: innerText.length });
    const elements = [];
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
function computeCutTrackSegments(cuts) {
    const cursorByTrack = new Map();
    const previousIndexByTrack = new Map();
    const segments = [];
    cuts.forEach((cut, index) => {
        const track = typeof cut.track === 'number' && Number.isInteger(cut.track) && cut.track >= 0 ? cut.track : 0;
        const speed = typeof cut.speed === 'number' && cut.speed > 0 ? cut.speed : 1;
        const duration = Math.max(0, cut.out - cut.in) / speed;
        const cursor = cursorByTrack.get(track) ?? 0;
        const hasExplicitAt = typeof cut.at === 'number' && Number.isFinite(cut.at) && cut.at >= 0;
        const previousIndex = previousIndexByTrack.get(track);
        const transitionOverlap = !hasExplicitAt && previousIndex !== undefined
            ? cuts[previousIndex].transitionOut?.duration ?? 0 : 0;
        const at = hasExplicitAt ? cut.at : cursor - transitionOverlap;
        const end = at + duration;
        cursorByTrack.set(track, end);
        previousIndexByTrack.set(track, index);
        segments.push({ index, track, at, duration, end });
    });
    return segments;
}
function trimCutInSource(source, cutIndex, nextIn, nextOut, maxOutSeconds) {
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
        const speed = typeof before.cuts[cutIndex].speed === 'number' && before.cuts[cutIndex].speed > 0
            ? before.cuts[cutIndex].speed : 1;
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
function slipCutInSource(source, cutIndex, nextIn, nextOut, maxOutSeconds) {
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
function setCutSpeedInSource(source, cutIndex, speed) {
    if (speed !== null && (!Number.isFinite(speed) || speed <= 0)) {
        throw new Error('speed は正の数で指定してください。');
    }
    return updateArrayElementByIndex(source, 'cuts', cutIndex, 'クリップ', element => {
        const hasSpeed = /"speed"\s*:/.test(element);
        if (speed === null) {
            return hasSpeed ? removeObjectProperty(element, 'speed') : element;
        }
        return hasSpeed
            ? replacePropertyValue(element, 'speed', speed, `クリップ ${cutIndex + 1}`)
            : appendNumberProperty(element, 'speed', speed);
    });
}
function updateCutTransformInSource(source, cutIndex, updates) {
    if (updates.x === undefined && updates.y === undefined
        && updates.scale === undefined && updates.rotate === undefined) {
        throw new Error('変更する transform フィールドを指定してください。');
    }
    for (const property of ['x', 'y', 'rotate']) {
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
            const transform = Object.fromEntries(Object.entries(updates).filter((entry) => entry[1] !== undefined && entry[1] !== null));
            return Object.keys(transform).length > 0
                ? appendJsonProperty(element, 'transform', transform)
                : element;
        }
        const located = locateTopLevelObjectProperty(element, 'transform');
        let transform = located.text;
        for (const property of ['x', 'y', 'scale', 'rotate']) {
            const value = updates[property];
            if (value === undefined) {
                continue;
            }
            const hasProperty = new RegExp(`"${property}"\\s*:`).test(transform);
            transform = value === null
                ? (hasProperty ? removeObjectProperty(transform, property) : transform)
                : (hasProperty
                    ? replacePropertyValue(transform, property, value, `クリップ ${cutIndex + 1} の transform`)
                    : appendNumberProperty(transform, property, value));
        }
        if (Object.keys(JSON.parse(transform)).length === 0) {
            return removeObjectProperty(element, 'transform');
        }
        return element.slice(0, located.start) + transform + element.slice(located.end);
    });
}
function updateCutOpacityInSource(source, cutIndex, opacity) {
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
function setCutTransitionOutInSource(source, cutIndex, transitionOut) {
    if (transitionOut !== null) {
        if (transitionOut.type !== 'dissolve' && transitionOut.type !== 'fade-black' && transitionOut.type !== 'fade-white') {
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
        }
        catch {
            return appendJsonProperty(removeObjectProperty(element, 'transition_out'), 'transition_out', value);
        }
    });
}
function reorderCutsInSource(source, fromIndex, toIndex) {
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
function splitCutInSource(source, cutIndex, atSeconds) {
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
        const speed = typeof before.cuts[cutIndex].speed === 'number' && before.cuts[cutIndex].speed > 0
            ? before.cuts[cutIndex].speed : 1;
        secondText = replacePropertyValue(secondText, 'at', before.segments[cutIndex].at + (atSeconds - currentIn) / speed, label);
    }
    // 区切り文字は既存要素間の生テキスト（カンマ・改行・インデント）をそのまま再利用し、整形を保つ。
    const separator = elements.length >= 2
        ? array.inner.slice(elements[0].end, elements[1].start)
        : ', ';
    return replaceElement(source, array.openIndex + 1, element, `${firstText}${separator}${secondText}`);
}
function deleteCutInSource(source, cutIndex) {
    source = freezeNextImplicitCutAt(source, cutIndex, readCutsForSurgery(source));
    return removeArrayElementByIndex(source, 'cuts', cutIndex);
}
function removeArrayElementByIndex(source, key, index) {
    const array = locateArray(source, key);
    const elements = splitTopLevelElements(array.inner);
    const element = elements[index];
    if (!element) {
        throw new Error(`${key} の ${index + 1} 番目の要素が見つかりません`);
    }
    const innerOffset = array.openIndex + 1;
    let removeStart;
    let removeEnd;
    if (elements.length === 1) {
        // 唯一の要素: 前後の区切りが存在しないため inner 全体を空にする。
        removeStart = 0;
        removeEnd = array.inner.length;
    }
    else if (index === elements.length - 1) {
        // 末尾要素: 直前の区切り（前要素の終端から）ごと除去する。
        removeStart = elements[index - 1].end;
        removeEnd = element.end;
    }
    else {
        // 後続がある要素: 自身の開始から次要素の開始（自身の後ろの区切り込み）まで除去する。
        removeStart = element.start;
        removeEnd = elements[index + 1].start;
    }
    const nextSource = source.slice(0, innerOffset + removeStart) + source.slice(innerOffset + removeEnd);
    return { source: nextSource, removedText: element.text };
}
function insertCutInSource(source, cutIndex, elementText) {
    return insertArrayElementByIndex(source, 'cuts', cutIndex, elementText);
}
function insertArrayElementByIndex(source, key, index, elementText) {
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
function deleteLayerByIdInSource(source, layerId) {
    const array = locateArray(source, 'layers');
    const elements = splitTopLevelElements(array.inner);
    const layerIndex = elements.findIndex(element => readStringProperty(element.text, 'id') === layerId);
    if (layerIndex < 0) {
        throw new Error(`素材 ${layerId} が見つかりません`);
    }
    return { ...removeArrayElementByIndex(source, 'layers', layerIndex), layerIndex };
}
function deleteLayerInSource(source, layerIndex) {
    return removeArrayElementByIndex(source, 'layers', layerIndex);
}
function insertLayerInSource(source, layerIndex, elementText) {
    return insertArrayElementByIndex(source, 'layers', layerIndex, elementText);
}
function deleteSfxInSource(source, sfxIndex) {
    return removeArrayElementByIndex(source, 'sfx', sfxIndex);
}
function insertSfxInSource(source, sfxIndex, elementText) {
    return insertArrayElementByIndex(source, 'sfx', sfxIndex, elementText);
}
function moveCutInSource(source, cutIndex, nextAt, nextTrack, trackState) {
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
    }
    else if (nextTrack === null
        || (nextTrack !== undefined && normalizeTrack(before.cuts[cutIndex].track) !== nextTrack)) {
        updated = updateArrayElementByIndex(updated, 'cuts', cutIndex, 'クリップ', element => writeTrackProperty(element, nextTrack, `クリップ ${cutIndex + 1}`));
    }
    assertMovedCutDoesNotOverlap(updated, cutIndex);
    return updated;
}
function setCutAtValuesInSource(source, entries) {
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
        const at = updates.get(index);
        const hasAt = /"at"\s*:/.test(element.text);
        return at === null
            ? (hasAt ? removeObjectProperty(element.text, 'at') : element.text)
            : (hasAt
                ? replacePropertyValue(element.text, 'at', at, `クリップ ${index + 1}`)
                : appendNumberProperty(element.text, 'at', at));
    });
    return rebuildArrayElements(source, array, elements, texts);
}
function updateLayerInSource(source, layerId, updates) {
    return updateArrayElementById(source, 'layers', layerId, '素材', element => {
        let next = element;
        for (const property of ['t', 'duration', 'track']) {
            const value = updates[property];
            if (value === undefined) {
                continue;
            }
            const hasProperty = new RegExp(`"${property}"\\s*:`).test(next);
            next = hasProperty
                ? replacePropertyValue(next, property, value, `素材 ${layerId}`)
                : appendNumberProperty(next, property, value);
        }
        return next;
    });
}
function updateLayerTransformInSource(source, layerId, updates) {
    if (updates.x === undefined && updates.y === undefined
        && updates.scale === undefined && updates.rotate === undefined) {
        throw new Error('変更する transform フィールドを指定してください。');
    }
    for (const property of ['x', 'y', 'rotate']) {
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
            const transform = Object.fromEntries(Object.entries(updates).filter((entry) => entry[1] !== undefined && entry[1] !== null));
            return Object.keys(transform).length > 0
                ? appendJsonProperty(element, 'transform', transform)
                : element;
        }
        const located = locateTopLevelObjectProperty(element, 'transform');
        let transform = located.text;
        for (const property of ['x', 'y', 'scale', 'rotate']) {
            const value = updates[property];
            if (value === undefined) {
                continue;
            }
            const hasProperty = new RegExp(`"${property}"\\s*:`).test(transform);
            transform = value === null
                ? (hasProperty ? removeObjectProperty(transform, property) : transform)
                : (hasProperty
                    ? replacePropertyValue(transform, property, value, `素材 ${layerId} の transform`)
                    : appendNumberProperty(transform, property, value));
        }
        if (Object.keys(JSON.parse(transform)).length === 0) {
            return removeObjectProperty(element, 'transform');
        }
        return element.slice(0, located.start) + transform + element.slice(located.end);
    });
}
function updateLayerOpacityInSource(source, layerId, opacity) {
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
function updateLayerBlendInSource(source, layerId, blend) {
    if (blend !== null && !LAYER_BLEND_MODES.includes(blend)) {
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
function moveLayerInSource(source, layerId, nextT, nextDuration, nextTrack, trackState) {
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
function moveSfxInSource(source, sfxIndex, nextT, nextTrack, trackState) {
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
function trimSfxInSource(source, sfxIndex, nextIn, nextOut, nextT) {
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
            next = /"t"\s*:/.test(next)
                ? replacePropertyValue(next, 't', nextT, label)
                : appendNumberProperty(next, 't', nextT);
        }
        if (nextIn === null) {
            next = /"in"\s*:/.test(next) ? removeObjectProperty(next, 'in') : next;
        }
        else {
            next = /"in"\s*:/.test(next)
                ? replacePropertyValue(next, 'in', nextIn, label)
                : appendNumberProperty(next, 'in', nextIn);
        }
        if (nextOut === null) {
            next = /"out"\s*:/.test(next) ? removeObjectProperty(next, 'out') : next;
        }
        else {
            next = /"out"\s*:/.test(next)
                ? replacePropertyValue(next, 'out', nextOut, label)
                : appendNumberProperty(next, 'out', nextOut);
        }
        return next;
    });
}
function setSfxGainDbInSource(source, sfxIndex, gainDb) {
    if (gainDb !== null && (!Number.isFinite(gainDb) || gainDb < -60 || gainDb > 12)) {
        throw new Error('gain_db は -60〜12 の範囲で指定してください。');
    }
    return updateArrayElementByIndex(source, 'sfx', sfxIndex, 'SE', element => {
        const hasGain = /"gain_db"\s*:/.test(element);
        if (gainDb === null) {
            return hasGain ? removeObjectProperty(element, 'gain_db') : element;
        }
        return hasGain
            ? replacePropertyValue(element, 'gain_db', gainDb, `SE ${sfxIndex + 1}`)
            : appendNumberProperty(element, 'gain_db', gainDb);
    });
}
function updateBgmInSource(source, updates) {
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
    const located = locateObjectProperty(source, 'bgm');
    let next = located.text;
    const apply = (property, value) => {
        if (value === undefined) {
            return;
        }
        const has = new RegExp(`"${property}"\\s*:`).test(next);
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
    return source.slice(0, located.start) + next + source.slice(located.end);
}
function moveOverlayInSource(source, overlayId, nextStart, nextTrack, trackState) {
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
function resizeOverlayInSource(source, overlayId, nextDuration) {
    if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
        throw new Error('オーバーレイの尺は正の値にしてください。');
    }
    return updateOverlay(source, overlayId, element => replaceNumberProperty(element, 'duration', nextDuration, `オーバーレイ ${overlayId}`));
}
function insertOverlayInSource(source, overlay) {
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
    let nextInner;
    if (elements.length === 0) {
        const leading = array.inner.slice(0, trailingStart);
        const indent = indentationBeforeClose(array.inner);
        nextInner = `${leading}${indent}${serialized}${trailing}`;
    }
    else {
        const separator = separatorForAppend(array.inner, elements);
        nextInner = `${array.inner.slice(0, trailingStart)}${separator}${serialized}${trailing}`;
    }
    return source.slice(0, array.openIndex + 1) + nextInner + source.slice(array.closeIndex);
}
function removeOverlayInSource(source, overlayId) {
    const array = locateArray(source, 'overlays');
    const elements = splitTopLevelElements(array.inner);
    const index = elements.findIndex(element => readStringProperty(element.text, 'id') === overlayId);
    if (index < 0) {
        throw new Error(`オーバーレイ ${overlayId} が見つかりません`);
    }
    let nextInner;
    if (elements.length === 1) {
        nextInner = array.inner.slice(elements[0].end);
    }
    else if (index < elements.length - 1) {
        nextInner = array.inner.slice(0, elements[index].start) + array.inner.slice(elements[index + 1].start);
    }
    else {
        nextInner = array.inner.slice(0, elements[index - 1].end) + array.inner.slice(elements[index].end);
    }
    return source.slice(0, array.openIndex + 1) + nextInner + source.slice(array.closeIndex);
}
function parseEdit(source) {
    const value = JSON.parse(source);
    if (!value || typeof value !== 'object') {
        throw new Error('編集データの形式を確認できません。');
    }
    const warnings = [];
    const cuts = [];
    const overlays = [];
    const beats = [];
    const layers = [];
    const audioSfx = [];
    let timeline;
    let audioBgm;
    const sources = [];
    const sourceIds = new Set();
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
    let defaultSource;
    if (isV0 && typeof value.source.path === 'string' && value.source.path
        && (value.source.proxy === undefined || value.source.proxy === null || typeof value.source.proxy === 'string')) {
        defaultSource = { path: value.source.path, proxy: value.source.proxy ?? null };
    }
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
                let speed;
                if (rawCut.speed !== undefined) {
                    if (typeof rawCut.speed === 'number' && Number.isFinite(rawCut.speed) && rawCut.speed > 0) {
                        speed = rawCut.speed;
                    }
                    else {
                        warnings.push(`${index + 1} 番目のクリップの speed が不正なため 1 として扱います。`);
                    }
                }
                let transitionOut;
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
                    }
                    else {
                        warnings.push(`${index + 1} 番目のクリップの transition_out が不正なため無視します。`);
                    }
                }
                let at;
                if (rawCut.at !== undefined) {
                    if (typeof rawCut.at === 'number' && Number.isFinite(rawCut.at) && rawCut.at >= 0) {
                        at = rawCut.at;
                    }
                    else {
                        warnings.push(`${index + 1} 番目のクリップの at が不正なため無視します。`);
                    }
                }
                const track = normalizeTrack(rawCut.track);
                if (rawCut.track !== undefined && track !== rawCut.track) {
                    warnings.push(`${index + 1} 番目のクリップの track が不正なため track 0 に表示します。`);
                }
                let transform;
                if (rawCut.transform !== undefined && rawCut.transform !== null) {
                    const rawTransform = rawCut.transform;
                    const validKeys = Object.keys(rawTransform).every(key => key === 'x' || key === 'y' || key === 'scale' || key === 'rotate');
                    const validTransform = typeof rawTransform === 'object' && !Array.isArray(rawTransform)
                        && validKeys
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
                    }
                    else {
                        warnings.push(`${index + 1} 番目のクリップの transform が不正なため無視します。`);
                    }
                }
                let opacity;
                if (rawCut.opacity !== undefined && rawCut.opacity !== null) {
                    if (typeof rawCut.opacity === 'number' && Number.isFinite(rawCut.opacity)
                        && rawCut.opacity >= 0 && rawCut.opacity <= 1) {
                        opacity = rawCut.opacity;
                    }
                    else {
                        warnings.push(`${index + 1} 番目のクリップの opacity が不正なため無視します。`);
                    }
                }
                cuts.push({
                    in: input,
                    out: output,
                    ...(typeof rawCut.src === 'string' ? { src: rawCut.src } : {}),
                    ...(transform !== undefined ? { transform } : {}),
                    ...(opacity !== undefined ? { opacity } : {}),
                    ...(speed !== undefined ? { speed } : {}),
                    ...(transitionOut ? { transitionOut } : {}),
                    ...(at !== undefined ? { at } : {}),
                    ...(rawCut.track !== undefined ? { track } : {})
                });
            }
            else {
                warnings.push(`${index + 1} 番目のクリップは時刻が不正なため表示しません。`);
            }
        }
    }
    else if (value.cuts !== undefined) {
        warnings.push('cuts が配列ではないためクリップを表示しません。');
    }
    if (Array.isArray(value.overlays)) {
        const seenIds = new Set();
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
                    payload: JSON.parse(JSON.stringify(overlay))
                });
                if (overlay.track !== undefined && normalizeTrack(overlay.track) !== overlay.track) {
                    warnings.push(`オーバーレイ ${overlay.id} の track が不正なため track 0 に表示します。`);
                }
            }
            else {
                warnings.push(`${index + 1} 番目のオーバーレイは識別情報または時刻が不正なため表示しません。`);
            }
        }
    }
    else if (value.overlays !== undefined) {
        warnings.push('overlays が配列ではないためオーバーレイを表示しません。');
    }
    if (Array.isArray(value.beats)) {
        const seenIds = new Set();
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
    }
    else if (value.beats !== undefined) {
        warnings.push('beats が配列ではないため見せ場マーカーを表示しません。');
    }
    if (Array.isArray(value.layers)) {
        const seenIds = new Set();
        for (let index = 0; index < value.layers.length; index++) {
            const layer = value.layers[index];
            const valid = layer !== null && typeof layer === 'object'
                && typeof layer.id === 'string' && layer.id.length > 0
                && typeof layer.t === 'number' && Number.isFinite(layer.t) && layer.t >= 0
                && typeof layer.duration === 'number' && Number.isFinite(layer.duration) && layer.duration > 0
                && (layer.kind === 'baked' || layer.kind === 'video')
                && typeof layer.src === 'string' && layer.src.length > 0;
            if (!valid) {
                warnings.push(`${index + 1} 番目の素材は識別情報・時刻・種類のいずれかが不正なため表示しません。`);
                continue;
            }
            if (seenIds.has(layer.id)) {
                warnings.push(`素材 ${layer.id} が重複しているため、後の要素は表示しません。`);
                continue;
            }
            seenIds.add(layer.id);
            const track = normalizeTrack(layer.track);
            if (layer.track !== undefined && track !== layer.track) {
                warnings.push(`${index + 1} 番目の素材の track が不正なため track 0 に表示します。`);
            }
            let preset;
            if (layer.preset !== undefined && layer.preset !== null) {
                if (typeof layer.preset === 'string') {
                    preset = layer.preset;
                }
                else {
                    warnings.push(`素材 ${layer.id} の preset が不正なため無視します。`);
                }
            }
            let transform;
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
                }
                else {
                    warnings.push(`素材 ${layer.id} の transform が不正なため無視します。`);
                }
            }
            let opacity;
            if (layer.opacity !== undefined && layer.opacity !== null) {
                if (typeof layer.opacity === 'number' && Number.isFinite(layer.opacity)
                    && layer.opacity >= 0 && layer.opacity <= 1) {
                    opacity = layer.opacity;
                }
                else {
                    warnings.push(`素材 ${layer.id} の opacity が不正なため無視します。`);
                }
            }
            let blend;
            if (layer.blend !== undefined && layer.blend !== null) {
                if (typeof layer.blend === 'string'
                    && LAYER_BLEND_MODES.includes(layer.blend)) {
                    blend = layer.blend;
                }
                else {
                    warnings.push(`素材 ${layer.id} の blend が不正なため無視します。`);
                }
            }
            let chromaKey;
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
                }
                else {
                    warnings.push(`素材 ${layer.id} の chroma_key が不正なため無視します。`);
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
    }
    else if (value.layers !== undefined) {
        warnings.push('layers が配列ではないため素材を表示しません。');
    }
    if (value.audio !== undefined && (value.audio === null || typeof value.audio !== 'object' || Array.isArray(value.audio))) {
        warnings.push('audio が object ではないため SE/BGM を表示しません。');
    }
    else if (value.audio && typeof value.audio === 'object') {
        if (Array.isArray(value.audio.sfx)) {
            for (let index = 0; index < value.audio.sfx.length; index++) {
                const sfx = value.audio.sfx[index];
                if (sfx === null || typeof sfx !== 'object'
                    || typeof sfx.path !== 'string' || sfx.path.length === 0
                    || typeof sfx.t !== 'number' || !Number.isFinite(sfx.t) || sfx.t < 0) {
                    warnings.push(`${index + 1} 番目の SE は時刻または素材が不正なため表示しません。`);
                    continue;
                }
                let gainDb;
                if (sfx.gain_db !== undefined && sfx.gain_db !== null) {
                    if (typeof sfx.gain_db === 'number' && Number.isFinite(sfx.gain_db)
                        && sfx.gain_db >= -60 && sfx.gain_db <= 12) {
                        gainDb = sfx.gain_db;
                    }
                    else {
                        warnings.push(`${index + 1} 番目の SE の gain_db が不正なため無視します。`);
                    }
                }
                let inSeconds;
                if (sfx.in !== undefined && sfx.in !== null) {
                    if (typeof sfx.in === 'number' && Number.isFinite(sfx.in) && sfx.in >= 0) {
                        inSeconds = sfx.in;
                    }
                    else {
                        warnings.push(`${index + 1} 番目の SE の in が不正なため無視します。`);
                    }
                }
                let outSeconds;
                if (sfx.out !== undefined && sfx.out !== null) {
                    if (typeof sfx.out === 'number' && Number.isFinite(sfx.out) && sfx.out > 0) {
                        outSeconds = sfx.out;
                    }
                    else {
                        warnings.push(`${index + 1} 番目の SE の out が不正なため無視します。`);
                    }
                }
                audioSfx.push({
                    id: `sfx-${index}`,
                    t: sfx.t,
                    // 実尺（ffprobe）取得までの暫定表示尺。out 指定済みなら out-in を正として使い、
                    // 未指定なら getAudioDuration 解決後に widget 側で実尺基準へ差し替える（地雷6回収）。
                    duration: outSeconds !== undefined ? Math.max(0, outSeconds - (inSeconds ?? 0)) : 1,
                    path: sfx.path,
                    ...(sfx.track !== undefined ? { track: normalizeTrack(sfx.track) } : {}),
                    ...(inSeconds !== undefined ? { in: inSeconds } : {}),
                    ...(outSeconds !== undefined ? { out: outSeconds } : {}),
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
                let gainDb;
                if (bgm.gain_db !== undefined && bgm.gain_db !== null) {
                    if (typeof bgm.gain_db === 'number' && Number.isFinite(bgm.gain_db)
                        && bgm.gain_db >= -60 && bgm.gain_db <= 12) {
                        gainDb = bgm.gain_db;
                    }
                    else {
                        warnings.push('bgm の gain_db が不正なため無視します。');
                    }
                }
                let ducking;
                if (bgm.ducking !== undefined && bgm.ducking !== null) {
                    if (typeof bgm.ducking === 'boolean') {
                        ducking = bgm.ducking;
                    }
                    else {
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
            }
            else {
                warnings.push('bgm の path が不正なため表示しません。');
            }
        }
    }
    if (value.timeline !== null && typeof value.timeline === 'object' && !Array.isArray(value.timeline)
        && Array.isArray(value.timeline.tracks)) {
        const tracks = [];
        const kinds = ['cuts', 'layers', 'overlays', 'captions', 'audio'];
        const seenTrackIds = new Set();
        const seenSingletonKinds = new Set();
        for (let index = 0; index < value.timeline.tracks.length; index++) {
            const track = value.timeline.tracks[index];
            const valid = track !== null && typeof track === 'object' && !Array.isArray(track)
                && typeof track.id === 'string' && track.id.length > 0
                && typeof track.kind === 'string' && kinds.includes(track.kind)
                && (track.ref === undefined || (Number.isInteger(track.ref) && track.ref >= 0))
                && (track.label === undefined || typeof track.label === 'string')
                && (track.muted === undefined || typeof track.muted === 'boolean')
                && (track.hidden === undefined || typeof track.hidden === 'boolean')
                && (track.locked === undefined || typeof track.locked === 'boolean');
            if (!valid) {
                warnings.push(`${index + 1} 番目の timeline.tracks 要素が不正なため表示しません。`);
                continue;
            }
            if (seenTrackIds.has(track.id)
                || (track.kind === 'captions' && seenSingletonKinds.has(track.kind))) {
                warnings.push(`${index + 1} 番目の timeline.tracks 要素が重複のため表示しません。`);
                continue;
            }
            seenTrackIds.add(track.id);
            if (track.kind === 'captions') {
                seenSingletonKinds.add(track.kind);
            }
            tracks.push({
                id: track.id,
                kind: track.kind,
                ...(track.ref !== undefined ? { ref: track.ref } : {}),
                ...(track.label !== undefined ? { label: track.label } : {}),
                ...(track.muted !== undefined ? { muted: track.muted } : {}),
                ...(track.hidden !== undefined ? { hidden: track.hidden } : {}),
                ...(track.locked !== undefined ? { locked: track.locked } : {})
            });
        }
        timeline = { tracks };
    }
    let fps = 30;
    if (value.output && typeof value.output === 'object'
        && typeof value.output.fps === 'number' && Number.isFinite(value.output.fps) && value.output.fps > 0) {
        fps = value.output.fps;
    }
    return {
        cuts,
        ...(isV1 ? { sources } : {}),
        ...(defaultSource ? { source: defaultSource } : {}),
        overlays,
        ...(Array.isArray(value.beats) ? { beats } : {}),
        layers,
        audioSfx,
        ...(audioBgm ? { audioBgm } : {}),
        ...(timeline ? { timeline } : {}),
        fps,
        warnings
    };
}
function writeTimelineTracksInSource(source, tracks) {
    const serialized = JSON.stringify(tracks);
    let timeline;
    try {
        timeline = locateObjectProperty(source, 'timeline');
    }
    catch {
        const value = JSON.parse(source);
        if (Object.prototype.hasOwnProperty.call(value, 'timeline')) {
            value.timeline = { tracks };
            return `${JSON.stringify(value, undefined, 2)}${source.endsWith('\n') ? '\n' : ''}`;
        }
        return appendJsonProperty(source, 'timeline', { tracks });
    }
    let updatedTimeline;
    try {
        const array = locateArray(timeline.text, 'tracks');
        updatedTimeline = timeline.text.slice(0, array.openIndex)
            + serialized
            + timeline.text.slice(array.closeIndex + 1);
    }
    catch {
        updatedTimeline = appendJsonProperty(timeline.text, 'tracks', tracks);
    }
    return source.slice(0, timeline.start) + updatedTimeline + source.slice(timeline.end);
}
function locateArray(source, key) {
    const match = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(source);
    if (!match) {
        throw new Error(`edit.json に ${key} 配列がありません。`);
    }
    const openIndex = source.indexOf('[', match.index);
    const closeIndex = findMatchingBracket(source, openIndex);
    return { openIndex, closeIndex, inner: source.slice(openIndex + 1, closeIndex) };
}
function locateTopLevelProperty(scopeText, key) {
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
function hasTopLevelProperty(scopeText, key) {
    return locateTopLevelProperty(scopeText, key) !== undefined;
}
function locateTopLevelObjectProperty(scopeText, key) {
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
function locateObjectProperty(scopeText, key) {
    const match = new RegExp(`"${key}"\\s*:\\s*\\{`).exec(scopeText);
    if (!match) {
        throw new Error(`"${key}" が見つかりません。`);
    }
    const openIndex = scopeText.indexOf('{', match.index);
    const closeIndex = findMatchingBracket(scopeText, openIndex);
    return { start: openIndex, end: closeIndex + 1, text: scopeText.slice(openIndex, closeIndex + 1) };
}
function readCutsForSurgery(source) {
    const value = JSON.parse(source);
    if (!Array.isArray(value.cuts)) {
        throw new Error('edit.json に cuts 配列がありません。');
    }
    const cuts = value.cuts.map((raw, index) => {
        if (!raw || typeof raw !== 'object') {
            throw new Error(`クリップ ${index + 1} の形式が不正です。`);
        }
        const cut = raw;
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
                ? { transitionOut: cut.transition_out } : {})
        };
    });
    return { cuts, segments: computeCutTrackSegments(cuts), rawCuts: value.cuts };
}
function freezeNextImplicitCutAt(source, cutIndex, before) {
    const target = before.segments[cutIndex];
    if (!target) {
        throw new Error(`クリップ ${cutIndex + 1} が見つかりません`);
    }
    for (let index = cutIndex + 1; index < before.cuts.length; index++) {
        if (before.segments[index].track !== target.track) {
            continue;
        }
        const raw = before.rawCuts[index];
        return Object.prototype.hasOwnProperty.call(raw, 'at')
            ? source : writeCutAtProperty(source, index, before.segments[index].at);
    }
    return source;
}
function writeCutAtProperty(source, cutIndex, at) {
    return updateArrayElementByIndex(source, 'cuts', cutIndex, 'クリップ', element => /"at"\s*:/.test(element)
        ? replacePropertyValue(element, 'at', at, `クリップ ${cutIndex + 1}`)
        : appendNumberProperty(element, 'at', at));
}
function updateArrayElementByIndex(source, key, index, label, update) {
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
function updateArrayElementById(source, key, id, label, update) {
    const array = locateArray(source, key);
    const elements = splitTopLevelElements(array.inner);
    const matches = elements.filter(element => readStringProperty(element.text, 'id') === id);
    if (matches.length !== 1) {
        throw new Error(matches.length === 0 ? `${label} ${id} が見つかりません` : `${label} ${id} が複数あります`);
    }
    return replaceElement(source, array.openIndex + 1, matches[0], update(matches[0].text));
}
function rebuildArrayElements(source, array, elements, texts) {
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
function applyIndexedTrackState(source, key, trackState, label) {
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
function applyIdTrackState(source, key, trackState, label) {
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
function writeTrackProperty(source, track, label) {
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
function assertMovedCutDoesNotOverlap(source, cutIndex) {
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
function replaceNumberProperty(source, property, value, label) {
    const pattern = new RegExp(`("${property}"\\s*:\\s*)${JSON_NUMBER}`, 'g');
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    return source.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
}
function readNumberProperty(source, property, label) {
    const pattern = new RegExp(`"${property}"\\s*:\\s*(${JSON_NUMBER})`, 'g');
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    return Number(matches[0][1]);
}
function readOptionalNumberProperty(source, property) {
    const pattern = new RegExp(`"${property}"\\s*:\\s*(${JSON_NUMBER})`, 'g');
    const matches = [...source.matchAll(pattern)];
    return matches.length === 1 ? Number(matches[0][1]) : undefined;
}
function normalizeTrack(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
function appendNumberProperty(source, property, value) {
    return appendJsonProperty(source, property, value);
}
function appendJsonProperty(source, property, value) {
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
function replacePropertyValue(source, property, value, label) {
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`("${escapedProperty}"\\s*:\\s*)(?:${JSON_NUMBER}|"(?:\\\\.|[^"\\\\])*"|true|false|null)`, 'g');
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    return source.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
}
function replaceTopLevelPropertyValue(source, property, value, label) {
    const located = locateTopLevelProperty(source, property);
    if (!located) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    const updated = replacePropertyValue(located.text, property, value, label);
    return source.slice(0, located.start) + updated + source.slice(located.end);
}
function removeObjectProperty(source, property) {
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
    let nextInner;
    if (elements.length === 1) {
        nextInner = inner.slice(elements[0].end);
    }
    else if (index < elements.length - 1) {
        nextInner = inner.slice(0, elements[index].start) + inner.slice(elements[index + 1].start);
    }
    else {
        nextInner = inner.slice(0, elements[index - 1].end) + inner.slice(elements[index].end);
    }
    return source.slice(0, openIndex + 1) + nextInner + source.slice(closeIndex);
}
function applyOverlayTrackState(source, trackState) {
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
function updateOverlay(source, overlayId, update) {
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
function updateOverlayVarInSource(source, overlayId, varName, nextValue) {
    if (!overlayId || !varName || typeof nextValue !== 'string') {
        throw new Error('オーバーレイのパラメータ更新値が不正です。');
    }
    return updateArrayElementById(source, 'overlays', overlayId, 'オーバーレイ', element => {
        const vars = locateObjectProperty(element, 'vars');
        const escapedName = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hasVar = new RegExp(`"${escapedName}"\\s*:`).test(vars.text);
        if (!hasVar) {
            throw new Error(`オーバーレイ ${overlayId} のパラメータ ${varName} が見つかりません。`);
        }
        const nextVarsText = replacePropertyValue(vars.text, varName, nextValue, `オーバーレイ ${overlayId} の ${varName}`);
        return element.slice(0, vars.start) + nextVarsText + element.slice(vars.end);
    });
}
function replaceElement(source, innerOffset, element, nextText) {
    const start = innerOffset + element.start;
    const end = innerOffset + element.end;
    return source.slice(0, start) + nextText + source.slice(end);
}
function readStringProperty(source, property) {
    const match = new RegExp(`"${property}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(source);
    if (!match) {
        return undefined;
    }
    try {
        return JSON.parse(`"${match[1]}"`);
    }
    catch {
        return match[1];
    }
}
function separatorForAppend(inner, elements) {
    if (elements.length >= 2) {
        return inner.slice(elements[elements.length - 2].end, elements[elements.length - 1].start);
    }
    const indent = inner.slice(0, elements[0].start).match(/(?:^|\r?\n)([ \t]*)$/)?.[1] ?? '';
    const lineEnding = inner.includes('\r\n') ? '\r\n' : '\n';
    return `,${lineEnding}${indent}`;
}
function serializeLikeExistingElement(value, inner, elements) {
    const sample = elements[0]?.text;
    if (!sample || !sample.includes('\n')) {
        return JSON.stringify(value);
    }
    const indent = inner.slice(0, elements[0].start).match(/(?:^|\r?\n)([ \t]*)$/)?.[1] ?? '';
    return JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`);
}
function indentationBeforeClose(inner) {
    if (!inner.includes('\n')) {
        return '';
    }
    const lineEnding = inner.includes('\r\n') ? '\r\n' : '\n';
    const closeIndent = inner.match(/(?:\r?\n)([ \t]*)$/)?.[1] ?? '';
    return `${lineEnding}${closeIndent}  `;
}
