export interface ParsedCubeLut {
  size: number;
  domainMin: readonly [number, number, number];
  domainMax: readonly [number, number, number];
  data: Float32Array;
}

function finite(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

export function parseCube(text: string): ParsedCubeLut {
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('.cube text is required');
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];
  const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber]!.replace(/#.*$/u, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/u);
    const keyword = parts[0]!.toUpperCase();
    if (keyword === 'TITLE') continue;
    if (keyword === 'LUT_1D_SIZE') throw new TypeError('1D LUT is not supported');
    if (keyword === 'LUT_3D_SIZE') {
      size = Number(parts[1]);
      if (!Number.isInteger(size) || size < 2 || size > 256) {
        throw new RangeError(`invalid LUT_3D_SIZE at line ${lineNumber + 1}`);
      }
      continue;
    }
    if (keyword === 'DOMAIN_MIN' || keyword === 'DOMAIN_MAX') {
      const parsed = parts.slice(1, 4).map(Number);
      if (parsed.length !== 3 || parsed.some(value => !Number.isFinite(value))) {
        throw new TypeError(`invalid ${keyword} at line ${lineNumber + 1}`);
      }
      const tuple = parsed as [number, number, number];
      if (keyword === 'DOMAIN_MIN') domainMin = tuple;
      else domainMax = tuple;
      continue;
    }
    const row = parts.slice(0, 3).map(Number);
    if (row.length !== 3 || row.some(value => !Number.isFinite(value))) {
      throw new TypeError(`invalid LUT row at line ${lineNumber + 1}`);
    }
    values.push(...row);
  }
  if (!size) throw new TypeError('LUT_3D_SIZE is missing');
  if (domainMax.some((value, index) => !(value > domainMin[index]!))) {
    throw new RangeError('DOMAIN_MAX must be greater than DOMAIN_MIN');
  }
  const expected = size * size * size * 3;
  if (values.length !== expected) {
    throw new RangeError(`LUT_3D_SIZE ${size} requires ${expected / 3} rows; got ${values.length / 3}`);
  }
  return Object.freeze({
    size,
    domainMin: Object.freeze([...domainMin]) as readonly [number, number, number],
    domainMax: Object.freeze([...domainMax]) as readonly [number, number, number],
    data: new Float32Array(values),
  });
}

function lutValue(lut: ParsedCubeLut, r: number, g: number, b: number, channel: number): number {
  return lut.data[((b * lut.size * lut.size + g * lut.size + r) * 3) + channel]!;
}

export function sampleLutTrilinear(
  lut: ParsedCubeLut,
  rgb: readonly number[],
): [number, number, number] {
  if (!lut || !Number.isInteger(lut.size) || !(lut.data instanceof Float32Array)) {
    throw new TypeError('a parsed 3D LUT is required');
  }
  if (!Array.isArray(rgb) && !(rgb instanceof Float32Array)) throw new TypeError('rgb must be an array');
  const p = [0, 1, 2].map(index => {
    const unit = (finite(rgb[index], 0) - lut.domainMin[index]!)
      / (lut.domainMax[index]! - lut.domainMin[index]!);
    return clamp(unit) * (lut.size - 1);
  });
  const lo = p.map(Math.floor);
  const hi = p.map((value, index) => Math.min(lut.size - 1, lo[index]! + 1));
  const f = p.map((value, index) => value - lo[index]!);
  const out: [number, number, number] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const c000 = lutValue(lut, lo[0]!, lo[1]!, lo[2]!, channel);
    const c100 = lutValue(lut, hi[0]!, lo[1]!, lo[2]!, channel);
    const c010 = lutValue(lut, lo[0]!, hi[1]!, lo[2]!, channel);
    const c110 = lutValue(lut, hi[0]!, hi[1]!, lo[2]!, channel);
    const c001 = lutValue(lut, lo[0]!, lo[1]!, hi[2]!, channel);
    const c101 = lutValue(lut, hi[0]!, lo[1]!, hi[2]!, channel);
    const c011 = lutValue(lut, lo[0]!, hi[1]!, hi[2]!, channel);
    const c111 = lutValue(lut, hi[0]!, hi[1]!, hi[2]!, channel);
    const x00 = c000 + (c100 - c000) * f[0]!;
    const x10 = c010 + (c110 - c010) * f[0]!;
    const x01 = c001 + (c101 - c001) * f[0]!;
    const x11 = c011 + (c111 - c011) * f[0]!;
    const y0 = x00 + (x10 - x00) * f[1]!;
    const y1 = x01 + (x11 - x01) * f[1]!;
    out[channel] = y0 + (y1 - y0) * f[2]!;
  }
  return out;
}

export function resolveLookLutPath(lutRef: string): string {
  return lutRef.includes('/') || lutRef.includes('\\')
    ? lutRef.replaceAll('\\', '/')
    : `presets/luts/${lutRef}/${lutRef}.cube`;
}
