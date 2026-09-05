// Intentional public mirror of the serialized shell helper in
// apps/shell/extensions/akari-preview/src/common/adjust-css-visual.ts. The Web UI cannot import
// extension TypeScript; parity tests pin the same inputs and outputs on both preview surfaces.

export function computeAdjustCssVisual(adjust, transitionFilter) {
  const source = adjust && typeof adjust === 'object' && !Array.isArray(adjust) ? adjust : null;
  const rawBasic = source && source.sections?.basic !== false ? source.basic : null;
  const basic = rawBasic && typeof rawBasic === 'object' && !Array.isArray(rawBasic) ? rawBasic : null;
  const rawTransition = typeof transitionFilter === 'string' ? transitionFilter.trim() : '';
  const transition = rawTransition === 'none' ? '' : rawTransition;
  if (!basic && !transition) return null;

  const exposure = basic && Number.isFinite(basic.exposure) ? basic.exposure : 0;
  const contrast = basic && Number.isFinite(basic.contrast) ? basic.contrast : 0;
  const saturation = basic && Number.isFinite(basic.saturation) ? basic.saturation : 0;
  const temperature = basic && Number.isFinite(basic.temperature) ? basic.temperature : 0;
  const parts = [];
  if (Math.abs(exposure) > 0.005) parts.push('brightness(' + Math.pow(2, exposure).toFixed(2) + ')');
  if (Math.abs(contrast) > 0.005) parts.push('contrast(' + (1 + contrast).toFixed(2) + ')');
  if (Math.abs(saturation) > 0.005) parts.push('saturate(' + (1 + saturation).toFixed(2) + ')');
  if (temperature > 0.005) parts.push('sepia(' + (temperature * 0.3).toFixed(2) + ')');
  else if (temperature < -0.005) parts.push('hue-rotate(' + (-temperature * 20).toFixed(0) + 'deg)');
  if (transition) parts.push(transition);

  const unsupportedKeys = ['tint', 'highlights', 'shadows', 'blacks', 'whites', 'vibrance'];
  const hasApproximation = Boolean(basic)
    && unsupportedKeys.some(key => Number.isFinite(basic[key]) && basic[key] !== 0);
  return { filter: parts.join(' '), hasApproximation };
}
