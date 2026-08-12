function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Deterministic even-odd scanline fill. Points are crop-local pixel coordinates. */
export function rasterizePolygon(width, height, points, value = 255) {
  const pixels = new Uint8Array(width * height);
  if (points.length < 3) return pixels;
  const fill = clampByte(value);
  for (let y = 0; y < height; y += 1) {
    const scanY = y + 0.5;
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if ((a[1] > scanY) === (b[1] > scanY)) continue;
      intersections.push(a[0] + (scanY - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const from = Math.max(0, Math.ceil(intersections[index] - 0.5));
      const to = Math.min(width - 1, Math.floor(intersections[index + 1] - 0.5));
      if (to >= from) pixels.fill(fill, y * width + from, y * width + to + 1);
    }
  }
  return pixels;
}

function boxBlurPass(input, width, height, radius, horizontal) {
  const output = new Uint8Array(input.length);
  const lineCount = horizontal ? height : width;
  const lineLength = horizontal ? width : height;
  for (let line = 0; line < lineCount; line += 1) {
    let sum = 0;
    const at = (position) => horizontal ? line * width + position : position * width + line;
    for (let position = -radius; position <= radius; position += 1) {
      const clamped = Math.max(0, Math.min(lineLength - 1, position));
      sum += input[at(clamped)];
    }
    for (let position = 0; position < lineLength; position += 1) {
      output[at(position)] = clampByte(sum / (2 * radius + 1));
      const leaving = Math.max(0, Math.min(lineLength - 1, position - radius));
      const entering = Math.max(0, Math.min(lineLength - 1, position + radius + 1));
      sum += input[at(entering)] - input[at(leaving)];
    }
  }
  return output;
}

/** Three separable box passes approximate a Gaussian and stay byte-deterministic. */
export function featherMask(input, width, height, featherPx) {
  const radius = Math.max(0, Math.round(featherPx));
  if (radius === 0) return input;
  const boxRadius = Math.max(1, Math.ceil(radius / 2));
  let current = input;
  for (let pass = 0; pass < 3; pass += 1) {
    current = boxBlurPass(current, width, height, boxRadius, true);
    current = boxBlurPass(current, width, height, boxRadius, false);
  }
  return current;
}

export function renderMaskFrame({ width, height, polygon, strength = 1, feather = 0 }) {
  return featherMask(rasterizePolygon(width, height, polygon, 255 * strength), width, height, feather);
}
