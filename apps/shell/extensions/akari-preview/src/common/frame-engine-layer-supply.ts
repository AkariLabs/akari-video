export interface FrameEngineLayerCandidate {
    id?: unknown;
    kind?: unknown;
    src?: unknown;
    deferredTelop?: unknown;
}

/**
 * Frame-engine can only evaluate layers backed by a registered media source. Deferred telops and
 * future layer kinds may intentionally have no source yet; they must not poison the transport.
 */
export function filterRenderableFrameEngineLayers<T extends FrameEngineLayerCandidate>(
    layers: readonly (T | null | undefined)[],
    warn: (message: string) => void = message => console.warn(`[frame-engine] ${message}`)
): T[] {
    const warned = new Set<string>();
    const renderable: T[] = [];
    for (const layer of layers) {
        if (!layer || typeof layer !== 'object') {
            if (!warned.has('invalid')) {
                warned.add('invalid');
                warn('invalid layer skipped');
            }
            continue;
        }
        if (typeof layer.src !== 'string' || !layer.src.trim()) {
            const kind = layer.deferredTelop === true
                ? 'deferred telop'
                : typeof layer.kind === 'string' && layer.kind ? layer.kind : 'unknown';
            const key = `missing-source:${kind}`;
            if (!warned.has(key)) {
                warned.add(key);
                warn(`${kind} layer skipped because it has no renderable source`);
            }
            continue;
        }
        renderable.push(layer);
    }
    return renderable;
}
