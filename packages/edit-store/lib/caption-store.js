"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPTION_ZONES = void 0;
exports.parseCaptions = parseCaptions;
exports.mergeCaptionTextStyles = mergeCaptionTextStyles;
exports.shiftCaptionLine = shiftCaptionLine;
exports.updateCaptionFieldsInSource = updateCaptionFieldsInSource;
exports.updateCaptionTextStyleInSource = updateCaptionTextStyleInSource;
exports.insertCaptionLine = insertCaptionLine;
exports.removeCaptionLine = removeCaptionLine;
const edit_store_1 = require("./edit-store");
exports.CAPTION_ZONES = [
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right'
];
const JSON_NUMBER = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
function parseCaptions(source) {
    const root = JSON.parse(source);
    const values = Array.isArray(root)
        ? root
        : isRecord(root) && Array.isArray(root.captions)
            ? root.captions
            : undefined;
    if (!values) {
        throw new Error('字幕データの形式を確認できません。');
    }
    const defaultTextStyle = !Array.isArray(root) && isRecord(root) && root.default_text_style !== undefined
        ? normalizeTextStyle(root.default_text_style)
        : undefined;
    if (!Array.isArray(root) && isRecord(root)
        && root.default_text_style !== undefined && defaultTextStyle === undefined) {
        throw new Error('字幕の既定スタイルを確認できません。');
    }
    const captions = [];
    const warnings = [];
    const seenIds = new Set();
    for (let index = 0; index < values.length; index++) {
        const caption = normalizeCaption(values[index]);
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
    return {
        captions,
        ...(defaultTextStyle !== undefined ? { defaultTextStyle } : {}),
        warnings
    };
}
function mergeCaptionTextStyles(defaultStyle, captionStyle) {
    const merged = {
        ...defaultStyle,
        ...captionStyle
    };
    const stroke = mergeNestedStyle(defaultStyle?.stroke, captionStyle?.stroke);
    if (stroke && Object.keys(stroke).length > 0) {
        merged.stroke = stroke;
    }
    else {
        delete merged.stroke;
    }
    const background = mergeNestedStyle(defaultStyle?.background, captionStyle?.background);
    if (background && Object.keys(background).length > 0) {
        merged.background = background;
    }
    else {
        delete merged.background;
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}
function shiftCaptionLine(source, captionId, deltaStart, deltaEnd) {
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
function updateCaptionFieldsInSource(source, captionId, updates) {
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
function updateCaptionTextStyleInSource(source, captionId, updates) {
    if (!captionId) {
        throw new Error('字幕 ID を指定してください。');
    }
    validateTextStylePatch(updates);
    const array = locateCaptionArray(source);
    const element = findCaptionElement(array.elements, captionId);
    let nextElement = element.text;
    const existing = locateTopLevelProperty(nextElement, 'text_style');
    if (!existing) {
        const created = textStylePatchToJson(updates);
        if (Object.keys(created).length === 0) {
            return source;
        }
        nextElement = appendJsonProperty(nextElement, 'text_style', created);
    }
    else {
        const located = locateTopLevelObjectProperty(nextElement, 'text_style', `字幕 ${captionId}`);
        let textStyle = located.text;
        textStyle = updateOptionalStyleProperty(textStyle, 'color', updates.color, `字幕 ${captionId} の text_style`);
        textStyle = updateOptionalStyleProperty(textStyle, 'size_px', updates.sizePx, `字幕 ${captionId} の text_style`);
        textStyle = updateOptionalStyleProperty(textStyle, 'zone', updates.zone, `字幕 ${captionId} の text_style`);
        textStyle = updateNestedStyleObject(textStyle, 'stroke', {
            color: updates.stroke?.color,
            width_px: updates.stroke?.widthPx
        }, `字幕 ${captionId} の text_style.stroke`);
        textStyle = updateNestedStyleObject(textStyle, 'background', {
            color: updates.background?.color,
            opacity: updates.background?.opacity,
            radius_px: updates.background?.radiusPx,
            mode: updates.background?.mode
        }, `字幕 ${captionId} の text_style.background`);
        nextElement = Object.keys(JSON.parse(textStyle)).length === 0
            ? removeObjectProperty(nextElement, 'text_style')
            : nextElement.slice(0, located.start) + textStyle + nextElement.slice(located.end);
    }
    return replaceElement(source, array.openIndex + 1, element, nextElement);
}
function insertCaptionLine(source, caption) {
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
function removeCaptionLine(source, captionId) {
    const parsed = parseCaptions(source);
    const array = locateCaptionArray(source);
    const entries = captionElementEntries(array.elements);
    validateCaptionElements(entries, parsed.captions);
    const index = entries.findIndex(entry => entry.id === captionId);
    if (index < 0) {
        throw new Error(`字幕 ${captionId} が字幕データにありません。`);
    }
    const entry = entries[index];
    let nextInner;
    if (entries.length === 1) {
        nextInner = array.inner.slice(0, entry.element.start) + array.inner.slice(entry.element.end);
    }
    else if (index < entries.length - 1) {
        nextInner = array.inner.slice(0, entry.element.start)
            + array.inner.slice(entries[index + 1].element.start);
    }
    else {
        nextInner = array.inner.slice(0, entries[index - 1].element.end)
            + array.inner.slice(entry.element.end);
    }
    return replaceArrayInner(source, array, nextInner);
}
function normalizeCaption(value) {
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
            ? { segment: value.sourceRef.segment }
            : undefined;
    const textStyle = value.text_style === undefined ? undefined : normalizeTextStyle(value.text_style);
    if (sourceRef === undefined || (value.speaker !== null && typeof value.speaker !== 'string')
        || (value.text_style !== undefined && textStyle === undefined)) {
        return undefined;
    }
    return {
        id: value.id,
        start,
        end,
        text: value.text,
        speaker: value.speaker,
        sourceRef,
        edited: value.edited,
        ...(textStyle !== undefined ? { textStyle } : {})
    };
}
function locateCaptionArray(source) {
    const value = JSON.parse(source);
    const rootStart = source.search(/\S/);
    if (rootStart < 0) {
        throw new Error('字幕データの形式を確認できません。');
    }
    let openIndex;
    if (Array.isArray(value) && source[rootStart] === '[') {
        openIndex = rootStart;
    }
    else if (isRecord(value) && Array.isArray(value.captions) && source[rootStart] === '{') {
        const rootClose = (0, edit_store_1.findMatchingBracket)(source, rootStart);
        if (source.slice(rootClose + 1).trim()) {
            throw new Error('字幕データの形式を確認できません。');
        }
        const rootInner = source.slice(rootStart + 1, rootClose);
        const captionsProperties = (0, edit_store_1.splitTopLevelElements)(rootInner)
            .filter(element => /^"captions"\s*:/.test(element.text));
        if (captionsProperties.length !== 1) {
            throw new Error('字幕データの captions 配列を特定できません。');
        }
        const property = captionsProperties[0];
        const propertyOffset = rootStart + 1 + property.start;
        const colonIndex = property.text.indexOf(':');
        openIndex = source.indexOf('[', propertyOffset + colonIndex + 1);
        if (openIndex < 0 || openIndex >= rootStart + 1 + property.end) {
            throw new Error('字幕データの captions 配列を特定できません。');
        }
    }
    else {
        throw new Error('字幕データの形式を確認できません。');
    }
    const closeIndex = (0, edit_store_1.findMatchingBracket)(source, openIndex);
    if (Array.isArray(value) && source.slice(closeIndex + 1).trim()) {
        throw new Error('字幕データの形式を確認できません。');
    }
    const inner = source.slice(openIndex + 1, closeIndex);
    return {
        openIndex,
        closeIndex,
        inner,
        elements: (0, edit_store_1.splitTopLevelElements)(inner)
    };
}
function captionElementEntries(elements) {
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
function validateCaptionElements(entries, captions) {
    for (const caption of captions) {
        const matches = entries.filter(entry => entry.id === caption.id);
        if (matches.length !== 1) {
            throw new Error(matches.length === 0
                ? `字幕 ${caption.id} のレコードを特定できません。`
                : `字幕 ${caption.id} が字幕データに複数あります。`);
        }
    }
}
function findCaptionElement(elements, captionId) {
    const entries = captionElementEntries(elements);
    const matches = entries.filter(entry => entry.id === captionId);
    if (matches.length !== 1) {
        throw new Error(matches.length === 0
            ? `字幕 ${captionId} が字幕データにありません。`
            : `字幕 ${captionId} が字幕データに複数あります。`);
    }
    return matches[0].element;
}
function locateCaptionProperty(source, property, captionId) {
    const openIndex = source.search(/\S/);
    if (openIndex < 0 || source[openIndex] !== '{') {
        throw new Error(`字幕 ${captionId} のレコードを特定できません。`);
    }
    const closeIndex = (0, edit_store_1.findMatchingBracket)(source, openIndex);
    if (source.slice(closeIndex + 1).trim()) {
        throw new Error(`字幕 ${captionId} のレコードを特定できません。`);
    }
    const inner = source.slice(openIndex + 1, closeIndex);
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = (0, edit_store_1.splitTopLevelElements)(inner)
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
function replaceCaptionProperty(source, property, value, captionId) {
    const located = locateCaptionProperty(source, property, captionId);
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^("${escapedProperty}"\\s*:\\s*)(?:${JSON_NUMBER}|"(?:\\\\.|[^"\\\\])*"|true|false|null)`);
    if (!pattern.test(located.text)) {
        throw new Error(`字幕 ${captionId} の ${property} プロパティを特定できません。`);
    }
    const nextProperty = located.text.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
    return source.slice(0, located.start) + nextProperty + source.slice(located.end);
}
function readCaptionNumberProperty(source, property, captionId) {
    const located = locateCaptionProperty(source, property, captionId);
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^"${escapedProperty}"\\s*:\\s*(${JSON_NUMBER})`).exec(located.text);
    if (!match) {
        throw new Error(`字幕 ${captionId} の ${property} プロパティを特定できません。`);
    }
    return Number(match[1]);
}
function replaceElement(source, innerOffset, element, nextText) {
    const start = innerOffset + element.start;
    const end = innerOffset + element.end;
    return source.slice(0, start) + nextText + source.slice(end);
}
function replaceArrayInner(source, array, nextInner) {
    return source.slice(0, array.openIndex + 1) + nextInner + source.slice(array.closeIndex);
}
function whitespaceBeforeElement(inner, elements, index) {
    if (index <= 0) {
        return inner.slice(0, elements[0].start);
    }
    const between = inner.slice(elements[index - 1].end, elements[index].start);
    const commaIndex = between.indexOf(',');
    return commaIndex >= 0 ? between.slice(commaIndex + 1) : '';
}
function insertIntoEmptyArray(inner, serialized, lineEnding) {
    if (!inner.includes('\n')) {
        return inner ? `${inner}${serialized}${inner}` : serialized;
    }
    const lastLineStart = inner.lastIndexOf('\n') + 1;
    const closingIndent = inner.slice(lastLineStart);
    const beforeClosingIndent = inner.slice(0, lastLineStart);
    return `${beforeClosingIndent}${closingIndent}  ${serialized}${lineEnding}${closingIndent}`;
}
function serializeCaption(caption) {
    const textStyle = caption.textStyle === undefined
        ? ''
        : `, "text_style": ${JSON.stringify(textStyleToJson(caption.textStyle))}`;
    return `{ "id": ${JSON.stringify(caption.id)}, "start": ${JSON.stringify(caption.start)}, "end": ${JSON.stringify(caption.end)}, "text": ${JSON.stringify(caption.text)}, "speaker": ${JSON.stringify(caption.speaker)}, "sourceRef": ${JSON.stringify(caption.sourceRef)}, "edited": ${JSON.stringify(caption.edited)}${textStyle} }`;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function normalizeTextStyle(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const allowed = new Set(['color', 'size_px', 'stroke', 'background', 'zone']);
    if (Object.keys(value).some(key => !allowed.has(key))) {
        return undefined;
    }
    const style = {};
    if (value.color !== undefined) {
        if (!isHexColor(value.color)) {
            return undefined;
        }
        style.color = value.color;
    }
    if (value.size_px !== undefined) {
        if (typeof value.size_px !== 'number' || !Number.isFinite(value.size_px) || value.size_px <= 0) {
            return undefined;
        }
        style.sizePx = value.size_px;
    }
    if (value.zone !== undefined) {
        if (!exports.CAPTION_ZONES.includes(value.zone)) {
            return undefined;
        }
        style.zone = value.zone;
    }
    if (value.stroke !== undefined) {
        if (!isRecord(value.stroke)
            || Object.keys(value.stroke).some(key => key !== 'color' && key !== 'width_px')) {
            return undefined;
        }
        const stroke = {};
        if (value.stroke.color !== undefined) {
            if (!isHexColor(value.stroke.color)) {
                return undefined;
            }
            stroke.color = value.stroke.color;
        }
        if (value.stroke.width_px !== undefined) {
            if (typeof value.stroke.width_px !== 'number'
                || !Number.isFinite(value.stroke.width_px) || value.stroke.width_px < 0) {
                return undefined;
            }
            stroke.widthPx = value.stroke.width_px;
        }
        style.stroke = stroke;
    }
    if (value.background !== undefined) {
        if (!isRecord(value.background)
            || Object.keys(value.background).some(key => key !== 'color' && key !== 'opacity' && key !== 'radius_px' && key !== 'mode')) {
            return undefined;
        }
        const background = {};
        if (value.background.color !== undefined) {
            if (!isHexColor(value.background.color)) {
                return undefined;
            }
            background.color = value.background.color;
        }
        if (value.background.opacity !== undefined) {
            if (typeof value.background.opacity !== 'number' || !Number.isFinite(value.background.opacity)
                || value.background.opacity < 0 || value.background.opacity > 1) {
                return undefined;
            }
            background.opacity = value.background.opacity;
        }
        if (value.background.radius_px !== undefined) {
            if (typeof value.background.radius_px !== 'number' || !Number.isFinite(value.background.radius_px)
                || value.background.radius_px < 0) {
                return undefined;
            }
            background.radiusPx = value.background.radius_px;
        }
        if (value.background.mode !== undefined) {
            if (value.background.mode !== 'per-line' && value.background.mode !== 'block') {
                return undefined;
            }
            background.mode = value.background.mode;
        }
        style.background = background;
    }
    return style;
}
function textStyleToJson(style) {
    return {
        ...(style.color !== undefined ? { color: style.color } : {}),
        ...(style.sizePx !== undefined ? { size_px: style.sizePx } : {}),
        ...(style.stroke !== undefined ? {
            stroke: {
                ...(style.stroke.color !== undefined ? { color: style.stroke.color } : {}),
                ...(style.stroke.widthPx !== undefined ? { width_px: style.stroke.widthPx } : {})
            }
        } : {}),
        ...(style.background !== undefined ? {
            background: {
                ...(style.background.color !== undefined ? { color: style.background.color } : {}),
                ...(style.background.opacity !== undefined ? { opacity: style.background.opacity } : {}),
                ...(style.background.radiusPx !== undefined ? { radius_px: style.background.radiusPx } : {}),
                ...(style.background.mode !== undefined ? { mode: style.background.mode } : {})
            }
        } : {}),
        ...(style.zone !== undefined ? { zone: style.zone } : {})
    };
}
function mergeNestedStyle(base, override) {
    if (!base && !override) {
        return undefined;
    }
    return { ...base, ...override };
}
function isHexColor(value) {
    return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value);
}
function validateTextStylePatch(updates) {
    const hasUpdate = updates.color !== undefined || updates.sizePx !== undefined || updates.zone !== undefined
        || updates.stroke?.color !== undefined || updates.stroke?.widthPx !== undefined
        || updates.background?.color !== undefined || updates.background?.opacity !== undefined
        || updates.background?.radiusPx !== undefined || updates.background?.mode !== undefined;
    if (!hasUpdate) {
        throw new Error('変更する字幕スタイルのフィールドを指定してください。');
    }
    for (const color of [updates.color, updates.stroke?.color, updates.background?.color]) {
        if (color !== undefined && color !== null && !isHexColor(color)) {
            throw new Error('字幕スタイルの色は #RGB / #RRGGBB / #RRGGBBAA で指定してください。');
        }
    }
    if (updates.sizePx !== undefined && updates.sizePx !== null
        && (!Number.isFinite(updates.sizePx) || updates.sizePx <= 0)) {
        throw new Error('字幕サイズは正の数で指定してください。');
    }
    if (updates.stroke?.widthPx !== undefined && updates.stroke.widthPx !== null
        && (!Number.isFinite(updates.stroke.widthPx) || updates.stroke.widthPx < 0)) {
        throw new Error('字幕の縁取り太さは 0 以上で指定してください。');
    }
    if (updates.background?.opacity !== undefined && updates.background.opacity !== null
        && (!Number.isFinite(updates.background.opacity)
            || updates.background.opacity < 0 || updates.background.opacity > 1)) {
        throw new Error('字幕の座布団不透明度は 0〜1 で指定してください。');
    }
    if (updates.background?.radiusPx !== undefined && updates.background.radiusPx !== null
        && (!Number.isFinite(updates.background.radiusPx) || updates.background.radiusPx < 0)) {
        throw new Error('字幕の座布団角丸は 0 以上で指定してください。');
    }
    if (updates.background?.mode !== undefined && updates.background.mode !== null
        && updates.background.mode !== 'per-line' && updates.background.mode !== 'block') {
        throw new Error('字幕の座布団の形が不正です。');
    }
    if (updates.zone !== undefined && updates.zone !== null && !exports.CAPTION_ZONES.includes(updates.zone)) {
        throw new Error('字幕の位置が不正です。');
    }
}
function textStylePatchToJson(updates) {
    return {
        ...(updates.color !== undefined && updates.color !== null ? { color: updates.color } : {}),
        ...(updates.sizePx !== undefined && updates.sizePx !== null ? { size_px: updates.sizePx } : {}),
        ...(updates.stroke && Object.values(updates.stroke).some(value => value !== undefined && value !== null) ? {
            stroke: {
                ...(updates.stroke.color !== undefined && updates.stroke.color !== null
                    ? { color: updates.stroke.color } : {}),
                ...(updates.stroke.widthPx !== undefined && updates.stroke.widthPx !== null
                    ? { width_px: updates.stroke.widthPx } : {})
            }
        } : {}),
        ...(updates.background
            && Object.values(updates.background).some(value => value !== undefined && value !== null) ? {
            background: {
                ...(updates.background.color !== undefined && updates.background.color !== null
                    ? { color: updates.background.color } : {}),
                ...(updates.background.opacity !== undefined && updates.background.opacity !== null
                    ? { opacity: updates.background.opacity } : {}),
                ...(updates.background.radiusPx !== undefined && updates.background.radiusPx !== null
                    ? { radius_px: updates.background.radiusPx } : {}),
                ...(updates.background.mode !== undefined && updates.background.mode !== null
                    ? { mode: updates.background.mode } : {})
            }
        } : {}),
        ...(updates.zone !== undefined && updates.zone !== null ? { zone: updates.zone } : {})
    };
}
function locateTopLevelProperty(scopeText, key) {
    const openIndex = scopeText.search(/\S/);
    if (openIndex < 0 || scopeText[openIndex] !== '{') {
        return undefined;
    }
    const closeIndex = (0, edit_store_1.findMatchingBracket)(scopeText, openIndex);
    const inner = scopeText.slice(openIndex + 1, closeIndex);
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = (0, edit_store_1.splitTopLevelElements)(inner)
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
function locateTopLevelObjectProperty(scopeText, key, label) {
    const property = locateTopLevelProperty(scopeText, key);
    if (!property) {
        throw new Error(`${label} が見つかりません。`);
    }
    const colonIndex = property.text.indexOf(':');
    const openIndex = scopeText.indexOf('{', property.start + colonIndex + 1);
    if (openIndex < 0 || openIndex >= property.end) {
        throw new Error(`${label} が object ではありません。`);
    }
    const closeIndex = (0, edit_store_1.findMatchingBracket)(scopeText, openIndex);
    return { start: openIndex, end: closeIndex + 1, text: scopeText.slice(openIndex, closeIndex + 1) };
}
function updateNestedStyleObject(source, property, updates, label) {
    if (Object.values(updates).every(value => value === undefined)) {
        return source;
    }
    const located = locateTopLevelProperty(source, property);
    if (!located) {
        const created = Object.fromEntries(Object.entries(updates)
            .filter((entry) => entry[1] !== undefined && entry[1] !== null));
        return Object.keys(created).length > 0 ? appendJsonProperty(source, property, created) : source;
    }
    const object = locateTopLevelObjectProperty(source, property, label);
    let next = object.text;
    for (const [key, value] of Object.entries(updates)) {
        next = updateOptionalStyleProperty(next, key, value, label);
    }
    return Object.keys(JSON.parse(next)).length === 0
        ? removeObjectProperty(source, property)
        : source.slice(0, object.start) + next + source.slice(object.end);
}
function updateOptionalStyleProperty(source, property, value, label) {
    if (value === undefined) {
        return source;
    }
    const exists = locateTopLevelProperty(source, property) !== undefined;
    if (value === null) {
        return exists ? removeObjectProperty(source, property) : source;
    }
    return exists
        ? replaceTopLevelPropertyValue(source, property, value, label)
        : appendJsonProperty(source, property, value);
}
function appendJsonProperty(source, property, value) {
    const closeIndex = source.lastIndexOf('}');
    if (closeIndex < 0) {
        throw new Error('字幕スタイルのオブジェクトを特定できません。');
    }
    const beforeClose = source.slice(0, closeIndex);
    const trailingWhitespace = beforeClose.match(/\s*$/)?.[0] ?? '';
    const body = beforeClose.slice(0, beforeClose.length - trailingWhitespace.length);
    if (!body.trim().endsWith('{')) {
        if (source.includes('\n')) {
            const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
            const propertyIndent = source.match(/(?:^|\r?\n)([ \t]+)"[^"\r\n]+"\s*:/)?.[1] ?? '  ';
            return `${body},${lineEnding}${propertyIndent}"${property}": ${JSON.stringify(value)}`
                + `${trailingWhitespace}${source.slice(closeIndex)}`;
        }
        return `${body}, "${property}": ${JSON.stringify(value)}${trailingWhitespace}${source.slice(closeIndex)}`;
    }
    return `${body}"${property}": ${JSON.stringify(value)}${trailingWhitespace}${source.slice(closeIndex)}`;
}
function replaceTopLevelPropertyValue(source, property, value, label) {
    const located = locateTopLevelProperty(source, property);
    if (!located) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^("${escapedProperty}"\\s*:\\s*)(?:${JSON_NUMBER}|"(?:\\\\.|[^"\\\\])*"|true|false|null)`);
    if (!pattern.test(located.text)) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    const updated = located.text.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
    return source.slice(0, located.start) + updated + source.slice(located.end);
}
function removeObjectProperty(source, property) {
    const openIndex = source.search(/\S/);
    const closeIndex = openIndex >= 0 ? (0, edit_store_1.findMatchingBracket)(source, openIndex) : -1;
    if (openIndex < 0 || source[openIndex] !== '{' || closeIndex < 0) {
        throw new Error('字幕スタイルのオブジェクトを特定できません。');
    }
    const inner = source.slice(openIndex + 1, closeIndex);
    const elements = (0, edit_store_1.splitTopLevelElements)(inner);
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const index = elements.findIndex(element => new RegExp(`^"${escapedProperty}"\\s*:`).test(element.text));
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
