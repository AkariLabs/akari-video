// docs/contract-2026-07-22-render-basics.md #6 (cuts[].framing) preview reproduction. Mirrors
// packages/render-cut/src/cut-framing.mjs's isUsableCrop/usableKeyframes/piecewiseLinearExpr
// semantics exactly, evaluated numerically at a single point in time instead of emitted as an
// ffmpeg filtergraph expression string. Both the static crop and the keyframe zoom describe a
// window of the already-fitted (post scale+pad-to-canvas) frame that gets punched back up to
// fill the canvas -- so this transform composes onto whatever element already represents that
// fitted frame (akari-preview-open-handler.ts's `video`), not the raw source video.
//
// Serialized into the preview webview via Function.prototype.toString() -- see
// preview-composite-layout.ts's fitPreviewCompositeRect for the established pattern. Keep this
// self-contained: no closures over module state, no calls to sibling functions in this file.

export interface CutFramingCrop {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface CutFramingKeyframePoint {
    t: number;
    scale: number;
    cx?: number;
    cy?: number;
}

export interface CutFraming {
    crop?: CutFramingCrop | null;
    keyframes?: CutFramingKeyframePoint[] | null;
}

export interface CutFramingVisual {
    /** Always '0 0' -- callers must set this on the target element alongside `transform`. */
    transformOrigin: string;
    /** CSS transform function list. Callers own how (or whether) to compose it with any other
     * transform already on the element -- this string alone reproduces framing in isolation. */
    transform: string;
}

/**
 * Computes the CSS transform that reproduces cuts[].framing (a static crop window, or a
 * scale/pan keyframe zoom) in a browser preview. `cutLocalPlayedSeconds` must be the cut's own
 * elapsed *played* (post-speed) time -- the same clock as framing.keyframes[].t and
 * freeze.at_sec (contract-2026-07-22-render-basics.md #6/#7).
 *
 * Returns null when framing has no usable crop/keyframes (schema-invalid or absent) -- callers
 * should leave whatever transform/transformOrigin they would otherwise apply untouched, which
 * keeps framing-less cuts (the overwhelming majority of existing projects) byte-identical to
 * today's behavior.
 */
export function computeCutFramingVisual(
    framing: CutFraming | null | undefined,
    cutLocalPlayedSeconds: number
): CutFramingVisual | null {
    const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    const clamp = (value: number, lo: number, hi: number): number => (hi <= lo ? lo : Math.min(Math.max(value, lo), hi));
    const round = (value: number): number => Number(value.toFixed(6));

    const rawCrop = framing && typeof framing === 'object' ? framing.crop : null;
    const usableCrop = rawCrop && typeof rawCrop === 'object'
        && isFiniteNumber(rawCrop.x) && isFiniteNumber(rawCrop.y)
        && isFiniteNumber(rawCrop.w) && rawCrop.w > 0
        && isFiniteNumber(rawCrop.h) && rawCrop.h > 0
        ? rawCrop : null;

    const rawKeyframes = framing && typeof framing === 'object' ? framing.keyframes : null;
    const points = (Array.isArray(rawKeyframes) ? rawKeyframes : [])
        .filter((point): point is CutFramingKeyframePoint =>
            Boolean(point) && typeof point === 'object'
            && isFiniteNumber(point.t) && point.t >= 0
            && isFiniteNumber(point.scale) && point.scale > 0)
        .slice()
        .sort((a, b) => a.t - b.t);
    const usableKeyframes = points.length >= 2 ? points : null;

    if (!usableKeyframes && !usableCrop) return null;

    if (usableKeyframes) {
        const t = isFiniteNumber(cutLocalPlayedSeconds) ? cutLocalPlayedSeconds : 0;
        // Holds before the first point, holds after the last, linearly interpolates between --
        // matches render-cut's piecewiseLinearExpr, evaluated as a number instead of a string.
        const interpolate = (pick: (point: CutFramingKeyframePoint) => number): number => {
            const first = usableKeyframes[0];
            const last = usableKeyframes[usableKeyframes.length - 1];
            if (t <= first.t) return pick(first);
            if (t >= last.t) return pick(last);
            for (let i = 0; i < usableKeyframes.length - 1; i += 1) {
                const start = usableKeyframes[i];
                const end = usableKeyframes[i + 1];
                if (t >= start.t && t <= end.t) {
                    const span = end.t - start.t;
                    if (span <= 0) return pick(end);
                    return pick(start) + (pick(end) - pick(start)) * (t - start.t) / span;
                }
            }
            return pick(last);
        };
        const scale = Math.max(1, interpolate(point => point.scale));
        const cx = interpolate(point => (isFiniteNumber(point.cx) ? point.cx as number : 0.5));
        const cy = interpolate(point => (isFiniteNumber(point.cy) ? point.cy as number : 0.5));
        // appendKeyframeZoom (cut-framing.mjs): the fitted frame is scaled up by `scale`
        // (anchored at its own top-left), then a fixed-size window is cropped out of it at
        // (cropXFrac, cropYFrac) of the *scaled* frame. Under transform-origin: 0 0, the same
        // content point maps as `p*scale - cropFrac`, i.e. `translate(-cropFrac%) scale(scale)`
        // (translate outer/leftmost so it applies to the already-scaled point).
        const cropXFrac = clamp(cx * scale - 0.5, 0, scale - 1);
        const cropYFrac = clamp(cy * scale - 0.5, 0, scale - 1);
        return {
            transformOrigin: '0 0',
            transform: 'translate(' + round(-cropXFrac * 100) + '%, ' + round(-cropYFrac * 100) + '%) scale(' + round(scale) + ')'
        };
    }

    const crop = usableCrop as CutFramingCrop;
    const sx = 1 / crop.w;
    const sy = 1 / crop.h;
    // appendStaticCrop (cut-framing.mjs): crop out a (crop.w, crop.h) window at (crop.x, crop.y),
    // then rescale that window back up to fill the canvas -- q = (p - crop.xy) * (sx, sy), i.e.
    // `scale(sx, sy) translate(-crop.x%, -crop.y%)` under transform-origin: 0 0 (scale
    // outer/leftmost so it applies to the already-translated point).
    return {
        transformOrigin: '0 0',
        transform: 'scale(' + round(sx) + ', ' + round(sy) + ') translate(' + round(-crop.x * 100) + '%, ' + round(-crop.y * 100) + '%)'
    };
}
