import type { NativeVideoFormat, NativeYuvFrame } from '../types.js';

interface PlaneLayout {
  offset: number;
  stride: number;
}

function compactPlane(
  source: Uint8Array,
  layout: PlaneLayout,
  width: number,
  height: number
): Uint8Array {
  const output = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const start = layout.offset + row * layout.stride;
    output.set(source.subarray(start, start + width), row * width);
  }
  return output;
}

/** Copies a native decoder surface without requesting an RGB format conversion. */
export async function copyNativeYuvFrame(frame: VideoFrame): Promise<NativeYuvFrame> {
  const format = frame.format as NativeVideoFormat | null;
  if (format !== 'NV12' && format !== 'I420') {
    throw new Error(`unsupported native VideoFrame format: ${String(frame.format)}`);
  }
  const width = frame.codedWidth;
  const height = frame.codedHeight;
  const bytes = new Uint8Array(frame.allocationSize());
  const layouts = await frame.copyTo(bytes) as PlaneLayout[];
  const chromaWidth = Math.ceil(width / 2);
  const chromaHeight = Math.ceil(height / 2);

  if (format === 'NV12') {
    if (layouts.length !== 2 || !layouts[0] || !layouts[1]) {
      throw new Error(`NV12 expected two planes, received ${layouts.length}`);
    }
    return {
      format,
      width,
      height,
      y: compactPlane(bytes, layouts[0], width, height),
      uv: compactPlane(bytes, layouts[1], chromaWidth * 2, chromaHeight)
    };
  }

  if (layouts.length !== 3 || !layouts[0] || !layouts[1] || !layouts[2]) {
    throw new Error(`I420 expected three planes, received ${layouts.length}`);
  }
  return {
    format,
    width,
    height,
    y: compactPlane(bytes, layouts[0], width, height),
    u: compactPlane(bytes, layouts[1], chromaWidth, chromaHeight),
    v: compactPlane(bytes, layouts[2], chromaWidth, chromaHeight)
  };
}
