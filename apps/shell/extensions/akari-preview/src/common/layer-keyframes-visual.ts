// contract-2026-08-09-transform-keyframes-v0.md (layers[].keyframes) preview reproduction for
// shell. Mirrors packages/render-cut/src/layer-keyframes.mjs's semantics (declaring-points-per-
// category, hold-before-first/hold-after-last/interpolate-between, per-point easing governing the
// segment it ends, easeInOutCubic formula) exactly, but evaluated numerically at a single instant
// instead of emitted as ffmpeg expression strings -- same relationship cut-framing-visual.ts has
// to cut-framing.mjs. This is an independent implementation from the Web UI's
// packages/preview-server/public/layer-keyframes-visual.js (contract-2026-08-02-preview-parity.md
// §2.2.1's "3 surfaces, intentional code duplication" convention).
//
// Unlike render-cut, this surface does NOT need the segment-splitting fallback render-cut's own
// layerPerspectiveKeyframeSteps (see that module) resorts to for perspective -- ffmpeg's
// perspective= filter cannot be driven by a per-frame expression at all, but this is plain
// JavaScript evaluated once per tick, so perspective interpolates exactly as continuously as
// transform/crop do here. The two surfaces' *sampled* values still agree (perspective corners
// interpolate the same declared-corner-lerp math either way); only the *between-sample* curve
// shape differs (continuous here vs. held-per-segment in the export), which is why the L1
// three-way parity check compares specific instants, not a continuous curve.
//
// Serialized into the preview webview via Function.prototype.toString() -- see
// preview-composite-layout.ts's fitPreviewCompositeRect for the established pattern. Keep this
// self-contained: no closures over module state, no calls to sibling functions in this file.

export interface LayerKeyframeTransform {
    x?: number;
    y?: number;
    scale?: number;
    rotate?: number;
}

export interface LayerKeyframeCrop {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface LayerKeyframePerspective {
    corners: [number, number][];
}

export interface LayerKeyframePoint {
    t?: unknown;
    transform?: LayerKeyframeTransform;
    crop?: LayerKeyframeCrop;
    perspective?: LayerKeyframePerspective;
    easing?: unknown;
}

export interface ResolvedLayerKeyframeState {
    /** null when no keyframe point declares `transform` -- caller keeps the layer's own static/default x/y/scale/rotate. */
    transform: { x: number; y: number; scale: number; rotate: number } | null;
    /** null when no keyframe point declares a usable `crop` -- caller keeps the layer's own static crop (or none). */
    crop: LayerKeyframeCrop | null;
    /** null when no keyframe point declares a usable `perspective` -- caller keeps the layer's own static perspective (or none). */
    perspective: LayerKeyframePerspective | null;
}

/**
 * Resolves a layer's transform/crop/perspective at `layerLocalSeconds` (seconds since the
 * layer's own start -- the same clock layers[].keyframes[].t and layers[].t/duration use).
 *
 * Returns null when `keyframes` has fewer than 2 usable points (schema-invalid or absent) --
 * callers should leave the layer's existing static transform/crop/perspective untouched, which
 * keeps keyframe-less layers (the overwhelming majority of existing projects) byte-identical to
 * today's behavior.
 */
export function computeLayerKeyframesVisual(
    keyframes: unknown,
    layerLocalSeconds: number
): ResolvedLayerKeyframeState | null {
    const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    const isPlainObject = (value: unknown): value is Record<string, unknown> =>
        Boolean(value) && typeof value === 'object' && !Array.isArray(value);

    type Point = { t: number; transform?: LayerKeyframeTransform; crop?: LayerKeyframeCrop; perspective?: LayerKeyframePerspective; easing?: unknown };

    if (!Array.isArray(keyframes)) return null;
    const points: Point[] = (keyframes as unknown[])
        .filter((raw): raw is Point => isPlainObject(raw) && isFiniteNumber((raw as { t?: unknown }).t) && ((raw as { t: number }).t as number) >= 0)
        .map((raw) => raw as Point)
        .slice()
        .sort((a, b) => a.t - b.t);
    if (points.length < 2) return null;

    const easingOf = (point: Point): 'linear' | 'ease-in-out' => (point.easing === 'ease-in-out' ? 'ease-in-out' : 'linear');
    // easeInOutCubic(u) = u<0.5 ? 4u^3 : 1-(-2u+2)^3/2 -- keep in sync with render-cut's
    // easeInOutCubicAt / the Web surface's own copy (contract §2.2.1).
    const easeInOutCubicAt = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

    // Holds before the first point, holds after the last, interpolates between -- linearly or
    // eased per the *arriving* point's own easing (a point's easing governs the segment ending at
    // that point, matching #layerKeyframe's schema $comment). `pts` carries its own {t, easing}
    // per entry (a declaring-points array), `pick` reads whatever numeric leaf is being resolved.
    function piecewiseValueAt<T extends { t: number; easing?: unknown }>(pts: T[], pick: (point: T) => number, at: number): number {
        if (pts.length === 1) return pick(pts[0]);
        if (at <= pts[0].t) return pick(pts[0]);
        const last = pts[pts.length - 1];
        if (at >= last.t) return pick(last);
        for (let index = 0; index < pts.length - 1; index += 1) {
            const start = pts[index];
            const end = pts[index + 1];
            if (at >= start.t && at <= end.t) {
                const span = end.t - start.t;
                if (span <= 0) return pick(end);
                const u = (at - start.t) / span;
                const eased = easingOf(end as Point) === 'ease-in-out' ? easeInOutCubicAt(u) : u;
                return pick(start) + (pick(end) - pick(start)) * eased;
            }
        }
        return pick(last);
    }

    const t = isFiniteNumber(layerLocalSeconds) ? layerLocalSeconds : 0;

    // ---- transform ----
    const transformDeclaring = points.filter((point) => isPlainObject(point.transform));
    let transform: ResolvedLayerKeyframeState['transform'] = null;
    if (transformDeclaring.length > 0) {
        const leaf = (name: keyof LayerKeyframeTransform, fallback: number): number =>
            piecewiseValueAt(transformDeclaring, (point) => {
                const value = point.transform ? point.transform[name] : undefined;
                return isFiniteNumber(value) ? (value as number) : fallback;
            }, t);
        const scaleRaw = leaf('scale', 1);
        transform = {
            x: leaf('x', 0),
            y: leaf('y', 0),
            scale: scaleRaw > 0 ? scaleRaw : 1,
            rotate: leaf('rotate', 0)
        };
    }

    // ---- crop ----
    const isUsableCrop = (raw: unknown): raw is LayerKeyframeCrop => {
        if (!isPlainObject(raw)) return false;
        const crop = raw as unknown as LayerKeyframeCrop;
        return isFiniteNumber(crop.x) && isFiniteNumber(crop.y)
            && isFiniteNumber(crop.w) && crop.w > 0
            && isFiniteNumber(crop.h) && crop.h > 0;
    };
    const cropDeclaring = points.filter((point) => isUsableCrop(point.crop));
    let crop: ResolvedLayerKeyframeState['crop'] = null;
    if (cropDeclaring.length > 0) {
        const leaf = (name: keyof LayerKeyframeCrop): number =>
            piecewiseValueAt(cropDeclaring, (point) => (point.crop as LayerKeyframeCrop)[name], t);
        crop = { x: leaf('x'), y: leaf('y'), w: leaf('w'), h: leaf('h') };
    }

    // ---- perspective ----
    const isUsablePerspective = (raw: unknown): raw is LayerKeyframePerspective => {
        if (!isPlainObject(raw)) return false;
        const corners = (raw as unknown as LayerKeyframePerspective).corners;
        return Array.isArray(corners) && corners.length === 4
            && corners.every((corner) => Array.isArray(corner) && corner.length === 2 && isFiniteNumber(corner[0]) && isFiniteNumber(corner[1]));
    };
    const perspectiveDeclaring = points.filter((point) => isUsablePerspective(point.perspective));
    let perspective: ResolvedLayerKeyframeState['perspective'] = null;
    if (perspectiveDeclaring.length > 0) {
        const corners: [number, number][] = [0, 1, 2, 3].map((cornerIndex) => [
            piecewiseValueAt(perspectiveDeclaring, (point) => (point.perspective as LayerKeyframePerspective).corners[cornerIndex][0], t),
            piecewiseValueAt(perspectiveDeclaring, (point) => (point.perspective as LayerKeyframePerspective).corners[cornerIndex][1], t)
        ]);
        perspective = { corners };
    }

    return { transform, crop, perspective };
}
