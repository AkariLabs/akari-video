"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPTION_ZONES = void 0;
exports.parseCaptions = parseCaptions;
exports.mergeCaptionTextStyles = mergeCaptionTextStyles;
exports.shiftCaptionLine = shiftCaptionLine;
exports.setCaptionTimingLine = setCaptionTimingLine;
exports.updateCaptionFieldsInSource = updateCaptionFieldsInSource;
exports.applyWordBookToCaptionsInSource = applyWordBookToCaptionsInSource;
exports.updateCaptionTextStyleInSource = updateCaptionTextStyleInSource;
exports.updateCaptionStylePresetInSource = updateCaptionStylePresetInSource;
exports.insertCaptionLine = insertCaptionLine;
exports.removeCaptionLine = removeCaptionLine;
const edit_store_1 = require("./edit-store");
const caption_words_rederive_1 = require("./caption-words-rederive");
const caption_style_preset_1 = require("./caption-style-preset");
const textstyle_catalog_1 = require("./generated/textstyle-catalog");
exports.CAPTION_ZONES = [
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right'
];
const JSON_NUMBER = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
function parseCaptions(source) {
    let root = JSON.parse(source);
    root = (0, caption_style_preset_1.applyCaptionStylePresets)(root, textstyle_catalog_1.TEXTSTYLE_CATALOG).root;
    const values = Array.isArray(root)
        ? root
        : isRecord(root) && Array.isArray(root.captions)
            ? root.captions
            : undefined;
    if (!values) {
        throw new Error('字幕データの形式を確認できません。');
    }
    const warnings = [];
    const defaultTextStyle = !Array.isArray(root) && isRecord(root) && root.default_text_style !== undefined
        ? normalizeTextStyle(root.default_text_style, keys => warnings.push(`字幕の既定スタイルに未知のフィールド（${keys.join(', ')}）があるため無視しました。`))
        : undefined;
    if (!Array.isArray(root) && isRecord(root)
        && root.default_text_style !== undefined && defaultTextStyle === undefined) {
        throw new Error('字幕の既定スタイルを確認できません。');
    }
    const captions = [];
    const seenIds = new Set();
    for (let index = 0; index < values.length; index++) {
        const caption = normalizeCaption(values[index], keys => warnings.push(`${index + 1} 番目の字幕の text_style に未知のフィールド（${keys.join(', ')}）があるため無視しました。`));
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
    const position = mergeNestedStyle(defaultStyle?.position, captionStyle?.position);
    if (position && Object.keys(position).length > 0) {
        merged.position = position;
    }
    else {
        delete merged.position;
    }
    const shadow = mergeNestedStyle(defaultStyle?.shadow, captionStyle?.shadow);
    if (shadow && Object.keys(shadow).length > 0) {
        merged.shadow = shadow;
    }
    else {
        delete merged.shadow;
    }
    const glow = mergeNestedStyle(defaultStyle?.glow, captionStyle?.glow);
    if (glow && Object.keys(glow).length > 0) {
        merged.glow = glow;
    }
    else {
        delete merged.glow;
    }
    const animation = mergeNestedStyle(defaultStyle?.animation, captionStyle?.animation);
    if (animation && Object.keys(animation).length > 0) {
        merged.animation = animation;
    }
    else {
        delete merged.animation;
    }
    const layout = mergeNestedStyle(defaultStyle?.layout, captionStyle?.layout);
    if (layout && Object.keys(layout).length > 0) {
        merged.layout = layout;
    }
    else {
        delete merged.layout;
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
/** 字幕の時刻と domain を絶対値で更新する。undo は元値をそのまま渡して完全復元できる。 */
function setCaptionTimingLine(source, captionId, start, end, timeDomain, edited) {
    if (!captionId || !Number.isFinite(start) || !Number.isFinite(end)
        || start < 0 || end - start < 0.15) {
        throw new Error('字幕が短すぎます（0.15 秒未満にはできません）');
    }
    const array = locateCaptionArray(source);
    const element = findCaptionElement(array.elements, captionId);
    let nextElement = replaceCaptionProperty(element.text, 'start', start, captionId);
    nextElement = replaceCaptionProperty(nextElement, 'end', end, captionId);
    nextElement = replaceCaptionProperty(nextElement, 'edited', edited, captionId);
    nextElement = updateOptionalStyleProperty(nextElement, 'time_domain', timeDomain, `字幕 ${captionId}`);
    return replaceElement(source, array.openIndex + 1, element, nextElement);
}
function updateCaptionFieldsInSource(source, captionId, updates) {
    if (!captionId) {
        throw new Error('字幕 ID を指定してください。');
    }
    if (updates.text === undefined && updates.speaker === undefined && updates.unrecognized === undefined) {
        throw new Error('変更する字幕フィールドを指定してください。');
    }
    if (updates.text !== undefined && (typeof updates.text !== 'string' || !updates.text.trim())) {
        throw new Error('字幕のテキストは空にできません。');
    }
    if (updates.speaker !== undefined && updates.speaker !== null && typeof updates.speaker !== 'string') {
        throw new Error('字幕の話者は文字列または null で指定してください。');
    }
    let unrecognized;
    if (updates.unrecognized !== undefined && updates.unrecognized !== null) {
        if (!Array.isArray(updates.unrecognized)) {
            throw new Error('字幕の未認識区間は配列または null で指定してください。');
        }
        unrecognized = updates.unrecognized.map(span => {
            if (!span || typeof span !== 'object'
                || typeof span.start !== 'number' || !Number.isFinite(span.start)
                || typeof span.end !== 'number' || !Number.isFinite(span.end)
                || span.end <= span.start) {
                throw new Error('字幕の未認識区間が不正です。');
            }
            return { start: span.start, end: span.end };
        }).sort((left, right) => left.start - right.start || left.end - right.end);
    }
    const array = locateCaptionArray(source);
    const element = findCaptionElement(array.elements, captionId);
    let nextElement = element.text;
    if (updates.text !== undefined) {
        const parsed = JSON.parse(nextElement);
        const applied = (0, caption_words_rederive_1.applyCaptionTextEdit)(parsed, updates.text);
        if (applied.record !== parsed) {
            nextElement = replaceCaptionJsonProperty(nextElement, 'text', applied.record.text, captionId);
            nextElement = replaceCaptionJsonProperty(nextElement, 'edited', applied.record.edited, captionId);
            nextElement = syncOptionalCaptionProperty(nextElement, 'words', applied.record.words, captionId);
            nextElement = syncOptionalCaptionProperty(nextElement, 'display_text', applied.record.display_text, captionId);
            nextElement = syncOptionalCaptionProperty(nextElement, 'display_fragments', applied.record.display_fragments, captionId);
        }
    }
    if (updates.speaker !== undefined) {
        nextElement = replaceCaptionProperty(nextElement, 'speaker', updates.speaker, captionId);
        nextElement = replaceCaptionProperty(nextElement, 'edited', true, captionId);
    }
    if (updates.unrecognized !== undefined) {
        nextElement = syncOptionalCaptionProperty(nextElement, 'unrecognized', updates.unrecognized === null || unrecognized?.length === 0 ? undefined : unrecognized, captionId);
    }
    return replaceElement(source, array.openIndex + 1, element, nextElement);
}
function applyWordBookToCaptionsInSource(source, changes) {
    if (changes.length === 0) {
        return source;
    }
    let output = source;
    for (const change of changes) {
        const array = locateCaptionArray(output);
        const element = findCaptionElement(array.elements, change.id);
        let nextElement = element.text;
        nextElement = replaceCaptionJsonProperty(nextElement, 'text', change.text, change.id);
        nextElement = syncOptionalCaptionProperty(nextElement, 'words', change.words, change.id);
        nextElement = syncOptionalCaptionProperty(nextElement, 'display_text', change.display_text, change.id);
        nextElement = syncOptionalCaptionProperty(nextElement, 'display_fragments', change.display_fragments, change.id);
        output = replaceElement(output, array.openIndex + 1, element, nextElement);
    }
    return output;
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
function updateCaptionStylePresetInSource(source, captionIds, presetId) {
    if (captionIds.length === 0) {
        throw new Error('字幕 ID を 1 件以上指定してください。');
    }
    if (presetId !== null && !/^[a-z0-9][a-z0-9-]*$/.test(presetId)) {
        throw new Error('字幕テンプレ ID の形式が不正です。');
    }
    const ids = [...new Set(captionIds)];
    const array = locateCaptionArray(source);
    const elementsById = new Map();
    for (const entry of captionElementEntries(array.elements)) {
        if (!entry.id)
            continue;
        const matches = elementsById.get(entry.id) ?? [];
        matches.push(entry.element);
        elementsById.set(entry.id, matches);
    }
    const targets = [];
    for (const captionId of ids) {
        const matches = elementsById.get(captionId) ?? [];
        if (matches.length !== 1) {
            throw new Error(matches.length === 0
                ? `字幕 ${captionId} が字幕データにありません。`
                : `字幕 ${captionId} が字幕データに複数あります。`);
        }
        targets.push({ captionId, element: matches[0] });
    }
    let output = source;
    let changed = 0;
    for (const { captionId, element } of targets.sort((left, right) => right.element.start - left.element.start)) {
        const record = JSON.parse(element.text);
        const hasPreset = Object.prototype.hasOwnProperty.call(record, 'style_preset');
        if (presetId === null) {
            if (!hasPreset)
                continue;
            const nextElement = removeObjectProperty(element.text, 'style_preset');
            output = replaceElement(output, array.openIndex + 1, element, nextElement);
            changed++;
            continue;
        }
        if (hasPreset && record.style_preset === presetId)
            continue;
        let nextElement;
        if (hasPreset) {
            nextElement = replaceCaptionJsonProperty(element.text, 'style_preset', presetId, captionId);
        }
        else {
            const textStyle = locateTopLevelProperty(element.text, 'text_style');
            if (!textStyle) {
                nextElement = appendJsonProperty(element.text, 'style_preset', presetId);
            }
            else {
                const lineStart = Math.max(element.text.lastIndexOf('\n', textStyle.start - 1), element.text.lastIndexOf('\r', textStyle.start - 1));
                const separator = lineStart >= 0
                    ? `${element.text.includes('\r\n') ? '\r\n' : '\n'}${element.text.slice(lineStart + 1, textStyle.start)}`
                    : ' ';
                nextElement = element.text.slice(0, textStyle.start)
                    + `"style_preset": ${JSON.stringify(presetId)},${separator}`
                    + element.text.slice(textStyle.start);
            }
        }
        output = replaceElement(output, array.openIndex + 1, element, nextElement);
        changed++;
    }
    return { source: output, changed };
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
function normalizeCaption(value, onTextStyleUnknownKeys) {
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
    const textStyle = value.text_style === undefined
        ? undefined
        : normalizeTextStyle(value.text_style, onTextStyleUnknownKeys);
    if (sourceRef === undefined || (value.speaker !== null && typeof value.speaker !== 'string')
        || (value.text_style !== undefined && textStyle === undefined)) {
        return undefined;
    }
    const unrecognized = normalizeUnrecognized(value.unrecognized);
    return {
        id: value.id,
        start,
        end,
        text: value.text,
        speaker: value.speaker,
        sourceRef,
        edited: value.edited,
        ...(unrecognized !== undefined ? { unrecognized } : {}),
        ...(value.time_domain === 'source' || value.time_domain === 'output'
            ? { timeDomain: value.time_domain } : {}),
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
function replaceCaptionJsonProperty(source, property, value, captionId) {
    const located = locateCaptionProperty(source, property, captionId);
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^("${escapedProperty}"\\s*:\\s*)[\\s\\S]*$`);
    if (!pattern.test(located.text)) {
        throw new Error(`字幕 ${captionId} の ${property} プロパティを特定できません。`);
    }
    const nextProperty = located.text.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
    return source.slice(0, located.start) + nextProperty + source.slice(located.end);
}
function syncOptionalCaptionProperty(source, property, value, captionId) {
    const exists = locateTopLevelProperty(source, property) !== undefined;
    if (value === undefined) {
        return exists ? removeObjectProperty(source, property) : source;
    }
    return exists
        ? replaceCaptionJsonProperty(source, property, value, captionId)
        : appendJsonProperty(source, property, value);
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
    const parts = [
        `"id": ${JSON.stringify(caption.id)}`,
        `"start": ${JSON.stringify(caption.start)}`,
        `"end": ${JSON.stringify(caption.end)}`,
        `"text": ${JSON.stringify(caption.text)}`,
        `"speaker": ${JSON.stringify(caption.speaker)}`,
        `"sourceRef": ${JSON.stringify(caption.sourceRef)}`,
        `"edited": ${JSON.stringify(caption.edited)}`
    ];
    if (caption.src !== undefined) {
        parts.push(`"src": ${JSON.stringify(caption.src)}`);
    }
    if (caption.timeDomain !== undefined) {
        parts.push(`"time_domain": ${JSON.stringify(caption.timeDomain)}`);
    }
    if (caption.words !== undefined) {
        parts.push(`"words": ${JSON.stringify(caption.words)}`);
    }
    const normalizedUnrecognized = normalizeUnrecognized(caption.unrecognized);
    if (normalizedUnrecognized !== undefined) {
        parts.push(`"unrecognized": ${JSON.stringify(normalizedUnrecognized)}`);
    }
    if (caption.style !== undefined) {
        parts.push(`"style": ${JSON.stringify(caption.style)}`);
    }
    if (caption.displayText !== undefined) {
        parts.push(`"display_text": ${JSON.stringify(caption.displayText)}`);
    }
    if (caption.displayFragments !== undefined) {
        parts.push(`"display_fragments": ${JSON.stringify(caption.displayFragments)}`);
    }
    if (caption.stylePreset !== undefined) {
        parts.push(`"style_preset": ${JSON.stringify(caption.stylePreset)}`);
    }
    if (caption.textStyle !== undefined) {
        parts.push(`"text_style": ${JSON.stringify(textStyleToJson(caption.textStyle))}`);
    }
    const schemaKeys = new Set([
        'id', 'start', 'end', 'text', 'speaker', 'sourceRef', 'edited', 'src',
        'time_domain', 'words', 'unrecognized', 'style', 'display_text',
        'display_fragments', 'style_preset', 'text_style'
    ]);
    for (const [key, value] of Object.entries(caption.extra ?? {})) {
        if (value !== undefined && !schemaKeys.has(key)) {
            parts.push(`${JSON.stringify(key)}: ${JSON.stringify(value)}`);
        }
    }
    return `{ ${parts.join(', ')} }`;
}
function normalizeUnrecognized(value) {
    if (!Array.isArray(value))
        return undefined;
    if (!value.every(span => isRecord(span)
        && isFiniteNumber(span.start) && isFiniteNumber(span.end) && span.end > span.start)) {
        return undefined;
    }
    const spans = value.map(span => {
        const record = span;
        return { start: record.start, end: record.end };
    });
    return spans.length > 0 ? spans : undefined;
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function isFinitePositive(value) {
    return isFiniteNumber(value) && value > 0;
}
function isFiniteNonNegative(value) {
    return isFiniteNumber(value) && value >= 0;
}
function isFiniteInRange(value, min, max) {
    return isFiniteNumber(value) && value >= min && value <= max;
}
// captions.schema.json の $defs/textStyle が受理する全プロパティ名（2026-08-10 拡張）。
// これ以外のキーは「未知」として個別に無視する（行やスタイル全体は破棄しない）。
const TEXT_STYLE_KEYS = new Set([
    'color', 'size_px', 'reference_height_px', 'font_family', 'font_weight', 'weight', 'italic', 'underline',
    'letter_spacing_em', 'line_height', 'align', 'vertical_align', 'vertical',
    'text_transform', 'max_width_pct', 'text_anchor', 'position', 'shadow', 'glow',
    'animation', 'stroke', 'background', 'zone', 'layout'
]);
const TEXT_TRANSFORM_VALUES = new Set(['upper', 'uppercase', 'lower', 'lowercase', 'title', 'capitalize', 'none']);
const TEXT_ANCHOR_VALUES = new Set(['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']);
/**
 * captions.schema.json の textStyle を受理する。value がそもそも object でなければ
 * （＝真に不正なデータ）undefined を返し呼び出し側で行ごと破棄する。value が object なら
 * 以後は「未知キー・不正値は無視して他は取り込む」— 1 フィールドの欠陥で残りやレコード全体を
 * 道連れにしない（2026-08-10 caption-style-allowlist の中心的な設計判断）。
 */
function normalizeTextStyle(value, onUnknownKeys) {
    if (!isRecord(value)) {
        return undefined;
    }
    const unknownKeys = Object.keys(value).filter(key => !TEXT_STYLE_KEYS.has(key));
    if (unknownKeys.length > 0) {
        onUnknownKeys?.(unknownKeys);
    }
    const style = {};
    if (isHexColor(value.color)) {
        style.color = value.color;
    }
    if (isFinitePositive(value.size_px)) {
        style.sizePx = value.size_px;
    }
    if (Number.isInteger(value.reference_height_px) && value.reference_height_px >= 1) {
        style.referenceHeightPx = value.reference_height_px;
    }
    if (typeof value.font_family === 'string' && value.font_family !== '') {
        style.fontFamily = value.font_family;
    }
    if (Number.isInteger(value.font_weight) && value.font_weight >= 1 && value.font_weight <= 1000) {
        style.fontWeight = value.font_weight;
    }
    if (Number.isInteger(value.weight) && value.weight >= 100 && value.weight <= 900) {
        style.weight = value.weight;
    }
    if (typeof value.italic === 'boolean') {
        style.italic = value.italic;
    }
    if (typeof value.underline === 'boolean') {
        style.underline = value.underline;
    }
    if (isFiniteNumber(value.letter_spacing_em)) {
        style.letterSpacingEm = value.letter_spacing_em;
    }
    if (isFinitePositive(value.line_height)) {
        style.lineHeight = value.line_height;
    }
    if (value.align === 'left' || value.align === 'center' || value.align === 'right') {
        style.align = value.align;
    }
    if (value.vertical_align === 'top' || value.vertical_align === 'middle' || value.vertical_align === 'bottom') {
        style.verticalAlign = value.vertical_align;
    }
    if (typeof value.vertical === 'boolean') {
        style.vertical = value.vertical;
    }
    if (typeof value.text_transform === 'string' && TEXT_TRANSFORM_VALUES.has(value.text_transform)) {
        style.textTransform = value.text_transform;
    }
    if (isFiniteNumber(value.max_width_pct) && value.max_width_pct > 0 && value.max_width_pct < 100) {
        style.maxWidthPct = value.max_width_pct;
    }
    if (typeof value.text_anchor === 'string' && TEXT_ANCHOR_VALUES.has(value.text_anchor)) {
        style.textAnchor = value.text_anchor;
    }
    const position = normalizeCaptionPosition(value.position);
    if (position) {
        style.position = position;
    }
    const shadow = normalizeCaptionShadow(value.shadow);
    if (shadow) {
        style.shadow = shadow;
    }
    const glow = normalizeCaptionGlow(value.glow);
    if (glow) {
        style.glow = glow;
    }
    const animation = normalizeCaptionAnimation(value.animation);
    if (animation) {
        style.animation = animation;
    }
    if (isRecord(value.stroke)) {
        const stroke = {};
        if (value.stroke.method === 'webkit-outline') {
            stroke.method = 'webkit-outline';
        }
        if (isHexColor(value.stroke.color)) {
            stroke.color = value.stroke.color;
        }
        if (isFiniteNonNegative(value.stroke.width_px)) {
            stroke.widthPx = value.stroke.width_px;
        }
        if (Object.keys(stroke).length > 0) {
            style.stroke = stroke;
        }
    }
    if (isRecord(value.background)) {
        const background = {};
        if (isHexColor(value.background.color)) {
            background.color = value.background.color;
        }
        if (isFiniteInRange(value.background.opacity, 0, 1)) {
            background.opacity = value.background.opacity;
        }
        if (isFiniteNonNegative(value.background.radius_px)) {
            background.radiusPx = value.background.radius_px;
        }
        if (isFiniteNonNegative(value.background.padding_px)) {
            background.paddingPx = value.background.padding_px;
        }
        if (isFiniteNonNegative(value.background.width_pct)) {
            background.widthPct = value.background.width_pct;
        }
        if (isFiniteNonNegative(value.background.height_pct)) {
            background.heightPct = value.background.height_pct;
        }
        if (isFiniteNumber(value.background.offset_x)) {
            background.offsetX = value.background.offset_x;
        }
        if (isFiniteNumber(value.background.offset_y)) {
            background.offsetY = value.background.offset_y;
        }
        if (value.background.mode === 'per-line' || value.background.mode === 'block') {
            background.mode = value.background.mode;
        }
        if (Object.keys(background).length > 0) {
            style.background = background;
        }
    }
    // schema は zone と layout の併用を禁じる（$defs/textStyle の allOf/not）。両方有効なら
    // 既定 5 フィールドの一員として先に対応していた zone を優先し layout を落とす。
    // reference_height_px（zone 方式の基準高さ）と layout の併用も同じく禁止で、同じ向き
    // （zone 方式側を残し layout を落とす）に揃える。
    const layout = normalizeCaptionLayout(value.layout);
    if (value.zone !== undefined && exports.CAPTION_ZONES.includes(value.zone)) {
        style.zone = value.zone;
    }
    else if (layout && style.referenceHeightPx === undefined) {
        style.layout = layout;
    }
    return style;
}
function normalizeCaptionPosition(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const position = {};
    if (isFiniteNumber(value.x)) {
        position.x = value.x;
    }
    if (isFiniteNumber(value.y)) {
        position.y = value.y;
    }
    return Object.keys(position).length > 0 ? position : undefined;
}
// shadow と glow は「color 必須 + 残りは数値の任意項目」という同じ形だが、任意項目の集合が
// 違う（shadow: blur/distance/angle、glow: density/spread/offset）ため型ごと分けて丸め、
// 片方のフィールドがもう片方へ紛れ込んで無言でラウンドトリップから消えるのを防ぐ。
// color が無ければ消費側は影を組めない（render-cut と同じ解釈）ため、両方とも丸ごと捨てる。
function normalizeCaptionShadow(value) {
    if (!isRecord(value) || !isHexColor(value.color)) {
        return undefined;
    }
    const shadow = { color: value.color };
    if (isFiniteInRange(value.opacity, 0, 1)) {
        shadow.opacity = value.opacity;
    }
    if (isFiniteNonNegative(value.blur_px)) {
        shadow.blurPx = value.blur_px;
    }
    if (isFiniteNonNegative(value.distance_px)) {
        shadow.distancePx = value.distance_px;
    }
    if (isFiniteNumber(value.angle_deg)) {
        shadow.angleDeg = value.angle_deg;
    }
    return shadow;
}
function normalizeCaptionGlow(value) {
    if (!isRecord(value) || !isHexColor(value.color)) {
        return undefined;
    }
    const glow = { color: value.color };
    if (isFiniteNonNegative(value.density)) {
        glow.density = value.density;
    }
    if (isFiniteNonNegative(value.spread)) {
        glow.spread = value.spread;
    }
    if (isFiniteNumber(value.offset_x)) {
        glow.offsetX = value.offset_x;
    }
    if (isFiniteNumber(value.offset_y)) {
        glow.offsetY = value.offset_y;
    }
    return glow;
}
function normalizeCaptionAnimationSlot(value) {
    if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') {
        return undefined;
    }
    const slot = { id: value.id };
    if (isFinitePositive(value.duration_sec)) {
        slot.durationSec = value.duration_sec;
    }
    if (typeof value.ease === 'string' && value.ease !== '') {
        slot.ease = value.ease;
    }
    if (isFinitePositive(value.amp)) {
        slot.amp = value.amp;
    }
    return slot;
}
function normalizeCaptionAnimation(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const animation = {};
    const inSlot = normalizeCaptionAnimationSlot(value.in);
    if (inSlot) {
        animation.in = inSlot;
    }
    const loopSlot = normalizeCaptionAnimationSlot(value.loop);
    if (loopSlot) {
        animation.loop = loopSlot;
    }
    const outSlot = normalizeCaptionAnimationSlot(value.out);
    if (outSlot) {
        animation.out = outSlot;
    }
    return Object.keys(animation).length > 0 ? animation : undefined;
}
// layout は 7 プロパティ全てが揃って初めて意味を持つ（schema の required 一括指定）ため、
// 一部だけ有効でも採用しない。
function normalizeCaptionLayout(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const validReferenceWidth = Number.isInteger(value.reference_width_px) && value.reference_width_px >= 1;
    const validReferenceHeight = Number.isInteger(value.reference_height_px) && value.reference_height_px >= 1;
    const validWidth = isFiniteNumber(value.width_px) && value.width_px > 0;
    if (value.mode !== 'reference-pixel'
        || !validReferenceWidth
        || !validReferenceHeight
        || !isFiniteNonNegative(value.left_px)
        || !validWidth
        || !isFiniteNonNegative(value.bottom_px)
        || value.text_align !== 'center'
        || value.max_lines !== 1) {
        return undefined;
    }
    return {
        mode: 'reference-pixel',
        referenceWidthPx: value.reference_width_px,
        referenceHeightPx: value.reference_height_px,
        leftPx: value.left_px,
        widthPx: value.width_px,
        bottomPx: value.bottom_px,
        textAlign: 'center',
        maxLines: 1
    };
}
function textStyleToJson(style) {
    return {
        ...(style.color !== undefined ? { color: style.color } : {}),
        ...(style.sizePx !== undefined ? { size_px: style.sizePx } : {}),
        ...(style.referenceHeightPx !== undefined ? { reference_height_px: style.referenceHeightPx } : {}),
        ...(style.fontFamily !== undefined ? { font_family: style.fontFamily } : {}),
        ...(style.fontWeight !== undefined ? { font_weight: style.fontWeight } : {}),
        ...(style.weight !== undefined ? { weight: style.weight } : {}),
        ...(style.italic !== undefined ? { italic: style.italic } : {}),
        ...(style.underline !== undefined ? { underline: style.underline } : {}),
        ...(style.letterSpacingEm !== undefined ? { letter_spacing_em: style.letterSpacingEm } : {}),
        ...(style.lineHeight !== undefined ? { line_height: style.lineHeight } : {}),
        ...(style.align !== undefined ? { align: style.align } : {}),
        ...(style.verticalAlign !== undefined ? { vertical_align: style.verticalAlign } : {}),
        ...(style.vertical !== undefined ? { vertical: style.vertical } : {}),
        ...(style.textTransform !== undefined ? { text_transform: style.textTransform } : {}),
        ...(style.maxWidthPct !== undefined ? { max_width_pct: style.maxWidthPct } : {}),
        ...(style.textAnchor !== undefined ? { text_anchor: style.textAnchor } : {}),
        ...(style.position !== undefined ? {
            position: {
                ...(style.position.x !== undefined ? { x: style.position.x } : {}),
                ...(style.position.y !== undefined ? { y: style.position.y } : {})
            }
        } : {}),
        ...(style.shadow !== undefined ? {
            shadow: {
                color: style.shadow.color,
                ...(style.shadow.opacity !== undefined ? { opacity: style.shadow.opacity } : {}),
                ...(style.shadow.blurPx !== undefined ? { blur_px: style.shadow.blurPx } : {}),
                ...(style.shadow.distancePx !== undefined ? { distance_px: style.shadow.distancePx } : {}),
                ...(style.shadow.angleDeg !== undefined ? { angle_deg: style.shadow.angleDeg } : {})
            }
        } : {}),
        ...(style.glow !== undefined ? {
            glow: {
                color: style.glow.color,
                ...(style.glow.density !== undefined ? { density: style.glow.density } : {}),
                ...(style.glow.spread !== undefined ? { spread: style.glow.spread } : {}),
                ...(style.glow.offsetX !== undefined ? { offset_x: style.glow.offsetX } : {}),
                ...(style.glow.offsetY !== undefined ? { offset_y: style.glow.offsetY } : {})
            }
        } : {}),
        ...(style.animation !== undefined ? {
            animation: {
                ...(style.animation.in !== undefined ? { in: animationSlotToJson(style.animation.in) } : {}),
                ...(style.animation.loop !== undefined ? { loop: animationSlotToJson(style.animation.loop) } : {}),
                ...(style.animation.out !== undefined ? { out: animationSlotToJson(style.animation.out) } : {})
            }
        } : {}),
        ...(style.stroke !== undefined ? {
            stroke: {
                ...(style.stroke.method !== undefined ? { method: style.stroke.method } : {}),
                ...(style.stroke.color !== undefined ? { color: style.stroke.color } : {}),
                ...(style.stroke.widthPx !== undefined ? { width_px: style.stroke.widthPx } : {})
            }
        } : {}),
        ...(style.background !== undefined ? {
            background: {
                ...(style.background.color !== undefined ? { color: style.background.color } : {}),
                ...(style.background.opacity !== undefined ? { opacity: style.background.opacity } : {}),
                ...(style.background.radiusPx !== undefined ? { radius_px: style.background.radiusPx } : {}),
                ...(style.background.paddingPx !== undefined ? { padding_px: style.background.paddingPx } : {}),
                ...(style.background.widthPct !== undefined ? { width_pct: style.background.widthPct } : {}),
                ...(style.background.heightPct !== undefined ? { height_pct: style.background.heightPct } : {}),
                ...(style.background.offsetX !== undefined ? { offset_x: style.background.offsetX } : {}),
                ...(style.background.offsetY !== undefined ? { offset_y: style.background.offsetY } : {}),
                ...(style.background.mode !== undefined ? { mode: style.background.mode } : {})
            }
        } : {}),
        ...(style.zone !== undefined ? { zone: style.zone } : {}),
        ...(style.layout !== undefined ? {
            layout: {
                mode: style.layout.mode,
                reference_width_px: style.layout.referenceWidthPx,
                reference_height_px: style.layout.referenceHeightPx,
                left_px: style.layout.leftPx,
                width_px: style.layout.widthPx,
                bottom_px: style.layout.bottomPx,
                text_align: style.layout.textAlign,
                max_lines: style.layout.maxLines
            }
        } : {})
    };
}
function animationSlotToJson(slot) {
    return {
        id: slot.id,
        ...(slot.durationSec !== undefined ? { duration_sec: slot.durationSec } : {}),
        ...(slot.ease !== undefined ? { ease: slot.ease } : {}),
        ...(slot.amp !== undefined ? { amp: slot.amp } : {})
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
