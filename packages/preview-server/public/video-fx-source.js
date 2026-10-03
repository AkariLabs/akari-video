// public/app.js から逐語移動。summary は引数で受ける純関数（F-69）。

export function clipLookForCut(summary, cutIndex) {
  const cut = summary?.cuts?.[cutIndex];
  const adjust = cut?.adjust;
  if (!adjust || adjust.sections?.lut === false || !adjust.lut
    || typeof adjust.lut.lut !== 'string') return null;
  const cubeText = summary?.adjustLutCubeTexts?.[String(cut.id)];
  if (typeof cubeText !== 'string') return null;
  const intensity = Number.isFinite(adjust.lut.intensity)
    ? Math.max(0, Math.min(1, adjust.lut.intensity)) : 1;
  return { cubeText, intensity };
}

export function sourceEffectsForCut(summary, cutIndex, allowClipLut = true) {
  const config = summary?.videoFx;
  const sourceId = summary?.cuts?.[cutIndex]?.src;
  const chromaKey = sourceId && config?.sources?.[sourceId];
  const clipLook = allowClipLut ? clipLookForCut(summary, cutIndex) : null;
  const look = clipLook || config?.look;
  return {
    ...(look ? { look } : {}),
    ...(chromaKey ? { chromaKey } : {}),
  };
}

export function layerChromaEffects(layer) {
  const raw = layer?.chroma_key;
  if (!raw) return null;
  return {
    chromaKey: {
      color: raw.color,
      similarity: raw.similarity,
      blend: raw.blend,
      mode: 'layer',
    },
  };
}
