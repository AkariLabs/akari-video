// cuts[].framing and cuts[].transform use different pivots. Keep transform-origin at the
// framing-compatible top-left and emulate the cut transform's center pivot explicitly.

export function composeCutVisualStyle({
  framingVisual,
  transform,
  opacity,
  outputWidth,
  outputHeight,
}) {
  const x = finiteOr(transform?.x, 0);
  const y = finiteOr(transform?.y, 0);
  const scale = positiveOr(transform?.scale, 1);
  const rotate = finiteOr(transform?.rotate, 0);
  const normalizedOpacity = boundedOr(opacity, 1, 0, 1);
  const xPercent = outputWidth > 0 ? (x / outputWidth) * 100 : 0;
  const yPercent = outputHeight > 0 ? (y / outputHeight) * 100 : 0;
  const needsCenterWrap = scale !== 1 || rotate !== 0;
  const needsXY = x !== 0 || y !== 0;
  const hasFraming = framingVisual !== null;
  const parts = [];

  if (needsXY) parts.push(`translate(${formatNumber(xPercent)}%, ${formatNumber(yPercent)}%)`);
  if (needsCenterWrap) parts.push('translate(50%, 50%)');
  if (rotate !== 0) parts.push(`rotate(${formatNumber(rotate)}deg)`);
  if (scale !== 1) parts.push(`scale(${formatNumber(scale)})`);
  if (needsCenterWrap) parts.push('translate(-50%, -50%)');
  if (hasFraming) parts.push(framingVisual.transform);

  return {
    transformOrigin: parts.length > 0 ? '0 0' : '',
    transform: parts.length > 0 ? parts.join(' ') : '',
    opacity: normalizedOpacity !== 1 ? formatNumber(normalizedOpacity) : '',
  };
}

function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function boundedOr(value, fallback, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= minimum && value <= maximum ? value : fallback;
}

function formatNumber(value) {
  return Number(Number(value).toFixed(6)).toString();
}
