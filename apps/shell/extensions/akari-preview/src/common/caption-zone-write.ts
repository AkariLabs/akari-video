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

/** Update one cue's zone without disturbing the root shape or unrelated cue fields. */
export function updateCaptionZoneSource(source: string, captionId: string, zone: PreviewCaptionZone): string {
    const root: unknown = JSON.parse(source);
    const list = Array.isArray(root)
        ? root
        : root && typeof root === 'object' && Array.isArray((root as { captions?: unknown }).captions)
            ? (root as { captions: unknown[] }).captions
            : undefined;
    if (!list) {
        throw new Error('captions.json の形式が不正です（配列、または captions[] を持つオブジェクトである必要があります）');
    }
    const caption = list.find((value): value is Record<string, unknown> =>
        !!value && typeof value === 'object' && !Array.isArray(value)
        && (value as { id?: unknown }).id === captionId
    );
    if (!caption) {
        throw new Error(`字幕が見つかりません: ${captionId}`);
    }
    const currentStyle = caption.text_style && typeof caption.text_style === 'object'
        && !Array.isArray(caption.text_style) ? caption.text_style as Record<string, unknown> : {};
    caption.text_style = { ...currentStyle, zone };
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
