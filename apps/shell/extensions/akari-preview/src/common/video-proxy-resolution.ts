export interface PreviewVideoSource {
    uri: string;
    proxyUri?: string;
}

/**
 * Chooses the bytes streamed to Chromium for one exact source URI.
 *
 * A proxy explicitly declared beside the matching source is authoritative for every edit
 * representation (v0 source, v1 sources/cuts, and v2 tracks/items). A proxy generated after a
 * browser decode failure is the second choice; otherwise the original source is streamed.
 */
export function resolvePreferredVideoUri(
    videoUri: string,
    declaredSources: readonly PreviewVideoSource[],
    fallbackProxyUri?: string
): string {
    const declaredProxyUri = declaredSources.find(source =>
        source.uri === videoUri && typeof source.proxyUri === 'string' && source.proxyUri.length > 0
    )?.proxyUri;
    return declaredProxyUri ?? fallbackProxyUri ?? videoUri;
}
