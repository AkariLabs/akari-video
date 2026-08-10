import { findMatchingBracket, splitTopLevelElements, type SourceElement } from './edit-store';

export const CAPTION_ZONES = [
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right'
] as const;

export type CaptionZone = typeof CAPTION_ZONES[number];
export type CaptionBackgroundMode = 'per-line' | 'block';
export type CaptionAlign = 'left' | 'center' | 'right';
export type CaptionVerticalAlign = 'top' | 'middle' | 'bottom';
export type CaptionTextTransform = 'upper' | 'uppercase' | 'lower' | 'lowercase' | 'title' | 'capitalize' | 'none';
export type CaptionTextAnchor = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';
export type CaptionStrokeMethod = 'webkit-outline';

export interface CaptionAnimationSlot {
    id: string;
    durationSec?: number;
    ease?: string;
    amp?: number;
}

export interface CaptionAnimation {
    in?: CaptionAnimationSlot;
    loop?: CaptionAnimationSlot;
    out?: CaptionAnimationSlot;
}

export interface CaptionShadow {
    color: string;
    opacity?: number;
    blurPx?: number;
    distancePx?: number;
    angleDeg?: number;
}

export interface CaptionGlow {
    color: string;
    density?: number;
    spread?: number;
    offsetX?: number;
    offsetY?: number;
}

export interface CaptionPosition {
    x?: number;
    y?: number;
}

export interface CaptionLayout {
    mode: 'reference-pixel';
    referenceWidthPx: number;
    referenceHeightPx: number;
    leftPx: number;
    widthPx: number;
    bottomPx: number;
    textAlign: 'center';
    maxLines: 1;
}

export interface CaptionTextStyle {
    color?: string;
    sizePx?: number;
    fontFamily?: string;
    fontWeight?: number;
    weight?: number;
    italic?: boolean;
    underline?: boolean;
    letterSpacingEm?: number;
    lineHeight?: number;
    align?: CaptionAlign;
    verticalAlign?: CaptionVerticalAlign;
    vertical?: boolean;
    textTransform?: CaptionTextTransform;
    maxWidthPct?: number;
    textAnchor?: CaptionTextAnchor;
    position?: CaptionPosition;
    shadow?: CaptionShadow;
    glow?: CaptionGlow;
    animation?: CaptionAnimation;
    stroke?: {
        method?: CaptionStrokeMethod;
        color?: string;
        widthPx?: number;
    };
    background?: {
        color?: string;
        opacity?: number;
        radiusPx?: number;
        paddingPx?: number;
        widthPct?: number;
        heightPct?: number;
        offsetX?: number;
        offsetY?: number;
        mode?: CaptionBackgroundMode;
    };
    zone?: CaptionZone;
    layout?: CaptionLayout;
}

// updateCaptionTextStyleInSource / CaptionTextStylePatch は今回 (2026-08-10
// caption-style-allowlist) の対象外。書き込み元はインスペクターUIのみで、UI側は
// まだ既存5フィールド（color/size_px/stroke/background/zone）しか送らない
// （font_family 等の編集タブは P0-3 以降の別タスク）。拡張フィールドの保存は
// updateCaptionTextStyleInSource がソース文字列を直接外科編集する実装のため、
// パッチが対応しないフィールドも触れずに素通しで残る。
export interface CaptionTextStylePatch {
    color?: string | null;
    sizePx?: number | null;
    stroke?: {
        color?: string | null;
        widthPx?: number | null;
    };
    background?: {
        color?: string | null;
        opacity?: number | null;
        radiusPx?: number | null;
        mode?: CaptionBackgroundMode | null;
    };
    zone?: CaptionZone | null;
}

export interface CaptionRecord {
    id: string;
    start: number;
    end: number;
    text: string;
    speaker: string | null;
    sourceRef: { segment: number } | null;
    edited: boolean;
    textStyle?: CaptionTextStyle;
}

const JSON_NUMBER = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';

export function parseCaptions(source: string): {
    captions: CaptionRecord[];
    defaultTextStyle?: CaptionTextStyle;
    warnings: string[];
} {
    const root = JSON.parse(source) as unknown;
    const values = Array.isArray(root)
        ? root
        : isRecord(root) && Array.isArray(root.captions)
            ? root.captions
            : undefined;
    if (!values) {
        throw new Error('字幕データの形式を確認できません。');
    }
    const warnings: string[] = [];
    const defaultTextStyle = !Array.isArray(root) && isRecord(root) && root.default_text_style !== undefined
        ? normalizeTextStyle(root.default_text_style, keys => warnings.push(
            `字幕の既定スタイルに未知のフィールド（${keys.join(', ')}）があるため無視しました。`
        ))
        : undefined;
    if (!Array.isArray(root) && isRecord(root)
        && root.default_text_style !== undefined && defaultTextStyle === undefined) {
        throw new Error('字幕の既定スタイルを確認できません。');
    }
    const captions: CaptionRecord[] = [];
    const seenIds = new Set<string>();
    for (let index = 0; index < values.length; index++) {
        const caption = normalizeCaption(values[index], keys => warnings.push(
            `${index + 1} 番目の字幕の text_style に未知のフィールド（${keys.join(', ')}）があるため無視しました。`
        ));
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

export function mergeCaptionTextStyles(
    defaultStyle: CaptionTextStyle | undefined,
    captionStyle: CaptionTextStyle | undefined
): CaptionTextStyle | undefined {
    const merged: CaptionTextStyle = {
        ...defaultStyle,
        ...captionStyle
    };
    const stroke = mergeNestedStyle(defaultStyle?.stroke, captionStyle?.stroke);
    if (stroke && Object.keys(stroke).length > 0) {
        merged.stroke = stroke;
    } else {
        delete merged.stroke;
    }
    const background = mergeNestedStyle(defaultStyle?.background, captionStyle?.background);
    if (background && Object.keys(background).length > 0) {
        merged.background = background;
    } else {
        delete merged.background;
    }
    const position = mergeNestedStyle(defaultStyle?.position, captionStyle?.position);
    if (position && Object.keys(position).length > 0) {
        merged.position = position;
    } else {
        delete merged.position;
    }
    const shadow = mergeNestedStyle(defaultStyle?.shadow, captionStyle?.shadow);
    if (shadow && Object.keys(shadow).length > 0) {
        merged.shadow = shadow;
    } else {
        delete merged.shadow;
    }
    const glow = mergeNestedStyle(defaultStyle?.glow, captionStyle?.glow);
    if (glow && Object.keys(glow).length > 0) {
        merged.glow = glow;
    } else {
        delete merged.glow;
    }
    const animation = mergeNestedStyle(defaultStyle?.animation, captionStyle?.animation);
    if (animation && Object.keys(animation).length > 0) {
        merged.animation = animation;
    } else {
        delete merged.animation;
    }
    const layout = mergeNestedStyle(defaultStyle?.layout, captionStyle?.layout);
    if (layout && Object.keys(layout).length > 0) {
        merged.layout = layout;
    } else {
        delete merged.layout;
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
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

export function updateCaptionTextStyleInSource(
    source: string,
    captionId: string,
    updates: CaptionTextStylePatch
): string {
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
    } else {
        const located = locateTopLevelObjectProperty(nextElement, 'text_style', `字幕 ${captionId}`);
        let textStyle = located.text;
        textStyle = updateOptionalStyleProperty(textStyle, 'color', updates.color, `字幕 ${captionId} の text_style`);
        textStyle = updateOptionalStyleProperty(textStyle, 'size_px', updates.sizePx, `字幕 ${captionId} の text_style`);
        textStyle = updateOptionalStyleProperty(textStyle, 'zone', updates.zone, `字幕 ${captionId} の text_style`);
        textStyle = updateNestedStyleObject(
            textStyle,
            'stroke',
            {
                color: updates.stroke?.color,
                width_px: updates.stroke?.widthPx
            },
            `字幕 ${captionId} の text_style.stroke`
        );
        textStyle = updateNestedStyleObject(
            textStyle,
            'background',
            {
                color: updates.background?.color,
                opacity: updates.background?.opacity,
                radius_px: updates.background?.radiusPx,
                mode: updates.background?.mode
            },
            `字幕 ${captionId} の text_style.background`
        );
        nextElement = Object.keys(JSON.parse(textStyle) as Record<string, unknown>).length === 0
            ? removeObjectProperty(nextElement, 'text_style')
            : nextElement.slice(0, located.start) + textStyle + nextElement.slice(located.end);
    }
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

function normalizeCaption(
    value: any,
    onTextStyleUnknownKeys?: (keys: string[]) => void
): CaptionRecord | undefined {
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
    const textStyle = value.text_style === undefined
        ? undefined
        : normalizeTextStyle(value.text_style, onTextStyleUnknownKeys);
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
    const value = JSON.parse(source) as unknown;
    const rootStart = source.search(/\S/);
    if (rootStart < 0) {
        throw new Error('字幕データの形式を確認できません。');
    }
    let openIndex: number;
    if (Array.isArray(value) && source[rootStart] === '[') {
        openIndex = rootStart;
    } else if (isRecord(value) && Array.isArray(value.captions) && source[rootStart] === '{') {
        const rootClose = findMatchingBracket(source, rootStart);
        if (source.slice(rootClose + 1).trim()) {
            throw new Error('字幕データの形式を確認できません。');
        }
        const rootInner = source.slice(rootStart + 1, rootClose);
        const captionsProperties = splitTopLevelElements(rootInner)
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
    } else {
        throw new Error('字幕データの形式を確認できません。');
    }
    const closeIndex = findMatchingBracket(source, openIndex);
    if (Array.isArray(value) && source.slice(closeIndex + 1).trim()) {
        throw new Error('字幕データの形式を確認できません。');
    }
    const inner = source.slice(openIndex + 1, closeIndex);
    return {
        openIndex,
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
    const textStyle = caption.textStyle === undefined
        ? ''
        : `, "text_style": ${JSON.stringify(textStyleToJson(caption.textStyle))}`;
    return `{ "id": ${JSON.stringify(caption.id)}, "start": ${JSON.stringify(caption.start)}, "end": ${JSON.stringify(caption.end)}, "text": ${JSON.stringify(caption.text)}, "speaker": ${JSON.stringify(caption.speaker)}, "sourceRef": ${JSON.stringify(caption.sourceRef)}, "edited": ${JSON.stringify(caption.edited)}${textStyle} }`;
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePositive(value: unknown): value is number {
    return isFiniteNumber(value) && value > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
    return isFiniteNumber(value) && value >= 0;
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
    return isFiniteNumber(value) && value >= min && value <= max;
}

// captions.schema.json の $defs/textStyle が受理する全プロパティ名（2026-08-10 拡張）。
// これ以外のキーは「未知」として個別に無視する（行やスタイル全体は破棄しない）。
const TEXT_STYLE_KEYS = new Set([
    'color', 'size_px', 'font_family', 'font_weight', 'weight', 'italic', 'underline',
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
function normalizeTextStyle(
    value: unknown,
    onUnknownKeys?: (keys: string[]) => void
): CaptionTextStyle | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const unknownKeys = Object.keys(value).filter(key => !TEXT_STYLE_KEYS.has(key));
    if (unknownKeys.length > 0) {
        onUnknownKeys?.(unknownKeys);
    }
    const style: CaptionTextStyle = {};
    if (isHexColor(value.color)) {
        style.color = value.color;
    }
    if (isFinitePositive(value.size_px)) {
        style.sizePx = value.size_px;
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
        style.textTransform = value.text_transform as CaptionTextTransform;
    }
    if (isFiniteNumber(value.max_width_pct) && value.max_width_pct > 0 && value.max_width_pct < 100) {
        style.maxWidthPct = value.max_width_pct;
    }
    if (typeof value.text_anchor === 'string' && TEXT_ANCHOR_VALUES.has(value.text_anchor)) {
        style.textAnchor = value.text_anchor as CaptionTextAnchor;
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
        const stroke: NonNullable<CaptionTextStyle['stroke']> = {};
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
        const background: NonNullable<CaptionTextStyle['background']> = {};
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
    const layout = normalizeCaptionLayout(value.layout);
    if (value.zone !== undefined && CAPTION_ZONES.includes(value.zone as CaptionZone)) {
        style.zone = value.zone as CaptionZone;
    } else if (layout) {
        style.layout = layout;
    }
    return style;
}

function normalizeCaptionPosition(value: unknown): CaptionPosition | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const position: CaptionPosition = {};
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
function normalizeCaptionShadow(value: unknown): CaptionShadow | undefined {
    if (!isRecord(value) || !isHexColor(value.color)) {
        return undefined;
    }
    const shadow: CaptionShadow = { color: value.color };
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

function normalizeCaptionGlow(value: unknown): CaptionGlow | undefined {
    if (!isRecord(value) || !isHexColor(value.color)) {
        return undefined;
    }
    const glow: CaptionGlow = { color: value.color };
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

function normalizeCaptionAnimationSlot(value: unknown): CaptionAnimationSlot | undefined {
    if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') {
        return undefined;
    }
    const slot: CaptionAnimationSlot = { id: value.id };
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

function normalizeCaptionAnimation(value: unknown): CaptionAnimation | undefined {
    if (!isRecord(value)) {
        return undefined;
    }
    const animation: CaptionAnimation = {};
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
function normalizeCaptionLayout(value: unknown): CaptionLayout | undefined {
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

function textStyleToJson(style: CaptionTextStyle): Record<string, unknown> {
    return {
        ...(style.color !== undefined ? { color: style.color } : {}),
        ...(style.sizePx !== undefined ? { size_px: style.sizePx } : {}),
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

function animationSlotToJson(slot: CaptionAnimationSlot): Record<string, unknown> {
    return {
        id: slot.id,
        ...(slot.durationSec !== undefined ? { duration_sec: slot.durationSec } : {}),
        ...(slot.ease !== undefined ? { ease: slot.ease } : {}),
        ...(slot.amp !== undefined ? { amp: slot.amp } : {})
    };
}

function mergeNestedStyle<T extends object>(base: T | undefined, override: T | undefined): T | undefined {
    if (!base && !override) {
        return undefined;
    }
    return { ...base, ...override } as T;
}

function isHexColor(value: unknown): value is string {
    return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value);
}

function validateTextStylePatch(updates: CaptionTextStylePatch): void {
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
    if (updates.zone !== undefined && updates.zone !== null && !CAPTION_ZONES.includes(updates.zone)) {
        throw new Error('字幕の位置が不正です。');
    }
}

function textStylePatchToJson(updates: CaptionTextStylePatch): Record<string, unknown> {
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

function locateTopLevelProperty(scopeText: string, key: string): SourceElement | undefined {
    const openIndex = scopeText.search(/\S/);
    if (openIndex < 0 || scopeText[openIndex] !== '{') {
        return undefined;
    }
    const closeIndex = findMatchingBracket(scopeText, openIndex);
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

function locateTopLevelObjectProperty(
    scopeText: string,
    key: string,
    label: string
): { start: number; end: number; text: string } {
    const property = locateTopLevelProperty(scopeText, key);
    if (!property) {
        throw new Error(`${label} が見つかりません。`);
    }
    const colonIndex = property.text.indexOf(':');
    const openIndex = scopeText.indexOf('{', property.start + colonIndex + 1);
    if (openIndex < 0 || openIndex >= property.end) {
        throw new Error(`${label} が object ではありません。`);
    }
    const closeIndex = findMatchingBracket(scopeText, openIndex);
    return { start: openIndex, end: closeIndex + 1, text: scopeText.slice(openIndex, closeIndex + 1) };
}

function updateNestedStyleObject(
    source: string,
    property: string,
    updates: Record<string, string | number | null | undefined>,
    label: string
): string {
    if (Object.values(updates).every(value => value === undefined)) {
        return source;
    }
    const located = locateTopLevelProperty(source, property);
    if (!located) {
        const created = Object.fromEntries(Object.entries(updates)
            .filter((entry): entry is [string, string | number] =>
                entry[1] !== undefined && entry[1] !== null));
        return Object.keys(created).length > 0 ? appendJsonProperty(source, property, created) : source;
    }
    const object = locateTopLevelObjectProperty(source, property, label);
    let next = object.text;
    for (const [key, value] of Object.entries(updates)) {
        next = updateOptionalStyleProperty(next, key, value, label);
    }
    return Object.keys(JSON.parse(next) as Record<string, unknown>).length === 0
        ? removeObjectProperty(source, property)
        : source.slice(0, object.start) + next + source.slice(object.end);
}

function updateOptionalStyleProperty(
    source: string,
    property: string,
    value: string | number | null | undefined,
    label: string
): string {
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

function appendJsonProperty(source: string, property: string, value: unknown): string {
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

function replaceTopLevelPropertyValue(
    source: string,
    property: string,
    value: string | number,
    label: string
): string {
    const located = locateTopLevelProperty(source, property);
    if (!located) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
        `^("${escapedProperty}"\\s*:\\s*)(?:${JSON_NUMBER}|"(?:\\\\.|[^"\\\\])*"|true|false|null)`
    );
    if (!pattern.test(located.text)) {
        throw new Error(`${label} の ${property} を特定できません。`);
    }
    const updated = located.text.replace(pattern, (_match, prefix) => `${prefix}${JSON.stringify(value)}`);
    return source.slice(0, located.start) + updated + source.slice(located.end);
}

function removeObjectProperty(source: string, property: string): string {
    const openIndex = source.search(/\S/);
    const closeIndex = openIndex >= 0 ? findMatchingBracket(source, openIndex) : -1;
    if (openIndex < 0 || source[openIndex] !== '{' || closeIndex < 0) {
        throw new Error('字幕スタイルのオブジェクトを特定できません。');
    }
    const inner = source.slice(openIndex + 1, closeIndex);
    const elements = splitTopLevelElements(inner);
    const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const index = elements.findIndex(element => new RegExp(`^"${escapedProperty}"\\s*:`).test(element.text));
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
