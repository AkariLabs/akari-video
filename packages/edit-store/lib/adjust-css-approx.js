"use strict";
// Serialized into the preview webview via Function.prototype.toString() -- see
// apps/shell/extensions/akari-preview/src/common/cut-framing-visual.ts for the established
// pattern. Keep this function self-contained: no closures over module state and no calls to
// sibling functions in this file.
Object.defineProperty(exports, "__esModule", { value: true });
exports.adjustBasicToCssApprox = adjustBasicToCssApprox;
function adjustBasicToCssApprox(basic) {
    const source = basic ?? {};
    const exposure = Number.isFinite(source.exposure) ? source.exposure : 0;
    const contrast = Number.isFinite(source.contrast) ? source.contrast : 0;
    const saturation = Number.isFinite(source.saturation) ? source.saturation : 0;
    const temperature = Number.isFinite(source.temperature) ? source.temperature : 0;
    const parts = [];
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
    }
    else if (temperature < -0.005) {
        parts.push(`hue-rotate(${(-temperature * 20).toFixed(0)}deg)`);
    }
    return parts.join(' ');
}
