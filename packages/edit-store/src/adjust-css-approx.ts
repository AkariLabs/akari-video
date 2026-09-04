// Serialized into the preview webview via Function.prototype.toString() -- see
// apps/shell/extensions/akari-preview/src/common/cut-framing-visual.ts for the established
// pattern. Keep this function self-contained: no closures over module state and no calls to
// sibling functions in this file.

import type { AdjustBasicV0 } from './edit-v2';

export function adjustBasicToCssApprox(basic: AdjustBasicV0): string {
    const source = basic ?? {};
    const exposure = Number.isFinite(source.exposure) ? source.exposure as number : 0;
    const contrast = Number.isFinite(source.contrast) ? source.contrast as number : 0;
    const saturation = Number.isFinite(source.saturation) ? source.saturation as number : 0;
    const temperature = Number.isFinite(source.temperature) ? source.temperature as number : 0;
    const parts: string[] = [];
    if (Math.abs(exposure) > 0.005) {
        parts.push(`brightness(${Math.pow(2, exposure).toFixed(2)})`);
    }
    if (Math.abs(contrast) > 0.005) {
        parts.push(`contrast(${(1 + contrast).toFixed(2)})`);
    }
    if (Math.abs(saturation) > 0.005) {
        parts.push(`saturate(${(1 + saturation).toFixed(2)})`);
    }
    if (temperature > 0.005) {
        parts.push(`sepia(${(temperature * 0.3).toFixed(2)})`);
    } else if (temperature < -0.005) {
        parts.push(`hue-rotate(${(-temperature * 20).toFixed(0)}deg)`);
    }
    return parts.join(' ');
}
