export interface FrameDiff {
  differingPixels: number;
  differingBytes: number;
  maxDelta: number;
  meanAbsoluteDelta: number;
}

export function compareRgba(left: Uint8Array, right: Uint8Array): FrameDiff {
  if (left.length !== right.length || left.length % 4 !== 0) {
    throw new Error(`incompatible RGBA byte lengths: ${left.length} and ${right.length}`);
  }
  let differingBytes = 0;
  let differingPixels = 0;
  let maxDelta = 0;
  let absoluteDelta = 0;
  for (let offset = 0; offset < left.length; offset += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(left[offset + channel]! - right[offset + channel]!);
      if (delta !== 0) {
        differingBytes += 1;
        pixelDiffers = true;
      }
      maxDelta = Math.max(maxDelta, delta);
      absoluteDelta += delta;
    }
    if (pixelDiffers) differingPixels += 1;
  }
  return {
    differingPixels,
    differingBytes,
    maxDelta,
    meanAbsoluteDelta: left.length === 0 ? 0 : absoluteDelta / left.length
  };
}
