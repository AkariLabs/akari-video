// Source of truth: packages/render-cut/src/captions.mjs roundedCaptionStrokeShadows.
// The shell keeps the same expression in apps/shell/extensions/akari-preview/src/common/caption-rounded-stroke.ts.
// This browser copy avoids Node-only imports in render-cut, a packages-to-apps dependency,
// and a new bundle output or loading the large deferred frame-engine bundle.
// test/caption-rounded-stroke-webui.test.mjs fixes the return-value parity.
export function roundedCaptionStrokeShadows(stroke, originalShadow) {
  const match = /^\s*([\d.]+)px\s+(.+?)\s*$/u.exec(stroke ?? '');
  if (!match) return null;
  const width = Number(match[1]);
  if (!Number.isFinite(width) || width <= 0 || width > 1000) return null;
  const radius = width / 2;
  const color = match[2];
  const circle = Array.from({ length: 32 }, (_, index) => {
    const angle = index * Math.PI / 16;
    const x = Number((Math.cos(angle) * radius).toFixed(3));
    const y = Number((Math.sin(angle) * radius).toFixed(3));
    return `${x}px ${y}px 0 ${color}`;
  }).join(',');
  return originalShadow && originalShadow !== 'none' ? `${circle},${originalShadow}` : circle;
}
