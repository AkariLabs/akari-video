import type { ParsedCubeLut } from '../look/cube.js';
import { sampleLutTrilinear } from '../look/cube.js';

export interface PhotoRegionPixels {
  mask: Uint8Array;
  invert?: boolean;
  enabled?: boolean;
  adjustLut?: ParsedCubeLut;
  filterLut?: ParsedCubeLut;
  filterIntensity?: number;
  blur?: number;
}

const byte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

function blurred(source: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
  if (radius < 1) return source;
  const output = new Uint8ClampedArray(source.length);
  const horizontal = new Uint8ClampedArray(source.length);
  const r = Math.min(50, Math.round(radius));
  for (let y = 0; y < height; y += 1) for (let c = 0; c < 3; c += 1) {
    let sum = 0;
    for (let x = -r; x <= r; x += 1) sum += source[(y * width + Math.max(0, Math.min(width - 1, x))) * 4 + c]!;
    for (let x = 0; x < width; x += 1) {
      horizontal[(y * width + x) * 4 + c] = byte(sum / (2 * r + 1));
      sum += source[(y * width + Math.min(width - 1, x + r + 1)) * 4 + c]!
        - source[(y * width + Math.max(0, x - r)) * 4 + c]!;
    }
  }
  for (let x = 0; x < width; x += 1) for (let c = 0; c < 3; c += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) sum += horizontal[(Math.max(0, Math.min(height - 1, y)) * width + x) * 4 + c]!;
    for (let y = 0; y < height; y += 1) {
      output[(y * width + x) * 4 + c] = byte(sum / (2 * r + 1));
      sum += horizontal[(Math.min(height - 1, y + r + 1) * width + x) * 4 + c]!
        - horizontal[(Math.max(0, y - r) * width + x) * 4 + c]!;
    }
  }
  for (let i = 3; i < source.length; i += 4) output[i] = source[i]!;
  return output;
}

/** Source-coordinate, ordered colour passes shared by preview, GPU export and OSR export. */
export function applyPhotoRegions(
  source: Uint8ClampedArray, width: number, height: number,
  globalLut: ParsedCubeLut | undefined, regions: readonly PhotoRegionPixels[],
): Uint8ClampedArray {
  if (source.length !== width * height * 4) throw new RangeError('photo pixel size mismatch');
  const output = new Uint8ClampedArray(source);
  if (globalLut) for (let i = 0; i < output.length; i += 4) {
    const rgb = sampleLutTrilinear(globalLut, [output[i]! / 255, output[i + 1]! / 255, output[i + 2]! / 255]);
    for (let c = 0; c < 3; c += 1) output[i + c] = byte(rgb[c]! * 255);
  }
  for (const region of regions) {
    if (region.enabled === false) continue;
    if (region.mask.length !== width * height) throw new RangeError('region mask size mismatch');
    const backdrop = region.blur ? blurred(output, width, height, region.blur) : output;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const amount = (region.invert ? 255 - region.mask[pixel]! : region.mask[pixel]!) / 255;
      if (!amount) continue;
      const i = pixel * 4;
      let rgb: [number, number, number] = [backdrop[i]! / 255, backdrop[i + 1]! / 255, backdrop[i + 2]! / 255];
      if (region.adjustLut) rgb = sampleLutTrilinear(region.adjustLut, rgb);
      if (region.filterLut) {
        const filtered = sampleLutTrilinear(region.filterLut, rgb);
        const strength = Math.max(0, Math.min(1, region.filterIntensity ?? 1));
        rgb = rgb.map((value, c) => value * (1 - strength) + filtered[c]! * strength) as [number, number, number];
      }
      for (let c = 0; c < 3; c += 1) output[i + c] = byte(output[i + c]! * (1 - amount) + rgb[c]! * 255 * amount);
    }
  }
  return output;
}
