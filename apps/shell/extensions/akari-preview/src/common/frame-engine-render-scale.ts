export type RenderScale = 1 | 0.5 | 0.25;
export type RenderScaleMode = 'auto' | RenderScale;

/** Standalone for toString() injection into the preview webview. */
export function parseRenderScaleMode(value: unknown): RenderScaleMode {
    if (value === 1 || value === '1') return 1;
    if (value === 0.5 || value === '0.5') return 0.5;
    if (value === 0.25 || value === '0.25') return 0.25;
    return 'auto';
}

/** Smallest supported per-edge scale covering both physical display dimensions. */
export function resolveRenderScale({ mode, outputWidth, outputHeight, cssWidth, cssHeight, dpr }: {
    mode: RenderScaleMode;
    outputWidth: number;
    outputHeight: number;
    cssWidth: number;
    cssHeight: number;
    dpr: number;
}): RenderScale {
    if (mode !== 'auto') return mode;
    if (![outputWidth, outputHeight, cssWidth, cssHeight, dpr]
        .every(value => Number.isFinite(value) && value > 0)) return 1;
    for (const scale of [0.25, 0.5, 1] as const) {
        if (outputWidth * scale >= cssWidth * dpr && outputHeight * scale >= cssHeight * dpr) return scale;
    }
    return 1;
}

/** Round to the nearest even pixel count (ties upward), with a two-pixel minimum. */
export function scaledOutputSize(output: { width: number; height: number }, scale: RenderScale): {
    width: number;
    height: number;
} {
    const roundEven = (value: number) => Math.max(2, Math.round(value / 2) * 2);
    return { width: roundEven(output.width * scale), height: roundEven(output.height * scale) };
}

// Only the geometry fields used by the shell adapter; no dependency on engine or DOM types.
interface RenderScaleTransform {
    x: number;
    y: number;
    scale: number;
}

interface RenderScaleCutVisual {
    transform: RenderScaleTransform;
    layerStyle?: unknown;
}

interface RenderScaleEvaluationPlan {
    base: readonly { visual: RenderScaleCutVisual }[];
    layers: readonly ({ kind: 'filter' } | {
        kind: 'video' | 'image' | 'matte';
        visual: { transform: RenderScaleTransform };
        cutVisual?: RenderScaleCutVisual;
    })[];
}

/** Project pixel-based geometry without mutating the input or replacing output/source references. */
export function scaleEvaluationPlan<T extends RenderScaleEvaluationPlan>(plan: T, scale: RenderScale): T {
    if (scale === 1) return plan;
    const scaleTransform = (transform: RenderScaleTransform, pixelScale: boolean) => ({
        ...transform,
        x: transform.x * scale,
        y: transform.y * scale,
        scale: pixelScale ? transform.scale * scale : transform.scale
    });
    const scaleCutVisual = (visual: RenderScaleCutVisual) => ({
        ...visual,
        transform: scaleTransform(visual.transform, !!visual.layerStyle)
    });
    return {
        ...plan,
        base: plan.base.map(layer => ({ ...layer, visual: scaleCutVisual(layer.visual) })),
        layers: plan.layers.map(layer => layer.kind === 'filter' ? layer : {
            ...layer,
            visual: { ...layer.visual, transform: scaleTransform(layer.visual.transform, true) },
            ...(layer.cutVisual ? { cutVisual: scaleCutVisual(layer.cutVisual) } : {})
        })
    };
}
