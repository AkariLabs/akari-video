import { visualDeclarationChain } from './visual-thumbnail-key';

export function visualThumbnailReuseKey(
    document: { tracks?: unknown; sources?: unknown; output?: unknown } | undefined,
    id: string,
    input: unknown,
    width: string,
    height: string,
    viewDuration: number,
    dependencyRevision: number,
    unresolvedEpoch: number
): string {
    const chain = visualDeclarationChain(document, id).map(value => {
        const rest = { ...value as Record<string, unknown> };
        delete rest.at;
        return rest;
    });
    const leaf = chain[chain.length - 1] as { source?: { src?: string } } | undefined;
    const fallback = Array.isArray(input) && input[1] && typeof input[1] === 'object'
        ? { ...input[1] as Record<string, unknown> }
        : input && typeof input === 'object' && !Array.isArray(input)
            ? { ...input as Record<string, unknown> } : input;
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
        delete (fallback as Record<string, unknown>).at;
        delete (fallback as Record<string, unknown>).t;
    }
    const sources = Array.isArray(document?.sources)
        ? document.sources.filter((source: { id?: string }) => source.id === leaf?.source?.src) : [];
    return JSON.stringify([chain.length ? chain : fallback, sources, document?.output,
        width, height, viewDuration, dependencyRevision, unresolvedEpoch]);
}
