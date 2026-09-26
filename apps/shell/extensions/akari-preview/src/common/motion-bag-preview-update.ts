type UriLike = { toString(): string };

interface OverlayReferences {
    overlayUris: readonly string[];
    motionBagUris?: readonly string[];
}

/** Motion bags are read into the summary; only other overlay files affect the initial page. */
export function samePageOverlayReferences(previous: OverlayReferences, next: OverlayReferences): boolean {
    const pageUris = (value: OverlayReferences): string[] => {
        const bags = new Set(value.motionBagUris ?? []);
        return [...new Set(value.overlayUris.filter(uri => !bags.has(uri)))].sort();
    };
    return JSON.stringify(pageUris(previous)) === JSON.stringify(pageUris(next));
}

interface PreviewReferences<T extends UriLike> {
    editUri?: T;
    relatedEditUri?: T;
    captionsUri?: T;
    overlayUris: readonly T[];
    assetUris: readonly T[];
    motionBagUris?: readonly T[];
}

/** Recompute watcher sets for every accepted model, including incremental updates. */
export function previewTrackedResourceSets<T extends UriLike>(
    model: PreviewReferences<T>,
    suffix: (uri: T) => string
): {
    akariPreviewTrackedResources: Set<string>;
    akariPreviewTrackedSuffixes: Set<string>;
    akariPreviewMotionBagResources: Set<string>;
    akariPreviewMotionBagSuffixes: Set<string>;
} {
    const tracked = [model.editUri, model.relatedEditUri, model.captionsUri,
        ...model.overlayUris, ...model.assetUris].filter((uri): uri is T => uri !== undefined);
    const bags = model.motionBagUris ?? [];
    return {
        akariPreviewTrackedResources: new Set(tracked.map(uri => uri.toString())),
        akariPreviewTrackedSuffixes: new Set(tracked.map(suffix)),
        akariPreviewMotionBagResources: new Set(bags.map(uri => uri.toString())),
        akariPreviewMotionBagSuffixes: new Set(bags.map(suffix))
    };
}
