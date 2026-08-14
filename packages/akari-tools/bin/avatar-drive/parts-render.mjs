import { spawnSync } from "node:child_process";

function transformPoint(matrix, x, y) {
  return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
}

export function decodePartImages(partsSet, ffmpegCommand) {
  const decoded = {};
  for (const part of partsSet.parts) {
    const asset = partsSet.assets[part.id];
    const result = spawnSync(ffmpegCommand, [
      "-v", "error", "-i", asset.path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1",
    ], { encoding: null, maxBuffer: asset.width * asset.height * 4 + 1024 * 1024 });
    if (result.error || result.status !== 0) {
      throw new Error(`part ${part.id} の PNG 復号に失敗しました: ${String(result.stderr || result.error?.message).trim()}`);
    }
    const expected = asset.width * asset.height * 4;
    if (result.stdout.length !== expected) throw new Error(`part ${part.id} の byte 数が不正です: ${result.stdout.length} != ${expected}`);
    decoded[part.id] = { width: asset.width, height: asset.height, pixels: result.stdout };
  }
  return decoded;
}

export function calculatePartsMargin(partsSet, partFrames, samplingMargin = 2) {
  const width = partsSet.manifest.size.width;
  const height = partsSet.manifest.size.height;
  let overflow = 0;
  for (const frame of partFrames) for (const rendered of frame) {
    if (!rendered.visible) continue;
    const asset = partsSet.assets[rendered.id];
    const corners = [
      transformPoint(rendered.matrix, 0, 0),
      transformPoint(rendered.matrix, asset.width, 0),
      transformPoint(rendered.matrix, 0, asset.height),
      transformPoint(rendered.matrix, asset.width, asset.height),
    ];
    for (const point of corners) overflow = Math.max(overflow, -point.x, point.x - width, -point.y, point.y - height);
  }
  return Math.max(0, Math.ceil(overflow + samplingMargin));
}

function sampleBilinear(image, x, y) {
  if (x < -1 || x > image.width || y < -1 || y > image.height) return [0, 0, 0, 0];
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const points = [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)],
    [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]];
  let alpha = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (const [px, py, weight] of points) {
    if (px < 0 || px >= image.width || py < 0 || py >= image.height) continue;
    const offset = (py * image.width + px) * 4;
    const pointAlpha = image.pixels[offset + 3];
    alpha += pointAlpha * weight;
    red += image.pixels[offset] * pointAlpha * weight;
    green += image.pixels[offset + 1] * pointAlpha * weight;
    blue += image.pixels[offset + 2] * pointAlpha * weight;
  }
  if (alpha <= 0) return [0, 0, 0, 0];
  return [red / alpha, green / alpha, blue / alpha, alpha];
}

function blend(output, offset, source) {
  const sourceAlpha = source[3] / 255;
  if (sourceAlpha <= 0) return;
  const destinationAlpha = output[offset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  for (let channel = 0; channel < 3; channel += 1) {
    const value = (source[channel] * sourceAlpha
      + output[offset + channel] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha;
    output[offset + channel] = Math.max(0, Math.min(255, Math.round(value)));
  }
  output[offset + 3] = Math.max(0, Math.min(255, Math.round(outputAlpha * 255)));
}

export function renderPartsFrame(partsSet, renderedParts, decoded, margin) {
  const outputWidth = partsSet.manifest.size.width + margin * 2;
  const outputHeight = partsSet.manifest.size.height + margin * 2;
  const output = Buffer.alloc(outputWidth * outputHeight * 4);
  for (const rendered of renderedParts) {
    if (!rendered.visible) continue;
    const image = decoded[rendered.id];
    const matrix = { ...rendered.matrix, e: rendered.matrix.e + margin, f: rendered.matrix.f + margin };
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (Math.abs(determinant) < 1e-12) continue;
    const corners = [
      transformPoint(matrix, 0, 0), transformPoint(matrix, image.width, 0),
      transformPoint(matrix, 0, image.height), transformPoint(matrix, image.width, image.height),
    ];
    const minimumX = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.x))) - 1);
    const maximumX = Math.min(outputWidth - 1, Math.ceil(Math.max(...corners.map((point) => point.x))) + 1);
    const minimumY = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.y))) - 1);
    const maximumY = Math.min(outputHeight - 1, Math.ceil(Math.max(...corners.map((point) => point.y))) + 1);
    for (let outputY = minimumY; outputY <= maximumY; outputY += 1) {
      for (let outputX = minimumX; outputX <= maximumX; outputX += 1) {
        const dx = outputX + 0.5 - matrix.e;
        const dy = outputY + 0.5 - matrix.f;
        const sourceX = (matrix.d * dx - matrix.c * dy) / determinant - 0.5;
        const sourceY = (-matrix.b * dx + matrix.a * dy) / determinant - 0.5;
        blend(output, (outputY * outputWidth + outputX) * 4, sampleBilinear(image, sourceX, sourceY));
      }
    }
  }
  return output;
}
