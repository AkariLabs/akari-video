import { samePageOverlayReferences } from './motion-bag-preview-update';

export interface PreviewModelDiffInput {
    sourceUris: string[];
    assetUris: string[];
    overlayUris: string[];
    motionBagUris?: string[];
    output: { width: number; height: number; fps?: number };
    overlayRuntimeAssets: string[];
    captions?: unknown;
    emphasisWords?: unknown;
    summary: {
        cuts?: unknown[];
        layers?: unknown[];
        overlays?: unknown[];
        audio?: unknown;
        tracks?: unknown;
        timelineTracks?: unknown;
        [key: string]: unknown;
    };
}

export type PreviewModelUpdateKind = 'none' | 'incremental' | 'rebuild';
export type PreviewModelUpdateAction =
    | 'none'
    | 'legacy-incremental'
    | 'frame-engine-incremental'
    | 'rebuild';

export const isOwnAssetReferenceChange = (
    recorded: { content: string; at: number; key: string; until?: number } | undefined,
    content: string,
    now: number,
    windowMs: number
): boolean => {
    if (!recorded || now < recorded.at || now > (recorded.until ?? recorded.at + windowMs)) return false;
    if (recorded.content === content) return true;
    try {
        const before = JSON.parse(recorded.content);
        const after = JSON.parse(content);
        if (!Array.isArray(before?.references) || !Array.isArray(after?.references)
            || after.references.length <= before.references.length
            || stableJson({ ...before, references: [] }) !== stableJson({ ...after, references: [] })) return false;
        // The resolver sorts the ledger, so an added entry can precede existing ones.
        const added = [...after.references];
        for (const entry of before.references) {
            const index = added.findIndex(candidate => sameJson(candidate, entry));
            if (index < 0) return false;
            added.splice(index, 1);
        }
        return added.every((entry: { category?: unknown; id?: unknown }) =>
            entry && typeof entry === 'object' && !Array.isArray(entry)
            && Object.keys(entry).sort().join(',') === 'category,id'
            && `${entry.category}/${entry.id}` === recorded.key);
    } catch { return false; }
};

const stableJson = (value: unknown): string => JSON.stringify(value) ?? 'undefined';

const sameJson = (left: unknown, right: unknown): boolean => stableJson(left) === stableJson(right);
const unchangedPrefix = <T>(previous: readonly T[], next: readonly T[]): boolean =>
    previous.length <= next.length && previous.every((entry, index) => sameJson(entry, next[index]));

// Sidecar completion is delivered by audio-update, independently of the visual model.
const withoutAudioSidecars = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutAudioSidecars);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => key !== 'sidecar' && key !== 'sidecarState' && key !== 'sidecarWarningEmitted')
        .map(([key, item]) => [key, withoutAudioSidecars(item)]));
};

const withoutIncrementalFields = (summary: PreviewModelDiffInput['summary']): Record<string, unknown> => {
    const incrementalKeys = new Set(['cuts', 'layers', 'overlays', 'audio', 'tracks', 'timelineTracks']);
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
        src: layer.src,
        kind: layer.kind,
        isImage: layer.isImage,
        proxyMissing: layer.proxyMissing,
        chromaKey: Boolean(layer.chromaKey)
    };
};

const sourceBinding = (entry: string): { id: string; uri: string; proxy: string } | undefined => {
    const separator = entry.indexOf('=');
    if (separator < 1) return undefined;
    const proxyAt = entry.lastIndexOf('|proxy=');
    return proxyAt < separator ? { id: entry.slice(0, separator), uri: entry.slice(separator + 1), proxy: '' }
        : { id: entry.slice(0, separator), uri: entry.slice(separator + 1, proxyAt),
            proxy: entry.slice(proxyAt + 7) };
};

const usesSource = (value: unknown, id: string, uri: string): boolean => {
    if (typeof value === 'string') return value === id || value === uri || value === `akari-asset:${uri}`;
    if (Array.isArray(value)) return value.some(item => usesSource(item, id, uri));
    return Boolean(value && typeof value === 'object'
        && Object.values(value as Record<string, unknown>).some(item => usesSource(item, id, uri)));
};

// A failed layer can leave its declared source and attempted asset URI in the
// snapshot. Rebinding that unused source is safe when the recovered layer arrives.
const recoveredSource = (previous: PreviewModelDiffInput, next: PreviewModelDiffInput):
    { from: string; to: string } | undefined => {
    const oldLayers = previous.summary.layers ?? [];
    const newLayers = next.summary.layers ?? [];
    if (next.sourceUris.length < previous.sourceUris.length || newLayers.length <= oldLayers.length) return;
    const changed = previous.sourceUris.flatMap((entry, index) => {
        if (entry === next.sourceUris[index]) return [];
        const before = sourceBinding(entry), after = sourceBinding(next.sourceUris[index]);
        return before && after && before.id === after.id && before.proxy === after.proxy
            && before.uri !== after.uri ? [{ before, after }] : [{ before: undefined, after: undefined }];
    });
    if (changed.length !== 1 || !changed[0].before || !changed[0].after) return;
    const { before, after } = changed[0];
    if (usesSource(previous.summary.cuts, before.id, before.uri)
        || usesSource(oldLayers, before.id, before.uri)
        || usesSource(previous.summary.audio, before.id, before.uri)) return;
    return { from: before.uri, to: after.uri };
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
    const sourceRecovered = unchangedPrefix(previous.sourceUris, next.sourceUris)
        ? undefined : recoveredSource(previous, next);
    if ((!unchangedPrefix(previous.sourceUris, next.sourceUris) && !sourceRecovered)
        // 素材解決は並列化されて登録順が揺れうる（task/2026-09-02-preview-perf）。集合として比べる。
        || previous.assetUris.some(uri => !next.assetUris.includes(uri) && uri !== sourceRecovered?.from)
        || next.assetUris.length !== new Set(next.assetUris).size
        || !samePageOverlayReferences(previous, next)
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
    if (!unchangedPrefix(previousLayers.map(layerDomIdentity), nextLayers.map(layerDomIdentity))) {
        return 'rebuild';
    }
    if (next.sourceUris.length > previous.sourceUris.length || nextLayers.length > previousLayers.length) {
        const oldTracks = previous.summary.tracks as Record<string, unknown> | undefined;
        const newTracks = next.summary.tracks as Record<string, unknown> | undefined;
        const oldLayerTracks = Array.isArray(oldTracks?.layers) ? oldTracks.layers : [];
        const newLayerTracks = Array.isArray(newTracks?.layers) ? newTracks.layers : [];
        const oldTimelineTracks = Array.isArray(previous.summary.timelineTracks) ? previous.summary.timelineTracks : [];
        const newTimelineTracks = Array.isArray(next.summary.timelineTracks) ? next.summary.timelineTracks : [];
        if (!unchangedPrefix(previousLayers, nextLayers)
            || !sameJson(previousCuts, nextCuts)
            || !sameJson(previous.summary.overlays, next.summary.overlays)
            || !sameJson(withoutAudioSidecars(previous.summary.audio), withoutAudioSidecars(next.summary.audio))
            || !sameJson(oldTracks?.cuts, newTracks?.cuts)
            || !sameJson(oldTracks?.audio, newTracks?.audio)
            || !unchangedPrefix(oldLayerTracks, newLayerTracks)
            || !unchangedPrefix(oldTimelineTracks, newTimelineTracks)) return 'rebuild';
    }
    // A newly referenced asset is safe only when a source or layer was appended.
    if (next.assetUris.length > previous.assetUris.length
        && next.sourceUris.length === previous.sourceUris.length
        && nextLayers.length === previousLayers.length) return 'rebuild';
    const incrementalFields = (value: PreviewModelDiffInput['summary']): unknown => ({
        cuts: value.cuts,
        layers: value.layers,
        overlays: value.overlays,
        audio: withoutAudioSidecars(value.audio),
        tracks: value.tracks,
        timelineTracks: value.timelineTracks
    });
    return sameJson(incrementalFields(previous.summary), incrementalFields(next.summary))
        && sameJson(previous.sourceUris, next.sourceUris)
        && sameJson([...previous.assetUris].sort(), [...next.assetUris].sort())
        ? 'none' : 'incremental';
};

/** host が差分判定結果をどの webview 経路へ配送するかを固定する。 */
export const previewModelUpdateAction = (
    updateKind: PreviewModelUpdateKind,
    frameEngineEnabled: boolean
): PreviewModelUpdateAction => updateKind === 'none'
    ? 'none'
    : updateKind === 'incremental'
        ? frameEngineEnabled ? 'frame-engine-incremental' : 'legacy-incremental'
        : 'rebuild';

/**
 * frame-engine の映像評価入力を変えず、webview が model-update で読み直せる
 * overlay / audio だけが変わった更新かを判定する。
 */
export const isOverlayOnlyPreviewModelUpdate = (
    previous: PreviewModelDiffInput | undefined,
    next: PreviewModelDiffInput
): boolean => {
    if (!previous || classifyPreviewModelUpdate(previous, next) !== 'incremental') return false;
    const withoutWebviewFields = (value: PreviewModelDiffInput): unknown => ({
        ...value,
        summary: Object.fromEntries(Object.entries(value.summary)
            .filter(([key]) => key !== 'overlays' && key !== 'audio'))
    });
    return sameJson(withoutWebviewFields(previous), withoutWebviewFields(next));
};

/** edit.json と motion 袋は summary を再生成できるモデル資源であり、HTML 資源とは区別する。 */
export const isPreviewModelResourceChange = (
    resourceKey: string,
    resourceSuffix: string,
    editKey: string | undefined,
    editSuffix: string | undefined,
    motionBagKeys: ReadonlySet<string>,
    motionBagSuffixes: ReadonlySet<string>
): boolean => resourceKey === editKey
    || resourceSuffix === editSuffix
    || motionBagKeys.has(resourceKey)
    || motionBagSuffixes.has(resourceSuffix);
