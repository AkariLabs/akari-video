export interface PreviewModelDiffInput {
    sourceUris: string[];
    assetUris: string[];
    overlayUris: string[];
    output: { width: number; height: number; fps?: number };
    overlayRuntimeAssets: string[];
    captions?: unknown;
    emphasisWords?: unknown;
    summary: {
        cuts?: unknown[];
        layers?: unknown[];
        audio?: unknown;
        tracks?: unknown;
        timelineTracks?: unknown;
        [key: string]: unknown;
    };
}

export type PreviewModelUpdateKind = 'none' | 'incremental' | 'rebuild';

const stableJson = (value: unknown): string => JSON.stringify(value) ?? 'undefined';

const sameJson = (left: unknown, right: unknown): boolean => stableJson(left) === stableJson(right);

const withoutIncrementalFields = (summary: PreviewModelDiffInput['summary']): Record<string, unknown> => {
    const incrementalKeys = new Set(['cuts', 'layers', 'audio', 'tracks', 'timelineTracks']);
    const stable: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(summary)) {
        if (!incrementalKeys.has(key)) stable[key] = value;
    }
    return stable;
};

const cutDomIdentity = (value: unknown): unknown => {
    const cut = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
    return { src: cut.src };
};

const layerDomIdentity = (value: unknown): unknown => {
    const layer = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
    return {
        id: layer.id,
        kind: layer.kind,
        isImage: layer.isImage,
        proxyMissing: layer.proxyMissing
    };
};

/**
 * PreviewModel の更新が既存 webview DOM へ安全に適用できるかを判定する純関数。
 * URI / 出力条件 / 注入済みランタイム、または DOM のメディア要素構造が変わる場合だけ再構築する。
 */
export const classifyPreviewModelUpdate = (
    previous: PreviewModelDiffInput | undefined,
    next: PreviewModelDiffInput
): PreviewModelUpdateKind => {
    if (!previous) {
        return 'rebuild';
    }
    if (!sameJson(previous.sourceUris, next.sourceUris)
        || !sameJson(previous.assetUris, next.assetUris)
        || !sameJson(previous.overlayUris, next.overlayUris)
        || !sameJson(previous.output, next.output)
        || !sameJson(previous.overlayRuntimeAssets, next.overlayRuntimeAssets)
        || !sameJson(previous.captions, next.captions)
        || !sameJson(previous.emphasisWords, next.emphasisWords)) {
        return 'rebuild';
    }
    if (!sameJson(withoutIncrementalFields(previous.summary), withoutIncrementalFields(next.summary))) {
        return 'rebuild';
    }
    const previousCuts = Array.isArray(previous.summary.cuts) ? previous.summary.cuts : [];
    const nextCuts = Array.isArray(next.summary.cuts) ? next.summary.cuts : [];
    if (!sameJson(previousCuts.map(cutDomIdentity), nextCuts.map(cutDomIdentity))) {
        return 'rebuild';
    }
    const previousLayers = Array.isArray(previous.summary.layers) ? previous.summary.layers : [];
    const nextLayers = Array.isArray(next.summary.layers) ? next.summary.layers : [];
    if (!sameJson(previousLayers.map(layerDomIdentity), nextLayers.map(layerDomIdentity))) {
        return 'rebuild';
    }
    const incrementalFields = (value: PreviewModelDiffInput['summary']): unknown => ({
        cuts: value.cuts,
        layers: value.layers,
        audio: value.audio,
        tracks: value.tracks,
        timelineTracks: value.timelineTracks
    });
    return sameJson(incrementalFields(previous.summary), incrementalFields(next.summary))
        ? 'none' : 'incremental';
};
