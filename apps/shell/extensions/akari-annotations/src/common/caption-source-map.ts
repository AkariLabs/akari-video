export type CaptionSourceForMapping = string | null | undefined;

/**
 * caption-store の正規化対象外である src を、captions.json の生 JSON から表示用に読む。
 * 字幕本文の正本や編集経路は従来どおり caption-store に残し、この表は射影時だけ使う。
 */
export function readCaptionSourceMap(source: string): Map<string, string> {
    const root = JSON.parse(source) as unknown;
    const captions = Array.isArray(root)
        ? root
        : isRecord(root) && Array.isArray(root.captions)
            ? root.captions
            : [];
    const result = new Map<string, string>();
    for (const caption of captions) {
        if (isRecord(caption) && typeof caption.id === 'string'
            && typeof caption.src === 'string' && caption.src.trim().length > 0) {
            result.set(caption.id, caption.src);
        }
    }
    return result;
}

/**
 * src 省略は単一 source の既存 captions.json に限って暗黙補完する。
 * 複数 source で出自が無い字幕は誤った全 source 射影をせず、null（射影不能）にする。
 */
export function resolveCaptionSourceForMapping(
    captionId: string,
    explicitSources: ReadonlyMap<string, string>,
    segmentSources: readonly (string | undefined)[]
): CaptionSourceForMapping {
    const explicit = explicitSources.get(captionId);
    if (explicit !== undefined) {
        return explicit;
    }
    const distinctSources = new Set(segmentSources.filter((src): src is string => src !== undefined));
    if (distinctSources.size > 1) {
        return null;
    }
    return distinctSources.values().next().value;
}

/** 複数 source で src が無く、誤射影を避けるため非表示になる字幕の案内文を作る。 */
export function computeCaptionSourceMappingWarning(
    captions: readonly { id: string }[],
    explicitSources: ReadonlyMap<string, string>,
    segmentSources: readonly (string | undefined)[]
): string | undefined {
    const hiddenCount = captions.filter(caption =>
        resolveCaptionSourceForMapping(caption.id, explicitSources, segmentSources) === null
    ).length;
    if (hiddenCount === 0) {
        return undefined;
    }
    return `出自を特定できない字幕 ${hiddenCount} 件を表示していません。`
        + '複数 source のプロジェクトでは captions.json の各字幕に src が必要です。';
}

/** 同じ射影不能状態の再読込・再描画で、同じ警告を繰り返さない。 */
export function shouldNotifyCaptionSourceMappingWarning(
    previous: string | undefined,
    current: string | undefined
): boolean {
    return current !== undefined && current !== previous;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
