/**
 * Builds the deterministic A/B selection field used by dissolve transitions.
 *
 * The field was identified from the output statistics of ffmpeg xfade's dissolve.
 * It uses the common fract(sin(x*a + y*b) * c) one-line hash, evaluated with
 * binary32 rounding and the fused multiply-add shape observed in that output.
 * Row zero is the top row of the rendered frame.
 */
export function dissolveNoiseField(
  width: number,
  height: number,
): Float32Array {
  if (!Number.isInteger(width) || width <= 0)
    throw new Error(`dissolve noise width must be a positive integer: ${width}`);
  if (!Number.isInteger(height) || height <= 0)
    throw new Error(`dissolve noise height must be a positive integer: ${height}`);

  const a = Math.fround(12.9898);
  const b = Math.fround(78.233);
  const c = Math.fround(43758.545);
  const field = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const yTerm = Math.fround(y * b);
    for (let x = 0; x < width; x += 1) {
      // Round the sum once so x*a participates in the fused multiply-add shape.
      const argument = Math.fround(x * a + yTerm);
      const scaled = Math.fround(Math.fround(Math.sin(argument)) * c);
      field[y * width + x] = scaled - Math.floor(scaled);
    }
  }
  return field;
}
