import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { encodeRgbaPng } from '../../../../../../packages/osr-export/src/png.mjs';

export const PARITY_FIXTURES = ['scale-x', 'scale-y', 'rotated', 'group-leaf', 'keyframes', 'legacy', 'uniform-rotated'];
export const PARITY_FRAMES = [0, 15, 30, 45, 59];

// Decode non-interlaced RGB/RGBA capture PNGs, including every PNG scanline filter.
function decodePng(bytes) {
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), depth = bytes[24], type = bytes[25];
  if (depth !== 8 || ![2, 6].includes(type) || bytes[28] !== 0) throw new Error('Expected 8-bit RGB/RGBA non-interlaced PNG');
  const channels = type === 6 ? 4 : 3, chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset), name = bytes.toString('ascii', offset + 4, offset + 8);
    if (name === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels, pixels = Buffer.alloc(width * height * channels);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) for (let x = 0; x < stride; x++) {
    const filter = raw[y * (stride + 1)], i = y * stride + x;
    const a = x >= channels ? pixels[i - channels] : 0, b = y ? pixels[i - stride] : 0, c = y && x >= channels ? pixels[i - stride - channels] : 0;
    const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
    if (predictor === undefined) throw new Error(`Invalid PNG filter ${filter}`);
    pixels[i] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
  }
  return { width, height, channels, pixels };
}
function bounds(image) {
  let left = image.width, top = image.height, right = -1, bottom = -1;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * image.channels, p = image.pixels;
    if (p[i] < 90 && p[i + 1] > 120 && p[i + 2] > 60 && p[i + 2] < 190) {
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return { left, top, width: right < left ? 0 : right - left + 1, height: bottom < top ? 0 : bottom - top + 1 };
}

/** Geometry is the acceptance criterion; MAD is a diagnostic relative to the legacy control. */
export async function recomputeComparisons(report, out, { requireComplete = false } = {}) {
  const fixtures = requireComplete ? PARITY_FIXTURES : [...new Set(report.surfaces.map(value => value.fixture))];
  report.comparisonCriterion = { boundsTolerancePx: 1, mad: 'diagnostic-only', madBaselineAllowance: 1 };
  report.passScope = requireComplete
    ? 'all six fixtures: web/gpu/osr geometry and contract checks'
    : 'selected captures and available comparisons only';
  report.comparisons = [];
  report.madBaselines = {};
  if (fixtures.some(fixture => ![...PARITY_FIXTURES, 'legacy-keyframes'].includes(fixture))) throw new Error('Unknown fixture');
  for (const fixture of fixtures) for (const surface of ['gpu', 'osr']) {
    const web = report.surfaces.find(value => value.fixture === fixture && value.surface === 'web');
    const exported = report.surfaces.find(value => value.fixture === fixture && value.surface === surface);
    if (!requireComplete && (!web || !exported)) continue;
    for (const frame of report.frames ?? PARITY_FRAMES) {
      const record = { fixture, surface, frame };
      report.comparisons.push(record);
      try {
        const reference = web?.outputs?.find(value => value.frameNumber === frame);
        const output = exported?.outputs?.find(value => value.frameNumber === frame);
        if (!reference || !output) throw new Error(`Missing capture for ${fixture}/${surface} frame ${frame}`);
        const a = decodePng(await readFile(reference.path)), b = decodePng(await readFile(output.path));
        if (a.width !== b.width || a.height !== b.height) throw new Error('Capture dimensions differ');
        const ba = bounds(a), bb = bounds(b), diff = Buffer.alloc(a.width * a.height * 4);
        let sum = 0, count = 0;
        for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) for (let c = 0; c < 3; c++) {
          const pixel = y * a.width + x;
          const delta = Math.abs(a.pixels[pixel * a.channels + c] - b.pixels[pixel * b.channels + c]);
          diff[pixel * 4 + c] = delta; diff[pixel * 4 + 3] = 255;
          if (x >= ba.left && x < ba.left + ba.width && y >= ba.top && y < ba.top + ba.height) { sum += delta; count++; }
        }
        const mad = count ? sum / count : null;
        const diffPath = join(out, fixture, `${surface}-diff-${frame}.png`);
        await mkdir(join(out, fixture), { recursive: true });
        await writeFile(diffPath, encodeRgbaPng(diff, a.width, a.height));
        Object.assign(record, { bounds: [ba, bb], mad, diffPath,
          pass: ba.width > 0 && ba.height > 0 && bb.width > 0 && bb.height > 0
            && Object.keys(ba).every(key => Math.abs(ba[key] - bb[key]) <= 1) });
      } catch (error) { Object.assign(record, { status: 'blocked', pass: false, error: String(error.stack ?? error) }); }
    }
  }
  for (const surface of ['gpu', 'osr']) {
    const samples = report.comparisons.filter(value => value.fixture === 'legacy' && value.surface === surface && Number.isFinite(value.mad));
    report.madBaselines[surface] = { fixture: 'legacy', aggregation: 'max of available legacy frames',
      mad: samples.length ? Math.max(...samples.map(value => value.mad)) : null,
      frames: samples.map(value => ({ frame: value.frame, mad: value.mad })) };
  }
  for (const comparison of report.comparisons) {
    const baseline = report.madBaselines[comparison.surface].mad;
    comparison.baselineMad = baseline;
    comparison.madWithinBaseline = Number.isFinite(baseline) && Number.isFinite(comparison.mad)
      ? comparison.mad <= baseline + 1 : null;
  }
  if (requireComplete) {
    report.missingSurfaces = PARITY_FIXTURES.flatMap(fixture => ['web', 'gpu', 'osr']
      .filter(surface => !report.surfaces.some(value => value.fixture === fixture && value.surface === surface))
      .map(surface => ({ fixture, surface })));
  }
  if (!requireComplete) delete report.missingSurfaces;
  report.pass = !report.missingSurfaces?.length && report.checks?.length > 0
    && report.checks.every(value => value.pass === true)
    && report.surfaces.length > 0 && report.surfaces.every(value => value.status === 'passed')
    && report.comparisons.every(value => value.pass === true);
  return report;
}
