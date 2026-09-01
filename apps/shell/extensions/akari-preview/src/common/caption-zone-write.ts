export const PREVIEW_CAPTION_ZONES = [
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right'
] as const;

export type PreviewCaptionZone = typeof PREVIEW_CAPTION_ZONES[number];

export interface CaptionZoneLintResult {
    pass: boolean;
    errors: readonly string[];
}

export interface PersistCaptionZoneOptions {
    source: string;
    captionId: string;
    zone: PreviewCaptionZone;
    lint: (candidate: string) => Promise<CaptionZoneLintResult>;
    write: (candidate: string) => Promise<void>;
}

export interface PersistCaptionTextOptions {
    source: string;
    captionId: string;
    text: string;
    lint: (candidate: string) => Promise<CaptionZoneLintResult>;
    write: (candidate: string) => Promise<void>;
}

export interface CaptionGroupPosition {
    anchor: 'bc' | 'tc';
    position: { x?: number; y: number };
}

export interface CaptionPlateRect {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface CaptionFrameRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PersistCaptionGroupPositionOptions {
    source: string;
    value: CaptionGroupPosition;
    lint: (candidate: string) => Promise<CaptionZoneLintResult>;
    write: (candidate: string) => Promise<void>;
}

export interface PersistCaptionGroupZoneOptions {
    source: string;
    zone: PreviewCaptionZone;
    lint: (candidate: string) => Promise<CaptionZoneLintResult>;
    write: (candidate: string) => Promise<void>;
}

function captionList(root: unknown): unknown[] {
    const list = Array.isArray(root)
        ? root
        : root && typeof root === 'object' && Array.isArray((root as { captions?: unknown }).captions)
            ? (root as { captions: unknown[] }).captions
            : undefined;
    if (!list) {
        throw new Error('captions.json の形式が不正です（配列、または captions[] を持つオブジェクトである必要があります）');
    }
    return list;
}

function captionIndex(list: readonly unknown[], captionId: string): number {
    const index = list.findIndex(value =>
        !!value && typeof value === 'object' && !Array.isArray(value)
        && (value as { id?: unknown }).id === captionId
    );
    if (index < 0) {
        throw new Error(`字幕が見つかりません: ${captionId}`);
    }
    return index;
}

function captionObjectRoot(source: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(source);
    if (Array.isArray(parsed)) {
        return { captions: parsed };
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { captions?: unknown }).captions)) {
        throw new Error('captions.json の形式が不正です（配列、または captions[] を持つオブジェクトである必要があります）');
    }
    return parsed as Record<string, unknown>;
}

function defaultTextStyle(root: Record<string, unknown>): Record<string, unknown> {
    const current = root.default_text_style;
    const style = current && typeof current === 'object' && !Array.isArray(current)
        ? current as Record<string, unknown> : {};
    root.default_text_style = style;
    return style;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/** Resolve the deterministic group position represented by a dragged caption plate. */
export function captionGroupPositionFromRects(
    plate: CaptionPlateRect,
    frame: CaptionFrameRect
): CaptionGroupPosition {
    if (!(frame.width > 0) || !(frame.height > 0)) {
        throw new Error('出力フレームの幅と高さは正数である必要があります');
    }
    const centerRatio = ((plate.left + plate.right) / 2 - frame.x) / frame.width;
    const centered = Math.abs(centerRatio - 0.5) < 0.03;
    let bottomRatio = (plate.bottom - frame.y) / frame.height;
    if (Math.abs(bottomRatio - 0.93) < 0.02) bottomRatio = 0.93;
    const topRatio = (plate.top - frame.y) / frame.height;
    const anchor = topRatio < 1 / 3 ? 'tc' : 'bc';
    const position: CaptionGroupPosition['position'] = {
        y: round4(clamp01(anchor === 'tc' ? topRatio : bottomRatio))
    };
    if (!centered) {
        position.x = round4(clamp01((plate.left - frame.x) / frame.width));
    }
    return { anchor, position };
}

/** Replace the group default zone with an anchor/position without touching cue styles. */
export function updateCaptionGroupPositionSource(source: string, value: CaptionGroupPosition): string {
    const root = captionObjectRoot(source);
    const style = defaultTextStyle(root);
    style.text_anchor = value.anchor;
    style.position = value.position.x === undefined
        ? { y: value.position.y }
        : { x: value.position.x, y: value.position.y };
    delete style.zone;
    return `${JSON.stringify(root, undefined, 2)}\n`;
}

/** Replace the group default anchor/position with a 3x3 preset without touching cue styles. */
export function updateCaptionGroupZoneSource(source: string, zone: PreviewCaptionZone): string {
    const root = captionObjectRoot(source);
    const style = defaultTextStyle(root);
    style.zone = zone;
    delete style.text_anchor;
    delete style.position;
    return `${JSON.stringify(root, undefined, 2)}\n`;
}

/** Update one cue's zone without disturbing the root shape or unrelated cue fields. */
export function updateCaptionZoneSource(source: string, captionId: string, zone: PreviewCaptionZone): string {
    const root: unknown = JSON.parse(source);
    const list = captionList(root);
    const caption = list[captionIndex(list, captionId)] as Record<string, unknown>;
    const currentStyle = caption.text_style && typeof caption.text_style === 'object'
        && !Array.isArray(caption.text_style) ? caption.text_style as Record<string, unknown> : {};
    caption.text_style = { ...currentStyle, zone };
    return `${JSON.stringify(root, undefined, 2)}\n`;
}

/** Update one cue's text. Blank text removes that cue because captions.schema forbids blank text. */
export function updateCaptionTextSource(source: string, captionId: string, text: string): string {
    const root: unknown = JSON.parse(source);
    const list = captionList(root);
    const index = captionIndex(list, captionId);
    const normalizedText = text.normalize('NFC').trim();
    if (normalizedText.length === 0) {
        list.splice(index, 1);
    } else {
        const caption = list[index] as Record<string, unknown>;
        caption.text = normalizedText;
        delete caption.words;
        delete caption.display_text;
        delete caption.display_fragments;
    }
    return `${JSON.stringify(root, undefined, 2)}\n`;
}

/** Lint and persist one zone change as the same candidate bytes. */
export async function persistCaptionZone(options: PersistCaptionZoneOptions): Promise<CaptionZoneLintResult> {
    const candidate = updateCaptionZoneSource(options.source, options.captionId, options.zone);
    const lintResult = await options.lint(candidate);
    if (!lintResult.pass) {
        return lintResult;
    }
    await options.write(candidate);
    return lintResult;
}

/** Lint and persist one text change as the same candidate bytes. */
export async function persistCaptionText(options: PersistCaptionTextOptions): Promise<CaptionZoneLintResult> {
    const candidate = updateCaptionTextSource(options.source, options.captionId, options.text);
    const lintResult = await options.lint(candidate);
    if (!lintResult.pass) {
        return lintResult;
    }
    await options.write(candidate);
    return lintResult;
}

/** Lint and persist a group anchor/position as the same candidate bytes. */
export async function persistCaptionGroupPosition(
    options: PersistCaptionGroupPositionOptions
): Promise<CaptionZoneLintResult> {
    const candidate = updateCaptionGroupPositionSource(options.source, options.value);
    const lintResult = await options.lint(candidate);
    if (!lintResult.pass) return lintResult;
    await options.write(candidate);
    return lintResult;
}

/** Lint and persist a group zone preset as the same candidate bytes. */
export async function persistCaptionGroupZone(
    options: PersistCaptionGroupZoneOptions
): Promise<CaptionZoneLintResult> {
    const candidate = updateCaptionGroupZoneSource(options.source, options.zone);
    const lintResult = await options.lint(candidate);
    if (!lintResult.pass) return lintResult;
    await options.write(candidate);
    return lintResult;
}
