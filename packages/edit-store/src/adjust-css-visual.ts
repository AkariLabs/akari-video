import type { AdjustCurvesV1, AdjustWheelsV1, AdjustHueCurvesV1 } from './edit-v2';

// Serialized into the preview webview via Function.prototype.toString(). Keep this function
// self-contained: no closures over module state and no calls to sibling functions in this file.
// The filter math intentionally mirrors packages/edit-store/src/adjust-css-approx.ts; the unit
// test compares both implementations so the serialized DOM-preview copy cannot drift silently.

export interface AdjustCssBasic {
    exposure?: number;
    contrast?: number;
    highlights?: number;
    shadows?: number;
    blacks?: number;
    whites?: number;
    temperature?: number;
    tint?: number;
    vibrance?: number;
    saturation?: number;
}

export interface AdjustCssInput {
    basic?: AdjustCssBasic | null;
    curves?: AdjustCurvesV1;
    wheels?: AdjustWheelsV1;
    hue?: AdjustHueCurvesV1;
    fx?: readonly { id: string; px?: number }[] | null;
    sections?: { basic?: boolean; lut?: boolean; curves?: boolean; wheels?: boolean; hue?: boolean; fx?: boolean } | null;
}

export interface AdjustCssVisual {
    filter: string;
    /** True when active controls contain values that CSS filters cannot reproduce. */
    hasApproximation: boolean;
}

/**
 * Resolves an item's basic colour adjustment and an optional transition filter into the single
 * CSS `filter` seat used by DOM preview media. Returns null only when neither input owns that
 * seat. A basic section with all-zero values deliberately returns `{ filter: '' }`, allowing an
 * edit refresh to clear a previously active adjustment without inventing a CSS no-op.
 * Active fx approximate only blur with CSS, after basic filters and before the transition.
 * Other fx are not applied and are disclosed through hasApproximation.
 */
export function computeAdjustCssVisual(
    adjust: AdjustCssInput | null | undefined,
    transitionFilter?: string | null,
    blurScale = 1
): AdjustCssVisual | null {
    const source = adjust && typeof adjust === 'object' && !Array.isArray(adjust) ? adjust : null;
    const rawBasic = source && source.sections?.basic !== false ? source.basic : null;
    const basic = rawBasic && typeof rawBasic === 'object' && !Array.isArray(rawBasic) ? rawBasic : null;
    const rawFx = source && source.sections?.fx !== false ? source.fx : null;
    const fx = Array.isArray(rawFx) ? rawFx : [];
    const rawTransition = typeof transitionFilter === 'string' ? transitionFilter.trim() : '';
    const transition = rawTransition === 'none' ? '' : rawTransition;
    // Match kernel normalization and identity tolerances without a runtime dependency.
    const clamp01 = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    const hasWheels = source?.sections?.wheels !== false
      && (['lift', 'gamma', 'gain', 'offset'] as const).some(wheel =>
        (['r', 'g', 'b'] as const).some(channel => {
          const value = source?.wheels?.[wheel]?.[channel];
          return Number.isFinite(value) && value !== 0;
        }));
    const hasCurves = source?.sections?.curves !== false
      && (['master', 'r', 'g', 'b'] as const).some(channel => {
        const raw = source?.curves?.[channel];
        if (raw == null) return false;
        const points = raw.map(point => ({ in: clamp01(point.in), out: clamp01(point.out) }))
          .sort((a, b) => a.in - b.in);
        return !(points.length === 2
          && Math.abs(points[0].in) < 1e-5 && Math.abs(points[0].out) < 1e-5
          && Math.abs(points[1].in - 1) < 1e-5 && Math.abs(points[1].out - 1) < 1e-5);
      });
    const hasHue = source?.sections?.hue !== false
      && (['hue', 'sat', 'luma'] as const).some(channel =>
        (source?.hue?.[channel] ?? []).some(point =>
          Math.abs((Number.isFinite(point.value) ? clamp01(point.value) : 0.5) - 0.5) > 1e-4));
    const hasUnsupportedSection = hasWheels || hasCurves || hasHue || fx.some(effect => effect.id !== 'blur');
    if (!basic && !transition && !hasUnsupportedSection && fx.length === 0) return null;

    const exposure = basic && Number.isFinite(basic.exposure) ? basic.exposure as number : 0;
    const contrast = basic && Number.isFinite(basic.contrast) ? basic.contrast as number : 0;
    const saturation = basic && Number.isFinite(basic.saturation) ? basic.saturation as number : 0;
    const temperature = basic && Number.isFinite(basic.temperature) ? basic.temperature as number : 0;
    const parts: string[] = [];
    if (Math.abs(exposure) > 0.005) {
        parts.push('brightness(' + Math.pow(2, exposure).toFixed(2) + ')');
    }
    if (Math.abs(contrast) > 0.005) {
        parts.push('contrast(' + (1 + contrast).toFixed(2) + ')');
    }
    if (Math.abs(saturation) > 0.005) {
        parts.push('saturate(' + (1 + saturation).toFixed(2) + ')');
    }
    if (temperature > 0.005) {
        parts.push('sepia(' + (temperature * 0.3).toFixed(2) + ')');
    } else if (temperature < -0.005) {
        parts.push('hue-rotate(' + (-temperature * 20).toFixed(0) + 'deg)');
    }
    const scale = Number.isFinite(blurScale) ? blurScale : 1;
    for (const effect of fx) {
        if (effect.id === 'blur' && typeof effect.px === 'number' && Number.isFinite(effect.px) && effect.px > 0) {
            parts.push('blur(' + (effect.px * scale).toFixed(2) + 'px)');
        }
    }
    if (transition) parts.push(transition);

    const unsupportedKeys = ['tint', 'highlights', 'shadows', 'blacks', 'whites', 'vibrance'];
    const hasApproximation = hasUnsupportedSection || Boolean(basic) && unsupportedKeys.some(key => {
        const value = basic?.[key as keyof AdjustCssBasic];
        return Number.isFinite(value) && value !== 0;
    });
    return { filter: parts.join(' '), hasApproximation };
}
