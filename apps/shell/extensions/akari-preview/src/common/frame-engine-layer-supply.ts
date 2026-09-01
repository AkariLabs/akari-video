/**
 * Preserve every object-shaped layer so src-less entries continue to contribute to totalDuration.
 * Frame-engine skips layers without a renderable source while resolving the composite plan.
 */
export function filterRenderableFrameEngineLayers(
    layers: readonly unknown[],
    warn: (message: string) => void = message => console.warn(`[frame-engine] ${message}`)
): object[] {
    let warnedInvalid = false;
    const renderable: object[] = [];
    for (const layer of layers) {
        if (!layer || typeof layer !== 'object') {
            if (!warnedInvalid) {
                warnedInvalid = true;
                warn('invalid layer skipped');
            }
            continue;
        }
        renderable.push(layer);
    }
    return renderable;
}
