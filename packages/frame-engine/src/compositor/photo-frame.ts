export interface PhotoFrameStyle {
  stroke?: { color: string; width: number };
  cornerRadius?: number;
}

/** Frame dimensions are measured after crop and stretch, in output pixels. */
export function photoFrameUniforms(
  frame: PhotoFrameStyle | undefined,
  width: number,
  height: number,
  outputWidth: number,
): { radius: number; strokeWidth: number; color: [number, number, number] } {
  const short = Math.max(0, Math.min(width, height));
  const radius = short * Math.max(0, Math.min(100, frame?.cornerRadius ?? 0)) / 200;
  const strokeWidth = Math.min(short / 2, Math.max(0, Math.min(100, frame?.stroke?.width ?? 0)) * outputWidth / 1920);
  const hex = frame?.stroke?.color;
  const color: [number, number, number] = typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)
    ? [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number]
    : [0, 0, 0];
  return { radius, strokeWidth, color };
}
