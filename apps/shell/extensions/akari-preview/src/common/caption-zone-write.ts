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
